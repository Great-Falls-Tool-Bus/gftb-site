<script lang="ts">
	import SourceLink from '$lib/components/SourceLink.svelte';
	import { publicLogs } from '$lib/public-logs';

	let { data } = $props();

	// The permalink surface (B1.2): breadcrumbs, the dated entry, and the
	// per-post edit affordance (SourceLink resolves /log/<slug> to the .svx
	// source through the generated map, #94 pattern).
	const entry = $derived(publicLogs.find((candidate) => candidate.slug === data.slug)!);
	const EntryBody = $derived(data.EntryBody);

	const formatDate = (value: string) =>
		new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
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
				{formatDate(entry.metadata.date)}{#if entry.metadata.updated}
					· updated {formatDate(entry.metadata.updated)}{/if}
			</p>
			<p>{entry.metadata.summary}</p>
			<p class="log-tags">{entry.metadata.tags.join(' · ')}</p>
		</header>
		<div class="log-entry__body"><EntryBody /></div>
	</article>

	<SourceLink routeId={`/log/${entry.slug}`} />
</div>
