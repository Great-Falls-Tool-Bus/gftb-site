<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import '../app.css';

	let { children } = $props();

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
</script>

<SEOHead {title} {description} siteName="Great Falls Tool Bus" origin={siteUrl} {jsonLd} />

<a class="skip-link" href="#main-content">Skip to content</a>

<header class="site-header">
	<div class="site-header__inner">
		<a class="brand" href="/" aria-label="Great Falls Tool Bus home">
			<img src="/logo/bus-silhouette.svg" alt="" width="80" height="38" />
			<span>Great Falls Tool Bus</span>
		</a>
		<nav class="site-nav" aria-label="Main navigation">
			<a href="#status">Status</a>
			<a href="#log">Log</a>
			<a href="#contact">Contact</a>
		</nav>
	</div>
</header>

<main id="main-content">
	{@render children?.()}
</main>

<footer class="site-footer">
	<div class="site-footer__inner">
		<span>Great Falls Tool Bus · Lewiston–Auburn, Maine</span>
		<span>
			Content <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · visual credits are listed with
			each image.
		</span>
	</div>
</footer>
