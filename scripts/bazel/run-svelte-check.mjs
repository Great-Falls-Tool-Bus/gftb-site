import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const svelteCheckCli = resolve(dirname(require.resolve('svelte-check/package.json')), 'bin/svelte-check');
const arguments_ = process.argv.slice(2);
const watch = arguments_.includes('--watch');
const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (watch && !workspace) {
	throw new Error('BUILD_WORKSPACE_DIRECTORY is required for live watch mode');
}

const child = spawn(process.execPath, [svelteCheckCli, '--tsconfig', './tsconfig.json', ...arguments_], {
	stdio: 'inherit',
	cwd: watch ? workspace : process.cwd(),
	env: watch
		? {
				...process.env,
				CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? 'true',
				CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL ?? '500',
			}
		: process.env,
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code) => {
	process.exit(code ?? 1);
});
