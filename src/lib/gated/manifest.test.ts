import { describe, expect, it, vi } from 'vitest';
import {
	FETCH_TIMEOUT_MS,
	MANIFEST_URL,
	OVERRIDE_KEY,
	SITE_ORIGIN,
	fetchManifest,
	parseManifest,
	readOverride,
	resolveSurface,
	tailnetManifestUrl,
	type FetchSeams,
	type OverrideStorage,
	type SurfaceItem,
} from './manifest';

const PAGE = 'https://greatfallstoolbus.org';
const MEMBERS = 'https://members.greatfallstoolbus.org';
const ALLOWED = [PAGE, SITE_ORIGIN, MEMBERS];

const item = (over: Partial<SurfaceItem> = {}): SurfaceItem => ({
	slot: 'header-join',
	kind: 'join',
	label: 'Join',
	href: `${PAGE}/join`,
	...over,
});

const manifest = (...items: SurfaceItem[]) => ({ items });

function jsonResponse(body: unknown, init: ResponseInit & { type?: string } = {}): Response {
	const { type = 'application/json; charset=utf-8', ...rest } = init;
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': type },
		...rest,
	});
}

function memoryStorage(initial: Record<string, string> = {}): OverrideStorage & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
		removeItem: (key) => void data.delete(key),
	};
}

describe('the manifest address', () => {
	it('is the members host manifest, the only member-app address this module holds', () => {
		expect(MANIFEST_URL).toBe('https://members.greatfallstoolbus.org/api/public-surface');
	});
});

describe('parseManifest', () => {
	it('keeps well-formed items on allowed origins', () => {
		const items = [
			item(),
			item({ slot: 'footer-sign-in', kind: 'sign-in', label: 'Member sign in', href: `${MEMBERS}/login` }),
		];
		expect(parseManifest(manifest(...items), ALLOWED)).toEqual(items);
	});

	it.each([
		['null', null],
		['an array', []],
		['a string', 'items'],
		['no items', {}],
		['items that is not a list', { items: {} }],
	])('returns nothing for %s', (_label, value) => {
		expect(parseManifest(value, ALLOWED)).toEqual([]);
	});

	it('drops items with an unknown slot or kind, a bad label or a non-string href', () => {
		const bad = [
			{ ...item(), slot: 'sidebar' },
			{ ...item(), kind: 'donate' },
			{ ...item(), label: '' },
			{ ...item(), label: '   ' },
			{ ...item(), label: 'x'.repeat(61) },
			{ ...item(), label: 7 },
			{ ...item(), href: 7 },
			null,
			'join',
		];
		expect(parseManifest({ items: [...bad, item()] }, ALLOWED)).toEqual([item()]);
	});

	it.each([
		['http', 'http://greatfallstoolbus.org/join'],
		['a javascript URL', 'javascript:alert(1)'],
		['a data URL', 'data:text/html,hi'],
		['a relative path', '/join'],
		['a foreign origin', 'https://evil.example/join'],
		['a lookalike origin', 'https://greatfallstoolbus.org.evil.example/join'],
		['userinfo', 'https://user:pass@greatfallstoolbus.org/join'],
		['another port', 'https://greatfallstoolbus.org:8443/join'],
	])('drops a link with %s', (_label, href) => {
		expect(parseManifest(manifest(item({ href })), ALLOWED)).toEqual([]);
	});

	it('caps the number of items it reads', () => {
		const many = Array.from({ length: 100 }, () => item());
		expect(parseManifest(manifest(...many), ALLOWED).length).toBeLessThanOrEqual(24);
	});
});

describe('fetchManifest fails closed', () => {
	const good = manifest(item());
	const run = (fetchImpl: FetchSeams['fetchImpl'], extra: FetchSeams = {}) =>
		fetchManifest(MANIFEST_URL, ALLOWED, 'include', { fetchImpl, ...extra });

	it('returns the items for a 200 JSON answer', async () => {
		expect(await run(async () => jsonResponse(good))).toEqual([item()]);
	});

	it('asks credentialed, without following redirects, with no cache and no referrer', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(good));
		await run(fetchImpl as unknown as typeof fetch);
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(MANIFEST_URL);
		expect(init).toMatchObject({
			method: 'GET',
			credentials: 'include',
			redirect: 'manual',
			cache: 'no-store',
			referrerPolicy: 'no-referrer',
		});
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('returns nothing on a network error', async () => {
		expect(
			await run(async () => {
				throw new TypeError('Failed to fetch');
			}),
		).toEqual([]);
	});

	it.each([201, 204, 301, 302, 401, 403, 404, 500, 503])('returns nothing on status %i', async (status) => {
		expect(await run(async () => jsonResponse(good, { status }))).toEqual([]);
	});

	it('returns nothing for a redirect the browser hides (status 0)', async () => {
		const opaque = {
			status: 0,
			type: 'opaqueredirect',
			headers: new Headers(),
			json: async () => good,
		} as unknown as Response;
		expect(await run(async () => opaque)).toEqual([]);
	});

	it.each([
		['HTML (the Access login page)', 'text/html; charset=utf-8'],
		['plain text', 'text/plain'],
		['an image', 'image/svg+xml'],
		['a lookalike', 'application/jsonp'],
		['nothing', ''],
	])('returns nothing for content type %s', async (_label, type) => {
		const response = jsonResponse(good, { type: type || 'application/octet-stream' });
		if (!type) response.headers.delete('content-type');
		expect(await run(async () => response)).toEqual([]);
	});

	it('returns nothing for a malformed body', async () => {
		expect(await run(async () => jsonResponse('{not json'))).toEqual([]);
		expect(await run(async () => jsonResponse(''))).toEqual([]);
	});

	it('returns nothing when the answer has no valid item', async () => {
		expect(await run(async () => jsonResponse({ items: [item({ href: 'https://evil.example/x' })] }))).toEqual([]);
	});

	it('returns nothing on timeout, even when the request never settles, and aborts it', async () => {
		let timerCallback: (() => void) | undefined;
		let aborted = false;
		const pending = run(
			(_input, init) =>
				new Promise<Response>(() => {
					init?.signal?.addEventListener('abort', () => (aborted = true));
				}),
			{
				timeoutMs: 25,
				setTimer: (callback, ms) => {
					expect(ms).toBe(25);
					timerCallback = callback;
					return 1;
				},
			},
		);
		await Promise.resolve();
		expect(timerCallback).toBeTypeOf('function');
		timerCallback?.();
		expect(await pending).toEqual([]);
		expect(aborted).toBe(true);
	});

	it('uses a short default timeout', () => {
		expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(5000);
	});

	it('clears its timer when it settles', async () => {
		const clearTimer = vi.fn();
		await run(async () => jsonResponse(good), { setTimer: () => 7, clearTimer });
		expect(clearTimer).toHaveBeenCalledWith(7);
	});
});

describe('readOverride', () => {
	it('?flags=membership sets the key and turns the override on', () => {
		const storage = memoryStorage();
		expect(readOverride('?flags=membership', () => storage)).toBe(true);
		expect(storage.data.get(OVERRIDE_KEY)).toBe('on');
		expect(readOverride('', () => storage)).toBe(true);
	});

	it('?flags=none clears the key', () => {
		const storage = memoryStorage({ [OVERRIDE_KEY]: 'on' });
		expect(readOverride('?flags=none', () => storage)).toBe(false);
		expect(storage.data.has(OVERRIDE_KEY)).toBe(false);
	});

	it('ignores anything else and treats storage failures as no stored override', () => {
		expect(readOverride('?flags=everything', () => memoryStorage())).toBe(false);
		const throwing = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			},
		};
		expect(readOverride('', () => throwing)).toBe(false);
		expect(readOverride('?flags=membership', () => throwing)).toBe(true);
		expect(
			readOverride('', () => {
				throw new Error('no storage');
			}),
		).toBe(false);
	});
});

describe('tailnetManifestUrl', () => {
	it('is empty unless the build set a usable URL', () => {
		expect(tailnetManifestUrl('')).toBe('');
		expect(tailnetManifestUrl('not a url')).toBe('');
		expect(tailnetManifestUrl('ftp://host/x')).toBe('');
	});

	it("points at the probe origin's /v1/surface", () => {
		expect(tailnetManifestUrl('https://tailnet.example.test:8443/favicon.svg?x=1')).toBe(
			'https://tailnet.example.test:8443/v1/surface',
		);
	});
});

describe('resolveSurface', () => {
	const base = { search: '', getStorage: () => null, pageOrigin: PAGE, tailnetUrl: '' };
	const answer = (items: SurfaceItem[]) => async () => jsonResponse(manifest(...items));
	const seams = (fetchImpl: FetchSeams['fetchImpl']): FetchSeams => ({ fetchImpl });

	it('serves the members manifest for a visitor with a session', async () => {
		const fetchImpl = vi.fn(answer([item()]));
		const items = await resolveSurface({ ...base, fetchSeams: seams(fetchImpl as unknown as typeof fetch) });
		expect(items).toEqual([item()]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(MANIFEST_URL);
	});

	it.each([
		['an error', async () => Promise.reject(new TypeError('Failed to fetch'))],
		['a non-200 answer', async () => jsonResponse(manifest(item()), { status: 403 })],
		['an HTML login page', async () => jsonResponse('<html></html>', { type: 'text/html' })],
		['an empty manifest', async () => jsonResponse(manifest())],
	])('resolves to nothing after %s', async (_label, fetchImpl) => {
		expect(await resolveSurface({ ...base, fetchSeams: seams(fetchImpl as unknown as typeof fetch) })).toEqual([]);
	});

	it('never rejects, even when fetch throws synchronously', async () => {
		const fetchImpl = (() => {
			throw new Error('boom');
		}) as unknown as typeof fetch;
		expect(await resolveSurface({ ...base, fetchSeams: seams(fetchImpl) })).toEqual([]);
	});

	it('does not touch the fixture without the build flag, even with ?flags=membership', async () => {
		const loadFixture = vi.fn(async () => [item({ label: 'Fixture' })]);
		const fetchImpl = vi.fn(async () => Promise.reject(new Error('offline')));
		const items = await resolveSurface({
			...base,
			search: '?flags=membership',
			fixtureEnabled: false,
			loadFixture,
			fetchSeams: seams(fetchImpl as unknown as typeof fetch),
		});
		expect(items).toEqual([]);
		expect(loadFixture).not.toHaveBeenCalled();
	});

	it('serves the fixture for ?flags=membership in a build that allows it, without the network', async () => {
		const loadFixture = vi.fn(async () => [item({ label: 'Fixture' })]);
		const fetchImpl = vi.fn();
		const items = await resolveSurface({
			...base,
			search: '?flags=membership',
			fixtureEnabled: true,
			loadFixture,
			fetchSeams: seams(fetchImpl as unknown as typeof fetch),
		});
		expect(items).toEqual([item({ label: 'Fixture' })]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('does not serve the fixture without the request, even in a build that allows it', async () => {
		const loadFixture = vi.fn(async () => [item({ label: 'Fixture' })]);
		const items = await resolveSurface({
			...base,
			fixtureEnabled: true,
			loadFixture,
			fetchSeams: seams((async () => jsonResponse(manifest())) as unknown as typeof fetch),
		});
		expect(items).toEqual([]);
		expect(loadFixture).not.toHaveBeenCalled();
	});

	it('fails closed when the fixture loader throws', async () => {
		const items = await resolveSurface({
			...base,
			search: '?flags=membership',
			fixtureEnabled: true,
			loadFixture: async () => Promise.reject(new Error('missing')),
		});
		expect(items).toEqual([]);
	});

	it('asks the tailnet manifest too when the build set one, and takes whichever answers', async () => {
		const tailnetItem = item({ label: 'Join', href: 'https://tailnet.example.test/join' });
		const calls: Array<[string, RequestInit | undefined]> = [];
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push([url, init]);
			return url === MANIFEST_URL ? jsonResponse(manifest(), { status: 403 }) : jsonResponse(manifest(tailnetItem));
		}) as typeof fetch;
		const items = await resolveSurface({
			...base,
			tailnetUrl: 'https://tailnet.example.test/favicon.svg',
			fetchSeams: seams(fetchImpl),
		});
		expect(items).toEqual([tailnetItem]);
		expect(calls.map(([url]) => url).sort()).toEqual([MANIFEST_URL, 'https://tailnet.example.test/v1/surface'].sort());
		expect(calls.find(([url]) => url === MANIFEST_URL)?.[1]?.credentials).toBe('include');
		expect(calls.find(([url]) => url !== MANIFEST_URL)?.[1]?.credentials).toBe('omit');
	});

	it('does not let one source vouch for another source origin', async () => {
		const fetchImpl = (async (input: RequestInfo | URL) =>
			String(input) === MANIFEST_URL
				? jsonResponse(manifest(item({ href: 'https://tailnet.example.test/join' })))
				: jsonResponse(manifest())) as typeof fetch;
		const items = await resolveSurface({
			...base,
			tailnetUrl: 'https://tailnet.example.test/favicon.svg',
			fetchSeams: seams(fetchImpl),
		});
		expect(items).toEqual([]);
	});

	it('never asks the tailnet when the build set none', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(manifest(item())));
		await resolveSurface({ ...base, tailnetUrl: '', fetchSeams: seams(fetchImpl as unknown as typeof fetch) });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
