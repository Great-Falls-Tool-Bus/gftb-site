// The vendored ALTCHA widget, shared by the three forms that carry it: the
// contact form, the list signup and the work-session RSVP dialog. The script
// is loaded once per page, from this repository's own static/vendor copy, and
// only when a form that needs it is on screen. Each form keeps its own proof:
// the widget raises `verified` with a single-use payload, and any other state
// clears it, so a stale proof is never sent.

export const ALTCHA_SCRIPT_SRC = '/vendor/altcha/altcha.js';

/** The widget surface the forms use: reset, then solve again, for a fresh proof. */
export type AltchaWidgetElement = HTMLElement & { reset?: () => void; solve?: () => void };

/** Adds the widget script once; a second call on the same page does nothing. */
export function loadAltchaWidget(doc: Document | undefined = globalThis.document): void {
	if (!doc || doc.querySelector('script[data-altcha]')) return;
	const script = doc.createElement('script');
	script.src = ALTCHA_SCRIPT_SRC;
	script.defer = true;
	script.dataset.altcha = '';
	doc.head.appendChild(script);
}

/**
 * Reports the widget's proof to `onPayload`: the payload once verified, and
 * an empty string on any other state. Returns the cleanup.
 */
export function watchAltcha(element: HTMLElement, onPayload: (payload: string) => void): () => void {
	const onVerified = (event: Event) => {
		const detail = (event as CustomEvent<{ payload?: string }>).detail;
		onPayload(typeof detail?.payload === 'string' ? detail.payload : '');
	};
	const onState = (event: Event) => {
		const detail = (event as CustomEvent<{ state?: string }>).detail;
		if (detail?.state !== 'verified') onPayload('');
	};
	element.addEventListener('verified', onVerified);
	element.addEventListener('statechange', onState);
	return () => {
		element.removeEventListener('verified', onVerified);
		element.removeEventListener('statechange', onState);
	};
}

/** Proofs are single use: after a send, or before a retry, solve again. */
export function resolveAltcha(element: HTMLElement | undefined): void {
	const widget = element as AltchaWidgetElement | undefined;
	widget?.reset?.();
	widget?.solve?.();
}
