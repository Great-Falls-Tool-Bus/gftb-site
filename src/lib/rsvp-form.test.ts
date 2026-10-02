import { describe, expect, it } from 'vitest';

import {
	buildRsvpMailtoHref,
	emptyRsvpValues,
	RELAY_MESSAGE_MAX,
	RELAY_NAME_MAX,
	RSVP_CHECK_EMAIL,
	RSVP_FAILURE_COPY,
	RSVP_OPEN_EVENT,
	rsvpFailureFor,
	rsvpMessage,
	rsvpName,
	rsvpSubject,
	toRsvpPayload,
	validateRsvp,
	type RsvpFormValues,
} from './rsvp-form';

const slot = { slotId: 'thursday-weekly@2026-10-08', label: 'Thursday 8 October, 3 to 4 PM ET' };

const values = (overrides: Partial<RsvpFormValues> = {}): RsvpFormValues => ({
	...emptyRsvpValues(),
	email: 'ada@example.org',
	...overrides,
});

function parse(href: string) {
	const url = new URL(href);
	return {
		protocol: url.protocol,
		to: url.pathname,
		subject: url.searchParams.get('subject'),
		body: url.searchParams.get('body'),
	};
}

describe('the RSVP mailto fallback', () => {
	it('writes to the keyholders with a subject that starts with "RSVP "', () => {
		const mail = parse(buildRsvpMailtoHref('keyholders@latoolb.us', slot));
		expect(mail.protocol).toBe('mailto:');
		expect(mail.to).toBe('keyholders@latoolb.us');
		expect(mail.subject).toBe('RSVP Thursday 8 October, 3 to 4 PM ET');
		expect(rsvpSubject(slot).startsWith('RSVP ')).toBe(true);
	});

	it('carries the slot reference and the two optional prompts, and no Email line', () => {
		const { body } = parse(buildRsvpMailtoHref('keyholders@latoolb.us', slot));
		expect(body).toBe(
			[
				'Slot: thursday-weekly@2026-10-08',
				'Session: Thursday 8 October, 3 to 4 PM ET',
				'',
				'Name or handle (optional):',
				'',
				'Anything we should know? (optional):',
				'',
			].join('\n'),
		);
		expect(body).not.toMatch(/^Email:/mu);
		expect(body).not.toMatch(/bring/iu);
	});

	it('carries what was typed when the dialog falls back to email', () => {
		const { body } = parse(
			buildRsvpMailtoHref('keyholders@latoolb.us', slot, { handle: ' Ada ', note: 'First visit.' }),
		);
		expect(body?.split('\n')).toEqual([
			'Slot: thursday-weekly@2026-10-08',
			'Session: Thursday 8 October, 3 to 4 PM ET',
			'',
			'Name or handle (optional):',
			'Ada',
			'Anything we should know? (optional):',
			'First visit.',
		]);
	});

	it('takes a server-rendered slot reference before the date is known', () => {
		const { body, subject } = parse(
			buildRsvpMailtoHref('keyholders@latoolb.us', {
				slotId: 'thursday-weekly',
				label: 'Thursdays, 3 to 4 PM ET, from 8 October',
			}),
		);
		expect(body?.split('\n')[0]).toBe('Slot: thursday-weekly');
		expect(subject).toBe('RSVP Thursdays, 3 to 4 PM ET, from 8 October');
	});

	it('names one window event for the RSVP dialog to take', () => {
		expect(RSVP_OPEN_EVENT).toBe('gftb:rsvp-open');
	});
});

describe('the RSVP payload for the contact relay', () => {
	it('posts four keys without a proof and five with one', () => {
		expect(Object.keys(toRsvpPayload(slot, values())).sort()).toEqual(['email', 'message', 'name', 'website']);
		const proved = toRsvpPayload(slot, values(), 'proof');
		expect(Object.keys(proved).sort()).toEqual(['altcha', 'email', 'message', 'name', 'website']);
		expect(proved.altcha).toBe('proof');
	});

	it('names the message "RSVP <handle>", or "RSVP" alone, within the relay\'s 200 characters', () => {
		expect(toRsvpPayload(slot, values({ handle: '  Ada   L. ' })).name).toBe('RSVP Ada L.');
		expect(toRsvpPayload(slot, values()).name).toBe('RSVP');
		const long = rsvpName('x'.repeat(400));
		expect(long.startsWith('RSVP x')).toBe(true);
		expect(long).toHaveLength(RELAY_NAME_MAX);
	});

	it('carries the slot, the session and the note, or "none"', () => {
		expect(toRsvpPayload(slot, values({ note: ' First visit. ' })).message).toBe(
			['Slot: thursday-weekly@2026-10-08', 'Session: Thursday 8 October, 3 to 4 PM ET', 'Note: First visit.'].join(
				'\n',
			),
		);
		expect(rsvpMessage(slot, '   ')).toBe(
			'Slot: thursday-weekly@2026-10-08\nSession: Thursday 8 October, 3 to 4 PM ET\nNote: none',
		);
		expect(rsvpMessage(slot, 'y'.repeat(9000))).toHaveLength(RELAY_MESSAGE_MAX);
	});

	it('trims the email and passes the honeypot through untouched', () => {
		const payload = toRsvpPayload(slot, values({ email: ' ada@example.org ', website: 'x' }));
		expect(payload.email).toBe('ada@example.org');
		expect(payload.website).toBe('x');
	});
});

describe('RSVP checks before any request', () => {
	it('needs a well-formed email and nothing else', () => {
		expect(validateRsvp(values())).toEqual({});
		expect(validateRsvp(values({ email: '' })).email).toBe('We need an email so a keyholder can reply.');
		expect(validateRsvp(values({ email: 'ada@invalid' })).email).toBe(RSVP_CHECK_EMAIL);
		expect(validateRsvp(values({ email: `${'a'.repeat(250)}@b.co` })).email).toBe(RSVP_CHECK_EMAIL);
	});

	it('bounds the optional fields', () => {
		expect(validateRsvp(values({ handle: 'h'.repeat(81) })).handle).toBeDefined();
		expect(validateRsvp(values({ handle: 'h'.repeat(80) })).handle).toBeUndefined();
		expect(validateRsvp(values({ note: 'n'.repeat(501) })).note).toBeDefined();
		expect(validateRsvp(values({ note: 'n'.repeat(500) })).note).toBeUndefined();
	});
});

describe('what the dialog says when a send does not land', () => {
	it("maps the relay's answers", () => {
		expect(rsvpFailureFor(400, { error: 'a valid email is required' })).toBe('invalid-email');
		expect(rsvpFailureFor(400)).toBe('invalid-email');
		expect(rsvpFailureFor(400, { error: 'verification required' })).toBe('verification');
		expect(rsvpFailureFor(429)).toBe('rate-limited');
		expect(rsvpFailureFor(500)).toBe('server');
		expect(rsvpFailureFor(503)).toBe('server');
		expect(rsvpFailureFor(413)).toBe('rejected');
		expect(RSVP_FAILURE_COPY['invalid-email'].startsWith('Check your email address')).toBe(true);
	});

	it('never uses an em dash', () => {
		for (const copy of Object.values(RSVP_FAILURE_COPY)) expect(copy).not.toContain('\u2014');
	});
});
