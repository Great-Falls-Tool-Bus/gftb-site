/**
 * Node-only mirror of the featured-image frontmatter group
 * (src/lib/featured-image-schema.ts is the binding contract; the patterns
 * here are pinned byte-for-byte against it by src/lib/featured-image.test.ts,
 * the same mirroring posture scripts/build-goals-manifest.mjs already takes
 * toward its schema). The manifest builders call these so an invalid or
 * dangling image never reaches a generated manifest — `just check` fails
 * instead.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

export const FEATURED_IMAGE_KEYS = ['image', 'image_alt', 'image_caption', 'image_aspect'];

/** Mirrors IMAGE_SRC_PATTERN in src/lib/featured-image-schema.ts. */
export const IMAGE_SRC_PATTERN = /^\/[\w][\w./-]*\.(?:jpg|jpeg|png|webp|avif|svg)$/u;

/** Mirrors IMAGE_ASPECT_PATTERN in src/lib/featured-image-schema.ts. */
export const IMAGE_ASPECT_PATTERN = /^[1-9]\d{0,2}\/[1-9]\d{0,2}$/u;

/**
 * The same fail-closed group checks as assertFeaturedImageMetadata, for the
 * builders that cannot import TypeScript.
 *
 * @param {Record<string, unknown>} metadata
 * @param {string} source
 */
export function assertFeaturedImageFrontmatter(metadata, source) {
	const hasImage = metadata.image !== undefined;
	if (hasImage !== (metadata.image_alt !== undefined)) {
		throw new Error(`${source}: image and image_alt travel together`);
	}
	if (!hasImage) {
		for (const key of ['image_caption', 'image_aspect']) {
			if (metadata[key] !== undefined) throw new Error(`${source}: ${key} is only valid alongside image`);
		}
		return;
	}
	if (typeof metadata.image !== 'string' || metadata.image.includes('..') || !IMAGE_SRC_PATTERN.test(metadata.image)) {
		throw new Error(
			`${source}: image must be a site-relative static path ending in .jpg, .jpeg, .png, .webp, .avif, or .svg`,
		);
	}
	if (typeof metadata.image_alt !== 'string' || metadata.image_alt.trim().length < 3) {
		throw new Error(`${source}: image_alt must be a useful string`);
	}
	if (
		metadata.image_caption !== undefined &&
		(typeof metadata.image_caption !== 'string' || String(metadata.image_caption).trim().length === 0)
	) {
		throw new Error(`${source}: image_caption must be a non-empty string when present`);
	}
	if (
		metadata.image_aspect !== undefined &&
		(typeof metadata.image_aspect !== 'string' || !IMAGE_ASPECT_PATTERN.test(metadata.image_aspect))
	) {
		throw new Error(`${source}: image_aspect must be a small fraction like 3/2 or 16/9`);
	}
	if (/—/u.test(`${metadata.image_alt} ${metadata.image_caption ?? ''}`)) {
		throw new Error(`${source}: no em dashes in public copy`);
	}
}

/**
 * A PUBLISHED entry's image must resolve to a real committed asset under
 * static/ at build time — a dangling path breaks the manifest build, and
 * with it `just log-manifest-check` / `just goals-manifest-check` inside
 * `just check`. Draft (`published: false`) entries are exempt on purpose:
 * their frontmatter already names the FUTURE static/ path while the bytes
 * wait in src/content/log/_assets-pending/<slug>/ (the 5f11f40 convention),
 * and the file moves only in the PR that flips `published: true`.
 *
 * @param {Record<string, unknown>} metadata
 * @param {string} source
 * @param {string} repoRoot
 */
export function assertPublishedImageAsset(metadata, source, repoRoot) {
	if (typeof metadata.image !== 'string') return;
	const asset = path.join(repoRoot, 'static', metadata.image);
	if (!existsSync(asset)) {
		throw new Error(
			`${source}: image ${metadata.image} has no committed asset at static${metadata.image}; ` +
				'published entries must ship their image from the static carrier',
		);
	}
}
