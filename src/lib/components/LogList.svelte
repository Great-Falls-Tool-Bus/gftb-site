<script lang="ts">
	import type { PublicLog } from '$lib/public-logs';

	// The archive list row: hairline list, NO cards, plain-text badges
	// (jesssullivan.github.io blog-list structure; addendum B1.2). Shared by
	// /log and every /log/page/<n> so the pages cannot drift.

	interface Props {
		entries: PublicLog[];
	}

	let { entries }: Props = $props();

	const formatDate = (value: string) =>
		new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
</script>

<ul class="log-list">
	{#each entries as entry (entry.slug)}
		<li>
			<h3><a href={`/log/${entry.slug}`}>{entry.metadata.title}</a></h3>
			<p class="log-meta">
				{formatDate(entry.metadata.date)}{#if entry.metadata.updated}
					· updated {formatDate(entry.metadata.updated)}{/if}
			</p>
			<p>{entry.metadata.summary}</p>
			<p class="log-tags">{entry.metadata.tags.join(' · ')}</p>
		</li>
	{/each}
</ul>
