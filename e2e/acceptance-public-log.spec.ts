import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const published = [
	{ slug: '2026-09-07-alex-the-wheel-maven', title: 'Alex the wheel maven grinding away' },
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
	'2026-08-14-the-system-in-diagrams',
	'2026-08-15-waterproofing-seats-and-a-wants-list',
	'2026-08-16-public-front-door',
	'2026-08-17-starting-a-real-public-log',
	'2026-08-18-how-the-membership-system-is-shaped',
	'2026-08-19-site-went-public-with-the-new-palette',
	'2026-08-20-membership-system-taking-shape',
] as const;

test('an entry whose summary equals its title prints the title once', async ({ page }) => {
	// Operator ruling 2026-08-30 (density): the 2026-08-11 summary is
	// byte-identical to its title; the archive row must not print it twice.
	await page.goto('/log');
	const row = page.locator('.log-list li', { has: page.locator('a[href="/log/2026-08-11-how-tools-will-move"]') });
	await expect(row).toHaveCount(1);
	const text = (await row.innerText()).split('Sweet semaphores and lore').length - 1;
	expect(text).toBe(1);
});

test('the public log exposes exactly the approved batch, newest first', async ({ page }) => {
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

const imagedEntries = [
	{
		slug: '2026-09-07-alex-the-wheel-maven',
		src: '/photos/log/2026-09-07-alex-the-wheel-maven-1280.webp',
		alt: 'Alex kneeling on the ridged bus floor in ear defenders and safety glasses, an angle grinder throwing sparks at the foot of a grey seat frame',
	},
	{
		slug: '2026-08-11-how-tools-will-move',
		src: '/photos/log/2026-08-11-how-tools-will-move-1280.webp',
		alt: 'Looking down the aisle of the bus interior with a bicycle strapped in the wheelchair bay',
	},
] as const;
const imagelessEntry = published.find((entry) => !imagedEntries.some((imaged) => imaged.slug === entry.slug))!;

test('only the imaged entries render featured-image markup on /log', async ({ page }) => {
	// The published entries with an `image` (2026-08-11 from the 2026-09-01
	// curation, 2026-09-07 from the operator's own batch): each archive row
	// pins src, alt and sharp corners. Every other row keeps the honest empty
	// state — no <img>, no <figure>, no reserved box — so the zeros survive as
	// an exact count.
	await page.goto('/log');
	await expect(page.locator('.log-list li')).toHaveCount(published.length);
	await expect(page.locator('.log-list img')).toHaveCount(imagedEntries.length);
	await expect(page.locator('.featured-image')).toHaveCount(imagedEntries.length);
	for (const imaged of imagedEntries) {
		const row = page.locator('.log-list li', { has: page.locator(`a[href="/log/${imaged.slug}"]`) });
		const thumb = row.locator('.featured-image img');
		await expect(thumb).toHaveAttribute('src', imaged.src);
		await expect(thumb).toHaveAttribute('alt', imaged.alt);
		await expect(thumb).toHaveCSS('border-radius', '0px');
	}
});

for (const imaged of imagedEntries) {
	test(`${imaged.slug} renders its hero between header and body`, async ({ page }) => {
		await page.goto(`/log/${imaged.slug}`);
		const hero = page.locator('.log-entry .featured-image img');
		await expect(hero).toHaveAttribute('src', imaged.src);
		await expect(hero).toHaveAttribute('alt', imaged.alt);
	});

	test(`${imaged.slug}'s photo is served from the static carrier`, async ({ request }) => {
		const response = await request.get(imaged.src);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('image/webp');
	});
}

test('imageless permalinks render no hero between header and body', async ({ page }) => {
	await page.goto(`/log/${imagelessEntry.slug}`);
	await expect(page.locator('.log-entry .featured-image')).toHaveCount(0);
});

test('the retired public diagram assets are no longer served', async ({ request }) => {
	for (const name of [
		'inventory-custody-flow.svg',
		'release-proof-flow-public.svg',
		'launch-authority-flow-public.svg',
	]) {
		const response = await request.get(`/diagrams/launch-member-v0/${name}`);
		expect(response.status(), name).toBe(404);
	}
});

test('removed entries stay deleted and the remaining draft stays unpublished', async ({ page }) => {
	for (const slug of removed) {
		expect(existsSync(path.join(repoRoot, 'src', 'content', 'log', `${slug}.svx`)), slug).toBe(false);
		const response = await page.goto(`/log/${slug}`);
		expect(response?.status(), slug).toBe(404);
	}
	const response = await page.goto('/log/2026-08-21-the-road-map-plainly');
	expect(response?.status()).toBe(404);
});
