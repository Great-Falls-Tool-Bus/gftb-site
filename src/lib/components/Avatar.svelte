<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// Minimal, brand-NEUTRAL avatar tile. Given a name it renders a square tile
	// tinted deterministically from that name (via `$lib/util/name-tint`) with the
	// person's initials, or an image when `src` is supplied. Same name always
	// yields the same tint, so a roster of stewards/contributors gets stable,
	// distinct tiles with zero stored colors and no hydration flicker.
	//
	// Deliberately un-opinionated about the corner treatment: `shape` defaults to
	// 'rounded' (the safe cross-spoke default). A spoke whose visual language wants
	// hard corners passes `shape="square"` - the sharp-tile look is a per-spoke
	// skin choice, not baked in here.
	import { nameTint, initials } from '$lib/util/name-tint';

	interface Props {
		/** Display name - drives both the tint and the initials fallback. */
		name: string;
		/** Optional image URL; when set, replaces the tinted initials tile. */
		src?: string;
		/** Tile edge length (any CSS length). Defaults to '2.5rem'. */
		size?: string;
		/** Corner treatment. Defaults to 'rounded'. */
		shape?: 'rounded' | 'square' | 'circle';
		/** Extra classes merged onto the tile. */
		class?: string;
	}

	let { name, src, size = '2.5rem', shape = 'rounded', class: extraClass = '' }: Props = $props();

	const tint = $derived(nameTint(name));
	const label = $derived(initials(name));
	const radius = $derived(shape === 'circle' ? '9999px' : shape === 'square' ? '0' : '0.375rem');
</script>

{#if src}
	<img
		{src}
		alt={name}
		class={extraClass}
		style:width={size}
		style:height={size}
		style:border-radius={radius}
		style:object-fit="cover"
	/>
{:else}
	<span
		class={`avatar-tile ${extraClass}`}
		style:width={size}
		style:height={size}
		style:border-radius={radius}
		style:background={tint.background}
		style:color={tint.foreground}
		role="img"
		aria-label={name}
		title={name}
	>
		<span aria-hidden="true">{label}</span>
	</span>
{/if}

<style>
	.avatar-tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.8em;
		line-height: 1;
		user-select: none;
		flex: none;
	}
</style>
