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
 * One full out-and-back sweep, the same at every speed (operator ruling
 * 2026-09-09), slowed at LOOK 3 so the blades read as blades and the shove
 * has time to carry a note off the glass.
 */
export const SWEEP_MS = 2600;

/**
 * The stalk, Off first, then faster detents. A detent sets how often a wipe
 * comes, never how fast the blades move: dwell strictly decreases down the
 * table while the sweep stays SWEEP_MS, and every dwell is longer than the
 * sweep, so the notes are always readable for longer than the blades cover
 * them.
 */
export const WIPER_DETENTS: readonly WiperDetentEntry[] = [
	{ id: 'off', label: 'Off', dwellMs: 0, sweepMs: 0 },
	{ id: 'intermittent', label: 'Intermittent', dwellMs: 6500, sweepMs: SWEEP_MS },
	{ id: 'low', label: 'Low', dwellMs: 4400, sweepMs: SWEEP_MS },
	{ id: 'high', label: 'High', dwellMs: 3000, sweepMs: SWEEP_MS },
];

/**
 * High on load (operator ruling at LOOK 3): with the slower stroke its
 * cycle is about 5.6 s, close to the retired carousel's 7 s auto-advance.
 */
export const DEFAULT_WIPER_DETENT: ActiveWiperDetent = 'high';

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
