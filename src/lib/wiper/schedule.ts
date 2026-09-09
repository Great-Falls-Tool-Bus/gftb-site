// Pure, DOM-free timing for the Notes & Goals wiper (src/lib/wiper/engine.svelte.ts
// owns the clock; src/lib/components/WiperControls.svelte renders the stalk).
// Kept out of the runes module so vitest can pin the table and the arithmetic
// without the Svelte compiler.

export type WiperDetent = 'off' | 'intermittent' | 'low' | 'high';
export type ActiveWiperDetent = Exclude<WiperDetent, 'off'>;

export interface WiperDetentEntry {
	id: WiperDetent;
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
export const WIPER_DETENTS: readonly WiperDetentEntry[] = [
	{ id: 'off', label: 'Off', dwellMs: 0, sweepMs: 0 },
	{ id: 'intermittent', label: 'Intermittent', dwellMs: 5000, sweepMs: 1400 },
	{ id: 'low', label: 'Low', dwellMs: 3000, sweepMs: 1000 },
	{ id: 'high', label: 'High', dwellMs: 1500, sweepMs: 700 },
];

/** The calmest cadence: closest to the retired carousel's 7 s auto-advance. */
export const DEFAULT_WIPER_DETENT: ActiveWiperDetent = 'intermittent';

/** Intermittent wipers never fall on a metronome: the dwell wanders inside this band. */
export const INTERMITTENT_JITTER: readonly [number, number] = [0.8, 1.3];

export function wiperDetent(id: WiperDetent): WiperDetentEntry {
	const entry = WIPER_DETENTS.find((candidate) => candidate.id === id);
	if (!entry) throw new Error(`wiper: unknown detent ${id}`);
	return entry;
}

export function isWiperDetent(value: unknown): value is WiperDetent {
	return typeof value === 'string' && WIPER_DETENTS.some((entry) => entry.id === value);
}

/**
 * The rest before the next wipe. Intermittent dwell is jittered inside
 * INTERMITTENT_JITTER from a unit random; the other detents are exact.
 */
export function dwellFor(id: WiperDetent, random: () => number = Math.random): number {
	const entry = wiperDetent(id);
	if (id !== 'intermittent') return entry.dwellMs;
	const [low, high] = INTERMITTENT_JITTER;
	const unit = Math.min(Math.max(random(), 0), 1);
	return Math.round(entry.dwellMs * (low + (high - low) * unit));
}

/** Symmetric ease for a single stroke: the blade slows into both turnarounds. */
export function strokeEase(t: number): number {
	const clamped = Math.min(Math.max(t, 0), 1);
	return 0.5 - 0.5 * Math.cos(Math.PI * clamped);
}

export function pageOf(index: number, pageSize: number): number {
	return Math.floor(index / Math.max(pageSize, 1));
}

export function pageCountFor(itemCount: number, pageSize: number): number {
	return Math.max(Math.ceil(itemCount / Math.max(pageSize, 1)), 1);
}
