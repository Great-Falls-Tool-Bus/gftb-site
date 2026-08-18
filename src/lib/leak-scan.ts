/**
 * Leak scanner for anything this repository publishes.
 *
 * The acceptance row is "no private endpoints, secrets, internal hostnames,
 * kubeconfig fragments, or private personal names appear in the built output".
 * The rules live in `leak-scan-rules.json` so the vitest suite (which proves the
 * rules actually fire) and `scripts/check-build-output.mjs` (which runs them
 * over `build/` in `just leak-scan`) cannot drift apart.
 *
 * Two positive checks complement the pattern rules, because a denylist alone
 * cannot prove absence: every outbound host and every mailbox in the output
 * must appear on a reviewed allowlist.
 */

import rulesDocument from './leak-scan-rules.json';

export interface LeakRule {
	id: string;
	description: string;
	pattern: string;
	flags: string;
}

export interface LeakFinding {
	file: string;
	ruleId: string;
	description: string;
	line: number;
	excerpt: string;
}

export interface ScanFile {
	path: string;
	text: string;
}

export interface ScanOptions {
	/**
	 * Extra literal strings that must never appear — real private names, private
	 * hostnames, or member identifiers an operator does not want committed to a
	 * repository that is intended to become public. Supplied at run time, never
	 * checked in.
	 */
	deniedLiterals?: string[];
	allowedHosts?: string[];
	allowedMailboxes?: string[];
}

export const LEAK_RULES: LeakRule[] = rulesDocument.rules;
export const ALLOWED_HOSTS: string[] = rulesDocument.allowedHosts;
export const ALLOWED_MAILBOXES: string[] = rulesDocument.allowedMailboxes;

/** The one personal-name form the bus host consented to publish. */
export const PERMITTED_HOST_INITIAL = 'J.';

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+)/giu;
const MAILBOX_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu;

function lineOf(text: string, index: number): number {
	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (text.charCodeAt(cursor) === 10) line += 1;
	}
	return line;
}

/** Redacted, bounded context so a finding is actionable without echoing a secret. */
function excerptAt(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 24);
	const end = Math.min(text.length, index + length + 24);
	return text
		.slice(start, end)
		.replace(text.slice(index, index + length), '<<redacted>>')
		.replace(/\s+/gu, ' ')
		.trim();
}

function compile(rule: LeakRule): RegExp {
	const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
	return new RegExp(rule.pattern, flags);
}

export function scanText(file: string, text: string, options: ScanOptions = {}): LeakFinding[] {
	const findings: LeakFinding[] = [];

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
		let index = text.toLowerCase().indexOf(needle.toLowerCase());
		while (index !== -1) {
			findings.push({
				file,
				ruleId: 'operator-denied-literal',
				description: 'operator-supplied literal that must not be published',
				line: lineOf(text, index),
				excerpt: excerptAt(text, index, needle.length),
			});
			index = text.toLowerCase().indexOf(needle.toLowerCase(), index + needle.length);
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

export function scanFiles(files: ScanFile[], options: ScanOptions = {}): LeakFinding[] {
	return files.flatMap((file) => scanText(file.path, file.text, options));
}

export function formatFindings(findings: LeakFinding[]): string {
	if (findings.length === 0) return 'leak-scan: no findings';
	return findings
		.map(
			(finding) => `${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}`,
		)
		.join('\n');
}
