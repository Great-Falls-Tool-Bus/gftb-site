<script lang="ts">
	// The reusable featured-image affordance for the frontmatter image group
	// (src/lib/featured-image-schema.ts). Callers pass metadata through
	// UNCONDITIONALLY: when no image is set the component renders nothing at
	// all — the honest empty state, no placeholder, no reserved box.
	//
	// Variants:
	//  - `thumb`: the archive-row treatment (jesssullivan.github.io blog-list
	//    inspiration) — a fixed 3/2 crop box (CSS) so rows cannot shift as
	//    images load; an entry's own `image_aspect` overrides it inline.
	//  - `hero`: the top-of-post treatment — natural aspect unless the entry
	//    names one.
	//
	// Plain and borderless, never a card, sharp corners (operator rulings
	// B1.2 + 2026-08-30; e2e/acceptance-sharp-edges.spec.ts sweeps /log).
	// Consumers: the /log archive rows (thumb), the /log/<slug> permalink
	// (hero), and — since the 2026-09-01 batch's deferred home-integration
	// item — the home latest-5 citation rows (thumb). The home goals
	// carousel consumes the same frontmatter group through its own designed
	// `media` snippet (GoalCarousel.svelte) rather than this component.
	interface Props {
		src?: string;
		alt?: string;
		caption?: string;
		/** CSS aspect-ratio token like `3/2`, already schema-validated. */
		aspect?: string;
		variant: 'thumb' | 'hero';
	}

	let { src, alt, caption, aspect, variant }: Props = $props();
</script>

{#if src && alt}
	<figure class={`featured-image featured-image--${variant}`}>
		<img {src} {alt} loading="lazy" decoding="async" style:aspect-ratio={aspect} />
		{#if caption}<figcaption>{caption}</figcaption>{/if}
	</figure>
{/if}
