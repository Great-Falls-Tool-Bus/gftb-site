<script lang="ts">
	import { page } from '$app/state';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { buildShaShort } from '$lib/build-info';
	import { footerNavGroups, isActivePath, primaryNavItems } from '$lib/nav-items';
	import sourceMap from '$lib/generated/source-map.json';
	import '../app.css';

	let { children } = $props();

	// Header + footer structure is the demo site's +layout.svelte shape
	// (greatfallstoolbus.org@origin/main): nav renders from the
	// $lib/nav-items SSOT, and the footer is the intro-weighted four-group
	// grid (intro / About / Get involved / Meta). The old apex #103
	// cell-nesting lesson holds: every line of the intro column — location,
	// provenance, licensing — lives INSIDE the one intro cell, never as a
	// direct child of the footer grid. e2e/footer.spec.ts asserts the
	// computed track count.
	//
	// TODO(jess): footer wording — the rendered strings below are yours to
	// final-word: the intro/location line (the exact line the site already
	// shipped) and the provenance string. Nothing new was worded here.

	const siteUrl = 'https://greatfallstoolbus.org';
	// TODO(jess): document title. The tagline "— tools, skills, and shared
	// work" was stripped (salvaged from restoration PR-5: em-dash AI-tell +
	// triad); the interim title is the bare project name.
	const title = 'Great Falls Tool Bus';
	// TODO(jess): site description. "mobile" was stripped (the bus is
	// permanently parked; salvaged from restoration PR-5). Must stay
	// byte-identical with the <meta name="description"> in src/app.html (the
	// JSON-LD below reuses this constant); e2e/acceptance-copy-deslop.spec.ts
	// pins the parity.
	const description = 'A community-run tool library taking shape in Lewiston–Auburn, Maine.';
	const repoUrl = sourceMap.repoUrl;
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
	// The "·" separator replaces an em-dash (salvaged from restoration PR-5;
	// "·" is the separator the site already uses in the footer).
	const headTitle = $derived(isErrorSurface ? 'Page not found · Great Falls Tool Bus' : title);
	const headDescription = $derived(
		isErrorSurface ? 'This address is not part of the Great Falls Tool Bus site.' : description,
	);

	const currentPath = $derived(page.url.pathname || '/');
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
			{#each primaryNavItems as item (item.href)}
				<a href={item.href} aria-current={isActivePath(currentPath, item.match) ? 'page' : undefined}>{item.label}</a>
			{/each}
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
			<p class="site-footer__licensing">
				Content <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · visual credits are listed with
				each image.
			</p>
		</div>
		{#each footerNavGroups as group (group.heading)}
			<nav class="site-footer__group" aria-label={group.heading}>
				<h2>{group.heading}</h2>
				<ul>
					{#each group.items as item (item.label)}
						<li><a href={item.href}>{item.label}</a></li>
					{/each}
				</ul>
			</nav>
		{/each}
		<nav class="site-footer__group" aria-label="Meta">
			<h2>Meta</h2>
			<ul>
				<li><a href={repoUrl} rel="noopener">Source</a></li>
				<li><a href={`${repoUrl}/security/advisories/new`} rel="noopener">Security</a></li>
			</ul>
		</nav>
	</div>
</footer>
