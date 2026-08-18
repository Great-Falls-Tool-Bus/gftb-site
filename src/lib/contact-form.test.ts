import { describe, expect, it } from 'vitest';
import {
	buildMailtoHref,
	contactApiUrl,
	contactChallengeUrl,
	emptyContactValues,
	hasErrors,
	isHoneypotTripped,
	toContactPayload,
	validateContactForm,
	type ContactFormValues,
} from './contact-form';

const values = (overrides: Partial<ContactFormValues> = {}): ContactFormValues => ({
	name: 'Ada',
	email: 'ada@example.org',
	message: 'I would like to help repair tools.',
	website: '',
	...overrides,
});

describe('contact form decisions', () => {
	it('accepts a human-shaped form and silently detects the honeypot', () => {
		expect(hasErrors(validateContactForm(values()))).toBe(false);
		expect(isHoneypotTripped(values())).toBe(false);
		expect(isHoneypotTripped(values({ website: 'https://spam.example' }))).toBe(true);
	});

	it('reports all visible field errors', () => {
		expect(validateContactForm(values({ name: '', email: 'bad', message: 'short' }))).toEqual({
			name: 'Tell us who you are.',
			email: 'That email does not look right. Check it and try again.',
			message: 'Add a little more about what you are reaching out about.',
		});
	});

	it('trims the payload and attaches a solved proof only when present', () => {
		expect(toContactPayload(values({ name: ' Ada ', email: ' ada@example.org ' }))).toEqual({
			name: 'Ada',
			email: 'ada@example.org',
			message: 'I would like to help repair tools.',
			website: '',
		});
		expect(toContactPayload(values(), 'proof').altcha).toBe('proof');
	});

	it('builds canonical API routes despite trailing slashes', () => {
		expect(contactApiUrl('https://forms.latoolb.us///')).toBe('https://forms.latoolb.us/api/contact');
		expect(contactChallengeUrl('https://forms.latoolb.us/')).toBe('https://forms.latoolb.us/api/challenge');
	});

	it('provides an equivalent email fallback', () => {
		const href = buildMailtoHref('keyholders@latoolb.us', values());
		expect(href).toContain('mailto:keyholders@latoolb.us?');
		expect(decodeURIComponent(href)).toContain('I would like to help repair tools.');
	});

	it('seeds a blank form', () => {
		expect(emptyContactValues()).toEqual({ name: '', email: '', message: '', website: '' });
	});
});
