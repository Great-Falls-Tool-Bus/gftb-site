import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const svelteKitCli = resolve(dirname(require.resolve('@sveltejs/kit/package.json')), 'svelte-kit.js');

const child = spawn(process.execPath, [svelteKitCli, 'sync', '--mode', 'production'], {
	stdio: 'inherit',
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});

child.on('exit', (code) => {
	if (code !== 0) {
		process.exit(code ?? 1);
	}

	// SvelteKit 3 writes the parent tsconfig that tsconfig.json extends
	// ("$app/tsconfig") and the `$app/types` declarations under node_modules/$app,
	// and the generated route types under .svelte-kit.
	for (const generated of ['node_modules/$app/tsconfig.json', 'node_modules/$app/types', '.svelte-kit/types']) {
		if (!existsSync(generated)) {
			console.error(`svelte-kit sync did not generate ${generated}`);
			process.exit(1);
		}
	}
});
