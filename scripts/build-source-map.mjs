// `just source-map-build` maps src/routes/**/+page.svelte and published src/content/log/*.svx
// posts to their source. Exclude drafts because even a /log/<slug> link reveals the slug.
// src/lib/components/SourceLink.svelte reads the map. tinyland.repo.json or package.json
// supplies the repository. `//:source_map_drift_test` checks the sorted output with
// `--check`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readLogEntries } from './lib/log-content.mjs';
import { renderSourceMap, resolveSourceRepository } from './lib/log-projection.mjs';
import { generatedFileCheckMode, writeOrCheckGeneratedFile } from './lib/generated-file.mjs';

// `bazel run //:*_write` (tools/bazel/in_workspace.mjs) names the checkout;
// the read-only drift test and a direct run use this file's own tree.
const ROOT = process.env.GFTB_WORKSPACE_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const LOG_DIR = path.join(ROOT, 'src', 'content', 'log');
const OUT_FILE = path.join(ROOT, 'src', 'lib', 'generated', 'source-map.json');

// Pages left out of the source map, so they carry no "Edit this page" link:
// /join (operator rulings 2026-10-03). Since the operator ruling of 2026-11-14
// /join is indexed and in the sitemap, but it still carries no edit link.
const UNLISTED_PAGES = new Set(['src/routes/join/+page.svelte']);

const CHECK_ONLY = generatedFileCheckMode(process.argv.slice(2));

async function readJson(file) {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8'));
	} catch {
		return null;
	}
}

async function walkPageFiles(dir) {
	const out = [];
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await walkPageFiles(full)));
		} else if (entry.name === '+page.svelte') {
			out.push(full);
		}
	}
	return out;
}

async function main() {
	const repository = resolveSourceRepository(
		await readJson(path.join(ROOT, 'tinyland.repo.json')),
		await readJson(path.join(ROOT, 'package.json')),
	);
	const pageFiles = await walkPageFiles(ROUTES_DIR);
	const relativePages = pageFiles
		.map((full) => path.relative(ROOT, full).split(path.sep).join('/'))
		.filter((page) => !UNLISTED_PAGES.has(page));
	const content = renderSourceMap(repository, relativePages, readLogEntries(LOG_DIR));

	await writeOrCheckGeneratedFile(OUT_FILE, content, {
		check: CHECK_ONLY,
		label: 'source-map-check',
	});

	console.log(
		`source-map-build: mapped ${Object.keys(JSON.parse(content).routes).length} route(s) -> src/lib/generated/source-map.json`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
