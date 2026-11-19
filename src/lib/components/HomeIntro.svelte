<script lang="ts">
	// app.html arms the prerendered veil before the first paint. The brand mark parks as the
	// page hydrates. src/lib/intro controls the reveal and scroll to Notes and Goals once the
	// wiper is ready. The attachment cleans up on unmount.
	import type { Attachment } from 'svelte/attachments';
	import { MediaQuery } from 'svelte/reactivity';
	import { mountHomeIntro, type IntroHandle, type IntroState } from '#lib/intro/controller.js';
	import ToolBusMark from './ToolBusMark.svelte';

	const prefersReduced = new MediaQuery('(prefers-reduced-motion: reduce)');
	let handle: IntroHandle | undefined;

	const publish = (state: IntroState) => {
		document.documentElement.dataset.intro = state;
	};

	const intro: Attachment<HTMLDivElement> = (node) => {
		handle = mountHomeIntro(node, { publish });
		return () => {
			handle?.destroy();
			handle = undefined;
		};
	};

	// Reduce flipped on mid-intro: stand down at once.
	$effect(() => {
		if (prefersReduced.current) handle?.cancel('reduce');
	});
</script>

<div class="home-intro" aria-hidden="true" data-testid="home-intro" {@attach intro}>
	<ToolBusMark variant="full" class="home-intro__mark" />
</div>
