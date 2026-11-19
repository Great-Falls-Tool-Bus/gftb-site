// Run browser acceptance against Bazel's declared //:build. The enclosing action supplies
// Chromium.
//
//   run-browser-acceptance.mjs --config <file in e2e/bazel> --chromium-env <VAR>
//       [--label <words>] [--deadline-ms <n>] [--revision-env <VAR>]
//
// //:browser_smoke_test uses browser-acceptance.config.ts with GF's /bin/chromium under
// TIN-1131. //:e2e_test uses e2e.config.ts with //tools/chromium under R583 and TIN-7477.
// --revision-env checks that Chromium matches the linked playwright-core.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
	accessSync,
	constants,
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const harnessDir = dirname(fileURLToPath(import.meta.url));
const options = parseArguments(process.argv.slice(2));
const buildInput = process.env.GF_BROWSER_SMOKE_BUILD_DIR;
const scratchRoot = process.env.TEST_TMPDIR;
const chromiumPath = process.env[options.chromiumEnv];
if (!buildInput || !scratchRoot || !isAbsolute(scratchRoot)) {
	throw new Error('the Bazel-declared build and absolute TEST_TMPDIR are required');
}
if (!chromiumPath || !isAbsolute(chromiumPath)) {
	throw new Error(`${options.chromiumEnv} must name an absolute Chromium executable`);
}
if (options.chromiumEnv === 'GF_RBE_CHROMIUM_EXECUTABLE' && chromiumPath !== '/bin/chromium') {
	throw new Error('GF_RBE_CHROMIUM_EXECUTABLE must name the provisioned /bin/chromium runtime');
}
accessSync(chromiumPath, constants.X_OK);
if (options.revisionEnv) {
	// Resolve the Chromium revision through @playwright/test's own playwright dependency.
	const playwright = createRequire(require.resolve('@playwright/test/package.json'));
	const core = createRequire(playwright.resolve('playwright/package.json'));
	// playwright-core's exports map omits browsers.json, so go through package.json.
	const coreDir = dirname(core.resolve('playwright-core/package.json'));
	const browsers = JSON.parse(readFileSync(join(coreDir, 'browsers.json'), 'utf8'));
	const locked = browsers.browsers.find((browser) => browser.name === 'chromium')?.revision;
	const supplied = process.env[options.revisionEnv];
	if (!locked || supplied !== locked) {
		throw new Error(`the Chromium toolchain is revision ${supplied}, but playwright-core drives ${locked}`);
	}
}
const buildDir = resolve(buildInput);
if (!statSync(join(buildDir, 'index.html')).isFile() || !statSync(join(buildDir, '404.html')).isFile()) {
	throw new Error('the declared static build must contain index.html and 404.html');
}

const scratch = mkdtempSync(join(scratchRoot, 'gftb-browser-'));
// Clear browser-debug and remote-connect settings before importing Playwright. The enclosing
// action supplies the browser and its writable directories.
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

// Chromium creates its process-singleton Unix socket beneath TMPDIR. The 108-byte limit
// requires a short private directory under /tmp. The profile, cache and results stay in the
// Bazel scratch directory.
const chromiumTmp = mkdtempSync('/tmp/gftb-chromium-');
const singletonSocket = join(chromiumTmp, '.org.chromium.Chromium.XXXXXX', 'SingletonSocket');
if (Buffer.byteLength(singletonSocket) >= 100) {
	rmSync(chromiumTmp, { recursive: true, force: true });
	throw new Error(`the Chromium singleton socket path is too long: ${singletonSocket}`);
}
const chromiumEnv = { ...process.env, TMPDIR: chromiumTmp };

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
	createReadStream(pathToRead)
		.on('error', () => response.destroy())
		.pipe(response);
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
		env: chromiumEnv,
		args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
	});
	const page = await browser.newPage();
	// The loopback smoke test must work offline. Under TIN-3847, the manifest accepts only the
	// real site origin. Match the anonymous login HTML from e2e/support/network.ts and abort other
	// off-origin requests.
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		if (url.startsWith('data:') || url.startsWith('blob:') || new URL(url).origin === baseURL) return route.continue();
		// MANIFEST_URL in src/lib/gated/manifest.ts:30, spelled out because this
		// runner imports nothing from the site source.
		if (url === 'https://members.greatfallstoolbus.org/api/public-surface') {
			return route.fulfill({
				status: 200,
				contentType: 'text/html',
				headers: { 'access-control-allow-origin': baseURL, 'access-control-allow-credentials': 'true' },
				body: '<!doctype html><title>Sign in</title>',
			});
		}
		return route.abort('blockedbyclient');
	});
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url || 'no url'})`);
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
	console.log(`declared-build Chromium smoke and ${options.label} passed via ${chromiumPath}`);
} finally {
	try {
		await browser?.close();
	} finally {
		server.closeAllConnections();
		await new Promise((resolveClose) => server.close(resolveClose));
		rmSync(chromiumTmp, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function runAcceptance(baseURL) {
	const cli = require.resolve('@playwright/test/cli');
	const child = spawn(
		process.execPath,
		[cli, 'test', '--config', join(harnessDir, options.config), '--tsconfig', join(harnessDir, 'tsconfig.json')],
		{
			cwd: resolve(harnessDir, '../..'),
			stdio: ['ignore', 'inherit', 'inherit'],
			detached: true,
			env: {
				...process.env,
				GF_BROWSER_ACCEPTANCE_BASE_URL: baseURL,
				GF_BROWSER_ACCEPTANCE_OUTPUT_DIR: process.env.TEST_UNDECLARED_OUTPUTS_DIR
					? join(process.env.TEST_UNDECLARED_OUTPUTS_DIR, 'browser-acceptance')
					: join(scratch, 'results'),
				GF_BROWSER_ACCEPTANCE_CHROMIUM_TMPDIR: chromiumTmp,
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
			// Playwright owns globalTimeout and ordinary teardown. This deadline also stops a wedged CLI
			// and its own process group.
			killTimer = setTimeout(() => {
				timedOut = true;
				stop();
			}, options.deadlineMs);
		});
		if (timedOut || code !== 0) throw new Error(`${options.label} failed`);
	} finally {
		clearTimeout(killTimer);
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
	}
}

function parseArguments(argv) {
	const parsed = {
		config: '',
		chromiumEnv: '',
		label: 'the browser acceptance specs',
		deadlineMs: 1_140_000,
		revisionEnv: '',
	};
	const names = {
		'--config': 'config',
		'--chromium-env': 'chromiumEnv',
		'--label': 'label',
		'--deadline-ms': 'deadlineMs',
		'--revision-env': 'revisionEnv',
	};
	for (let index = 0; index < argv.length; index += 2) {
		const key = names[argv[index]];
		const value = argv[index + 1];
		if (!key || value === undefined) throw new Error(`unknown or incomplete harness argument ${argv[index]}`);
		parsed[key] = key === 'deadlineMs' ? Number.parseInt(value, 10) : value;
	}
	if (!/^[a-z0-9-]+\.config\.ts$/u.test(parsed.config)) throw new Error('--config must name a config in e2e/bazel');
	if (!/^[A-Z][A-Z0-9_]*$/u.test(parsed.chromiumEnv))
		throw new Error('--chromium-env must name an environment variable');
	if (!Number.isSafeInteger(parsed.deadlineMs) || parsed.deadlineMs <= 0)
		throw new Error('--deadline-ms must be positive');
	return parsed;
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
			'.xml': 'application/xml; charset=utf-8',
			'.webmanifest': 'application/manifest+json; charset=utf-8',
			'.pdf': 'application/pdf',
			'.woff2': 'font/woff2',
		}[extname(path)] ?? 'application/octet-stream'
	);
}
