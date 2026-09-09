<script lang="ts" generics="T">
	import { tick, untrack, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { WiperCycle } from './wiper-rotator.svelte';
	import {
		DEFAULT_WIPER_POSITION,
		DEFAULT_WIPER_SKIN,
		WIPER_POSITIONS,
		pageCountFor,
		pageOf,
		stepWiperPosition,
		type WiperPosition,
		type WiperSkin,
	} from './wiper-rotator';

	// A generic "windshield wiper" rotator: a frosted pane (the house
	// .hero-glass idiom restated as .wiper in app.css, so the brand-vectors
	// blobs shimmer through it like rain on glass), a list of items paged three-up on wide viewports and
	// one-up on narrow ones, and two wiper arms that sweep across the pane
	// between pages. Items show at rest between wipes; the page changes at
	// the blades' turnaround. The only controls are a wipers switch and a
	// speed stalk (Off / Intermittent / Low / High). No prev/next, no play.
	//
	// The component is item-agnostic: callers render rows through the `item`
	// snippet and may add a `footer`. The first consumer is
	// NotesAndGoals.svelte (the home page's goals collection).
	//
	// Progressive enhancement, fail-open like the reveal kit: the served HTML
	// is the resting grid of every item with no controls, no arms, no inline
	// styles and nothing aria-hidden. Hydration flips `enhanced`, which pages
	// the list, mounts the arms and the dash controls, and hangs the timing
	// custom properties on the pane (never on the list).
	//
	// Motion honesty:
	// - under prefers-reduced-motion nothing rotates and no rotation control
	//   is offered: the page is the resting grid (rotation is not a feature of
	//   the reduced page). Every wiper keyframe and transition in app.css
	//   lives inside a no-preference media block, so the reduced-motion sweep
	//   is clean by construction;
	// - the wipe is a CSS animation (two strokes, `alternate`); the swap point
	//   is the `animationiteration` event at the turnaround, the end of the
	//   wipe is `animationend`/`animationcancel`, and a timer failsafe covers a
	//   throttled tab. The old page fades out under the outbound stroke and
	//   the new page fades in under the return stroke (data-stroke), so the
	//   two never overprint each other. The only JS timer is the dwell between wipes, an
	//   $effect whose teardown IS the pause;
	// - rotation pauses while the pointer (mouse, touch or pen) is over the
	//   pane, while focus is inside the list, and while the document is
	//   hidden; each of those resumes when it ends. Pointer/visibility pauses
	//   let an in-flight sweep finish. Focus-follow cancels it immediately so
	//   the focused note is visible and cannot turn away beneath the keyboard;
	// - Off (the stalk's first detent, or the switch) is the resting grid of
	//   every item, immediately. It is also the rollback surface;
	// - the status line is aria-live="off" while rotating and "polite" when
	//   paused or off, which is exactly when a page change is user-caused.
	//
	// Page size is declared in two coupled places: the `wide` media query
	// below and the `@media (min-width: 48rem)` nth-child block in app.css
	// (the CSS needs literal `3n + k` selectors). Change both or neither.

	interface Props {
		items: T[];
		/** Stable key for the keyed each block. */
		key: (item: T) => string;
		/** Row body, rendered inside a bare, borderless list item. */
		item: Snippet<[T, number]>;
		/** id of the heading that names this group. */
		labelledby: string;
		/** Extra class(es) on the list; goals pass "goal-list" so existing pins hold. */
		listClass?: string;
		/** Plural noun for the status line: "Showing goals 4 to 6 of 8". */
		noun?: string;
		/** Stalk detent on load. */
		initialPosition?: WiperPosition;
		/** Static droplet texture on the glass (CSS only, never animated). */
		rain?: boolean;
		/** Named skin; every skin rule is scoped under data-skin in app.css. */
		skin?: WiperSkin;
		/** Rendered after the controls, inside the pane. */
		footer?: Snippet;
	}

	const {
		items,
		key,
		item,
		labelledby,
		listClass,
		noun = 'items',
		initialPosition = DEFAULT_WIPER_POSITION,
		rain = false,
		skin = DEFAULT_WIPER_SKIN,
		footer,
	}: Props = $props();

	const prefersReduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	// Three-up on wide viewports, one item per page on narrow ones (one
	// item tall, not eight stacked: the phone height budget).
	const wide = new MediaQuery('(min-width: 48rem)');

	// False during SSR and until hydration completes; the enhancement gate.
	// Deliberately $state + $effect rather than an environment-derived
	// constant: the gate must still be false while Svelte claims the server
	// HTML (so hydration matches the served markup exactly) and flip only
	// after mount.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let enhanced = $state(false);
	$effect(() => {
		enhanced = true;
	});

	const pageSize = $derived(wide.current ? 3 : 1);
	const cycle = new WiperCycle(
		() => pageCountFor(items.length, pageSize),
		() => !prefersReduced.current,
		// The stalk's starting detent is read once; it is not a live binding.
		untrack(() => initialPosition),
	);

	/** The list is stacked into pages (as opposed to the resting grid). */
	const paged = $derived(enhanced && cycle.rotatable && cycle.enabled);
	const paneState = $derived(!paged ? 'off' : cycle.phase === 'wiping' ? 'wiping' : cycle.paused ? 'paused' : 'dwell');
	const first = $derived(cycle.currentPage * pageSize + 1);
	const last = $derived(Math.min(items.length, (cycle.currentPage + 1) * pageSize));

	let listEl = $state<HTMLOListElement>();

	// The dwell timer. Pausing, switching off, or a speed change all re-run
	// this effect; its teardown clears the pending wipe.
	$effect(() => {
		if (!cycle.running || cycle.phase !== 'dwell') return;
		const handle = setTimeout(() => cycle.startWipe(), cycle.dwellMs);
		return () => clearTimeout(handle);
	});

	// Failsafe: if the animation events never arrive (display: none, a
	// throttled background tab, the arms unmounted mid-sweep), end the wipe
	// after it should have finished so the dwell timer can re-arm. The budget
	// leaves room for a delayed animation start: a busy main thread (the
	// full-viewport blob layer's physics on a slow device) can hold a CSS
	// animation's start for several hundred milliseconds, and cutting a wipe
	// short there would drop the turnaround along with the trail.
	$effect(() => {
		if (cycle.phase !== 'wiping') return;
		const handle = setTimeout(() => cycle.finish(), cycle.activeSweepMs + 1200);
		return () => clearTimeout(handle);
	});

	function onPaneEnter() {
		cycle.hover = true;
	}

	function onPaneLeave() {
		cycle.hover = false;
	}

	// Focus-follow: a keyboard user tabbing into a row on another page sees
	// that page at once (no wipe), and rotation waits while focus stays in
	// the list. The controls are outside the list on purpose, so someone
	// operating the stalk can watch the speed change.
	function onListFocusIn(event: FocusEvent) {
		cycle.focus = true;
		const row = (event.target as Element | null)?.closest('li');
		if (row && listEl) {
			const index = Array.prototype.indexOf.call(listEl.children, row);
			if (index >= 0) cycle.reveal(index, pageSize);
		}
	}

	function onListFocusOut(event: FocusEvent) {
		const list = event.currentTarget as HTMLElement;
		if (event.relatedTarget instanceof Node && list.contains(event.relatedTarget)) return;
		cycle.focus = false;
	}

	// Each phase change fires once, from a named arm: the leader (left,
	// undelayed) reports the turnaround, the last ghost (the most delayed
	// blade) reports the end so the trail is never cut off mid-return. Only
	// the sweep animation counts. (animationcancel is not typed on svg
	// elements; the failsafe effect above covers a cancelled sweep.)
	function onSweepIteration(event: AnimationEvent) {
		if (event.animationName === 'wiper-sweep') cycle.apex();
	}

	function onSweepEnd(event: AnimationEvent) {
		if (event.animationName === 'wiper-sweep') cycle.finish();
	}

	async function onStalkKey(event: KeyboardEvent) {
		let next: WiperPosition;
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				next = stepWiperPosition(cycle.position, 1);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				next = stepWiperPosition(cycle.position, -1);
				break;
			case 'Home':
				next = WIPER_POSITIONS[0].id;
				break;
			case 'End':
				next = WIPER_POSITIONS[WIPER_POSITIONS.length - 1].id;
				break;
			default:
				return;
		}
		event.preventDefault();
		const group = event.currentTarget as HTMLElement;
		cycle.setPosition(next);
		await tick();
		group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
	}
</script>

<svelte:document onvisibilitychange={() => (cycle.hidden = document.hidden)} />

<div
	class={[
		'wiper',
		enhanced && 'wiper--enhanced',
		paged && 'wiper--paged',
		paneState === 'wiping' && 'wiper--wiping',
		rain && 'wiper--rain',
	]}
	data-skin={skin}
	role="group"
	aria-labelledby={labelledby}
	data-state={paneState}
	data-stroke={paneState === 'wiping' ? cycle.stroke : undefined}
	data-page={paged ? cycle.currentPage : undefined}
	style:--wiper-dwell={enhanced ? `${cycle.dwellMs}ms` : undefined}
	style:--wiper-stroke={enhanced ? `${cycle.activeSweepMs / 2}ms` : undefined}
	onpointerenter={onPaneEnter}
	onpointerleave={onPaneLeave}
	onpointercancel={onPaneLeave}
>
	<!-- The list is the same element in every state: the resting grid when
	     served, when off, under reduced motion and on paper; a stacked page
	     once enhanced and rotating. Every item stays in the DOM and in the
	     accessibility tree (off-page rows are transparent and inert, never
	     aria-hidden). role="list" is restated because list-style: none would
	     otherwise drop list semantics. -->
	<ol
		bind:this={listEl}
		class={['wiper-list', listClass, paged && 'wiper-list--paged']}
		role="list"
		onfocusin={onListFocusIn}
		onfocusout={onListFocusOut}
	>
		{#each items as entry, index (key(entry))}
			<li class={{ 'is-current': paged && pageOf(index, pageSize) === cycle.currentPage }}>
				{@render item(entry, index)}
			</li>
		{/each}
	</ol>

	{#if enhanced && cycle.rotatable}
		<p class="sr-only wiper-status" aria-live={cycle.running ? 'off' : 'polite'} aria-atomic="true">
			{#if paged}
				Showing {noun} {first} to {last} of {items.length}
			{:else}
				Showing all {items.length} {noun}
			{/if}
		</p>

		{#if paged}
			<!-- Two arms, parked near horizontal, sweeping in tandem, each with two
			     ghost blades lagging it (a motion trail, delayed copies of the
			     same sweep). Decorative: hidden from AT, inert to the pointer,
			     painted above the rows and clipped by the pane. Rect-only chrome
			     (square hub, highlight and shadow stripes): no defs, no ids, no
			     round forms. The narrow layout shows one centred arm (app.css). -->
			<div class="wiper-arms" aria-hidden="true">
				{#each ['left', 'right'] as side (side)}
					{#each [0, 1, 2] as ghost (ghost)}
						<svg
							class={['wiper-arm', `wiper-arm--${side}`, ghost > 0 && `wiper-arm--ghost wiper-arm--ghost-${ghost}`]}
							viewBox="0 0 24 320"
							preserveAspectRatio="xMidYMax meet"
							focusable="false"
							onanimationiteration={side === 'left' && ghost === 0 ? onSweepIteration : undefined}
							onanimationend={side === 'left' && ghost === 2 ? onSweepEnd : undefined}
						>
							<rect class="wiper-arm__blade" x="8" y="0" width="8" height="196" />
							<rect class="wiper-arm__blade-hi" x="8" y="0" width="2" height="196" />
							<rect class="wiper-arm__blade-lo" x="14" y="0" width="2" height="196" />
							<rect class="wiper-arm__shaft" x="10.5" y="180" width="3" height="132" />
							<rect class="wiper-arm__hub" x="3" y="302" width="18" height="18" />
							<rect class="wiper-arm__stripe-hi" x="3" y="302" width="18" height="2" />
							<rect class="wiper-arm__stripe-lo" x="3" y="318" width="18" height="2" />
						</svg>
					{/each}
				{/each}
			</div>
		{/if}

		<!-- The dash: a wipers switch and the speed stalk. The stalk is the
		     source of truth; the switch flips between Off and the last active
		     detent. Detents are buttons with role="radio" and a roving
		     tabindex (one Tab stop; arrows move and select). -->
		<div class="wiper-controls" role="group" aria-label="Wipers">
			<button
				type="button"
				class="wiper-switch"
				role="switch"
				aria-checked={cycle.enabled}
				aria-label="Wipers"
				onclick={() => cycle.toggle()}
			>
				<span class="wiper-switch__track" aria-hidden="true"><span class="wiper-switch__thumb"></span></span>
				<span class="wiper-switch__text" aria-hidden="true">
					Wipers <span class="wiper-switch__state">{cycle.enabled ? 'On' : 'Off'}</span>
				</span>
			</button>
			<div class="wiper-stalk" role="radiogroup" aria-label="Wiper speed" tabindex="-1" onkeydown={onStalkKey}>
				{#each WIPER_POSITIONS as detent (detent.id)}
					<button
						type="button"
						class="wiper-stalk__detent"
						role="radio"
						aria-checked={cycle.position === detent.id}
						tabindex={cycle.position === detent.id ? 0 : -1}
						onclick={() => cycle.setPosition(detent.id)}
					>
						{detent.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if footer}
		{@render footer()}
	{/if}
</div>
