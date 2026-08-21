// Minimal, dependency-free PNG decoder (8-bit RGB/RGBA, non-interlaced) plus
// a luminance scan. Exists so acceptance-hero-glass-contrast.spec.ts can
// measure the REAL rendered pixels behind a backdrop-filter panel — the
// point of that spec (review round 2, finding B: a token-math model of the
// composite silently diverged from what the browser actually painted). No
// image-processing dependency is added to the project for this: PNG's
// filter reconstruction is a few dozen lines against Node's built-in zlib.

import { inflateSync } from 'node:zlib';

export interface Rgb {
	red: number;
	green: number;
	blue: number;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	if (pb <= pc) return b;
	return c;
}

/** Decodes a PNG buffer to { width, height, channels, pixels }. */
export function decodePng(buffer: Buffer): { width: number; height: number; channels: number; pixels: Buffer } {
	if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (bad signature)');
	let pos = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	const idatChunks: Buffer[] = [];
	while (pos < buffer.length) {
		const length = buffer.readUInt32BE(pos);
		const type = buffer.toString('ascii', pos + 4, pos + 8);
		const chunk = buffer.subarray(pos + 8, pos + 8 + length);
		pos += 8 + length + 4;
		if (type === 'IHDR') {
			width = chunk.readUInt32BE(0);
			height = chunk.readUInt32BE(4);
			bitDepth = chunk.readUInt8(8);
			colorType = chunk.readUInt8(9);
		} else if (type === 'IDAT') {
			idatChunks.push(chunk);
		} else if (type === 'IEND') {
			break;
		}
	}
	if (bitDepth !== 8) throw new Error(`only 8-bit PNGs are supported, got bit depth ${bitDepth}`);
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
	if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);

	const raw = inflateSync(Buffer.concat(idatChunks));
	const stride = width * channels;
	const pixels = Buffer.alloc(height * stride);
	let prevRow = Buffer.alloc(stride);
	let rp = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[rp];
		rp += 1;
		const row = Buffer.from(raw.subarray(rp, rp + stride));
		rp += stride;
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? row[i - channels] : 0;
			const b = prevRow[i];
			const c = i >= channels ? prevRow[i - channels] : 0;
			let predicted = 0;
			switch (filter) {
				case 0:
					break;
				case 1:
					predicted = a;
					break;
				case 2:
					predicted = b;
					break;
				case 3:
					predicted = Math.floor((a + b) / 2);
					break;
				case 4:
					predicted = paeth(a, b, c);
					break;
				default:
					throw new Error(`bad PNG filter byte ${filter}`);
			}
			row[i] = (row[i] + predicted) & 0xff;
		}
		row.copy(pixels, y * stride);
		prevRow = row;
	}
	return { width, height, channels, pixels };
}

function srgbToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0-1. */
export function relativeLuminance({ red, green, blue }: Rgb): number {
	return 0.2126 * srgbToLinear(red) + 0.7152 * srgbToLinear(green) + 0.0722 * srgbToLinear(blue);
}

/**
 * Scans a decoded PNG (inset by `margin` px on every edge, to dodge
 * anti-aliased clip-region fringes) for the darkest and lightest pixel by
 * WCAG relative luminance.
 */
export function luminanceExtremes(
	image: { width: number; height: number; channels: number; pixels: Buffer },
	margin = 4,
) {
	let darkest: { luminance: number; rgb: Rgb } | undefined;
	let lightest: { luminance: number; rgb: Rgb } | undefined;
	for (let y = margin; y < image.height - margin; y++) {
		for (let x = margin; x < image.width - margin; x++) {
			const idx = (y * image.width + x) * image.channels;
			const rgb: Rgb = { red: image.pixels[idx], green: image.pixels[idx + 1], blue: image.pixels[idx + 2] };
			const luminance = relativeLuminance(rgb);
			if (!darkest || luminance < darkest.luminance) darkest = { luminance, rgb };
			if (!lightest || luminance > lightest.luminance) lightest = { luminance, rgb };
		}
	}
	if (!darkest || !lightest) throw new Error('luminanceExtremes: crop region too small to scan (check margin)');
	return { darkest, lightest };
}
