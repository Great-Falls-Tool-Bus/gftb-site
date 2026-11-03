// Run a tool from this js_binary's runfiles against the checkout itself
// (R577, TIN-7477). js_binary's `chdir` is a fixed path in the output tree
// and expands no variables, so the `*_write` targets name the checkout here.
//
//   in_workspace.mjs [--paths-from-workspace] <module> [arguments...]
//
// <module> is a package path ("prettier/bin/prettier.cjs") or a runfiles path
// that starts with "./" ("./scripts/build-source-map.mjs"); both resolve from
// the runfiles. The working directory stays in the runfiles, where Node and
// Prettier resolve packages and plugins (Prettier resolves a plugin named in
// .prettierrc from the working directory, and the checkout has no
// node_modules/ of its own). The checkout is named instead:
// - GFTB_WORKSPACE_ROOT is set to it, for scripts that otherwise locate their
//   outputs from their own file URL;
// - an argument "WORKSPACE:<path>" becomes the absolute path in the checkout;
// - with --paths-from-workspace, every later argument that names an existing
//   path in the checkout becomes absolute, so `just format src` still means
//   the checkout's src/.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (!workspace || !isAbsolute(workspace)) {
	throw new Error('run this target with `bazel run`: BUILD_WORKSPACE_DIRECTORY is required');
}
let argv = process.argv.slice(2);
const pathsFromWorkspace = argv[0] === '--paths-from-workspace';
if (pathsFromWorkspace) argv = argv.slice(1);
const [specifier, ...rest] = argv;
if (!specifier) throw new Error('in_workspace.mjs [--paths-from-workspace] <module> [arguments...]');
const runfilesRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const modulePath = specifier.startsWith('./')
	? resolve(runfilesRoot, specifier)
	: createRequire(import.meta.url).resolve(specifier);
const toolArguments = rest.map((argument) => {
	if (argument.startsWith('WORKSPACE:')) return join(workspace, argument.slice('WORKSPACE:'.length));
	if (
		pathsFromWorkspace &&
		!argument.startsWith('-') &&
		!isAbsolute(argument) &&
		existsSync(join(workspace, argument))
	) {
		return join(workspace, argument);
	}
	return argument;
});
process.env.GFTB_WORKSPACE_ROOT = workspace;
process.argv = [process.argv[0], modulePath, ...toolArguments];
await import(pathToFileURL(modulePath).href);
