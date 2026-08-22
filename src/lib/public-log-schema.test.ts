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

	it('accepts an operator-pending draft, which the loader then excludes from output', () => {
		// Addendum B1.2: agent-drafted posts sit in the tree as published:false
		// TODO(jess) drafts. The schema admits the file; src/lib/public-logs.ts
		// is the choke point that keeps drafts out of production output
		// (spec §3: the loader rejects unpublished entries in production output).
		expect(assertPublicLogMetadata({ ...valid, published: false })).toEqual({ ...valid, published: false });
	});
});
