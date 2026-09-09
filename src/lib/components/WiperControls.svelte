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

	// Stable references let Svelte call these parts directly. Compound getter
	// arrows can resemble private-name prose in minified public output.
	const { Label: StalkLabel, Control: StalkControl, Item: StalkItem } = SegmentedControl;

	const { engine }: { engine: WiperEngine } = $props();

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
	<StalkLabel class="sr-only">Wiper speed</StalkLabel>
	<StalkControl class="wiper-stalk__control">
		{#each WIPER_DETENTS as detent (detent.id)}
			<StalkItem value={detent.id} class="wiper-stalk__item">
				<SegmentedControl.ItemText class="wiper-stalk__text">{detent.label}</SegmentedControl.ItemText>
				<SegmentedControl.ItemHiddenInput />
			</StalkItem>
		{/each}
	</StalkControl>
</SegmentedControl>
