import { describe, expect, it } from 'vitest';

import { buildRsvpMailtoHref, RSVP_OPEN_EVENT, rsvpSubject } from './rsvp-form';

const slot = { slotId: 'thursday-weekly@2026-10-08', label: 'Thursday 8 October, 3 to 4 PM ET' };

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
