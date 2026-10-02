// The work-sessions band's row model and presentation choice (operator
// interview 2026-10-02). The server render builds one rule row per published
// slot, clock-free; after mount the band swaps in dated rows expanded on the
// visitor's clock. Which presentation the dated rows take is a pure function
// of the row count and the visitor's media, so it is pinned here rather than
// in the component.
import { DEFAULT_HORIZON_DAYS, MAX_ROWS, upcomingSessions, type HoursOccurrence } from './hours-recurrence';
import {
	formatLocation,
	formatRepeat,
	formatRuleText,
	formatSessionLabel,
	formatStaff,
	finiteSeriesDates,
} from './hours-format';
import { assertPublicHoursSlot, type PublicHoursSlot } from './public-hours-schema';

/**
 * At 48rem and up the right-hand loop shows this many rows at a time; a list
 * that fits in that window is shown whole instead of looped.
 */
export const LOOP_VISIBLE_ROWS = 3;

/**
 * - `rules`: the server render, one clock-free rule row per slot.
 * - `empty`: nothing scheduled.
 * - `static`: every row at rest (reduced motion, forced colours, or a list
 *   short enough to show whole).
 * - `carousel`: under 48rem, one card per view with steps and dots.
 * - `loop`: at 48rem and up, the right-hand vertical loop.
 */
export type HoursMode = 'rules' | 'empty' | 'static' | 'carousel' | 'loop';

export interface HoursModeInput {
	rows: number;
	wide: boolean;
	reducedMotion: boolean;
	forcedColors: boolean;
}

export function chooseHoursMode({ rows, wide, reducedMotion, forcedColors }: HoursModeInput): HoursMode {
	if (rows === 0) return 'empty';
	if (reducedMotion || forcedColors) return 'static';
	if (wide) return rows > LOOP_VISIBLE_ROWS ? 'loop' : 'static';
	return rows > 1 ? 'carousel' : 'static';
}

export interface HoursBandRow {
	/** RSVP slot reference: the slot id, or `<slot id>@<YYYY-MM-DD>` once dated. */
	id: string;
	/** Rule text before mount; the dated label after it. */
	when: string;
	/** `YYYY-MM-DDTHH:MM±HH:MM` for a dated row only. */
	datetime?: string;
	repeat: string;
	staff: string;
	location?: string;
	notes?: string;
	today: boolean;
}

/** The server render's rows: one per slot that still has a session to show. */
export function ruleRows(slots: readonly PublicHoursSlot[]): HoursBandRow[] {
	const rows: HoursBandRow[] = [];
	for (const slot of slots) {
		const when = formatRuleText(slot);
		if (when === null) continue;
		const row: HoursBandRow = {
			id: slot.id,
			when,
			repeat: formatRepeat(slot),
			staff: formatStaff(slot.staff),
			today: false,
		};
		const location = formatLocation(slot.location);
		if (location !== undefined) row.location = location;
		if (slot.notes !== undefined) row.notes = slot.notes;
		rows.push(row);
	}
	return rows;
}

/** The rows after mount, from hours-recurrence's expansion on the visitor's clock. */
export function datedRows(occurrences: readonly HoursOccurrence[], slots: readonly PublicHoursSlot[]): HoursBandRow[] {
	const bySlot = new Map(slots.map((slot) => [slot.id, slot]));
	return occurrences.map((occurrence) => {
		const slot = bySlot.get(occurrence.slotId);
		const row: HoursBandRow = {
			id: occurrence.id,
			when: formatSessionLabel(occurrence),
			datetime: occurrence.startIso,
			repeat: slot ? formatRepeat(slot) : formatRepeat(occurrence),
			staff: formatStaff(occurrence.staff),
			today: occurrence.today,
		};
		const location = formatLocation(occurrence.location);
		if (location !== undefined) row.location = location;
		if (occurrence.notes !== undefined) row.notes = occurrence.notes;
		return row;
	});
}

/**
 * The rows the band swaps in after mount: the only place the band reads a
 * clock, and it is the visitor's. Never called during the build.
 */
export function rowsOnVisitorClock(slots: readonly PublicHoursSlot[]): HoursBandRow[] {
	return datedRows(upcomingSessions(slots, new Date()), slots);
}

/**
 * A clock-free upper bound on the dated rows the band can show after mount:
 * each slot contributes at most one session per week of the horizon (fewer
 * for a short finite series), and the band never shows more than MAX_ROWS.
 * The server render reserves room from it so the swap shifts as little as it
 * can without knowing the date.
 */
export function reserveRows(slots: readonly PublicHoursSlot[]): number {
	const perWeekOfHorizon = Math.ceil(DEFAULT_HORIZON_DAYS / 7);
	let total = 0;
	for (const slot of slots) {
		const dates = finiteSeriesDates(slot);
		total += dates === null ? perWeekOfHorizon : Math.min(dates.length, perWeekOfHorizon);
	}
	return Math.min(total, MAX_ROWS);
}

/**
 * Test and LOOK hook: `window.__gftbHoursFixture`, set before the bundle
 * mounts, stands in for the published slots after mount (the server render is
 * unchanged). Every entry passes the same fail-closed schema as the content
 * files and must be published; anything else is ignored, so a malformed
 * fixture shows the band's real state. No URL query, no storage.
 */
export const HOURS_FIXTURE_GLOBAL = '__gftbHoursFixture';

export function hoursFixtureSlots(value: unknown): PublicHoursSlot[] | null {
	if (!Array.isArray(value)) return null;
	try {
		const slots = value.map((entry) => assertPublicHoursSlot(entry, 'hours fixture'));
		return slots.every((slot) => slot.published) ? slots : null;
	} catch {
		return null;
	}
}
