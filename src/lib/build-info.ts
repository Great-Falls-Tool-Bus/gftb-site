// Build provenance for the footer "built from <sha>" line — a port of the old
// apex's #140 mechanism onto this repo's one build-constant channel: the Bazel
// stable-status stamp (scripts/bazel/workspace-status.sh) flows through
// vite.config.ts's `define` block as __COMMIT_SHORT__. The stamp carries an
// EXPLICITLY supplied identity only (BUILD_COMMIT_SHA / GITHUB_SHA — CI and
// publish invocations) and is truncated to 7 chars AT THE SOURCE, so the
// 40-hex form never reaches Vite and can never be inlined into shipped bytes
// (the leak-scan gate rejects 40-hex in the artifact as its backstop). An
// unidentified (local / dev) build stamps the literal 'unknown', so the
// footer renders nothing. Fail-quiet: absence renders nothing, never a
// broken value.

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
