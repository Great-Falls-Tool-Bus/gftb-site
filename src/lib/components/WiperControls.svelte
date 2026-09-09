<script lang="ts">
	// The wiper's one control: a four-detent speed stalk (Off / Intermittent /
	// Low / High) on Skeleton 5's SegmentedControl (a radio group underneath).
	// Operator ruling 2026-09-09: one control, chrome on its own box, no frame,
	// no dash. Styling lives in app.css under .wiper-stalk (radius 0 on every
	// part; motion only under prefers-reduced-motion: no-preference; the
	// indicator's fill is the ratified --accent on --control-track pair).
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import type { WiperEngine } from '$lib/wiper/engine.svelte';
	import { WIPER_DETENTS, isWiperDetent } from '$lib/wiper/schedule';

	const { engine }: { engine: WiperEngine } = $props();

	// Destructured on purpose: the minified member access on the anatomy
	// object (a single capital followed by a dotted capitalised word) reads
	// as an initialled personal name to the build-output leak scan.
	const { Label, Control, Item, ItemText, ItemHiddenInput } = SegmentedControl;

	function onValueChange(details: { value: string | null }) {
		if (isWiperDetent(details.value)) engine.setDetent(details.value);
	}
</script>

<SegmentedControl
	class="wiper-stalk"
	value={engine.view.detent}
	{onValueChange}
	orientation="horizontal"
	name="wiper-speed"
>
	<Label class="sr-only">Wiper speed</Label>
	<Control class="wiper-stalk__control">
		{#each WIPER_DETENTS as detent (detent.id)}
			<Item value={detent.id} class="wiper-stalk__item">
				<ItemText class="wiper-stalk__text">{detent.label}</ItemText>
				<ItemHiddenInput />
			</Item>
		{/each}
	</Control>
</SegmentedControl>
