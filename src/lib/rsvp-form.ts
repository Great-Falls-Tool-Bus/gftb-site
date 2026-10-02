// RSVP for a work session on the bus (operator interview 2026-10-02). An RSVP
// rides the public contact relay as a contact message whose name starts with
// "RSVP " and whose message carries "Slot: <id>"; no acknowledgement is sent.
// Before hydration, and wherever the relay cannot be reached, the band's RSVP
// control is a mailto link built here. Unlike the contact builder it writes
// no Email line: the visitor's own address is the sender.
//
// The dialog (src/lib/components/RsvpDialog.svelte) asks for an email
// (required), a name or handle (optional) and "Anything we should know?"
// (optional), and posts `{name, email, message, website}` plus `altcha` once
// solved. The relay's own bounds are a name of 1 to 200 characters and a
// message of 1 to 5000; the builders below clip to them so a request is
// never refused for length.
import { EMAIL_RE, type ContactPayload } from './contact-form';

/**
 * Dispatched on `window` by the band's RSVP button once hydrated, cancelable.
 * The RSVP dialog consumes it (and cancels it); while nothing does, the band
 * takes the visitor to the contact section instead.
 */
export const RSVP_OPEN_EVENT = 'gftb:rsvp-open';

/** Set on `<html>` while the RSVP dialog is open; the list signup stands down for it. */
export const RSVP_OPEN_ATTR = 'data-rsvp-open';

export const RSVP_EMAIL_MAX = 254;
export const RSVP_HANDLE_MAX = 80;
export const RSVP_NOTE_MAX = 500;
/** The relay's own bounds (`validate()` in the form handler). */
export const RELAY_NAME_MAX = 200;
export const RELAY_MESSAGE_MAX = 5000;

export interface RsvpSlot {
	/** `<slot id>@<YYYY-MM-DD>` for a dated session, or the slot id alone. */
	slotId: string;
	/** `Thursday 8 October, 3 to 4 PM ET`, or the slot's rule text. */
	label: string;
}

export type RsvpOpenDetail = RsvpSlot;

export interface RsvpFormValues {
	email: string;
	/** "Name or handle (optional)". */
	handle: string;
	/** "Anything we should know? (optional)". */
	note: string;
	/** Honeypot: people never see or fill this field. */
	website: string;
}

export type RsvpField = 'email' | 'handle' | 'note';
export type RsvpFieldErrors = Partial<Record<RsvpField, string>>;

export const RSVP_CHECK_EMAIL = 'Check your email address.';

export function emptyRsvpValues(): RsvpFormValues {
	return { email: '', handle: '', note: '', website: '' };
}

/** Client-side checks; an invalid form never reaches the relay. */
export function validateRsvp(values: RsvpFormValues): RsvpFieldErrors {
	const errors: RsvpFieldErrors = {};
	const email = values.email.trim();
	if (!email) errors.email = 'We need an email so a keyholder can reply.';
	else if (email.length > RSVP_EMAIL_MAX || !EMAIL_RE.test(email)) errors.email = RSVP_CHECK_EMAIL;
	if (values.handle.trim().length > RSVP_HANDLE_MAX) {
		errors.handle = `Keep the name or handle to ${RSVP_HANDLE_MAX} characters.`;
	}
	if (values.note.trim().length > RSVP_NOTE_MAX) errors.note = `Keep the note to ${RSVP_NOTE_MAX} characters.`;
	return errors;
}

function clip(text: string, max: number): string {
	return [...text].slice(0, max).join('');
}

/** `RSVP <handle>`, or `RSVP` alone; at most the relay's 200 characters. */
export function rsvpName(handle: string): string {
	const tidy = handle.replace(/\s+/gu, ' ').trim();
	return clip(tidy ? `RSVP ${tidy}` : 'RSVP', RELAY_NAME_MAX);
}

/** `Slot: <id>`, `Session: <label>`, `Note: <note or none>`; at most 5000 characters. */
export function rsvpMessage(slot: RsvpSlot, note: string): string {
	const tidy = note.trim();
	return clip(
		[`Slot: ${slot.slotId}`, `Session: ${slot.label}`, `Note: ${tidy || 'none'}`].join('\n'),
		RELAY_MESSAGE_MAX,
	);
}

/** Four keys without a proof, five with one; nothing else reaches the relay. */
export function toRsvpPayload(slot: RsvpSlot, values: RsvpFormValues, altcha = ''): ContactPayload {
	const payload: ContactPayload = {
		name: rsvpName(values.handle),
		email: values.email.trim(),
		message: rsvpMessage(slot, values.note),
		website: values.website,
	};
	if (altcha) payload.altcha = altcha;
	return payload;
}

/**
 * What the dialog says after a send that did not land:
 * - `invalid-email`: a 400 about the address ("a valid email is required").
 * - `verification`: a 400 asking for the human check (once enforcement is on).
 * - `rate-limited`: 429, the relay's per-connection or global limit.
 * - `server`: 500 and up.
 * - `rejected`: any other refusal.
 * - `unreachable`: no answer at all (offline, CORS, the relay down).
 * - `timeout`: no answer in time.
 */
export type RsvpFailure =
	'invalid-email' | 'verification' | 'rate-limited' | 'server' | 'rejected' | 'unreachable' | 'timeout';

export function rsvpFailureFor(status: number, body: unknown = null): RsvpFailure {
	if (status === 400) {
		const message =
			body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
		return /verif/iu.test(message) ? 'verification' : 'invalid-email';
	}
	if (status === 429) return 'rate-limited';
	if (status >= 500) return 'server';
	return 'rejected';
}

export const RSVP_FAILURE_COPY: Record<RsvpFailure, string> = {
	'invalid-email': 'Check your email address. The relay could not accept it.',
	verification: 'The human check needs to run again. Wait a moment, then try again.',
	'rate-limited': 'Too many messages came from this connection just now. Wait a minute, then try again.',
	server: 'The relay had a problem on its side. Try again in a few minutes.',
	rejected: 'The relay did not accept the RSVP.',
	unreachable: 'We could not reach the relay.',
	timeout: 'The relay took too long to answer.',
};

export function rsvpSubject(slot: RsvpSlot): string {
	return `RSVP ${slot.label}`;
}

/**
 * The mailto RSVP: the band's control before hydration, and the dialog's
 * fallback when the relay cannot be reached, carrying what was typed.
 */
export function buildRsvpMailtoHref(
	to: string,
	slot: RsvpSlot,
	values: Partial<Pick<RsvpFormValues, 'handle' | 'note'>> = {},
): string {
	const body = [
		`Slot: ${slot.slotId}`,
		`Session: ${slot.label}`,
		'',
		'Name or handle (optional):',
		values.handle?.trim() ?? '',
		'Anything we should know? (optional):',
		values.note?.trim() ?? '',
	].join('\n');
	return `mailto:${to}?subject=${encodeURIComponent(rsvpSubject(slot))}&body=${encodeURIComponent(body)}`;
}
