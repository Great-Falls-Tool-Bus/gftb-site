import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// Acceptance rows for the copy de-slop slice (restoration PR-5).
//
// The bus is PERMANENTLY PARKED (operator fact, 2026-08-19, recorded after the
// motion framing was re-hallucinated more than once). Because the fact is
// absolute and the regression keeps creeping back, its gate is a required
// acceptance row, not a review checklist item (meta maturity doc §1.5(i),
// provenance row P23):
//
//   1. No motion language and no em-dash AI-tell anywhere in USER-FACING
//      rendered output — visible text, image alt text, aria labels, document
//      title, meta description — on / and /404.
//   2. The site description is byte-identical across its three carriers:
//      src/app.html's static <meta>, +layout.svelte's `description` constant
//      (which also feeds the JSON-LD), and the rendered head. The
//      "community-run tool library" naming changes atomically with the hero
//      lede in +page.svelte.
//   3. Every interim string this slice introduced still carries its
//      TODO(jess) marker until Jess authors the final copy.
//
// Source comments legitimately QUOTE the stripped phrases (they are the
// operator handoff), so the banned-phrase sweep runs against rendered output,
// never against source text; Svelte drops template comments from the build.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

// Word-boundaried so e.g. "automobile" or CSS class names would not
// false-positive; "on its way" is a phrase, not a word.
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

// The sweep runs on the shipped HTML: scripts disabled, so the DOM is exactly
// what the prerender wrote, with <noscript> fallbacks active and swept too.
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

		// Atomic-phrase rule: "community-run tool library" (interim wording;
		// TODO(jess)) changes in the lede and both description carriers
		// together, and "mobile" never returns to any of them.
		const lede = readSource('src/routes/+page.svelte');
		expect(first).toContain('community-run tool library');
		expect(lede).toContain('community-run tool library');
	});

	test('the session band carries the confirmed Friday hours and local contact CTA', async ({ page }) => {
		// Operator ruling 2026-08-31: the recurring Friday window lives in the
		// public-work-session band, not in the hero status card.
		await page.goto('/');
		const band = page.locator('.next-session');
		await expect(band).toContainText(
			'Jess is usually working on the bus Fridays, about 3–5 PM ET. Please use the contact form to confirm before traveling.',
		);
		await expect(band.getByRole('link', { name: 'contact form', exact: true })).toHaveAttribute('href', '/contact');
		await expect(page.locator('#status')).not.toContainText('Fridays');
		await expect(page.locator('#status p')).toHaveCount(2);
		await expect(page.locator('#contact a')).toHaveCount(1);
		await expect(page.locator('#contact a')).toHaveAttribute('href', '/contact');
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
