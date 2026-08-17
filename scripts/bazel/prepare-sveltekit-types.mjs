import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function prepareSvelteKitTypes(workspacePath) {
	const declaredWorkspace = resolve(workspacePath);
	for (const requiredPath of ['src', 'tsconfig.json', 'vitest.config.ts', '.svelte-kit/tsconfig.json']) {
		if (!existsSync(join(declaredWorkspace, requiredPath))) {
			throw new Error(`declared unit-test workspace is missing ${requiredPath}`);
		}
	}

	const scratchRoot = process.env.TEST_TMPDIR ?? tmpdir();
	const temporaryRoot = mkdtempSync(join(scratchRoot, 'unit-test-workspace-'));
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

		const declaredNodeModules = join(dirname(declaredWorkspace), 'node_modules');
		if (!existsSync(declaredNodeModules)) {
			throw new Error('declared unit-test runfiles are missing node_modules');
		}
		symlinkSync(declaredNodeModules, join(workspace, 'node_modules'), 'dir');
	} catch (error) {
		cleanup();
		throw error;
	}

	return { cleanup, workspace };
}
