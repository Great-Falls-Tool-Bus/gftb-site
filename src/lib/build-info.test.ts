import { describe, expect, it } from 'vitest';
import { buildShaShort, normalizeSha } from './build-info';

// build-info wires the footer "built from <sha>" provenance line (the old
// apex's #140 mechanism, ported). The sha reaches the module through
// import.meta.env.PUBLIC_BUILD_SHA, stamped only by builds whose commit
// identity was explicitly supplied (see scripts/bazel/workspace-status.sh).
// The normalizer must fail-quiet — anything that is not a real hex sha
// (unset, the literal 'unknown', or noise) must read as '' so the footer
// renders no line rather than a bogus value on local builds.
describe('normalizeSha', () => {
	it('accepts a full 40-char hex sha and lowercases it', () => {
		const sha = '0123456789ABCDEF0123456789ABCDEF01234567';
		expect(normalizeSha(sha)).toBe(sha.toLowerCase());
	});

	it('accepts a padded / short hex sha', () => {
		expect(normalizeSha(' 0a1b2c3 ')).toBe('0a1b2c3');
	});

	it('fails quiet for unset, unknown, and non-hex noise', () => {
		for (const raw of [undefined, null, '', ' ', 'unknown', 'dev', 'not-a-sha', '123456', 'zzzzzzz']) {
			expect(normalizeSha(raw)).toBe('');
		}
	});
});

// In the test / local environment PUBLIC_BUILD_SHA is unset, so provenance
// must degrade to empty — the footer line is then hidden, never broken.
describe('build provenance defaults', () => {
	it('degrades to empty when PUBLIC_BUILD_SHA is unset', () => {
		expect(buildShaShort).toBe('');
	});
});
