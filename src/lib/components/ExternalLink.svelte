<script lang="ts">
	// D06 ports the apex ExternalLink from #75. Hide the [↗] glyph from assistive technology
	// and announce “(opens in a new tab)” instead. The D03 print rules in src/app.css
	// replace the glyph with the URL.
	import type { Snippet } from 'svelte';

	interface Props {
		href: string;
		/** Untrusted outbound target → rel gains 'external'. Default true. */
		external?: boolean;
		/** Render the [↗] leaves-site mark. Default true. */
		mark?: boolean;
		class?: string;
		/** Overrides the accessible name (else the link text is used). */
		label?: string;
		children: Snippet;
	}

	let { href, external = true, mark = true, class: klass = '', label, children }: Props = $props();

	const rel = $derived(external ? 'external noopener noreferrer' : 'noopener noreferrer');
	// An aria-label replaces the entire accessible name. Include “(opens in a new tab)” in the
	// override so labelled links announce it too.
	const ariaLabel = $derived(label ? `${label} (opens in a new tab)` : undefined);
</script>

<a {href} target="_blank" {rel} class="external-link {klass}" aria-label={ariaLabel}
	>{@render children()}{#if mark}<span class="external-link__mark" aria-hidden="true">[↗]</span><span class="sr-only">
			(opens in a new tab)</span
		>{/if}</a
>
