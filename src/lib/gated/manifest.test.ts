import { describe, expect, it, vi } from 'vitest';
import {
	CACHE_KEY,
	TAILNET_CACHE_KEY,
	TAILNET_PROBE_TIMEOUT_MS,
	checkTailnet,
	probeTailnet,
	CACHE_YES_TTL_MS,
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

	it('never asks the tailnet on its own, even when the build set a probe URL', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(manifest(item())));
		await resolveSurface({
			...base,
			tailnetUrl: PROBE,
			fetchSeams: seams(fetchImpl as unknown as typeof fetch),
		});
		const urls = fetchImpl.mock.calls.map((call) => String((call as unknown[])[0]));
		expect(urls).toEqual([MANIFEST_URL]);
	});
});

const PROBE = 'https://probe.example.ts.net/v1/tailnet';
const SURFACE = 'https://probe.example.ts.net/v1/surface';

describe('probeTailnet', () => {
	const ask = (fetchImpl: unknown, extra: FetchSeams = {}) =>
		probeTailnet(PROBE, { fetchImpl: fetchImpl as typeof fetch, ...extra });

	it.each([
		['a bare true', true],
		['{ tailnet: true }', { tailnet: true }],
	])('is yes for %s', async (_label, body) => {
		expect(await ask(async () => jsonResponse(body))).toBe(true);
	});

	it.each([
		['false', false],
		['{ tailnet: false }', { tailnet: false }],
		['the string "true"', '"true"'],
		['{ tailnet: "true" }', { tailnet: 'true' }],
		['an empty object', {}],
		['null', null],
	])('is no for %s', async (_label, body) => {
		expect(await ask(async () => jsonResponse(body))).toBe(false);
	});

	it('is yes for the live probe answer, byte for byte', async () => {
		const live = new Response('{"tailnet": true}', {
			status: 200,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
		});
		expect(await ask(async () => live)).toBe(true);
	});

	it('is no for a non-200, a redirect, a non-JSON type, malformed JSON and a thrown error', async () => {
		expect(await ask(async () => jsonResponse(true, { status: 403 }))).toBe(false);
		expect(await ask(async () => jsonResponse(true, { status: 302 }))).toBe(false);
		expect(await ask(async () => jsonResponse(true, { type: 'text/html' }))).toBe(false);
		expect(await ask(async () => jsonResponse('{nope'))).toBe(false);
		expect(
			await ask(async () => {
				throw new TypeError('blocked');
			}),
		).toBe(false);
	});

	it('is no without a URL and does not ask', async () => {
		const fetchImpl = vi.fn();
		expect(await probeTailnet('', { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('is no on timeout and aborts the request; the default allows time for the permission prompt', async () => {
		let fire: (() => void) | undefined;
		let aborted = false;
		const pending = ask(
			(_input: unknown, init?: RequestInit) =>
				new Promise<Response>(() => init?.signal?.addEventListener('abort', () => (aborted = true))),
			{
				setTimer: (callback, ms) => {
					expect(ms).toBe(TAILNET_PROBE_TIMEOUT_MS);
					fire = callback;
					return 1;
				},
			},
		);
		await Promise.resolve();
		fire?.();
		expect(await pending).toBe(false);
		expect(aborted).toBe(true);
		expect(TAILNET_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
		expect(TAILNET_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(15000);
	});

	it('asks without credentials, no cache and no referrer', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(true));
		await ask(fetchImpl);
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(PROBE);
		expect(init).toMatchObject({
			credentials: 'omit',
			cache: 'no-store',
			referrerPolicy: 'no-referrer',
			redirect: 'manual',
		});
	});
});

describe('checkTailnet', () => {
	const tailItem = item({ href: `${PAGE}/join` });
	const route =
		(answers: { probe?: unknown; surface?: unknown; members?: unknown }) => async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === PROBE) return jsonResponse(answers.probe ?? false);
			if (url === SURFACE) return answers.surface ? jsonResponse(answers.surface) : jsonResponse({}, { status: 404 });
			if (url === MANIFEST_URL)
				return answers.members ? jsonResponse(answers.members) : jsonResponse({}, { status: 403 });
			throw new Error('unexpected ' + url);
		};
	const run = (
		fetchImpl: unknown,
		session: OverrideStorage | null = null,
		extra: { force?: boolean; now?: number } = {},
	) =>
		checkTailnet({
			probeUrl: PROBE,
			pageOrigin: PAGE,
			getSession: () => session,
			now: () => extra.now ?? 0,
			force: extra.force,
			fetchSeams: { fetchImpl: fetchImpl as typeof fetch },
		});

	it('a no answer is no, with no links, and asks nothing else', async () => {
		const fetchImpl = vi.fn(route({ probe: false }));
		expect(await run(fetchImpl)).toEqual({ answer: 'no', items: [] });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a blocked probe (fetch throws) is no', async () => {
		const blocked = async () => {
			throw new TypeError('blocked');
		};
		expect(await run(blocked)).toEqual({ answer: 'no', items: [] });
	});

	it('a yes takes the links from the tailnet /v1/surface when it serves one', async () => {
		const fetchImpl = vi.fn(
			route({ probe: { tailnet: true }, surface: manifest(tailItem), members: manifest(item({ label: 'Other' })) }),
		);
		expect(await run(fetchImpl)).toEqual({ answer: 'yes', items: [tailItem] });
		expect(fetchImpl.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([PROBE, SURFACE]);
	});

	it('a tailnet manifest may link to the member app origin (sign in)', async () => {
		const signIn = item({ slot: 'footer-sign-in', kind: 'sign-in', label: 'Member sign in', href: `${MEMBERS}/login` });
		const out = await run(route({ probe: true, surface: manifest(tailItem, signIn) }));
		expect(out.items).toEqual([tailItem, signIn]);
	});

	it('keeps every item of the lab probe manifest: site /join and members /login hrefs', async () => {
		// The exact manifest the lab probe lane serves from /v1/surface.
		const served = {
			items: [
				{ slot: 'header-join', kind: 'join', label: 'Join', href: 'https://greatfallstoolbus.org/join' },
				{ slot: 'footer-join', kind: 'join', label: 'Join', href: 'https://greatfallstoolbus.org/join' },
				{
					slot: 'footer-sign-in',
					kind: 'sign-in',
					label: 'Member sign in',
					href: 'https://members.greatfallstoolbus.org/login',
				},
				{
					slot: 'join-sign-in',
					kind: 'sign-in',
					label: 'Member sign in',
					href: 'https://members.greatfallstoolbus.org/login',
				},
			],
		};
		const out = await run(route({ probe: { tailnet: true }, surface: served }));
		expect(out).toEqual({ answer: 'yes', items: served.items });
		// The same check at a page origin that is not the site (a preview host).
		const preview = await checkTailnet({
			probeUrl: PROBE,
			pageOrigin: 'http://127.0.0.1:4173',
			fetchSeams: { fetchImpl: route({ probe: { tailnet: true }, surface: served }) as typeof fetch },
		});
		expect(preview.items).toEqual(served.items);
	});

	it('a yes falls back to the Access manifest when /v1/surface is not served', async () => {
		const fetchImpl = vi.fn(route({ probe: true, members: manifest(tailItem) }));
		expect(await run(fetchImpl)).toEqual({ answer: 'yes', items: [tailItem] });
		expect(fetchImpl.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([PROBE, SURFACE, MANIFEST_URL]);
	});

	it('a yes with no links anywhere is yes with nothing to mount', async () => {
		expect(await run(route({ probe: true }))).toEqual({ answer: 'yes', items: [] });
	});

	it('remembers a no for the tab and a yes for the TTL, and force asks again', async () => {
		const session = memoryStorage();
		const no = vi.fn(route({ probe: false }));
		await run(no, session, { now: 0 });
		await run(no, session, { now: CACHE_YES_TTL_MS * 50 });
		expect(no).toHaveBeenCalledTimes(1);
		const yes = vi.fn(route({ probe: true, surface: manifest(tailItem) }));
		await run(yes, session, { now: 1, force: true });
		expect(yes).toHaveBeenCalledTimes(2);
		expect(await run(yes, session, { now: 2 })).toEqual({ answer: 'yes', items: [tailItem] });
		expect(yes).toHaveBeenCalledTimes(2);
		await run(yes, session, { now: 1 + CACHE_YES_TTL_MS });
		expect(yes.mock.calls.length).toBeGreaterThan(2);
	});

	it('a yes stores its links where the page-load resolver reads them, so a later load needs no request', async () => {
		const session = memoryStorage();
		await run(route({ probe: true, surface: manifest(tailItem) }), session, { now: 0 });
		const fetchImpl = vi.fn();
		const items = await resolveSurface({
			search: '',
			getStorage: () => null,
			pageOrigin: PAGE,
			tailnetUrl: PROBE,
			getSession: () => session,
			now: () => 1,
			fetchSeams: { fetchImpl: fetchImpl as unknown as typeof fetch },
		});
		expect(items).toEqual([tailItem]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('a no leaves a cached Access yes alone', async () => {
		const session = memoryStorage();
		await resolveSurface({
			search: '',
			getStorage: () => null,
			pageOrigin: PAGE,
			getSession: () => session,
			now: () => 0,
			fetchSeams: { fetchImpl: (async () => jsonResponse(manifest(item()))) as typeof fetch },
		});
		await run(route({ probe: false }), session, { now: 1 });
		expect(session.data.get(CACHE_KEY)).toContain('"items":[{');
	});

	it('?flags= clears the tailnet answer too', async () => {
		const session = memoryStorage();
		await run(route({ probe: false }), session);
		expect(session.data.has(TAILNET_CACHE_KEY)).toBe(true);
		await resolveSurface({
			search: '?flags=none',
			getStorage: () => null,
			pageOrigin: PAGE,
			getSession: () => session,
			fetchSeams: { fetchImpl: (async () => jsonResponse(manifest())) as typeof fetch },
		});
		expect(session.data.has(TAILNET_CACHE_KEY)).toBe(false);
	});

	it('works when storage throws', async () => {
		const throwing: OverrideStorage = {
			getItem: () => {
				throw new Error('x');
			},
			setItem: () => {
				throw new Error('x');
			},
			removeItem: () => {
				throw new Error('x');
			},
		};
		expect(await run(route({ probe: true, surface: manifest(tailItem) }), throwing)).toEqual({
			answer: 'yes',
			items: [tailItem],
		});
	});
});

describe('the per-tab outcome cache', () => {
	const base = { search: '', getStorage: () => null, pageOrigin: PAGE, tailnetUrl: '' };
	const ok = () => vi.fn(async () => jsonResponse(manifest(item())));
	const bad = () => vi.fn(async () => jsonResponse(manifest(), { status: 403 }));
	const run = (fetchImpl: unknown, session: OverrideStorage | null, now: number, search = '') =>
		resolveSurface({
			...base,
			search,
			getSession: () => session,
			now: () => now,
			fetchSeams: { fetchImpl: fetchImpl as typeof fetch },
		});

	it('misses, fetches once, then hits without a request', async () => {
		const session = memoryStorage();
		const fetchImpl = ok();
		expect(await run(fetchImpl, session, 1000)).toEqual([item()]);
		expect(session.data.has(CACHE_KEY)).toBe(true);
		expect(await run(fetchImpl, session, 2000)).toEqual([item()]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('caches "no" for the whole tab lifetime', async () => {
		const session = memoryStorage();
		const fetchImpl = bad();
		expect(await run(fetchImpl, session, 0)).toEqual([]);
		expect(await run(fetchImpl, session, CACHE_YES_TTL_MS * 100)).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('expires a cached "yes" after the TTL and asks again', async () => {
		const session = memoryStorage();
		const fetchImpl = ok();
		await run(fetchImpl, session, 0);
		await run(fetchImpl, session, CACHE_YES_TTL_MS - 1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await run(fetchImpl, session, CACHE_YES_TTL_MS);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('lets a sign-out show: an expired "yes" that now fails becomes a cached "no"', async () => {
		const session = memoryStorage();
		await run(ok(), session, 0);
		const after = bad();
		expect(await run(after, session, CACHE_YES_TTL_MS + 1)).toEqual([]);
		expect(await run(after, session, CACHE_YES_TTL_MS * 2)).toEqual([]);
		expect(after).toHaveBeenCalledTimes(1);
	});

	it.each(['?flags=none', '?flags=membership'])('%s clears the cache', async (search) => {
		const session = memoryStorage();
		await run(ok(), session, 0);
		const fetchImpl = ok();
		await run(fetchImpl, session, 1, search);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('does not cache an outcome reached while the page is unloading', async () => {
		const session = memoryStorage();
		const fetchImpl = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
		const items = await resolveSurface({
			...base,
			getSession: () => session,
			canCache: () => false,
			fetchSeams: { fetchImpl: fetchImpl as unknown as typeof fetch },
		});
		expect(items).toEqual([]);
		expect(session.data.has(CACHE_KEY)).toBe(false);
	});

	it('ignores a corrupt or off-origin cache entry', async () => {
		for (const raw of [
			'{not json',
			'[]',
			JSON.stringify({ at: 'x', items: [] }),
			JSON.stringify({ at: 0, items: [item({ href: 'https://evil.example/join' })] }),
			JSON.stringify({ at: 5000, items: [item()] }),
		]) {
			const session = memoryStorage({ [CACHE_KEY]: raw });
			const fetchImpl = ok();
			expect(await run(fetchImpl, session, 100), raw).toEqual([item()]);
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		}
	});

	it('works when storage throws or is absent', async () => {
		const throwing: OverrideStorage = {
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
		for (const session of [throwing, null]) {
			const fetchImpl = ok();
			expect(await run(fetchImpl, session, 0)).toEqual([item()]);
			expect(await run(fetchImpl, session, 1)).toEqual([item()]);
			expect(fetchImpl).toHaveBeenCalledTimes(2);
		}
		const items = await resolveSurface({
			...base,
			getSession: () => {
				throw new Error('no session storage');
			},
			fetchSeams: { fetchImpl: (async () => jsonResponse(manifest(item()))) as typeof fetch },
		});
		expect(items).toEqual([item()]);
	});
});
