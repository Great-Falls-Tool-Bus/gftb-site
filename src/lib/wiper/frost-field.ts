// Frost (M4): a static grain raster built once per glass, scaled by a
// single strength that grows during the rest and falls to nothing where a
// blade has just passed. The shader multiplies grain by strength and hides
// it behind the moving edge; the clock here decides the strength.
import type { StrokeSample } from './machine';
import { FROST_DELAY_S, FROST_PRESEED_S, FROST_TAU_S } from './renderer/shaders/constants';

/** A small integer hash to 0..1, deterministic per seed. */
function hash(ix: number, iy: number, seed: number): number {
	let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

/** Bilinear value noise at (x, y) CSS px with lattice spacing `scale`. */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
	const gx = x / scale;
	const gy = y / scale;
	const ix = Math.floor(gx);
	const iy = Math.floor(gy);
	const fx = smooth(gx - ix);
	const fy = smooth(gy - iy);
	const a = hash(ix, iy, seed);
	const b = hash(ix + 1, iy, seed);
	const c = hash(ix, iy + 1, seed);
	const d = hash(ix + 1, iy + 1, seed);
	return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Two octaves of value noise over the glass box, 0..255: a broad unevenness
 * and a fine grain. Pure and deterministic for a seed.
 */
export function rasterizeFrostField(
	width: number,
	height: number,
	box: { width: number; height: number },
	scales: readonly [number, number],
	seed = 7,
): Uint8Array {
	const out = new Uint8Array(width * height);
	if (box.width <= 0 || box.height <= 0) return out;
	const cellW = box.width / width;
	const cellH = box.height / height;
	for (let ty = 0; ty < height; ty += 1) {
		const y = (ty + 0.5) * cellH;
		for (let tx = 0; tx < width; tx += 1) {
			const x = (tx + 0.5) * cellW;
			const coarse = valueNoise(x, y, scales[0], seed);
			const fine = valueNoise(x, y, scales[1], seed + 101);
			out[ty * width + tx] = Math.round(Math.min(Math.max(0.65 * coarse + 0.35 * fine, 0), 1) * 255);
		}
	}
	return out;
}

/**
 * Frost strength from the stroke clock: age since the glass was last wiped
 * (the last back-stroke while resting or wiping out, the out-stroke just
 * run while wiping back), zero for FROST_DELAY_S, then 1 - exp(-age / tau).
 */
export class FrostClock {
	lastOutStart = FROST_PRESEED_S;
	lastBackStart = FROST_PRESEED_S;
	#seen = -1;

	/** Stamp stroke starts on the field clock. Call once per frame before value(). */
	note(sample: StrokeSample, time: number): void {
		if (sample.strokeIndex === this.#seen) return;
		this.#seen = sample.strokeIndex;
		if (sample.phase === 'out') this.lastOutStart = time;
		else if (sample.phase === 'back') this.lastBackStart = time;
	}

	value(phase: StrokeSample['phase'], time: number): number {
		const since = phase === 'back' ? this.lastOutStart : this.lastBackStart;
		const age = Math.max(time - since - FROST_DELAY_S, 0);
		return 1 - Math.exp(-age / FROST_TAU_S);
	}
}
