import { describe, expect, it } from 'vitest';
import { EMAIL_RE, isHoneypotTripped } from './contact-form';
import {
	CAPTURE_DISMISS_MEMORY_MS,
	CAPTURE_DWELL_MS,
	CAPTURE_MIN_VIEWPORT_WIDTH,
	CAPTURE_SUPPRESSED_PATHS,
	armCapture,
	emptySubscribeValues,
	isSuppressedPath,
	parseStoredTime,
	subscribeApiUrl,
	toSubscribePayload,
	validateSubscribe,
	type CaptureSignals,
} from './subscribe-form';

const NOW = 1_800_000_000_000;

/** Every signal in its arming state; a row flips exactly one. */
const ready = (overrides: Partial<CaptureSignals> = {}): CaptureSignals => ({
	dwellMs: CAPTURE_DWELL_MS,
	scrolledPast: true,
	reducedMotion: false,
	viewportWidth: CAPTURE_MIN_VIEWPORT_WIDTH,
	introLive: false,
	scriptsOn: true,
	forcedColors: false,
	printing: false,
	dismissedAt: null,
	subscribedAt: null,
	pathname: '/',
	now: NOW,
	...overrides,
});

describe('subscribe form decisions', () => {
	it('shares the contact form email shape', () => {
		expect(validateSubscribe({ email: 'ada@example.org', website: '' })).toEqual({});
		expect(validateSubscribe({ email: '', website: '' })).toEqual({
			email: 'We need an email to send the confirmation to.',
		});
		expect(validateSubscribe({ email: 'bad', website: '' })).toEqual({
			email: 'That email does not look right. Check it and try again.',
		});
		expect(EMAIL_RE.test('ada@example.org')).toBe(true);
	});

	it('detects the honeypot with the contact form helper', () => {
		expect(isHoneypotTripped(emptySubscribeValues())).toBe(false);
		expect(isHoneypotTripped({ website: 'https://spam.example' })).toBe(true);
	});

	it('trims the payload and attaches a solved proof only when present', () => {
		expect(toSubscribePayload({ email: ' ada@example.org ', website: '' })).toEqual({
			email: 'ada@example.org',
			website: '',
		});
		expect(toSubscribePayload({ email: 'ada@example.org', website: '' }, 'proof').altcha).toBe('proof');
	});

	it('builds the canonical API route despite trailing slashes', () => {
		expect(subscribeApiUrl('https://forms.latoolb.us///')).toBe('https://forms.latoolb.us/api/subscribe');
		expect(subscribeApiUrl('https://forms.latoolb.us')).toBe('https://forms.latoolb.us/api/subscribe');
	});

	it('parses only a stored epoch-ms string', () => {
		expect(parseStoredTime(String(NOW))).toBe(NOW);
		for (const raw of [null, undefined, '', 'yesterday', '-1', '0', '1e3', ' 12 ']) {
			expect(parseStoredTime(raw)).toBeNull();
		}
	});
});

describe('capture arm rule', () => {
	it('pins the thresholds the operator ratified', () => {
		expect(CAPTURE_DWELL_MS).toBe(45_000);
		expect(CAPTURE_MIN_VIEWPORT_WIDTH).toBe(640);
		expect(CAPTURE_DISMISS_MEMORY_MS).toBe(30 * 24 * 60 * 60 * 1000);
		expect([...CAPTURE_SUPPRESSED_PATHS]).toEqual(['/contact', '/legal', '/privacy']);
	});

	it('arms only when every signal holds', () => {
		expect(armCapture(ready())).toEqual({ arm: true, reason: 'ready' });
	});

	it.each<[string, Partial<CaptureSignals>, string]>([
		['scripts off', { scriptsOn: false }, 'scripts-off'],
		['reduced motion', { reducedMotion: true }, 'reduced-motion'],
		['forced colours', { forcedColors: true }, 'forced-colors'],
		['printing', { printing: true }, 'printing'],
		['the contact page', { pathname: '/contact' }, 'suppressed-path'],
		['a contact sub-path', { pathname: '/contact/thanks' }, 'suppressed-path'],
		['the legal page', { pathname: '/legal' }, 'suppressed-path'],
		['the privacy page', { pathname: '/privacy' }, 'suppressed-path'],
		['an earlier signup', { subscribedAt: NOW - 10 * CAPTURE_DISMISS_MEMORY_MS }, 'subscribed'],
		['a dismissal a moment ago', { dismissedAt: NOW - 1 }, 'dismissed'],
		['a dismissal just inside thirty days', { dismissedAt: NOW - CAPTURE_DISMISS_MEMORY_MS + 1 }, 'dismissed'],
		['the intro live', { introLive: true }, 'intro-live'],
		['a narrow viewport', { viewportWidth: CAPTURE_MIN_VIEWPORT_WIDTH - 1 }, 'viewport-narrow'],
		['too little dwell', { dwellMs: CAPTURE_DWELL_MS - 1 }, 'dwell'],
		['the hero still in view', { scrolledPast: false }, 'hero'],
	])('never arms with %s', (_label, overrides, reason) => {
		expect(armCapture(ready(overrides))).toEqual({ arm: false, reason });
	});

	it('forgets a dismissal after thirty days but never a signup', () => {
		expect(armCapture(ready({ dismissedAt: NOW - CAPTURE_DISMISS_MEMORY_MS })).arm).toBe(true);
		expect(armCapture(ready({ subscribedAt: 1 })).arm).toBe(false);
	});

	it('reports the hard suppressions before the progress signals', () => {
		const stalled = ready({ dwellMs: 0, scrolledPast: false, viewportWidth: 320 });
		expect(armCapture({ ...stalled, reducedMotion: true }).reason).toBe('reduced-motion');
		expect(armCapture({ ...stalled, pathname: '/privacy' }).reason).toBe('suppressed-path');
		expect(armCapture({ ...stalled, introLive: true }).reason).toBe('intro-live');
		expect(armCapture(stalled).reason).toBe('viewport-narrow');
	});

	it('suppresses exact and nested policy paths only', () => {
		expect(isSuppressedPath('/contact')).toBe(true);
		expect(isSuppressedPath('/legal/')).toBe(true);
		expect(isSuppressedPath('/contacts')).toBe(false);
		expect(isSuppressedPath('/log')).toBe(false);
	});

	it('reads the clock from the caller when given, and from Date.now otherwise', () => {
		const signals = ready({ dismissedAt: Date.now() - 1000 });
		delete signals.now;
		expect(armCapture(signals).reason).toBe('dismissed');
	});
});
