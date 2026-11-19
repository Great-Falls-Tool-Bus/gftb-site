import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, roundRatio, type Rgb } from '../../scripts/lib/color-contrast.mjs';
import { resolveRole, schemes } from '../../scripts/lib/css-tokens.mjs';

// The 2026-09-09 ruling requested opacity 0.2. BlobSVG.svelte in v0.3.7 multiplies in light
// mode and screens in dark mode. Composite one full-colour blob over --bg for a repeatable
// worst case. A screenshot samples only one frame. TIN-4334 records that stacking two solid
// blobs fails --fg-muted in light and --link in dark even at 0.1. The actual blobs have
// soft gradients and 0.75/0.9 group opacity. At the ruling’s fallback of 0.15, all roles
// pass under one blob. Dark links reach exactly 4.5.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
const themeCss = readFileSync(path.join(repoRoot, 'src/lib/styles/theme-gftb.css'), 'utf8');
const layout = readFileSync(path.join(repoRoot, 'src/routes/+layout.svelte'), 'utf8');
const SCHEMES = schemes({ appCss, themeCss });

function layoutMount() {
	const block = layout.match(/<TinyVectors[\s\S]*?\/>/u)?.[0] ?? '';
	const opacity = Number(block.match(/opacity=\{([\d.]+)\}/u)?.[1]);
	const colors = [...block.matchAll(/'#([0-9a-fA-F]{6})'/gu)].map((m) => m[1]);
	return { opacity, colors };
}

const hex = (value: string): Rgb => ({
	red: Number.parseInt(value.slice(0, 2), 16),
	green: Number.parseInt(value.slice(2, 4), 16),
	blue: Number.parseInt(value.slice(4, 6), 16),
	alpha: 1,
});

function blend(scheme: string, backdrop: number, color: number): number {
	return scheme === 'dark' ? 255 - ((255 - backdrop) * (255 - color)) / 255 : (backdrop * color) / 255;
}

/**
 * Blend one blob over the backdrop at the layer’s opacity for this scheme.
 */
function layer(scheme: string, backdrop: Rgb, color: Rgb, alpha: number): Rgb {
	const mix = (b: number, c: number) => Math.round(b * (1 - alpha) + alpha * blend(scheme, b, c));
	return {
		red: mix(backdrop.red, color.red),
		green: mix(backdrop.green, color.green),
		blue: mix(backdrop.blue, color.blue),
		alpha: 1,
	};
}

describe('blob layer worst-case ground (analytic gate for the layer opacity)', () => {
	const { opacity, colors } = layoutMount();

	it('reads the mount it gates', () => {
		expect(opacity).toBeGreaterThan(0);
		expect(opacity).toBeLessThanOrEqual(0.15);
		expect(colors.length).toBeGreaterThanOrEqual(5);
	});

	for (const scheme of Object.keys(SCHEMES)) {
		it(`keeps body copy on bare ground at its floor under any one blob (${scheme})`, () => {
			const tokens = SCHEMES[scheme as keyof typeof SCHEMES];
			const bg = resolveRole(tokens, '--bg');
			const grounds: Rgb[] = [bg, ...colors.map((a) => layer(scheme, bg, hex(a), opacity))];
			const worst = (role: string) => {
				const ink = resolveRole(tokens, role);
				return Math.min(...grounds.map((g) => roundRatio(contrastRatio(ink, g))));
			};
			expect(worst('--fg'), 'body copy').toBeGreaterThanOrEqual(4.5);
			expect(worst('--fg-muted'), 'muted copy').toBeGreaterThanOrEqual(4.5);
			expect(worst('--link'), 'links').toBeGreaterThanOrEqual(4.5);
			expect(worst('--heading'), 'headings (large)').toBeGreaterThanOrEqual(3);
		});
	}
});
