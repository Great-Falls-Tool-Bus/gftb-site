import { expect, test, type Page } from '@playwright/test';
import {
	CONTACT_URL,
	FORM_ORIGIN,
	installExternalGuard,
	stubChallenge,
	stubContactEndpoint,
	type ContactStubOptions,
} from './support/network';

// Acceptance rows (§10, Contact): exact-origin CORS on the form endpoint,
// challenge (ALTCHA) and honeypot enforcement, input bounds and rate-limit
// behaviour, retry preserving entered values, a delivery canary hook, and the
// endpoint-down fallback copy.
//
// `forms.latoolb.us` is owned by another repository and is never contacted from
// here. Every row below runs against a local handler that implements the policy
// under test; the live counterpart of each row is declared at the bottom of the
// file and skips with a reason rather than reporting a green it did not earn.

const VALID = {
	name: 'Ada Lovelace',
	email: 'ada@example.org',
	message: 'I can bring a 9/16-inch impact and help with the seat removal.',
};

async function openContact(page: Page, baseURL: string | undefined, options: ContactStubOptions = {}) {
	await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
	await stubChallenge(page);
	const capture = await stubContactEndpoint(page, options);
	await page.goto('/#contact');
	await page.waitForLoadState('domcontentloaded');
	return capture;
}

async function fillValidForm(page: Page, overrides: Partial<typeof VALID> = {}) {
	const values = { ...VALID, ...overrides };
	await page.locator('#contact-name').fill(values.name);
	await page.locator('#contact-email').fill(values.email);
	await page.locator('#contact-message').fill(values.message);
	return values;
}

const submit = (page: Page) => page.getByRole('button', { name: 'Send to keyholders' }).click();

test.describe('exact-origin CORS on the form endpoint', () => {
	test('posts to exactly one endpoint, over https, with the page origin attached', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		const requests: string[] = [];
		page.on('request', (request) => {
			if (request.url().startsWith(FORM_ORIGIN)) requests.push(`${request.method()} ${request.url()}`);
		});

		await fillValidForm(page);
		await submit(page);
		await expect(page.getByRole('status')).toContainText('your note is on its way');

		expect(capture.headers).toHaveLength(1);
		expect(capture.headers[0].origin).toBe(new URL(baseURL ?? 'http://localhost:3000').origin);
		// `content-type: application/json` is what makes this a non-simple request,
		// so a real browser preflights it and the endpoint's exact-origin policy is
		// enforced on the preflight. Playwright serves fulfilled routes without
		// issuing that preflight, so the preflight itself is asserted only in the
		// live-endpoint block at the bottom of this file.
		expect(capture.headers[0]['content-type']).toBe('application/json');
		expect(requests.filter((entry) => entry.endsWith('/api/contact'))).toContain(`POST ${CONTACT_URL}`);
	});

	test('a response addressed to a different origin is rejected by the browser', async ({ page, baseURL }) => {
		await openContact(page, baseURL, { allowOrigin: 'https://not-this-page.example' });
		await fillValidForm(page);
		await submit(page);
		await expect(page.getByRole('alert')).toContainText('We could not reach the contact service.');
	});

	// A response carrying no Access-Control-Allow-Origin at all cannot be
	// expressed through Playwright's fulfilled routes: the harness supplies a
	// permissive default, so the browser never gets the chance to refuse it.
	// That case is covered by the live-endpoint block instead.
	test.skip('a response with no allow-origin header at all is rejected', () => {});

	test('the endpoint host is pinned in source, not derived from the page', async ({ page, baseURL }) => {
		await openContact(page, baseURL);
		const action = await page.locator('form.contact-form').getAttribute('action');
		expect(action).toBe(CONTACT_URL);
		expect(new URL(action ?? '').protocol).toBe('https:');
		expect(new URL(action ?? '').hostname).toBe('forms.latoolb.us');
	});
});

test.describe('challenge and honeypot enforcement', () => {
	test('a solved ALTCHA proof rides along with the submission', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		await expect(page.locator('altcha-widget')).toBeVisible();
		await fillValidForm(page);
		await expect
			.poll(async () => page.locator('altcha-widget').evaluate((element) => (element as { state?: string }).state), {
				message: 'ALTCHA widget verifies before the form is sent',
			})
			.toBe('verified');

		await submit(page);
		await expect(page.getByRole('status')).toContainText('your note is on its way');

		const payload = capture.payloads[0];
		expect(typeof payload.altcha).toBe('string');
		const proof = JSON.parse(Buffer.from(String(payload.altcha), 'base64').toString('utf8'));
		expect(proof).toMatchObject({ algorithm: 'SHA-256', salt: 'test' });
		expect(typeof proof.number).toBe('number');
		expect(proof.signature).toHaveLength(64);
	});

	test('an unavailable challenge service does not block a human', async ({ page, baseURL }) => {
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page, { error: 'unavailable' }, 503);
		const capture = await stubContactEndpoint(page);
		await page.goto('/#contact');

		await expect(page.locator('.form-help')).toContainText('If it is unavailable, you can still send.');
		await fillValidForm(page);
		await submit(page);
		await expect(page.getByRole('status')).toContainText('your note is on its way');
		// No forged proof is invented client side; the endpoint decides.
		expect(capture.payloads[0].altcha).toBeUndefined();
	});

	test('a filled honeypot is absorbed silently and never reaches the endpoint', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		await fillValidForm(page);
		await page.locator('#contact-website').fill('https://spam.example', { force: true });
		await submit(page);

		await expect(page.getByRole('status')).toContainText('your note is on its way');
		expect(capture.payloads, 'honeypot submissions must not be forwarded').toEqual([]);
	});

	test('the honeypot field ships empty and hidden from assistive technology', async ({ page, baseURL }) => {
		await openContact(page, baseURL);
		await expect(page.locator('.honeypot')).toHaveAttribute('aria-hidden', 'true');
		await expect(page.locator('#contact-website')).toHaveValue('');
		const offscreen = await page.locator('.honeypot').evaluate((element) => element.getBoundingClientRect().right);
		expect(offscreen).toBeLessThan(0);
	});
});

test.describe('input bounds and rate limiting', () => {
	test('an empty submission is stopped before any request is made', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		await submit(page);
		await expect(page.locator('.field-error')).toHaveCount(3);
		await expect(page.locator('#contact-name-error')).toContainText('Tell us who you are.');
		await expect(page.locator('#contact-email-error')).toContainText('We need an email');
		await expect(page.locator('#contact-message-error')).toContainText('Add a little more');
		expect(capture.payloads).toEqual([]);
	});

	test('a malformed address and a too-short message are both caught locally', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		await fillValidForm(page, { email: 'ada@invalid', message: 'too short' });
		await submit(page);
		await expect(page.locator('#contact-email-error')).toContainText('does not look right');
		await expect(page.locator('#contact-message-error')).toBeVisible();
		expect(capture.payloads).toEqual([]);
	});

	test('whitespace is trimmed so bounds are measured on real content', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		await fillValidForm(page, { name: `  ${VALID.name}  `, email: `  ${VALID.email} ` });
		await submit(page);
		await expect(page.getByRole('status')).toBeVisible();
		expect(capture.payloads[0]).toMatchObject({ name: VALID.name, email: VALID.email, message: VALID.message });
	});

	test('an oversized message is refused by the endpoint and reported, not swallowed', async ({ page, baseURL }) => {
		await openContact(page, baseURL, { status: 413 });
		await fillValidForm(page, { message: 'x'.repeat(20_000) });
		await submit(page);
		await expect(page.getByRole('alert')).toContainText('We could not reach the contact service.');
	});

	test('a rate-limited submission surfaces the fallback instead of a silent failure', async ({ page, baseURL }) => {
		await openContact(page, baseURL, { status: 429, body: { error: 'slow down' } });
		await fillValidForm(page);
		await submit(page);

		const alert = page.getByRole('alert');
		await expect(alert).toContainText('We could not reach the contact service.');
		await expect(alert.getByRole('link', { name: 'send the same note by email' })).toBeVisible();
		await expect(page.locator('.form-notice--success')).toHaveCount(0);
	});
});

test.describe('retry and endpoint-down fallback', () => {
	test('retry keeps everything the person already typed', async ({ page, baseURL }) => {
		await openContact(page, baseURL, { status: 429 });
		await fillValidForm(page);
		await submit(page);
		await expect(page.getByRole('alert')).toBeVisible();

		await page.getByRole('button', { name: 'Try again' }).click();
		await expect(page.getByRole('alert')).toHaveCount(0);
		await expect(page.locator('#contact-name')).toHaveValue(VALID.name);
		await expect(page.locator('#contact-email')).toHaveValue(VALID.email);
		await expect(page.locator('#contact-message')).toHaveValue(VALID.message);
		await expect(page.getByRole('button', { name: 'Send to keyholders' })).toBeEnabled();
	});

	test('an endpoint that is down shows the email fallback carrying the same note', async ({ page, baseURL }) => {
		await openContact(page, baseURL, { abort: true });
		await fillValidForm(page);
		await submit(page);

		const fallback = page.getByRole('alert').getByRole('link', { name: 'send the same note by email' });
		await expect(fallback).toBeVisible();
		const href = await fallback.getAttribute('href');
		expect(href?.startsWith('mailto:keyholders@latoolb.us')).toBe(true);
		const mailto = new URL(href ?? '');
		expect(mailto.searchParams.get('subject')).toBe(`Tool Bus contact: ${VALID.name}`);
		expect(mailto.searchParams.get('body')).toContain(VALID.email);
		expect(mailto.searchParams.get('body')).toContain(VALID.message);
	});

	test('a second attempt after a transient failure succeeds', async ({ page, baseURL }) => {
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		let attempt = 0;
		await page.route(CONTACT_URL, async (route) => {
			if (route.request().method() === 'OPTIONS') {
				await route.fulfill({
					status: 204,
					headers: {
						'access-control-allow-origin': route.request().headers().origin ?? '',
						'access-control-allow-methods': 'POST, OPTIONS',
						'access-control-allow-headers': 'content-type',
					},
					body: '',
				});
				return;
			}
			attempt += 1;
			await route.fulfill({
				status: attempt === 1 ? 503 : 200,
				headers: {
					'content-type': 'application/json',
					'access-control-allow-origin': route.request().headers().origin ?? '',
				},
				body: JSON.stringify({ ok: attempt > 1 }),
			});
		});
		await page.goto('/#contact');

		await fillValidForm(page);
		await submit(page);
		await expect(page.getByRole('alert')).toBeVisible();
		await page.getByRole('button', { name: 'Try again' }).click();
		// `retry()` resets and re-solves the ALTCHA widget; wait for the fresh
		// proof rather than racing it under CPU pressure.
		await expect
			.poll(async () => page.locator('altcha-widget').evaluate((element) => (element as { state?: string }).state))
			.toBe('verified');
		await submit(page);
		await expect(page.getByRole('status')).toContainText('your note is on its way');
		expect(attempt).toBe(2);
	});
});

test.describe('delivery canary', () => {
	test('the submitted body matches the delivery contract exactly', async ({ page, baseURL }) => {
		const capture = await openContact(page, baseURL);
		await fillValidForm(page);
		await expect
			.poll(async () => page.locator('altcha-widget').evaluate((element) => (element as { state?: string }).state))
			.toBe('verified');
		await submit(page);
		await expect(page.getByRole('status')).toBeVisible();

		const payload = capture.payloads[0];
		// The receiving handler is entitled to exactly these keys and no others.
		expect(Object.keys(payload).sort()).toEqual(['altcha', 'email', 'message', 'name', 'website']);
		expect(payload.website).toBe('');
		expect(payload.name).toBe(VALID.name);
		expect(payload.email).toBe(VALID.email);
		expect(payload.message).toBe(VALID.message);
		expect(capture.headers[0]['content-type']).toBe('application/json');
	});

	test('the success notice is announced, not just drawn', async ({ page, baseURL }) => {
		await openContact(page, baseURL);
		await fillValidForm(page);
		await submit(page);
		const notice = page.getByRole('status');
		await expect(notice).toHaveAttribute('aria-live', 'polite');
		await expect(notice).toContainText('A keyholder will reply to the email address you provided.');
		await expect(page.locator('form.contact-form')).toHaveCount(0);
	});
});

// The rows below need the live `forms.latoolb.us` deployment, which this
// repository neither owns nor is allowed to call from CI. They are declared so
// the gap is visible in the report, and they run only when an operator points
// GFTB_LIVE_CONTACT_ENDPOINT at a real deployment.
const liveEndpoint = process.env.GFTB_LIVE_CONTACT_ENDPOINT;
const liveReason =
	'needs a live contact endpoint: set GFTB_LIVE_CONTACT_ENDPOINT to run (this repo does not own forms.latoolb.us)';

test.describe('live endpoint variants', () => {
	test.skip(!liveEndpoint, liveReason);

	test('the live endpoint answers a preflight with the apex origin only', async ({ request }) => {
		const response = await request.fetch(`${liveEndpoint}/api/contact`, {
			method: 'OPTIONS',
			headers: {
				origin: 'https://greatfallstoolbus.org',
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'content-type',
			},
		});
		expect(response.headers()['access-control-allow-origin']).toBe('https://greatfallstoolbus.org');
	});

	test('the live endpoint refuses a foreign origin', async ({ request }) => {
		const response = await request.fetch(`${liveEndpoint}/api/contact`, {
			method: 'OPTIONS',
			headers: {
				origin: 'https://not-this-page.example',
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'content-type',
			},
		});
		expect(response.headers()['access-control-allow-origin']).not.toBe('https://not-this-page.example');
		expect(response.headers()['access-control-allow-origin']).not.toBe('*');
	});

	test('the live challenge endpoint issues a signed challenge', async ({ request }) => {
		const response = await request.get(`${liveEndpoint}/api/challenge`, {
			headers: { origin: 'https://greatfallstoolbus.org' },
		});
		expect(response.ok()).toBe(true);
		const challenge = (await response.json()) as Record<string, unknown>;
		expect(challenge.algorithm).toBe('SHA-256');
		expect(typeof challenge.signature).toBe('string');
	});

	test('the live endpoint rate-limits a burst rather than accepting it', async ({ request }) => {
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const response = await request.post(`${liveEndpoint}/api/contact`, {
				headers: { origin: 'https://greatfallstoolbus.org', 'content-type': 'application/json' },
				data: { name: 'canary', email: 'canary@example.invalid', message: 'rate limit probe', website: '' },
			});
			statuses.push(response.status());
		}
		expect(statuses).toContain(429);
	});
});
