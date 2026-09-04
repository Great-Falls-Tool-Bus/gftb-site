import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	ALLOWED_HOSTS,
	ALLOWED_MAILBOXES,
	LEAK_RULES,
	PERMITTED_HOST_INITIAL,
	REPO_ROOT,
	SKIP_EXTENSIONS,
	TEXT_EXTENSIONS,
	UnclassifiedOutputError,
	collectFiles,
	formatFindings,
	scanBuildDirectory,
	scanFiles,
	scanText,
} from '../../scripts/lib/leak-scan.mjs';
import { distinctiveDraftLiterals, readLogEntries } from '../../scripts/lib/log-content.mjs';

// Acceptance row: nothing private reaches the published artefact. The rules are
// proven here against synthetic material; `//:scanned_build` runs the same
// rules over a copied real build (see scripts/check-build-output.mjs), which is
// the variant that cannot live in the unit suite.

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

// A sequential, never-issued forge token shaped like a real one. Assembled at
// run time so no gitleaks release (CI pins 8.21.2, whose github-pat rule fires
// on the contiguous literal) sees a token in this file; the scanner under test
// still receives the full string.
const FAKE_FORGE_TOKEN = ['ghp_', '0123456789abcdefghijklmnopqrstuvwxyz'].join('');

describe('leak-scan detections', () => {
	it('catches secret material', () => {
		expect(idsFiring('-----BEGIN RSA PRIVATE KEY-----')).toContain('secret-pem-block');
		expect(idsFiring('AKIAIOSFODNN7EXAMPLE')).toContain('secret-cloud-access-key');
		expect(idsFiring(FAKE_FORGE_TOKEN)).toContain('secret-forge-token');
		// Assembled at run time so this fixture is not itself a contiguous JWT:
		// `just secrets-scan-dir` would otherwise flag the test that proves the
		// rule works. FAKE_FORGE_TOKEN is assembled for the same reason.
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

	it('sanctions only the SourceLink surfaces of the site repo, never its tracker pages', () => {
		// The edit-this-page affordance (demo #94, addendum B1.2) publishes the
		// repo root plus /edit/ and /blob/ source links and the advisory form.
		// Every OTHER repo, and this repo's PR/issue/commit surfaces, stay
		// banned repository pointers.
		expect(idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site')).not.toContain('internal-tracker-reference');
		expect(
			idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site/edit/main/src/content/log/x.svx'),
		).not.toContain('internal-tracker-reference');
		expect(
			idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site/blob/main/src/routes/+page.svelte'),
		).not.toContain('internal-tracker-reference');
		expect(idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site/pull/25')).toContain(
			'internal-tracker-reference',
		);
		expect(idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site/issues/1')).toContain(
			'internal-tracker-reference',
		);
		expect(idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-platform')).toContain('internal-tracker-reference');
	});

	it('permits only the initial the bus host consented to publish', () => {
		expect(PERMITTED_HOST_INITIAL).toBe('J.');
		expect(idsFiring('Ask J. when you arrive.')).not.toContain('private-personal-name');
		// The review's hostile table (E1), row by row: every real-name shape
		// fires — WITH and WITHOUT the space after the initial — while
		// minified member access stays silent. The discriminator is the
		// preceding context (start / whitespace / tag-close / quote / paren:
		// where prose happens), not the name shape: `H.Started` in a shipped
		// bundle sits behind an operator character, `J.Doe` in prerendered
		// HTML never does.
		expect(idsFiring('Ask J. Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('Ask Jane Q. Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('Ask J.Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('Ask Jane Q.Doe when you arrive.')).toContain('private-personal-name');
		expect(idsFiring('<p>J.Doe</p>')).toContain('private-personal-name');
		expect(idsFiring('(J.Doe) signed the sheet')).toContain('private-personal-name');
		// The Zag machine false-positive class (first mounted Skeleton
		// component): enum member reads behind = / ! / ; never fire.
		expect(idsFiring('if(S===H.Started)return;u.current=d.current')).not.toContain('private-personal-name');
		expect(idsFiring('let e=S===H.Started;S=H.Stopped')).not.toContain('private-personal-name');
	});

	it('bans the repo commit path a stamped footer link would emit, at any sha length', () => {
		// Review B1: the D10 footer sha must stay a bare <code> — the
		// internal-tracker-reference rule bans this repo's pull/issues/commit
		// path segments in published output (AGENTS.md sanctions exactly one
		// repository pointer, the SourceLink affordance), and no sha length
		// escapes a path-segment ban. Local builds stamp 'unknown' and render
		// no provenance line at all, so these rows plus the `just
		// //:scanned_build and leak-scan-stamped gates keep the stamped artifact honest.
		expect(idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site/commit/deadbee')).toContain(
			'internal-tracker-reference',
		);
		expect(
			idsFiring('https://github.com/Great-Falls-Tool-Bus/gftb-site/commit/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
		).toContain('internal-tracker-reference');
		// The shape the fixed footer actually renders when stamped is clean.
		expect([...idsFiring('built from <code>deadbee</code>, GitHub-verified')]).toEqual([]);
	});

	it('keeps the layout from rebuilding a commit URL at the provenance site', () => {
		// Structural half of the same guard: the one place the stamped sha
		// reaches markup must never interpolate it into a /commit/ path.
		const layout = readFileSync(path.join(REPO_ROOT, 'src/routes/+layout.svelte'), 'utf8');
		expect(layout).not.toMatch(/\/commit\//u);
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
		const report = formatFindings(scanText('fixture.html', `token: ${FAKE_FORGE_TOKEN}`));
		expect(report).toContain('<<redacted>>');
		expect(report).not.toContain(FAKE_FORGE_TOKEN);
	});

	it('reports the file and line of each finding', () => {
		const findings = scanFiles([{ path: 'a.html', text: 'ok\nok\n10.0.0.1\n' }]);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ file: 'a.html', line: 3, ruleId: 'private-network-address' });
	});
});

describe('leak-scan over the checked-in public inputs', () => {
	// The published artefact is gated by `//:scanned_build`; this proves the same
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

// B1 regression gate (PR #33 review comment
// https://github.com/Great-Falls-Tool-Bus/gftb-site/pull/33#issuecomment-5364998251):
// an eager `import.meta.glob` over src/content/log/*.svx made every draft's
// title, summary, and full body a static import, so it shipped to every
// visitor in build/_app/immutable/chunks/* regardless of the `published`
// runtime filter — proven by grepping a real build for the exact draft
// prose. The fix (src/lib/generated/log-manifest.ts,
// scripts/build-log-manifest.mjs) excludes unpublished entries at
// generation time, outside Vite's module graph entirely. This does not
// re-run a real `vite build` (`//:scanned_build` does that, for the reason its
// own comment gives: it needs a real build and so cannot live in the unit
// suite) — it proves the DETECTION mechanism that
// scripts/check-build-output.mjs runs against the copied build would catch
// a regression, against a synthetic "leaked chunk" shaped exactly like the
// review's grep proof.
describe('content-train B1: unpublished drafts never reach a build artefact', () => {
	const logDir = path.join(repoRoot, 'src/content/log');
	const draftLiterals = distinctiveDraftLiterals(readLogEntries(logDir));

	it('finds at least one published:false draft to test against', () => {
		expect(draftLiterals.length).toBeGreaterThan(0);
	});

	it('every distinctive draft literal is absent from the checked-in, client-reachable manifest', () => {
		const manifest = readFileSync(path.join(repoRoot, 'src/lib/generated/log-manifest.ts'), 'utf8');
		for (const literal of draftLiterals) {
			expect(manifest, `"${literal}" leaked into log-manifest.ts`).not.toContain(literal);
		}
	});

	it('would catch the exact review-proven leak shape if it ever regressed', () => {
		// Shaped like the review's own grep proof: a minified bundle chunk that
		// inlines a draft's metadata object literal, unrelated bytes around it.
		const leakedChunk = `…,M={date:\`2026-08-20\`,title:\`${draftLiterals[0]}\`,summary:\`x\`,tags:[],published:!1}…`;
		const root = mkdtempSync(path.join(tmpdir(), 'gftb-b1-regression-'));
		writeFileSync(path.join(root, 'chunk.js'), leakedChunk, 'utf8');
		const report = scanBuildDirectory(root, { deniedLiterals: draftLiterals });
		expect(report.findings.map((finding) => finding.ruleId)).toContain('operator-denied-literal');
	});

	it('scripts/check-build-output.mjs always folds draft literals into the denylist, unconditionally', () => {
		// Belt and braces over the wiring: this is what makes `//:scanned_build`
		// and `just leak-scan-stamped` (both real-artefact gates) enforce the row
		// above on the actual build/ directory, without an operator having to
		// remember to set GFTB_LEAK_SCAN_DENY.
		const runner = readFileSync(path.join(repoRoot, 'scripts/check-build-output.mjs'), 'utf8');
		expect(runner).toContain("from './lib/log-content.mjs'");
		expect(runner).toContain('distinctiveDraftLiterals');
	});
});

describe('collectFiles fails closed on unknown file types', () => {
	// A scanner whose stated purpose is proving the ABSENCE of secrets must never
	// report "clean" over bytes it silently declined to open. Anything in neither
	// TEXT_EXTENSIONS nor SKIP_EXTENSIONS is a human decision, not a default.
	const publishedTree = (files: Record<string, string>) => {
		const root = mkdtempSync(path.join(tmpdir(), 'gftb-leak-scan-'));
		for (const [relative, text] of Object.entries(files)) {
			const absolute = path.join(root, relative);
			mkdirSync(path.dirname(absolute), { recursive: true });
			writeFileSync(absolute, text, 'utf8');
		}
		return root;
	};

	it('classifies every extension it walks as text or knowingly-opaque', () => {
		for (const extension of TEXT_EXTENSIONS) expect(SKIP_EXTENSIONS.has(extension)).toBe(false);
		expect(TEXT_EXTENSIONS.has('')).toBe(true);
	});

	it('collects the text output and skips the opaque output', () => {
		const root = publishedTree({
			'index.html': '<!doctype html>',
			_headers: 'X-Frame-Options: DENY',
			'nested/app.js': 'export {};',
			'font.woff2': 'binary',
			'photo.png': 'binary',
		});
		expect(collectFiles(root).map((file) => path.relative(root, file))).toEqual([
			'_headers',
			'index.html',
			path.join('nested', 'app.js'),
		]);
	});

	it('throws, naming every offending file, rather than skipping an unknown type', () => {
		const root = publishedTree({
			'index.html': '<!doctype html>',
			'site.webmanifest': '{}',
			'nested/schedule.ics': 'BEGIN:VCALENDAR',
		});
		let raised: unknown;
		try {
			collectFiles(root);
		} catch (error) {
			raised = error;
		}
		expect(raised).toBeInstanceOf(UnclassifiedOutputError);
		const message = (raised as Error).message;
		expect(message).toContain('site.webmanifest');
		expect(message).toContain('schedule.ics');
		expect(message).toContain('TEXT_EXTENSIONS');
		expect(message).toContain('SKIP_EXTENSIONS');
	});

	it('propagates the same failure through the directory scan the gate runs', () => {
		const root = publishedTree({ 'index.html': '<!doctype html>', 'notes.md': '# hi' });
		expect(() => scanBuildDirectory(root)).toThrow(UnclassifiedOutputError);
	});

	it('scans a clean published tree end to end', () => {
		const root = publishedTree({ 'index.html': '<a href="https://greatfallstoolbus.org/">home</a>' });
		const report = scanBuildDirectory(root);
		expect(report.files).toHaveLength(1);
		expect(report.findings).toEqual([]);
	});
});

describe('the leak-scan gate has exactly one implementation', () => {
	const runner = readFileSync(path.join(repoRoot, 'scripts/check-build-output.mjs'), 'utf8');

	it('imports the tested module instead of re-deriving the scan', () => {
		expect(runner).toContain("from './lib/leak-scan.mjs'");
		// The runner may only do CLI work: argv, exit codes, printing. Any of these
		// tokens reappearing here means a second copy of the scanner has grown back.
		for (const forbidden of ['function scanText', 'function collectFiles', 'matchAll(', 'new RegExp(', 'rules:']) {
			expect(runner, `check-build-output.mjs must not re-implement ${forbidden}`).not.toContain(forbidden);
		}
	});
});

describe('the credential ruleset stays unreachable from shipped code', () => {
	// Belt and braces over the file location: scripts/lib is outside the SvelteKit
	// library root, so $lib cannot resolve it, and eslint.config.ts adds a
	// no-restricted-imports guard. This proves the guard's premise still holds.
	const routeFiles: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory)) {
			const absolute = path.join(directory, entry);
			if (statSync(absolute).isDirectory()) {
				walk(absolute);
				continue;
			}
			if (/\.(svelte|ts|js)$/u.test(absolute)) routeFiles.push(absolute);
		}
	};
	walk(path.join(repoRoot, 'src/routes'));
	walk(path.join(repoRoot, 'src/lib/components'));

	it('found the shipped sources it claims to check', () => {
		expect(routeFiles.length).toBeGreaterThan(3);
	});

	it('never imports the test-only modules under scripts/lib', () => {
		for (const file of routeFiles) {
			const source = readFileSync(file, 'utf8');
			expect(source, `${path.relative(repoRoot, file)} imports scripts/lib`).not.toMatch(
				/from\s+['"][^'"]*scripts\/lib\//u,
			);
		}
	});
});
