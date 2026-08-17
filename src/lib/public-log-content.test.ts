import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_LOG_OPTIONAL_KEYS, PUBLIC_LOG_REQUIRED_KEYS } from './public-log-schema';

const contentDirectory = path.resolve(process.cwd(), 'src/content/log');
const files = readdirSync(contentDirectory).filter((file) => file.endsWith('.svx'));
const allowed = new Set<string>([...PUBLIC_LOG_REQUIRED_KEYS, ...PUBLIC_LOG_OPTIONAL_KEYS]);
const forbiddenPublicPatterns: Array<[string, RegExp]> = [
	['email address', /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu],
	['cluster-local hostname', /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:svc|cluster\.local)\b/iu],
	[
		'RFC1918 or loopback address',
		/\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|127(?:\.\d{1,3}){3})\b/u,
	],
	['localhost', /\blocalhost(?::\d{1,5})?\b/iu],
	[
		'cache or executor endpoint',
		/\b(?:grpc|grpcs):\/\/|https?:\/\/[^\s)'"<>]*(?:bazel-cache|remote-cache|reapi|executor)[^\s)'"<>]*/iu,
	],
];

describe('checked-in public log content', () => {
	it('has at least one dated SVX log', () => {
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) expect(file).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.svx$/);
	});

	it('uses only public frontmatter and carries no internal pointers', () => {
		for (const file of files) {
			const raw = readFileSync(path.join(contentDirectory, file), 'utf8');
			const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/u)?.[1];
			expect(frontmatter, `${file} frontmatter`).toBeTruthy();
			const keys = [...(frontmatter ?? '').matchAll(/^([a-z][a-zA-Z]*):/gmu)].map((match) => match[1]);
			expect(
				keys.filter((key) => !allowed.has(key)),
				`${file} unsupported keys`,
			).toEqual([]);
			for (const key of PUBLIC_LOG_REQUIRED_KEYS) expect(keys, `${file} missing ${key}`).toContain(key);
			expect(raw).not.toMatch(/\b(?:Linear|TIN-\d+|pull request|PR\s*#?\d+|commit SHA|github\.com\/)\b/iu);
			for (const [label, pattern] of forbiddenPublicPatterns) {
				expect(raw, `${file} contains a forbidden ${label}`).not.toMatch(pattern);
			}
		}
	});

	it('recognizes synthetic private-contact and endpoint shapes without blocking ordinary public URLs', () => {
		const negativeFixtures = [
			'person@example.invalid',
			'worker.example.svc',
			'worker.example.cluster.local',
			'10.20.30.40',
			'172.20.1.2',
			'192.168.5.6',
			'127.0.0.1',
			'localhost:3000',
			'grpcs://worker.example.invalid',
			'https://bazel-cache.example.invalid',
		];
		for (const fixture of negativeFixtures) {
			expect(
				forbiddenPublicPatterns.some(([, pattern]) => pattern.test(fixture)),
				`fixture should be rejected: ${fixture}`,
			).toBe(true);
		}

		const publicFixtures = ['https://greatfallstoolbus.org/', 'Lewiston–Auburn, Maine', 'a neighbor can help'];
		for (const fixture of publicFixtures) {
			expect(forbiddenPublicPatterns.some(([, pattern]) => pattern.test(fixture))).toBe(false);
		}
	});
});
