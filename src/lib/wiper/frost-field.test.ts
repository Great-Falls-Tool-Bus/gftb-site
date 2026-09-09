import { describe, expect, it } from 'vitest';
import { FrostClock, rasterizeFrostField } from './frost-field';
import { FROST_DELAY_S, FROST_SCALES_PX } from './renderer/shaders/constants';

describe('the frost raster', () => {
	it('is deterministic per seed, covers the range and has both coarse and fine structure', () => {
		const a = rasterizeFrostField(64, 32, { width: 1152, height: 620 }, FROST_SCALES_PX, 7);
		const b = rasterizeFrostField(64, 32, { width: 1152, height: 620 }, FROST_SCALES_PX, 7);
		const c = rasterizeFrostField(64, 32, { width: 1152, height: 620 }, FROST_SCALES_PX, 8);
		expect(a).toEqual(b);
		expect(a.some((v, i) => v !== c[i])).toBe(true);
		expect(Math.max(...a)).toBeGreaterThan(140);
		expect(Math.min(...a)).toBeLessThan(115);
		let steps = 0;
		for (let i = 1; i < a.length; i += 1) if (i % 64 !== 0) steps += Math.abs(a[i] - a[i - 1]);
		expect(steps / a.length).toBeGreaterThan(2);
	});
});

describe('FrostClock', () => {
	it('stays at zero for the delay after a pass and grows through a rest', () => {
		const clock = new FrostClock();
		// Preseeded: the field mounts already frosted.
		expect(clock.value('dwell', 0)).toBeGreaterThan(0);
		clock.note({ phase: 'out', t: 0, strokeIndex: 1, passesDone: 0 }, 10);
		clock.note({ phase: 'back', t: 0, strokeIndex: 2, passesDone: 1 }, 11.3);
		expect(clock.value('back', 11.3)).toBeCloseTo(0, 6);
		expect(clock.value('dwell', 12.6)).toBeCloseTo(0, 9);
		expect(clock.value('dwell', 11.3 + FROST_DELAY_S)).toBeCloseTo(0, 9);
		const early = clock.value('dwell', 11.3 + FROST_DELAY_S + 1);
		const late = clock.value('dwell', 11.3 + FROST_DELAY_S + 4);
		expect(early).toBeGreaterThan(0);
		expect(late).toBeGreaterThan(early);
		expect(late).toBeLessThan(1);
		// A second note of the same stroke changes nothing.
		clock.note({ phase: 'back', t: 0.5, strokeIndex: 2, passesDone: 1 }, 12);
		expect(clock.lastBackStart).toBe(11.3);
	});
});
