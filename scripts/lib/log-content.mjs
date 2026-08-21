/**
 * Shared, Node-only reader for `src/content/log/*.svx` frontmatter (B1 fix,
 * PR #33 review comment https://github.com/Great-Falls-Tool-Bus/gftb-site/pull/33#issuecomment-5364998251).
 *
 * This module reads the content tree with plain `node:fs` — it never goes
 * through Vite's module graph (`import.meta.glob`) — so calling it can never
 * cause an unpublished draft's prose or metadata to become an import that a
 * bundler could ship to a visitor. It backs two build-time-only consumers:
 *
 *  - scripts/build-log-manifest.mjs, which generates the checked-in
 *    src/lib/generated/log-manifest.ts (published entries ONLY — the file
 *    src/lib/public-logs.ts imports, and therefore the only place log
 *    content can reach the client bundle from).
 *  - scripts/check-build-output.mjs, which folds every unpublished draft's
 *    distinctive text into the leak-scan denylist so a real `build/`
 *    directory is proven clean, the same way `just leak-scan-stamped`
 *    proves the stamped-footer regression stays fixed.
 *
 * The frontmatter subset understood here matches the one
 * src/lib/public-log-build-contract.test.ts asserts against the real schema
 * (src/lib/public-log-schema.ts): top-level scalars, inline arrays, and
 * block sequences. Anything richer throws rather than being guessed at.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} LogEntry
 * @property {string} file
 * @property {string} slug
 * @property {string} sourcePath
 * @property {Record<string, unknown>} metadata
 * @property {string} body
 */

/** @param {string} value */
const unquote = (value) => value.trim().replace(/^['"]|['"]$/gu, '');

/**
 * @param {string} raw
 * @param {string} source
 * @returns {{ metadata: Record<string, unknown>, body: string }}
 */
export function parseLogFrontmatter(raw, source) {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(raw);
	if (!match) throw new Error(`${source}: no frontmatter block`);
	const [, block, rest] = match;

	/** @type {Record<string, unknown>} */
	const metadata = {};
	/** @type {string | null} */
	let sequenceKey = null;

	for (const line of block.split('\n')) {
		if (line.trim() === '') continue;

		const sequenceItem = /^\s+-\s+(.*)$/u.exec(line);
		if (sequenceItem) {
			if (!sequenceKey) throw new Error(`${source}: sequence item outside a key: ${line}`);
			/** @type {string[]} */ (metadata[sequenceKey]).push(unquote(sequenceItem[1]));
			continue;
		}

		const kv = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
		if (!kv) throw new Error(`${source}: unsupported frontmatter line: ${line}`);
		const [, key, rawValue] = kv;
		const value = rawValue.trim();
		sequenceKey = null;

		if (value === '') {
			sequenceKey = key;
			metadata[key] = [];
		} else if (value === 'true' || value === 'false') {
			metadata[key] = value === 'true';
		} else if (value.startsWith('[') && value.endsWith(']')) {
			metadata[key] = value
				.slice(1, -1)
				.split(',')
				.map(unquote)
				.filter((entry) => entry.length > 0);
		} else {
			metadata[key] = unquote(value);
		}
	}

	return { metadata, body: rest.trim() };
}

/**
 * @param {string} contentDir
 * @returns {LogEntry[]}
 */
export function readLogEntries(contentDir) {
	return readdirSync(contentDir)
		.filter((file) => file.endsWith('.svx'))
		.sort()
		.map((file) => {
			const raw = readFileSync(path.join(contentDir, file), 'utf8');
			const { metadata, body } = parseLogFrontmatter(raw, file);
			return {
				file,
				slug: file.replace(/\.svx$/u, ''),
				sourcePath: `src/content/log/${file}`,
				metadata,
				body,
			};
		});
}

/**
 * Distinctive, unlikely-to-collide strings pulled from every `published:
 * false` entry's frontmatter — long enough that their presence in a build
 * artefact can only mean the draft's content reached the bundle, never a
 * coincidental match. Title and summary are both used because either alone
 * shipping (per the PR #33 review's grep proof, both did) is the defect.
 *
 * @param {LogEntry[]} entries
 * @returns {string[]}
 */
export function distinctiveDraftLiterals(entries) {
	/** @type {string[]} */
	const literals = [];
	for (const entry of entries) {
		if (entry.metadata.published !== false) continue;
		if (typeof entry.metadata.title === 'string' && entry.metadata.title.length > 0) {
			literals.push(entry.metadata.title);
		}
		if (typeof entry.metadata.summary === 'string' && entry.metadata.summary.length > 0) {
			literals.push(entry.metadata.summary);
		}
	}
	return literals;
}
