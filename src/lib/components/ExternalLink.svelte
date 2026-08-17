<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// The outbound-link convention: any anchor that leaves the site renders with
	// `rel="external noopener noreferrer"`, `target="_blank"`, a trailing "↗"
	// affix so the destination is visually obvious, and a screen-reader hint that
	// it opens in a new tab. Consolidating this into one component keeps every
	// spoke's outbound links consistent and safe (no `window.opener` leak) instead
	// of re-deriving the rel/target/affix per page.
	//
	// The "↗" glyph is aria-hidden (decorative); the accessibility signal is the
	// visually-hidden "(opens in new tab)" text, so assistive tech announces the
	// behavior without reading a bare arrow.
	//
	// Typed `interface Props` + `$props()` per house-canon rune shape. Children go
	// through the Svelte 5 `children` snippet.
	import type { Snippet } from 'svelte';

	interface Props {
		/** Absolute destination URL (should be off-site). */
		href: string;
		/** Extra classes merged onto the anchor. */
		class?: string;
		/** Hide the trailing ↗ affix (e.g. icon-only links). Defaults to false. */
		hideAffix?: boolean;
		children: Snippet;
	}

	let { href, class: extraClass = '', hideAffix = false, children }: Props = $props();
</script>

<a {href} class={extraClass} target="_blank" rel="external noopener noreferrer">
	{@render children()}{#if !hideAffix}<span aria-hidden="true" class="external-affix">↗</span>{/if}
	<span class="sr-only">(opens in new tab)</span>
</a>

<style>
	.external-affix {
		/* Nudge the arrow up to sit on the cap line; keep it from wrapping alone. */
		margin-inline-start: 0.15em;
		font-size: 0.85em;
		white-space: nowrap;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
