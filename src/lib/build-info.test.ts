import { describe, expect, it } from 'vitest';
import { buildShaShort, normalizeSha } from './build-info';

// The footer takes its “built from <sha>” value from __COMMIT_SHORT__ in vite.config.ts. As
// in #140, scripts/bazel/workspace-status.sh stamps an explicitly supplied commit and keeps
// 7 hex characters. Invalid or absent values hide the footer line.
describe('normalizeSha', () => {
	it('accepts a padded 7-char short sha and lowercases it', () => {
		expect(normalizeSha(' 0A1B2C3 ')).toBe('0a1b2c3');
	});

	it('rejects an untruncated 40-char sha — truncation happens at the stamp, never here', () => {
		// A full sha bypassed truncation in workspace-status.sh. Hide it before the leak scan.
		expect(normalizeSha('0123456789abcdef0123456789abcdef01234567')).toBe('');
	});

	it('fails quiet for unset, unknown, and non-hex noise', () => {
		for (const raw of [undefined, null, '', ' ', 'unknown', 'dev', 'not-a-sha', '123456', '0a1b2c3d', 'zzzzzzz']) {
			expect(normalizeSha(raw)).toBe('');
		}
	});
});

// The test environment omits __COMMIT_SHORT__. An empty value hides the footer line.
describe('build provenance defaults', () => {
	it('degrades to empty when no stamp was defined', () => {
		expect(buildShaShort).toBe('');
	});
});
