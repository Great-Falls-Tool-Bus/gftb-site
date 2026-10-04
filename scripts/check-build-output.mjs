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
 *
 * B1 regression gate (PR #33 review): every `published: false` entry's
 * title and summary (scripts/lib/log-content.mjs) is ALWAYS folded into the
 * denylist too, unconditionally — not opt-in like GFTB_LEAK_SCAN_DENY. The
 * review proved a draft's full prose shipping in build/_app/immutable/
 * chunks; the fix (src/lib/generated/log-manifest.ts, B1) should make that
 * structurally impossible, but this makes it a build-breaking finding, not
 * an assumption, on the exact artefact `just build` and `just
 * leak-scan-stamped` scan. In `--copy-to <output>` mode it copies the input
 * TreeArtifact, scans the copy, and exposes that declared directory only when
 * the scan succeeds; //:deployment_bundle consumes that fail-closed boundary.
 */

import { cpSync, existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { readTailnetProbeUrl } from './bazel/build-metadata.mjs';
import { readLogEntries, distinctiveDraftLiterals } from './lib/log-content.mjs';
import { readGoalEntries, distinctiveDraftGoalLiterals } from './lib/goals-content.mjs';
import { readHoursEntries, distinctiveDraftHoursLiterals } from './lib/hours-content.mjs';
import {
	LEAK_RULES,
	REPO_ROOT,
	UnclassifiedOutputError,
	scanBuildDirectory,
	tailnetProbeHost,
} from './lib/leak-scan.mjs';

const options = parseOptions(process.argv.slice(2));
const buildDirectory = path.resolve(process.cwd(), options.buildDirectory);

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

let scanDirectory = buildDirectory;
if (options.copyTo !== null) {
	if (!/^[a-z0-9][a-z0-9-]*$/u.test(options.copyTo)) {
		console.error('leak-scan: --copy-to must name one relative action-output directory');
		process.exit(2);
	}
	const outputDirectory = path.resolve(process.cwd(), options.copyTo);
	if (outputDirectory === buildDirectory) {
		console.error(`leak-scan: refusing existing or aliased action output: ${outputDirectory}`);
		process.exit(2);
	}
	if (existsSync(outputDirectory)) {
		const outputStats = lstatSync(outputDirectory);
		if (outputStats.isSymbolicLink() || !outputStats.isDirectory() || readdirSync(outputDirectory).length > 0) {
			console.error(`leak-scan: refusing existing or aliased action output: ${outputDirectory}`);
			process.exit(2);
		}
	}
	cpSync(buildDirectory, outputDirectory, {
		recursive: true,
		dereference: true,
		errorOnExist: true,
		force: false,
	});
	scanDirectory = outputDirectory;
}

const operatorDeniedLiterals = (process.env.GFTB_LEAK_SCAN_DENY ?? '')
	.split(',')
	.map((literal) => literal.trim())
	.filter(Boolean);

const draftLogEntries = readLogEntries(path.join(REPO_ROOT, 'src', 'content', 'log'));
const draftDeniedLiterals = distinctiveDraftLiterals(draftLogEntries);
const draftGoalEntries = readGoalEntries(path.join(REPO_ROOT, 'src', 'content', 'goals'));
const draftGoalDeniedLiterals = distinctiveDraftGoalLiterals(draftGoalEntries);
// Unpublished hours files contribute only their notes of 20 characters or
// more: staff names, times and "the bus" already render in the FAQ.
const draftHoursEntries = readHoursEntries(path.join(REPO_ROOT, 'src', 'content', 'hours'));
const draftHoursDeniedLiterals = distinctiveDraftHoursLiterals(draftHoursEntries);

const deniedLiterals = [
	...operatorDeniedLiterals,
	...draftDeniedLiterals,
	...draftGoalDeniedLiterals,
	...draftHoursDeniedLiterals,
];

// The one tailnet probe host the build was stamped with, if any. Inside Bazel
// it comes from the same stable status the build read
// (scripts/bazel/workspace-status.sh); a direct `just leak-scan` reads the
// caller's PUBLIC_TAILNET_PROBE_URL. Unset means no allowance at all.
let allowedTailnetProbeHost;
const tailnetProbe = readTailnetProbeUrl();
try {
	allowedTailnetProbeHost = tailnetProbeHost(tailnetProbe.url);
} catch (error) {
	console.error(`leak-scan: ${error instanceof Error ? error.message : 'invalid tailnet probe URL'}`);
	process.exit(2);
}

let report;
try {
	report = scanBuildDirectory(scanDirectory, { deniedLiterals, allowedTailnetProbeHost });
} catch (error) {
	if (error instanceof UnclassifiedOutputError) {
		console.error(error.message);
		process.exit(2);
	}
	throw error;
}

const { files, findings } = report;

if (files.length === 0) {
	console.error(`leak-scan: ${scanDirectory} contains no scannable text output.`);
	process.exit(2);
}

if (findings.length > 0) {
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`);
	}
	console.error(`leak-scan: ${findings.length} finding(s) in ${files.length} published file(s)`);
	if (
		tailnetProbe.source === 'environment' &&
		findings.some((finding) => finding.ruleId === 'internal-hostname' && /\.ts\.net\b/iu.test(finding.excerpt))
	) {
		// A direct `just leak-scan` reads the caller's variable, while the tree
		// may have been built with a different stamped value.
		console.error(
			"leak-scan: a tailnet name was found outside the allowance read from this shell's " +
				'PUBLIC_TAILNET_PROBE_URL; if the tree was built with a different value, rerun with the ' +
				'value it was built with, or use //:scanned_build, which reads the stamp itself.',
		);
	}
	process.exit(1);
}

const denyNote =
	operatorDeniedLiterals.length > 0
		? `${operatorDeniedLiterals.length} operator-supplied literal(s)`
		: 'no operator-supplied literals (set GFTB_LEAK_SCAN_DENY to add real private names)';
console.log(
	`leak-scan: clean across ${files.length} published file(s) in ${path.relative(REPO_ROOT, scanDirectory)} ` +
		`using ${LEAK_RULES.length} rules, host and mailbox allowlists, ${denyNote}, and ` +
		`${draftDeniedLiterals.length} unpublished-draft literal(s) from ${draftLogEntries.length} content/log entr` +
		`${draftLogEntries.length === 1 ? 'y' : 'ies'} plus ${draftGoalDeniedLiterals.length} from ${draftGoalEntries.length} content/goals entr` +
		`${draftGoalEntries.length === 1 ? 'y' : 'ies'} plus ${draftHoursDeniedLiterals.length} from ${draftHoursEntries.length} content/hours entr` +
		`${draftHoursEntries.length === 1 ? 'y' : 'ies'} (B1 regression gate)` +
		(allowedTailnetProbeHost ? ', with the one stamped tailnet probe host allowed' : ''),
);

function parseOptions(args) {
	let buildDirectoryArgument = 'build';
	let copyTo = null;
	let index = 0;
	if (args[0] && !args[0].startsWith('--')) {
		buildDirectoryArgument = args[0];
		index = 1;
	}
	while (index < args.length) {
		if (args[index] !== '--copy-to' || !args[index + 1]) {
			throw new Error(`unsupported leak-scan argument: ${args[index] ?? ''}`);
		}
		if (copyTo !== null) throw new Error('--copy-to may be supplied only once');
		copyTo = args[index + 1];
		index += 2;
	}
	return { buildDirectory: buildDirectoryArgument, copyTo };
}
