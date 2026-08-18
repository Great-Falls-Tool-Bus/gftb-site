import type { Page, Route } from '@playwright/test';

/**
 * Shared network harness for the acceptance specs.
 *
 * The published page talks to exactly one third party: the separately owned
 * `forms.latoolb.us` contact API. These specs never touch it. Everything
 * off-origin is intercepted here, so a run cannot reach a live endpoint, and so
 * "no console errors" means the page's own behaviour rather than the weather.
 */

export const FORM_ORIGIN = 'https://forms.latoolb.us';
export const CONTACT_URL = `${FORM_ORIGIN}/api/contact`;
export const CHALLENGE_URL = `${FORM_ORIGIN}/api/challenge`;

/** A pre-solved ALTCHA challenge: sha256('test7'), so the widget finishes fast. */
export const SOLVABLE_CHALLENGE = {
	algorithm: 'SHA-256',
	challenge: 'bd7c911264aae15b66d4291b6850829aa96986b1d3ead34d1fdbfef27056c112',
	salt: 'test',
	signature: 'a'.repeat(64),
	maxnumber: 50,
};

export interface ExternalGuard {
	/** Every off-origin URL the page tried to reach, in request order. */
	readonly attempted: string[];
}

function isSameOrigin(url: string, baseURL: string): boolean {
	try {
		return new URL(url).origin === new URL(baseURL).origin;
	} catch {
		return false;
	}
}

/**
 * Aborts every off-origin request that no other route has already claimed.
 * Install it first; more specific routes registered later take precedence
 * because Playwright matches routes in reverse registration order.
 */
export async function installExternalGuard(page: Page, baseURL: string): Promise<ExternalGuard> {
	const attempted: string[] = [];
	await page.route('**/*', async (route: Route) => {
		const url = route.request().url();
		if (isSameOrigin(url, baseURL) || url.startsWith('data:') || url.startsWith('blob:')) {
			await route.continue();
			return;
		}
		attempted.push(url);
		await route.abort('blockedbyclient');
	});
	return { attempted };
}

/** Serves the ALTCHA challenge locally so the widget can verify without a live endpoint. */
export async function stubChallenge(
	page: Page,
	body: unknown = SOLVABLE_CHALLENGE,
	status = 200,
	origin?: string,
): Promise<void> {
	await page.route(CHALLENGE_URL, async (route) => {
		await route.fulfill({
			status,
			contentType: 'application/json',
			headers: {
				'access-control-allow-origin': origin ?? new URL(route.request().headers().origin ?? 'http://localhost').origin,
			},
			body: JSON.stringify(body),
		});
	});
}

export interface ContactCapture {
	/** Parsed JSON bodies of every POST the page made to the contact endpoint. */
	readonly payloads: Array<Record<string, unknown>>;
	/** Raw request headers for each POST, lowercased by Playwright. */
	readonly headers: Array<Record<string, string>>;
}

export interface ContactStubOptions {
	status?: number;
	/**
	 * Value for `Access-Control-Allow-Origin`. `'exact'` echoes the requesting
	 * origin (what an exact-origin CORS policy does for an allowed caller);
	 * any other string is sent verbatim, which lets a spec prove the browser
	 * rejects a response addressed to a different origin.
	 */
	allowOrigin?: 'exact' | 'omit' | string;
	body?: unknown;
	/** Abort instead of answering, standing in for an endpoint that is down. */
	abort?: boolean;
}

export async function stubContactEndpoint(page: Page, options: ContactStubOptions = {}): Promise<ContactCapture> {
	const payloads: Array<Record<string, unknown>> = [];
	const headers: Array<Record<string, string>> = [];

	await page.route(CONTACT_URL, async (route) => {
		const request = route.request();

		// A JSON POST is not a simple request, so the browser preflights it. The
		// preflight answer is where an exact-origin policy is actually enforced.
		if (request.method() === 'OPTIONS') {
			const preflightOrigin = request.headers().origin ?? '';
			const allowed = options.allowOrigin ?? 'exact';
			const preflightHeaders: Record<string, string> = {
				'access-control-allow-methods': 'POST, OPTIONS',
				'access-control-allow-headers': 'content-type',
				'access-control-max-age': '0',
			};
			if (allowed === 'exact') preflightHeaders['access-control-allow-origin'] = preflightOrigin;
			else if (allowed !== 'omit') preflightHeaders['access-control-allow-origin'] = allowed;
			await route.fulfill({ status: 204, headers: preflightHeaders, body: '' });
			return;
		}

		headers.push(request.headers());
		try {
			payloads.push(JSON.parse(request.postData() ?? '{}'));
		} catch {
			payloads.push({ unparseableBody: request.postData() ?? '' });
		}

		if (options.abort) {
			await route.abort('connectionrefused');
			return;
		}

		const requestOrigin = request.headers().origin ?? '';
		const allow = options.allowOrigin ?? 'exact';
		const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
		if (allow === 'exact') responseHeaders['access-control-allow-origin'] = requestOrigin;
		else if (allow !== 'omit') responseHeaders['access-control-allow-origin'] = allow;

		await route.fulfill({
			status: options.status ?? 200,
			headers: responseHeaders,
			body: JSON.stringify(options.body ?? { ok: true }),
		});
	});

	return { payloads, headers };
}
