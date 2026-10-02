// `just hours-manifest-build`: derive src/lib/generated/hours-manifest.ts
// from src/content/hours/*.json, PUBLISHED entries only, the goals-manifest
// pattern (scripts/build-goals-manifest.mjs) applied to the staffed work
// sessions on the bus. The internal `source` provenance key is dropped here so
// it never reaches the bundle, and the generator never reads the clock: dates
// expand on the visitor's clock (src/lib/hours-recurrence.ts), never at build
// time (operator interview 2026-10-02).
// `//:hours_manifest_drift_test` runs this generator read-only with `--check`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { generatedFileCheckMode, writeOrCheckGeneratedFile } from './lib/generated-file.mjs';
import { readHoursEntries, renderHoursManifestSource } from './lib/hours-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOURS_DIR = path.join(ROOT, 'src', 'content', 'hours');
const OUT_FILE = path.join(ROOT, 'src', 'lib', 'generated', 'hours-manifest.ts');
const CHECK_ONLY = generatedFileCheckMode(process.argv.slice(2));

async function main() {
	const entries = readHoursEntries(HOURS_DIR);
	const published = entries.filter((entry) => entry.data.published === true);
	const content = renderHoursManifestSource(entries);
	const prettierOptions = (await resolveConfig(OUT_FILE)) ?? {};
	const formatted = await format(content, { ...prettierOptions, filepath: OUT_FILE });
	await writeOrCheckGeneratedFile(OUT_FILE, formatted, {
		check: CHECK_ONLY,
		label: 'hours-manifest-check',
	});
	console.log(
		`hours-manifest-build: ${published.length} published of ${entries.length} hours entr${entries.length === 1 ? 'y' : 'ies'} -> src/lib/generated/hours-manifest.ts`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
