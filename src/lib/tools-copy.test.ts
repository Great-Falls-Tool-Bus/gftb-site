import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { membershipCopyViolations, sentences } from './membership-copy';
import { TOOLS_LINK_LABEL, TOOLS_SECTION } from './tools-copy';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const allCopy = [TOOLS_LINK_LABEL, TOOLS_SECTION.heading, ...TOOLS_SECTION.paragraphs, TOOLS_SECTION.linkLabel];

// The links into the members Tools pages (TIN-3814): fixed words, no tool data.
describe('tools copy', () => {
	it('holds the words the operator approves, and nothing else', () => {
		expect(TOOLS_LINK_LABEL).toBe('Tools');
		expect(Object.keys(TOOLS_SECTION).sort()).toEqual(['heading', 'linkLabel', 'paragraphs']);
		expect(TOOLS_SECTION.linkLabel).toBe('Browse the tools');
		// A heading, two or three sentences and one strong link.
		const body = sentences(TOOLS_SECTION.paragraphs.join(' '));
		expect(body.length).toBeGreaterThanOrEqual(2);
		expect(body.length).toBeLessThanOrEqual(3);
	});

	it('keeps the house copy rules', () => {
		for (const text of allCopy) {
			expect(text, text).not.toContain('\u2014');
			expect(text, text).not.toContain(';');
			// The bus is permanently parked (e2e/acceptance-copy-deslop.spec.ts).
			expect(text, text).not.toMatch(/\b(?:mobile|motion|moving|circulating|rolling)\b|on its way/iu);
			// The inventory vocabulary the members app bans, and the pickup list words.
			expect(text, text).not.toMatch(/\b(?:catalog\w*|enrol\w*|ingest\w*|steward\w*|cart|reserv\w*)\b/iu);
			// No address on the main site, members or otherwise.
			expect(text, text).not.toMatch(/https?:|greatfallstoolbus|\.org\b/iu);
		}
		expect(membershipCopyViolations(allCopy.join(' '))).toEqual([]);
	});

	it('renders through the layout and the home page, beside the literal members URL', () => {
		const layout = read('src/routes/+layout.svelte');
		const home = read('src/routes/+page.svelte');
		const anchor = '<a data-public-member="tools" href="https://members.greatfallstoolbus.org/tools">{TOOLS_LINK_LABEL}</a>';
		// One in the header nav, one in the footer Members column.
		expect(layout.split(anchor)).toHaveLength(3);
		expect(layout).not.toContain('members.greatfallstoolbus.org/scan');
		expect(home).toMatch(
			/<a class="button" data-public-member="tools" href="https:\/\/members\.greatfallstoolbus\.org\/tools"\s*>\{TOOLS_SECTION\.linkLabel\}<\/a/u,
		);
		expect(home).toMatch(/<h2 id="tools-title">\{TOOLS_SECTION\.heading\}<\/h2>/u);
	});
});
