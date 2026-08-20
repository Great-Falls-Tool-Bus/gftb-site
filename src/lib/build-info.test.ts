import { describe, expect, it } from 'vitest';
import { buildShaShort, normalizeSha } from './build-info';

// build-info wires the footer "built from <sha>" provenance line (the old
// apex's #140 mechanism, ported). The value arrives through vite.config.ts's
// __COMMIT_SHORT__ define, stamped by scripts/bazel/workspace-status.sh only
// for builds whose commit identity was explicitly supplied, and truncated to
// 7 chars at that source. The normalizer must fail-quiet — anything that is
// not exactly a 7-char hex sha (unset, the literal 'unknown', noise, or an
// untruncated sha from a channel that skipped the source truncation) must
// read as '' so the footer renders no line rather than a bogus value.
describe('normalizeSha', () => {
	it('accepts a padded 7-char short sha and lowercases it', () => {
		expect(normalizeSha(' 0A1B2C3 ')).toBe('0a1b2c3');
	});

	it('rejects an untruncated 40-char sha — truncation happens at the stamp, never here', () => {
		// A full sha reaching this module means the source truncation in
		// workspace-status.sh was bypassed; rendering nothing is the safe
		// answer (and the leak-scan backstop would fail the build anyway).
		expect(normalizeSha('0123456789abcdef0123456789abcdef01234567')).toBe('');
	});

	it('fails quiet for unset, unknown, and non-hex noise', () => {
		for (const raw of [undefined, null, '', ' ', 'unknown', 'dev', 'not-a-sha', '123456', '0a1b2c3d', 'zzzzzzz']) {
			expect(normalizeSha(raw)).toBe('');
		}
	});
});

// In the test environment the __COMMIT_SHORT__ define does not exist at all,
// so provenance must degrade to empty — the footer line is then hidden,
// never broken.
describe('build provenance defaults', () => {
	it('degrades to empty when no stamp was defined', () => {
		expect(buildShaShort).toBe('');
	});
});
