<script lang="ts">
	import HoursBand from '#lib/components/HoursBand.svelte';
	import LogList from '#lib/components/LogList.svelte';
	import RsvpDialog from '#lib/components/RsvpDialog.svelte';
	import SourceLink from '#lib/components/SourceLink.svelte';
	import { logPage, logPageCount } from '#lib/public-logs.js';

	// The public archive follows the jesssullivan.github.io list structure in B1.2. Prerender
	// links under /log/page/<n> for scriptless pagination as specified at §3 :89-91. The same
	// work sessions band renders the desktop aside and phone marquee. The .log-layout rules in
	// app.css select the layout before hydration.

	const entries = logPage(1);
	const pageCount = logPageCount();
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Log</li>
		</ol>
	</nav>

	<div class="log-layout">
		<div class="log-layout__main">
			<h1>Public log</h1>
			<p class="muted">Short, reviewed entries about public project progress.</p>

			<div class="log-layout__inline">
				<HoursBand id="hours-inline" />
			</div>

			{#if entries.length === 0}
				<!-- TODO(jess): the first entry is a published:false draft awaiting
				     your write-up (addendum B1.2). This honest empty state renders
				     until then. -->
				<p class="muted">No log entries have been published yet.</p>
			{:else}
				<LogList {entries} />
			{/if}

			{#if pageCount > 1}
				<nav class="pagination" aria-label="Log pages">
					<span></span>
					<a href="/log/page/2">Older entries</a>
				</nav>
			{/if}
		</div>

		<HoursBand variant="aside" />
	</div>

	<SourceLink routeId="/log" />
</div>

<!-- The RSVP dialog for either band; outside the page shell, like the home page's. -->
<RsvpDialog />
