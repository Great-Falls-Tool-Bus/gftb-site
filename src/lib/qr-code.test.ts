import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeQrSvg, parseQrSvg, serializeQrPath } from '../../scripts/lib/qr-code.mjs';

// Acceptance row: the printed QR payload resolves to the canonical apex URL and
// the shipped SVG source is byte-reproducible. Nobody can proofread a QR code by
// eye, so this decodes the artefact that actually ships in `static/`.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qrPath = path.join(repoRoot, 'static/qr/greatfallstoolbus-apex.svg');
const qrBytes = readFileSync(qrPath);
const qrSource = qrBytes.toString('utf8');

const CANONICAL_APEX_URL = 'https://greatfallstoolbus.org/';
// `just qr-generate` output for the canonical apex URL, qrencode 4.1.1,
// --type=SVG --svg-path --level=H --margin=2 --size=4. Regenerating the code
// for the same payload must reproduce these bytes exactly; if this hash moves,
// the printed artefact changed and needs a fresh proof, not a new golden.
const QR_SHA256 = 'e72aeb84cf028b2d1070cd916925ac1b82869cc7874ba856e33f88478b900580';

describe('printed apex QR code', () => {
	it('decodes to the canonical apex URL', () => {
		const decoded = decodeQrSvg(qrSource);
		expect(decoded.text).toBe(CANONICAL_APEX_URL);
		expect(decoded.byteLength).toBe(CANONICAL_APEX_URL.length);
		expect(decoded.errorCorrectionLevel).toBe('H');
		expect(decoded.version).toBe(4);
		expect(decoded.maskPattern).toBeGreaterThanOrEqual(0);
		expect(decoded.maskPattern).toBeLessThanOrEqual(7);
	});

	it('encodes the apex over https with no tracking parameters or redirector', () => {
		const url = new URL(decodeQrSvg(qrSource).text);
		expect(url.protocol).toBe('https:');
		expect(url.hostname).toBe('greatfallstoolbus.org');
		expect(url.port).toBe('');
		expect(url.pathname).toBe('/');
		expect(url.search).toBe('');
		expect(url.hash).toBe('');
		expect(url.username).toBe('');
	});

	it('matches the apex URL the page prints beside it', () => {
		// The printed QR rides the contact page (B1.4: the demo /contact
		// architecture, restored — the form and the printed address live on
		// their own page, never the root).
		const page = readFileSync(path.join(repoRoot, 'src/routes/contact/+page.svelte'), 'utf8');
		expect(page).toContain('/qr/greatfallstoolbus-apex.svg');
		expect(page).toContain('greatfallstoolbus.org');
		const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			homepage?: string;
		};
		expect(`${packageJson.homepage}/`).toBe(CANONICAL_APEX_URL);
	});

	// The generator's own parameters are proven by `just qr-verify`, which
	// regenerates the code from the canonical URL and byte-compares it. The
	// Justfile is not part of the hermetic unit-test workspace, so asserting on
	// its text here would only be a copy of that recipe, not a check of it.

	it('carries the geometry the generator recipe asks for', () => {
		const geometry = parseQrSvg(qrSource);
		expect(geometry.margin).toBe(2);
		expect(geometry.version).toBe(4);
		expect(geometry.size).toBe(33);
		expect(geometry.viewBox).toBe(geometry.size + 2 * geometry.margin);
		expect(geometry.modules).toHaveLength(geometry.size);
		for (const row of geometry.modules) expect(row).toHaveLength(geometry.size);
		// Quiet zone: the four sides of the module grid still leave `margin`
		// modules of white inside the viewBox, so the code stays scannable when
		// printed against a coloured surface.
		expect(geometry.margin).toBeGreaterThanOrEqual(2);
	});

	it('is byte-reproducible: the path is a pure function of the module matrix', () => {
		const geometry = parseQrSvg(qrSource);
		const shippedPath = / d="([^"]+)"/u.exec(qrSource)?.[1];
		expect(shippedPath, 'shipped module path').toBeTruthy();
		expect(serializeQrPath(geometry.modules)).toBe(shippedPath);
	});

	it('is byte-reproducible: the artefact hashes to its recorded digest', () => {
		expect(createHash('sha256').update(qrBytes).digest('hex')).toBe(QR_SHA256);
	});

	it('carries no build-varying content that would break reproducibility', () => {
		expect(qrSource).not.toMatch(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
		expect(qrSource).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
		expect(qrSource).not.toMatch(/<script|onload=|xlink:href/iu);
		// Exactly one generator comment, pinning the encoder that produced it.
		expect([...qrSource.matchAll(/<!--/gu)]).toHaveLength(1);
		expect(qrSource).toContain('Created with qrencode 4.1.1');
	});
});

describe('QR reader guard rails', () => {
	it('refuses a symbol whose path carries commands other than module runs', () => {
		const tampered = qrSource.replace(' d="M', ' d="L4,4M');
		expect(() => parseQrSvg(tampered)).toThrow(/beyond horizontal runs/u);
	});

	it('refuses a viewBox that does not describe a real QR symbol', () => {
		const tampered = qrSource.replace('viewBox="0 0 37 37"', 'viewBox="0 0 36 36"');
		expect(() => parseQrSvg(tampered)).toThrow(/not a valid QR symbol size/u);
	});

	it('does not silently repair a corrupted symbol', () => {
		const geometry = parseQrSvg(qrSource);
		// The bottom-right corner is the first module of the first data codeword,
		// so flipping it corrupts the payload rather than the parity that would be
		// silently repaired by a Reed-Solomon decoder.
		const last = geometry.size - 1;
		const flipped = geometry.modules.map((row) => [...row]);
		flipped[last][last] = !flipped[last][last];
		const rebuilt = qrSource.replace(/ d="[^"]+"/u, ` d="${serializeQrPath(flipped)}"`);
		const decoded = (() => {
			try {
				return decodeQrSvg(rebuilt).text;
			} catch {
				return null;
			}
		})();
		expect(decoded).not.toBe(CANONICAL_APEX_URL);
	});
});
