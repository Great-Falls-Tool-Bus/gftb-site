import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

test('mobile public front door exposes current status and working anchors', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Tools belong in motion.' })).toBeAttached();
	await expect(page.getByText('Building, not lending yet.')).toBeAttached();
	await expect(page.getByText('Schedule being confirmed')).toBeAttached();
	await expect(page.getByText('Sunday, August 16, 2026 · afternoon')).toHaveCount(0);

	await page.getByRole('link', { name: 'Help build the bus' }).click();
	await expect(page).toHaveURL(/#contact$/);
	await expect(page.getByRole('heading', { name: 'Bring a question, a skill, or a tool story.' })).toBeAttached();
});

test('contact surface keeps public discussion and private access distinct', async ({ page }) => {
	await page.goto('/#contact');
	await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeAttached();
	await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeAttached();
	await expect(page.getByRole('button', { name: 'Send to keyholders' })).toBeAttached();

	const publicArchive = page.getByRole('link', { name: 'public discussion archive' });
	await expect(publicArchive).toHaveAttribute('href', 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/');
	await expect(page.getByText('Its archive is not public.')).toBeAttached();
});
