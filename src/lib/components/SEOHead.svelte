<script lang="ts">
	// Typed, prerender-safe SEO metadata for the static apex.
	import { page } from '$app/state';

	interface Props {
		title: string;
		description: string;
		keywords?: string;
		image?: string;
		imageAlt?: string;
		noindex?: boolean;
		canonical?: string | undefined;
		ogType?: string;
		siteName?: string;
		/** Production origin used to build the canonical URL when no explicit `canonical` is given. */
		origin?: string;
		/** Optional JSON-LD object; serialized into a single application/ld+json <script>. */
		jsonLd?: Record<string, unknown> | null;
	}

	let {
		title,
		description,
		keywords = '',
		image = '',
		imageAlt = '',
		noindex = false,
		canonical = undefined,
		ogType = 'website',
		siteName = 'greatfallstoolbus.org',
		origin = 'https://greatfallstoolbus.org',
		jsonLd = null,
	}: Props = $props();

	// Build the full canonical URL from the current path unless supplied.
	const canonicalUrl = $derived(canonical || `${origin}${page.url.pathname}`);

	// Never infer preview status during prerender.
	const shouldNoindex = $derived(noindex);

	const normalizedCanonical = $derived.by(() => {
		const url = canonicalUrl;
		try {
			const parsed = new URL(url);
			let pathname = parsed.pathname;
			if (pathname !== '/' && pathname.endsWith('/')) {
				pathname = pathname.slice(0, -1);
			} else if (pathname === '/') {
				pathname = '';
			}
			// Canonical URLs drop the hash fragment but keep query params.
			return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
		} catch {
			return url.replace(/\/$/, '');
		}
	});

	// Serialize JSON-LD once; escape every `<` so an embedded closing-script
	// sentinel in the data cannot terminate the inline block early.
	const jsonLdScript = $derived.by(() => {
		if (!jsonLd) return null;
		return JSON.stringify(jsonLd).replace(/</g, '\\u003c');
	});
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if keywords}
		<meta name="keywords" content={keywords} />
	{/if}

	<link rel="canonical" href={normalizedCanonical} />

	<meta property="og:type" content={ogType} />
	<meta property="og:url" content={normalizedCanonical} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	{#if image}
		<meta property="og:image" content={image} />
		<meta property="og:image:alt" content={imageAlt} />
	{/if}
	<meta property="og:site_name" content={siteName} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	{#if image}
		<meta name="twitter:image" content={image} />
		<meta name="twitter:image:alt" content={imageAlt} />
	{/if}

	{#if shouldNoindex}
		<meta name="robots" content="noindex, nofollow" />
	{:else}
		<meta name="robots" content="index, follow" />
	{/if}

	{#if jsonLdScript}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- serialized JSON-LD; the </script> sentinel is escaped above -->
		{@html `<script type="application/ld+json">${jsonLdScript}</` + `script>`}
	{/if}
</svelte:head>
