<script lang="ts">
	// The home page's Notes & Goals surface: the goals collection
	// (src/content/goals/*.md, via the generated manifest) as a borderless grid
	// that, once enhanced, pages under a windshield wiper. The served HTML,
	// reduced motion, the Off detent, print and forced colours are all the
	// same plain grid of every note; hydration adds paging, the wipe (a DOM
	// mask in lockstep with the engine's clock, src/lib/wiper) and one stalk.
	// Nothing here is a card: the pane carries no background and no border.
	//
	// Edit affordances (operator ruling 2026-09-08): every row links to its
	// own source file through GitHub's web editor, and the section's footer
	// links the whole collection. No org/repo string is hardcoded: repo URL
	// and branch flow from src/lib/generated/source-map.json (the SourceLink
	// pattern), the per-row path from the manifest's `sourcePath`. The links
	// are plain anchors, not the D06 ExternalLink, so the print stylesheet
	// does not expand eight repository URLs onto paper.
	import { onMount, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import sourceMap from '$lib/generated/source-map.json';
	import type { PublicGoal } from '$lib/public-goals';
	import { WiperEngine } from '$lib/wiper/engine.svelte';
	import { pageOf } from '$lib/wiper/schedule';
	import WiperControls from './WiperControls.svelte';

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

	const prefersReduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	const wide = new MediaQuery('(min-width: 48rem)');
	let enhanced = $state(false);
	const pageSize = $derived(wide.current ? 3 : 1);

	const engine = new WiperEngine({
		pageSize: () => pageSize,
		itemCount: () => goals.length,
		motionOk: () => enhanced && !prefersReduced.current,
	});
	const view = $derived(engine.view);
	let paneEl = $state<HTMLElement>();
	let listEl = $state<HTMLOListElement>();

	onMount(() => {
		enhanced = true;
		return () => engine.destroy();
	});

	$effect(() => {
		if (enhanced && paneEl) engine.attach(paneEl);
	});

	// Media changes reach the machine through its getters; nudge the view.
	$effect(() => {
		void pageSize;
		void prefersReduced.current;
		engine.refresh();
	});

	const first = $derived(view.currentPage * view.pageSize + 1);
	const last = $derived(Math.min(goals.length, (view.currentPage + 1) * view.pageSize));

	function wipeRole(index: number): 'out' | 'in' | undefined {
		if (!view.paged) return undefined;
		const page = pageOf(index, view.pageSize);
		if (view.outgoing === page) return 'out';
		if (view.incoming === page) return 'in';
		return undefined;
	}

	function onListFocusIn(event: FocusEvent) {
		engine.setFocus(true);
		const row = (event.target as Element | null)?.closest('li');
		if (row && listEl) {
			const index = Array.prototype.indexOf.call(listEl.children, row);
			if (index >= 0 && view.paged && pageOf(index, view.pageSize) !== view.currentPage) engine.reveal(index);
		}
	}

	function onListFocusOut(event: FocusEvent) {
		const list = event.currentTarget as HTMLElement;
		if (event.relatedTarget instanceof Node && list.contains(event.relatedTarget)) return;
		engine.setFocus(false);
	}
</script>

<!-- A resting pointer over the pane is a courtesy pause, not a control;
     nothing is lost without it, so the handlers sit on the plain wrapper. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="wiper"
	class:wiper--paged={view.paged}
	class:wiper--wiping={view.wiping}
	data-state={view.state}
	bind:this={paneEl}
	onpointerenter={() => engine.setHover(true)}
	onpointerleave={() => engine.setHover(false)}
>
	<ol
		class="goal-list"
		class:goal-list--paged={view.paged}
		role="list"
		aria-labelledby={labelledby}
		style:--wipe-columns={view.paged ? view.pageSize : undefined}
		bind:this={listEl}
		onfocusin={onListFocusIn}
		onfocusout={onListFocusOut}
	>
		{#each goals as goal, index (goal.slug)}
			<li
				class:is-current={view.paged && pageOf(index, view.pageSize) === view.currentPage}
				data-wipe={wipeRole(index)}
				style:grid-column={view.paged ? (index % view.pageSize) + 1 : undefined}
			>
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
	{#if view.rotatable}
		<p class="sr-only" aria-live={view.running ? 'off' : 'polite'} aria-atomic="true">
			{#if view.paged}Showing goals {first} to {last} of {goals.length}{:else}Showing all {goals.length} goals{/if}
		</p>
		<WiperControls {engine} />
	{/if}
	<p class="source-link goal-list__source">
		<span>These notes live in git. Anyone can propose an edit.</span>
		<a href={collectionUrl} target="_blank" rel="noopener external">Edit these notes on GitHub</a>
	</p>
</div>
