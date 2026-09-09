import { describe, expect, it } from 'vitest';
import { distanceToRect, rasterizeInkField } from './ink-field';
import { INK_FIELD_HEIGHT, INK_FIELD_WIDTH, INK_SAFE_ALPHA } from './renderer/shaders/constants';
import { SCENE_FRAGMENT } from './renderer/shaders/scene.glsl';

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
		const cellW = box.width / INK_FIELD_WIDTH;
		const cellH = box.height / INK_FIELD_HEIGHT;
		const at = (x: number, y: number) => field[Math.floor(y / cellH) * INK_FIELD_WIDTH + Math.floor(x / cellW)];
		expect(at(250, 150)).toBe(255); // inside
		expect(at(405, 150)).toBe(255); // inside the dilation
		expect(at(1200, 500)).toBe(0); // far away
		// Feather is monotonic outward along a row through the rect.
		let previous = 255;
		for (let x = 400; x < 460; x += cellW) {
			const value = at(x, 150);
			expect(value).toBeLessThanOrEqual(previous);
			previous = value;
		}
		expect(at(520, 150)).toBe(0);
	});

	it('takes the max over overlapping rects and leaves far texels untouched', () => {
		const field = rasterizeInkField(
			[
				{ left: 100, top: 100, width: 100, height: 50 },
				{ left: 150, top: 120, width: 200, height: 50 },
			],
			box,
			{ dilatePx: 4, featherPx: 20 },
		);
		const cellW = box.width / INK_FIELD_WIDTH;
		const cellH = box.height / INK_FIELD_HEIGHT;
		const at = (x: number, y: number) => field[Math.floor(y / cellH) * INK_FIELD_WIDTH + Math.floor(x / cellW)];
		expect(at(175, 130)).toBe(255); // inside both
		expect(at(340, 160)).toBe(255); // inside the second only
		expect(at(105, 105)).toBe(255); // inside the first only
		expect(at(700, 500)).toBe(0);
		// The moving field's coarser grid rasterises the same way.
		const coarse = rasterizeInkField([{ left: 100, top: 100, width: 100, height: 50 }], box, {
			width: 128,
			height: 64,
		});
		expect(coarse).toHaveLength(128 * 64);
		expect(coarse[Math.floor(125 / 10) * 128 + Math.floor(150 / 10)]).toBe(255);
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

	it('clamps the scene layer under ink and keeps the blade layer out of that budget', () => {
		// Layer 0 is the only place the ink texture is read, and the clamp is
		// its last operation; layer 1 never samples it and writes premultiplied
		// alpha over the notes instead.
		const [sceneBranch, bladeBranch] = SCENE_FRAGMENT.split('if (u_layer == 0) {')[1].split('return;\n\t}');
		expect(sceneBranch).toContain('float k = max(texture(u_ink, uv).r, texture(u_inkMoving, uv).r);');
		expect(sceneBranch).toContain('outColor = vec4(mix(u_ground, blobs, 1.0 - k * (1.0 - u_inkAlpha)), 1.0);');
		expect(bladeBranch).not.toContain('u_ink');
		expect(bladeBranch).not.toContain('u_inkAlpha');
		expect(bladeBranch).toContain('outColor = vec4(rgb, alpha);');
	});
});
