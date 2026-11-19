// The reveal action comes from the apex motion kit at 5e33dc6.
// src/app.css hides reveal targets only under html.motion-safe-ready.
// app.html sets the class before paint when motion is allowed. Its timer
// removes the class if hydration fails, so visitors can still read the page.
// The hero backdrop uses CSS scroll-driven animation.

interface RevealOptions {
	/** Stagger, in ms, applied as the CSS transition-delay for this element. */
	delay?: number;
}

export function reveal(node: HTMLElement, opts: RevealOptions = {}) {
	if (opts.delay) node.style.setProperty('--reveal-delay', `${opts.delay}ms`);

	// No IntersectionObserver (very old browsers): reveal immediately rather
	// than leave the element armed-and-hidden forever.
	if (typeof IntersectionObserver === 'undefined') {
		node.classList.add('reveal-in');
		return;
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					node.classList.add('reveal-in');
					io.unobserve(node);
				}
			}
		},
		{ rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
	);
	io.observe(node);

	return {
		destroy() {
			io.disconnect();
		},
	};
}
