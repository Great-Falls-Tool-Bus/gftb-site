<script lang="ts">
	import HoursBand from '$lib/components/HoursBand.svelte';
	import LogList from '$lib/components/LogList.svelte';
	import RsvpDialog from '$lib/components/RsvpDialog.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import { logPage, logPageCount } from '$lib/public-logs';

	// The public log archive, page 1 (spec §3 rows 5-6, :89-91): a plain
	// list — never cards — with plain-text badges, per the
	// jesssullivan.github.io blog-list structure (addendum B1.2). Older pages
	// are plain prerendered links under /log/page/<n>: pagination that works
	// with JavaScript disabled (spec :90-91).
	//
	// Work sessions on the bus (operator interview 2026-10-02): on desktop the
	// schedule is a sticky right-hand aside with its own scroll; on phones and
	// tablets it is the home page's marquee above the list. Both render from
	// the one band component and CSS shows exactly one (app.css, .log-layout),
	// so the served HTML is already in its final layout.

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
