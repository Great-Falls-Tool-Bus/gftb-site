import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WIPER_DETENT,
	strokeEaseInverse,
	INTERMITTENT_JITTER,
	SWEEP_MS,
	WIPER_DETENTS,
	dwellFor,
	isWiperDetent,
	pageCountFor,
	pageOf,
	strokeEase,
	wiperDetent,
} from './schedule';

describe('the wiper stalk table', () => {
	it('starts at Off and runs to faster detents', () => {
		expect(WIPER_DETENTS.map((entry) => entry.id)).toEqual(['off', 'intermittent', 'low', 'high']);
		expect(WIPER_DETENTS[0]).toMatchObject({ dwellMs: 0, sweepMs: 0 });
		expect(isWiperDetent(DEFAULT_WIPER_DETENT)).toBe(true);
		expect(DEFAULT_WIPER_DETENT).not.toBe('off');
	});

	it('keeps dwell strictly decreasing, the sweep the same at every speed, and every sweep shorter than its dwell', () => {
		const active = WIPER_DETENTS.filter((entry) => entry.id !== 'off');
		for (let index = 1; index < active.length; index += 1) {
			expect(active[index].dwellMs).toBeLessThan(active[index - 1].dwellMs);
		}
		for (const entry of active) {
			expect(entry.sweepMs).toBe(SWEEP_MS);
			expect(entry.sweepMs).toBeGreaterThan(0);
			expect(entry.sweepMs).toBeLessThan(entry.dwellMs);
		}
		// Long enough to read as a wiper once the blades are drawn: 0.9 s per stroke.
		expect(SWEEP_MS).toBeGreaterThanOrEqual(1600);
	});

	it('jitters only the intermittent dwell, inside its band', () => {
		const [low, high] = INTERMITTENT_JITTER;
		const base = wiperDetent('intermittent').dwellMs;
		expect(dwellFor('intermittent', () => 0)).toBe(Math.round(base * low));
		expect(dwellFor('intermittent', () => 1)).toBe(Math.round(base * high));
		expect(dwellFor('intermittent', () => 5)).toBe(Math.round(base * high));
		expect(dwellFor('low', () => 0)).toBe(wiperDetent('low').dwellMs);
		expect(dwellFor('high', () => 1)).toBe(wiperDetent('high').dwellMs);
		expect(dwellFor('off')).toBe(0);
	});

	it('rejects unknown detents', () => {
		expect(isWiperDetent('turbo')).toBe(false);
		expect(() => wiperDetent('turbo' as never)).toThrow(/unknown detent/u);
	});
});

describe('stroke easing and page arithmetic', () => {
	it('eases symmetrically from 0 to 1 and never overshoots', () => {
		expect(strokeEase(0)).toBe(0);
		expect(strokeEase(1)).toBeCloseTo(1, 12);
		expect(strokeEase(0.5)).toBeCloseTo(0.5, 12);
		expect(strokeEase(-1)).toBe(0);
		expect(strokeEase(2)).toBeCloseTo(1, 12);
		let previous = 0;
		for (let step = 1; step <= 100; step += 1) {
			const value = strokeEase(step / 100);
			expect(value).toBeGreaterThanOrEqual(previous);
			previous = value;
		}
	});

	it('pages items three-up and one-up without dropping the tail', () => {
		expect(pageCountFor(10, 3)).toBe(4);
		expect(pageCountFor(10, 1)).toBe(10);
		expect(pageCountFor(0, 3)).toBe(1);
		expect(pageCountFor(3, 0)).toBe(3);
		expect(pageOf(0, 3)).toBe(0);
		expect(pageOf(9, 3)).toBe(3);
		expect(pageOf(4, 1)).toBe(4);
	});
});

describe('strokeEaseInverse', () => {
	it('undoes strokeEase across the stroke and clamps outside it', () => {
		for (let step = 0; step <= 20; step += 1) {
			const t = step / 20;
			expect(strokeEaseInverse(strokeEase(t))).toBeCloseTo(t, 9);
		}
		expect(strokeEaseInverse(-1)).toBe(0);
		expect(strokeEaseInverse(2)).toBe(1);
	});
});
