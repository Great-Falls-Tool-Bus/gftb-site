<script lang="ts">
	import { formatLogDate, summaryDiffersFromTitle, type PublicLog } from '$lib/public-logs';

	// The archive list row: a plain list, NO cards, plain-text badges
	// (jesssullivan.github.io blog-list structure; addendum B1.2). Operator
	// ruling 2026-08-30 supersedes B1.2's hairline clause: rows are separated
	// by whitespace only, borderless. The never-cards clause stands. Shared by
	// /log and every /log/page/<n> so the pages cannot drift.

	interface Props {
		entries: PublicLog[];
	}

	let { entries }: Props = $props();
</script>

<ul class="log-list">
	{#each entries as entry (entry.slug)}
		<li>
			<h3><a href={`/log/${entry.slug}`}>{entry.metadata.title}</a></h3>
			<p class="log-meta">
				{formatLogDate(entry.metadata.date)}{#if entry.metadata.updated}
					· updated {formatLogDate(entry.metadata.updated)}{/if}
				· {entry.metadata.tags.join(' · ')}
			</p>
			{#if summaryDiffersFromTitle(entry.metadata)}
				<p>{entry.metadata.summary}</p>
			{/if}
		</li>
	{/each}
</ul>
