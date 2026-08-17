export type ContactField = 'name' | 'email' | 'message';

export interface ContactFormValues {
	name: string;
	email: string;
	message: string;
	/** Honeypot: people never see or fill this field. */
	website: string;
}

export type ContactFieldErrors = Partial<Record<ContactField, string>>;

export interface ContactPayload {
	name: string;
	email: string;
	message: string;
	website: string;
	altcha?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyContactValues(): ContactFormValues {
	return { name: '', email: '', message: '', website: '' };
}

export function isHoneypotTripped(values: Pick<ContactFormValues, 'website'>): boolean {
	return values.website.trim().length > 0;
}

export function validateContactForm(values: ContactFormValues): ContactFieldErrors {
	const errors: ContactFieldErrors = {};
	if (!values.name.trim()) errors.name = 'Tell us who you are.';

	const email = values.email.trim();
	if (!email) errors.email = 'We need an email so a keyholder can reply.';
	else if (!EMAIL_RE.test(email)) errors.email = 'That email does not look right. Check it and try again.';

	if (values.message.trim().length < 10) {
		errors.message = 'Add a little more about what you are reaching out about.';
	}
	return errors;
}

export function hasErrors(errors: ContactFieldErrors): boolean {
	return Object.keys(errors).length > 0;
}

export function toContactPayload(values: ContactFormValues, altcha = ''): ContactPayload {
	const payload: ContactPayload = {
		name: values.name.trim(),
		email: values.email.trim(),
		message: values.message.trim(),
		website: values.website,
	};
	if (altcha) payload.altcha = altcha;
	return payload;
}

export function contactApiUrl(endpoint: string): string {
	return `${endpoint.replace(/\/+$/, '')}/api/contact`;
}

export function contactChallengeUrl(endpoint: string): string {
	return `${endpoint.replace(/\/+$/, '')}/api/challenge`;
}

export function buildMailtoHref(to: string, values: ContactFormValues): string {
	const name = values.name.trim();
	const subject = `Tool Bus contact: ${name || 'website visitor'}`;
	const body = `Name: ${name}\nEmail: ${values.email.trim()}\n\n${values.message.trim()}`;
	return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
