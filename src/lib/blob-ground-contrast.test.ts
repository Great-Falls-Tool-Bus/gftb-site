import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, roundRatio, type Rgb } from '../../scripts/lib/color-contrast.mjs';
import { resolveRole, schemes } from '../../scripts/lib/css-tokens.mjs';

// Analytic worst-case ground under the brand-vectors layer (operator ruling
// 2026-09-09: opacity 0.2). tinyvectors paints each blob with mix-blend-mode
// multiply in light mode and screen in dark mode (BlobSVG.svelte, v0.3.7),
// inside a container at the layout's opacity. A screenshot of the live layer
// samples one frame of a randomly seeded, moving field and cannot gate this;
// compositing every blob colour at full blob opacity over --bg is the worst
// pixel one blob can put under body copy, and it is deterministic.
//
// Why one blob and not two stacked: the two-stack composite fails --fg-muted
// (light) and --link (dark) at EVERY useful opacity, including the 0.1 that
// shipped before this ruling (matrix in the TIN-4334 record), so it is not a
// gate anyone can pass; blobs are soft radial gradients at 0.75/0.9 group
// opacity, so a full-colour overlap of two is well beyond what the layer
// paints. One full blob is the honest ceiling. The 2026-09-09 ruling's
// fallback applies: the layer runs at 0.15, where every role clears its
// floor under one blob in both schemes (dark links at exactly 4.5).

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

/** One blob at the layer's opacity, blended per the scheme, over a backdrop. */
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
