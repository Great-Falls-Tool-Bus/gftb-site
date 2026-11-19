import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// The bus is permanently parked under the 2026-08-19 ruling. The rendered-copy gate covers /
// and /404 under meta maturity §1.5(i), provenance row P23. Source comments may quote retired
// wording for handoff. src/app.html, +layout.svelte and the rendered head must share the
// description. The hero lede in +page.svelte carries the same naming.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

// Word boundaries exclude unrelated matches such as "automobile".
const BANNED_MOTION = /\b(?:mobile|motion|moving|circulating|rolling)\b|on its way/iu;
const EM_DASH = '—';

// Swept copy that must never return to a rendered surface (operator
// re-review 2026-08-19: AI-authored or unverified strings removed pending
// Jess's wording). The strings live on in SOURCE comment slots as the
// operator handoff; this list gates the rendered output only.
const BANNED_SWEPT_COPY = [
	'Tools belong in motion',
	'mobile tool library',
	'Building, not lending yet',
	'A useful thing, built in understandable steps',
	'A few specific ways to help',
	'What changed, in plain language',
	'A name shaped by this place',
	'Bring a question, a skill, or a tool story',
	'Waterproofing + measurements',
	'Schedule being confirmed',
	'Make the bus ready',
	'Design membership together',
	'Start with useful tools',
	'A small public front door',
	'tools, skills, and shared work',
	'keeps all three circulating',
	'useful things moving between neighbors',
	'the next concrete invitation',
	'your note is on its way',
];

interface UserFacingSurfaces {
	text: string;
	attributes: string[];
	title: string;
	descriptions: string[];
	jsonLdDescriptions: string[];
}

async function collectUserFacingSurfaces(page: Page): Promise<UserFacingSurfaces> {
	return page.evaluate(() => {
		// Rendered text only: scripts, styles and HTML comments are not copy.
		const root = document.documentElement.cloneNode(true) as HTMLElement;
		for (const node of Array.from(root.querySelectorAll('script, style'))) node.remove();

		// Attribute surfaces a reader or assistive tech is exposed to.
		const attributes: string[] = [];
		for (const element of Array.from(document.querySelectorAll('*'))) {
			for (const name of ['alt', 'aria-label', 'title', 'placeholder', 'label']) {
				const value = element.getAttribute(name);
				if (value) attributes.push(`${name}=${value}`);
			}
		}

		const descriptions = Array.from(document.querySelectorAll('meta[name="description"]')).map(
			(meta) => meta.getAttribute('content') ?? '',
		);
		const jsonLdDescriptions = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => {
				try {
					const parsed = JSON.parse(script.textContent ?? '{}') as { description?: unknown };
					return typeof parsed.description === 'string' ? parsed.description : '';
				} catch {
					return '';
				}
			},
		);

		return {
			text: root.textContent ?? '',
			attributes,
			title: document.title,
			descriptions,
			jsonLdDescriptions,
		};
	});
}

function expectCleanCopy(surfaces: UserFacingSurfaces, label: string) {
	const rows: Array<[string, string]> = [
		['rendered text', surfaces.text],
		['document title', surfaces.title],
		...surfaces.attributes.map((value): [string, string] => ['attribute', value]),
		...surfaces.descriptions.map((value): [string, string] => ['meta description', value]),
		...surfaces.jsonLdDescriptions.map((value): [string, string] => ['JSON-LD description', value]),
	];
	for (const [surface, value] of rows) {
		const motion = BANNED_MOTION.exec(value);
		expect(motion, `${label}: motion language "${motion?.[0] ?? ''}" in ${surface}`).toBeNull();
		expect(value.includes(EM_DASH), `${label}: em-dash in ${surface}: ${value.slice(0, 120)}`).toBe(false);
		for (const phrase of BANNED_SWEPT_COPY) {
			expect(value.toLowerCase().includes(phrase.toLowerCase()), `${label}: swept copy "${phrase}" in ${surface}`).toBe(
				false,
			);
		}
	}
}

// Disabling scripts exposes the prerendered DOM, including <noscript> fallbacks.
test.describe('copy de-slop acceptance (restoration PR-5)', () => {
	test.use({ javaScriptEnabled: false });

	for (const [label, path] of [
		['/', '/'],
		['/404', '/definitely-not-a-page'],
		['/log', '/log'],
		['/contact', '/contact'],
	] as const) {
		test(`${label} carries no motion language and no em-dash`, async ({ page }) => {
			await page.goto(path);
			expectCleanCopy(await collectUserFacingSurfaces(page), label);
		});
	}

	test('the site description is identical across every carrier', async ({ page }) => {
		await page.goto('/');
		const surfaces = await collectUserFacingSurfaces(page);

		// Rendered head: app.html's static meta plus SEOHead's prerendered meta
		// must agree, and the JSON-LD (fed by the same constant) with them.
		expect(surfaces.descriptions.length).toBeGreaterThanOrEqual(1);
		const [first, ...rest] = surfaces.descriptions;
		for (const other of rest) expect(other).toBe(first);
		for (const jsonLd of surfaces.jsonLdDescriptions) expect(jsonLd).toBe(first);

		// Source carriers: the strings the rendered head is built from.
		const appHtml = /<meta name="description" content="([^"]*)"/u.exec(readSource('src/app.html'));
		const layout = /const description = '([^']*)'/u.exec(readSource('src/routes/+layout.svelte'));
		expect(appHtml?.[1], 'src/app.html meta description').toBe(first);
		expect(layout?.[1], '+layout.svelte description constant').toBe(first);

		// "community-run tool library" must agree across the lede and both description carriers.
		const lede = readSource('src/routes/+page.svelte');
		expect(first).toContain('community-run tool library');
		expect(lede).toContain('community-run tool library');
	});

	test('the FAQ carries the Thursday hours once and retains the local contact CTA', async ({ page }) => {
		// Under the 2026-09-19 and 2026-10-02 rulings, the FAQ carries recurring hours. Dated
		// sessions appear between the FAQ and log. The hero describes the club.
		await page.goto('/');
		const session = page.locator('#faq');
		await expect(session).toContainText(
			'Jess is usually working on the bus Thursdays, 3 to 4 PM ET. Please use the contact form to confirm before traveling.',
		);
		await expect(session.getByRole('link', { name: 'contact form', exact: true })).toHaveAttribute('href', '/contact');
		await expect(session.getByText(/Thursdays, 3 to 4 PM ET/u)).toHaveCount(1);
		// The 2026-10-02 ruling places one session band between the FAQ and log.
		await expect(page.locator('#hours')).toHaveCount(1);
		await expect(page.locator('.page-shell > #faq + #hours + #log')).toHaveCount(1);
		await expect(page.locator('#hours')).toHaveClass(/hours-band/u);
		await expect(page.locator('.hero #hours, .hero .hours-band, #status .hours-band')).toHaveCount(0);
		await expect(page.locator('.hero-session')).toHaveCount(0);
		await expect(page.locator('#status > p')).toHaveCount(1);
		await expect(page.locator('#status .callouts > li')).toHaveCount(2);
		await expect(page.locator('#status .credit')).toHaveText('Words by Tool Bus Member Katherine T.');
		// The credit is a <small>, not a <footer>: a second footer element on the
		// page breaks the strict-mode locator in e2e/home-goals.spec.ts.
		await expect(page.locator('#status footer')).toHaveCount(0);
		// Under the 2026-09-19 ruling, the sentence links to contact before the two button links.
		await expect(page.locator('#contact a')).toHaveCount(3);
		await expect(page.locator('#contact a').first()).toHaveAttribute('href', '/contact');
	});

	test('every interim string still carries its TODO(jess) marker', async () => {
		for (const relative of [
			'src/routes/+page.svelte',
			'src/routes/+layout.svelte',
			'src/routes/contact/+page.svelte',
			'src/app.html',
			'src/lib/components/ContactForm.svelte',
		]) {
			expect(readSource(relative).includes('TODO(jess)'), `${relative} lost its TODO(jess) marker`).toBe(true);
		}
	});
});
