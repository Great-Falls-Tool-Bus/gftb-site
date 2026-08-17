// ── HOUSE CANON IDIOM ────────────────────────────────────────────────────────
// Reactive `prefers-reduced-motion` reader. One SSR-safe source of truth every
// spoke can share instead of re-deriving a `matchMedia` listener per component.
// Wraps `MediaQuery('(prefers-reduced-motion: reduce)')` from `svelte/reactivity`
// (the pattern already used ad hoc in contact/settings surfaces) so callers read
// a single boolean field.
//
// SSR / no-JS behavior is FAIL-OPEN toward accessibility: before the client
// query resolves, `reduced` reports the passed `initial` (default `false` so the
// first client frame matches a motion-capable render, then reconciles). A spoke
// that would rather start still can pass `initial: true`.
//
// Usage (inside a component <script lang="ts">):
//   import { createReducedMotion } from '$lib/runes/reduced-motion.svelte';
//   const motion = createReducedMotion();
//   const duration = $derived(motion.reduced ? 0 : 180);
//
// Non-reactive one-shot (e.g. inside an action, outside a component): use the
// `prefersReducedMotion()` snapshot helper instead.

import { MediaQuery } from 'svelte/reactivity';

const QUERY = '(prefers-reduced-motion: reduce)';

export interface ReducedMotionState {
	/** True when the user has requested reduced motion. */
	readonly reduced: boolean;
}

export interface ReducedMotionOptions {
	/** Value reported before the client media query resolves. Defaults to false. */
	initial?: boolean;
}

export function createReducedMotion(options: ReducedMotionOptions = {}): ReducedMotionState {
	const query = new MediaQuery(QUERY, options.initial ?? false);
	return {
		get reduced() {
			return query.current;
		},
	};
}

/**
 * One-shot, non-reactive snapshot of the reduced-motion preference. Safe to call
 * from module scope, actions, or event handlers. Returns `false` during SSR (no
 * `window`), so motion decisions fail open on the server and are re-checked on
 * the client where the action actually runs.
 */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia(QUERY).matches;
}
