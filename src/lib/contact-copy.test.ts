import { describe, expect, it } from 'vitest';
import { CONTACT_NEXT_STEP, CONTACT_SENT_NEXT_STEP } from './contact-copy';
import { membershipCopyViolations } from './membership-copy';

// The contact form must not say applications open after a visit: anyone can
// apply, and the tour comes after the application (TIN-3847).
describe('contact copy', () => {
	it('says anyone can apply, with the tour after', () => {
		expect(CONTACT_NEXT_STEP).toBe(
			'Anyone can apply to join on the Join page at any time. A tour of the bus with a keyholder comes after you apply.',
		);
		expect(CONTACT_SENT_NEXT_STEP.endsWith(CONTACT_NEXT_STEP)).toBe(true);
	});

	it('keeps the house copy rules', () => {
		for (const text of [CONTACT_NEXT_STEP, CONTACT_SENT_NEXT_STEP]) {
			expect(text, text).not.toContain('\u2014');
			expect(text, text).not.toContain(';');
			expect(text, text).not.toMatch(/applications open after|pilot|open house/iu);
		}
		expect(membershipCopyViolations(CONTACT_SENT_NEXT_STEP)).toEqual([]);
	});
});
