// GFTB CityLink palette v0.2.1 — generated from the ratification-ready spec
// (TIN-3853; meta spec/gftb-citylink-palette-2026-08-17.md). Do not hand-edit
// values: regenerate from the palette generators, then run the parity tests
// in palette.test.ts, which enforce agreement with styles/theme-gftb.css and
// re-derive every hex and WCAG claim from first principles.

export const FAMILIES = ['primary', 'secondary', 'tertiary', 'success', 'warning', 'error', 'surface'] as const;
export type Family = (typeof FAMILIES)[number];

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Shade = (typeof SHADES)[number];

export interface ShadeToken {
	/** sRGB hex a browser paints for the oklch() value (derived, not authored). */
	readonly hex: string;
	/** The literal oklch() value carried by theme-gftb.css. */
	readonly oklch: string;
	/** Which family pole the shade's contrast token resolves to. */
	readonly text: 'light' | 'dark';
	/** WCAG 2.1 ratio of that text choice on this shade. */
	readonly ratio: number;
}

export const palette: Record<Family, Record<Shade, ShadeToken>> = {
	primary: {
		50: { hex: '#f7f5ff', oklch: 'oklch(97.5% 0.0131 294.64deg)', text: 'dark', ratio: 14.1 },
		100: { hex: '#ddd4ff', oklch: 'oklch(89.06% 0.0593 294.64deg)', text: 'dark', ratio: 10.82 },
		200: { hex: '#c4b2ff', oklch: 'oklch(80.62% 0.1088 294.64deg)', text: 'dark', ratio: 8.09 },
		300: { hex: '#aa95eb', oklch: 'oklch(72.18% 0.1244 294.64deg)', text: 'dark', ratio: 5.95 },
		400: { hex: '#917ad1', oklch: 'oklch(63.74% 0.1281 294.64deg)', text: 'dark', ratio: 4.28 },
		500: { hex: '#7862b3', oklch: 'oklch(55.3% 0.1244 294.64deg)', text: 'light', ratio: 4.64 },
		600: { hex: '#67539c', oklch: 'oklch(49.64% 0.1137 294.64deg)', text: 'light', ratio: 5.91 },
		700: { hex: '#564682', oklch: 'oklch(43.98% 0.0969 294.64deg)', text: 'light', ratio: 7.5 },
		800: { hex: '#463a67', oklch: 'oklch(38.32% 0.0755 294.64deg)', text: 'light', ratio: 9.44 },
		900: { hex: '#362f4c', oklch: 'oklch(32.66% 0.0514 294.64deg)', text: 'light', ratio: 11.67 },
		950: { hex: '#28223a', oklch: 'oklch(27% 0.0448 294.64deg)', text: 'light', ratio: 14.1 },
	},
	secondary: {
		50: { hex: '#fff9e2', oklch: 'oklch(98% 0.0306 94.09deg)', text: 'dark', ratio: 11.16 },
		100: { hex: '#ffe99a', oklch: 'oklch(93.4% 0.1004 94.09deg)', text: 'dark', ratio: 9.74 },
		200: { hex: '#fbd853', oklch: 'oklch(88.8% 0.152 94.09deg)', text: 'dark', ratio: 8.44 },
		300: { hex: '#efc822', oklch: 'oklch(84.2% 0.1663 94.09deg)', text: 'dark', ratio: 7.26 },
		400: { hex: '#dfb900', oklch: 'oklch(79.6% 0.1633 94.09deg)', text: 'dark', ratio: 6.21 },
		500: { hex: '#ceab00', oklch: 'oklch(75% 0.1538 94.09deg)', text: 'dark', ratio: 5.3 },
		600: { hex: '#b09200', oklch: 'oklch(66.8% 0.137 94.09deg)', text: 'dark', ratio: 3.9 },
		700: { hex: '#947a00', oklch: 'oklch(58.6% 0.1202 94.09deg)', text: 'light', ratio: 3.95 },
		800: { hex: '#776307', oklch: 'oklch(50.4% 0.1009 94.09deg)', text: 'light', ratio: 5.57 },
		900: { hex: '#5a4d1c', oklch: 'oklch(42.2% 0.0687 94.09deg)', text: 'light', ratio: 7.92 },
		950: { hex: '#42370d', oklch: 'oklch(34% 0.0599 94.09deg)', text: 'light', ratio: 11.16 },
	},
	tertiary: {
		50: { hex: '#f1f9df', oklch: 'oklch(97% 0.036 121deg)', text: 'dark', ratio: 13.89 },
		100: { hex: '#d4ddbe', oklch: 'oklch(88.24% 0.0427 121deg)', text: 'dark', ratio: 10.68 },
		200: { hex: '#b7c19f', oklch: 'oklch(79.48% 0.048 121deg)', text: 'dark', ratio: 8.0 },
		300: { hex: '#9ca682', oklch: 'oklch(70.72% 0.0514 121deg)', text: 'dark', ratio: 5.88 },
		400: { hex: '#818b68', oklch: 'oklch(61.96% 0.0526 121deg)', text: 'dark', ratio: 4.18 },
		500: { hex: '#687150', oklch: 'oklch(53.2% 0.0514 121deg)', text: 'light', ratio: 4.76 },
		600: { hex: '#596243', oklch: 'oklch(47.96% 0.048 121deg)', text: 'light', ratio: 5.95 },
		700: { hex: '#4b5338', oklch: 'oklch(42.72% 0.0427 121deg)', text: 'light', ratio: 7.46 },
		800: { hex: '#3e442f', oklch: 'oklch(37.48% 0.036 121deg)', text: 'light', ratio: 9.34 },
		900: { hex: '#313626', oklch: 'oklch(32.24% 0.0283 121deg)', text: 'light', ratio: 11.48 },
		950: { hex: '#24281a', oklch: 'oklch(27% 0.0263 121deg)', text: 'light', ratio: 13.89 },
	},
	success: {
		50: { hex: '#deffe7', oklch: 'oklch(97% 0.0464 154.46deg)', text: 'dark', ratio: 13.79 },
		100: { hex: '#b0e8c1', oklch: 'oklch(88.16% 0.0775 154.46deg)', text: 'dark', ratio: 10.68 },
		200: { hex: '#8ccda2', oklch: 'oklch(79.32% 0.0909 154.46deg)', text: 'dark', ratio: 8.01 },
		300: { hex: '#6bb284', oklch: 'oklch(70.48% 0.0995 154.46deg)', text: 'dark', ratio: 5.87 },
		400: { hex: '#4e9769', oklch: 'oklch(61.64% 0.1024 154.46deg)', text: 'dark', ratio: 4.2 },
		500: { hex: '#347c51', oklch: 'oklch(52.8% 0.0995 154.46deg)', text: 'light', ratio: 4.72 },
		600: { hex: '#2b6b45', oklch: 'oklch(47.64% 0.0909 154.46deg)', text: 'light', ratio: 5.94 },
		700: { hex: '#265b3b', oklch: 'oklch(42.48% 0.0775 154.46deg)', text: 'light', ratio: 7.4 },
		800: { hex: '#244a32', oklch: 'oklch(37.32% 0.0603 154.46deg)', text: 'light', ratio: 9.31 },
		900: { hex: '#223a2a', oklch: 'oklch(32.16% 0.0411 154.46deg)', text: 'light', ratio: 11.46 },
		950: { hex: '#182c1f', oklch: 'oklch(27% 0.0358 154.46deg)', text: 'light', ratio: 13.79 },
	},
	warning: {
		50: { hex: '#fff5ed', oklch: 'oklch(97.5% 0.0153 59.82deg)', text: 'dark', ratio: 11.98 },
		100: { hex: '#ffddc3', oklch: 'oklch(92% 0.051 59.82deg)', text: 'dark', ratio: 10.05 },
		200: { hex: '#ffc597', oklch: 'oklch(86.5% 0.0897 59.82deg)', text: 'dark', ratio: 8.39 },
		300: { hex: '#ffab64', oklch: 'oklch(81% 0.1319 59.82deg)', text: 'dark', ratio: 6.91 },
		400: { hex: '#f8932f', oklch: 'oklch(75.5% 0.1607 59.82deg)', text: 'dark', ratio: 5.65 },
		500: { hex: '#e3831d', oklch: 'oklch(70% 0.156 59.82deg)', text: 'dark', ratio: 4.62 },
		600: { hex: '#c46f0f', oklch: 'oklch(62.4% 0.1426 59.82deg)', text: 'light', ratio: 3.47 },
		700: { hex: '#a35d13', oklch: 'oklch(54.8% 0.1215 59.82deg)', text: 'light', ratio: 4.73 },
		800: { hex: '#824d1b', oklch: 'oklch(47.2% 0.0947 59.82deg)', text: 'light', ratio: 6.45 },
		900: { hex: '#603e21', oklch: 'oklch(39.6% 0.0644 59.82deg)', text: 'light', ratio: 8.85 },
		950: { hex: '#482b13', oklch: 'oklch(32% 0.0562 59.82deg)', text: 'light', ratio: 11.98 },
	},
	error: {
		50: { hex: '#fff2f0', oklch: 'oklch(97% 0.0147 23.2deg)', text: 'dark', ratio: 14.61 },
		100: { hex: '#ffcbc7', oklch: 'oklch(88.7% 0.0594 23.2deg)', text: 'dark', ratio: 11.12 },
		200: { hex: '#ffa29d', oklch: 'oklch(80.4% 0.1116 23.2deg)', text: 'dark', ratio: 8.29 },
		300: { hex: '#f37c79', oklch: 'oklch(72.1% 0.146 23.2deg)', text: 'dark', ratio: 6.06 },
		400: { hex: '#dc5d5c', oklch: 'oklch(63.8% 0.1598 23.2deg)', text: 'dark', ratio: 4.38 },
		500: { hex: '#c04042', oklch: 'oklch(55.5% 0.1645 23.2deg)', text: 'light', ratio: 4.74 },
		600: { hex: '#aa2f33', oklch: 'oklch(49.6% 0.1598 23.2deg)', text: 'light', ratio: 6.07 },
		700: { hex: '#912328', oklch: 'oklch(43.7% 0.146 23.2deg)', text: 'light', ratio: 7.76 },
		800: { hex: '#761c20', oklch: 'oklch(37.8% 0.1244 23.2deg)', text: 'light', ratio: 9.82 },
		900: { hex: '#5a181a', oklch: 'oklch(31.9% 0.0969 23.2deg)', text: 'light', ratio: 12.16 },
		950: { hex: '#3e1414', oklch: 'oklch(26% 0.066 23.2deg)', text: 'light', ratio: 14.61 },
	},
	surface: {
		50: { hex: '#fffdf7', oklch: 'oklch(99.393% 0.0082 91.48deg)', text: 'dark', ratio: 15.25 },
		100: { hex: '#f7f0df', oklch: 'oklch(95.604% 0.0237 88.23deg)', text: 'dark', ratio: 13.65 },
		200: { hex: '#e7ddca', oklch: 'oklch(90.144% 0.0283 84deg)', text: 'dark', ratio: 11.52 },
		300: { hex: '#d8cbb5', oklch: 'oklch(84.684% 0.0331 80.97deg)', text: 'dark', ratio: 9.7 },
		400: { hex: '#beb4a7', oklch: 'oklch(77.5% 0.0216 76.41deg)', text: 'dark', ratio: 7.59 },
		500: { hex: '#9e978f', oklch: 'oklch(68% 0.0136 69.19deg)', text: 'dark', ratio: 5.37 },
		600: { hex: '#7e7875', oklch: 'oklch(57.8% 0.0087 56.63deg)', text: 'light', ratio: 4.27 },
		700: { hex: '#625d5c', oklch: 'oklch(48.2% 0.0065 33.58deg)', text: 'light', ratio: 6.37 },
		800: { hex: '#494445', oklch: 'oklch(39.2% 0.007 359.25deg)', text: 'light', ratio: 9.4 },
		900: { hex: '#363035', oklch: 'oklch(31.8% 0.011 330.62deg)', text: 'light', ratio: 12.66 },
		950: { hex: '#28222b', oklch: 'oklch(26.25% 0.0186 314.48deg)', text: 'light', ratio: 15.25 },
	},
};

/** Measured livery anchors (uncorrected iPhone captures, overcast; spec v0.2.1). */
export const measuredAnchors = {
	bodyPurpleBroadside: { hex: '#8e7bc6', oklchHue: 294.64 },
	stanchionYellowLitPole: { hex: '#d5b327', oklchHue: 94.09 },
	wordmarkLinkOlive: { hex: '#757e60', oklchHue: 121.0 },
	turnSignalAmber: { hex: '#c7731d', oklchHue: 59.82 },
} as const;

/** Tokens pinned away from Skeleton defaults for AA (see spec, Contrast section). */
export const pinnedTokens = {
	'--typo-anchor--color-light': 'var(--color-primary-700)',
	'--typo-anchor--color-dark': 'var(--color-primary-300)',
	'--color-brand-light': 'var(--color-primary-500)',
	'--color-brand-dark': 'var(--color-primary-300)',
} as const;

/** The exhaustive disclosed set of shades whose best in-family text ratio is < 4.5.
 * Large-text/decorative use only. The parity tests fail if this set drifts. */
export const disclosedSubAaShades = [
	'primary-400',
	'secondary-600',
	'secondary-700',
	'tertiary-400',
	'success-400',
	'warning-600',
	'error-400',
	'surface-600',
] as const;

/** Families whose 500 fill fails WCAG 1.4.11 (3:1) against surface-50 — require
 * a border or tonal preset on paper surfaces. */
export const fillContrastExceptions = ['secondary', 'warning'] as const;

/** Shipped tokens carried into the surface ramp as exact members. */
export const exactSurfaceMembers: Readonly<Partial<Record<Shade, string>>> = {
	50: '#fffdf7',
	100: '#f7f0df',
	300: '#d8cbb5',
	950: '#28222b',
};
