<script lang="ts">
	// Work sessions on the bus (operator interview 2026-10-02; layout revised
	// the same day). The served HTML is clock-free: one rule row per published
	// slot ("Thursdays, 3 to 4 PM ET, from 8 October") with a mailto RSVP, or
	// the empty state. After mount the rows are expanded on the visitor's clock
	// (src/lib/hours-recurrence.ts) and take one of two shapes
	// (src/lib/hours-band.ts):
	//
	// - `marquee` variant (the home page between the FAQ and the log, and the
	//   log pages above the list on phones and tablets): the cards scroll right
	//   to left over a duplicated track, at every width, once one copy of them
	//   fills the band. The track is a real horizontal scroller, so a finger
	//   (or a trackpad) can scroll it, with snapping while it is held. Nothing
	//   on screen stops it, because nothing needs to (operator ruling
	//   2026-10-02): it holds still under a mouse or pen, while keyboard focus
	//   is inside it, while a finger or button is down on it, for a few
	//   seconds after a hand scroll, and while the RSVP dialog is open. That is
	//   the WCAG 2.2.2 mechanism.
	// - `aside` variant (the log pages' right-hand column on desktop): the
	//   same rows as a plain vertical list in a sticky box with its own scroll.
	//
	// Reduced motion, forced colours, a list too short to fill the band and
	// no-JS get the static list. The band clips its own overflow, so the
	// document never widens. The RSVP control is a mailto link until hydration
	// and a button after it; the button raises RSVP_OPEN_EVENT, which the
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
		MARQUEE_GAP_REM,
		MARQUEE_RESUME_MS,
		marqueeAdvance,
		marqueeCardWidth,
		marqueeFills,
		marqueeHeld,
		marqueeWrap,
		reserveRows,
		ruleRows,
		rowsOnVisitorClock,
		type HoursBandRow,
		type HoursMode,
		type HoursVariant,
	} from '$lib/hours-band';
	import { buildRsvpMailtoHref, RSVP_OPEN_ATTR, RSVP_OPEN_EVENT, type RsvpOpenDetail } from '$lib/rsvp-form';
	import { reveal } from '$lib/motion.svelte';

	interface Props {
		variant?: HoursVariant;
		/** The band's id; its heading is `<id>-title`. A page with two bands gives each its own. */
		id?: string;
		/** Arms the scroll reveal with this stagger, in ms, like the sections around it. */
		revealDelay?: number;
	}

	let { variant = 'marquee', id = 'hours', revealDelay }: Props = $props();

	const keyholders = 'keyholders@latoolb.us';

	const serverRows = ruleRows(publicHoursSlots);
	const reserve = reserveRows(publicHoursSlots);

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	const forcedColors = new MediaQuery('(forced-colors: active)');

	let mounted = $state(false);
	let rows = $state<HoursBandRow[]>(serverRows);
	let remPx = $state(16);
	let bodyWidth = $state(0);

	const cardPx = $derived(marqueeCardWidth(bodyWidth, remPx));
	const gapPx = $derived(MARQUEE_GAP_REM * remPx);

	const mode: HoursMode = $derived(
		mounted
			? chooseHoursMode({
					rows: rows.length,
					variant,
					fills: marqueeFills({ rows: rows.length, cardPx, gapPx, viewportPx: bodyWidth }),
					reducedMotion: reducedMotion.current,
					forcedColors: forcedColors.current,
				})
			: serverRows.length > 0
				? 'rules'
				: 'empty',
	);

	// What holds the marquee still (hours-band.ts, marqueeHeld).
	let hover = $state(false);
	let focus = $state(false);
	let press = $state(false);
	let scrollHold = $state(false);
	let dialog = $state(false);
	const held = $derived(marqueeHeld({ hover, focus, press, scroll: scrollHold, dialog }));

	let marqueeView = $state<HTMLElement>();
	let marqueeList = $state<HTMLOListElement>();

	onMount(() => {
		const fixture = hoursFixtureSlots((window as unknown as Record<string, unknown>)[HOURS_FIXTURE_GLOBAL]);
		const slots: PublicHoursSlot[] = fixture ?? publicHoursSlots;
		remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		rows = rowsOnVisitorClock(slots);
		mounted = true;

		// The RSVP dialog marks <html> while it is open.
		const root = document.documentElement;
		dialog = root.hasAttribute(RSVP_OPEN_ATTR);
		const observer = new MutationObserver(() => {
			dialog = root.hasAttribute(RSVP_OPEN_ATTR);
		});
		observer.observe(root, { attributes: true, attributeFilter: [RSVP_OPEN_ATTR] });

		// A press ends wherever the finger or button lifts, even off the cards.
		const release = () => {
			press = false;
		};
		const ends = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const;
		for (const name of ends) window.addEventListener(name, release, { passive: true });
		return () => {
			observer.disconnect();
			for (const name of ends) window.removeEventListener(name, release);
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

	// The marquee's duplicate copy is on screen for much of every pass, so its
	// RSVP buttons take clicks too. Each one hands over to the button for the
	// same session in the first copy (a press never focuses the hidden copy):
	// focus lands on a reachable control, which the browser scrolls into view
	// and the dialog returns to on close.
	function openRsvpFromDuplicate(row: HoursBandRow) {
		const button = marqueeList?.querySelector<HTMLElement>(`[data-rsvp-id="${CSS.escape(row.id)}"]`);
		if (button) openRsvp(row, button);
	}

	// The marquee moves by writing the scroller's own offset each frame, so a
	// hand scroll and the motion share one position: when a visitor lets go,
	// the cards move on from where they left them. Frames run only while the
	// band is on screen and the tab is visible.
	let offset = 0;
	let written = -1;
	let copyPx = 0;
	let resumeTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const view = marqueeView;
		const list = marqueeList;
		if (mode !== 'marquee' || !view || !list) return;
		let frame = 0;
		let previous: number | null = null;
		let visible = false;
		const measure = () => {
			copyPx = list.offsetWidth;
		};
		measure();
		offset = marqueeWrap(view.scrollLeft, copyPx);
		const resize = new ResizeObserver(measure);
		resize.observe(list);
		const intersection = new IntersectionObserver((entries) => {
			visible = entries.some((entry) => entry.isIntersecting);
		});
		intersection.observe(view);
		const step = (time: number) => {
			frame = requestAnimationFrame(step);
			const elapsed = previous === null ? 0 : Math.min(time - previous, 100);
			previous = time;
			if (held || !visible || document.hidden) return;
			offset = marqueeAdvance(offset, elapsed, copyPx);
			view.scrollLeft = offset;
			written = view.scrollLeft;
		};
		frame = requestAnimationFrame(step);
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
			intersection.disconnect();
			clearTimeout(resumeTimer);
			scrollHold = false;
		};
	});

	// A scroll the marquee did not write is the visitor's: it holds the cards
	// until MARQUEE_RESUME_MS after the last one, then they move on from there.
	function onMarqueeScroll() {
		const view = marqueeView;
		if (!view || Math.abs(view.scrollLeft - written) < 1) return;
		scrollHold = true;
		clearTimeout(resumeTimer);
		resumeTimer = setTimeout(() => {
			scrollHold = false;
			// The duplicate shows what the first copy showed one copy earlier,
			// so the wrap is invisible.
			offset = marqueeWrap(view.scrollLeft, copyPx);
			view.scrollLeft = offset;
			written = view.scrollLeft;
		}, MARQUEE_RESUME_MS);
	}

	function onPointerEnter(event: PointerEvent) {
		if (event.pointerType !== 'touch') hover = true;
	}

	function onPointerLeave(event: PointerEvent) {
		if (event.pointerType !== 'touch') hover = false;
	}

	// Keyboard focus holds the cards and brings the focused one fully into
	// view, so it is never carried off screen. A control focused by a click or
	// a tap does not hold them (the pointer already does while it is there),
	// so after the RSVP dialog hands focus back to a clicked button the cards
	// move on; after a keyboard Escape they stay until focus leaves.
	function onMarqueeFocusIn(event: FocusEvent) {
		const target = event.target as HTMLElement | null;
		if (!target?.matches(':focus-visible')) return;
		focus = true;
		target.closest('.hours-row')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
	}

	function onMarqueeFocusOut(event: FocusEvent) {
		const view = event.currentTarget as HTMLElement;
		if (!view.contains(event.relatedTarget as Node | null)) focus = false;
	}

	function revealIf(node: HTMLElement, delay: number | undefined) {
		if (delay === undefined) return;
		return reveal(node, { delay });
	}
</script>

{#snippet sessionRow(row: HoursBandRow, hydrated: boolean, duplicate: boolean)}
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
			{#if hydrated && duplicate}
				<button
					type="button"
					class="button button--secondary"
					tabindex="-1"
					aria-label={`RSVP for ${row.when}`}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => openRsvpFromDuplicate(row)}>RSVP</button
				>
			{:else if hydrated}
				<button
					type="button"
					class="button button--secondary"
					data-rsvp-id={row.id}
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

<svelte:element
	this={variant === 'aside' ? 'aside' : 'section'}
	class={[
		'section',
		'section--bare',
		'hours-band',
		`hours-band--${variant}`,
		revealDelay !== undefined && 'reveal-armed',
	]}
	{id}
	aria-labelledby={`${id}-title`}
	data-hours-mode={mode}
	data-hours-variant={variant}
	style:--hours-reserve={String(reserve)}
	style:--hours-card-width={mode === 'marquee' ? `${cardPx}px` : undefined}
	use:revealIf={revealDelay}
>
	<div class="hours-band__intro">
		<h2 id={`${id}-title`}>Work sessions on the bus</h2>
		{#if mode !== 'empty'}
			<!-- TODO(jess): the band's one line of copy, interim wording. It renders
			     only beside published sessions, so it first ships with the flip PR. -->
			<p>A keyholder is on the bus for each session, and visitors are welcome.</p>
		{/if}
	</div>

	<div class="hours-band__body" bind:clientWidth={bodyWidth}>
		{#if mode === 'empty'}
			<p class="hours-band__empty">
				No work session is scheduled right now. Use the <a href="/contact">contact form</a> to ask about a tour.
			</p>
		{:else if mode === 'marquee'}
			<div
				class="hours-marquee"
				role="region"
				aria-label="Upcoming work sessions"
				bind:this={marqueeView}
				data-marquee-state={held ? 'paused' : 'running'}
				data-marquee-hand={press || scrollHold ? '' : undefined}
				onscroll={onMarqueeScroll}
				onpointerenter={onPointerEnter}
				onpointerleave={onPointerLeave}
				onpointerdown={() => (press = true)}
				ontouchstart={() => (press = true)}
				onfocusin={onMarqueeFocusIn}
				onfocusout={onMarqueeFocusOut}
			>
				<div class="hours-marquee__track">
					<ol class="hours-list hours-marquee__list" bind:this={marqueeList}>
						{#each rows as row (row.id)}
							{@render sessionRow(row, true, false)}
						{/each}
					</ol>
					<!-- The second copy only closes the loop: hidden from assistive
					     technology and out of the tab order (tabindex -1), so the rows
					     are read and reached once. It is not inert, because it fills
					     the band for much of each pass and its RSVP must still take a
					     click; that click opens the RSVP from the first copy. -->
					<ol class="hours-list hours-marquee__list hours-marquee__dup" aria-hidden="true">
						{#each rows as row (row.id)}
							{@render sessionRow(row, true, true)}
						{/each}
					</ol>
				</div>
			</div>
		{:else}
			<ol class="hours-list">
				{#each rows as row (row.id)}
					{@render sessionRow(row, mounted, false)}
				{/each}
			</ol>
		{/if}
	</div>
</svelte:element>
