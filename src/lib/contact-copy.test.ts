import { describe, expect, it } from 'vitest';
import { CONTACT_NEXT_STEP, CONTACT_SENT_NEXT_STEP } from './contact-copy';
import { membershipCopyViolations } from './membership-copy';

// The contact form must not say applications open after a visit: the tour
// comes after the application. It must not promise that applications are open
// at any time, since intake can close (TIN-3847).
describe('contact copy', () => {
	it('points at the Join page, with the tour after', () => {
		expect(CONTACT_NEXT_STEP).toBe(
			'The Join page says how adults 18 and older apply to join. A tour of the bus with a keyholder comes after you apply.',
		);
		expect(CONTACT_SENT_NEXT_STEP.endsWith(CONTACT_NEXT_STEP)).toBe(true);
	});

	it('keeps the house copy rules', () => {
		for (const text of [CONTACT_NEXT_STEP, CONTACT_SENT_NEXT_STEP]) {
			expect(text, text).not.toContain('\u2014');
			expect(text, text).not.toContain(';');
			expect(text, text).not.toMatch(/applications open after|at any time|pilot|open house/iu);
		}
		expect(membershipCopyViolations(CONTACT_SENT_NEXT_STEP)).toEqual([]);
	});
});
