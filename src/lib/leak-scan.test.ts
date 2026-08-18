import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	ALLOWED_HOSTS,
	ALLOWED_MAILBOXES,
	LEAK_RULES,
	PERMITTED_HOST_INITIAL,
	formatFindings,
	scanFiles,
	scanText,
} from './leak-scan';

// Acceptance row: nothing private reaches the published artefact. The rules are
// proven here against synthetic material; `just leak-scan` runs the same rules
// over build/ (see scripts/check-build-output.mjs), which is the variant that
// needs a real build and therefore cannot live in the unit suite.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ruleIds = LEAK_RULES.map((rule) => rule.id);
const idsFiring = (text: string) => new Set(scanText('fixture.html', text).map((finding) => finding.ruleId));

describe('leak-scan rule set', () => {
	it('declares unique, compilable rules', () => {
		expect(ruleIds.length).toBeGreaterThan(10);
		expect(new Set(ruleIds).size).toBe(ruleIds.length);
		for (const rule of LEAK_RULES) {
			expect(rule.description, `${rule.id} description`).toBeTruthy();
			expect(() => new RegExp(rule.pattern, `${rule.flags}g`)).not.toThrow();
		}
	});

	it('covers every category the public-content boundary names', () => {
		for (const required of [
			'secret-pem-block',
			'secret-cloud-access-key',
			'secret-json-web-token',
			'kubeconfig-fragment',
			'internal-hostname',
			'private-network-address',
			'cache-or-executor-endpoint',
			'private-personal-name',
			'private-list-archive',
			'source-map-or-dev-artifact',
			'internal-tracker-reference',
		]) {
			expect(ruleIds).toContain(required);
		}
	});
});

describe('leak-scan detections', () => {
	it('catches secret material', () => {
		expect(idsFiring('-----BEGIN RSA PRIVATE KEY-----')).toContain('secret-pem-block');
		expect(idsFiring('AKIAIOSFODNN7EXAMPLE')).toContain('secret-cloud-access-key');
		expect(idsFiring('ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toContain('secret-forge-token');
		// Assembled at run time so this fixture is not itself a contiguous JWT:
		// `just secrets-scan-dir` would otherwise flag the test that proves the
		// rule works.
		const jwtFixture = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'].join(
			'.',
		);
		expect(idsFiring(jwtFixture)).toContain('secret-json-web-token');
		expect(idsFiring('api_key = "s3cret-value-abcdefghij"')).toContain('secret-assignment');
	});

	it('catches cluster and kubeconfig fragments', () => {
		expect(idsFiring('client-certificate-data: LS0tLS1CRUdJTg==')).toContain('kubeconfig-fragment');
		expect(idsFiring('current-context: production')).toContain('kubeconfig-fragment');
		expect(idsFiring('forms.default.svc.cluster.local')).toContain('internal-hostname');
		expect(idsFiring('runner.example.ts.net')).toContain('internal-hostname');
		expect(idsFiring('10.20.30.40')).toContain('private-network-address');
		expect(idsFiring('100.101.102.103')).toContain('private-network-address');
		expect(idsFiring('grpcs://cache.example.invalid')).toContain('cache-or-executor-endpoint');
		expect(idsFiring('https://bazel-cache.example.invalid/x')).toContain('cache-or-executor-endpoint');
		expect(idsFiring('http://localhost:3000/')).toContain('localhost-reference');
	});

	it('catches developer and tracker artefacts', () => {
		expect(idsFiring('//# sourceMappingURL=app.js.map')).toContain('source-map-or-dev-artifact');
		expect(idsFiring('/Users/example/git/gftb-site/src')).toContain('developer-filesystem-path');
		expect(idsFiring('closes TIN-1234')).toContain('internal-tracker-reference');
		expect(idsFiring('see https://github.com/example/repo')).toContain('internal-tracker-reference');
		expect(idsFiring('deployed 0123456789abcdef0123456789abcdef01234567')).toContain('internal-tracker-reference');
	});

	it('permits only the initial the bus host consented to publish', () => {
		expect(PERMITTED_HOST_INITIAL).toBe('J.');
		expect(idsFiring('Ask J. when you arrive.')).not.toContain('private-personal-name');
		expect(idsFiring('Ask J. Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('Ask Jane Q. Doe when you arrive.')).toContain('private-personal-name');
	});

	it('flags a private list archive but not the public one', () => {
		expect(idsFiring('https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/')).toContain(
			'private-list-archive',
		);
		expect(idsFiring('https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/')).not.toContain(
			'private-list-archive',
		);
	});

	it('flags any outbound host or mailbox that has not been reviewed', () => {
		expect(idsFiring('<a href="https://analytics.example.com/x">x</a>')).toContain('unreviewed-outbound-host');
		expect(idsFiring('<a href="https://greatfallstoolbus.org/">home</a>')).not.toContain('unreviewed-outbound-host');
		expect(idsFiring('mailto:someone@example.com')).toContain('unreviewed-mailbox');
		expect(idsFiring('mailto:keyholders@latoolb.us')).not.toContain('unreviewed-mailbox');
	});

	it('accepts operator-supplied literals without them ever being checked in', () => {
		const findings = scanText('fixture.html', 'The host is Someone Private.', {
			deniedLiterals: ['Someone Private'],
		});
		expect(findings.map((finding) => finding.ruleId)).toContain('operator-denied-literal');
		expect(scanText('fixture.html', 'The host is Someone Private.').map((f) => f.ruleId)).not.toContain(
			'operator-denied-literal',
		);
	});

	it('redacts the matched material in its own report', () => {
		const report = formatFindings(scanText('fixture.html', 'token: ghp_0123456789abcdefghijklmnopqrstuvwxyz'));
		expect(report).toContain('<<redacted>>');
		expect(report).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyz');
	});

	it('reports the file and line of each finding', () => {
		const findings = scanFiles([{ path: 'a.html', text: 'ok\nok\n10.0.0.1\n' }]);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ file: 'a.html', line: 3, ruleId: 'private-network-address' });
	});
});

describe('leak-scan over the checked-in public inputs', () => {
	// The published artefact is gated by `just leak-scan`; this proves the same
	// rules already hold for the reviewed sources that produce it.
	const publicRoots = ['src/routes', 'src/content', 'src/lib/components', 'static'];
	const textExtensions = new Set(['.html', '.svelte', '.svx', '.svg', '.txt', '.xml', '.css', '.ts', '.js']);

	const files: Array<{ path: string; text: string }> = [];
	for (const root of publicRoots) {
		const walk = (directory: string) => {
			for (const entry of readdirSync(directory)) {
				const absolute = path.join(directory, entry);
				if (statSync(absolute).isDirectory()) {
					walk(absolute);
					continue;
				}
				if (!textExtensions.has(path.extname(absolute).toLowerCase())) continue;
				files.push({ path: path.relative(repoRoot, absolute), text: readFileSync(absolute, 'utf8') });
			}
		};
		walk(path.join(repoRoot, root));
	}

	it('found the public inputs it claims to scan', () => {
		expect(files.length).toBeGreaterThan(5);
		expect(files.map((file) => file.path)).toContain('src/routes/+page.svelte');
	});

	it('carries no leak-scan findings', () => {
		const findings = scanFiles(files);
		expect(formatFindings(findings)).toBe('leak-scan: no findings');
	});

	it('keeps the reviewed allowlists tight', () => {
		expect(ALLOWED_MAILBOXES).toEqual(['keyholders@latoolb.us', 'discuss@latoolb.us']);
		for (const host of ALLOWED_HOSTS) expect(host).not.toMatch(/^\*|\s/u);
		expect(ALLOWED_HOSTS).toContain('greatfallstoolbus.org');
		expect(ALLOWED_HOSTS).toContain('forms.latoolb.us');
	});
});
