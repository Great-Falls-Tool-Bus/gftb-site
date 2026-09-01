<script lang="ts">
	import { Carousel, useCarousel } from '@skeletonlabs/skeleton-svelte';

	import { MediaQuery } from 'svelte/reactivity';
	import type { Snippet } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';
	import type { PublicGoal } from '$lib/public-goals';

	// The anatomy parts are re-bound to plain capitalized identifiers instead
	// of being used as dotted member-expression tags: a dotted tag compiles
	// to a dynamic-component thunk whose minified form — one capital letter,
	// a dot, then the part name — is indistinguishable from an
	// initial-plus-surname to the published-artefact leak-scan's
	// private-personal-name rule. Aliases minify to bare identifiers, which
	// the rule cannot mistake for a person.
	const {
		Provider: CarouselProvider,
		ItemGroup: CarouselItemGroup,
		Item: CarouselItem,
		Control: CarouselControl,
		PrevTrigger: CarouselPrevTrigger,
		NextTrigger: CarouselNextTrigger,
		AutoplayTrigger: CarouselAutoplayTrigger,
	} = Carousel;

	// Near-term goals as an auto-cycling carousel on the Skeleton v5 Carousel
	// anatomy (the house's second mounted Skeleton component, after the mode
	// switch). Zag's carousel machine drives layout, paging and the honest
	// aria surface; every rendered element is replaced through the anatomy's
	// `element` snippets so the ratified goals markup survives verbatim:
	// the item group IS the `<ol class="goal-list" role="list">` and each
	// slide IS a plain `<li>` (title, window, sentence, at most one CTA).
	//
	// Progressive enhancement, fail-open like the reveal kit: the server HTML
	// carries no carousel layout styles and no control buttons, so a no-JS
	// (or dead-bundle) visitor gets exactly the resting borderless goals grid.
	// Hydration flips `enhanced`, which applies Zag's inline scroll-snap
	// layout and mounts the working controls.
	//
	// Motion honesty:
	// - autoplay simply never starts under prefers-reduced-motion (the
	//   machine is created without it), and the play/pause control is not
	//   rendered there — rotation is not a feature of the reduced page;
	// - manual prev/next still work under reduced motion, with instant
	//   (non-smooth) scrolls;
	// - autoplay pauses on hover over the slides, on any pointer-down /
	//   touch / wheel engagement with them, and while focus is anywhere in
	//   the region (except on the play/pause control itself, so its label
	//   cannot lie to the keyboard user about to press it). Hover and focus
	//   pauses resume when they end; direct engagement stays paused until
	//   the visitor presses Play. Zag adds the rest: autoplay also stops on
	//   drag and while the document is hidden, and the item group reports
	//   aria-live="off" while cycling / "polite" when paused.

	interface Props {
		goals: PublicGoal[];
		/** id of the heading that names the carousel region. */
		labelledby: string;
		/**
		 * OPTIONAL FEATURED-IMAGE SLOT. Renders at the top of every slide,
		 * receiving that slide's goal. Absent, slides collapse to today's
		 * text-only rows. When goal frontmatter grows image/image_alt keys
		 * (schema lane), mount it from the page as:
		 *
		 *   {#snippet media(goal)}
		 *     {#if goal.metadata.image}
		 *       <figure class="goal-media">
		 *         <img src={goal.metadata.image} alt={goal.metadata.image_alt ?? ''} loading="lazy" />
		 *       </figure>
		 *     {/if}
		 *   {/snippet}
		 */
		media?: Snippet<[PublicGoal]>;
	}

	const { goals, labelledby, media }: Props = $props();

	const AUTOPLAY_DELAY_MS = 7000;

	const prefersReduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	// Mirrors the resting grid's ~17rem column density: three-up on wide
	// viewports, one goal per page on narrow ones (which is also what keeps
	// the section short on a phone — one slide tall, not eight stacked).
	const wide = new MediaQuery('(min-width: 48rem)');

	// False during SSR and until hydration completes; the enhancement gate.
	// Deliberately $state + $effect rather than a derived-from-environment
	// constant: the gate must still be false while Svelte claims the server
	// HTML (so hydration matches the served no-JS markup exactly, with no
	// mismatch repair) and flip only after mount.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let enhanced = $state(false);
	$effect(() => {
		enhanced = true;
	});

	// Transient pause bookkeeping: which courtesy pause is active, so only
	// that pause auto-resumes. Direct engagement clears both (no resume).
	let pausedByHover = $state(false);
	let pausedByFocus = $state(false);

	const id = $props.id();
	const carousel = useCarousel(() => ({
		id,
		slideCount: goals.length,
		loop: true,
		spacing: '2.5rem',
		slidesPerPage: wide.current ? 3 : 1,
		allowMouseDrag: true,
		autoplay: prefersReduced.current ? false : { delay: AUTOPLAY_DELAY_MS },
		translations: {
			prevTrigger: 'Previous goal',
			nextTrigger: 'Next goal',
			indicator: (index: number) => `Go to page ${index + 1}`,
			item: (index: number, count: number) => `Goal ${index + 1} of ${count}`,
			autoplayStart: 'Play auto-advance',
			autoplayStop: 'Pause auto-advance',
		},
	}));

	// The anatomy's `element` snippets type their attribute bags against the
	// part's default tag (div); re-key them for the semantic elements this
	// component actually renders. Runtime shape is identical.
	const asOlAttributes = (attributes: object) => attributes as SvelteHTMLElements['ol'];
	const asLiAttributes = (attributes: object) => attributes as SvelteHTMLElements['li'];

	const api = $derived(carousel());

	function pauseIfPlaying(): boolean {
		if (!api.isPlaying) return false;
		api.pause();
		return true;
	}

	function onSlidesMouseEnter() {
		if (pauseIfPlaying()) pausedByHover = true;
	}

	function onSlidesMouseLeave() {
		if (pausedByHover && !pausedByFocus && !prefersReduced.current) api.play();
		pausedByHover = false;
	}

	// Pointer-down (mouse, touch or pen) and wheel are direct engagement
	// with the slides: stop rotating and stay stopped until Play.
	function onSlidesEngage() {
		pauseIfPlaying();
		pausedByHover = false;
		pausedByFocus = false;
	}

	function onRegionFocusIn(event: FocusEvent) {
		const target = event.target as HTMLElement | null;
		// The play/pause control is exempt: pausing on ITS focus would flip
		// its own label to "Play" before the keyboard user could press Stop.
		if (target?.closest('[data-part="autoplay-trigger"]')) return;
		if (pauseIfPlaying()) pausedByFocus = true;
	}

	function onRegionFocusOut(event: FocusEvent) {
		const region = event.currentTarget as HTMLElement;
		if (event.relatedTarget instanceof Node && region.contains(event.relatedTarget)) return;
		if (pausedByFocus && !pausedByHover && !prefersReduced.current) api.play();
		pausedByFocus = false;
	}

	function onToggleAutoplay() {
		if (api.isPlaying) {
			api.pause();
		} else {
			pausedByHover = false;
			pausedByFocus = false;
			// A tap-without-swipe or a vertical page-scroll wheel over the
			// slides parks the machine in its userScroll state: Zag's own
			// ontouchstart/onwheel (spread onto the list) send USER.SCROLL
			// after this component's engage-pause has already reached idle,
			// and since neither gesture ever scrolls the item group, no
			// SCROLL.END arrives to leave userScroll again. That state
			// ignores AUTOPLAY.START, so play() alone would silently do
			// nothing — a Play control that lies. PAGE.SET is handled
			// globally with target idle, so re-assert the current page
			// (same index: no scroll, no motion) to walk the machine back
			// to idle before starting rotation.
			api.scrollTo(api.page, true);
			api.play();
		}
	}
</script>

<CarouselProvider
	value={carousel}
	class="goal-carousel"
	aria-labelledby={labelledby}
	onfocusin={onRegionFocusIn}
	onfocusout={onRegionFocusOut}
>
	<CarouselItemGroup>
		{#snippet element(attributes)}
			<!-- The ratified goals list, unchanged: OL, role="list", borderless
			     rows (never-cards stands). Zag's inline scroll-snap layout is
			     withheld until hydration so the served HTML lays out as the
			     resting grid (.goal-list CSS). role="list" is restated because
			     list-style: none would otherwise drop list semantics. -->
			<ol
				{...asOlAttributes(attributes)}
				style={enhanced ? attributes.style : undefined}
				class="goal-list"
				class:goal-list--enhanced={enhanced}
				role="list"
				onmouseenter={onSlidesMouseEnter}
				onmouseleave={onSlidesMouseLeave}
				onpointerdown={onSlidesEngage}
				onwheel={(event) => {
					attributes.onwheel?.(event as never);
					onSlidesEngage();
				}}
			>
				{#each goals as goal, index (goal.slug)}
					<CarouselItem {index}>
						{#snippet element(itemAttributes)}
							<!-- Slides stay real list items: Zag's role="group" and
							     its positional aria-label are dropped (the list
							     already announces position, and the goal title must
							     stay the row's accessible name); the "slide"
							     roledescription and in-view bookkeeping stay.
							     aria-hidden is withheld until hydration so the
							     static document never ships hidden content. -->
							<li
								{...asLiAttributes(itemAttributes)}
								role={undefined}
								aria-label={undefined}
								aria-hidden={enhanced ? itemAttributes['aria-hidden'] : undefined}
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
							</li>
						{/snippet}
					</CarouselItem>
				{/each}
			</ol>
		{/snippet}
	</CarouselItemGroup>

	{#if enhanced}
		<!-- Controls mount only once the machine is live: no dead buttons in
		     the no-JS document. Under reduced motion the rotation control is
		     not offered at all — there is no rotation to control. -->
		<CarouselControl>
			{#snippet element(controlAttributes)}
				<div {...controlAttributes} class="goal-carousel__controls">
					<CarouselPrevTrigger>
						{#snippet element(prevAttributes)}
							<button
								{...prevAttributes}
								class="goal-carousel__button"
								onclick={() => api.scrollPrev(prefersReduced.current)}
							>
								Previous
							</button>
						{/snippet}
					</CarouselPrevTrigger>
					<CarouselNextTrigger>
						{#snippet element(nextAttributes)}
							<button
								{...nextAttributes}
								class="goal-carousel__button"
								onclick={() => api.scrollNext(prefersReduced.current)}
							>
								Next
							</button>
						{/snippet}
					</CarouselNextTrigger>
					{#if !prefersReduced.current}
						<CarouselAutoplayTrigger>
							{#snippet element(autoplayAttributes)}
								<!-- Zag ids every other trigger but not this one; the stable
								     id also keeps identity constant while the visible
								     Pause/Play text tracks the machine state. -->
								<button
									{...autoplayAttributes}
									id="carousel:{id}:autoplay-trigger"
									class="goal-carousel__button"
									aria-label={api.isPlaying ? 'Pause auto-advance' : 'Play auto-advance'}
									onclick={onToggleAutoplay}
								>
									{api.isPlaying ? 'Pause' : 'Play'}
								</button>
							{/snippet}
						</CarouselAutoplayTrigger>
					{/if}
					<p class="goal-carousel__progress">
						Page {api.page + 1} of {Math.max(api.pageSnapPoints.length, 1)}
					</p>
				</div>
			{/snippet}
		</CarouselControl>
	{/if}
</CarouselProvider>
