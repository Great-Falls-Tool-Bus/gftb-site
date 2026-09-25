/** An isolated Bazel consumer: only the linked package and this fixture are data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { assertVerifiedSiteDraftCandidate, prepareDraftProjection, SiteDraftRefusal } from '@gftb/site-draft-compiler';
import { object, seal, semanticSources } from './fixtures.mjs';

const entry = import.meta.resolve('@gftb/site-draft-compiler');
const runtime = new URL('../../', entry);
const source = new URL('source/', runtime);
const packageMetadata = JSON.parse(readFileSync(new URL('package.json', runtime), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = 'src/lib/generated/log-manifest.ts';
const sourceMap = 'src/lib/generated/source-map.json';

// Fixtures use the installed package's renderers, with no checkout files or
// separately supplied Prettier dependency. The actual operation enters through
// the package's public bare import above.
const { renderLogManifest, renderSourceMap } = await import(new URL('scripts/lib/log-projection.mjs', runtime));

async function fixture() {
	const formatText = readFileSync(new URL('.prettierrc', source), 'utf8');
	const format = JSON.parse(formatText);
	format.plugins = format.plugins.map((name) => createRequire(entry).resolve(name));
	const repo = { repoUrl: 'https://github.com/Great-Falls-Tool-Bus/gftb-site', branch: 'main' };
	const bodies = new Map([
		['.prettierrc', formatText],
		['package.json', readFileSync(new URL('package.json', source), 'utf8')],
		[
			'tinyland.repo.json',
			JSON.stringify({ repo: { github: 'Great-Falls-Tool-Bus/gftb-site', defaultBranch: 'main' } }),
		],
		[manifest, await renderLogManifest([], format)],
		[sourceMap, renderSourceMap(repo, ['src/routes/+page.svelte'], [])],
	]);
	const content = `---
date: '2026-09-09'
title: 'Tools ready for use'
summary: 'We sorted the hand tools and repaired the workbench.'
tags:
  - 'tools'
published: false
---

<!-- TODO(jess): Review before publication. -->

<p>We sorted the hand tools and repaired the workbench.</p>
`;
	return seal({
		repository: 'Great-Falls-Tool-Bus/gftb-site',
		repositoryId: '12345',
		baseSha: 'a'.repeat(40),
		baseTreeSha: '',
		tree: [...bodies]
			.map(([path]) => ({ path, mode: '100644', oid: '' }))
			.concat([
				...semanticSources
					.filter((path) => !bodies.has(path))
					.map((path) => ({
						path,
						mode: '100644',
						oid: object('blob', readFileSync(new URL(path, source))),
					})),
				{ path: 'src/routes/+page.svelte', mode: '100644', oid: object('blob', Buffer.from('<h1>Home</h1>')) },
			]),
		blobs: [...bodies].map(([path, content]) => ({ path, content })),
		candidate: { path: 'src/content/log/2026-09-09-tools-ready.svx', content, sha256: sha(content) },
	});
}

test('the isolated consumer imports the package without ambient runtime dependencies', () => {
	assert.equal(packageMetadata.name, '@gftb/site-draft-compiler');
	assert.equal(packageMetadata.version, '0.3.0');
	assert.equal(packageMetadata.private, true);
	assert.equal(packageMetadata.exports['.'].import, './tools/site-draft-compiler/compiler.js');
	assert.ok(existsSync(new URL(packageMetadata.exports['.'].types, runtime)));
	assert.equal(existsSync(new URL('src/routes/', runtime)), false);
	assert.equal(existsSync(new URL('src/content/', runtime)), false);
	for (const dependency of Object.keys(packageMetadata.dependencies)) {
		assert.throws(() => import.meta.resolve(dependency), { code: 'ERR_MODULE_NOT_FOUND' });
	}
});

test('the linked package compiles with its own runtime closure and records separate source and runtime bytes', async () => {
	const input = await fixture();
	const result = await prepareDraftProjection(input);
	assertVerifiedSiteDraftCandidate(result);
	assert.equal(result.files.length, 3);
	assert.equal(result.files[0].content, input.candidate.content);
	assert.equal(result.files[0].previousBlobSha, null);
	assert.equal(result.files[1].content, input.blobs.find((blob) => blob.path === manifest).content);
	assert.equal(result.files[2].content, input.blobs.find((blob) => blob.path === sourceMap).content);
	assert.notEqual(result.prospectiveTreeSha, input.baseTreeSha);
	assert.throws(() => assertVerifiedSiteDraftCandidate({ ...result }), SiteDraftRefusal);
	for (const path of semanticSources) {
		assert.equal(result.toolInputs.find((item) => item.path === path).sha256, sha(readFileSync(new URL(path, source))));
	}
	for (const path of ['package.json', 'scripts/lib/log-projection.mjs', 'src/lib/public-log-schema.js']) {
		assert.equal(
			result.toolInputs.find((item) => item.path === `runtime/${path}`).sha256,
			sha(readFileSync(new URL(path, runtime))),
		);
	}
	const originalSchema = readFileSync(new URL('src/lib/public-log-schema.ts', source));
	const emittedSchema = readFileSync(new URL('src/lib/public-log-schema.js', runtime));
	assert.notEqual(sha(originalSchema), sha(emittedSchema));
});

test('the package still refuses a changed canonical schema with a valid replacement tree hash', async () => {
	const input = await fixture();
	input.tree.find((leaf) => leaf.path === 'src/lib/public-log-schema.ts').oid = object('blob', Buffer.from('changed'));
	seal(input);
	await assert.rejects(prepareDraftProjection(input), SiteDraftRefusal);
});
