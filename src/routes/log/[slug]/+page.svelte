<script lang="ts">
	import FeaturedImage from '$lib/components/FeaturedImage.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import { publicLogs, formatLogDate } from '$lib/public-logs';

	let { data } = $props();

	// The permalink surface (B1.2): breadcrumbs, the dated entry, and the
	// per-post edit affordance (SourceLink resolves /log/<slug> to the .svx
	// source through the generated map, #94 pattern).
	const entry = $derived(publicLogs.find((candidate) => candidate.slug === data.slug)!);
	const EntryBody = $derived(data.EntryBody);
</script>

<!-- No <svelte:head> title here: the layout's SEOHead is the single head
     authority (see +layout.svelte — duplicate titles fought each other). -->
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
