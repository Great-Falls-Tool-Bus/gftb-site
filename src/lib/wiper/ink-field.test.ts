import { describe, expect, it } from 'vitest';
import { distanceToRect, rasterizeInkField } from './ink-field';
import { INK_FIELD_HEIGHT, INK_FIELD_WIDTH, INK_SAFE_ALPHA } from './renderer/shaders/constants';

describe('the ink field raster', () => {
	const box = { width: 1280, height: 640 };

	it('is empty with no text and full under a rect covering the box', () => {
		const empty = rasterizeInkField([], box);
		expect(empty).toHaveLength(INK_FIELD_WIDTH * INK_FIELD_HEIGHT);
		expect(Math.max(...empty)).toBe(0);
		const full = rasterizeInkField([{ left: -20, top: -20, width: 1320, height: 680 }], box);
		expect(Math.min(...full)).toBe(255);
	});

	it('marks the text rect, feathers past its dilation, and leaves the far side clear', () => {
		const field = rasterizeInkField([{ left: 100, top: 100, width: 300, height: 100 }], box, {
			dilatePx: 8,
			featherPx: 10,
		});
		const at = (x: number, y: number) => field[Math.floor(y / 10) * INK_FIELD_WIDTH + Math.floor(x / 10)];
		expect(at(250, 150)).toBe(255); // inside
		expect(at(405, 150)).toBe(255); // inside the dilation
		expect(at(1200, 500)).toBe(0); // far away
		// Feather is monotonic outward along a row through the rect.
		let previous = 255;
		for (let x = 400; x < 460; x += 10) {
			const value = at(x, 150);
			expect(value).toBeLessThanOrEqual(previous);
			previous = value;
		}
		expect(at(520, 150)).toBe(0);
	});

	it('measures distance to a rect edge as zero inside and Euclidean outside', () => {
		const rect = { left: 10, top: 10, width: 20, height: 20 };
		expect(distanceToRect(20, 20, rect)).toBe(0);
		expect(distanceToRect(40, 20, rect)).toBe(10);
		expect(distanceToRect(34, 33, rect)).toBeCloseTo(5, 6);
	});

	it('keeps the clamp at the ratified blob-ground ceiling', () => {
		expect(INK_SAFE_ALPHA).toBeLessThanOrEqual(0.15);
		expect(INK_SAFE_ALPHA).toBeGreaterThan(0);
	});
});
