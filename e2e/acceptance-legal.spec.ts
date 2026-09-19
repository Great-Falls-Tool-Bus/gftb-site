// The /legal route (operator ruling 2026-09-19): the club's agreements as the
// compiled PDFs themselves, fetched into the build by pinned URL and sha256,
// embedded with a plain link fallback. The page sweeps do not visit this
// route, so it carries its own radius and right-edge rows.
import { expect, test } from '@playwright/test';

const documents = [
	{ id: 'member-agreement', file: '/agreements/member-agreement-v1.pdf', title: 'Member Agreement, Version 1' },
	{ id: 'code-of-conduct', file: '/agreements/code-of-conduct.pdf', title: 'Code of Conduct' },
] as const;

for (const doc of documents) {
	test(`${doc.id} serves as a PDF from the static carrier`, async ({ request }) => {
		const response = await request.get(doc.file);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('application/pdf');
		expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
	});
}

test('the legal page embeds both documents with link fallbacks and keeps the rails', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.goto('/legal');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Legal');
	for (const doc of documents) {
		const section = page.locator(`#${doc.id}`);
		await expect(section.getByRole('heading', { level: 2 })).toHaveText(doc.title);
		const embed = section.locator('object[type="application/pdf"]');
		await expect(embed).toHaveAttribute('data', doc.file);
		await expect(embed.locator(`a[href="${doc.file}"]`)).toHaveCount(1);
		await expect(section.locator(`a[download][href="${doc.file}"]`)).toHaveCount(1);
	}
	// No status line by ruling: nothing on the page calls a document a draft or adopted.
	await expect(page.locator('.log-entry__body')).not.toContainText(/draft|adopted|ratified|in force/iu);
	const rounded = await page.evaluate(() =>
		[...document.querySelectorAll('body *')]
			.filter((el) => getComputedStyle(el).borderRadius !== '0px')
			.map((el) => el.tagName + '.' + el.className),
	);
	expect(rounded).toEqual([]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the footer and the sitemap carry the legal route', async ({ page, request }) => {
	await page.goto('/');
	await expect(page.locator('footer a[href="/legal"]')).toHaveText('Legal');
	const sitemap = await request.get('/sitemap.xml');
	expect(await sitemap.text()).toContain('<loc>https://greatfallstoolbus.org/legal/</loc>');
});
