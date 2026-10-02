import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipHomeIntro } from './support/intro';
import {
	CONTACT_URL,
	installExternalGuard,
	stubChallenge,
	stubContactEndpoint,
	type ContactCapture,
	type ContactStubOptions,
} from './support/network';

import { HOURS_FIXTURE_GLOBAL } from '../src/lib/hours-band';

// RSVP for a work session (operator interview 2026-10-02, Option A): the
// dialog posts to the public contact relay as a contact message whose name
// starts with "RSVP " and whose message carries "Slot: <id>". Fields: email
// (required), name or handle and "Anything we should know?" (both optional).
// No acknowledgement is sent; a keyholder replies by hand.
//
// Most rows populate the band through its schema-checked test hook
// (window.__gftbHoursFixture) on a fixed clock, so they hold one slot only.
// Both real slots are published (decision 0032); the last row RSVPs from the
// published content itself. The relay and the challenge are stubbed; no
// request leaves the page for a live endpoint.

const NOW = new Date('2026-10-02T16:00:00Z');
const FIXTURE = [
	{
		id: 'thursday-weekly',
		published: true,
		weekday: 'thursday',
		start: '15:00',
		end: '16:00',
		timezone: 'America/New_York',
		staff: ['Jess'],
		repeat: { kind: 'weekly', startsOn: '2026-10-02' },
		location: 'the bus',
	},
];
const SLOT = 'thursday-weekly@2026-10-08';
const LABEL = 'Thursday 8 October, 3 to 4 PM ET';
const NEXT_LABEL = 'Thursday 15 October, 3 to 4 PM ET';
const EMAIL = 'ada@example.org';

interface Opened {
	capture: ContactCapture;
	trigger: Locator;
	dialog: Locator;
}

async function openRsvp(
	page: Page,
	baseURL: string | undefined,
	options: { challenge?: 'ok' | 'down'; relay?: ContactStubOptions } = {},
): Promise<Opened> {
	await skipHomeIntro(page);
	await page.clock.setFixedTime(NOW);
	await page.addInitScript(
		({ name, fixture }) => {
			(window as unknown as Record<string, unknown>)[name] = fixture;
		},
		{ name: HOURS_FIXTURE_GLOBAL, fixture: FIXTURE },
	);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
	if (options.challenge === 'down') await stubChallenge(page, { error: 'unavailable' }, 503);
	else await stubChallenge(page);
	const capture = await stubContactEndpoint(page, options.relay);
	await page.goto('/');
	await expect(page.locator('#hours')).toHaveAttribute('data-hours-mode', 'static');

	const trigger = page.locator('#hours').getByRole('button', { name: `RSVP for ${LABEL}` });
	await trigger.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('RSVP for a work session');
	await expect(dialog).toContainText(LABEL);
	return { capture, trigger, dialog };
}

const widgetState = (dialog: Locator) =>
	dialog.locator('altcha-widget').evaluate((element) => (element as { state?: string }).state);

async function send(dialog: Locator) {
	await dialog.getByRole('button', { name: 'Send RSVP' }).click();
}

test.describe('the RSVP dialog', () => {
	test('opens on the email field with the privacy note, and has no field for tools', async ({ page, baseURL }) => {
		const { dialog } = await openRsvp(page, baseURL);
		await expect(dialog.locator('#rsvp-email')).toBeFocused();
		await expect(dialog.getByLabel('Name or handle (optional)')).toBeVisible();
		await expect(dialog.getByLabel('Anything we should know? (optional)')).toBeVisible();
		await expect(dialog.locator('input:not([type="hidden"]), textarea')).toHaveCount(4);
		await expect(dialog).not.toContainText(/bring|discuss@/iu);
		await expect(dialog.locator('.rsvp-dialog__privacy')).toHaveText(
			'We send your email address, and the name and note if you give them, through our form relay to ' +
				"keyholders@latoolb.us, a private list read by keyholders. The relay adds your connection's IP address. " +
				'The list keeps a private archive; ask us to delete your message at any time by writing to the same ' +
				'address. Nothing from this form is stored on this site or in your browser.',
		);
	});

	test('an invalid email sends no request', async ({ page, baseURL }) => {
		const { capture, dialog } = await openRsvp(page, baseURL);
		await dialog.locator('#rsvp-email').fill('ada@invalid');
		await send(dialog);
		await expect(dialog.locator('#rsvp-email-error')).toHaveText('Check your email address.');
		await expect(dialog.locator('#rsvp-email')).toBeFocused();
		await dialog.locator('#rsvp-email').fill('');
		await send(dialog);
		await expect(dialog.locator('#rsvp-email-error')).toContainText('We need an email');
		expect(capture.payloads).toEqual([]);
	});

	test('a valid RSVP posts the relay keys, a name starting with "RSVP ", and the slot', async ({ page, baseURL }) => {
		const { capture, dialog, trigger } = await openRsvp(page, baseURL);
		await dialog.locator('#rsvp-email').fill(EMAIL);
		await dialog.locator('#rsvp-handle').fill('Ada');
		await dialog.locator('#rsvp-note').fill('First visit.');
		await expect.poll(() => widgetState(dialog), { message: 'the proof is solved before sending' }).toBe('verified');
		await send(dialog);

		const status = dialog.getByRole('status');
		await expect(status).toContainText('Thanks. Your RSVP has been sent.');
		await expect(status).toContainText('Replies usually come within three business days.');
		expect(capture.payloads).toHaveLength(1);
		const payload = capture.payloads[0];
		expect(Object.keys(payload).sort()).toEqual(['altcha', 'email', 'message', 'name', 'website']);
		expect(String(payload.name).startsWith('RSVP ')).toBe(true);
		expect(payload.name).toBe('RSVP Ada');
		expect(payload.email).toBe(EMAIL);
		expect(payload.website).toBe('');
		expect(payload.message).toBe(`Slot: ${SLOT}\nSession: ${LABEL}\nNote: First visit.`);
		expect(String(payload.message)).toContain(`Slot: ${SLOT}`);
		expect(capture.headers[0]['content-type']).toBe('application/json');

		// Closing hands focus back to the trigger, which stays enabled; the
		// same slot then says it was already sent, from memory only.
		await dialog.getByRole('button', { name: 'Close' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await expect(trigger).toBeEnabled();
		await trigger.click();
		await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('Already sent');
		await expect(page.getByRole('dialog').locator('form')).toHaveCount(0);
		expect(capture.payloads).toHaveLength(1);
	});

	test('with the challenge service down the RSVP still sends, with four keys', async ({ page, baseURL }) => {
		const { capture, dialog } = await openRsvp(page, baseURL, { challenge: 'down' });
		await dialog.locator('#rsvp-email').fill(EMAIL);
		await send(dialog);
		await expect(dialog.getByRole('status')).toContainText('Your RSVP has been sent.');
		expect(Object.keys(capture.payloads[0]).sort()).toEqual(['email', 'message', 'name', 'website']);
		expect(capture.payloads[0].name).toBe('RSVP');
		expect(capture.payloads[0].message).toBe(`Slot: ${SLOT}\nSession: ${LABEL}\nNote: none`);
	});

	for (const [statusCode, body, copy] of [
		[400, { error: 'a valid email is required' }, 'Check your email address.'],
		[429, { error: 'slow down' }, 'Too many messages came from this connection just now.'],
		[500, { error: 'internal' }, 'The relay had a problem on its side.'],
	] as const) {
		test(`a ${statusCode} answer says so and keeps the form`, async ({ page, baseURL }) => {
			const { capture, dialog } = await openRsvp(page, baseURL, { relay: { status: statusCode, body } });
			await dialog.locator('#rsvp-email').fill(EMAIL);
			await dialog.locator('#rsvp-handle').fill('Ada');
			await send(dialog);
			const alert = dialog.getByRole('alert');
			await expect(alert).toContainText(copy);
			await expect(alert.getByRole('link', { name: 'send your RSVP by email' })).toBeVisible();
			await expect(dialog.locator('.form-notice--success')).toHaveCount(0);
			await expect(dialog.locator('#rsvp-email')).toHaveValue(EMAIL);
			await expect(dialog.locator('#rsvp-handle')).toHaveValue('Ada');
			if (statusCode === 400) {
				await expect(dialog.locator('#rsvp-email-error')).toHaveText('Check your email address.');
				await expect(dialog.locator('#rsvp-email')).toBeFocused();
			}
			expect(capture.payloads).toHaveLength(1);
		});
	}

	test('when the relay cannot be reached, the same RSVP goes by email', async ({ page, baseURL }) => {
		const { dialog } = await openRsvp(page, baseURL, { relay: { abort: true } });
		await dialog.locator('#rsvp-email').fill(EMAIL);
		await dialog.locator('#rsvp-handle').fill('Ada');
		await dialog.locator('#rsvp-note').fill('First visit.');
		await send(dialog);

		const alert = dialog.getByRole('alert');
		await expect(alert).toContainText('We could not reach the relay.');
		const href = await alert.getByRole('link', { name: 'send your RSVP by email' }).getAttribute('href');
		expect(href?.startsWith('mailto:keyholders@latoolb.us?')).toBe(true);
		const mailto = new URL(href ?? '');
		expect(mailto.searchParams.get('subject')).toBe(`RSVP ${LABEL}`);
		const lines = mailto.searchParams.get('body')?.split('\n') ?? [];
		expect(lines[0]).toBe(`Slot: ${SLOT}`);
		expect(lines).toContain('Ada');
		expect(lines).toContain('First visit.');
	});

	test('a filled honeypot shows the quiet outcome and sends nothing', async ({ page, baseURL }) => {
		const { capture, dialog } = await openRsvp(page, baseURL);
		await expect(dialog.locator('.honeypot')).toHaveAttribute('aria-hidden', 'true');
		await dialog.locator('#rsvp-email').fill(EMAIL);
		await dialog.locator('#rsvp-website').fill('https://spam.example', { force: true });
		await send(dialog);
		await expect(dialog.getByRole('status')).toContainText('Your RSVP has been sent.');
		expect(capture.payloads, 'honeypot submissions must not be forwarded').toEqual([]);
	});

	test('a send still in flight when the dialog closes marks only its own slot', async ({ page, baseURL }) => {
		let release = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { capture, dialog, trigger } = await openRsvp(page, baseURL, { relay: { hold } });
		await dialog.locator('#rsvp-email').fill(EMAIL);
		await send(dialog);
		await expect(dialog.getByRole('button', { name: 'Sending…' })).toBeDisabled();
		await expect.poll(() => capture.payloads.length).toBe(1);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);

		// The same slot, reopened while the send is in flight, cannot send twice.
		await trigger.click();
		await expect(page.getByRole('dialog').getByRole('button', { name: 'Sending…' })).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);

		// Another session's dialog is open when the first answer lands: it
		// stays on its own form and is not marked sent.
		const next = page.locator('#hours').getByRole('button', { name: `RSVP for ${NEXT_LABEL}` });
		await next.click();
		const other = page.getByRole('dialog');
		await expect(other).toContainText(NEXT_LABEL);
		const answered = page.waitForResponse(
			(response) => response.url() === CONTACT_URL && response.request().method() === 'POST',
		);
		release();
		await answered;
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await expect(other.getByRole('heading', { level: 2 })).toHaveText('RSVP for a work session');
		await expect(other.locator('.form-notice--success')).toHaveCount(0);
		await expect(other.getByRole('button', { name: 'Send RSVP' })).toBeEnabled();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);

		// The slot that was sent is the one marked, from memory.
		await trigger.click();
		await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('Already sent');
		await page.keyboard.press('Escape');
		await next.click();
		await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('RSVP for a work session');
		expect(capture.payloads).toHaveLength(1);
	});

	test('focus returns to the trigger on Escape and on Cancel', async ({ page, baseURL }) => {
		const { capture, dialog, trigger } = await openRsvp(page, baseURL);
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();

		await trigger.click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(trigger).toBeFocused();
		expect(capture.payloads).toEqual([]);
		expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rsvp-open'))).toBe(false);
	});
});

test.describe('the RSVP dialog on the published content', () => {
	test('posts a message carrying the Thursday 8 October slot, with no fixture', async ({ page, baseURL }) => {
		// Decision 0032: both slots are published, so the real band rows carry
		// the RSVP on the fixed clock, without the test hook.
		await skipHomeIntro(page);
		await page.clock.setFixedTime(NOW);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		const capture = await stubContactEndpoint(page);
		await page.goto('/');
		await expect(page.locator('#hours')).toHaveAttribute('data-hours-mode', 'static');
		await page
			.locator('#hours')
			.getByRole('button', { name: `RSVP for ${LABEL}` })
			.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText(LABEL);
		await dialog.locator('#rsvp-email').fill(EMAIL);
		await dialog.locator('#rsvp-handle').fill('Ada');
		await expect.poll(() => widgetState(dialog), { message: 'the proof is solved before sending' }).toBe('verified');
		await send(dialog);
		await expect(dialog.getByRole('status')).toContainText('Your RSVP has been sent.');
		expect(capture.payloads).toHaveLength(1);
		expect(String(capture.payloads[0].name).startsWith('RSVP ')).toBe(true);
		expect(String(capture.payloads[0].message)).toContain(`Slot: ${SLOT}`);
	});
});
