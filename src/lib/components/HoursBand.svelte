<script lang="ts">
	// Work sessions on the bus (operator interview 2026-10-02): the band under
	// the hero. The served HTML is clock-free: one rule row per published slot
	// ("Thursdays, 3 to 4 PM ET, from 8 October") with a mailto RSVP, or the
	// empty state. After mount the rows are expanded on the visitor's clock
	// (src/lib/hours-recurrence.ts) and take one of three shapes
	// (src/lib/hours-band.ts): under 48rem a carousel of cards, one per view,
	// with steps and dots and no auto-advance; at 48rem and up a right-hand
	// vertical loop over a duplicated track, paused on hover, on focus and by
	// its own button; reduced motion, forced colours, a short list and no-JS
	// get the static list. The band clips its own overflow, so the document
	// never widens. The RSVP control is a mailto link until hydration and a
	// button after it; the button raises RSVP_OPEN_EVENT, which the home
	// page's RsvpDialog takes, and while nothing takes it (a page without the
	// dialog) goes to the contact section instead.
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { publicHoursSlots } from '$lib/public-hours';
	import type { PublicHoursSlot } from '$lib/public-hours-schema';
	import {
		chooseHoursMode,
		HOURS_FIXTURE_GLOBAL,
		hoursFixtureSlots,
		LOOP_VISIBLE_ROWS,
		reserveRows,
		ruleRows,
		rowsOnVisitorClock,
		type HoursBandRow,
		type HoursMode,
	} from '$lib/hours-band';
	import { buildRsvpMailtoHref, RSVP_OPEN_EVENT, type RsvpOpenDetail } from '$lib/rsvp-form';

	const keyholders = 'keyholders@latoolb.us';
	/** Seconds the loop spends on each row. */
	const LOOP_SECONDS_PER_ROW = 4;

	const serverRows = ruleRows(publicHoursSlots);
	const reserve = reserveRows(publicHoursSlots);

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	const forcedColors = new MediaQuery('(forced-colors: active)');
	const wide = new MediaQuery('(min-width: 48rem)');

	let mounted = $state(false);
	let rows = $state<HoursBandRow[]>(serverRows);

	const mode: HoursMode = $derived(
		mounted
			? chooseHoursMode({
					rows: rows.length,
					wide: wide.current,
					reducedMotion: reducedMotion.current,
					forcedColors: forcedColors.current,
				})
			: serverRows.length > 0
				? 'rules'
				: 'empty',
	);

	// Carousel: the track scrolls natively (swipe, Tab into a card); the steps
	// and dots scroll it, and the current card is read back from its position.
	let track = $state<HTMLOListElement>();
	let current = $state(0);
	let scrollFrame = 0;

	// Loop: the window shows LOOP_VISIBLE_ROWS rows, measured from the real
	// list so a long note or a wrapped date never clips.
	let loopList = $state<HTMLOListElement>();
	let loopHeight = $state<number | null>(null);
	let paused = $state(false);

	onMount(() => {
		const fixture = hoursFixtureSlots((window as unknown as Record<string, unknown>)[HOURS_FIXTURE_GLOBAL]);
		const slots: PublicHoursSlot[] = fixture ?? publicHoursSlots;
		rows = rowsOnVisitorClock(slots);
		mounted = true;
		return () => {
			if (scrollFrame) cancelAnimationFrame(scrollFrame);
		};
	});

	function openRsvp(row: HoursBandRow, button: HTMLElement) {
		// Focus the trigger first (some browsers do not focus a clicked
		// button), so the RSVP dialog can hand focus back to it on close.
		button.focus();
		const detail: RsvpOpenDetail = { slotId: row.id, label: row.when };
		const event = new CustomEvent<RsvpOpenDetail>(RSVP_OPEN_EVENT, { detail, cancelable: true });
		// A cancelled event was taken by the RSVP dialog.
		if (!window.dispatchEvent(event)) return;
		document.querySelector<HTMLElement>('#contact a.button')?.focus();
	}

	function onTrackScroll() {
		if (scrollFrame) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = 0;
			if (!track || track.clientWidth === 0) return;
			current = Math.max(0, Math.min(rows.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
		});
	}

	function showCard(index: number) {
		if (!track || index < 0 || index >= rows.length) return;
		current = index;
		track.scrollTo({ left: index * track.clientWidth, behavior: reducedMotion.current ? 'auto' : 'smooth' });
	}

	$effect(() => {
		if (mode !== 'carousel') current = 0;
	});

	$effect(() => {
		const list = loopList;
		if (mode !== 'loop' || !list) return;
		const measure = () => {
			const items = list.querySelectorAll<HTMLElement>(':scope > li');
			const last = items[Math.min(LOOP_VISIBLE_ROWS, items.length) - 1];
			if (!last) return;
			loopHeight = Math.ceil(last.getBoundingClientRect().bottom - items[0].getBoundingClientRect().top);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(list);
		return () => observer.disconnect();
	});

	// Focus pauses the loop (app.css, :focus-within). A row that is out of the
	// window when it takes focus is brought to the top of the window by setting
	// the paused animation's own clock, so the focused control is never hidden
	// and the loop resumes from there, seamless.
	function onLoopFocusIn(event: FocusEvent) {
		const viewport = event.currentTarget as HTMLElement;
		const row = (event.target as Element | null)?.closest<HTMLElement>('.hours-row');
		const list = loopList;
		const loopTrack = list?.parentElement;
		viewport.scrollTop = 0;
		if (!row || !list || !loopTrack) return;
		const frame = viewport.getBoundingClientRect();
		const box = row.getBoundingClientRect();
		if (box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1) return;
		const animation = loopTrack
			.getAnimations()
			.find((candidate) => candidate instanceof CSSAnimation && candidate.animationName === 'hours-loop');
		const duration = Number(animation?.effect?.getComputedTiming().duration);
		const height = list.getBoundingClientRect().height;
		if (!animation || !Number.isFinite(duration) || height <= 0) return;
		animation.currentTime = ((box.top - list.getBoundingClientRect().top) / height) * duration;
	}

	// Once focus leaves, the window goes back to the top so the loop stays seamless.
	function onLoopFocusOut(event: FocusEvent) {
		const viewport = event.currentTarget as HTMLElement;
		if (!viewport.contains(event.relatedTarget as Node | null)) viewport.scrollTop = 0;
	}
</script>

{#snippet sessionRow(row: HoursBandRow, hydrated: boolean)}
	<li class="hours-row">
		<p class="hours-row__when">
			{#if row.today}<strong class="hours-row__today">Today</strong>{/if}
			{#if row.datetime}<time datetime={row.datetime}>{row.when}</time>{:else}{row.when}{/if}
		</p>
		<ul class="hours-row__meta">
			<li>{row.repeat}</li>
			<li>{row.staff}</li>
			{#if row.location}<li>{row.location}</li>{/if}
		</ul>
		{#if row.notes}<p class="hours-row__notes">{row.notes}</p>{/if}
		<div class="hours-row__action">
			{#if hydrated}
				<button
					type="button"
					class="button button--secondary"
					aria-label={`RSVP for ${row.when}`}
					onclick={(event) => openRsvp(row, event.currentTarget)}>RSVP</button
				>
			{:else}
				<a
					class="button button--secondary"
					href={buildRsvpMailtoHref(keyholders, { slotId: row.id, label: row.when })}
					aria-label={`RSVP for ${row.when}`}>RSVP</a
				>
			{/if}
		</div>
	</li>
{/snippet}

<section
	class="section section--bare hours-band"
	id="hours"
	aria-labelledby="hours-title"
	data-hours-mode={mode}
	style:--hours-reserve={String(reserve)}
>
	<div class="hours-band__intro">
		<h2 id="hours-title">Work sessions on the bus</h2>
		{#if mode !== 'empty'}
			<!-- TODO(jess): the band's one line of copy, interim wording. It renders
			     only beside published sessions, so it first ships with the flip PR. -->
			<p>A keyholder is on the bus for each session, and visitors are welcome.</p>
		{/if}
		{#if mode === 'loop'}
			<button
				type="button"
				class="button button--secondary hours-band__pause"
				aria-pressed={paused}
				aria-controls="hours-loop"
				onclick={() => (paused = !paused)}>Pause the list</button
			>
		{/if}
	</div>

	<div class="hours-band__body">
		{#if mode === 'empty'}
			<p class="hours-band__empty">
				No work session is scheduled right now. Use the <a href="/contact">contact form</a> to ask about a tour.
			</p>
		{:else if mode === 'carousel'}
			<div class="hours-carousel" role="region" aria-label="Upcoming work sessions">
				<ol class="hours-list hours-carousel__track" bind:this={track} onscroll={onTrackScroll}>
					{#each rows as row (row.id)}
						{@render sessionRow(row, true)}
					{/each}
				</ol>
				<div class="hours-carousel__controls">
					<button
						type="button"
						class="button button--secondary hours-carousel__step"
						aria-label="Previous session"
						aria-disabled={current === 0}
						onclick={() => showCard(current - 1)}>&larr;</button
					>
					<div class="hours-carousel__dots">
						{#each rows as row, index (row.id)}
							<button
								type="button"
								class="hours-carousel__dot"
								aria-label={`Session ${index + 1} of ${rows.length}`}
								aria-current={index === current ? 'true' : undefined}
								onclick={() => showCard(index)}
							></button>
						{/each}
					</div>
					<button
						type="button"
						class="button button--secondary hours-carousel__step"
						aria-label="Next session"
						aria-disabled={current === rows.length - 1}
						onclick={() => showCard(current + 1)}>&rarr;</button
					>
				</div>
			</div>
		{:else if mode === 'loop'}
			<div
				class="hours-loop"
				id="hours-loop"
				role="region"
				aria-label="Upcoming work sessions"
				data-paused={paused ? '' : undefined}
				style:height={loopHeight === null ? undefined : `${loopHeight}px`}
				style:--hours-loop-duration={`${rows.length * LOOP_SECONDS_PER_ROW}s`}
				onfocusin={onLoopFocusIn}
				onfocusout={onLoopFocusOut}
			>
				<div class="hours-loop__track">
					<ol class="hours-list" bind:this={loopList}>
						{#each rows as row (row.id)}
							{@render sessionRow(row, true)}
						{/each}
					</ol>
					<!-- The second copy only closes the loop: inert and hidden from
					     assistive technology, so the rows are read and reached once. -->
					<ol class="hours-list hours-loop__dup" aria-hidden="true" inert>
						{#each rows as row (row.id)}
							{@render sessionRow(row, true)}
						{/each}
					</ol>
				</div>
			</div>
		{:else}
			<ol class="hours-list">
				{#each rows as row (row.id)}
					{@render sessionRow(row, mounted)}
				{/each}
			</ol>
		{/if}
	</div>
</section>
