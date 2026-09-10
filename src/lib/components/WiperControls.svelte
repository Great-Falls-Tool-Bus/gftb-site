<script lang="ts">
	// The stalk: one Skeleton SegmentedControl (a radio group) with four
	// detents, Off first. Interim text treatment by operator ruling at LOOK 1
	// (app.css .wiper-stalk*): plain text, the active detent in the accent
	// with a rule under it, radius 0 on every part, no track, no slider, no
	// fill, and no timed rule at all; the source contract pins each of those.
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
