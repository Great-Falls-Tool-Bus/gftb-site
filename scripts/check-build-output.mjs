#!/usr/bin/env node
/**
 * `just leak-scan` — run the shared leak rules over a built static artefact.
 *
 * The rule text comes from src/lib/leak-scan-rules.json, the same document the
 * vitest suite exercises, so the gate and its tests cannot drift. This script
 * deliberately fails loudly when the build directory is absent: a leak scan
 * that quietly passes because there was nothing to scan is worse than no scan.
 *
 * Operator-supplied literals (real private names, private hostnames) can be
 * passed through GFTB_LEAK_SCAN_DENY as a comma-separated list. They are never
 * committed. The script reports whether it ran with or without that list.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulesPath = path.join(repoRoot, 'src/lib/leak-scan-rules.json');
const rulesDocument = JSON.parse(readFileSync(rulesPath, 'utf8'));

const PERMITTED_HOST_INITIAL = 'J.';
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.map', '']);
const SKIP_EXTENSIONS = new Set(['.br', '.gz', '.woff', '.woff2', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.ico']);

function collectFiles(root) {
	const found = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory)) {
			const absolute = path.join(directory, entry);
			if (statSync(absolute).isDirectory()) {
				walk(absolute);
				continue;
			}
			const extension = path.extname(absolute).toLowerCase();
			if (SKIP_EXTENSIONS.has(extension)) continue;
			if (!TEXT_EXTENSIONS.has(extension)) continue;
			found.push(absolute);
		}
	};
	walk(root);
	return found.sort();
}

function lineOf(text, index) {
	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (text.charCodeAt(cursor) === 10) line += 1;
	}
	return line;
}

function excerptAt(text, index, length) {
	const start = Math.max(0, index - 24);
	const end = Math.min(text.length, index + length + 24);
	return text
		.slice(start, end)
		.replace(text.slice(index, index + length), '<<redacted>>')
		.replace(/\s+/gu, ' ')
		.trim();
}

function scanText(file, text, options) {
	const findings = [];
	const push = (ruleId, description, index, length) =>
		findings.push({ file, ruleId, description, line: lineOf(text, index), excerpt: excerptAt(text, index, length) });

	for (const rule of rulesDocument.rules) {
		const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
		for (const match of text.matchAll(new RegExp(rule.pattern, flags))) {
			if (match.index === undefined) continue;
			if (rule.id === 'private-personal-name' && match[0].trim() === PERMITTED_HOST_INITIAL) continue;
			push(rule.id, rule.description, match.index, match[0].length);
		}
	}

	for (const literal of options.deniedLiterals) {
		const haystack = text.toLowerCase();
		const needle = literal.toLowerCase();
		let index = haystack.indexOf(needle);
		while (index !== -1) {
			push('operator-denied-literal', 'operator-supplied literal that must not be published', index, needle.length);
			index = haystack.indexOf(needle, index + needle.length);
		}
	}

	const allowedHosts = new Set(rulesDocument.allowedHosts);
	for (const match of text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/giu)) {
		const host = match[1].toLowerCase().replace(/\.$/u, '');
		if (allowedHosts.has(host)) continue;
		push(
			'unreviewed-outbound-host',
			`outbound host ${host} is not on the reviewed public allowlist`,
			match.index,
			match[0].length,
		);
	}

	const allowedMailboxes = new Set(rulesDocument.allowedMailboxes.map((box) => box.toLowerCase()));
	for (const match of text.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu)) {
		if (allowedMailboxes.has(match[0].toLowerCase())) continue;
		push(
			'unreviewed-mailbox',
			`mailbox ${match[0]} is not one of the reviewed public list addresses`,
			match.index,
			match[0].length,
		);
	}

	return findings;
}

const buildDirectory = path.resolve(repoRoot, process.argv[2] ?? 'build');
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

const files = collectFiles(buildDirectory);
if (files.length === 0) {
	console.error(`leak-scan: ${buildDirectory} contains no scannable text output.`);
	process.exit(2);
}

const findings = files.flatMap((absolute) =>
	scanText(path.relative(repoRoot, absolute), readFileSync(absolute, 'utf8'), { deniedLiterals }),
);

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
	`leak-scan: clean across ${files.length} published file(s) in ${path.relative(repoRoot, buildDirectory)} ` +
		`using ${rulesDocument.rules.length} rules, host and mailbox allowlists, and ${denyNote}`,
);
