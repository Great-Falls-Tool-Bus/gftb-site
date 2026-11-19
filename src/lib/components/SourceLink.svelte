<script lang="ts">
	// Ported from the demo’s src/lib/components/SourceLink.svelte in #94. Each /log/<slug>
	// permalink opens its own .svx file for GitHub editing. `just source-map-build` derives
	// the repo, branch and route paths in src/lib/generated/source-map.json from
	// tinyland.repo.json, package.json, routes and log content. `just source-map-check`
	// detects drift.
	import sourceMap from '#lib/generated/source-map.json';

	interface Props {
		/** SvelteKit route id or permalink, base-stripped ("/" for root). */
		routeId: string;
	}

	let { routeId }: Props = $props();

	const routes = sourceMap.routes as Record<string, string>;
	const sourcePath = $derived(routes[routeId]);
	const editUrl = $derived(`${sourceMap.repoUrl}/edit/${sourceMap.branch}/${sourcePath}`);
	const blobUrl = $derived(`${sourceMap.repoUrl}/blob/${sourceMap.branch}/${sourcePath}`);
</script>

{#if sourcePath}
	<p class="source-link">
		<span>This page lives in git. Anyone can propose an edit.</span>
		<a href={editUrl} target="_blank" rel="noopener" aria-label="Edit this page on GitHub">Edit this page</a>
		<a href={blobUrl} target="_blank" rel="noopener" aria-label="View this page's source on GitHub">View source</a>
	</p>
{/if}
