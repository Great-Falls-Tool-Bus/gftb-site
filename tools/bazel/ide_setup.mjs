// `bazel run //:ide_setup` (R583, TIN-7477): give editors, the TypeScript
// server and `just typecheck-watch` a node_modules/ without a host package
// manager.
//
// - node_modules/ is a real directory marked by .gf-ide-setup. A node_modules/
//   without that marker is never touched, so an install made by hand survives.
// - Each top-level entry (and each entry of a scope) is a symlink into
//   bazel-bin/node_modules/, which //:node_modules has just built. The
//   .aspect_rules_js store those links point into is relative inside bazel-bin.
// - node_modules/$app (the parent tsconfig that tsconfig.json extends, and
//   `$app/types`) and .svelte-kit/ are copies of //:sveltekit_types, because
//   the Kit tooling writes under them.
// It is idempotent and safe to re-run after any `bazel build`.
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const MARKER = '.gf-ide-setup';
const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (!workspace || !isAbsolute(workspace)) {
	throw new Error('run this target with `bazel run //:ide_setup`: BUILD_WORKSPACE_DIRECTORY is required');
}
process.chdir(workspace);

const bin = join(workspace, 'bazel-bin');
const store = join(bin, 'node_modules');
if (!existsSync(join(store, '.aspect_rules_js'))) {
	throw new Error(`${relative(workspace, store)}/.aspect_rules_js is missing: build //:node_modules first`);
}
for (const generated of [join(store, '$app', 'tsconfig.json'), join(bin, '.svelte-kit', 'types')]) {
	if (!existsSync(generated)) {
		throw new Error(`${relative(workspace, generated)} is missing: build //:sveltekit_types first`);
	}
}

const target = join(workspace, 'node_modules');
if (existsSync(target) || isLink(target)) {
	if (isLink(target) || !lstatSync(target).isDirectory() || !existsSync(join(target, MARKER))) {
		throw new Error('node_modules/ exists without the .gf-ide-setup marker; move it aside first');
	}
}
const svelteKit = join(workspace, '.svelte-kit');
if (isLink(svelteKit)) throw new Error('.svelte-kit is a symlink; move it aside first');

mkdirSync(target, { recursive: true });
writeFileSync(join(target, MARKER), 'Made by `bazel run //:ide_setup`. Safe to delete; re-run to restore.\n');

const wanted = new Set([MARKER]);
for (const entry of readdirSync(store)) {
	if (entry === '.aspect_rules_js' || entry === '$app' || entry.startsWith('.')) continue;
	if (entry.startsWith('@')) {
		const scopeDir = join(target, entry);
		if (isLink(scopeDir)) rmSync(scopeDir);
		mkdirSync(scopeDir, { recursive: true });
		const scoped = new Set();
		for (const child of readdirSync(join(store, entry))) {
			link(join(store, entry, child), join(scopeDir, child));
			scoped.add(child);
		}
		for (const stale of readdirSync(scopeDir)) {
			if (!scoped.has(stale) && isLink(join(scopeDir, stale))) rmSync(join(scopeDir, stale));
		}
	} else {
		link(join(store, entry), join(target, entry));
	}
	wanted.add(entry);
}
// The rules_js store itself, so a package's own relative links resolve.
link(join(store, '.aspect_rules_js'), join(target, '.aspect_rules_js'));
wanted.add('.aspect_rules_js');

rmSync(join(target, '$app'), { recursive: true, force: true });
cpSync(realpathSync(join(store, '$app')), join(target, '$app'), { recursive: true, dereference: true });
wanted.add('$app');
rmSync(svelteKit, { recursive: true, force: true });
cpSync(realpathSync(join(bin, '.svelte-kit')), svelteKit, { recursive: true, dereference: true });

for (const stale of readdirSync(target)) {
	if (!wanted.has(stale) && isLink(join(target, stale))) rmSync(join(target, stale));
}
console.log(`ide_setup: node_modules/ links ${wanted.size - 2} entries into bazel-bin; $app and .svelte-kit copied`);

function isLink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function link(source, destination) {
	const value = relative(join(destination, '..'), source);
	if (isLink(destination)) {
		if (readlinkSync(destination) === value) return;
		rmSync(destination);
	} else if (existsSync(destination)) {
		throw new Error(`${relative(workspace, destination)} is not a link made by ide_setup`);
	}
	symlinkSync(value, destination);
}
