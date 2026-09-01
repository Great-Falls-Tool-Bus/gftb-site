import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { distinctiveDraftGoalLiterals } from '../../scripts/lib/goals-content.mjs';
import { parseLogFrontmatter } from '../../scripts/lib/log-content.mjs';
import { assertPublicGoalMetadata } from './public-goal-schema';

const valid = {
	kind: 'goal',
	order: '10',
	title: 'Form the club',
	window: 'After September 4, 2026',
	cta_label: 'Go to Augusta with Jess',
	cta_href: '/contact',
	published: true,
	source: 'operator 2026-08-31',
};

describe('assertPublicGoalMetadata', () => {
	it('accepts a complete goal and normalizes order to a number', () => {
		expect(assertPublicGoalMetadata(valid).order).toBe(10);
	});

	it('rejects unknown kinds and unknown keys', () => {
		expect(() => assertPublicGoalMetadata({ ...valid, kind: 'card' })).toThrow(/kind/u);
		expect(() => assertPublicGoalMetadata({ ...valid, date: '2026-08-31' })).toThrow(/unsupported/u);
	});

	it('requires cta_label and cta_href together, and a safe href', () => {
		const { cta_href: _href, ...labelOnly } = valid;
		expect(() => assertPublicGoalMetadata(labelOnly)).toThrow(/travel together/u);
		expect(() => assertPublicGoalMetadata({ ...valid, cta_href: 'javascript:alert(1)' })).toThrow(/cta_href/u);
	});

	it('rejects em dashes in public copy', () => {
		expect(() => assertPublicGoalMetadata({ ...valid, title: 'Form the club — soon' })).toThrow(/em dash/u);
	});

	it('carries the featured-image group under the same fail-closed rules as the log schema', () => {
		expect(() => assertPublicGoalMetadata({ ...valid, image: '/photos/goals/shelves-1280.jpg' })).toThrow(
			/image and image_alt travel together/u,
		);
		expect(() =>
			assertPublicGoalMetadata({ ...valid, image: 'https://example.com/x.jpg', image_alt: 'Shelving stock' }),
		).toThrow(/site-relative/u);
		expect(() => assertPublicGoalMetadata({ ...valid, image_caption: 'Orphan caption' })).toThrow(
			/only valid alongside image/u,
		);
		expect(() =>
			assertPublicGoalMetadata({
				...valid,
				image: '/photos/goals/shelves-1280.jpg',
				image_alt: 'Shelving stock — piled',
			}),
		).toThrow(/em dash/u);
		const withImage = {
			...valid,
			image: '/photos/goals/shelves-1280.jpg',
			image_alt: 'Shelving stock piled by the bus door',
			image_aspect: '16/9',
		};
		expect(assertPublicGoalMetadata(withImage).image).toBe('/photos/goals/shelves-1280.jpg');
	});

	it('folds draft featured-image copy into the leak denylist under the length floor', () => {
		const literals = distinctiveDraftGoalLiterals([
			{
				file: 'z.md',
				slug: 'z',
				sourcePath: 'src/content/goals/z.md',
				metadata: {
					kind: 'goal',
					title: 'Draft shelving goal',
					published: false,
					image: '/photos/goals/z-1280.jpg',
					image_alt: 'Shelving stock piled by the bus door',
					image_caption: 'Cut.',
				},
				text: '',
			},
		]);
		// The alt clears the 20-char floor; the short caption stays out.
		expect(literals).toEqual(['Draft shelving goal', 'Shelving stock piled by the bus door']);
	});

	it('validates every file in src/content/goals', () => {
		const dir = path.resolve(__dirname, '../content/goals');
		const files = readdirSync(dir).filter((file) => file.endsWith('.md'));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const { metadata } = parseLogFrontmatter(readFileSync(path.join(dir, file), 'utf8'), file);
			expect(() => assertPublicGoalMetadata(metadata, file)).not.toThrow();
		}
	});

	it('folds even a short unpublished title into the leak denylist', () => {
		const literals = distinctiveDraftGoalLiterals([
			{
				file: 'x.md',
				slug: 'x',
				sourcePath: 'src/content/goals/x.md',
				metadata: { kind: 'benefit', title: 'Free beer.', published: false },
				text: '',
			},
			{
				file: 'y.md',
				slug: 'y',
				sourcePath: 'src/content/goals/y.md',
				metadata: { kind: 'goal', title: 'Published row', published: true },
				text: 'Long enough prose to matter here.',
			},
		]);
		expect(literals).toEqual(['Free beer.']);
	});
});
