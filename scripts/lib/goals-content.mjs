/**
 * Node-only reader for `src/content/goals/*.md` (the home page's near-term
 * goals, help asks, and member benefits). Same posture as log-content.mjs:
 * plain `node:fs`, never Vite's module graph, so an unpublished entry has no
 * path into the client bundle. The frontmatter parser is the log one.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { parseLogFrontmatter } from './log-content.mjs';

/**
 * @typedef {object} GoalEntry
 * @property {string} file
 * @property {string} slug
 * @property {string} sourcePath
 * @property {Record<string, unknown>} metadata
 * @property {string} text
 */

/**
 * @param {string} contentDir
 * @returns {GoalEntry[]}
 */
export function readGoalEntries(contentDir) {
	return readdirSync(contentDir)
		.filter((file) => file.endsWith('.md'))
		.sort()
		.map((file) => {
			const raw = readFileSync(path.join(contentDir, file), 'utf8');
			const { metadata, body } = parseLogFrontmatter(raw, file);
			return {
				file,
				slug: file.replace(/\.md$/u, ''),
				sourcePath: `src/content/goals/${file}`,
				metadata,
				text: body
					.replace(/<!--[\s\S]*?-->/gu, '')
					.replace(/\s+/gu, ' ')
					.trim(),
			};
		});
}

const MIN_LITERAL_LENGTH = 20;

/**
 * Distinctive strings from every `published: false` goal entry, folded into
 * the build-output leak denylist exactly like draft log entries.
 *
 * @param {GoalEntry[]} entries
 * @returns {string[]}
 */
export function distinctiveDraftGoalLiterals(entries) {
	/** @type {string[]} */
	const literals = [];
	for (const entry of entries) {
		if (entry.metadata.published !== false) continue;
		// The title IS the whole public copy for help and benefit rows, so it
		// joins the denylist whenever present, like draft log titles do; the
		// length floor applies only to free prose.
		if (typeof entry.metadata.title === 'string' && entry.metadata.title.length > 0) {
			literals.push(entry.metadata.title);
		}
		if (entry.text.length >= MIN_LITERAL_LENGTH) literals.push(entry.text);
		// Draft featured-image alt/caption copy joins the denylist under the
		// same length floor, mirroring distinctiveDraftLiterals for logs.
		for (const key of ['image_alt', 'image_caption']) {
			const value = entry.metadata[key];
			if (typeof value === 'string' && value.length >= MIN_LITERAL_LENGTH) literals.push(value);
		}
	}
	return literals;
}
