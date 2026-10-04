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
// (b) the tailnet origin's /v1/surface, only when the build sets
//     PUBLIC_TAILNET_PROBE_URL (empty by default, so a public build carries no
//     tailnet hostname or address);
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

export interface ResolveInputs {
	search: string;
	getStorage: () => OverrideStorage | null;
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
}: ResolveInputs): Promise<SurfaceItem[]> {
	try {
		if (fixtureEnabled && loadFixture && readOverride(search, getStorage)) return await loadFixture();
	} catch {
		return [];
	}
	const sources: Array<{ url: string; credentials: RequestCredentials }> = [
		{ url: manifestUrl, credentials: 'include' },
	];
	const tailnet = tailnetManifestUrl(tailnetUrl);
	if (tailnet) sources.push({ url: tailnet, credentials: 'omit' });
	const pending = sources.map(({ url, credentials }) => {
		const sourceOrigin = originOf(url);
		const allowed = [pageOrigin, SITE_ORIGIN, ...(sourceOrigin ? [sourceOrigin] : [])];
		return fetchManifest(url, allowed, credentials, fetchSeams).then((items) =>
			items.length > 0 ? items : Promise.reject(new Error('empty')),
		);
	});
	try {
		return await firstFulfilled(pending);
	} catch {
		return [];
	}
}

/** Resolves with the first fulfilled promise; rejects when every one rejects. */
function firstFulfilled<T>(promises: Promise<T>[]): Promise<T> {
	return new Promise((resolve, reject) => {
		let remaining = promises.length;
		if (remaining === 0) reject(new Error('no sources'));
		for (const promise of promises) {
			promise.then(resolve, () => {
				remaining -= 1;
				if (remaining === 0) reject(new Error('all failed'));
			});
		}
	});
}
