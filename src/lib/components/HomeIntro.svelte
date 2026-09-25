<script lang="ts">
	// The home page's first-load veil (operator rulings 2026-09-10 and
	// 2026-09-19): page ground while the brand mark drives in from the left and
	// parks at centre as the page hydrates, then header and hero alone,
	// then a scripted scroll to Notes and Goals as the wiper comes ready. It is
	// prerendered so it can be painted before first paint, hidden unless
	// app.html has armed it, and driven by src/lib/intro once mounted. The
	// controller is mounted through an attachment, the element-scoped setup
	// with cleanup that Svelte 5 provides for exactly this.
	import type { Attachment } from 'svelte/attachments';
	import { MediaQuery } from 'svelte/reactivity';
	import { mountHomeIntro, type IntroHandle, type IntroState } from '$lib/intro/controller';
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
