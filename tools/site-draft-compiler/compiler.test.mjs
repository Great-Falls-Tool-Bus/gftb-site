/** Runs the actual compiled package with the repository's pinned Node toolchain. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse as parseSvelte } from 'svelte/compiler';
import { object, seal, semanticSources } from './fixtures.mjs';

const packagePath = process.env.SITE_DRAFT_COMPILER_PACKAGE;
assert.ok(packagePath, 'Bazel must supply the declared compiled package');
const runtime = path.resolve(packagePath);
const source = path.join(runtime, 'source');
const { prepareDraftProjection, assertVerifiedSiteDraftCandidate, SiteDraftRefusal } = await import(
	pathToFileURL(path.join(runtime, 'tools/site-draft-compiler/compiler.js')).href
);
const { renderLogManifest, renderSourceMap } = await import(pathToFileURL(path.join(runtime, 'scripts/lib/log-projection.mjs')).href);
const { parseLogFrontmatter, readLogEntries } = await import(pathToFileURL(path.join(runtime, 'scripts/lib/log-content.mjs')).href);
const format = JSON.parse(readFileSync(path.join(source, '.prettierrc'), 'utf8'));
const repository = { repoUrl: 'https://github.com/Great-Falls-Tool-Bus/gftb-site', branch: 'main' };
const manifest = 'src/lib/generated/log-manifest.ts';
const sourceMap = 'src/lib/generated/source-map.json';
const day = 'src/content/log/2026-09-09-original.svx';
const older = 'src/content/log/2026-09-01-earlier.svx';

const sha = (text) => createHash('sha256').update(text).digest('hex');

function log(date, title, published, body = '<p>We sorted the hand tools and repaired the workbench.</p>') {
	return `---\ndate: '${date}'\ntitle: '${title}'\nsummary: 'We sorted the hand tools and repaired the workbench.'\ntags:\n  - 'tools'\npublished: ${published}\n---\n\n${published ? '' : '<!-- TODO(jess): Review before publication. -->\n\n'}${body}\n`;
}

function entry(file, content) {
	return { file: path.basename(file), slug: path.basename(file, '.svx'), sourcePath: file, ...parseLogFrontmatter(content, file) };
}

async function fixture(existing) {
	const documents = new Map([[older, log('2026-09-01', 'Earlier work', true)]]);
	if (existing !== undefined) documents.set(day, log('2026-09-09', 'Existing approved title', existing, '<p>Preserve this original paragraph exactly.</p>'));
	const entries = [...documents].map(([file, content]) => entry(file, content));
	const bodies = new Map([
		['.prettierrc', readFileSync(path.join(source, '.prettierrc'), 'utf8')],
		['tinyland.repo.json', JSON.stringify({ repo: { github: 'Great-Falls-Tool-Bus/gftb-site', defaultBranch: 'main' } })],
		['package.json', readFileSync(path.join(source, 'package.json'), 'utf8')],
		[manifest, await renderLogManifest(entries, format)],
		[sourceMap, renderSourceMap(repository, ['src/routes/+page.svelte'], entries)],
		...documents,
	]);
	const content = log('2026-09-09', 'New draft title', false);
	return seal({
		repository: 'Great-Falls-Tool-Bus/gftb-site', repositoryId: '12345', baseSha: 'a'.repeat(40), baseTreeSha: '',
		tree: [...bodies].map(([file]) => ({ path: file, mode: '100644', oid: '' })).concat([
			...semanticSources.filter((file) => !bodies.has(file)).map((file) => ({
				path: file, mode: '100644', oid: object('blob', readFileSync(path.join(source, file))),
			})),
			{ path: 'src/routes/+page.svelte', mode: '100644', oid: object('blob', Buffer.from('<h1>Home</h1>')) },
			{ path: 'other-source.txt', mode: '100644', oid: object('blob', Buffer.from('Unrelated source remains bound.')) },
		]),
		blobs: [...bodies].map(([file, body]) => ({ path: file, content: body })),
		candidate: { path: 'src/content/log/2026-09-09-new-draft.svx', content, sha256: sha(content) },
	});
}

function replaceCandidate(input, content) { input.candidate.content = content; input.candidate.sha256 = sha(content); }

async function refused(input) {
	await assert.rejects(prepareDraftProjection(input), (error) => {
		assert.ok(error instanceof SiteDraftRefusal);
		assert.equal(error.message, 'Site draft projection refused.');
		assert.equal(error.cause, undefined);
		return true;
	});
}

test('compiled shared renderers reproduce both actual checked-in manifests', async () => {
	const entries = readLogEntries('src/content/log');
	const pages = [];
	function walk(directory) {
		for (const file of readdirSync(directory, { withFileTypes: true })) {
			const full = `${directory}/${file.name}`;
			if (file.isDirectory()) walk(full);
			else if (file.name === '+page.svelte') pages.push(full);
		}
	}
	walk('src/routes');
	assert.equal(await renderLogManifest(entries, format), readFileSync(manifest, 'utf8'));
	assert.equal(renderSourceMap(repository, pages, entries), readFileSync(sourceMap, 'utf8'));
});

test('new date returns the literal candidate and both unchanged generated preimages', async () => {
	const input = await fixture();
	const result = await prepareDraftProjection(input);
	assertVerifiedSiteDraftCandidate(result);
	assert.equal(result.files.length, 3);
	assert.equal(result.files[0].content, input.candidate.content);
	assert.equal(result.files[0].previousBlobSha, null);
	for (const output of result.files.slice(1)) {
		assert.equal(output.content, input.blobs.find((blob) => blob.path === output.path).content);
		assert.equal(output.previousBlobSha, input.tree.find((leaf) => leaf.path === output.path).oid);
		assert.ok(!output.content.includes('2026-09-09-new-draft'));
	}
	assert.notEqual(result.prospectiveTreeSha, result.baseTreeSha);
	assert.match(result.candidateTreeSha256, /^[a-f0-9]{64}$/);
	assert.equal(result.originalCandidate.sha256, input.candidate.sha256);
	assert.match(result.receiptSha256, /^[a-f0-9]{64}$/);
	assert.ok(result.toolInputs.some((item) => item.path === 'compiler-runtime'));
	assert.equal(result.sourceInputs.length, input.blobs.length);
});

test('the authenticated tree binds all real semantic inputs without requiring compiler source on main', async () => {
	const input = await fixture();
	assert.equal(input.tree.some((leaf) => leaf.path.startsWith('tools/site-draft-compiler/')), false);
	const result = await prepareDraftProjection(input);
	assertVerifiedSiteDraftCandidate(result);
	for (const file of semanticSources) {
		const bytes = readFileSync(path.join(source, file));
		assert.equal(input.tree.find((leaf) => leaf.path === file).oid, object('blob', bytes));
		assert.equal(result.toolInputs.find((source) => source.path === file).sha256, sha(bytes));
	}
});

for (const file of semanticSources) {
	for (const failure of ['missing', 'changed', 'symlink', 'executable']) {
		test(`refuses authentic canonical ${failure} semantic input ${file}`, async () => {
			const input = await fixture();
			const leaf = input.tree.find((entry) => entry.path === file);
			if (failure === 'missing') {
				input.tree = input.tree.filter((entry) => entry.path !== file);
				input.blobs = input.blobs.filter((blob) => blob.path !== file);
			} else if (failure === 'changed') {
				const bytes = Buffer.concat([readFileSync(path.join(source, file)), Buffer.from('\n')]);
				leaf.oid = object('blob', bytes);
				const blob = input.blobs.find((entry) => entry.path === file);
				if (blob) blob.content = bytes.toString('utf8');
			} else {
				// Keep the exact content hash: a matching blob does not excuse a
				// non-regular or executable source mode in the authenticated tree.
				leaf.mode = failure === 'symlink' ? '120000' : '100755';
			}
			seal(input);
			await refused(input);
		});
	}
}

test('the pinned parser exposes scripts and expressions to the modern fragment guard', () => {
	const parsed = parseSvelte('<script>let active = 1;</script><p>{active}</p>', { modern: true });
	assert.equal(parsed.type, 'Root');
	assert.equal(parsed.js.length, 1);
	assert.equal(parsed.js[0].type, 'Script');
	assert.equal(parsed.js[0].context, 'default');
	assert.equal(parsed.fragment.type, 'Fragment');
	assert.equal(parsed.fragment.nodes[0].type, 'RegularElement');
	assert.equal(parsed.fragment.nodes[0].fragment.nodes[0].type, 'ExpressionTag');
});

test('the prospective inventory digest binds unrelated leaves and is independent of input order', async () => {
	const input = await fixture();
	const first = await prepareDraftProjection(input);
	input.tree.reverse();
	input.blobs.reverse();
	const reordered = await prepareDraftProjection(input);
	assert.equal(reordered.candidateTreeSha256, first.candidateTreeSha256);
	assert.equal(reordered.receiptSha256, first.receiptSha256);
	input.tree.find((leaf) => leaf.path === 'other-source.txt').oid = object('blob', Buffer.from('Changed unrelated source.'));
	seal(input);
	const changed = await prepareDraftProjection(input);
	assert.notEqual(changed.candidateTreeSha256, first.candidateTreeSha256);
	assert.notEqual(changed.prospectiveTreeSha, first.prospectiveTreeSha);
	assert.notEqual(changed.receiptSha256, first.receiptSha256);
});

for (const published of [false, true]) {
	test(`same-day amendment retains original path, title and prose (published=${published})`, async () => {
		const input = await fixture(published);
		const original = input.blobs.find((blob) => blob.path === day).content;
		const result = await prepareDraftProjection(input);
		assert.equal(result.canonicalDayPath, day);
		assert.equal(result.files[0].path, day);
		assert.equal(result.files[0].previousBlobSha, input.tree.find((leaf) => leaf.path === day).oid);
		assert.ok(result.files[0].content.startsWith(original.replace('published: true', 'published: false')));
		assert.ok(result.files[0].content.includes('Preserve this original paragraph exactly.'));
		assert.ok(result.files[0].content.includes('<p>We sorted the hand tools and repaired the workbench.</p>'));
		assert.equal(parseLogFrontmatter(result.files[0].content, day).metadata.title, 'Existing approved title');
		for (const output of result.files.slice(1)) {
			assert.ok(output.content.includes('2026-09-01-earlier'));
			assert.ok(!output.content.includes('2026-09-09-original'));
			assert.equal(output.content === input.blobs.find((blob) => blob.path === output.path).content, !published);
		}
	});
}

test('amending an existing draft leaves publication-shaped body prose byte-for-byte intact', async () => {
	const input = await fixture(false);
	const existing = input.blobs.find((blob) => blob.path === day);
	existing.content += '\npublished: true\n';
	seal(input);
	const result = await prepareDraftProjection(input);
	assert.ok(result.files[0].content.startsWith(existing.content));
	assert.equal(parseLogFrontmatter(result.files[0].content, day).metadata.published, false);
});

test('copies caller inputs before awaits and brands only deeply frozen real results', async () => {
	const input = await fixture();
	const expected = input.candidate.content;
	const pending = prepareDraftProjection(input);
	input.candidate.content = 'Changed after dispatch';
	input.blobs[0].content = '{}';
	input.tree.length = 0;
	const result = await pending;
	assert.equal(result.files[0].content, expected);
	assert.throws(() => assertVerifiedSiteDraftCandidate({ ...result }), SiteDraftRefusal);
	assert.throws(() => assertVerifiedSiteDraftCandidate(JSON.parse(JSON.stringify(result))), SiteDraftRefusal);
	assert.throws(() => { result.files[0].content = 'Replacement'; }, TypeError);
	assert.throws(() => { result.sourceInputs.push({}); }, TypeError);
	assert.throws(() => { result.toolInputs[0].sha256 = '0'.repeat(64); }, TypeError);
});

for (const failure of ['tree omitted', 'blob changed', 'blob omitted', 'extra blob', 'wrong repo', 'wrong candidate digest', 'symlink log', 'config plugin']) {
	test(`refuses ${failure} without source diagnostics`, async () => {
		const input = await fixture();
		if (failure === 'tree omitted') input.tree.pop();
		if (failure === 'blob changed') input.blobs[0].content += ' ';
		if (failure === 'blob omitted') input.blobs.pop();
		if (failure === 'extra blob') input.blobs.push({ path: 'unknown', content: 'Private text' });
		if (failure === 'wrong repo') input.repository = 'another/repository';
		if (failure === 'wrong candidate digest') input.candidate.sha256 = '0'.repeat(64);
		if (failure === 'symlink log') { input.tree.find((leaf) => leaf.path === older).mode = '120000'; seal(input); }
		if (failure === 'config plugin') { input.blobs[0].content = '{"plugins":["./untrusted.mjs"]}'; seal(input); }
		await refused(input);
	});
}

for (const target of [manifest, sourceMap]) {
	test(`refuses a correctly hashed but stale ${target}`, async () => {
		const input = await fixture();
		input.blobs.find((blob) => blob.path === target).content += '\n';
		seal(input);
		await refused(input);
	});
}

test('refuses an existing duplicate day even when both records and the tree are authentic inputs', async () => {
	const input = await fixture();
	const duplicate = { path: 'src/content/log/2026-09-01-duplicate.svx', content: log('2026-09-01', 'Another title', false) };
	input.blobs.push(duplicate);
	input.tree.push({ path: duplicate.path, mode: '100644', oid: '' });
	seal(input);
	await refused(input);
});

for (const body of [
	'<script>throw new Error("unsafe")</script>',
	'<script context="module">export const extra = 1;</script>',
	'<style>p { display: none; }</style><p>Hidden prose</p>',
	'<svelte:options runes={true} /><p>Changed parser options</p>',
	'<p onclick="alert(1)">Unsafe content</p>',
	'<p>{1 + 1}</p>',
	'{#if true}<p>Conditional prose</p>{/if}',
	'<a href="https://greatfallstoolbus.org/">A link</a>',
	'{@html "<p>Unsafe content</p>"}',
	'<p>Write to person&#64;example.invalid today.</p>',
	'<p>Read TIN-1234 for the private work.</p>',
]) {
	test(`refuses executable or identifying candidate fixture ${sha(body).slice(0, 8)}`, async () => {
		const input = await fixture();
		replaceCandidate(input, log('2026-09-09', 'A useful title', false, body));
		await refused(input);
	});
}

for (const failure of ['unknown key', 'prototype key', 'invalid date', 'date path mismatch', 'no TODO', 'published candidate', 'malformed image group']) {
	test(`the real site schema and source contract refuse ${failure}`, async () => {
		const input = await fixture();
		let content = input.candidate.content;
		if (failure === 'unknown key') content = content.replace('published: false', 'published: false\nprivate: hidden');
		if (failure === 'prototype key') content = content.replace('published: false', 'published: false\n__proto__: hidden');
		if (failure === 'invalid date') content = content.replace('2026-09-09', '2026-02-30');
		if (failure === 'date path mismatch') content = content.replace('2026-09-09', '2026-09-08');
		if (failure === 'no TODO') content = content.replace('TODO(jess)', 'Review');
		if (failure === 'published candidate') content = content.replace('published: false', 'published: true');
		if (failure === 'malformed image group') content = content.replace('published: false', "published: false\nimage: '/photos/update.png'");
		replaceCandidate(input, content);
		await refused(input);
	});
}

test('a published image must resolve to a regular asset in the complete source tree', async () => {
	const input = await fixture();
	const existing = input.blobs.find((blob) => blob.path === older);
	existing.content = existing.content.replace('published: true', "published: true\nimage: '/photos/update.png'\nimage_alt: 'Tools on the workbench'");
	seal(input);
	await refused(input);
});

test('real mdsvex and Svelte preserve escaped literal prose and quoted scalar tags', async () => {
	const input = await fixture();
	const content = log('2026-09-09', 'A useful title', false, '<p>&lt;script&gt;literal&lt;/script&gt; &#123;notAnExpression&#125;</p>')
		.replace("  - 'tools'", "  - 'true'\n  - 'null'\n  - '123'");
	replaceCandidate(input, content);
	assert.equal((await prepareDraftProjection(input)).files[0].content, content);
	replaceCandidate(input, content.replace("  - 'true'", '  - true'));
	await refused(input);
});
