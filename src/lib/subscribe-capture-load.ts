// The one dynamic import of the capture modal, kept out of +layout.svelte so
// an off build (src/lib/subscribe-capture-flag.ts) drops this module and the
// import edge with it, instead of leaving an orphaned component chunk behind.
export function loadSubscribeCapture() {
	return import('./components/SubscribeCapture.svelte').then((module) => module.default);
}
