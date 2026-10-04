<script lang="ts">
	// One place a gated membership link may appear (src/lib/gated/manifest.ts).
	// It renders NOTHING until the manifest for its slot arrives: no element, no
	// wrapper, no reserved space, so the layout closes up around an empty slot
	// and shifts only when a member's items mount (operator interview
	// 2026-10-04). Prerender and no-JS visitors never get past that first state.
	// The wrapper (when asked for) mounts and unmounts with the items, so its own
	// margin and padding never linger either.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { gatedSurface } from '$lib/gated/surface.svelte';
	import { SITE_ORIGIN, type SurfaceItem, type SurfaceSlot } from '$lib/gated/manifest';
	import { isActivePath } from '$lib/nav-items';

	interface Props {
		slot: SurfaceSlot;
		/** Wrapper element, mounted only with items. Default: none. */
		tag?: 'div' | 'li' | 'p' | 'span';
		/** Class on the wrapper. */
		class?: string;
		/** Text kept inside the wrapper after the last item, such as a full stop. */
		after?: string;
	}

	let { slot, tag, class: wrapperClass = '', after = '' }: Props = $props();

	onMount(() => gatedSurface.load());

	const items = $derived(gatedSurface.forSlot(slot));

	/** Same-site links render as in-page anchors; anything else leaves the site. */
	function target(item: SurfaceItem): { href: string; external: boolean } {
		const url = new URL(item.href);
		const sameSite = url.origin === SITE_ORIGIN || url.origin === page.url.origin;
		return sameSite
			? { href: `${url.pathname}${url.search}${url.hash}`, external: false }
			: { href: url.href, external: true };
	}

	/** House styling by what the item is and where it sits. */
	function itemClass(item: SurfaceItem): string {
		if (slot !== 'faq-actions' && slot !== 'join-sign-in') return '';
		return item.kind === 'apply' ? 'button' : 'join-actions__sign-in';
	}

	function current(item: SurfaceItem): 'page' | undefined {
		const { href, external } = target(item);
		return !external && isActivePath(page.url.pathname, [href.split(/[?#]/u)[0]]) ? 'page' : undefined;
	}
</script>

{#snippet links()}
	{#each items as item (item.kind + item.href)}
		{@const to = target(item)}
		{#if to.external}
			<ExternalLink href={to.href} class={itemClass(item)}>{item.label}</ExternalLink>
		{:else}
			<a href={to.href} class={itemClass(item) || undefined} aria-current={current(item)}>{item.label}</a>
		{/if}
	{/each}
{/snippet}

{#if items.length > 0}
	{#if tag}
		<svelte:element this={tag} class={wrapperClass || undefined}>
			{@render links()}{after}
		</svelte:element>
	{:else}
		{@render links()}
	{/if}
{/if}
