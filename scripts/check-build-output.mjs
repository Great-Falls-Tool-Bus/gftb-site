#!/usr/bin/env node
/**
 * `just leak-scan` — run the shared leak rules over a built static artefact.
 *
 * This file is a THIN RUNNER. Every rule, every allowlist and the whole
 * walk/scan implementation live in scripts/lib/leak-scan.mjs, which is the same
 * module src/lib/leak-scan.test.ts imports under vitest. One implementation,
 * tested once: there is no second copy here to drift from the tested one.
 *
 * It deliberately fails loudly rather than quietly passing:
 *   exit 2 — the build directory is absent, is not a directory, or contains no
 *            scannable text output (a scan with nothing to scan is not a pass);
 *   exit 2 — the tree contains a file whose extension the scanner has no
 *            verdict for (fail-closed; see collectFiles);
 *   exit 1 — one or more findings.
 *
 * Operator-supplied literals (real private names, private hostnames) can be
 * passed through GFTB_LEAK_SCAN_DENY as a comma-separated list. They are never
 * committed. The script reports whether it ran with or without that list.
 */

import { statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { LEAK_RULES, REPO_ROOT, UnclassifiedOutputError, scanBuildDirectory } from './lib/leak-scan.mjs';

const buildDirectory = path.resolve(REPO_ROOT, process.argv[2] ?? 'build');

let stats;
try {
	stats = statSync(buildDirectory);
} catch {
	console.error(`leak-scan: ${buildDirectory} does not exist. Run \`just build\` before scanning.`);
	process.exit(2);
}
if (!stats.isDirectory()) {
	console.error(`leak-scan: ${buildDirectory} is not a directory.`);
	process.exit(2);
}

const deniedLiterals = (process.env.GFTB_LEAK_SCAN_DENY ?? '')
	.split(',')
	.map((literal) => literal.trim())
	.filter(Boolean);

let report;
try {
	report = scanBuildDirectory(buildDirectory, { deniedLiterals });
} catch (error) {
	if (error instanceof UnclassifiedOutputError) {
		console.error(error.message);
		process.exit(2);
	}
	throw error;
}

const { files, findings } = report;

if (files.length === 0) {
	console.error(`leak-scan: ${buildDirectory} contains no scannable text output.`);
	process.exit(2);
}

if (findings.length > 0) {
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`);
	}
	console.error(`leak-scan: ${findings.length} finding(s) in ${files.length} published file(s)`);
	process.exit(1);
}

const denyNote =
	deniedLiterals.length > 0
		? `${deniedLiterals.length} operator-supplied literal(s)`
		: 'no operator-supplied literals (set GFTB_LEAK_SCAN_DENY to add real private names)';
console.log(
	`leak-scan: clean across ${files.length} published file(s) in ${path.relative(REPO_ROOT, buildDirectory)} ` +
		`using ${LEAK_RULES.length} rules, host and mailbox allowlists, and ${denyNote}`,
);
