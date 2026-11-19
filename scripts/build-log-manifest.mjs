// `just log-manifest-build` reads src/content/log/*.svx through scripts/lib/log-content.mjs
// outside Vite's module graph. src/lib/generated/log-manifest.ts imports only entries with
// `published: true`. An eager `import.meta.glob` would bundle draft prose before a runtime
// filter could remove it. See
// https://github.com/Great-Falls-Tool-Bus/gftb-site/pull/33#issuecomment-5364998251.
// `//:log_manifest_drift_test` checks the generated file with `--check`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from 'prettier';

import { assertFeaturedImageFrontmatter, assertPublishedImageAsset } from './lib/featured-image.mjs';
import { generatedFileCheckMode, writeOrCheckGeneratedFile } from './lib/generated-file.mjs';
import { readLogEntries } from './lib/log-content.mjs';
import { renderLogManifest } from './lib/log-projection.mjs';

// `bazel run //:*_write` (tools/bazel/in_workspace.mjs) names the checkout;
// the read-only drift test and a direct run use this file's own tree.
const ROOT = process.env.GFTB_WORKSPACE_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
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
