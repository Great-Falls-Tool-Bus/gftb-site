// ── HOUSE CANON IDIOM ────────────────────────────────────────────────────────
// `reveal` - a scroll-into-view motion action that FAILS OPEN. The cardinal rule:
// content is NEVER hidden by this action unless the browser can actually reveal
// it again. So the element starts visible, and the action only opts INTO a
// hidden→shown transition when all of these hold:
//   • not SSR / no-JS (an action only runs client-side, so markup ships visible),
//   • `IntersectionObserver` exists,
//   • the user has NOT requested reduced motion.
// If any check fails the action returns immediately, leaving the element in its
// natural, fully-visible state. That guarantees a broken observer, an old
// browser, or a reduced-motion setting can never leave content stranded hidden.
//
// The action toggles a single data attribute (`data-reveal`) from `hidden` to
// `shown`; the *look* of the transition is CSS the spoke owns (opacity/translate
// on `[data-reveal='hidden']`, transition on `[data-reveal]`). This keeps motion
// styling in the theme layer, not baked into JS.
//
// Usage:
//   <script lang="ts">import { reveal } from '$lib/actions/reveal';</script>
//   <section use:reveal>…</section>
//   // in CSS: [data-reveal='hidden'] { opacity: 0; transform: translateY(1rem); }
//   //         [data-reveal] { transition: opacity .5s, transform .5s; }
//
// Options: `{ threshold, rootMargin, once }` (once defaults to true - reveal and
// stop observing).

import { prefersReducedMotion } from '$lib/runes/reduced-motion.svelte';

export interface RevealOptions {
	/** IntersectionObserver threshold. Defaults to 0.15. */
	threshold?: number;
	/** IntersectionObserver rootMargin. Defaults to '0px 0px -10% 0px'. */
	rootMargin?: string;
	/** Stop observing after the first reveal. Defaults to true. */
	once?: boolean;
}

export function reveal(node: HTMLElement, options: RevealOptions = {}) {
	// FAIL OPEN: if we cannot run a real reveal, leave the node exactly as it
	// shipped (visible). Never write `data-reveal='hidden'` on these paths.
	if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
		return { destroy() {} };
	}

	const threshold = options.threshold ?? 0.15;
	const rootMargin = options.rootMargin ?? '0px 0px -10% 0px';
	const once = options.once ?? true;

	// Only now do we take the node hidden - after proving we can show it again.
	node.dataset.reveal = 'hidden';

	const show = () => {
		node.dataset.reveal = 'shown';
	};

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				show();
				if (once) observer.unobserve(node);
			}
		},
		{ threshold, rootMargin },
	);

	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		},
	};
}
