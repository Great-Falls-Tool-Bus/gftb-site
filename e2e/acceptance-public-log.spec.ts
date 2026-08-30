import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const published = [
	{
		slug: '2026-08-14-the-system-in-diagrams',
		title: 'We laugh, we graph, we diagramming the system',
	},
	{
		slug: '2026-08-13-networking-options-for-the-bus',
		title: 'Sizing up networkies for the bus',
	},
	{ slug: '2026-08-11-how-tools-will-move', title: 'Sweet semaphores and lore' },
	{
		slug: '2026-08-06-drafts-out-and-a-scope-expansion',
		title: 'Hello world, ala 5th Pillar tea house; drafts out for markup',
	},
] as const;

const removed = [
	'2026-08-15-waterproofing-seats-and-a-wants-list',
	'2026-08-16-public-front-door',
	'2026-08-17-starting-a-real-public-log',
	'2026-08-18-how-the-membership-system-is-shaped',
	'2026-08-19-site-went-public-with-the-new-palette',
	'2026-08-20-membership-system-taking-shape',
] as const;

test('the public log exposes exactly the approved four-entry batch', async ({ page }) => {
	await page.goto('/log');
	const links = page.locator('.log-list h3 a');
	await expect(links).toHaveCount(published.length);
	for (const [index, entry] of published.entries()) {
		await expect(links.nth(index)).toHaveText(entry.title);
		await expect(links.nth(index)).toHaveAttribute('href', `/log/${entry.slug}`);
	}
});

for (const entry of published) {
	test(`${entry.slug} renders its approved title`, async ({ page }) => {
		const response = await page.goto(`/log/${entry.slug}`);
		expect(response?.status()).toBe(200);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.title);
	});
}

test('the approved public diagrams are served from the static carrier', async ({ request }) => {
	for (const name of [
		'inventory-custody-flow.svg',
		'release-proof-flow-public.svg',
		'launch-authority-flow-public.svg',
	]) {
		const response = await request.get(`/diagrams/launch-member-v0/${name}`);
		expect(response.status(), name).toBe(200);
	}
});

test('the diagram post exposes full-size affordances at mobile width', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/log/2026-08-14-the-system-in-diagrams');
	for (const [name, href] of [
		[
			'Open the full-size inventory custody diagram',
			'/diagrams/launch-member-v0/inventory-custody-flow.svg',
		],
		[
			'Open the full-size release proof diagram',
			'/diagrams/launch-member-v0/release-proof-flow-public.svg',
		],
		[
			'Open the full-size launch authority diagram',
			'/diagrams/launch-member-v0/launch-authority-flow-public.svg',
		],
	] as const) {
		const link = page.getByRole('link', { name });
		await expect(link).toBeVisible();
		await link.scrollIntoViewIfNeeded();
		await expect(link).toBeInViewport();
		await expect(link).toHaveAttribute('href', href);
	}
});

test('removed entries stay deleted and the remaining draft stays unpublished', async ({ page }) => {
	for (const slug of removed) {
		expect(existsSync(path.join(repoRoot, 'src', 'content', 'log', `${slug}.svx`)), slug).toBe(false);
	}
	const response = await page.goto('/log/2026-08-21-the-road-map-plainly');
	expect(response?.status()).toBe(404);
});
