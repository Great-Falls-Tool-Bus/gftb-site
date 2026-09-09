import { expect, test } from '@playwright/test';

// Acceptance rows for the print spec-sheet treatment (D03): chrome and
// backgrounds dropped, ink on white, outbound URLs expanded after their link
// text (pairs with the D06 ExternalLink), break-avoidance declared — and the
// printed QR stays first-class output.

test.describe('print media', () => {
	test('page chrome and the hero backdrop are dropped; the sheet is ink on white', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		// Dark glass must also become ink on paper, including inherited text.
		await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));
		await page.emulateMedia({ media: 'print' });

		const state = await page.evaluate(() => ({
			header: getComputedStyle(document.querySelector('.site-header')!).display,
			footer: getComputedStyle(document.querySelector('.site-footer')!).display,
			skipLink: getComputedStyle(document.querySelector('.skip-link')!).display,
			heroMedia: getComputedStyle(document.querySelector('.hero__media')!).display,
			bodyBackground: getComputedStyle(document.body).backgroundColor,
			bodyColor: getComputedStyle(document.body).color,
			glass: Array.from(document.querySelectorAll('.hero-glass, .page-shell > .section')).map((element) => ({
				background: getComputedStyle(element).backgroundColor,
				filter: getComputedStyle(element).backdropFilter,
				color: getComputedStyle(element).color,
				heading: getComputedStyle(element.querySelector('h1, h2')!).color,
			})),
		}));
		expect(state.header, 'site header dropped in print').toBe('none');
		expect(state.footer, 'site footer dropped in print').toBe('none');
		expect(state.skipLink, 'skip link dropped in print').toBe('none');
		expect(state.heroMedia, 'hero backdrop dropped in print').toBe('none');
		expect(state.bodyBackground, 'paper ground').toBe('rgb(255, 255, 255)');
		expect(state.bodyColor, 'ink').toBe('rgb(0, 0, 0)');
		expect(state.glass.length, 'glass surfaces exist to inspect').toBeGreaterThan(0);
		for (const surface of state.glass) {
			expect(surface.background, 'glass tint dropped on paper').toBe('rgba(0, 0, 0, 0)');
			expect(surface.filter, 'glass blur dropped on paper').toBe('none');
			expect(surface.color, 'glass body ink').toBe('rgb(0, 0, 0)');
			expect(surface.heading, 'glass heading ink').toBe('rgb(0, 0, 0)');
		}
	});

	test('outbound URLs expand after their link text and the [↗] mark is dropped', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.emulateMedia({ media: 'print' });

		// The footer's ExternalLinks are hidden with the footer chrome, but
		// their computed styles still resolve — which is exactly what any
		// external link placed in printable content inherits.
		const link = await page.evaluate(() => {
			const anchor = document.querySelector('.external-link[href^="http"]');
			if (!anchor) return null;
			return {
				href: anchor.getAttribute('href'),
				afterContent: getComputedStyle(anchor, '::after').content,
				mark: anchor.querySelector('.external-link__mark')
					? getComputedStyle(anchor.querySelector('.external-link__mark')!).display
					: null,
			};
		});
		expect(link, 'an ExternalLink exists to measure').not.toBeNull();
		// Chromium resolves attr(href) in the computed ::after content, so the
		// expansion is asserted as the URL a printed sheet actually shows.
		expect(link!.afterContent, 'href expanded after the link text').toContain(`<${link!.href}>`);
		expect(link!.mark, 'screen-only [↗] mark dropped in print').toBe('none');
	});

	test('armed reveal content can never print hidden', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		// The far-below-fold sections are still armed-hidden on screen at this
		// point; switching to print media must force them visible regardless.
		await page.emulateMedia({ media: 'print' });
		const opacities = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.reveal-armed')).map((element) => ({
				opacity: getComputedStyle(element).opacity,
				transform: getComputedStyle(element).transform,
			})),
		);
		expect(opacities.length).toBeGreaterThan(0);
		for (const entry of opacities) {
			expect(Number(entry.opacity), 'armed element visible in print').toBe(1);
			expect(entry.transform, 'armed element at rest in print').toBe('none');
		}
	});

	test('headings declare break-avoidance for the spec-sheet flow', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.emulateMedia({ media: 'print' });
		const breakAfter = await page.evaluate(() => getComputedStyle(document.querySelector('h2')!).breakAfter);
		expect(['avoid', 'avoid-page'], `h2 break-after: ${breakAfter}`).toContain(breakAfter);
	});

	test('the printed QR keeps its quiet zone on /contact', async ({ page }) => {
		await page.goto('/contact');
		await page.waitForLoadState('networkidle');
		await page.emulateMedia({ media: 'print' });
		const qr = await page.locator('img.qr').evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				display: style.display,
				background: style.backgroundColor,
				colorAdjust:
					style.getPropertyValue('print-color-adjust') || style.getPropertyValue('-webkit-print-color-adjust'),
			};
		});
		// The QR prints (spec §10's public-site row): visible, white quiet
		// zone, and pinned against UA background-stripping.
		expect(qr.display, 'QR visible in print').not.toBe('none');
		expect(qr.background, 'literal white quiet zone').toBe('rgb(255, 255, 255)');
		expect(qr.colorAdjust.trim(), 'quiet zone pinned printable').toBe('exact');
	});
});
