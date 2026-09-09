import { describe, expect, it } from 'vitest';
import { distanceToRect, rasterizeInkField } from './ink-field';
import { DROP_SPEC, FROST_MAX, INK_FIELD_HEIGHT, INK_FIELD_WIDTH, INK_SAFE_ALPHA } from './renderer/shaders/constants';
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

// The glass (M4) sits before the clamp like the blobs. Its worst pixels are a
// bead's darkened rim (ground times 0.72 in light), a bead's specular point
// (ground plus DROP_SPEC) and full frost (ground pulled FROST_MAX toward the
// frost tint). Under measured text each is pulled back to the ground by
// 1 - INK_SAFE_ALPHA, and every text role must still clear its floor. A
// failure here lowers DROP_SPEC or FROST_MAX, never the clamp.
describe('the glass under the ink clamp', () => {
	const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const luminance = (rgb: readonly [number, number, number]) =>
		0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
	const contrast = (a: readonly [number, number, number], b: readonly [number, number, number]) => {
		const la = luminance(a);
		const lb = luminance(b);
		return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
	};
	const hex = (value: string): [number, number, number] => {
		const n = Number.parseInt(value.slice(1), 16);
		return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
	};
	const mix = (a: readonly [number, number, number], b: readonly [number, number, number], t: number) =>
		[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as [number, number, number];
	const clampToGround = (ground: [number, number, number], scene: [number, number, number]) =>
		mix(ground, scene, INK_SAFE_ALPHA);

	const schemes = [
		{
			name: 'light',
			ground: hex('#f7f0df'),
			tint: [0.97, 0.98, 1.0] as [number, number, number],
			frostMax: FROST_MAX[0],
			roles: { fg: hex('#28222b'), muted: hex('#625d5c'), link: hex('#564682'), heading: hex('#463a67') },
		},
		{
			name: 'dark',
			ground: hex('#1a1620'),
			tint: [0.62, 0.66, 0.76] as [number, number, number],
			frostMax: FROST_MAX[1],
			roles: { fg: hex('#f2ecdf'), muted: hex('#c9c2b8'), link: hex('#c9b8f0'), heading: hex('#e6dcff') },
		},
	];

	for (const scheme of schemes) {
		it(`clears every text role's floor in ${scheme.name}`, () => {
			const { ground } = scheme;
			const rim = mix(ground, [ground[0] * 0.72, ground[1] * 0.72, ground[2] * 0.72], 1);
			const spec = [
				Math.min(ground[0] + DROP_SPEC, 1),
				Math.min(ground[1] + DROP_SPEC, 1),
				Math.min(ground[2] + DROP_SPEC, 1),
			] as [number, number, number];
			const frost = mix(ground, scheme.tint, scheme.frostMax);
			for (const worst of [rim, spec, frost]) {
				const seen = clampToGround(ground, worst);
				expect(contrast(scheme.roles.fg, seen)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(scheme.roles.muted, seen)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(scheme.roles.link, seen)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(scheme.roles.heading, seen)).toBeGreaterThanOrEqual(3);
			}
		});
	}
});
