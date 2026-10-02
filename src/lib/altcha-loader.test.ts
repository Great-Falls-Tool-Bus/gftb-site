import { describe, expect, it, vi } from 'vitest';

import { ALTCHA_SCRIPT_SRC, loadAltchaWidget, resolveAltcha, watchAltcha } from './altcha-loader';

function fakeDocument() {
	const appended: Array<{ src: string; defer: boolean; dataset: Record<string, string | undefined> }> = [];
	const doc = {
		querySelector: (selector: string) =>
			selector === 'script[data-altcha]' ? (appended.find((node) => node.dataset.altcha === '') ?? null) : null,
		createElement: () => ({ src: '', defer: false, dataset: {} }),
		head: { appendChild: (node: (typeof appended)[number]) => appended.push(node) },
	} as unknown as Document;
	return { doc, appended };
}

describe('the shared ALTCHA loader', () => {
	it('adds the vendored script once, deferred and marked', () => {
		const { doc, appended } = fakeDocument();
		loadAltchaWidget(doc);
		loadAltchaWidget(doc);
		expect(appended).toHaveLength(1);
		expect(appended[0]).toEqual({ src: ALTCHA_SCRIPT_SRC, defer: true, dataset: { altcha: '' } });
		expect(ALTCHA_SCRIPT_SRC).toBe('/vendor/altcha/altcha.js');
	});

	it('does nothing without a document', () => {
		expect(() => loadAltchaWidget(undefined)).not.toThrow();
	});

	it('reports a verified proof and clears it on any other state', () => {
		const element = new EventTarget() as unknown as HTMLElement;
		const seen: string[] = [];
		const stop = watchAltcha(element, (payload) => seen.push(payload));
		element.dispatchEvent(new CustomEvent('verified', { detail: { payload: 'proof' } }));
		element.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'verifying' } }));
		element.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'verified' } }));
		stop();
		element.dispatchEvent(new CustomEvent('verified', { detail: { payload: 'late' } }));
		expect(seen).toEqual(['proof', '']);
	});

	it('resets and solves again for a fresh proof', () => {
		const reset = vi.fn();
		const solve = vi.fn();
		resolveAltcha({ reset, solve } as unknown as HTMLElement);
		expect(reset).toHaveBeenCalledOnce();
		expect(solve).toHaveBeenCalledOnce();
		expect(() => resolveAltcha(undefined)).not.toThrow();
	});
});
