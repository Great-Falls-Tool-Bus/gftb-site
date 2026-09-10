// `just source-map-build` — derive the page source map from the routes tree.
//
// Ported from the demo site (greatfallstoolbus.org@origin/main
// scripts/build-source-map.mjs, operator commit #94) and extended for the
// public log (B1.2): in addition to every src/routes/**/+page.svelte, each
// PUBLISHED src/content/log/*.svx post is mapped at its /log/<slug>
// permalink, so the "Edit this page" affordance is wired PER POST.
//
// Unpublished drafts are excluded (B1 fix, PR #33 review): the review found
// draft slugs shipping here too (source-map.json is a build output, walked
// by leak-scan, and read by src/lib/components/SourceLink.svelte), which
// would advertise a draft's existence — and, at the `/log/<slug>` permalink
// it names — even though the draft itself never prerenders.
//
// Why derived, not per-page hand-links: the map is generated from
// architectural zero so a new page or post cannot silently lack the
// affordance, and NO org/repo string is hardcoded in any component (it flows
// from tinyland.repo.json / package.json).
//
// Output is deterministic (sorted route keys, tab-indented, trailing newline).
// `//:source_map_drift_test` runs this generator read-only with `--check`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readLogEntries } from './lib/log-content.mjs';
import { renderSourceMap, resolveSourceRepository } from './lib/log-projection.mjs';
import { generatedFileCheckMode, writeOrCheckGeneratedFile } from './lib/generated-file.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const LOG_DIR = path.join(ROOT, 'src', 'content', 'log');
const OUT_FILE = path.join(ROOT, 'src', 'lib', 'generated', 'source-map.json');

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
	const relativePages = pageFiles.map((full) => path.relative(ROOT, full).split(path.sep).join('/'));
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
