<script lang="ts">
	// Read the image group from src/lib/featured-image-schema.ts. Missing images reserve no
	// space. The `thumb` layout follows the jesssullivan.github.io blog list. Reserve a 3/2
	// crop box unless `image_aspect` overrides it. The `hero` variant keeps the image’s
	// natural aspect by default. NotesAndGoals.svelte consumes the same group through its
	// `media` snippet.
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
