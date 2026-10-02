// Contract for src/content/hours/<id>.json: one file per staffed work-session
// slot on the bus. Fails closed like public-goal-schema.ts: unknown keys are
// rejected at both levels (the slot and its `repeat`), and no string may carry
// an em dash. Dates are calendar dates in New York; nothing here reads a clock.
// The build never expands occurrences: src/lib/hours-recurrence.ts does that
// on the visitor's clock after mount.
import { isValidIsoDate } from './public-log-schema';

export const HOURS_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type HoursWeekday = (typeof HOURS_WEEKDAYS)[number];

export const HOURS_TIMEZONE = 'America/New_York' as const;

/**
 * First names with a recorded naming-consent row. Anyone else stays out of
 * `staff`; an empty list renders as "a keyholder".
 */
export const CONSENTED_STAFF = ['Jess'] as const;
export type ConsentedStaff = (typeof CONSENTED_STAFF)[number];
export const MAX_STAFF = 3;

export const HOURS_LOCATIONS = ['the bus'] as const;
export const MAX_NOTES_LENGTH = 200;
/** Earliest start and latest end, New York wall clock. */
export const EARLIEST_TIME = '06:00';
export const LATEST_TIME = '23:00';

export const PUBLIC_HOURS_REQUIRED_KEYS = [
	'id',
	'published',
	'weekday',
	'start',
	'end',
	'timezone',
	'staff',
	'repeat',
] as const;
/** `source` is internal provenance: read at build time, never emitted to the manifest. */
export const PUBLIC_HOURS_OPTIONAL_KEYS = ['skip', 'location', 'notes', 'source'] as const;
export const PUBLIC_HOURS_REPEAT_KEYS = ['kind', 'startsOn', 'count', 'until'] as const;

export type HoursRepeat =
	{ kind: 'once'; startsOn: string } | { kind: 'weekly'; startsOn: string; count?: number; until?: string };

export interface PublicHoursSlot {
	id: string;
	published: boolean;
	weekday: HoursWeekday;
	/** `HH:MM`, New York wall clock. */
	start: string;
	/** `HH:MM`, New York wall clock, after `start`. */
	end: string;
	timezone: typeof HOURS_TIMEZONE;
	staff: ConsentedStaff[];
	repeat: HoursRepeat;
	/** Cancelled dates; each one must be a generated occurrence. */
	skip?: string[];
	location?: (typeof HOURS_LOCATIONS)[number];
	notes?: string;
}

const allowedKeys = new Set<string>([...PUBLIC_HOURS_REQUIRED_KEYS, ...PUBLIC_HOURS_OPTIONAL_KEYS]);
const allowedRepeatKeys = new Set<string>(PUBLIC_HOURS_REPEAT_KEYS);
const weekdays = new Set<string>(HOURS_WEEKDAYS);
const consented = new Set<string>(CONSENTED_STAFF);
const locations = new Set<string>(HOURS_LOCATIONS);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
// Tracker-style identifiers (ABC-123) never belong in a public repository.
const TRACKER_ID_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/u;
const DAY_MS = 86_400_000;

/** Days since the Unix epoch for a valid `YYYY-MM-DD`. */
export function isoDateToDayNumber(iso: string): number {
	return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function dayNumberToIsoDate(day: number): string {
	return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** `monday` .. `sunday` for a calendar date (the date itself, not an instant). */
export function weekdayOfIsoDate(iso: string): HoursWeekday {
	const sundayFirst = new Date(`${iso}T00:00:00Z`).getUTCDay();
	return HOURS_WEEKDAYS[(sundayFirst + 6) % 7];
}

type SeriesShape = Pick<PublicHoursSlot, 'weekday' | 'repeat'>;

/** The first generated occurrence: the first `weekday` on or after `startsOn`. */
export function firstOccurrenceDay(slot: SeriesShape): number {
	const start = isoDateToDayNumber(slot.repeat.startsOn);
	const have = HOURS_WEEKDAYS.indexOf(weekdayOfIsoDate(slot.repeat.startsOn));
	const want = HOURS_WEEKDAYS.indexOf(slot.weekday);
	return start + ((want - have + 7) % 7);
}

/** The last generated occurrence, or `null` for an open weekly series. */
export function lastOccurrenceDay(slot: SeriesShape): number | null {
	const first = firstOccurrenceDay(slot);
	const repeat = slot.repeat;
	if (repeat.kind === 'once') return first;
	if (repeat.count !== undefined) return first + 7 * (repeat.count - 1);
	if (repeat.until !== undefined) {
		const until = isoDateToDayNumber(repeat.until);
		if (until < first) return first - 7;
		return first + 7 * Math.floor((until - first) / 7);
	}
	return null;
}

/** Whether `iso` is one of the series' generated dates (before any skip). */
export function isGeneratedOccurrence(slot: SeriesShape, iso: string): boolean {
	if (!isValidIsoDate(iso)) return false;
	const day = isoDateToDayNumber(iso);
	const first = firstOccurrenceDay(slot);
	const last = lastOccurrenceDay(slot);
	if (day < first || (last !== null && day > last)) return false;
	return (day - first) % 7 === 0;
}

function collectStrings(value: unknown, out: string[]): string[] {
	if (typeof value === 'string') out.push(value);
	else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
	else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, out);
	return out;
}

function assertRepeat(input: unknown, weekday: HoursWeekday, source: string): HoursRepeat {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error(`${source}: repeat must be an object`);
	}
	const record = input as Record<string, unknown>;
	const unknownKeys = Object.keys(record).filter((key) => !allowedRepeatKeys.has(key));
	if (unknownKeys.length > 0) throw new Error(`${source}: unsupported repeat keys: ${unknownKeys.join(', ')}`);
	if (record.kind !== 'weekly' && record.kind !== 'once') {
		throw new Error(`${source}: repeat.kind must be weekly or once`);
	}
	if (!isValidIsoDate(record.startsOn)) throw new Error(`${source}: repeat.startsOn must be YYYY-MM-DD`);
	if (record.kind === 'once') {
		if (record.count !== undefined || record.until !== undefined) {
			throw new Error(`${source}: a once repeat takes no count or until`);
		}
		if (weekdayOfIsoDate(record.startsOn) !== weekday) {
			throw new Error(`${source}: a once repeat must start on its weekday`);
		}
		return { kind: 'once', startsOn: record.startsOn };
	}
	if (record.count !== undefined && record.until !== undefined) {
		throw new Error(`${source}: repeat takes count or until, not both`);
	}
	const repeat: Extract<HoursRepeat, { kind: 'weekly' }> = { kind: 'weekly', startsOn: record.startsOn };
	if (record.count !== undefined) {
		if (typeof record.count !== 'number' || !Number.isInteger(record.count) || record.count < 1) {
			throw new Error(`${source}: repeat.count must be a positive integer`);
		}
		repeat.count = record.count;
	}
	if (record.until !== undefined) {
		if (!isValidIsoDate(record.until)) throw new Error(`${source}: repeat.until must be YYYY-MM-DD`);
		repeat.until = record.until;
		const last = lastOccurrenceDay({ weekday, repeat });
		if (last === null || last < firstOccurrenceDay({ weekday, repeat })) {
			throw new Error(`${source}: repeat.until ends the series before its first occurrence`);
		}
	}
	return repeat;
}

/**
 * Validate one hours file. `expectedId` is the file stem when known; the id
 * must equal it.
 */
export function assertPublicHoursSlot(input: unknown, source = 'public hours', expectedId?: string): PublicHoursSlot {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error(`${source}: hours entry must be an object`);
	}
	const record = input as Record<string, unknown>;
	const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
	if (unknownKeys.length > 0) throw new Error(`${source}: unsupported hours keys: ${unknownKeys.join(', ')}`);
	const missingKeys = PUBLIC_HOURS_REQUIRED_KEYS.filter((key) => !(key in record));
	if (missingKeys.length > 0) throw new Error(`${source}: missing hours keys: ${missingKeys.join(', ')}`);

	if (collectStrings(record, []).some((value) => value.includes('\u2014'))) {
		throw new Error(`${source}: no em dashes in hours content`);
	}
	if (typeof record.id !== 'string' || !ID_RE.test(record.id)) throw new Error(`${source}: id must be kebab-case`);
	if (expectedId !== undefined && record.id !== expectedId) {
		throw new Error(`${source}: id must equal the file stem (${expectedId})`);
	}
	if (typeof record.published !== 'boolean') {
		throw new Error(`${source}: published must be a boolean; drafts carry published: false`);
	}
	if (typeof record.weekday !== 'string' || !weekdays.has(record.weekday)) {
		throw new Error(`${source}: weekday must be one of ${HOURS_WEEKDAYS.join(', ')}`);
	}
	const weekday = record.weekday as HoursWeekday;
	for (const key of ['start', 'end'] as const) {
		const value = record[key];
		if (typeof value !== 'string' || !TIME_RE.test(value)) throw new Error(`${source}: ${key} must be HH:MM`);
		if (value < EARLIEST_TIME || value > LATEST_TIME) {
			throw new Error(`${source}: ${key} must fall between ${EARLIEST_TIME} and ${LATEST_TIME}`);
		}
	}
	if ((record.end as string) <= (record.start as string)) throw new Error(`${source}: end must be after start`);
	if (record.timezone !== HOURS_TIMEZONE) throw new Error(`${source}: timezone must be ${HOURS_TIMEZONE}`);
	if (!Array.isArray(record.staff) || record.staff.length > MAX_STAFF) {
		throw new Error(`${source}: staff must be a list of 0 to ${MAX_STAFF} names`);
	}
	for (const name of record.staff) {
		if (typeof name !== 'string' || !consented.has(name)) {
			throw new Error(`${source}: staff names must come from CONSENTED_STAFF`);
		}
	}
	if (new Set(record.staff).size !== record.staff.length) throw new Error(`${source}: staff names must be unique`);
	const repeat = assertRepeat(record.repeat, weekday, source);
	if (record.skip !== undefined) {
		if (!Array.isArray(record.skip)) throw new Error(`${source}: skip must be a list of dates`);
		for (const date of record.skip) {
			if (!isValidIsoDate(date)) throw new Error(`${source}: skip dates must be YYYY-MM-DD`);
			if (!isGeneratedOccurrence({ weekday, repeat }, date)) {
				throw new Error(`${source}: skip date ${date} is not a generated occurrence`);
			}
		}
		if (new Set(record.skip).size !== record.skip.length) throw new Error(`${source}: skip dates must be unique`);
	}
	if (record.location !== undefined && (typeof record.location !== 'string' || !locations.has(record.location))) {
		throw new Error(`${source}: location may only be "the bus"`);
	}
	if (record.notes !== undefined) {
		if (typeof record.notes !== 'string' || record.notes.trim().length === 0) {
			throw new Error(`${source}: notes must be a non-empty string when present`);
		}
		if (record.notes.length > MAX_NOTES_LENGTH) {
			throw new Error(`${source}: notes must be at most ${MAX_NOTES_LENGTH} characters`);
		}
	}
	if (record.source !== undefined) {
		if (typeof record.source !== 'string' || record.source.trim().length === 0) {
			throw new Error(`${source}: source must be a non-empty string when present`);
		}
		if (TRACKER_ID_RE.test(record.source)) throw new Error(`${source}: source must not carry tracker ids`);
	}

	const slot: PublicHoursSlot = {
		id: record.id,
		published: record.published,
		weekday,
		start: record.start as string,
		end: record.end as string,
		timezone: HOURS_TIMEZONE,
		staff: [...(record.staff as ConsentedStaff[])],
		repeat,
	};
	if (record.skip !== undefined) slot.skip = [...(record.skip as string[])];
	if (record.location !== undefined) slot.location = record.location as PublicHoursSlot['location'];
	if (record.notes !== undefined) slot.notes = record.notes as string;
	return slot;
}
