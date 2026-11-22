/**
 * Read `src/content/goals/*.md` through `node:fs` and reuse the log-content.mjs frontmatter
 * parser. Keeping unpublished entries outside Vite's import graph protects draft content.
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
		// Help and benefit rows use the title as their entire public copy. Include every draft
		// title in the denylist. Only free prose has a length floor.
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
