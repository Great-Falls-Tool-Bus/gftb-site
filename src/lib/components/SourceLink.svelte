<script lang="ts">
	// The git-onboarding affordance, ported from the demo site (#94,
	// src/lib/components/SourceLink.svelte): a page links to its own source so
	// a reader can see "this page lives in git" and propose an edit through
	// GitHub's web editor. On the log it is wired PER POST (B1.2): the route
	// map covers /log/<slug> permalinks and points at the .svx file itself.
	//
	// No org/repo string is hardcoded. The repo URL, branch, and the
	// route -> source-path map all flow from src/lib/generated/source-map.json,
	// which `just source-map-build` derives from tinyland.repo.json /
	// package.json plus the routes tree and the log content tree; `just
	// source-map-check` drift-gates it. Icons are not ported (no icon dep).
	import sourceMap from '$lib/generated/source-map.json';

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
