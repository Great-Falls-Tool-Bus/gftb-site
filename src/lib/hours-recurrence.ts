// Expands a published hours slot into dated rows on the VISITOR's clock. The
// build never calls this: prerender shows clock-free rule text, and the band
// swaps in these rows after mount, so the same source always builds the same
// tree. Calendar stepping uses UTC calendar dates; comparisons use New York
// wall-clock strings; each row's offset is resolved through Intl in two passes
// so a DST change between now and the session is respected.
import {
	HOURS_TIMEZONE,
	dayNumberToIsoDate,
	firstOccurrenceDay,
	isoDateToDayNumber,
	lastOccurrenceDay,
	type PublicHoursSlot,
} from './public-hours-schema';

/** Four weeks ahead. */
export const DEFAULT_HORIZON_DAYS = 28;
/** The band never shows more rows than this. */
export const MAX_ROWS = 6;

export interface HoursOccurrence {
	/** `<slot id>@<YYYY-MM-DD>`, the RSVP slot reference. */
	id: string;
	slotId: string;
	/** New York calendar date. */
	date: string;
	weekday: PublicHoursSlot['weekday'];
	start: string;
	end: string;
	/** UTC offset in force at the start, e.g. `-04:00`. */
	offset: string;
	/** `YYYY-MM-DDTHH:MM±HH:MM`, for `<time datetime>`. */
	startIso: string;
	endIso: string;
	/** The session falls on the visitor's current New York date. */
	today: boolean;
	staff: PublicHoursSlot['staff'];
	repeat: PublicHoursSlot['repeat'];
	location?: PublicHoursSlot['location'];
	notes?: string;
}

type Parts = Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
const PART_TYPES = new Set<string>(['year', 'month', 'day', 'hour', 'minute']);

let wallClockFormatter: Intl.DateTimeFormat | undefined;
let offsetFormatter: Intl.DateTimeFormat | undefined;

function wallClockParts(instant: Date): Parts {
	wallClockFormatter ??= new Intl.DateTimeFormat('en-US', {
		timeZone: HOURS_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	});
	const parts = {} as Parts;
	for (const part of wallClockFormatter.formatToParts(instant)) {
		if (PART_TYPES.has(part.type)) parts[part.type as keyof Parts] = part.value;
	}
	return parts;
}

/** `YYYY-MM-DDTHH:MM` on the New York wall clock at `instant`. */
export function newYorkWallClock(instant: Date): string {
	const p = wallClockParts(instant);
	return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Offset of New York from UTC at `ms`, in minutes (EDT is -240). */
function offsetMinutesAt(ms: number): number {
	offsetFormatter ??= new Intl.DateTimeFormat('en-US', { timeZone: HOURS_TIMEZONE, timeZoneName: 'longOffset' });
	const name = offsetFormatter.formatToParts(new Date(ms)).find((part) => part.type === 'timeZoneName')?.value ?? '';
	const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/u.exec(name);
	if (!match) throw new Error(`unexpected time zone name: ${name}`);
	if (match[1] === undefined) return 0;
	const minutes = Number(match[2]) * 60 + Number(match[3]);
	return match[1] === '-' ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);
	return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * The New York UTC offset for a wall-clock date and time: guess with the
 * wall clock read as UTC, take the offset there, then resolve again at the
 * corrected instant.
 */
export function newYorkOffset(date: string, time: string): string {
	const wallAsUtc = Date.parse(`${date}T${time}:00Z`);
	const guess = offsetMinutesAt(wallAsUtc);
	return formatOffset(offsetMinutesAt(wallAsUtc - guess * 60_000));
}

function occurrence(slot: PublicHoursSlot, date: string, today: boolean): HoursOccurrence {
	const offset = newYorkOffset(date, slot.start);
	const row: HoursOccurrence = {
		id: `${slot.id}@${date}`,
		slotId: slot.id,
		date,
		weekday: slot.weekday,
		start: slot.start,
		end: slot.end,
		offset,
		startIso: `${date}T${slot.start}${offset}`,
		endIso: `${date}T${slot.end}${newYorkOffset(date, slot.end)}`,
		today,
		staff: [...slot.staff],
		repeat: slot.repeat,
	};
	if (slot.location !== undefined) row.location = slot.location;
	if (slot.notes !== undefined) row.notes = slot.notes;
	return row;
}

/**
 * Up to MAX_ROWS sessions of one slot that have not yet ended at `now` and
 * fall within `horizonDays` New York calendar days of today (today counts as
 * day 0). Skipped dates are dropped and do not extend a counted series.
 */
export function expandSlot(slot: PublicHoursSlot, now: Date, horizonDays = DEFAULT_HORIZON_DAYS): HoursOccurrence[] {
	const wallNow = newYorkWallClock(now);
	const todayIso = wallNow.slice(0, 10);
	const today = isoDateToDayNumber(todayIso);
	const horizonEnd = today + horizonDays;
	const first = firstOccurrenceDay(slot);
	const last = lastOccurrenceDay(slot);
	const skip = new Set(slot.skip ?? []);
	const rows: HoursOccurrence[] = [];
	let day = today <= first ? first : first + 7 * Math.ceil((today - first) / 7);
	for (; day < horizonEnd && (last === null || day <= last) && rows.length < MAX_ROWS; day += 7) {
		const date = dayNumberToIsoDate(day);
		if (skip.has(date)) continue;
		if (`${date}T${slot.end}` <= wallNow) continue;
		rows.push(occurrence(slot, date, day === today));
	}
	return rows;
}

/** Every slot's upcoming rows, soonest first, at most MAX_ROWS in all. */
export function upcomingSessions(
	slots: readonly PublicHoursSlot[],
	now: Date,
	horizonDays = DEFAULT_HORIZON_DAYS,
): HoursOccurrence[] {
	return slots
		.flatMap((slot) => expandSlot(slot, now, horizonDays))
		.sort(
			(left, right) =>
				`${left.date}T${left.start}`.localeCompare(`${right.date}T${right.start}`) || left.id.localeCompare(right.id),
		)
		.slice(0, MAX_ROWS);
}
