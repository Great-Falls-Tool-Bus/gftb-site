/**
 * Leak scanner for anything this repository publishes — the ONE implementation.
 *
 * The acceptance row is "no private endpoints, secrets, internal hostnames,
 * kubeconfig fragments, or private personal names appear in the built output".
 *
 * This module is plain ESM on purpose. `scripts/check-build-output.mjs` (the
 * gate `just leak-scan` runs, which now also runs as the last step of
 * `just build`) imports it directly with no transpile step, and
 * `src/lib/leak-scan.test.ts` imports the same file under vitest. There is no
 * second copy of the scanning logic to drift from, which is what an earlier
 * revision of this gate got wrong.
 *
 * It deliberately lives outside `src/lib`: `leak-scan-rules.json` carries
 * credential-detection regexes (ghp_, AKIA/ASIA, glpat-, JWT, kubeconfig
 * fragments) that must never be reachable from the SvelteKit library root and
 * therefore never reachable from a client bundle. An eslint
 * `no-restricted-imports` guard on `src/routes/**` plus a unit test enforce
 * that; the file location is the primary defence.
 *
 * Two positive checks complement the pattern rules, because a denylist alone
 * cannot prove absence: every outbound host and every mailbox in the output
 * must appear on a reviewed allowlist.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} LeakRule
 * @property {string} id
 * @property {string} description
 * @property {string} pattern
 * @property {string} flags
 *
 * @typedef {object} LeakFinding
 * @property {string} file
 * @property {string} ruleId
 * @property {string} description
 * @property {number} line
 * @property {string} excerpt
 *
 * @typedef {object} ScanFile
 * @property {string} path
 * @property {string} text
 *
 * @typedef {object} ScanOptions
 * @property {string[]} [deniedLiterals] Extra literal strings that must never
 *   appear — real private names, private hostnames, or member identifiers an
 *   operator does not want committed to a repository intended to become
 *   public. Supplied at run time, never checked in.
 * @property {string[]} [allowedHosts]
 * @property {string[]} [allowedMailboxes]
 */

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this module (scripts/lib/ -> repo root). */
export const REPO_ROOT = path.resolve(moduleDirectory, '../..');

export const RULES_PATH = path.join(moduleDirectory, 'leak-scan-rules.json');

const rulesDocument = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

/** @type {LeakRule[]} */
export const LEAK_RULES = rulesDocument.rules;
/** @type {string[]} */
export const ALLOWED_HOSTS = rulesDocument.allowedHosts;
/** @type {string[]} */
export const ALLOWED_MAILBOXES = rulesDocument.allowedMailboxes;

/** The one personal-name form the bus host consented to publish. */
export const PERMITTED_HOST_INITIAL = 'J.';

/**
 * Extensions whose bytes are scanned as UTF-8 text. `''` covers extensionless
 * published files such as `_headers`.
 */
export const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.map', '']);

/** Extensions that are knowingly opaque to a text scanner. */
export const SKIP_EXTENSIONS = new Set([
	'.br',
	'.gz',
	'.woff',
	'.woff2',
	'.jpg',
	'.jpeg',
	'.png',
	'.webp',
	'.avif',
	'.ico',
]);

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+)/giu;
const MAILBOX_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu;

/**
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function lineOf(text, index) {
	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (text.charCodeAt(cursor) === 10) line += 1;
	}
	return line;
}

/**
 * Redacted, bounded context so a finding is actionable without echoing a secret.
 *
 * @param {string} text
 * @param {number} index
 * @param {number} length
 * @returns {string}
 */
function excerptAt(text, index, length) {
	const start = Math.max(0, index - 24);
	const end = Math.min(text.length, index + length + 24);
	return text
		.slice(start, end)
		.replace(text.slice(index, index + length), '<<redacted>>')
		.replace(/\s+/gu, ' ')
		.trim();
}

/**
 * @param {LeakRule} rule
 * @returns {RegExp}
 */
function compile(rule) {
	const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
	return new RegExp(rule.pattern, flags);
}

/**
 * @param {string} file
 * @param {string} text
 * @param {ScanOptions} [options]
 * @returns {LeakFinding[]}
 */
export function scanText(file, text, options = {}) {
	/** @type {LeakFinding[]} */
	const findings = [];

	for (const rule of LEAK_RULES) {
		const pattern = compile(rule);
		for (const match of text.matchAll(pattern)) {
			if (match.index === undefined) continue;
			if (rule.id === 'private-personal-name' && match[0].trim() === PERMITTED_HOST_INITIAL) continue;
			findings.push({
				file,
				ruleId: rule.id,
				description: rule.description,
				line: lineOf(text, match.index),
				excerpt: excerptAt(text, match.index, match[0].length),
			});
		}
	}

	for (const literal of options.deniedLiterals ?? []) {
		const needle = literal.trim();
		if (!needle) continue;
		const haystack = text.toLowerCase();
		let index = haystack.indexOf(needle.toLowerCase());
		while (index !== -1) {
			findings.push({
				file,
				ruleId: 'operator-denied-literal',
				description: 'operator-supplied literal that must not be published',
				line: lineOf(text, index),
				excerpt: excerptAt(text, index, needle.length),
			});
			index = haystack.indexOf(needle.toLowerCase(), index + needle.length);
		}
	}

	const allowedHosts = new Set(options.allowedHosts ?? ALLOWED_HOSTS);
	URL_RE.lastIndex = 0;
	for (const match of text.matchAll(URL_RE)) {
		const host = match[1].toLowerCase().replace(/\.$/u, '');
		if (allowedHosts.has(host)) continue;
		findings.push({
			file,
			ruleId: 'unreviewed-outbound-host',
			description: `outbound host ${host} is not on the reviewed public allowlist`,
			line: lineOf(text, match.index ?? 0),
			excerpt: excerptAt(text, match.index ?? 0, match[0].length),
		});
	}

	const allowedMailboxes = new Set((options.allowedMailboxes ?? ALLOWED_MAILBOXES).map((box) => box.toLowerCase()));
	for (const match of text.matchAll(MAILBOX_RE)) {
		const mailbox = match[0].toLowerCase();
		if (allowedMailboxes.has(mailbox)) continue;
		findings.push({
			file,
			ruleId: 'unreviewed-mailbox',
			description: `mailbox ${mailbox} is not one of the reviewed public list addresses`,
			line: lineOf(text, match.index ?? 0),
			excerpt: excerptAt(text, match.index ?? 0, match[0].length),
		});
	}

	return findings.sort((left, right) => left.line - right.line || left.ruleId.localeCompare(right.ruleId));
}

/**
 * @param {ScanFile[]} files
 * @param {ScanOptions} [options]
 * @returns {LeakFinding[]}
 */
export function scanFiles(files, options = {}) {
	return files.flatMap((file) => scanText(file.path, file.text, options));
}

/**
 * @param {LeakFinding[]} findings
 * @returns {string}
 */
export function formatFindings(findings) {
	if (findings.length === 0) return 'leak-scan: no findings';
	return findings
		.map(
			(finding) => `${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`,
		)
		.join('\n');
}

/** Raised by {@link collectFiles} when the published tree contains a file type the scanner has no verdict for. */
export class UnclassifiedOutputError extends Error {
	/** @param {string[]} files */
	constructor(files) {
		super(
			`leak-scan: ${files.length} published file(s) have an extension that is in neither ` +
				`TEXT_EXTENSIONS nor SKIP_EXTENSIONS, so the scan cannot claim the output is clean:\n` +
				files.map((file) => `  ${file}`).join('\n') +
				`\nAdd each extension to TEXT_EXTENSIONS (it is UTF-8 and must be scanned) or to ` +
				`SKIP_EXTENSIONS (it is opaque binary) in scripts/lib/leak-scan.mjs, then re-run.`,
		);
		this.name = 'UnclassifiedOutputError';
		/** @type {string[]} */
		this.files = files;
	}
}

/**
 * Walks a published tree and returns the absolute paths of the files to scan.
 *
 * FAILS CLOSED: a file whose extension is in neither {@link TEXT_EXTENSIONS}
 * nor {@link SKIP_EXTENSIONS} throws {@link UnclassifiedOutputError} rather
 * than being silently dropped. A scanner whose whole purpose is proving the
 * absence of secrets must not report "clean" over output it never opened — a
 * future published `.webmanifest`, `.md`, `.csv`, `.ics` or `.wasm` is a
 * decision for a human, not a default.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function collectFiles(root) {
	/** @type {string[]} */
	const found = [];
	/** @type {string[]} */
	const unclassified = [];
	/** @param {string} directory */
	const walk = (directory) => {
		for (const entry of readdirSync(directory).sort()) {
			const absolute = path.join(directory, entry);
			if (statSync(absolute).isDirectory()) {
				walk(absolute);
				continue;
			}
			const extension = path.extname(absolute).toLowerCase();
			if (SKIP_EXTENSIONS.has(extension)) continue;
			if (TEXT_EXTENSIONS.has(extension)) {
				found.push(absolute);
				continue;
			}
			unclassified.push(path.relative(root, absolute));
		}
	};
	walk(root);
	if (unclassified.length > 0) throw new UnclassifiedOutputError(unclassified.sort());
	return found.sort();
}

/**
 * Scans a built directory. Returns the report the CLI prints; throws
 * {@link UnclassifiedOutputError} on an unknown file type.
 *
 * @param {string} buildDirectory absolute path to the published tree
 * @param {ScanOptions} [options]
 * @returns {{ files: string[]; findings: LeakFinding[] }}
 */
export function scanBuildDirectory(buildDirectory, options = {}) {
	const files = collectFiles(buildDirectory);
	const findings = files.flatMap((absolute) =>
		scanText(path.relative(REPO_ROOT, absolute), readFileSync(absolute, 'utf8'), options),
	);
	return { files, findings };
}
