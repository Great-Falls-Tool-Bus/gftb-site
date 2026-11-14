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

	it('gives every sitemap page a distinct title', () => {
		const paths = ['/', '/log/', '/contact/', '/privacy/', '/refund-policy/', '/legal/'];
		for (let n = 2; n <= logPageCount(); n += 1) paths.push(`/log/page/${n}/`);
		for (const entry of publicLogs) paths.push(`/log/${entry.slug}/`);
		const titles = paths.map(pageTitle);
		expect(new Set(titles).size).toBe(titles.length);
	});
});
