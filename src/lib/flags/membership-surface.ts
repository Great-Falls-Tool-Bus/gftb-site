// The membership surface flag (operator rulings 2026-10-03).
//
// Ruling 1, on Sign in: "show it only on tailnet, add tailnet detection (or,
// only show if cf access already logged in; either shows the sign in)".
// Ruling 2, widening it: "all the buttons / membership / join button in
// header etc should conditionally show only on tailnet and/or CF access
// logged in; feature flag style."
//
// One boolean, membershipSurface, default OFF and OFF without scripts. Every
// membership link or button (header Join, the FAQ Apply and Member sign in
// row, the "How membership works" links, the footer Join and Member sign in
// rows, and the /join page's own Apply and Sign in) carries the
// .membership-surface class. app.css keeps that class at visibility: hidden,
// which reserves its space (nothing moves when it appears) and keeps it out
// of the tab order and the accessibility tree, until the root carries
// data-membership-surface="on". The FAQ prose stays public; only links and
// buttons hide.
//
// The flag turns ON when any one source says so:
// (a) Access session: the member app's whole host sits behind Cloudflare
//     Access, and greatfallstoolbus.org is the same site, so the Access
//     session cookie rides along with an image request. The member app's
//     favicon loads only for someone already signed in to Access; anyone else
//     gets the Access login page (HTML), which an image cannot decode.
// (b) Tailnet: an image probe of PUBLIC_TAILNET_PROBE_URL, read at build
//     time. It defaults to empty, and empty skips the probe, so a public
//     build carries no tailnet hostname or address unless the operator sets
//     that variable for the build.
// (c) Preview override: ?flags=membership stores a localStorage key so a
//     reviewer can see the surface; ?flags=none clears it. Storage failures
//     count as "no override".
//
// Probes use a cache-busting query and a short timeout, log nothing, and
// resolve false on error or timeout.

import { MEMBER_APP_ORIGIN } from '../membership';

/** The root attribute app.css keys the membership surface on. */
export const MEMBERSHIP_SURFACE_ATTR = 'data-membership-surface';

/** The class every gated membership link or button carries. */
export const MEMBERSHIP_SURFACE_CLASS = 'membership-surface';

/** localStorage key for the preview override. */
export const MEMBERSHIP_OVERRIDE_KEY = 'gftb:flags:membership';

/** A small static image the member app serves behind Access (its favicon). */
export const ACCESS_PROBE_URL = `${MEMBER_APP_ORIGIN}/favicon.svg`;

/** Build-time tailnet probe URL; empty unless PUBLIC_TAILNET_PROBE_URL is set. */
export const TAILNET_PROBE_URL: string = typeof __TAILNET_PROBE_URL__ === 'string' ? __TAILNET_PROBE_URL__.trim() : '';

/** How long a probe may take before it counts as "no". */
export const PROBE_TIMEOUT_MS = 4000;

/** The part of HTMLImageElement a probe uses. */
export interface ProbeImage {
	onload: (() => void) | null;
	onerror: (() => void) | null;
	src: string;
}

export interface ProbeSeams {
	makeImage?: () => ProbeImage;
	now?: () => number;
	timeoutMs?: number;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/** The part of Storage the override uses. */
export interface OverrideStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** `url` with a cache-busting query appended. */
export function bustCache(url: string, stamp: number): string {
	return `${url}${url.includes('?') ? '&' : '?'}flag-probe=${stamp}`;
}

/** Resolves true only when the image at `url` loads. Never rejects. */
export function probeImage(url: string, seams: ProbeSeams = {}): Promise<boolean> {
	const {
		makeImage = () => new Image() as unknown as ProbeImage,
		now = Date.now,
		timeoutMs = PROBE_TIMEOUT_MS,
		setTimer = (callback, ms) => setTimeout(callback, ms),
		clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	} = seams;
	return new Promise((resolve) => {
		let settled = false;
		let timer: unknown;
		let image: ProbeImage | undefined;
		const settle = (on: boolean) => {
			if (settled) return;
			settled = true;
			clearTimer(timer);
			if (image) {
				image.onload = null;
				image.onerror = null;
			}
			resolve(on);
		};
		try {
			const made: ProbeImage = makeImage();
			image = made;
			timer = setTimer(() => settle(false), timeoutMs);
			made.onload = () => settle(true);
			made.onerror = () => settle(false);
			made.src = bustCache(url, now());
		} catch {
			settle(false);
		}
	});
}

/**
 * Applies a `?flags=` request to storage and reports whether the override is
 * set. `membership` sets it, `none` clears it, anything else leaves it.
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
		if (requested === 'membership') storage.setItem(MEMBERSHIP_OVERRIDE_KEY, 'on');
		else if (requested === 'none') storage.removeItem(MEMBERSHIP_OVERRIDE_KEY);
		return storage.getItem(MEMBERSHIP_OVERRIDE_KEY) === 'on';
	} catch {
		return requested === 'membership';
	}
}

export interface ResolveInputs {
	search: string;
	getStorage: () => OverrideStorage | null;
	tailnetUrl?: string;
	probe?: (url: string) => Promise<boolean>;
}

/** The single boolean: override, then the Access and tailnet probes. */
export async function resolveMembershipSurface({
	search,
	getStorage,
	tailnetUrl = TAILNET_PROBE_URL,
	probe = (url) => probeImage(url),
}: ResolveInputs): Promise<boolean> {
	if (readOverride(search, getStorage)) return true;
	const probes = [probe(ACCESS_PROBE_URL)];
	if (tailnetUrl) probes.push(probe(tailnetUrl));
	const results = await Promise.all(probes.map((pending) => pending.catch(() => false)));
	return results.some(Boolean);
}

/** Resolves the flag and marks the root when it is on. Never throws. */
export async function applyMembershipSurface(
	root: { setAttribute(name: string, value: string): void },
	inputs: ResolveInputs,
): Promise<boolean> {
	let on: boolean;
	try {
		on = await resolveMembershipSurface(inputs);
	} catch {
		on = false;
	}
	if (on) root.setAttribute(MEMBERSHIP_SURFACE_ATTR, 'on');
	return on;
}
