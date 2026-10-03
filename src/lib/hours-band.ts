// The work-sessions band's row model and presentation choice (operator
// interview 2026-10-02, layout revised the same day). The server render
// builds one rule row per published slot, clock-free; after mount the band
// swaps in dated rows expanded on the visitor's clock. Which presentation the
// dated rows take is a pure function of the row count, the band's variant,
// the room it has and the visitor's media, so it is pinned here rather than
// in the component, as are the marquee's geometry, speed and hold rules.
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
 * Where the band sits:
 * - `marquee`: a full-width band (the home page, and above the log list on
 *   phones and tablets) whose cards scroll right to left.
 * - `aside`: the log pages' right-hand sticky column on desktop, a plain
 *   vertical list in its own scroll box; it never moves.
 */
export type HoursVariant = 'marquee' | 'aside';

/**
 * - `rules`: the server render, one clock-free rule row per slot.
 * - `empty`: nothing scheduled.
 * - `static`: every row at rest (the aside, reduced motion, forced colours,
 *   or a list too short to fill the band's width).
 * - `marquee`: the cards scroll right to left over a duplicated track.
 */
export type HoursMode = 'rules' | 'empty' | 'static' | 'marquee';

export interface HoursModeInput {
	rows: number;
	variant: HoursVariant;
	/** One copy of the cards is at least as wide as the band (marqueeFills). */
	fills: boolean;
	reducedMotion: boolean;
	forcedColors: boolean;
}

export function chooseHoursMode({ rows, variant, fills, reducedMotion, forcedColors }: HoursModeInput): HoursMode {
	if (rows === 0) return 'empty';
	if (variant === 'aside' || reducedMotion || forcedColors) return 'static';
	return fills ? 'marquee' : 'static';
}

/** A marquee card's widest size, in rem; narrower on a phone (marqueeCardWidth). */
export const MARQUEE_CARD_REM = 17;
/** The space after every card, the last in each copy included, in rem. */
export const MARQUEE_GAP_REM = 1;
/** How far the cards travel each second, right to left. */
export const MARQUEE_PX_PER_SECOND = 36;
/** After a visitor scrolls the cards by hand, how long they rest before moving again. */
export const MARQUEE_RESUME_MS = 3000;

/**
 * A card's width in px for a band `viewportPx` wide: at most
 * MARQUEE_CARD_REM, and on a phone 85% of the band, so part of the next card
 * always shows and says there is more.
 */
export function marqueeCardWidth(viewportPx: number, remPx: number): number {
	return Math.max(0, Math.min(MARQUEE_CARD_REM * remPx, Math.floor(viewportPx * 0.85)));
}

export interface MarqueeFillsInput {
	rows: number;
	cardPx: number;
	gapPx: number;
	viewportPx: number;
}

/**
 * The loop is seamless only when one copy of the cards is at least as wide
 * as the band: otherwise the end of the duplicate would leave a gap. A single
 * card never moves.
 */
export function marqueeFills({ rows, cardPx, gapPx, viewportPx }: MarqueeFillsInput): boolean {
	if (rows < 2 || viewportPx <= 0 || cardPx <= 0) return false;
	return rows * (cardPx + gapPx) >= viewportPx;
}

/**
 * The scroll offset after `elapsedMs` of travel. The offset grows, so the
 * cards move right to left: they enter at the band's right edge and leave
 * at its left. It wraps at one copy's width, where the duplicate shows
 * exactly what the first copy showed at zero.
 */
export function marqueeAdvance(offset: number, elapsedMs: number, copyPx: number): number {
	if (copyPx <= 0) return 0;
	return marqueeWrap(offset + (elapsedMs * MARQUEE_PX_PER_SECOND) / 1000, copyPx);
}

export function marqueeWrap(offset: number, copyPx: number): number {
	if (copyPx <= 0) return 0;
	return ((offset % copyPx) + copyPx) % copyPx;
}

/**
 * What holds the marquee still. Any one of them stops it (WCAG 2.2.2: the
 * visitor stops the motion by pointing, touching, scrolling or moving focus
 * into it, with no separate control):
 * - `hover`: a mouse or pen is over the cards.
 * - `focus`: keyboard focus is inside them, so the focused card never moves away.
 * - `press`: a finger or button is down on them, until it lifts or is cancelled.
 * - `scroll`: the visitor scrolled them by hand; held until MARQUEE_RESUME_MS
 *   after the last scroll.
 * - `dialog`: the RSVP dialog is open.
 */
export interface MarqueeHolds {
	hover: boolean;
	focus: boolean;
	press: boolean;
	scroll: boolean;
	dialog: boolean;
}

export function marqueeHeld(holds: MarqueeHolds): boolean {
	return holds.hover || holds.focus || holds.press || holds.scroll || holds.dialog;
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
