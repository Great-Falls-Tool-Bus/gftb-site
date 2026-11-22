<script lang="ts">
	// The Skeleton SegmentedControl exposes four detents with Off first. LOOK 1 specifies the
	// active underline, radius 0 and plain text. app.css styles .wiper-stalk*.
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import type { WiperEngine } from '#lib/wiper/engine.svelte.js';
	import { WIPER_DETENTS, isWiperDetent } from '#lib/wiper/schedule.js';

	const { engine }: { engine: WiperEngine } = $props();

	// Destructure the anatomy so a minified member access cannot resemble a personal name in
	// the build-output leak scan.
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
