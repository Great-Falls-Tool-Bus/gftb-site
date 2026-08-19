import { spawn } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const options = parseOptions(process.argv.slice(2));
const metadata = readBuildMetadata();
const actionRoot = process.cwd();
const { cleanup, workspace } = prepareBuildWorkspace(options.workspace);

const childEnvironment = {
	...process.env,
	BASE_PATH: metadata.basePath,
	BUILD_COMMIT_SHA: metadata.commitSha,
	BUILD_OUTPUT_DIR: resolve(actionRoot, options.outputDir),
};
// Footer build provenance (src/lib/build-info.ts): PUBLIC_BUILD_SHA is set
// only when the stamp carried an explicitly supplied identity — absent, the
// footer renders no provenance line. Kept out of the object literal above so
// an absent stamp stays truly unset rather than becoming the string ''.
if (metadata.publicBuildSha) {
	childEnvironment.PUBLIC_BUILD_SHA = metadata.publicBuildSha;
}
if (options.analyze) {
	childEnvironment.ANALYZE = '1';
	childEnvironment.ANALYZE_OUTPUT_PATH = resolve(actionRoot, options.analyzeOutput);
}

const child = spawn(process.execPath, [viteCli, 'build'], {
	stdio: 'inherit',
	env: childEnvironment,
	cwd: workspace,
});

child.on('error', (error) => {
	cleanup();
	console.error(error);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	cleanup();
	process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : (code ?? 1));
});

for (const [signal, exitCode] of [
	['SIGINT', 130],
	['SIGTERM', 143],
]) {
	process.once(signal, () => {
		child.kill(signal);
		cleanup();
		process.exit(exitCode);
	});
}

function prepareBuildWorkspace(workspacePath) {
	const declaredWorkspace = resolve(workspacePath);
	for (const requiredPath of [
		'src',
		'tsconfig.json',
		'svelte.config.js',
		'vite.config.ts',
		'.svelte-kit/tsconfig.json',
	]) {
		if (!existsSync(join(declaredWorkspace, requiredPath))) {
			throw new Error(`declared build workspace is missing ${requiredPath}`);
		}
	}

	const temporaryRoot = mkdtempSync(join(tmpdir(), 'site-scaffold-build-workspace-'));
	const workspace = join(temporaryRoot, 'workspace');
	let active = true;
	const cleanup = () => {
		if (!active) return;
		active = false;
		process.removeListener('exit', cleanup);
		rmSync(temporaryRoot, { recursive: true, force: true });
	};
	process.once('exit', cleanup);

	try {
		cpSync(declaredWorkspace, workspace, { recursive: true, dereference: true });
		chmodTree(workspace);

		const declaredNodeModules = join(dirname(declaredWorkspace), 'node_modules');
		if (!existsSync(declaredNodeModules)) {
			throw new Error('declared build runfiles are missing node_modules');
		}
		symlinkSync(declaredNodeModules, join(workspace, 'node_modules'), 'dir');
	} catch (error) {
		cleanup();
		throw error;
	}

	return { cleanup, workspace };
}

function chmodTree(path) {
	const stat = statSync(path);
	if (stat.isDirectory()) {
		chmodSync(path, 0o755);
		for (const entry of readdirSync(path)) {
			chmodTree(join(path, entry));
		}
	} else {
		chmodSync(path, 0o644);
	}
}

function parseOptions(args) {
	const options = {
		analyze: false,
		analyzeOutput: '.bundle-stats/stats.html',
		outputDir: 'build',
		workspace: undefined,
	};
	for (let index = 0; index < args.length; index += 1) {
		switch (args[index]) {
			case '--analyze':
				options.analyze = true;
				break;
			case '--analyze-output':
				options.analyzeOutput = requireValue(args, ++index, '--analyze-output');
				break;
			case '--output-dir':
				options.outputDir = requireValue(args, ++index, '--output-dir');
				break;
			case '--workspace':
				options.workspace = requireValue(args, ++index, '--workspace');
				break;
			default:
				throw new Error(`unknown build runner option: ${args[index]}`);
		}
	}
	if (!options.workspace) throw new Error('--workspace is required');
	return options;
}

function requireValue(args, index, option) {
	if (!args[index]) throw new Error(`${option} requires a value`);
	return args[index];
}

function readBuildMetadata() {
	const statusPath = process.env.BAZEL_STABLE_STATUS_FILE;
	if (!statusPath) {
		throw new Error('BAZEL_STABLE_STATUS_FILE is required; //:build and //:analyze must be stamped');
	}
	const declaredStatusPath = resolve(process.env.JS_BINARY__EXECROOT ?? process.cwd(), statusPath);
	const values = new Map();
	for (const line of readFileSync(declaredStatusPath, 'utf8').split(/\r?\n/)) {
		const separator = line.indexOf(' ');
		if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
	}
	const encodedBasePath = values.get('STABLE_BUILD_BASE_PATH');
	const commitSha = values.get('STABLE_BUILD_COMMIT_SHA');
	if (encodedBasePath === undefined || !commitSha) {
		throw new Error(`build metadata keys are missing from ${declaredStatusPath}`);
	}
	// Optional on purpose (unlike the two required keys above): the public
	// provenance stamp exists only on explicitly identified builds.
	const publicBuildSha = values.get('STABLE_PUBLIC_BUILD_SHA');
	return {
		basePath: encodedBasePath === '__EMPTY__' ? '' : encodedBasePath,
		commitSha,
		publicBuildSha: !publicBuildSha || publicBuildSha === '__ABSENT__' ? '' : publicBuildSha,
	};
}
