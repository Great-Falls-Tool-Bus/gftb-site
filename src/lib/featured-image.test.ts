import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
	FEATURED_IMAGE_KEYS as MJS_FEATURED_IMAGE_KEYS,
	IMAGE_ASPECT_PATTERN as MJS_IMAGE_ASPECT_PATTERN,
	IMAGE_SRC_PATTERN as MJS_IMAGE_SRC_PATTERN,
	assertPublishedImageAsset,
} from '../../scripts/lib/featured-image.mjs';
import { SKIP_EXTENSIONS, TEXT_EXTENSIONS } from '../../scripts/lib/leak-scan.mjs';
import { distinctiveDraftLiterals } from '../../scripts/lib/log-content.mjs';
import { FEATURED_IMAGE_KEYS, IMAGE_ASPECT_PATTERN, IMAGE_SRC_PATTERN } from './featured-image-schema';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('featured-image contract mirror', () => {
	// scripts/lib/featured-image.mjs re-states the schema patterns for the
	// Node-only manifest builders (the goals-builder mirroring posture). This
	// pin turns silent drift between the two into a red test.
	it('keeps the .mjs builder mirror byte-identical to the TypeScript schema', () => {
		expect(MJS_IMAGE_SRC_PATTERN.source).toBe(IMAGE_SRC_PATTERN.source);
		expect(MJS_IMAGE_ASPECT_PATTERN.source).toBe(IMAGE_ASPECT_PATTERN.source);
		expect([...MJS_FEATURED_IMAGE_KEYS]).toEqual([...FEATURED_IMAGE_KEYS]);
	});

	it('only admits extensions the leak scanner classifies (fail-closed holds)', () => {
		for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.avif']) {
			expect(IMAGE_SRC_PATTERN.test(`/photos/log/x-1280${extension}`), extension).toBe(true);
			expect(SKIP_EXTENSIONS.has(extension), `${extension} must stay a classified skip extension`).toBe(true);
		}
		// .svg is admitted because the scanner TEXT-scans it, not skips it.
		expect(IMAGE_SRC_PATTERN.test('/logo/bus-silhouette.svg')).toBe(true);
		expect(TEXT_EXTENSIONS.has('.svg')).toBe(true);
		// Anything else would make the leak scan exit 2, so the schema refuses it.
		expect(IMAGE_SRC_PATTERN.test('/photos/log/x.gif')).toBe(false);
		expect(IMAGE_SRC_PATTERN.test('/photos/log/x.tiff')).toBe(false);
		// A protocol-relative URL is an external fetch in the browser; the
		// leading-slash-then-word-character shape refuses it outright.
		expect(IMAGE_SRC_PATTERN.test('//evil.example/x.png')).toBe(false);
	});
});

describe('assertPublishedImageAsset', () => {
	it('accepts a committed static asset and imageless metadata', () => {
		expect(() =>
			assertPublishedImageAsset({ image: '/photos/great-falls-lewiston-1930s-640.jpg' }, 'fixture', repoRoot),
		).not.toThrow();
		expect(() => assertPublishedImageAsset({}, 'fixture', repoRoot)).not.toThrow();
	});

	it('breaks the build on a dangling image path', () => {
		expect(() =>
			assertPublishedImageAsset({ image: '/photos/log/does-not-exist-1280.jpg' }, 'fixture', repoRoot),
		).toThrow(/no committed asset/u);
	});
});

describe('draft featured-image copy joins the leak denylist', () => {
	it('folds a draft alt and caption over the length floor, never a published one', () => {
		const draft = {
			file: 'x.svx',
			slug: 'x',
			sourcePath: 'src/content/log/x.svx',
			metadata: {
				title: 'Draft title',
				summary: 'A draft summary long enough.',
				published: false,
				image: '/photos/log/x-1280.jpg',
				image_alt: 'A plywood shelf half-installed in the bus',
				image_caption: 'Cut.',
			},
			body: 'Draft body prose long enough to matter.',
		};
		const publishedEntry = {
			...draft,
			file: 'y.svx',
			metadata: { ...draft.metadata, published: true, image_alt: 'A published alt never joins the denylist' },
		};
		const literals = distinctiveDraftLiterals([draft, publishedEntry]);
		expect(literals).toContain('A plywood shelf half-installed in the bus');
		// The short caption stays out (too collision-prone), and published copy never joins.
		expect(literals).not.toContain('Cut.');
		expect(literals).not.toContain('A published alt never joins the denylist');
	});
});

describe('featured-image render surfaces', () => {
	const component = readFileSync(path.join(repoRoot, 'src/lib/components/FeaturedImage.svelte'), 'utf8');

	it('keeps the honest empty state: no src+alt, no markup at all', () => {
		expect(component).toContain('{#if src && alt}');
	});

	it('stays lazy, responsive, and CLS-safe', () => {
		expect(component).toContain('loading="lazy"');
		expect(component).toContain('decoding="async"');
		expect(component).toContain('style:aspect-ratio={aspect}');
		const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
		// The thumb's fixed crop box (rows cannot shift as images load) and the
		// borderless, sharp-cornered, never-a-card treatment.
		expect(appCss).toMatch(/\.featured-image--thumb img \{\n\taspect-ratio: 3 \/ 2;/u);
		expect(appCss).toMatch(/\.featured-image img \{[^}]*max-width: 100%;/u);
		expect(appCss).toMatch(/\.featured-image img \{[^}]*border-radius: 0;/u);
		// The carousel media slot's crop box carries the same contract: the
		// default aspect and the mobile height cap size the box from CSS alone
		// (no CLS, one-slide-tall budget), cover-cropped, sharp-cornered.
		expect(appCss).toMatch(/\.goal-media img \{[^}]*aspect-ratio: 3 \/ 2;/u);
		expect(appCss).toMatch(/\.goal-media img \{[^}]*max-height: /u);
		expect(appCss).toMatch(/\.goal-media img \{[^}]*object-fit: cover;/u);
		expect(appCss).toMatch(/\.goal-media img \{[^}]*border-radius: 0;/u);
	});

	it('renders through the component on the /log rows, the permalink hero, and the home latest-5 rows', () => {
		const logList = readFileSync(path.join(repoRoot, 'src/lib/components/LogList.svelte'), 'utf8');
		expect(logList).toContain('<FeaturedImage');
		expect(logList).toContain('variant="thumb"');
		const permalink = readFileSync(path.join(repoRoot, 'src/routes/log/[slug]/+page.svelte'), 'utf8');
		expect(permalink).toContain('<FeaturedImage');
		expect(permalink).toContain('variant="hero"');
		// Home integration (the 2026-09-01 batch's deferred item): the
		// latest-5 citation rows reuse the archive thumb — same component,
		// same variant, so the two surfaces cannot drift apart — and the
		// goals carousel mounts its own designed `media` snippet. Both
		// consume ONLY the schema's frontmatter group; the empty state stays
		// honest because the component and the snippet's {#if} both render
		// nothing for an imageless entry.
		const home = readFileSync(path.join(repoRoot, 'src/routes/+page.svelte'), 'utf8');
		expect(home).toContain('<FeaturedImage');
		expect(home).toContain('variant="thumb"');
		expect(home).toContain('{#snippet media(goal)}');
		expect(home).toContain('class="goal-media"');
		expect(home).toContain('{#if goal.metadata.image}');
	});
});
