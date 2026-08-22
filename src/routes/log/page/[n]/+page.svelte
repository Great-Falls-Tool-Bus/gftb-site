<script lang="ts">
	import LogList from '$lib/components/LogList.svelte';
	import { publicLogs } from '$lib/public-logs';

	let { data } = $props();

	// Resolve slugs back to entries here so the load data stays serialisable.
	const entries = $derived(data.slugs.map((slug: string) => publicLogs.find((entry) => entry.slug === slug)!));
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li><a href="/log">Log</a></li>
			<li aria-current="page">Page {data.page}</li>
		</ol>
	</nav>

	<h1>Public log · page {data.page}</h1>

	<LogList {entries} />

	<nav class="pagination" aria-label="Log pages">
		<a href={data.page === 2 ? '/log' : `/log/page/${data.page - 1}`}>Newer entries</a>
		{#if data.page < data.pageCount}
			<a href={`/log/page/${data.page + 1}`}>Older entries</a>
		{:else}
			<span></span>
		{/if}
	</nav>
</div>
