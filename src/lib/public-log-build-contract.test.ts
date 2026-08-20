import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertPublicLogMetadata } from './public-log-schema';

// Acceptance row: static build and frontmatter validity for the .svx logs.
// src/lib/public-log-content.test.ts already guards which *keys* may appear;
// this asserts the parsed *values* survive the real schema gate, and that the
// build wiring which turns them into a prerendered page is still in place.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contentDirectory = path.join(repoRoot, 'src/content/log');
const logFiles = readdirSync(contentDirectory).filter((file) => file.endsWith('.svx'));

const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/gu, '');

/**
 * The frontmatter subset these logs are allowed to use: top-level scalars,
 * inline arrays, and block sequences. Anything richer is rejected rather than
 * guessed at, so a log that needs new syntax has to update this contract
 * deliberately instead of quietly reaching the public build.
 */
function parseFrontmatter(raw: string, source: string): Record<string, unknown> {
	const block = /^---\n([\s\S]*?)\n---/u.exec(raw)?.[1];
	if (block === undefined) throw new Error(`${source}: no frontmatter block`);
	const parsed: Record<string, unknown> = {};
	let sequenceKey: string | null = null;

	for (const line of block.split('\n')) {
		if (line.trim() === '') continue;

		const sequenceItem = /^\s+-\s+(.*)$/u.exec(line);
		if (sequenceItem) {
			if (!sequenceKey) throw new Error(`${source}: sequence item outside a key: ${line}`);
			(parsed[sequenceKey] as string[]).push(unquote(sequenceItem[1]));
			continue;
		}

		const match = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
		if (!match) throw new Error(`${source}: unsupported frontmatter line: ${line}`);
		const [, key, rawValue] = match;
		const value = rawValue.trim();
		sequenceKey = null;

		if (value === '') {
			sequenceKey = key;
			parsed[key] = [];
		} else if (value === 'true' || value === 'false') parsed[key] = value === 'true';
		else if (value.startsWith('[') && value.endsWith(']')) {
			parsed[key] = value
				.slice(1, -1)
				.split(',')
				.map(unquote)
				.filter((entry) => entry.length > 0);
		} else parsed[key] = unquote(value);
	}
	return parsed;
}

describe('public log frontmatter', () => {
	it('scans at least one log', () => {
		expect(logFiles.length).toBeGreaterThan(0);
	});

	for (const file of logFiles) {
		it(`${file} parses and satisfies the public schema`, () => {
			const raw = readFileSync(path.join(contentDirectory, file), 'utf8');
			const metadata = assertPublicLogMetadata(parseFrontmatter(raw, file), file);
			// Boolean gate (B1.2): true renders, false is an operator-pending
			// draft that src/lib/public-logs.ts excludes from production output.
			expect(typeof metadata.published).toBe('boolean');
			// The filename date prefix is the sort key readers see; it must agree
			// with the frontmatter date the page actually renders.
			expect(file.startsWith(metadata.date), `${file} filename date prefix`).toBe(true);
			expect(raw.slice(raw.indexOf('\n---', 3) + 4).trim().length, `${file} body`).toBeGreaterThan(0);
		});
	}

	it('rejects the frontmatter shapes the public boundary forbids', () => {
		expect(() => assertPublicLogMetadata({ ...validMetadata(), published: 'yes' }, 'fixture')).toThrow(/published/u);
		expect(() => assertPublicLogMetadata({ ...validMetadata(), author: 'A Person' }, 'fixture')).toThrow(
			/unsupported public frontmatter keys/u,
		);
		expect(() => assertPublicLogMetadata({ ...validMetadata(), date: '2026-13-01' }, 'fixture')).toThrow(/date/u);
		expect(() => assertPublicLogMetadata({ ...validMetadata(), tags: [] }, 'fixture')).toThrow(/tags/u);
	});
});

describe('static build wiring for the logs', () => {
	it('keeps .svx a build-time content extension', () => {
		const svelteConfig = readFileSync(path.join(repoRoot, 'svelte.config.js'), 'utf8');
		expect(svelteConfig).toContain("extensions: ['.svelte', '.svx']");
		expect(svelteConfig).toContain("mdsvex({ extensions: ['.svx'], highlight: { highlighter } })");
		// mdsvex 0.12.7 emits the legacy module-script spelling; without this
		// rewrite the frontmatter never reaches `metadata` under Svelte 5 runes.
		expect(svelteConfig).toContain('\'<script context="module">\'');
		expect(svelteConfig).toContain("'<script module>'");
	});

	it('highlights code fences at build time with the dual-theme shiki contract (D07)', () => {
		// The code-surface contract: shiki runs inside the mdsvex preprocessor
		// (never in the client bundle) with a light+dark theme pair and
		// defaultColor: false, so the emitted markup carries only the
		// --shiki-light/--shiki-dark variables that src/app.css walks, keyed
		// on the same data-mode attribute as the role layer.
		const svelteConfig = readFileSync(path.join(repoRoot, 'svelte.config.js'), 'utf8');
		expect(svelteConfig).toContain("import { codeToHtml } from 'shiki'");
		expect(svelteConfig).toMatch(/themes:\s*SHIKI_THEMES/u);
		expect(svelteConfig).toMatch(/\{ light: 'github-light', dark: 'github-dark' \}/u);
		expect(svelteConfig).toContain('defaultColor: false');
		const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
		expect(appCss).toContain('var(--shiki-light)');
		expect(appCss).toMatch(/\[data-mode='dark'\] pre\.shiki/u);
	});

	it('keeps the whole site prerendered by adapter-static', () => {
		expect(readFileSync(path.join(repoRoot, 'src/routes/+layout.ts'), 'utf8')).toContain(
			'export const prerender = true',
		);
		const svelteConfig = readFileSync(path.join(repoRoot, 'svelte.config.js'), 'utf8');
		expect(svelteConfig).toContain('@sveltejs/adapter-static');
	});

	// The 404 body must be a PRERENDERED route, never an SPA fallback. A
	// fallback renders with `ssr: false` and an empty branch, so the served
	// bytes carried no title, no heading and no link home: a scriptless visitor
	// saw the same blank page the zero-byte 404 gave them. Both halves are
	// asserted because adapter-static writes the fallback AFTER the prerendered
	// pages, so re-adding one silently takes 404.html back.
	it('builds the 404 body from a prerendered route, not an SPA fallback', () => {
		const svelteConfig = readFileSync(path.join(repoRoot, 'svelte.config.js'), 'utf8');
		expect(svelteConfig).not.toMatch(/^\s*fallback:/mu);
		expect(existsSync(path.join(repoRoot, 'src/routes/404/+page.svelte'))).toBe(true);
		const notFoundRoute = readFileSync(path.join(repoRoot, 'src/routes/404/+page.ts'), 'utf8');
		expect(notFoundRoute).toContain('export const prerender = true');
		// No hydration: the served HTML is the whole page, so the scriptless and
		// scripted renderings are the same bytes.
		expect(notFoundRoute).toContain('export const csr = false');
	});

	it('picks up every checked-in log through the eager glob', () => {
		const publicLogs = readFileSync(path.join(repoRoot, 'src/lib/public-logs.ts'), 'utf8');
		expect(publicLogs).toContain("import.meta.glob<PublicLogModule>('../content/log/*.svx', { eager: true })");
		expect(publicLogs).toContain('assertPublicLogMetadata(module.metadata, path)');
		for (const file of logFiles) expect(file).toMatch(/^[\d-]+[a-z0-9-]+\.svx$/u);
	});
});

function validMetadata() {
	return {
		date: '2026-08-16',
		title: 'A public front door',
		summary: 'A summary long enough to be useful to a reader.',
		tags: ['bus'],
		published: true as const,
	};
}
