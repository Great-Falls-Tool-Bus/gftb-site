import { EMAIL_RE } from './contact-form';

/**
 * Pure decisions for the list-signup capture modal
 * (src/lib/components/SubscribeCapture.svelte). Nothing here touches the
 * DOM, storage, or the clock: the component gathers the signals and this
 * module says whether the modal may arm and what the request looks like.
 */

export interface SubscribeFormValues {
	email: string;
	/** Honeypot: people never see or fill this field. */
	website: string;
}

export type SubscribeFieldErrors = Partial<Record<'email', string>>;

export interface SubscribePayload {
	email: string;
	website: string;
	altcha?: string;
}

export function emptySubscribeValues(): SubscribeFormValues {
	return { email: '', website: '' };
}

export function validateSubscribe(values: SubscribeFormValues): SubscribeFieldErrors {
	const errors: SubscribeFieldErrors = {};
	const email = values.email.trim();
	if (!email) errors.email = 'We need an email to send the confirmation to.';
	else if (!EMAIL_RE.test(email)) errors.email = 'That email does not look right. Check it and try again.';
	return errors;
}

export function toSubscribePayload(values: SubscribeFormValues, altcha = ''): SubscribePayload {
	const payload: SubscribePayload = { email: values.email.trim(), website: values.website };
	if (altcha) payload.altcha = altcha;
	return payload;
}

export function subscribeApiUrl(endpoint: string): string {
	return `${endpoint.replace(/\/+$/, '')}/api/subscribe`;
}

/* ===== Arm rule ===== */

/** Time on the page before the modal may arm. Both this AND the hero scroll are required. */
export const CAPTURE_DWELL_MS = 45_000;
/** Below this viewport width the modal never arms (a phone gets no floating capture). */
export const CAPTURE_MIN_VIEWPORT_WIDTH = 640;
/** A dismissal is remembered this long; a signup is remembered forever. */
export const CAPTURE_DISMISS_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
/** Paths where the modal never arms: the form page itself and the policy pages. */
export const CAPTURE_SUPPRESSED_PATHS = ['/contact', '/legal', '/privacy'] as const;

export interface CaptureSignals {
	/** Visible time on the page so far. */
	dwellMs: number;
	/** The visitor has scrolled past the hero (or one viewport where there is none). */
	scrolledPast: boolean;
	reducedMotion: boolean;
	viewportWidth: number;
	/** The home first-load intro is armed, live or lifting. */
	introLive: boolean;
	scriptsOn: boolean;
	forcedColors: boolean;
	printing: boolean;
	/** Epoch ms of the last dismissal, or null. */
	dismissedAt: number | null;
	/** Epoch ms of a completed signup, or null. */
	subscribedAt: number | null;
	pathname: string;
	/** Epoch ms "now", for the dismissal window. Defaults to Date.now() at the call site. */
	now?: number;
}

export type CaptureReason =
	| 'scripts-off'
	| 'reduced-motion'
	| 'forced-colors'
	| 'printing'
	| 'suppressed-path'
	| 'subscribed'
	| 'dismissed'
	| 'intro-live'
	| 'viewport-narrow'
	| 'dwell'
	| 'hero'
	| 'ready';

export interface CaptureDecision {
	arm: boolean;
	reason: CaptureReason;
}

export function isSuppressedPath(pathname: string): boolean {
	return CAPTURE_SUPPRESSED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * The one arm decision, in suppression order. Every hard suppression wins
 * over every progress signal, so a test can read the first reason that holds.
 */
export function armCapture(signals: CaptureSignals): CaptureDecision {
	const now = signals.now ?? Date.now();
	if (!signals.scriptsOn) return { arm: false, reason: 'scripts-off' };
	if (signals.reducedMotion) return { arm: false, reason: 'reduced-motion' };
	if (signals.forcedColors) return { arm: false, reason: 'forced-colors' };
	if (signals.printing) return { arm: false, reason: 'printing' };
	if (isSuppressedPath(signals.pathname)) return { arm: false, reason: 'suppressed-path' };
	if (signals.subscribedAt !== null) return { arm: false, reason: 'subscribed' };
	if (signals.dismissedAt !== null && now - signals.dismissedAt < CAPTURE_DISMISS_MEMORY_MS) {
		return { arm: false, reason: 'dismissed' };
	}
	if (signals.introLive) return { arm: false, reason: 'intro-live' };
	if (signals.viewportWidth < CAPTURE_MIN_VIEWPORT_WIDTH) return { arm: false, reason: 'viewport-narrow' };
	if (signals.dwellMs < CAPTURE_DWELL_MS) return { arm: false, reason: 'dwell' };
	if (!signals.scrolledPast) return { arm: false, reason: 'hero' };
	return { arm: true, reason: 'ready' };
}

/** A stored epoch-ms string back to a number, or null for anything else. */
export function parseStoredTime(raw: string | null | undefined): number | null {
	if (typeof raw !== 'string' || !/^\d{1,16}$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : null;
}
