<script lang="ts">
	// The outbound-link affordance, ported from the apex ExternalLink (D06,
	// #75): one component for every anchor that leaves the site, so
	// rel/target/a11y can never drift apart across call sites. The mark is a
	// small monospace [↗] that reads as "this leaves the site", not
	// decoration. The mark is aria-hidden; a visually-hidden "(opens in a
	// new tab)" carries the meaning to assistive tech. In print the mark is
	// dropped and the URL is expanded after the text (the @media print block
	// in src/app.css — D03 pairs with this component).
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
</script>

<a {href} target="_blank" {rel} class="external-link {klass}" aria-label={label}
	>{@render children()}{#if mark}<span class="external-link__mark" aria-hidden="true">[↗]</span><span class="sr-only">
			(opens in a new tab)</span
		>{/if}</a
>
