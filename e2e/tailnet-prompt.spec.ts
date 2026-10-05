import type { Page, Route } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { MANIFEST_URL } from '../src/lib/gated/manifest';
import { MEMBER_MANIFEST, installExternalGuard, stubChallenge } from './support/network';
import { skipHomeIntro } from './support/intro';

// The footer button that asks whether you are on the tool bus network
// (operator ruling 2026-10-05, src/lib/components/TailnetPrompt.svelte). The
// site never probes on page load: the probe runs only from the modal's own
// button. These rows mock the probe: yes, no and blocked. The build under test
// is stamped with the probe URL below (the Justfile default).

const PROBE_URL = 'https://gftb-probe.taila4c78d.ts.net/v1/tailnet';
const SURFACE_URL = 'https://gftb-probe.taila4c78d.ts.net/v1/surface';
const PROBE_HOST = 'gftb-probe.taila4c78d.ts.net';

function cors(route: Route): Record<string, string> {
	return { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost' };
}

async function probeAnswers(page: Page, answer: unknown | 'blocked', surface: unknown | 'none' = 'none') {
	await page.route(PROBE_URL, (route) =>
		answer === 'blocked'
			? route.abort('blockedbyclient')
			: route.fulfill({
					status: 200,
					contentType: 'application/json',
					headers: cors(route),
					body: JSON.stringify(answer),
				}),
	);
	await page.route(SURFACE_URL, (route) =>
		surface === 'none'
			? route.fulfill({ status: 404, contentType: 'application/json', headers: cors(route), body: '{}' })
			: route.fulfill({
					status: 200,
					contentType: 'application/json',
					headers: cors(route),
					body: JSON.stringify(surface),
				}),
	);
}

/** Guards the network, records every request to the probe host, and loads `path`. */
async function open(page: Page, baseUrl: string, path = '/') {
	const probed: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).host === PROBE_HOST) probed.push(`${request.method()} ${request.url()}`);
	});
	await installExternalGuard(page, baseUrl);
	await stubChallenge(page);
	return { probed, goto: () => page.goto(path).then(() => page.waitForLoadState('networkidle')) };
}

const button = (page: Page) => page.getByTestId('tailnet-open');
const dialog = (page: Page) => page.getByTestId('tailnet-dialog');
const member = (page: Page) => page.locator('footer').getByRole('link', { name: /^Member sign in/u });

test.beforeEach(async ({ page }) => {
	await skipHomeIntro(page);
});

test('page load never touches the probe, on any page, and the button is public', async ({ page, baseUrl }) => {
	for (const path of ['/', '/join/', '/contact', '/log']) {
		const run = await open(page, baseUrl, path);
		await run.goto();
		await expect(button(page), path).toHaveCount(1);
		await expect(button(page), path).toHaveText('On the tool bus network?');
		await expect(page.locator('footer').locator('li:empty')).toHaveCount(0);
		expect(run.probed, `${path} asked the probe on load`).toEqual([]);
		await page.unrouteAll();
		page.removeAllListeners('request');
	}
});

test('opening the modal explains the permission prompt and still asks nothing', async ({ page, baseUrl }) => {
	const run = await open(page, baseUrl);
	await probeAnswers(page, { tailnet: true });
	await run.goto();
	await button(page).click();
	await expect(dialog(page)).toBeVisible();
	await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText('On the tool bus network?');
	await expect(dialog(page)).toContainText(
		'your browser will ask for permission to connect to devices on your local network',
	);
	await expect(dialog(page).getByTestId('tailnet-check')).toHaveText('Check the network');
	expect(run.probed, 'opening the modal asked the probe').toEqual([]);
	await page.keyboard.press('Escape');
	await expect(dialog(page)).toHaveCount(0);
	expect(run.probed).toEqual([]);
});

test('yes: the member links mount, the button goes, and the answer holds for the tab', async ({ page, baseUrl }) => {
	const run = await open(page, baseUrl);
	await probeAnswers(page, { tailnet: true }, MEMBER_MANIFEST);
	await run.goto();
	await expect(member(page)).toHaveCount(0);
	await button(page).click();
	await dialog(page).getByTestId('tailnet-check').click();
	await expect(dialog(page).getByTestId('tailnet-result')).toHaveText(
		'You are on the tool bus network. The member links are now shown.',
	);
	expect(run.probed).toEqual([`GET ${PROBE_URL}`, `GET ${SURFACE_URL}`]);
	await dialog(page).getByRole('button', { name: 'Close' }).click();
	await expect(member(page)).toHaveCount(1);
	await expect(
		page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' }),
	).toHaveCount(1);
	await expect(button(page)).toHaveCount(0);

	// A reload in the same tab shows the links from the tab's cache and asks no probe.
	run.probed.length = 0;
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(member(page)).toHaveCount(1);
	expect(run.probed, 'a reload asked the probe').toEqual([]);
});

test('yes with no surface served falls back to the Access manifest', async ({ page, baseUrl }) => {
	const run = await open(page, baseUrl);
	await probeAnswers(page, true);
	await page.route(MANIFEST_URL, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { ...cors(route), 'access-control-allow-credentials': 'true' },
			body: JSON.stringify(MEMBER_MANIFEST),
		}),
	);
	await run.goto();
	await button(page).click();
	await dialog(page).getByTestId('tailnet-check').click();
	await expect(dialog(page).getByTestId('tailnet-result')).toContainText('The member links are now shown.');
	await dialog(page).getByRole('button', { name: 'Close' }).click();
	await expect(member(page)).toHaveCount(1);
});

test('yes with nothing to show says so and mounts nothing', async ({ page, baseUrl }) => {
	const run = await open(page, baseUrl);
	await probeAnswers(page, true);
	await run.goto();
	await button(page).click();
	await dialog(page).getByTestId('tailnet-check').click();
	await expect(dialog(page).getByTestId('tailnet-result')).toHaveText(
		'You are on the tool bus network, but there are no member links to show yet.',
	);
	await expect(member(page)).toHaveCount(0);
});

for (const [label, answer] of [
	['a false answer', { tailnet: false }],
	['a non-true answer', { tailnet: 'yes' }],
	['a blocked or denied request', 'blocked'],
] as const) {
	test(`no: ${label} shows a short neutral message and mounts nothing`, async ({ page, baseUrl }) => {
		const run = await open(page, baseUrl);
		await probeAnswers(page, answer, MEMBER_MANIFEST);
		await run.goto();
		await button(page).click();
		await dialog(page).getByTestId('tailnet-check').click();
		await expect(dialog(page).getByTestId('tailnet-result')).toHaveText(
			'We could not confirm that you are on the tool bus network. Nothing has changed.',
		);
		await expect(dialog(page).getByTestId('tailnet-check')).toHaveText('Check again');
		await expect(member(page)).toHaveCount(0);
		await expect(
			page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' }),
		).toHaveCount(0);
		expect(run.probed.filter((entry) => entry.includes(SURFACE_URL))).toEqual([]);

		// The "no" is remembered for the tab: a reload does not ask again.
		await dialog(page).getByRole('button', { name: 'Close' }).click();
		run.probed.length = 0;
		await page.reload();
		await page.waitForLoadState('networkidle');
		expect(run.probed, 'a reload asked the probe').toEqual([]);
	});
}

for (const width of [320, 1280]) {
	test(`anonymous layout is unchanged by the button and a no answer at ${width}px`, async ({ page, baseUrl }) => {
		await page.setViewportSize({ width, height: 800 });
		const run = await open(page, baseUrl);
		await probeAnswers(page, { tailnet: false });
		await run.goto();
		const measure = () =>
			page.evaluate(() => {
				const box = (selector: string) => {
					const rect = document.querySelector(selector)?.getBoundingClientRect();
					return rect ? [rect.left, rect.top, rect.width, rect.height].map(Math.round) : null;
				};
				return {
					header: box('.site-header'),
					nav: Array.from(document.querySelectorAll('.site-nav a')).map((a) => a.textContent?.trim()),
					overflow: document.documentElement.scrollWidth - window.innerWidth,
				};
			});
		const before = await measure();
		expect(before.overflow).toBeLessThanOrEqual(0);
		expect(before.nav).not.toContain('Join');
		await button(page).click();
		await dialog(page).getByTestId('tailnet-check').click();
		await expect(dialog(page).getByTestId('tailnet-result')).toBeVisible();
		await dialog(page).getByRole('button', { name: 'Close' }).click();
		await expect(dialog(page)).toHaveCount(0);
		expect(await measure()).toEqual(before);
		// The button sits inside the footer, within the viewport.
		const box = await button(page).boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);
	});
}

test.describe('without scripts', () => {
	test.use({ javaScriptEnabled: false });

	test('there is no button and no probe address in the served HTML', async ({ page, request }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'On the tool bus network?' })).toHaveCount(0);
		const html = await (await request.get('/')).text();
		expect(html).not.toContain(PROBE_HOST);
		expect(html).not.toContain('On the tool bus network');
	});
});
