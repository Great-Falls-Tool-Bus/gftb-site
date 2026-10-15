import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (!workspace) {
	throw new Error('BUILD_WORKSPACE_DIRECTORY is required; run this target with bazel run');
}

// The dev server runs against the live checkout so Vite owns hot reload, which
// means vite.config.ts and its plugins resolve `vite` from the checkout's
// node_modules. SvelteKit 3 checks the SSR environment with an `instanceof`
// (isRunnableDevEnvironment), so the CLI must be that same Vite instance: a
// second copy from runfiles fails with `vite_ssr_environment_not_runnable`.
// The runfiles Vite is only a fallback for a checkout without an install.
const workspaceManifest = join(workspace, 'package.json');
const resolveFrom = (from) => resolve(dirname(createRequire(from).resolve('vite/package.json')), 'bin/vite.js');
let viteCli;
try {
	viteCli = resolveFrom(workspaceManifest);
} catch {
	viteCli = resolveFrom(import.meta.url);
}
if (!existsSync(viteCli)) {
	throw new Error(`vite CLI not found at ${viteCli}`);
}

const child = spawn(process.execPath, [viteCli, 'dev', ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: process.env,
	cwd: workspace,
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : (code ?? 1));
});
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => child.kill(signal));
}
