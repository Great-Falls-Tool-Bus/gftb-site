import { describe, expect, it } from 'vitest';
import { assertPublicLogMetadata } from './public-log-schema';

const valid = {
	date: '2026-08-16',
	title: 'Public front door',
	summary: 'A small and honest update about the project.',
	tags: ['website', 'build'],
	published: true,
};

describe('public log frontmatter', () => {
	it('accepts only the published public shape', () => {
		expect(assertPublicLogMetadata(valid)).toEqual(valid);
	});

	it('rejects internal and one-off metadata keys', () => {
		expect(() => assertPublicLogMetadata({ ...valid, linear: 'TIN-0000' })).toThrow(
			'unsupported public frontmatter keys',
		);
		expect(() => assertPublicLogMetadata({ ...valid, pullRequest: 1 })).toThrow('unsupported public frontmatter keys');
	});

	it('rejects malformed values and backwards updates', () => {
		expect(() => assertPublicLogMetadata({ ...valid, date: '08/16/2026' })).toThrow('date must be YYYY-MM-DD');
		expect(() => assertPublicLogMetadata({ ...valid, tags: [] })).toThrow('tags must be a non-empty string array');
		expect(() => assertPublicLogMetadata({ ...valid, published: 'yes' })).toThrow('published must be a boolean');
		expect(() => assertPublicLogMetadata({ ...valid, updated: '2026-08-15' })).toThrow('updated cannot predate date');
	});

	it('requires alt text whenever a featured image is set (they travel together)', () => {
		expect(() => assertPublicLogMetadata({ ...valid, image: '/photos/log/shelf-1280.jpg' })).toThrow(
			/image and image_alt travel together/u,
		);
		expect(() => assertPublicLogMetadata({ ...valid, image_alt: 'An orphan alt text' })).toThrow(/travel together/u);
		const withImage = {
			...valid,
			image: '/photos/log/shelf-1280.jpg',
			image_alt: 'A plywood shelf dry-fit inside the bus',
			image_caption: 'First shelf dry-fit',
			image_aspect: '3/2',
		};
		expect(assertPublicLogMetadata(withImage)).toEqual(withImage);
	});

	it('rejects off-carrier, traversal, and unclassified-extension image paths', () => {
		const alt = { image_alt: 'A plywood shelf dry-fit inside the bus' };
		expect(() => assertPublicLogMetadata({ ...valid, ...alt, image: 'https://example.com/x.jpg' })).toThrow(
			/site-relative/u,
		);
		expect(() => assertPublicLogMetadata({ ...valid, ...alt, image: '/photos/../private/x.jpg' })).toThrow(
			/site-relative/u,
		);
		expect(() => assertPublicLogMetadata({ ...valid, ...alt, image: '/photos/log/notes.txt' })).toThrow(
			/site-relative/u,
		);
		expect(() => assertPublicLogMetadata({ ...valid, ...alt, image: 'photos/log/x.jpg' })).toThrow(/site-relative/u);
	});

	it('rejects caption or aspect without an image, malformed aspects, and em dashes in alt text', () => {
		expect(() => assertPublicLogMetadata({ ...valid, image_caption: 'Orphan caption' })).toThrow(
			/image_caption is only valid alongside image/u,
		);
		expect(() => assertPublicLogMetadata({ ...valid, image_aspect: '3/2' })).toThrow(
			/image_aspect is only valid alongside image/u,
		);
		const withImage = { ...valid, image: '/photos/log/shelf-1280.jpg', image_alt: 'A shelf inside the bus' };
		expect(() => assertPublicLogMetadata({ ...withImage, image_aspect: 'wide' })).toThrow(/image_aspect/u);
		expect(() => assertPublicLogMetadata({ ...withImage, image_aspect: '0/2' })).toThrow(/image_aspect/u);
		expect(() => assertPublicLogMetadata({ ...withImage, image_alt: 'A shelf — dry-fit' })).toThrow(/em dash/u);
		expect(() => assertPublicLogMetadata({ ...withImage, image_caption: 'Shelf — 2026' })).toThrow(/em dash/u);
	});

	it('accepts an operator-pending draft, which the loader then excludes from output', () => {
		// Addendum B1.2: agent-drafted posts sit in the tree as published:false
		// TODO(jess) drafts. The schema admits the file; src/lib/public-logs.ts
		// is the choke point that keeps drafts out of production output
		// (spec §3: the loader rejects unpublished entries in production output).
		expect(assertPublicLogMetadata({ ...valid, published: false })).toEqual({ ...valid, published: false });
	});
});
