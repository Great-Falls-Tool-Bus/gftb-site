<script lang="ts">
	import HoursBand from '$lib/components/HoursBand.svelte';
	import LogList from '$lib/components/LogList.svelte';
	import RsvpDialog from '$lib/components/RsvpDialog.svelte';
	import { publicLogs } from '$lib/public-logs';

	let { data } = $props();

	// Resolve slugs back to entries here so the load data stays serialisable.
	const entries = $derived(data.slugs.map((slug: string) => publicLogs.find((entry) => entry.slug === slug)!));

	// The work sessions schedule takes the same two shapes as on /log (see
	// src/routes/log/+page.svelte).
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li><a href="/log">Log</a></li>
			<li aria-current="page">Page {data.page}</li>
		</ol>
	</nav>

	<div class="log-layout">
		<div class="log-layout__main">
			<h1>Public log · page {data.page}</h1>

			<div class="log-layout__inline">
				<HoursBand id="hours-inline" />
			</div>

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

		<HoursBand variant="aside" />
	</div>
</div>

<RsvpDialog />
