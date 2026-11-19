// The footer follows the apex build stamp from #140.
// scripts/bazel/workspace-status.sh truncates BUILD_COMMIT_SHA to 7 hex characters.
// Vite exposes that stamp as __COMMIT_SHORT__. A local build stamps 'unknown'.

// Vitest can load this module without Vite's define step.
const stamped = typeof __COMMIT_SHORT__ === 'undefined' ? '' : __COMMIT_SHORT__;

/** Hide invalid stamps, including a 40-hex SHA that missed truncation at the source. */
export function normalizeSha(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const value = raw.trim().toLowerCase();
	if (!/^[0-9a-f]{7}$/.test(value)) return '';
	return value;
}

/** 7-char short sha for the footer provenance line, or '' when unknown / local. */
export const buildShaShort: string = normalizeSha(stamped);
