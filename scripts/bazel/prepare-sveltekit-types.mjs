import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Copy the declared workspace into writable scratch and link its declared
 * node_modules. `requiredPaths` lists the files the caller needs beyond the
 * sources, the tsconfig and the generated `$app` tsconfig (vitest passes
 * its config; svelte-check needs nothing more).
 */
export function prepareSvelteKitTypes(workspacePath, { requiredPaths = [] } = {}) {
	const declaredWorkspace = resolve(workspacePath);
	for (const requiredPath of ['src', 'tsconfig.json', 'node_modules/$app/tsconfig.json', ...requiredPaths]) {
		if (!existsSync(join(declaredWorkspace, requiredPath))) {
			throw new Error(`declared workspace is missing ${requiredPath}`);
		}
	}

	const scratchRoot = process.env.TEST_TMPDIR ?? tmpdir();
	const temporaryRoot = mkdtempSync(join(scratchRoot, 'sveltekit-workspace-'));
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
			throw new Error('declared unit-test runfiles are missing node_modules');
		}
		linkDeclaredNodeModules(declaredNodeModules, join(workspace, 'node_modules'));
	} catch (error) {
		cleanup();
		throw error;
	}

	return { cleanup, workspace };
}

/**
 * Give the scratch workspace a real node_modules directory. SvelteKit 3 writes
 * its generated tsconfig and `$app` types into node_modules/$app during sync
 * and build, so node_modules can no longer be one symlink to the read-only
 * declared runfiles tree. The declared generated node_modules/$app (copied in
 * with the workspace) is kept; every declared package entry is symlinked in.
 */
export function linkDeclaredNodeModules(declaredNodeModules, workspaceNodeModules) {
	mkdirSync(workspaceNodeModules, { recursive: true });
	for (const entry of readdirSync(declaredNodeModules)) {
		const target = join(workspaceNodeModules, entry);
		if (existsSync(target)) continue;
		symlinkSync(join(declaredNodeModules, entry), target);
	}
}

/**
 * Copy a declared tree into writable scratch as real files and directories.
 * Bazel hands actions their inputs as symlinks into read-only trees, and
 * `cpSync(src, dest, { recursive: true, dereference: true })` dereferences
 * only the top-level path on Node 22.22+ (nested symlinks are copied as
 * symlinks; reproduced on 22.23.2). A later chmod or write then follows the
 * symlink into the read-only sandbox input and fails with EROFS. `statSync`
 * and `copyFileSync` follow every symlink, so each entry here is a new file.
 */
export function copyTreeDereferenced(source, destination) {
	if (statSync(source).isDirectory()) {
		mkdirSync(destination, { recursive: true });
		chmodSync(destination, 0o755);
		for (const entry of readdirSync(source)) {
			copyTreeDereferenced(join(source, entry), join(destination, entry));
		}
		return;
	}
	copyFileSync(source, destination);
	chmodSync(destination, 0o644);
}
