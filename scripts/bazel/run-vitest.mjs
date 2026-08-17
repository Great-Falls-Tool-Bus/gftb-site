import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { prepareSvelteKitTypes } from './prepare-sveltekit-types.mjs';

const require = createRequire(import.meta.url);
const vitestCli = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const [workspaceFlag, workspacePath, ...rawArgs] = process.argv.slice(2);

if (workspaceFlag !== '--workspace' || !workspacePath) {
	throw new Error('--workspace <declared-tree> is required');
}
const { cleanup, workspace } = prepareSvelteKitTypes(workspacePath);
const vitestArgs = [...rawArgs];
if (vitestArgs[0] === '--coverage-output') {
	const output = vitestArgs[1];
	if (!output) throw new Error('--coverage-output requires a path');
	vitestArgs.splice(0, 2, '--coverage', '--coverage.reportsDirectory', resolve(process.cwd(), output));
}

const child = spawn(process.execPath, [vitestCli, ...vitestArgs], {
	cwd: workspace,
	stdio: 'inherit',
	env: process.env,
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
