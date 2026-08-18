import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type EventDetail = Record<string, unknown>;

class FakeCustomEvent extends Event {
	readonly detail: EventDetail;

	constructor(type: string, options: { detail: EventDetail }) {
		super(type);
		this.detail = options.detail;
	}
}

class FakeHTMLElement extends EventTarget {
	readonly style: Record<string, string> = {};
	textContent = '';
	type = '';
	name = '';
	value = '';
	private readonly attributes = new Map<string, string>();

	appendChild(_child: FakeHTMLElement): void {}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
}

type AltchaWidget = FakeHTMLElement & {
	payload: string;
	state: string;
	solve(): Promise<string>;
	_build(): void;
	_payload: string;
	_state: string;
	_solving: boolean;
};

type AltchaWidgetConstructor = new () => AltchaWidget;

function loadWidget(fetchImpl: (url: string, options: Record<string, unknown>) => Promise<unknown>): AltchaWidget {
	const registry = new Map<string, AltchaWidgetConstructor>();
	const source = readFileSync(path.resolve('static/vendor/altcha/altcha.js'), 'utf8');
	const window = {
		customElements: {
			define(name: string, constructor: AltchaWidgetConstructor) {
				registry.set(name, constructor);
			},
			get(name: string) {
				return registry.get(name);
			},
		},
	};

	runInNewContext(source, {
		window,
		HTMLElement: FakeHTMLElement,
		document: { createElement: () => new FakeHTMLElement() },
		CustomEvent: FakeCustomEvent,
		TextEncoder,
		btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
		fetch: fetchImpl,
		setTimeout,
	});

	const Widget = registry.get('altcha-widget');
	if (!Widget) throw new Error('ALTCHA widget did not register');
	const widget = new Widget();
	widget.setAttribute('challengeurl', 'https://forms.latoolb.us/api/challenge');
	widget._payload = '';
	widget._state = 'unverified';
	widget._solving = false;
	widget._build();
	return widget;
}

describe('vendored ALTCHA widget protocol', () => {
	it('solves a known SHA-256 challenge and emits the handler payload', async () => {
		const challenge = {
			algorithm: 'SHA-256',
			challenge: 'bd7c911264aae15b66d4291b6850829aa96986b1d3ead34d1fdbfef27056c112',
			salt: 'test',
			signature: 'a'.repeat(64),
			maxnumber: 7,
		};
		const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => challenge }));
		const widget = loadWidget(fetchImpl);
		const verified = vi.fn();
		const statechange = vi.fn();
		widget.addEventListener('verified', verified);
		widget.addEventListener('statechange', statechange);

		const payload = await widget.solve();

		expect(fetchImpl).toHaveBeenCalledWith(challengeUrl(), {
			method: 'GET',
			mode: 'cors',
			credentials: 'omit',
			cache: 'no-store',
		});
		expect(widget.state).toBe('verified');
		expect(payload).not.toBe('');
		expect(JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))).toEqual({
			algorithm: 'SHA-256',
			challenge: challenge.challenge,
			number: 7,
			salt: challenge.salt,
			signature: challenge.signature,
		});
		expect((verified.mock.calls[0]?.[0] as FakeCustomEvent).detail).toEqual({ payload });
		expect((statechange.mock.calls[0]?.[0] as FakeCustomEvent).detail).toEqual({ state: 'verified', payload });
	});

	it('rejects a solvable challenge without a signature', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				algorithm: 'SHA-256',
				challenge: 'bd7c911264aae15b66d4291b6850829aa96986b1d3ead34d1fdbfef27056c112',
				salt: 'test',
				maxnumber: 7,
			}),
		}));
		const widget = loadWidget(fetchImpl);
		const error = vi.fn();
		const statechange = vi.fn();
		widget.addEventListener('error', error);
		widget.addEventListener('statechange', statechange);

		expect(await widget.solve()).toBe('');
		expect(widget.state).toBe('error');
		expect((error.mock.calls[0]?.[0] as FakeCustomEvent).detail).toEqual({ error: 'bad challenge' });
		expect((statechange.mock.calls[0]?.[0] as FakeCustomEvent).detail).toEqual({ state: 'error', payload: '' });
	});
});

function challengeUrl(): string {
	return 'https://forms.latoolb.us/api/challenge';
}
