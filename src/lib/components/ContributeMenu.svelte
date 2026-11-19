<script lang="ts">
	// Ported from src/lib/components/ContributeMenu.svelte at greatfallstoolbus.org@fa5552c.
	// Maturity §5 V2 limits the menu to contact and the public log. Mount after hydration so
	// a scriptless page has no dead trigger. Keep the close button outside role="menu" but
	// inside the focus trap. .site-footer reserves space below the closed trigger.
	import { onMount, tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	// Collapse the open/close transition to an instant cut under reduced
	// motion, honoring the setting without branching the markup.
	const motionDuration = $derived(reducedMotion.current ? 0 : 160);

	let mounted = $state(false);
	let open = $state(false);
	let triggerEl: HTMLButtonElement | undefined = $state();
	let menuEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		mounted = true;
	});

	const items = [
		{ href: '/contact', label: 'Contact a keyholder', desc: 'Reach the people who run the bus.' },
		{ href: '/log', label: 'Read the public log', desc: 'See what the project has been doing.' },
	];

	function menuItems(): HTMLAnchorElement[] {
		return menuEl ? Array.from(menuEl.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')) : [];
	}

	/** Follow visual order with the close button first and the menu items next. */
	function trapFocusables(): HTMLElement[] {
		if (!menuEl) return [];
		const close = menuEl.querySelector<HTMLElement>('.contribute-panel__close');
		const items = menuItems();
		return close ? [close, ...items] : items;
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

	function onPanelKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
			return;
		}

		if (event.key === 'Tab') {
			// Trap focus across the close button and all menu items.
			event.preventDefault();
			const focusables = trapFocusables();
			if (focusables.length === 0) return;
			const current = focusables.indexOf(document.activeElement as HTMLElement);
			const next =
				(((current + (event.shiftKey ? -1 : 1)) % focusables.length) + focusables.length) % focusables.length;
			focusables[next]?.focus();
			return;
		}

		// Arrow keys, Home and End move between items only. Leave the close button alone.
		const els = menuItems();
		const current = els.indexOf(document.activeElement as HTMLAnchorElement);
		if (current === -1) return;
		switch (event.key) {
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

{#if mounted}
	<div class="contribute-fab">
		{#if open}
			<div
				bind:this={menuEl}
				class="contribute-panel"
				style:transition-duration="{motionDuration}ms"
				onkeydown={onPanelKeydown}
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
				<div id="contribute-menu" role="menu" aria-label="Ways to contribute to the tool bus">
					<ul role="presentation" class="contribute-panel__list">
						{#each items as item, index (item.href)}
							<li role="presentation">
								<a
									role="menuitem"
									tabindex="-1"
									aria-posinset={index + 1}
									aria-setsize={items.length}
									href={item.href}
									onclick={() => closeMenu({ returnFocus: false })}
								>
									<span class="contribute-panel__item-label">{item.label}</span>
									<span class="contribute-panel__item-desc">{item.desc}</span>
								</a>
							</li>
						{/each}
					</ul>
				</div>
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
{/if}
