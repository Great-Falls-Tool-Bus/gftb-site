// The gated membership surface, as data (operator interview 2026-10-04,
// TIN-5371 and TIN-5351; rulings: "Code-split from a gated origin" and "the
// layout SHOULD shift with missing elements").
//
// The membership links (header Join, the FAQ Apply and Member sign in, the
// "How membership works" links, the footer Join and Member sign in, and the
// /join page's own sign in) are NOT in this site's HTML or JavaScript. The
// member app serves them as a JSON manifest from its own host, which sits
// wholly behind Cloudflare Access. This module fetches that manifest with the
// visitor's Access cookie (`credentials: 'include'`; a cross-origin import()
// sends no cookies, so the code-split is a data fetch), validates it, and
// hands the items to <GatedSlot>. Anyone without a session gets the Access
// login redirect or a CORS refusal, and every failure resolves to no items:
// the slots render nothing and the layout closes up around them. The only
// thing the public bundle holds is the manifest URL below.
//
// Sources, concurrently, first valid manifest wins:
// (a) the members manifest, credentialed;
// (b) the tailnet, but never on page load (operator ruling 2026-10-05): only
//     when the visitor presses the footer button and confirms in the modal,
//     see checkTailnet below. The probe URL is the build's
//     PUBLIC_TAILNET_PROBE_URL (stamped, leak-scanned); empty means no button;
// (c) a fixture manifest, only in a build that sets PUBLIC_MEMBERSHIP_FIXTURE=1
//     and only for a visitor who asked with ?flags=membership (stored in
//     localStorage; ?flags=none clears it). A normal build dead-code-eliminates
//     the fixture module, so its links never ship publicly. The override
//     replaces the network sources so a reviewer sees a deterministic surface.

/** The member app's manifest. The only member-app address in the public bundle. */
export const MANIFEST_URL = 'https://members.greatfallstoolbus.org/api/public-surface';

/** This site's canonical origin; manifest links to it become same-site links. */
export const SITE_ORIGIN = 'https://greatfallstoolbus.org';

/** Build-time tailnet probe URL; empty unless PUBLIC_TAILNET_PROBE_URL is set. */
export const TAILNET_PROBE_URL: string = typeof __TAILNET_PROBE_URL__ === 'string' ? __TAILNET_PROBE_URL__.trim() : '';

/** Whether this build may serve the fixture manifest (dev and reviewer builds only). */
export const FIXTURE_ENABLED: boolean = typeof __MEMBERSHIP_FIXTURE__ === 'boolean' ? __MEMBERSHIP_FIXTURE__ : false;

/** localStorage key for the preview override. */
export const OVERRIDE_KEY = 'gftb:flags:membership';

/** sessionStorage key for the per-tab outcome cache. */
export const CACHE_KEY = 'gftb:gated-surface';

/** How long a cached "yes" lives, so a sign-out takes effect soon. A "no" lasts the tab. */
export const CACHE_YES_TTL_MS = 5 * 60 * 1000;

/** How long a manifest fetch may take before it counts as "no". */
export const FETCH_TIMEOUT_MS = 4000;

export const SLOTS = [
	'header-join',
	'faq-actions',
	'how-membership',
	'footer-join',
	'footer-sign-in',
	'join-sign-in',
] as const;
export type SurfaceSlot = (typeof SLOTS)[number];

export const KINDS = ['join', 'apply', 'sign-in', 'how-membership'] as const;
export type SurfaceKind = (typeof KINDS)[number];

export interface SurfaceItem {
	slot: SurfaceSlot;
	kind: SurfaceKind;
	label: string;
	href: string;
}

const MAX_ITEMS = 24;
const MAX_LABEL = 60;

/** The part of Storage the override uses. */
export interface OverrideStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/**
 * Applies a `?flags=` request to storage and reports whether the override is
 * set. `membership` sets it, `none` clears it, anything else leaves it.
 * Storage failures count as "no override" unless the URL itself asked.
 */
export function readOverride(search: string, getStorage: () => OverrideStorage | null): boolean {
	let requested: string | null;
	try {
		requested = new URLSearchParams(search).get('flags');
	} catch {
		requested = null;
	}
	try {
		const storage = getStorage();
		if (!storage) return requested === 'membership';
		if (requested === 'membership') storage.setItem(OVERRIDE_KEY, 'on');
		else if (requested === 'none') storage.removeItem(OVERRIDE_KEY);
		return storage.getItem(OVERRIDE_KEY) === 'on';
	} catch {
		return requested === 'membership';
	}
}

function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/**
 * Validates a parsed manifest. Returns only well-formed items whose link is an
 * https URL on an allowed origin; everything else is dropped. Never throws.
 */
export function parseManifest(value: unknown, allowedOrigins: readonly string[]): SurfaceItem[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
	const items = (value as { items?: unknown }).items;
	if (!Array.isArray(items)) return [];
	const allowed = new Set(allowedOrigins);
	const result: SurfaceItem[] = [];
	for (const raw of items.slice(0, MAX_ITEMS)) {
		if (typeof raw !== 'object' || raw === null) continue;
		const { slot, kind, label, href } = raw as Record<string, unknown>;
		if (typeof slot !== 'string' || !(SLOTS as readonly string[]).includes(slot)) continue;
		if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) continue;
		if (typeof label !== 'string' || label.trim() === '' || label.length > MAX_LABEL) continue;
		if (typeof href !== 'string') continue;
		let url: URL;
		try {
			url = new URL(href);
		} catch {
			continue;
		}
		if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.origin)) continue;
		result.push({ slot: slot as SurfaceSlot, kind: kind as SurfaceKind, label: label.trim(), href: url.href });
	}
	return result;
}

export interface FetchSeams {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/**
 * Fetches and validates one manifest. Fails closed: a network error, a
 * timeout, a redirect (Access sends anyone without a session to its login),
 * any status but 200, a non-JSON content type or a malformed body all resolve
 * to no items. Never rejects.
 */
export async function fetchManifest(
	url: string,
	allowedOrigins: readonly string[],
	credentials: RequestCredentials,
	seams: FetchSeams = {},
): Promise<SurfaceItem[]> {
	const {
		fetchImpl = (input, init) => fetch(input, init),
		timeoutMs = FETCH_TIMEOUT_MS,
		setTimer = (callback, ms) => setTimeout(callback, ms),
		clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	} = seams;
	const controller = new AbortController();
	let timer: unknown;
	try {
		timer = setTimer(() => controller.abort(), timeoutMs);
		const timedOut = new Promise<never>((_, reject) => {
			controller.signal.addEventListener('abort', () => reject(new Error('timeout')));
		});
		const work = (async () => {
			const response = await fetchImpl(url, {
				method: 'GET',
				credentials,
				redirect: 'manual',
				cache: 'no-store',
				referrerPolicy: 'no-referrer',
				signal: controller.signal,
			});
			if (response.status !== 200) return [];
			const type = response.headers.get('content-type') ?? '';
			if (!/^application\/json\s*(?:;|$)/iu.test(type)) return [];
			return parseManifest(await response.json(), allowedOrigins);
		})();
		return await Promise.race([work, timedOut]);
	} catch {
		return [];
	} finally {
		clearTimer(timer);
	}
}

/** Reads the tab's cached outcome: items (possibly empty for "no"), or null on a miss. */
export function readCache(
	getSession: () => OverrideStorage | null,
	now: number,
	allowedOrigins: readonly string[],
): SurfaceItem[] | null {
	try {
		const raw = getSession()?.getItem(CACHE_KEY);
		if (!raw) return null;
		const entry = JSON.parse(raw) as { at?: unknown; items?: unknown };
		if (typeof entry.at !== 'number' || !Array.isArray(entry.items)) return null;
		if (entry.items.length === 0) return [];
		if (now - entry.at < 0 || now - entry.at >= CACHE_YES_TTL_MS) return null;
		const items = parseManifest({ items: entry.items }, allowedOrigins);
		return items.length > 0 ? items : null;
	} catch {
		return null;
	}
}

/** Stores the tab's outcome. Storage failures are ignored. */
export function writeCache(getSession: () => OverrideStorage | null, now: number, items: SurfaceItem[]): void {
	try {
		getSession()?.setItem(CACHE_KEY, JSON.stringify({ at: now, items }));
	} catch {
		/* no cache */
	}
}

export function clearCache(getSession: () => OverrideStorage | null): void {
	try {
		getSession()?.removeItem(CACHE_KEY);
	} catch {
		/* no cache */
	}
}

export interface ResolveInputs {
	search: string;
	getStorage: () => OverrideStorage | null;
	/** Per-tab cache storage (sessionStorage). Default: none. */
	getSession?: () => OverrideStorage | null;
	now?: () => number;
	/** False while the page is unloading: a fetch cut off by navigation must not cache "no". */
	canCache?: () => boolean;
	/** This page's origin; manifest links to it are allowed. */
	pageOrigin: string;
	manifestUrl?: string;
	tailnetUrl?: string;
	fixtureEnabled?: boolean;
	loadFixture?: () => Promise<SurfaceItem[]>;
	fetchSeams?: FetchSeams;
}

/** The tailnet manifest address for a build-time probe URL, or '' when unusable. */
export function tailnetManifestUrl(probeUrl: string): string {
	if (!probeUrl) return '';
	try {
		const url = new URL(probeUrl);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
		return new URL('/v1/surface', url.origin).href;
	} catch {
		return '';
	}
}

/**
 * The visitor's gated items. Resolves to [] on any failure; never rejects.
 * Override first (a build flag and ?flags=membership), else the members
 * manifest and, when the build set one, the tailnet manifest, concurrently.
 */
export async function resolveSurface({
	search,
	getStorage,
	pageOrigin,
	manifestUrl = MANIFEST_URL,
	tailnetUrl = TAILNET_PROBE_URL,
	fixtureEnabled = FIXTURE_ENABLED,
	loadFixture,
	fetchSeams,
	getSession = () => null,
	now = Date.now,
	canCache = () => true,
}: ResolveInputs): Promise<SurfaceItem[]> {
	// An explicit ?flags= request starts from a clean slate.
	try {
		const requested = new URLSearchParams(search).get('flags');
		if (requested === 'membership' || requested === 'none') {
			clearCache(getSession);
			try {
				getSession()?.removeItem(TAILNET_CACHE_KEY);
			} catch {
				/* no cache */
			}
		}
	} catch {
		/* no request */
	}
	try {
		if (fixtureEnabled && loadFixture && readOverride(search, getStorage)) return await loadFixture();
	} catch {
		return [];
	}
	// The one request this resolver makes on its own: the members manifest. The
	// tailnet is never asked here. A cached tailnet answer's items may be in the
	// cache, so that origin is allowed when reading it back.
	const tailnetOrigin = originOf(tailnetManifestUrl(tailnetUrl));
	const memberOrigin = originOf(manifestUrl);
	const cacheOrigins = [
		pageOrigin,
		SITE_ORIGIN,
		...(memberOrigin ? [memberOrigin] : []),
		...(tailnetOrigin ? [tailnetOrigin] : []),
	];
	const cached = readCache(getSession, now(), cacheOrigins);
	if (cached) return cached;
	const items = await fetchManifest(
		manifestUrl,
		[pageOrigin, SITE_ORIGIN, ...(memberOrigin ? [memberOrigin] : [])],
		'include',
		fetchSeams,
	);
	if (canCache()) writeCache(getSession, now(), items);
	return items;
}

/** sessionStorage key for the per-tab tailnet answer. */
export const TAILNET_CACHE_KEY = 'gftb:tailnet-probe';

/** The tailnet probe may wait on the browser's local-network permission prompt. */
export const TAILNET_PROBE_TIMEOUT_MS = 10_000;

export type TailnetOutcome = {
	/** "no" covers a blocked request, a denied permission, a timeout and any non-true answer. */
	answer: 'yes' | 'no';
	/** The member links the tailnet (or, failing that, the Access manifest) served; empty when none. */
	items: SurfaceItem[];
};

/**
 * True only for an answer of exactly `true`, bare or as `{ tailnet: true }`,
 * from a 200 JSON response. Fails closed; never rejects.
 */
export async function probeTailnet(probeUrl: string, seams: FetchSeams = {}): Promise<boolean> {
	const {
		fetchImpl = (input, init) => fetch(input, init),
		timeoutMs = TAILNET_PROBE_TIMEOUT_MS,
		setTimer = (callback, ms) => setTimeout(callback, ms),
		clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	} = seams;
	if (!probeUrl) return false;
	const controller = new AbortController();
	let timer: unknown;
	try {
		timer = setTimer(() => controller.abort(), timeoutMs);
		const timedOut = new Promise<never>((_, reject) => {
			controller.signal.addEventListener('abort', () => reject(new Error('timeout')));
		});
		const work = (async () => {
			const response = await fetchImpl(probeUrl, {
				method: 'GET',
				credentials: 'omit',
				redirect: 'manual',
				cache: 'no-store',
				referrerPolicy: 'no-referrer',
				signal: controller.signal,
			});
			if (response.status !== 200) return false;
			if (!/^application\/json\s*(?:;|$)/iu.test(response.headers.get('content-type') ?? '')) return false;
			const body: unknown = await response.json();
			return (
				body === true || (typeof body === 'object' && body !== null && (body as { tailnet?: unknown }).tailnet === true)
			);
		})();
		return await Promise.race([work, timedOut]);
	} catch {
		return false;
	} finally {
		clearTimer(timer);
	}
}

export interface TailnetInputs {
	probeUrl: string;
	pageOrigin: string;
	manifestUrl?: string;
	getSession?: () => OverrideStorage | null;
	now?: () => number;
	fetchSeams?: FetchSeams;
	/** Ignore the cached answer (the "check again" button). */
	force?: boolean;
}

/** The per-tab tailnet answer: a "no" lasts the tab, a "yes" the short TTL. */
export function readTailnetCache(getSession: () => OverrideStorage | null, now: number): 'yes' | 'no' | null {
	try {
		const raw = getSession()?.getItem(TAILNET_CACHE_KEY);
		if (!raw) return null;
		const entry = JSON.parse(raw) as { at?: unknown; answer?: unknown };
		if (typeof entry.at !== 'number') return null;
		if (entry.answer === 'no') return 'no';
		if (entry.answer === 'yes' && now - entry.at >= 0 && now - entry.at < CACHE_YES_TTL_MS) return 'yes';
		return null;
	} catch {
		return null;
	}
}

function writeTailnetCache(getSession: () => OverrideStorage | null, now: number, answer: 'yes' | 'no'): void {
	try {
		getSession()?.setItem(TAILNET_CACHE_KEY, JSON.stringify({ at: now, answer }));
	} catch {
		/* no cache */
	}
}

/**
 * The footer button's action, run only after the visitor confirms in the modal.
 * Probes the tailnet; a yes then asks the tailnet origin's /v1/surface for the
 * member links and, if it does not serve one, the Access manifest. Any failure
 * is "no". Never rejects. A yes stores its links in the shared outcome cache,
 * so the rest of this tab shows them without another request.
 */
export async function checkTailnet({
	probeUrl,
	pageOrigin,
	manifestUrl = MANIFEST_URL,
	getSession = () => null,
	now = Date.now,
	fetchSeams,
	force = false,
}: TailnetInputs): Promise<TailnetOutcome> {
	if (!force) {
		const cached = readTailnetCache(getSession, now());
		if (cached === 'no') return { answer: 'no', items: [] };
		if (cached === 'yes') {
			const origin = originOf(tailnetManifestUrl(probeUrl));
			const items = readCache(getSession, now(), [
				pageOrigin,
				SITE_ORIGIN,
				...(origin ? [origin] : []),
				...(originOf(manifestUrl) ?? []),
			]);
			if (items) return { answer: 'yes', items };
		}
	}
	if (!(await probeTailnet(probeUrl, fetchSeams))) {
		writeTailnetCache(getSession, now(), 'no');
		return { answer: 'no', items: [] };
	}
	const surfaceUrl = tailnetManifestUrl(probeUrl);
	const surfaceOrigin = originOf(surfaceUrl);
	let items = surfaceUrl
		? await fetchManifest(
				surfaceUrl,
				[pageOrigin, SITE_ORIGIN, ...(surfaceOrigin ? [surfaceOrigin] : [])],
				'omit',
				fetchSeams,
			)
		: [];
	if (items.length === 0) {
		const memberOrigin = originOf(manifestUrl);
		items = await fetchManifest(
			manifestUrl,
			[pageOrigin, SITE_ORIGIN, ...(memberOrigin ? [memberOrigin] : [])],
			'include',
			fetchSeams,
		);
	}
	writeTailnetCache(getSession, now(), 'yes');
	writeCache(getSession, now(), items);
	return { answer: 'yes', items };
}
