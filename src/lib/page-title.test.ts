import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_NAME, pageTitle } from './page-title';
import { logPageCount, publicLogs } from './public-logs';

describe('pageTitle', () => {
	it('keeps the bare site name on the home page', () => {
		expect(pageTitle('/')).toBe(SITE_NAME);
		expect(pageTitle('')).toBe(SITE_NAME);
	});

	it.each([
		['/log/', 'Public log'],
		['/contact/', 'Contact'],
		['/join/', 'Join'],
		['/legal/', 'Legal'],
		['/privacy/', 'Privacy'],
		['/refund-policy/', 'Contribution refunds'],
	])('names %s', (path, name) => {
		expect(pageTitle(path)).toBe(`${name} | ${SITE_NAME}`);
		expect(pageTitle(path.slice(0, -1))).toBe(`${name} | ${SITE_NAME}`);
	});

	it('names archive pages by number', () => {
		expect(pageTitle('/log/page/2/')).toBe(`Public log, page 2 | ${SITE_NAME}`);
	});

	it('names each published log entry by its title', () => {
		for (const entry of publicLogs) {
			expect(pageTitle(`/log/${entry.slug}/`)).toBe(`${entry.metadata.title} | ${SITE_NAME}`);
		}
	});

	it('falls back to the site name for a path it does not know', () => {
		expect(pageTitle('/log/no-such-entry/')).toBe(SITE_NAME);
		expect(pageTitle('/nowhere/')).toBe(SITE_NAME);
	});

	it('gives every page route its own name and a distinct title', () => {
		// The paths come from src/routes itself, so a new page without an entry
		// in page-title.ts fails here instead of quietly getting the bare name.
		const routesDir = path.resolve(import.meta.dirname, '..', 'routes');
		const routeDirs = readdirSync(routesDir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name === '+page.svelte')
			.map((entry) => path.relative(routesDir, entry.parentPath))
			.map((relative) => `/${relative.split(path.sep).join('/')}`.replace(/\/$/u, '') || '/');
		const paths: string[] = [];
		for (const route of routeDirs) {
			if (route === '/' || route === '/404') continue;
			if (route === '/log/[slug]') {
				for (const entry of publicLogs) paths.push(`/log/${entry.slug}/`);
			} else if (route === '/log/page/[n]') {
				for (let n = 2; n <= Math.max(2, logPageCount()); n += 1) paths.push(`/log/page/${n}/`);
			} else {
				expect(route, 'an unexpected dynamic route needs a title rule').not.toMatch(/\[/u);
				paths.push(`${route}/`);
			}
		}
		expect(paths.length).toBeGreaterThan(6);
		const titles = paths.map(pageTitle);
		for (const [index, title] of titles.entries()) {
			expect(title, paths[index]).not.toBe(SITE_NAME);
			expect(title, paths[index]).toMatch(/ \| Great Falls Tool Bus$/u);
		}
		expect(new Set([SITE_NAME, ...titles]).size).toBe(titles.length + 1);
	});
});
