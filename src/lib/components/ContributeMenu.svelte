<script lang="ts">
	// Floating "Contribute" affordance — ported from the demo
	// (greatfallstoolbus.org@fa5552c src/lib/components/ContributeMenu.svelte),
	// per the 2026-08-20 review finding C: the operator's 2026-08-20 ~09:30
	// rejection named the absence of a floating/Zag-vocabulary element as a
	// miss, and the maturity doc §5 V2 disposition is ADOPT, scoped — asked
	// for, not optional. Scoped DOWN from the demo for this microsite: no
	// platform flows (nav-items.ts's own scope note — /tools, /cells*,
	// /cell-sheets*, /keyholders, /discuss live in gftb-platform, not here),
	// so the two items are the two non-platform destinations this site
	// actually has: contact and the public log.
	//
	// WAI-ARIA menu-button pattern, plus the demo's explicit focus-trap:
	//   - trigger: aria-haspopup/expanded/controls; Enter/Space toggle;
	//     Arrow up/down open onto the first/last item.
	//   - open menu: focus lands on the first item; Arrow up/down + Home/End
	//     move; Tab/Shift+Tab are TRAPPED (wrap within the items) rather than
	//     tabbing out; Escape closes and returns focus to the trigger; a
	//     pointer press outside dismisses it.
	// Motion is reduced-motion-safe (a MediaQuery gates the open/close
	// duration to zero, the same idiom app.css already uses for scroll-reveal
	// and ThemeSwitcher's crossfade), the panel is the featured-glass idiom
	// (translucent + backdrop-blur with an opaque, unconditional fallback —
	// never opaque-only, never blur-only), corners are sharp (de-slop
	// ruling), and it never prints. Anchored bottom-left, --z-dropdown (below
	// the sticky header, no other fixed element on this site to collide
	// with). No icon dependency (house-stack contract; nav-items.ts's own
	// comment) — plain text labels only.
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	// Collapse the open/close transition to an instant cut under reduced
	// motion, honoring the setting without branching the markup.
	const motionDuration = $derived(reducedMotion.current ? 0 : 160);

	let open = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();
	let menuEl: HTMLDivElement | undefined = $state();

	const items = [
		{ href: '/contact', label: 'Contact a keyholder', desc: 'Reach the people who run the bus.' },
		{ href: '/log', label: 'Read the public log', desc: 'See what the project has been doing.' },
	];

	function menuItems(): HTMLAnchorElement[] {
		return menuEl ? Array.from(menuEl.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')) : [];
	}

	function focusItem(index: number) {
		const els = menuItems();
		if (els.length === 0) return;
		const wrapped = ((index % els.length) + els.length) % els.length;
		els[wrapped]?.focus();
	}

	async function openMenu(focus: 'first' | 'last' = 'first') {
		open = true;
		await tick(); // let the panel mount before moving focus into it
		focusItem(focus === 'last' ? -1 : 0);
	}

	function closeMenu({ returnFocus = true } = {}) {
		if (!open) return;
		open = false;
		if (returnFocus) triggerEl?.focus();
	}

	function toggle() {
		if (open) closeMenu({ returnFocus: false });
		else openMenu();
	}

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (open) focusItem(event.key === 'ArrowUp' ? -1 : 0);
			else openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const els = menuItems();
		const current = els.indexOf(document.activeElement as HTMLAnchorElement);
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				closeMenu();
				break;
			case 'ArrowDown':
				event.preventDefault();
				focusItem(current + 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusItem(current - 1);
				break;
			case 'Home':
				event.preventDefault();
				focusItem(0);
				break;
			case 'End':
				event.preventDefault();
				focusItem(els.length - 1);
				break;
			case 'Tab':
				// Focus trap: keep Tab and Shift+Tab cycling within the items.
				event.preventDefault();
				focusItem(current + (event.shiftKey ? -1 : 1));
				break;
		}
	}

	// While open, a pointer press anywhere outside the trigger or panel dismisses.
	$effect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (triggerEl?.contains(target) || menuEl?.contains(target)) return;
			closeMenu({ returnFocus: false });
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});
</script>

<div class="contribute-fab">
	{#if open}
		<div
			bind:this={menuEl}
			id="contribute-menu"
			role="menu"
			tabindex="-1"
			aria-label="Ways to contribute to the tool bus"
			class="contribute-panel"
			style:transition-duration="{motionDuration}ms"
			onkeydown={onMenuKeydown}
		>
			<div class="contribute-panel__header">
				<p class="contribute-panel__eyebrow">Pitch in</p>
				<button
					type="button"
					class="contribute-panel__close"
					aria-label="Close contribute menu"
					onclick={() => closeMenu()}
				>
					×
				</button>
			</div>
			<ul class="contribute-panel__list">
				{#each items as item (item.href)}
					<li>
						<a role="menuitem" tabindex="-1" href={item.href} onclick={() => closeMenu({ returnFocus: false })}>
							<span class="contribute-panel__item-label">{item.label}</span>
							<span class="contribute-panel__item-desc">{item.desc}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<button
		bind:this={triggerEl}
		type="button"
		class="contribute-trigger"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls="contribute-menu"
		onclick={toggle}
		onkeydown={onTriggerKeydown}
	>
		{open ? 'Close' : 'Contribute'}
	</button>
</div>
