/**
 * Node-only reader for `src/content/hours/*.json` (staffed work-session
 * slots on the bus). Same posture as goals-content.mjs: plain `node:fs`,
 * never Vite's module graph, so an unpublished slot has no path into the
 * client bundle.
 *
 * The validator here mirrors src/lib/public-hours-schema.ts (the binding
 * contract, exercised by src/lib/public-hours-schema.test.ts over every
 * content file, which also proves the two refuse the same shapes). Nothing in
 * this module reads the wall clock: the manifest is a pure function of the
 * content files.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} HoursEntry
 * @property {string} file
 * @property {string} id
 * @property {string} sourcePath
 * @property {Record<string, unknown>} data
 */

/**
 * @param {string} contentDir
 * @returns {HoursEntry[]}
 */
export function readHoursEntries(contentDir) {
	return readdirSync(contentDir)
		.filter((file) => file.endsWith('.json'))
		.sort()
		.map((file) => {
			const raw = readFileSync(path.join(contentDir, file), 'utf8');
			/** @type {unknown} */
			let data;
			try {
				data = JSON.parse(raw);
			} catch (error) {
				throw new Error(`${file}: invalid JSON`, { cause: error });
			}
			if (!data || typeof data !== 'object' || Array.isArray(data)) {
				throw new Error(`${file}: hours entry must be an object`);
			}
			return {
				file,
				id: file.replace(/\.json$/u, ''),
				sourcePath: `src/content/hours/${file}`,
				data: /** @type {Record<string, unknown>} */ (data),
			};
		});
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const REQUIRED_KEYS = ['id', 'published', 'weekday', 'start', 'end', 'timezone', 'staff', 'repeat'];
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'skip', 'location', 'notes', 'source']);
const REPEAT_KEYS = new Set(['kind', 'startsOn', 'count', 'until']);
const CONSENTED_STAFF = new Set(['Jess']);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TRACKER_ID_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/u;
const DAY_MS = 86_400_000;

/** @param {unknown} value */
function isIsoDate(value) {
	if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** @param {string} iso */
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
/** @param {string} iso */
const weekdayIndex = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * @param {unknown} value
 * @param {string[]} out
 * @returns {string[]}
 */
function collectStrings(value, out) {
	if (typeof value === 'string') out.push(value);
	else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
	else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, out);
	return out;
}

/**
 * Fail-closed mirror of assertPublicHoursSlot. Throws on the first problem.
 *
 * @param {HoursEntry} entry
 */
export function assertHoursEntry(entry) {
	const m = entry.data;
	const where = entry.file;
	const unknown = Object.keys(m).filter((key) => !ALLOWED_KEYS.has(key));
	if (unknown.length > 0) throw new Error(`${where}: unsupported hours keys: ${unknown.join(', ')}`);
	const missing = REQUIRED_KEYS.filter((key) => !(key in m));
	if (missing.length > 0) throw new Error(`${where}: missing hours keys: ${missing.join(', ')}`);
	if (collectStrings(m, []).some((value) => value.includes('\u2014'))) {
		throw new Error(`${where}: no em dashes in hours content`);
	}
	if (typeof m.id !== 'string' || !ID_RE.test(m.id) || m.id !== entry.id) {
		throw new Error(`${where}: id must be kebab-case and equal the file stem`);
	}
	if (typeof m.published !== 'boolean') throw new Error(`${where}: published must be a boolean`);
	if (typeof m.weekday !== 'string' || !WEEKDAYS.includes(m.weekday)) throw new Error(`${where}: weekday invalid`);
	for (const key of ['start', 'end']) {
		const value = m[key];
		if (typeof value !== 'string' || !TIME_RE.test(value) || value < '06:00' || value > '23:00') {
			throw new Error(`${where}: ${key} must be HH:MM between 06:00 and 23:00`);
		}
	}
	if (String(m.end) <= String(m.start)) throw new Error(`${where}: end must be after start`);
	if (m.timezone !== 'America/New_York') throw new Error(`${where}: timezone must be America/New_York`);
	if (
		!Array.isArray(m.staff) ||
		m.staff.length > 3 ||
		m.staff.some((name) => typeof name !== 'string' || !CONSENTED_STAFF.has(name)) ||
		new Set(m.staff).size !== m.staff.length
	) {
		throw new Error(`${where}: staff must be 0 to 3 unique names from CONSENTED_STAFF`);
	}
	const repeat = m.repeat;
	if (!repeat || typeof repeat !== 'object' || Array.isArray(repeat)) throw new Error(`${where}: repeat invalid`);
	const r = /** @type {Record<string, unknown>} */ (repeat);
	if (Object.keys(r).some((key) => !REPEAT_KEYS.has(key))) throw new Error(`${where}: unsupported repeat keys`);
	if (r.kind !== 'weekly' && r.kind !== 'once') throw new Error(`${where}: repeat.kind must be weekly or once`);
	if (!isIsoDate(r.startsOn)) throw new Error(`${where}: repeat.startsOn must be YYYY-MM-DD`);
	const startsOn = /** @type {string} */ (r.startsOn);
	const want = WEEKDAYS.indexOf(m.weekday);
	const first = dayNumber(startsOn) + ((want - weekdayIndex(startsOn) + 7) % 7);
	/** @type {number | null} */
	let last = null;
	if (r.kind === 'once') {
		if (r.count !== undefined || r.until !== undefined) throw new Error(`${where}: once takes no count or until`);
		if (first !== dayNumber(startsOn)) throw new Error(`${where}: a once repeat must start on its weekday`);
		last = first;
	} else {
		if (r.count !== undefined && r.until !== undefined) throw new Error(`${where}: count or until, not both`);
		if (r.count !== undefined) {
			if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1) {
				throw new Error(`${where}: repeat.count must be a positive integer`);
			}
			last = first + 7 * (r.count - 1);
		}
		if (r.until !== undefined) {
			if (!isIsoDate(r.until)) throw new Error(`${where}: repeat.until must be YYYY-MM-DD`);
			const until = dayNumber(/** @type {string} */ (r.until));
			if (until < first) throw new Error(`${where}: repeat.until ends the series before its first occurrence`);
			last = first + 7 * Math.floor((until - first) / 7);
		}
	}
	if (m.skip !== undefined) {
		if (!Array.isArray(m.skip) || new Set(m.skip).size !== m.skip.length) throw new Error(`${where}: skip invalid`);
		for (const date of m.skip) {
			const day = isIsoDate(date) ? dayNumber(date) : Number.NaN;
			if (!(day >= first) || (last !== null && day > last) || (day - first) % 7 !== 0) {
				throw new Error(`${where}: skip date ${String(date)} is not a generated occurrence`);
			}
		}
	}
	if (m.location !== undefined && m.location !== 'the bus') throw new Error(`${where}: location may only be "the bus"`);
	if (m.notes !== undefined && (typeof m.notes !== 'string' || m.notes.trim().length === 0 || m.notes.length > 200)) {
		throw new Error(`${where}: notes must be a non-empty string of at most 200 characters`);
	}
	if (
		m.source !== undefined &&
		(typeof m.source !== 'string' || m.source.trim().length === 0 || TRACKER_ID_RE.test(m.source))
	) {
		throw new Error(`${where}: source must be a non-empty string without tracker ids`);
	}
}

/**
 * @param {Record<string, unknown>} r
 * @returns {string}
 */
function renderRepeat(r) {
	const parts = [`kind: ${JSON.stringify(r.kind)}`, `startsOn: ${JSON.stringify(r.startsOn)}`];
	if (r.count !== undefined) parts.push(`count: ${Number(r.count)}`);
	if (r.until !== undefined) parts.push(`until: ${JSON.stringify(r.until)}`);
	return `{ ${parts.join(', ')} }`;
}

/**
 * One published entry as a TypeScript object literal. `source` is never
 * emitted.
 *
 * @param {HoursEntry} entry
 * @returns {string}
 */
function renderEntry(entry) {
	assertHoursEntry(entry);
	const m = entry.data;
	const lines = [
		'\t{',
		`\t\tid: ${JSON.stringify(m.id)},`,
		'\t\tslot: {',
		`\t\t\tid: ${JSON.stringify(m.id)},`,
		'\t\t\tpublished: true,',
		`\t\t\tweekday: ${JSON.stringify(m.weekday)},`,
		`\t\t\tstart: ${JSON.stringify(m.start)},`,
		`\t\t\tend: ${JSON.stringify(m.end)},`,
		`\t\t\ttimezone: ${JSON.stringify(m.timezone)},`,
		`\t\t\tstaff: ${JSON.stringify(m.staff)},`,
		`\t\t\trepeat: ${renderRepeat(/** @type {Record<string, unknown>} */ (m.repeat))},`,
	];
	if (m.skip !== undefined) lines.push(`\t\t\tskip: ${JSON.stringify(m.skip)},`);
	if (m.location !== undefined) lines.push(`\t\t\tlocation: ${JSON.stringify(m.location)},`);
	if (m.notes !== undefined) lines.push(`\t\t\tnotes: ${JSON.stringify(m.notes)},`);
	lines.push('\t\t},', `\t\tsourcePath: ${JSON.stringify(entry.sourcePath)},`, '\t},');
	return lines.join('\n');
}

/**
 * The manifest source before Prettier: PUBLISHED entries only, every entry
 * validated, and no clock read anywhere, so two runs at different times
 * produce the same bytes.
 *
 * @param {HoursEntry[]} entries
 * @returns {string}
 */
export function renderHoursManifestSource(entries) {
	for (const entry of entries) assertHoursEntry(entry);
	const published = entries.filter((entry) => entry.data.published === true);
	const body =
		published.length > 0 ? `${published.map(renderEntry).join('\n')}\n` : '\t// No entries are published yet.\n';
	return `// GENERATED by scripts/build-hours-manifest.mjs. Do not edit by hand.
// \`just hours-manifest-check\` (wired into \`just check\`) fails on drift.
//
// PUBLISHED entries ONLY: unpublished slots are excluded at generation time,
// so their content is never an import reachable from the client bundle. The
// internal \`source\` provenance key is never emitted, and nothing here is
// dated: src/lib/hours-recurrence.ts expands rows on the visitor's clock.
import type { PublicHoursSlot } from '../public-hours-schema';

export interface GeneratedHoursEntry {
	id: string;
	slot: PublicHoursSlot;
	sourcePath: string;
}

export const publishedHoursEntries: GeneratedHoursEntry[] = [
${body}];
`;
}

const MIN_LITERAL_LENGTH = 20;

/**
 * Notes of 20 characters or more from every `published: false` hours file,
 * folded into the build-output leak denylist. Staff names, times and "the
 * bus" never join it: the FAQ already renders those.
 *
 * @param {HoursEntry[]} entries
 * @returns {string[]}
 */
export function distinctiveDraftHoursLiterals(entries) {
	/** @type {string[]} */
	const literals = [];
	for (const entry of entries) {
		if (entry.data.published !== false) continue;
		const notes = entry.data.notes;
		if (typeof notes === 'string' && notes.length >= MIN_LITERAL_LENGTH) literals.push(notes);
	}
	return literals;
}
