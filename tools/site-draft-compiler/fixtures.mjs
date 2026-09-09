import { createHash } from 'node:crypto';
import path from 'node:path';

// Independent inventory of the site's semantic source. Compiler implementation
// and packaging remain pinned package inputs, not canonical main inputs.
export const semanticSources = [
	'MODULE.bazel',
	'pnpm-lock.yaml',
	'package.json',
	'.prettierrc',
	'src/lib/public-log-schema.ts',
	'src/lib/featured-image-schema.ts',
	'scripts/lib/log-content.mjs',
	'scripts/lib/log-projection.mjs',
	'scripts/lib/log-source-guard.mjs',
	'scripts/lib/featured-image.mjs',
	'scripts/lib/leak-scan.mjs',
	'scripts/lib/leak-scan-rules.json',
];

export const object = (kind, bytes) =>
	createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');

/** Fixture construction uses explicit Git tree objects, never the compiler's tree function. */
export function seal(input) {
	const tree = input.tree;
	for (const blob of input.blobs) {
		tree.find((item) => item.path === blob.path).oid = object('blob', Buffer.from(blob.content));
	}
	const directories = new Map([['', []]]);
	for (const leaf of tree) {
		let directory = path.posix.dirname(leaf.path);
		if (directory === '.') directory = '';
		if (!directories.has(directory)) directories.set(directory, []);
		directories.get(directory).push({ name: path.posix.basename(leaf.path), mode: leaf.mode, oid: leaf.oid });
		while (directory) {
			directory = path.posix.dirname(directory);
			if (directory === '.') directory = '';
			if (!directories.has(directory)) directories.set(directory, []);
		}
	}
	const deepestFirst = [...directories.keys()].sort(
		(a, b) => b.split('/').length - a.split('/').length || b.length - a.length,
	);
	for (const directory of deepestFirst) {
		const children = directories.get(directory).sort((a, b) =>
			Buffer.compare(Buffer.from(a.name + (a.mode === '40000' ? '/' : '')), Buffer.from(b.name + (b.mode === '40000' ? '/' : ''))),
		);
		const bytes = Buffer.concat(
			children.map((item) => Buffer.concat([Buffer.from(`${item.mode} ${item.name}\0`), Buffer.from(item.oid, 'hex')])),
		);
		const oid = object('tree', bytes);
		if (!directory) input.baseTreeSha = oid;
		else {
			const parent = path.posix.dirname(directory);
			directories.get(parent === '.' ? '' : parent).push({ name: path.posix.basename(directory), mode: '40000', oid });
		}
	}
	return input;
}
