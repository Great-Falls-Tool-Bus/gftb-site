<script lang="ts">
	import { page } from '$app/state';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { buildShaShort } from '$lib/build-info';
	import '../app.css';

	let { children } = $props();

	// Footer structure carries the old apex's #103 cell-nesting lesson
	// (f8b599e): every line of the intro column — the location line and, on
	// stamped builds, the provenance line — lives INSIDE the one intro cell,
	// never as a direct child of the footer grid, so no phantom track can
	// break the template. e2e/footer.spec.ts asserts the computed track count.
	//
	// TODO(jess): footer intro/location line — final phrasing is yours to
	// author (rides the PR-5 copy review). The interim text below is the exact
	// line the site already shipped; nothing new was worded here.

	const siteUrl = 'https://greatfallstoolbus.org';
	const title = 'Great Falls Tool Bus — tools, skills, and shared work';
	const description = 'A community-run mobile tool library taking shape in Lewiston–Auburn, Maine.';
	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		name: 'Great Falls Tool Bus',
		url: siteUrl,
		description,
		areaServed: 'Lewiston–Auburn, Maine',
	};

	// Both error surfaces pass through this layout: the prerendered /404 route,
	// whose bytes Caddy serves for any missing path, and +error.svelte for a
	// client-router failure. SEOHead is rendered here for every route, so this is
	// the only place the head can be decided once — setting <title> or robots in
	// the error components as well produced two conflicting elements per
	// document, and the layout's copy, not the error page's, is the one that won.
	//
	// The prerendered route renders with status 200 (it is a successful
	// prerender of /404), so the path is what identifies it, not the status.
	const isErrorSurface = $derived(page.url.pathname === '/404' || page.status >= 400);
	const headTitle = $derived(isErrorSurface ? 'Page not found — Great Falls Tool Bus' : title);
	const headDescription = $derived(
		isErrorSurface ? 'This address is not part of the Great Falls Tool Bus site.' : description,
	);
</script>

<SEOHead
	title={headTitle}
	description={headDescription}
	siteName="Great Falls Tool Bus"
	origin={siteUrl}
	noindex={isErrorSurface}
	canonical={isErrorSurface ? null : undefined}
	jsonLd={isErrorSurface ? null : jsonLd}
/>

<a class="skip-link" href="#main-content">Skip to content</a>

<header class="site-header">
	<div class="site-header__inner">
		<a class="brand" href="/" aria-label="Great Falls Tool Bus home">
			<img src="/logo/bus-silhouette.svg" alt="" width="80" height="38" />
			<span>Great Falls Tool Bus</span>
		</a>
		<nav class="site-nav" aria-label="Main navigation">
			<a href="/#status">Status</a>
			<a href="/#log">Log</a>
			<a href="/#contact">Contact</a>
		</nav>
	</div>
</header>

<main id="main-content" tabindex="-1">
	{@render children?.()}
</main>

<footer class="site-footer">
	<div class="site-footer__inner">
		<div class="site-footer__intro">
			<p>Great Falls Tool Bus · Lewiston–Auburn, Maine</p>
			{#if buildShaShort}
				<p class="site-footer__provenance">built from <code>{buildShaShort}</code></p>
			{/if}
		</div>
		<p class="site-footer__licensing">
			Content <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · visual credits are listed with
			each image.
		</p>
	</div>
</footer>
