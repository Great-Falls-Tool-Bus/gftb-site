// The featured-image frontmatter group, shared by BOTH content schemas
// (public-log-schema.ts and public-goal-schema.ts). Keys are FLAT scalars —
// the shared frontmatter parser (scripts/lib/log-content.mjs) rejects nested
// maps, so `image: {src, alt}` is not representable and must never become
// the shape here.
//
// scripts/lib/featured-image.mjs mirrors the two patterns for the Node-only
// builders; src/lib/featured-image.test.ts pins the mirror against drift.
export const FEATURED_IMAGE_KEYS = ['image', 'image_alt', 'image_caption', 'image_aspect'] as const;

export interface FeaturedImageMetadata {
	/**
	 * Site-relative path under static/ (e.g. `/photos/log/<slug>-1280.jpg`).
	 * Never an external URL: images ship from the static carrier or not at
	 * all. Extensions are drawn from the leak-scan classified sets
	 * (scripts/lib/leak-scan.mjs) so the fail-closed guarantee holds. While
	 * an entry is a draft the file sits in
	 * src/content/log/_assets-pending/<slug>/ with this path already naming
	 * its FUTURE static/ home; it moves in the publishing PR, after the
	 * operator's EXIF/colorspace audit (docs/attribution.md).
	 */
	image?: string;
	/** REQUIRED whenever `image` is present: the two travel together. */
	image_alt?: string;
	image_caption?: string;
	/** CSS aspect-ratio token like `3/2` or `16/9`; only valid with `image`. */
	image_aspect?: string;
}

/**
 * Site-relative, no scheme, no `..` (checked separately), leak-scan-classified
 * extension. The first segment must start with a word character so a
 * protocol-relative `//host/x.png` (an external fetch in the browser) can
 * never satisfy the shape check.
 */
export const IMAGE_SRC_PATTERN = /^\/[\w][\w./-]*\.(?:jpg|jpeg|png|webp|avif|svg)$/u;

/** A small CSS aspect-ratio fraction: nonzero numerator and denominator. */
export const IMAGE_ASPECT_PATTERN = /^[1-9]\d{0,2}\/[1-9]\d{0,2}$/u;

/**
 * Validates the group on an otherwise-checked frontmatter record. Fails
 * closed: an image without alt text, an alt without an image, a caption or
 * aspect on an imageless entry, an off-carrier or traversal path, and an em
 * dash in the public copy are all rejections, never warnings.
 */
export function assertFeaturedImageMetadata(record: Record<string, unknown>, source: string): void {
	const hasImage = record.image !== undefined;
	if (hasImage !== (record.image_alt !== undefined)) {
		throw new Error(`${source}: image and image_alt travel together`);
	}
	if (!hasImage) {
		for (const key of ['image_caption', 'image_aspect'] as const) {
			if (record[key] !== undefined) throw new Error(`${source}: ${key} is only valid alongside image`);
		}
		return;
	}
	if (typeof record.image !== 'string' || record.image.includes('..') || !IMAGE_SRC_PATTERN.test(record.image)) {
		throw new Error(
			`${source}: image must be a site-relative static path ending in .jpg, .jpeg, .png, .webp, .avif, or .svg`,
		);
	}
	if (typeof record.image_alt !== 'string' || record.image_alt.trim().length < 3) {
		throw new Error(`${source}: image_alt must be a useful string`);
	}
	if (
		record.image_caption !== undefined &&
		(typeof record.image_caption !== 'string' || record.image_caption.trim().length === 0)
	) {
		throw new Error(`${source}: image_caption must be a non-empty string when present`);
	}
	if (
		record.image_aspect !== undefined &&
		(typeof record.image_aspect !== 'string' || !IMAGE_ASPECT_PATTERN.test(record.image_aspect))
	) {
		throw new Error(`${source}: image_aspect must be a small fraction like 3/2 or 16/9`);
	}
	if (/—/u.test(`${record.image_alt} ${record.image_caption ?? ''}`)) {
		throw new Error(`${source}: no em dashes in public copy`);
	}
}
