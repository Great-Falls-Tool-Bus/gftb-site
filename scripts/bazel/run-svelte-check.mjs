import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { prepareSvelteKitTypes } from './prepare-sveltekit-types.mjs';

// RU13: TypeScript 7.0.2 is the project's `typescript`, so svelte-check runs
// in its native mode (`--tsgo`): svelte2tsx writes the transpiled components
// to .svelte-kit and TypeScript 7 (`typescript/bin/tsc`) checks them together
// with every .ts file the tsconfig includes. patches/svelte-check@4.7.6.patch
// lets `--tsgo` find TypeScript 7 as `typescript` itself.
//
// Modes:
//   --workspace <tree>           Bazel test: check a writable scratch copy of
//                                the declared workspace (.svelte-kit in
//                                runfiles is read-only, and --tsgo writes it).
//   --workspace <tree> --canary  Seed one .ts and one .svelte type error and
//                                fail unless svelte-check reports both. Under
//                                --tsgo a tsconfig that checks nothing reports
//                                0 errors (sveltejs/language-tools#3136); this
//                                proves the gate is live.
//   (no --workspace)             `bazel run` from the source tree, e.g. --watch.

const require = createRequire(import.meta.url);
const svelteCheckCli = resolve(dirname(require.resolve('svelte-check/package.json')), 'bin/svelte-check');

let arguments_ = process.argv.slice(2);
let workspacePath;
if (arguments_[0] === '--workspace') {
	workspacePath = arguments_[1];
	if (!workspacePath) throw new Error('--workspace <declared-tree> requires a path');
	arguments_ = arguments_.slice(2);
}
const canary = arguments_.includes('--canary');
arguments_ = arguments_.filter((argument) => argument !== '--canary');
if (canary && !workspacePath) throw new Error('--canary requires --workspace');

const watch = arguments_.includes('--watch');
const sourceTree = process.env.BUILD_WORKSPACE_DIRECTORY;
if (watch && !sourceTree) {
	throw new Error('BUILD_WORKSPACE_DIRECTORY is required for live watch mode');
}

let cleanup = () => {};
let cwd = watch ? sourceTree : process.cwd();
if (workspacePath) {
	const prepared = prepareSvelteKitTypes(workspacePath);
	cleanup = prepared.cleanup;
	cwd = prepared.workspace;
}

const CANARY_TS = 'src/lib/__tsgo_canary__.ts';
const CANARY_SVELTE = 'src/lib/__TsgoCanary__.svelte';
if (canary) {
	mkdirSync(join(cwd, 'src/lib'), { recursive: true });
	writeFileSync(join(cwd, CANARY_TS), "export const canary: number = 'not a number';\n");
	writeFileSync(
		join(cwd, CANARY_SVELTE),
		'<script lang="ts">\n\tconst canary: number = \'not a number\';\n</script>\n\n<p>{canary}</p>\n',
	);
}

const child = spawn(
	process.execPath,
	[
		svelteCheckCli,
		'--tsgo',
		'--tsconfig',
		'./tsconfig.json',
		...(canary ? ['--output', 'machine'] : []),
		...arguments_,
	],
	{
		stdio: canary ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		cwd,
		env: watch
			? {
					...process.env,
					CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? 'true',
					CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL ?? '500',
				}
			: process.env,
	},
);

let output = '';
child.stdout?.on('data', (chunk) => {
	output += chunk;
	process.stdout.write(chunk);
});

child.on('error', (error) => {
	cleanup();
	console.error(error);
	process.exit(1);
});

child.on('exit', (code) => {
	cleanup();
	if (!canary) process.exit(code ?? 1);
	const errorLines = output.split('\n').filter((line) => / ERROR /u.test(line));
	const missing = [CANARY_TS, CANARY_SVELTE].filter((file) => !errorLines.some((line) => line.includes(file)));
	if (code === 0 || missing.length > 0) {
		console.error(
			`svelte-check --tsgo canary FAILED: exit ${code}; seeded errors not reported in ${missing.join(', ') || '(none)'}`,
		);
		process.exit(1);
	}
	console.log('svelte-check --tsgo canary: both seeded type errors were reported, the gate is live');
	process.exit(0);
});
