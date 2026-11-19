// Keep the dynamic import outside +layout.svelte so builds with capture disabled omit the modal
// chunk.
export function loadSubscribeCapture() {
	return import('./components/SubscribeCapture.svelte').then((module) => module.default);
}
