import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, roundRatio } from '../../../scripts/lib/color-contrast.mjs';
import { resolveRole, schemes } from '../../../scripts/lib/css-tokens.mjs';
import { BRAND_BLOB_COLORS } from '../brand-blob-colors';
import { distanceToRect, rasterizeInkField } from './ink-field';
import {
	DROP_RIM_DARKEN,
	DROP_RIM_LIGHTEN,
	DROP_SPEC,
	FROST_MAX,
	INK_FIELD_HEIGHT,
	INK_FIELD_WIDTH,
	INK_SAFE_ALPHA,
} from './renderer/shaders/constants';
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

// The glass (M4) sits before the clamp like the blobs, and it is gated by
// the ink field: under measured text (k = 1) beads and frost contribute
// nothing, because the blob field alone spends the ratified budget there
// (dark links sit at the floor under one blob). This pin holds the gate to
// the same standard the blob field meets: at any ink coverage k, the worst
// glass pixel (a bead's rim, a bead's specular point, full frost, each over
// the blob field's own worst case) may cost a role at most what the blob
// field already costs it there, and under text the floor holds outright.
// Palette through the ratified resolver, so a token change moves this too.
describe('the glass under the ink clamp', () => {
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
	const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
	const themeCss = readFileSync(path.join(repoRoot, 'src/lib/styles/theme-gftb.css'), 'utf8');
	const SCHEMES = schemes({ appCss, themeCss });
	type Rgb = { red: number; green: number; blue: number; alpha: number };
	type Vec = [number, number, number];
	const role = (tokens: (typeof SCHEMES)[keyof typeof SCHEMES], name: string): Rgb => ({
		...(resolveRole(tokens, name) as Omit<Rgb, 'alpha'>),
		alpha: 1,
	});
	const toVec = (rgb: Rgb): Vec => [rgb.red / 255, rgb.green / 255, rgb.blue / 255];
	const toRgb = (v: Vec): Rgb => ({
		red: Math.round(Math.min(Math.max(v[0], 0), 1) * 255),
		green: Math.round(Math.min(Math.max(v[1], 0), 1) * 255),
		blue: Math.round(Math.min(Math.max(v[2], 0), 1) * 255),
		alpha: 1,
	});
	const hexVec = (value: string): Vec => {
		const n = Number.parseInt(value.replace('#', ''), 16);
		return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
	};
	const mix = (a: Vec, b: Vec, t: number): Vec => [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	];
	const add = (a: Vec, k: number): Vec => [a[0] + k, a[1] + k, a[2] + k];
	const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
	const blend = (scheme: string, g: Vec, c: Vec): Vec =>
		scheme === 'dark'
			? [1 - (1 - g[0]) * (1 - c[0]), 1 - (1 - g[1]) * (1 - c[1]), 1 - (1 - g[2]) * (1 - c[2])]
			: [g[0] * c[0], g[1] * c[1], g[2] * c[2]];
	const BLOB_COVER_CAP = 0.72;
	const ROLES = [
		'--fg',
		'--fg-muted',
		'--link',
		'--heading',
		'--glass-fg',
		'--glass-muted',
		'--glass-link',
		'--glass-heading',
	];
	const FLOORS: Record<string, number> = { '--heading': 3, '--glass-heading': 3 };

	for (const scheme of Object.keys(SCHEMES)) {
		it(`adds nothing under text and costs no more than the blob field across the feather (${scheme})`, () => {
			const tokens = SCHEMES[scheme as keyof typeof SCHEMES];
			const ground = toVec(role(tokens, '--bg'));
			const tint: Vec = scheme === 'dark' ? [0.62, 0.66, 0.76] : [0.97, 0.98, 1.0];
			const frostMax = scheme === 'dark' ? FROST_MAX[1] : FROST_MAX[0];
			const fields: Vec[] = [
				ground,
				...BRAND_BLOB_COLORS.map((c) => mix(ground, blend(scheme, ground, hexVec(c)), BLOB_COVER_CAP)),
			];
			// The shader's composite at ink coverage k: glass gated by (1 - k), then the clamp.
			const composite = (field: Vec, glassPixel: Vec, k: number): Rgb => {
				const withGlass = mix(field, glassPixel, 1 - k);
				return toRgb(mix(ground, withGlass, 1 - k * (1 - INK_SAFE_ALPHA)));
			};
			for (const field of fields) {
				const glassPixels: Vec[] = [
					scheme === 'dark' ? add(field, DROP_RIM_LIGHTEN) : scale(field, DROP_RIM_DARKEN),
					add(field, DROP_SPEC),
					mix(mix(field, mix(ground, field, 0.6), 0.5), tint, frostMax),
				];
				// k = 1 is measured text (dilated 14px past every rect); k = 0.9 is the
				// first tenth of the 96px feather beyond it, where no glyph sits.
				for (const k of [1, 0.9]) {
					const bare = composite(field, field, k);
					for (const glassPixel of glassPixels) {
						const seen = composite(field, glassPixel, k);
						for (const name of ROLES) {
							const ink = role(tokens, name);
							const withGlass = roundRatio(contrastRatio(ink, seen));
							const withoutGlass = roundRatio(contrastRatio(ink, bare));
							const floor = FLOORS[name] ?? 4.5;
							if (k === 1) {
								expect(withGlass, `${name} under text in ${scheme}`).toBeGreaterThanOrEqual(floor);
								expect(seen).toEqual(bare);
							} else if (withoutGlass >= floor) {
								expect(withGlass, `${name} at k=${k} in ${scheme}`).toBeGreaterThanOrEqual(
									Math.min(floor, withoutGlass) - 0.35,
								);
							}
						}
					}
				}
			}
		});
	}
});
