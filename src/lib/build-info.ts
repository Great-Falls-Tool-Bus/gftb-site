// Build provenance for the footer "built from <sha>" line — a port of the old
// apex's #140 mechanism. The sha reaches this module through Vite's
// `import.meta.env` (`PUBLIC_` envPrefix, vite.config.ts). It is stamped by
// scripts/bazel/workspace-status.sh as STABLE_PUBLIC_BUILD_SHA ONLY when the
// commit identity was explicitly supplied (BUILD_COMMIT_SHA or GITHUB_SHA,
// i.e. CI and publish invocations) — the local `git rev-parse` convenience
// fallback stays build-internal, so a local `just build` renders no line.
// Fail-quiet: absence renders nothing, never a broken value.
//
// The stamp truncates to 7 chars BEFORE the value reaches Vite: Vite inlines
// the env literal into shipped bytes, and the leak-scan gate
// (internal-tracker-reference) rejects any 40-hex string in the artifact, so
// the full form must never be handed across.

/**
 * Normalize a raw build-sha env value to a trustworthy commit hash prefix, or
 * '' when absent/untrustworthy. Vite passes unset vars through as `undefined`,
 * and build fallbacks can hand across the literal `'unknown'`; treat those —
 * and any non-hex noise — as absent so the footer never renders a bogus
 * provenance value. Returns the lowercased hex sha (7 to 64 chars), else ''.
 */
export function normalizeSha(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const value = raw.trim().toLowerCase();
	if (!/^[0-9a-f]{7,64}$/.test(value)) return '';
	return value;
}

/** 7-char short sha for the footer provenance line, or '' when unknown / local. */
export const buildShaShort: string = normalizeSha(import.meta.env.PUBLIC_BUILD_SHA).slice(0, 7);
