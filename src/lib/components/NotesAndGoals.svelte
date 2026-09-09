<script lang="ts">
	// The home page's Notes & Goals surface: the goals collection
	// (src/content/goals/*.md, via the generated manifest) as a plain,
	// borderless grid. Operator ruling 2026-09-09: the wiper rotator is off
	// the public surface until a real one exists; this file keeps the
	// ratified row markup (never-cards stands: title, plain window, one
	// sentence, at most one CTA), the per-goal "Edit" link, and the
	// section-level link to the collection tree.
	//
	// Edit affordances (operator ruling 2026-09-08): every row links to its
	// own source file through GitHub's web editor, and the section's footer
	// links the whole collection. No org/repo string is hardcoded: repo URL
	// and branch flow from src/lib/generated/source-map.json (the SourceLink
	// pattern), the per-row path from the manifest's `sourcePath`. The links
	// are plain anchors, not the D06 ExternalLink, so the print stylesheet
	// does not expand eight repository URLs onto paper.
	import type { Snippet } from 'svelte';
	import sourceMap from '$lib/generated/source-map.json';
	import type { PublicGoal } from '$lib/public-goals';

	interface Props {
		goals: PublicGoal[];
		/** id of the heading that names the group. */
		labelledby: string;
		/**
		 * OPTIONAL FEATURED-IMAGE SLOT, rendered at the top of every row with
		 * that row's goal. The home page supplies it from the shared goal
		 * image metadata (see +page.svelte); omit it for text-only rows.
		 */
		media?: Snippet<[PublicGoal]>;
	}

	const { goals, labelledby, media }: Props = $props();

	const editUrl = (goal: PublicGoal): string => `${sourceMap.repoUrl}/edit/${sourceMap.branch}/${goal.sourcePath}`;
	const collectionUrl = `${sourceMap.repoUrl}/tree/${sourceMap.branch}/src/content/goals`;
</script>

<ol class="goal-list" role="list" aria-labelledby={labelledby}>
	{#each goals as goal (goal.slug)}
		<li>
			{#if media}
				{@render media(goal)}
			{/if}
			<h3>{goal.metadata.title}</h3>
			{#if goal.metadata.window}
				<p class="log-meta">{goal.metadata.window}</p>
			{/if}
			{#if goal.text}
				<p>{goal.text}</p>
			{/if}
			{#if goal.metadata.cta_label && goal.metadata.cta_href}
				<p class="goal-cta"><a href={goal.metadata.cta_href}>{goal.metadata.cta_label}</a></p>
			{/if}
			<p class="goal-edit">
				<a
					href={editUrl(goal)}
					target="_blank"
					rel="noopener external"
					aria-label="Edit {goal.metadata.title} on GitHub">Edit</a
				>
			</p>
		</li>
	{/each}
</ol>
<p class="source-link goal-list__source">
	<span>These notes live in git. Anyone can propose an edit.</span>
	<a href={collectionUrl} target="_blank" rel="noopener external">Edit these notes on GitHub</a>
</p>
