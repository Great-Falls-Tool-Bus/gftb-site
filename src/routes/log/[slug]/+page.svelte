<script lang="ts">
	import FeaturedImage from '#lib/components/FeaturedImage.svelte';
	import SourceLink from '#lib/components/SourceLink.svelte';
	import { publicLogs, formatLogDate } from '#lib/public-logs.js';

	let { data } = $props();

	// SourceLink resolves /log/<slug> to its .svx source for the B1.2 edit link through the
	// #94 generated map.
	const entry = $derived(publicLogs.find((candidate) => candidate.slug === data.slug)!);
	const EntryBody = $derived(data.EntryBody);
</script>

<!-- +layout.svelte sets the title through SEOHead. A second <svelte:head> here would
     duplicate it. -->
<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li><a href="/log">Log</a></li>
			<li aria-current="page">{entry.metadata.title}</li>
		</ol>
	</nav>

	<article class="log-entry">
		<header class="log-entry__header">
			<h1>{entry.metadata.title}</h1>
			<p class="log-meta">
				{formatLogDate(entry.metadata.date)}{#if entry.metadata.updated}
					· updated {formatLogDate(entry.metadata.updated)}{/if}
			</p>
			<p>{entry.metadata.summary}</p>
			<p class="log-tags">{entry.metadata.tags.join(' · ')}</p>
		</header>
		<!-- Top-of-post hero; renders nothing for imageless entries. -->
		<FeaturedImage
			variant="hero"
			src={entry.metadata.image}
			alt={entry.metadata.image_alt}
			caption={entry.metadata.image_caption}
			aspect={entry.metadata.image_aspect}
		/>
		<div class="log-entry__body"><EntryBody /></div>
	</article>

	<SourceLink routeId={`/log/${entry.slug}`} />
</div>
