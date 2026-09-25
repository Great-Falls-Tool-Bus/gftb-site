// Build provenance for the footer "built from <sha>" line — a port of the old
// apex's #140 mechanism onto this repo's one build-constant channel. The Bazel
// source-marker action projects native BUILD_EMBED_LABEL into health.sha.
// The build adapter reads that file, truncates it to 7 chars, and passes it
// through vite.config.ts's `define` block as __COMMIT_SHORT__. Caddy serves the
// full SHA publicly at /health.sha outside the scanned page tree; it is not
// private. The leak scan rejects full SHAs in page bytes. The build refuses
// an absent marker. A dev/test render without a define has no footer
// provenance: absence renders nothing, never a broken value.

// vitest evaluates this module without Vite's define step, so the global can
// be absent entirely; the typeof guard keeps that path (and any future
// non-Vite consumer) on the fail-quiet branch.
const stamped = typeof __COMMIT_SHORT__ === 'undefined' ? '' : __COMMIT_SHORT__;

/**
 * Normalize the stamped value to a trustworthy 7-char short sha, or '' when
 * absent/untrustworthy. The stamp hands across exactly 7 hex chars or the
 * literal 'unknown'; anything else — including an untruncated 40-hex sha,
 * which must be cut at the stamp and never here — reads as absent so the
 * footer renders no line rather than a value from a channel that skipped the
 * source truncation.
 */
export function normalizeSha(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const value = raw.trim().toLowerCase();
	if (!/^[0-9a-f]{7}$/.test(value)) return '';
	return value;
}

/** 7-char short sha for the footer provenance line, or '' when unknown / local. */
export const buildShaShort: string = normalizeSha(stamped);
