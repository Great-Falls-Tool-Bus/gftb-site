import { describe, expect, it, vi } from 'vitest';

// Unit contract for the responsive-image srcset builder (TIN-2224 consumer).
//
// The module reads `static/image-manifest.json` at import time, so a synthetic
// manifest is injected via `vi.mock` (hoisted) to exercise the real derivative
// logic without depending on committed photos. Covered behaviors:
//   - graceful degrade: missing/empty/undefined src -> plain fallback
//   - path normalization: leading slash + extension are stripped to the key
//   - ascending-width srcset ordering
//   - MIN_RESPONSIVE_WIDTH guard: small-only images opt OUT of srcset
//   - retina cap: a webp original tops the webp srcset at xlarge*2; avif never
//   - intrinsic size passthrough for CLS box reservation

const { MOCK } = vi.hoisted(() => ({
	MOCK: {
		// Full ladder, webp original -> webp srcset gets the retina cap.
		'photos/wide': {
			type: 'raster',
			original: '/photos/wide.webp',
			width: 4000,
			height: 2000,
			optimized: {
				webp: {
					thumbnail: '/optimized/photos/wide-thumbnail.webp',
					small: '/optimized/photos/wide-small.webp',
					medium: '/optimized/photos/wide-medium.webp',
					large: '/optimized/photos/wide-large.webp',
					xlarge: '/optimized/photos/wide-xlarge.webp',
				},
				avif: {
					thumbnail: '/optimized/photos/wide-thumbnail.avif',
					small: '/optimized/photos/wide-small.avif',
					medium: '/optimized/photos/wide-medium.avif',
					large: '/optimized/photos/wide-large.avif',
					xlarge: '/optimized/photos/wide-xlarge.avif',
				},
			},
		},
		// jpg original tops out at large (1200w): responsive, but no retina cap.
		'photos/mid': {
			type: 'raster',
			original: '/photos/mid.jpg',
			width: 1500,
			height: 1000,
			optimized: {
				webp: {
					small: '/optimized/photos/mid-small.webp',
					medium: '/optimized/photos/mid-medium.webp',
					large: '/optimized/photos/mid-large.webp',
				},
				avif: {
					small: '/optimized/photos/mid-small.avif',
					medium: '/optimized/photos/mid-medium.avif',
					large: '/optimized/photos/mid-large.avif',
				},
			},
		},
		// Only thumbnail/small derivatives: below MIN_RESPONSIVE_WIDTH, opts out.
		'photos/tiny': {
			type: 'raster',
			original: '/photos/tiny.png',
			width: 300,
			height: 200,
			optimized: {
				webp: {
					thumbnail: '/optimized/photos/tiny-thumbnail.webp',
					small: '/optimized/photos/tiny-small.webp',
				},
				avif: {
					thumbnail: '/optimized/photos/tiny-thumbnail.avif',
					small: '/optimized/photos/tiny-small.avif',
				},
			},
		},
		// Vector: no raster srcset, no intrinsic size.
		logo: {
			type: 'vector',
			original: '/logo.svg',
			optimized: { svg: '/optimized/logo.svg' },
		},
	},
}));

vi.mock('../../static/image-manifest.json', () => ({ default: MOCK }));

const { intrinsicSize, responsiveSources } = await import('./responsive-image');

describe('responsiveSources', () => {
	it('returns an empty, source-less result for falsy input', () => {
		expect(responsiveSources(undefined)).toEqual({ fallback: '', hasSources: false });
		expect(responsiveSources(null)).toEqual({ fallback: '', hasSources: false });
		expect(responsiveSources('')).toEqual({ fallback: '', hasSources: false });
	});

	it('degrades to a plain fallback when the manifest has no entry', () => {
		const r = responsiveSources('nope/missing.jpg');
		expect(r.fallback).toBe('/nope/missing.jpg');
		expect(r.hasSources).toBe(false);
		expect(r.avif).toBeUndefined();
		expect(r.webp).toBeUndefined();
	});

	it('normalizes a leading slash and strips the extension to the manifest key', () => {
		const withSlash = responsiveSources('/photos/wide.webp');
		const withoutSlash = responsiveSources('photos/wide.webp');
		expect(withSlash.fallback).toBe('/photos/wide.webp');
		expect(withoutSlash.fallback).toBe('/photos/wide.webp');
		expect(withSlash.webp).toBe(withoutSlash.webp);
		expect(withSlash.hasSources).toBe(true);
	});

	it('builds ascending-width srcset strings and caps webp retina with the original', () => {
		const r = responsiveSources('/photos/wide.jpg');
		expect(r.hasSources).toBe(true);
		expect(r.width).toBe(4000);
		expect(r.height).toBe(2000);

		expect(r.webp).toBe(
			[
				'/optimized/photos/wide-thumbnail.webp 150w',
				'/optimized/photos/wide-small.webp 400w',
				'/optimized/photos/wide-medium.webp 800w',
				'/optimized/photos/wide-large.webp 1200w',
				'/optimized/photos/wide-xlarge.webp 1920w',
				'/photos/wide.webp 3840w',
			].join(', '),
		);

		// avif never gets an original cap (its 1920w derivative is ample).
		expect(r.avif).toBe(
			[
				'/optimized/photos/wide-thumbnail.avif 150w',
				'/optimized/photos/wide-small.avif 400w',
				'/optimized/photos/wide-medium.avif 800w',
				'/optimized/photos/wide-large.avif 1200w',
				'/optimized/photos/wide-xlarge.avif 1920w',
			].join(', '),
		);
		expect(r.avif).not.toContain('3840w');

		// Widths are strictly ascending in the emitted order.
		const widths = r.webp!.split(', ').map((part) => Number(part.trim().split(' ')[1].replace('w', '')));
		const sorted = [...widths].sort((a, b) => a - b);
		expect(widths).toEqual(sorted);
	});

	it('omits the retina cap when the original is not webp (jpg tops at large)', () => {
		const r = responsiveSources('/photos/mid.jpg');
		expect(r.hasSources).toBe(true);
		expect(r.webp?.endsWith('/optimized/photos/mid-large.webp 1200w')).toBe(true);
		expect(r.webp).not.toContain('2400w');
		expect(r.webp).not.toContain('/photos/mid.jpg');
	});

	it('opts small-only images OUT of srcset (MIN_RESPONSIVE_WIDTH guard)', () => {
		const r = responsiveSources('/photos/tiny.png');
		expect(r.hasSources).toBe(false);
		expect(r.avif).toBeUndefined();
		expect(r.webp).toBeUndefined();
		// Intrinsic size still passes through for CLS reservation.
		expect(r.width).toBe(300);
		expect(r.height).toBe(200);
		expect(r.fallback).toBe('/photos/tiny.png');
	});

	it('degrades a vector entry to a source-less fallback', () => {
		const r = responsiveSources('/logo.svg');
		expect(r.hasSources).toBe(false);
		expect(r.avif).toBeUndefined();
		expect(r.webp).toBeUndefined();
		expect(r.fallback).toBe('/logo.svg');
	});
});

describe('intrinsicSize', () => {
	it('resolves intrinsic dimensions for a known raster (extension-agnostic key)', () => {
		expect(intrinsicSize('/photos/wide.jpg')).toEqual({ width: 4000, height: 2000 });
		expect(intrinsicSize('photos/tiny.png')).toEqual({ width: 300, height: 200 });
	});

	it('returns undefined when the size is unknown or the entry is missing', () => {
		expect(intrinsicSize('/logo.svg')).toBeUndefined();
		expect(intrinsicSize('nope/missing.jpg')).toBeUndefined();
		expect(intrinsicSize(undefined)).toBeUndefined();
		expect(intrinsicSize(null)).toBeUndefined();
	});
});
