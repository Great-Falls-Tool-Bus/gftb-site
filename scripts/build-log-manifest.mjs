// `just log-manifest-build` — derive src/lib/generated/log-manifest.ts from
// src/content/log/*.svx.
//
// B1 fix (PR #33 review comment
// https://github.com/Great-Falls-Tool-Bus/gftb-site/pull/33#issuecomment-5364998251):
// the previous loader (src/lib/public-logs.ts) built its published/draft
// split at RUNTIME from an eager `import.meta.glob` over every entry, so
// every draft's full prose and metadata were static imports in the module
// graph and shipped to every visitor in build/_app/immutable/chunks/*
// regardless of the `published` filter, which only ran after the bytes were
// already bundled.
//
// This script moves the split to BUILD time and OUTSIDE Vite's module
// graph entirely (plain node:fs via scripts/lib/log-content.mjs, never
// import.meta.glob): it writes only entries with `published: true`, each as
// a literal `import('../../content/log/<slug>.svx')` call. An unpublished
// slug therefore never appears as an import specifier anywhere reachable
// from src/lib/public-logs.ts, so Vite/Rollup has no path by which it could
// bundle one — this is stronger than relying on tree-shaking an eager glob,
// which is what the review asked for when it said "gate at the glob pattern
// level instead, e.g. a generated include list".
//
// Output is deterministic (file order, tab-indented, trailing newline).
// `//:log_manifest_drift_test` runs this generator read-only with `--check`,
// mirroring scripts/build-source-map.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from 'prettier';

import {
	assertFeaturedImageFrontmatter,
	assertPublishedImageAsset,
} from './lib/featured-image.mjs';
import { generatedFileCheckMode, writeOrCheckGeneratedFile } from './lib/generated-file.mjs';
import { readLogEntries } from './lib/log-content.mjs';
import { renderLogManifest } from './lib/log-projection.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOG_DIR = path.join(ROOT, 'src', 'content', 'log');
const OUT_FILE = path.join(ROOT, 'src', 'lib', 'generated', 'log-manifest.ts');
const CHECK_ONLY = generatedFileCheckMode(process.argv.slice(2));

async function main() {
	const entries = readLogEntries(LOG_DIR);
	const published = entries.filter((entry) => entry.metadata.published === true);
	for (const entry of published) {
		// Fail closed BEFORE rendering: a malformed group or a published image
		// with no committed static/ asset breaks this build, and with it
		// `just log-manifest-check` inside `just check`. Drafts are exempt from
		// the asset check (their bytes wait in _assets-pending/, 5f11f40 rule).
		assertFeaturedImageFrontmatter(entry.metadata, entry.file);
		assertPublishedImageAsset(entry.metadata, entry.file, ROOT);
	}

	const prettierOptions = (await resolveConfig(OUT_FILE)) ?? {};
	const formattedContent = await renderLogManifest(entries, prettierOptions, OUT_FILE);

	await writeOrCheckGeneratedFile(OUT_FILE, formattedContent, {
		check: CHECK_ONLY,
		label: 'log-manifest-check',
	});

	console.log(
		`log-manifest-build: ${published.length} published of ${entries.length} log entr${entries.length === 1 ? 'y' : 'ies'} -> src/lib/generated/log-manifest.ts`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
