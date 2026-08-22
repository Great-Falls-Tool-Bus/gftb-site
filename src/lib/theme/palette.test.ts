import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	FAMILIES,
	SHADES,
	disclosedSubAaShades,
	exactSurfaceMembers,
	fillContrastExceptions,
	palette,
	pinnedTokens,
	type Family,
	type Shade,
} from './palette';

// Every assertion here re-derives its numbers from first principles (Ottosson
// OKLab + WCAG 2.1 relative luminance) so palette.ts, theme-gftb.css, and the
// meta spec's claims cannot drift apart silently.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const themeCss = readFileSync(path.join(repoRoot, 'src/lib/styles/theme-gftb.css'), 'utf8');

// ---- color math ------------------------------------------------------------

const srgbToLinear = (c: number): number => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb8 = (c: number): number => {
	const clamped = Math.min(1, Math.max(0, c));
	const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
	return Math.round(v * 255);
};

const oklchToHex = (l: number, c: number, hDeg: number): string => {
	const h = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
	const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
	const b2 = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
	const to2 = (n: number) => linearToSrgb8(n).toString(16).padStart(2, '0');
	return `#${to2(r)}${to2(g)}${to2(b2)}`;
};

const parseOklch = (value: string): { l: number; c: number; h: number } => {
	const match = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)deg\)$/.exec(value);
	if (!match) throw new Error(`unparseable oklch value: ${value}`);
	return { l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) };
};

const wcagLuminance = (hex: string): number => {
	const r = srgbToLinear(parseInt(hex.slice(1, 3), 16));
	const g = srgbToLinear(parseInt(hex.slice(3, 5), 16));
	const b = srgbToLinear(parseInt(hex.slice(5, 7), 16));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (hexA: string, hexB: string): number => {
	const la = wcagLuminance(hexA);
	const lb = wcagLuminance(hexB);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// ---- CSS parsing -----------------------------------------------------------

const cssColorTokens = new Map<string, string>();
for (const match of themeCss.matchAll(/--color-([a-z]+)-(\d+):\s*(oklch\([^)]+\));/g)) {
	cssColorTokens.set(`${match[1]}-${match[2]}`, match[3]);
}

const cssContrastRefs = new Map<string, 'light' | 'dark'>();
for (const match of themeCss.matchAll(/--color-([a-z]+)-contrast-(\d+):\s*var\(--color-\1-contrast-(light|dark)\);/g)) {
	cssContrastRefs.set(`${match[1]}-${match[2]}`, match[3] as 'light' | 'dark');
}

const allTokenNames = FAMILIES.flatMap((family) => SHADES.map((shade) => `${family}-${shade}`));

describe('theme-gftb.css <-> palette.ts parity', () => {
	it('carries exactly the 77 color tokens, no more, no fewer', () => {
		expect([...cssColorTokens.keys()].sort()).toEqual([...allTokenNames].sort());
	});

	it('every oklch value in the CSS matches palette.ts literally', () => {
		for (const family of FAMILIES) {
			for (const shade of SHADES) {
				expect(cssColorTokens.get(`${family}-${shade}`), `${family}-${shade}`).toBe(palette[family][shade].oklch);
			}
		}
	});

	it('every per-shade contrast token points where palette.ts says it does', () => {
		for (const family of FAMILIES) {
			for (const shade of SHADES) {
				expect(cssContrastRefs.get(`${family}-${shade}`), `${family}-${shade}`).toBe(palette[family][shade].text);
			}
		}
	});

	it('declares the contrast poles as family 950/50 for every family', () => {
		for (const family of FAMILIES) {
			expect(themeCss).toContain(`--color-${family}-contrast-dark: var(--color-${family}-950);`);
			expect(themeCss).toContain(`--color-${family}-contrast-light: var(--color-${family}-50);`);
		}
	});

	it('pins the AA-safe anchor and brand tokens', () => {
		for (const [token, value] of Object.entries(pinnedTokens)) {
			expect(themeCss).toContain(`${token}: ${value};`);
		}
	});
});

describe('color math: documented hexes are what the oklch values paint', () => {
	it('round-trips all 77 oklch values to their documented hex', () => {
		for (const family of FAMILIES) {
			for (const shade of SHADES) {
				const token = palette[family][shade];
				const { l, c, h } = parseOklch(token.oklch);
				expect(oklchToHex(l, c, h), `${family}-${shade}`).toBe(token.hex);
			}
		}
	});

	it('keeps the shipped warm neutrals as exact surface members', () => {
		for (const [shade, hex] of Object.entries(exactSurfaceMembers)) {
			expect(palette.surface[Number(shade) as Shade].hex).toBe(hex);
		}
	});

	it('keeps ink identity: surface-950 equals the shipped --ink', () => {
		const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
		const ink = /--ink:\s*(#[0-9a-f]{6});/.exec(appCss)?.[1];
		expect(ink).toBeDefined();
		expect(palette.surface[950].hex).toBe(ink);
	});
});

describe('WCAG claims (recomputed, not trusted)', () => {
	const bestInFamilyRatio = (family: Family, shade: Shade): number => {
		const hex = palette[family][shade].hex;
		return Math.max(contrast(hex, palette[family][50].hex), contrast(hex, palette[family][950].hex));
	};

	it('every recorded ratio matches a fresh computation within 0.01', () => {
		for (const family of FAMILIES) {
			for (const shade of SHADES) {
				const token = palette[family][shade];
				const pole = token.text === 'light' ? palette[family][50].hex : palette[family][950].hex;
				expect(Math.abs(contrast(token.hex, pole) - token.ratio), `${family}-${shade}`).toBeLessThan(0.01);
			}
		}
	});

	it('every 500 slot is AA (>= 4.5) with its contrast token', () => {
		for (const family of FAMILIES) {
			expect(palette[family][500].ratio, family).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('the pinned light/dark anchors are AA on their grounds', () => {
		expect(contrast(palette.primary[700].hex, palette.surface[50].hex)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.primary[300].hex, palette.surface[950].hex)).toBeGreaterThanOrEqual(4.5);
	});

	it('body text holds: ink on paper and on cream stay >= 13', () => {
		expect(contrast(palette.surface[950].hex, palette.surface[50].hex)).toBeGreaterThanOrEqual(13);
		expect(contrast(palette.surface[950].hex, palette.surface[100].hex)).toBeGreaterThanOrEqual(13);
	});

	it('the disclosed sub-AA set is exhaustive and exact', () => {
		const computed = allTokenNames.filter((name) => {
			const [family, shade] = name.split('-') as [Family, string];
			return bestInFamilyRatio(family, Number(shade) as Shade) < 4.5;
		});
		expect(computed.sort()).toEqual([...disclosedSubAaShades].sort());
	});

	it('exactly the disclosed families fail the 3:1 fill check on paper', () => {
		const accentFamilies = FAMILIES.filter((family) => family !== 'surface');
		const failing = accentFamilies.filter((family) => contrast(palette[family][500].hex, palette.surface[50].hex) < 3);
		expect(failing.sort()).toEqual([...fillContrastExceptions].sort());
	});
});
