// Words for the work-sessions band (operator interview 2026-10-02). Pure and
// clock-free: the server render shows each slot's rule text, and after mount
// the band formats the rows src/lib/hours-recurrence.ts expands on the
// visitor's clock. Dates are New York calendar dates, written in words
// ("Thursday 8 October"); times are New York wall-clock, written as "3 to 4 PM
// ET". No year is written: the band only ever shows the next four weeks.
import type { HoursOccurrence } from './hours-recurrence';
import {
	dayNumberToIsoDate,
	firstOccurrenceDay,
	lastOccurrenceDay,
	weekdayOfIsoDate,
	type HoursWeekday,
	type PublicHoursSlot,
} from './public-hours-schema';

const WEEKDAY_NAMES: Record<HoursWeekday, string> = {
	monday: 'Monday',
	tuesday: 'Tuesday',
	wednesday: 'Wednesday',
	thursday: 'Thursday',
	friday: 'Friday',
	saturday: 'Saturday',
	sunday: 'Sunday',
};

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
] as const;

/** A finite series with at most this many dates lists them in its rule text. */
export const RULE_TEXT_MAX_LISTED_DATES = 6;

export const KEYHOLDER_FALLBACK = 'a keyholder';

const LOCATION_LABELS: Record<NonNullable<PublicHoursSlot['location']>, string> = {
	'the bus': 'On the bus',
};

export function weekdayName(weekday: HoursWeekday): string {
	return WEEKDAY_NAMES[weekday];
}

/** `2026-10-08` -> `8 October`. */
export function formatDayMonth(iso: string): string {
	const [, month, day] = iso.split('-').map(Number);
	return `${day} ${MONTH_NAMES[month - 1]}`;
}

/** `2026-10-08` -> `Thursday 8 October`. */
export function formatDateWords(iso: string): string {
	return `${weekdayName(weekdayOfIsoDate(iso))} ${formatDayMonth(iso)}`;
}

function clockParts(time: string): { hour: number; minute: string; period: 'AM' | 'PM' } {
	const [hours, minute] = time.split(':');
	const hour24 = Number(hours);
	return { hour: hour24 % 12 === 0 ? 12 : hour24 % 12, minute, period: hour24 < 12 ? 'AM' : 'PM' };
}

function clockWords(time: string): string {
	const { hour, minute } = clockParts(time);
	return minute === '00' ? String(hour) : `${hour}:${minute}`;
}

/** `15:00`, `16:00` -> `3 to 4 PM ET`; `11:00`, `13:30` -> `11 AM to 1:30 PM ET`. */
export function formatTimeRange(start: string, end: string): string {
	const from = clockParts(start);
	const to = clockParts(end);
	if (from.period === to.period) return `${clockWords(start)} to ${clockWords(end)} ${to.period} ET`;
	return `${clockWords(start)} ${from.period} to ${clockWords(end)} ${to.period} ET`;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinWords(items: readonly string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** `5 and 12 October` within one month; `28 September and 5 October` across months. */
export function formatDateList(isos: readonly string[]): string {
	if (isos.length === 0) return '';
	const months = new Set(isos.map((iso) => iso.slice(0, 7)));
	if (months.size === 1) {
		const month = MONTH_NAMES[Number(isos[0].slice(5, 7)) - 1];
		return `${joinWords(isos.map((iso) => String(Number(iso.slice(8, 10)))))} ${month}`;
	}
	return joinWords(isos.map(formatDayMonth));
}

/** `With a keyholder`, `With Jess`, `With Jess and Sam`. */
export function formatStaff(staff: readonly string[]): string {
	return `With ${staff.length === 0 ? KEYHOLDER_FALLBACK : joinWords(staff)}`;
}

export function formatLocation(location: PublicHoursSlot['location']): string | undefined {
	return location === undefined ? undefined : LOCATION_LABELS[location];
}

/**
 * Every generated date of a finite series, skips removed; `null` for an open
 * weekly series, whose dates only the visitor's clock can bound.
 */
export function finiteSeriesDates(slot: Pick<PublicHoursSlot, 'weekday' | 'repeat' | 'skip'>): string[] | null {
	const first = firstOccurrenceDay(slot);
	const last = lastOccurrenceDay(slot);
	if (last === null) return null;
	const skip = new Set(slot.skip ?? []);
	const dates: string[] = [];
	for (let day = first; day <= last; day += 7) {
		const iso = dayNumberToIsoDate(day);
		if (!skip.has(iso)) dates.push(iso);
	}
	return dates;
}

/** `Weekly`, `2 Mondays`, or `Once` for a single session. */
export function formatRepeat(slot: Pick<PublicHoursSlot, 'weekday' | 'repeat' | 'skip'>): string {
	const dates = finiteSeriesDates(slot);
	if (dates === null) return 'Weekly';
	if (dates.length <= 1) return 'Once';
	return `${dates.length} ${weekdayName(slot.weekday)}s`;
}

/**
 * The clock-free rule text the server renders for one slot, or `null` when a
 * finite series has no session left after its skips:
 * `Thursdays, 3 to 4 PM ET, from 8 October`,
 * `Mondays 5 and 12 October, 5 to 6 PM ET`, `Monday 5 October, 5 to 6 PM ET`.
 */
export function formatRuleText(slot: PublicHoursSlot): string | null {
	const time = formatTimeRange(slot.start, slot.end);
	const plural = `${weekdayName(slot.weekday)}s`;
	const dates = finiteSeriesDates(slot);
	if (dates === null) {
		const from = formatDayMonth(dayNumberToIsoDate(firstOccurrenceDay(slot)));
		const skipped = [...(slot.skip ?? [])].sort();
		const except = skipped.length > 0 ? `, except ${formatDateList(skipped)}` : '';
		return `${plural}, ${time}, from ${from}${except}`;
	}
	if (dates.length === 0) return null;
	if (dates.length === 1) return `${formatDateWords(dates[0])}, ${time}`;
	if (dates.length <= RULE_TEXT_MAX_LISTED_DATES) return `${plural} ${formatDateList(dates)}, ${time}`;
	const first = dates[0];
	const last = dates[dates.length - 1];
	const inside = [...(slot.skip ?? [])].sort().filter((iso) => iso > first && iso < last);
	const except = inside.length > 0 ? `, except ${formatDateList(inside)}` : '';
	return `${plural}, ${time}, ${formatDayMonth(first)} to ${formatDayMonth(last)}${except}`;
}

/** `Thursday 8 October, 3 to 4 PM ET`: the row's own words, and the RSVP subject. */
export function formatSessionLabel(row: Pick<HoursOccurrence, 'date' | 'start' | 'end'>): string {
	return `${formatDateWords(row.date)}, ${formatTimeRange(row.start, row.end)}`;
}
