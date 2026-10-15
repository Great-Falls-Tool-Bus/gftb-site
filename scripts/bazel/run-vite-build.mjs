import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { readBuildMetadata } from './build-metadata.mjs';
import { copyTreeDereferenced, linkDeclaredNodeModules } from './prepare-sveltekit-types.mjs';

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
	// Always set, so the build sees the stamped value and never an ambient one.
	PUBLIC_TAILNET_PROBE_URL: metadata.tailnetProbeUrl,
};
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
		'kit.config.js',
		'vite.config.ts',
		// SvelteKit 3 writes the tsconfig that tsconfig.json extends here.
		'node_modules/$app/tsconfig.json',
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
		copyTreeDereferenced(declaredWorkspace, workspace);

		const declaredNodeModules = join(dirname(declaredWorkspace), 'node_modules');
		if (!existsSync(declaredNodeModules)) {
			throw new Error('declared build runfiles are missing node_modules');
		}
		linkDeclaredNodeModules(declaredNodeModules, join(workspace, 'node_modules'));
	} catch (error) {
		cleanup();
		throw error;
	}

	return { cleanup, workspace };
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
