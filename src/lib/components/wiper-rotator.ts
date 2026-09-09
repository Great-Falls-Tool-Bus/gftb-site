// Pure, DOM-free half of the wiper rotator (src/lib/components/WiperRotator.svelte):
// the stalk's position table and the page arithmetic. Kept out of the
// `.svelte.ts` runes module so vitest (node, no Svelte compiler) can pin the
// table and the helpers directly.

export type WiperPosition = 'off' | 'intermittent' | 'low' | 'high';
export type ActiveWiperPosition = Exclude<WiperPosition, 'off'>;

export interface WiperPositionEntry {
	id: WiperPosition;
	/** Visible detent label and the radio's accessible name. */
	label: string;
	/** Rest between wipes, in ms. 0 on the Off detent. */
	dwellMs: number;
	/** One full out-and-back sweep, in ms; a single stroke is half. 0 on Off. */
	sweepMs: number;
}

/**
 * The stalk, Off first, then faster detents. Dwell strictly decreases down
 * the table and every sweep is shorter than its dwell, so the notes are
 * always readable for longer than the blades cover them.
 */
export const WIPER_POSITIONS: readonly WiperPositionEntry[] = [
	{ id: 'off', label: 'Off', dwellMs: 0, sweepMs: 0 },
	{ id: 'intermittent', label: 'Intermittent', dwellMs: 5000, sweepMs: 1400 },
	{ id: 'low', label: 'Low', dwellMs: 3000, sweepMs: 1000 },
	{ id: 'high', label: 'High', dwellMs: 1500, sweepMs: 700 },
];

/** The calmest cadence: closest to the retired carousel's 7 s auto-advance. */
export const DEFAULT_WIPER_POSITION: ActiveWiperPosition = 'intermittent';

/**
 * Named skins (operator rulings 2026-09-09). `dash` is the tranche-1 look and
 * the rollback; `aero` is the wet-glass pane with the deck's instruments;
 * `deck` is aero plus the Winamp chassis (opaque bevelled dash strip, amber
 * LCD countdown, VU strip, marquee, lamp) and ships as the home default.
 * Every skin rule in app.css is scoped under `[data-skin='<name>']`, so the
 * default skin's computed styles never change when a new skin lands.
 */
export const WIPER_SKINS = ['dash', 'aero', 'deck'] as const;
export type WiperSkin = (typeof WIPER_SKINS)[number];
export const DEFAULT_WIPER_SKIN: WiperSkin = 'dash';

export function wiperEntry(id: WiperPosition): WiperPositionEntry {
	const entry = WIPER_POSITIONS.find((candidate) => candidate.id === id);
	if (!entry) throw new Error(`wiper-rotator: unknown position ${id}`);
	return entry;
}

/** Roving-tabindex arrow-key step through the detents, wrapping at both ends. */
export function stepWiperPosition(current: WiperPosition, delta: 1 | -1): WiperPosition {
	const index = WIPER_POSITIONS.findIndex((candidate) => candidate.id === current);
	const count = WIPER_POSITIONS.length;
	return WIPER_POSITIONS[(index + delta + count) % count].id;
}

export function pageOf(index: number, pageSize: number): number {
	return Math.floor(index / Math.max(pageSize, 1));
}

/**
 * Deterministic VU column height for a page (0.2 to 1): the same page always
 * lights the same bars, so the strip is stable under test and steps once per
 * wipe. A hash, not a random source.
 */
export function vuHeight(page: number, column: number): number {
	const seed = Math.sin((page + 1) * 12.9898 + (column + 1) * 78.233) * 43758.5453;
	const fraction = seed - Math.floor(seed);
	return Math.round((0.2 + 0.8 * fraction) * 100) / 100;
}

export const VU_COLUMNS = 12;

export function pageCountFor(itemCount: number, pageSize: number): number {
	return Math.max(Math.ceil(itemCount / Math.max(pageSize, 1)), 1);
}
