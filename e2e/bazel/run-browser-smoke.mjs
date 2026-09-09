// Finite browser acceptance over Bazel's declared //:build, using GF's
// provisioned Chromium authority (TIN-1131). No download, preview rebuild,
// ambient server, or installed-browser search. This is not a deployed LOOK.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
	accessSync,
	constants,
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const harnessDir = dirname(fileURLToPath(import.meta.url));
const buildInput = process.env.GF_BROWSER_SMOKE_BUILD_DIR;
const scratchRoot = process.env.TEST_TMPDIR;
const chromiumPath = process.env.GF_RBE_CHROMIUM_EXECUTABLE;
if (!buildInput || !scratchRoot || !isAbsolute(scratchRoot)) {
	throw new Error('the Bazel-declared build and absolute TEST_TMPDIR are required');
}
if (chromiumPath !== '/bin/chromium') {
	throw new Error('GF_RBE_CHROMIUM_EXECUTABLE must name the provisioned /bin/chromium runtime');
}
accessSync(chromiumPath, constants.X_OK);
const buildDir = resolve(buildInput);
if (!statSync(join(buildDir, 'index.html')).isFile() || !statSync(join(buildDir, '404.html')).isFile()) {
	throw new Error('the declared static build must contain index.html and 404.html');
}

const scratch = mkdtempSync(join(scratchRoot, 'gftb-browser-'));
// Discard browser-debug/remote-connect steering before either Playwright
// import. The enclosing action supplies execution authority, not an ambient
// browser connection or a user profile. Every writable directory is ours.
for (const name of Object.keys(process.env)) {
	if (name.startsWith('PW_') || name.startsWith('PWTEST_') || name.startsWith('PLAYWRIGHT_') || name === 'PWDEBUG') {
		delete process.env[name];
	}
}
for (const [name, leaf] of [
	['HOME', 'home'],
	['XDG_CONFIG_HOME', 'config'],
	['XDG_CACHE_HOME', 'cache'],
	['TMPDIR', 'tmp'],
	['PWTEST_CACHE_DIR', 'transform-cache'],
]) {
	const directory = join(scratch, leaf);
	mkdirSync(directory, { mode: 0o700 });
	process.env[name] = directory;
}
process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';

const server = createServer((request, response) => {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405).end();
		return;
	}
	let filePath;
	try {
		filePath = resolvePath(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
	} catch {
		response.writeHead(400).end();
		return;
	}
	if (!filePath) {
		response.writeHead(403).end();
		return;
	}
	const found = existsSync(filePath) && statSync(filePath).isFile();
	const pathToRead = found ? filePath : join(buildDir, '404.html');
	response.writeHead(found ? 200 : 404, { 'content-type': contentType(pathToRead) });
	if (request.method === 'HEAD') {
		response.end();
		return;
	}
	createReadStream(pathToRead).on('error', () => response.destroy()).pipe(response);
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

let browser;
try {
	await new Promise((resolveListen, rejectListen) => {
		server.once('error', rejectListen);
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', rejectListen);
			resolveListen();
		});
	});
	const baseURL = `http://127.0.0.1:${server.address().port}`;
	const { chromium } = await import('@playwright/test');
	browser = await chromium.launch({
		executablePath: chromiumPath,
		headless: true,
		timeout: 15_000,
		args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
	});
	const page = await browser.newPage();
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(String(error)));
	await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 15_000 });
	if (!(await page.title()).includes('Great Falls Tool Bus')) {
		throw new Error('the declared build has the wrong document title');
	}
	if ((await page.locator('.site-footer__provenance').count()) !== 1) {
		throw new Error('the declared build is missing its stamped footer provenance');
	}
	if (errors.length > 0) throw new Error(`built page emitted errors:\n${errors.join('\n')}`);
	await browser.close();
	browser = undefined;

	await runAcceptance(baseURL);
	console.log(`declared-build Chromium smoke and five acceptance specs passed via ${chromiumPath}`);
} finally {
	try {
		await browser?.close();
	} finally {
		server.closeAllConnections();
		await new Promise((resolveClose) => server.close(resolveClose));
		// Only the exact nonempty directory created above is removed.
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function runAcceptance(baseURL) {
	const cli = require.resolve('@playwright/test/cli');
	const child = spawn(
		process.execPath,
		[
			cli,
			'test',
			'--config',
			join(harnessDir, 'browser-acceptance.config.ts'),
			'--tsconfig',
			join(harnessDir, 'tsconfig.json'),
		],
		{
			cwd: resolve(harnessDir, '../..'),
			stdio: ['ignore', 'inherit', 'inherit'],
			detached: true,
			env: {
				...process.env,
				GF_BROWSER_ACCEPTANCE_BASE_URL: baseURL,
				GF_BROWSER_ACCEPTANCE_OUTPUT_DIR: join(scratch, 'results'),
			},
		},
	);
	let timedOut = false;
	let killTimer;
	const stop = () => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch (error) {
			if (error.code !== 'ESRCH') throw error;
		}
	};
	const onSignal = () => {
		timedOut = true;
		stop();
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	try {
		const code = await new Promise((resolveExit, rejectExit) => {
			child.once('error', rejectExit);
			child.once('close', (exitCode) => resolveExit(exitCode));
			// Playwright owns the ordinary 180s suite deadline and browser
			// teardown. This outer bound also terminates a wedged CLI/process
			// group, without touching another action's browser or server.
			killTimer = setTimeout(() => {
				timedOut = true;
				stop();
			}, 240_000);
		});
		if (timedOut || code !== 0) throw new Error('the five-spec browser acceptance suite failed');
	} finally {
		clearTimeout(killTimer);
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
	}
}

function resolvePath(pathname) {
	const target = resolve(buildDir, decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html');
	if (target !== buildDir && !target.startsWith(`${buildDir}${sep}`)) return undefined;
	if (existsSync(target) && statSync(target).isDirectory()) return join(target, 'index.html');
	if (!existsSync(target) && existsSync(`${target}.html`)) return `${target}.html`;
	return target;
}

function contentType(path) {
	return (
		{
			'.css': 'text/css; charset=utf-8',
			'.html': 'text/html; charset=utf-8',
			'.js': 'text/javascript; charset=utf-8',
			'.json': 'application/json; charset=utf-8',
			'.svg': 'image/svg+xml',
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.webp': 'image/webp',
			'.txt': 'text/plain; charset=utf-8',
			'.webmanifest': 'application/manifest+json; charset=utf-8',
			'.woff2': 'font/woff2',
		}[extname(path)] ?? 'application/octet-stream'
	);
}
