// Frontmatter contract for src/content/goals/*.md: the home page's near-term
// goals (`kind: goal`, with a window and an optional CTA), help asks
// (`kind: help`, an ask with a CTA) and member benefits (`kind: benefit`, a
// bullet). Operator-authored 2026-08-31; rows render from files, never from
// baked prose (spec §3 row 4). Mirrors public-log-schema.ts.
import { FEATURED_IMAGE_KEYS, assertFeaturedImageMetadata, type FeaturedImageMetadata } from './featured-image-schema';

export const PUBLIC_GOAL_KINDS = ['goal', 'help', 'benefit'] as const;
export type PublicGoalKind = (typeof PUBLIC_GOAL_KINDS)[number];

export const PUBLIC_GOAL_REQUIRED_KEYS = ['kind', 'order', 'title', 'published'] as const;
/** `source` is internal provenance: read at build time, never emitted to the manifest. */
export const PUBLIC_GOAL_OPTIONAL_KEYS = ['window', 'cta_label', 'cta_href', 'source', ...FEATURED_IMAGE_KEYS] as const;

export interface PublicGoalMetadata extends FeaturedImageMetadata {
	kind: PublicGoalKind;
	order: number;
	title: string;
	/** Plain-English timing, e.g. "Sunday, September 20, 2026" or "After the tax ID". */
	window?: string;
	cta_label?: string;
	/** Site-relative path or https URL; travels with cta_label. */
	cta_href?: string;
	published: boolean;
}

const allowedKeys = new Set<string>([...PUBLIC_GOAL_REQUIRED_KEYS, ...PUBLIC_GOAL_OPTIONAL_KEYS]);
const kinds = new Set<string>(PUBLIC_GOAL_KINDS);

export function assertPublicGoalMetadata(input: unknown, source = 'public goal'): PublicGoalMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error(`${source}: frontmatter must be an object`);
	}
	const record = input as Record<string, unknown>;
	const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
	if (unknownKeys.length > 0) throw new Error(`${source}: unsupported frontmatter keys: ${unknownKeys.join(', ')}`);
	const missingKeys = PUBLIC_GOAL_REQUIRED_KEYS.filter((key) => !(key in record));
	if (missingKeys.length > 0) throw new Error(`${source}: missing frontmatter keys: ${missingKeys.join(', ')}`);

	if (typeof record.kind !== 'string' || !kinds.has(record.kind)) {
		throw new Error(`${source}: kind must be one of ${PUBLIC_GOAL_KINDS.join(', ')}`);
	}
	const order = typeof record.order === 'number' ? record.order : Number.parseInt(String(record.order), 10);
	if (!Number.isInteger(order) || order < 0 || !/^\d+$/u.test(String(record.order))) {
		throw new Error(`${source}: order must be a non-negative integer`);
	}
	if (typeof record.title !== 'string' || record.title.trim().length < 3) {
		throw new Error(`${source}: title must be a useful string`);
	}
	if (typeof record.published !== 'boolean') {
		throw new Error(`${source}: published must be a boolean; drafts carry published: false`);
	}
	if (record.window !== undefined && (typeof record.window !== 'string' || record.window.trim().length === 0)) {
		throw new Error(`${source}: window must be a non-empty string when present`);
	}
	const hasLabel = record.cta_label !== undefined;
	const hasHref = record.cta_href !== undefined;
	if (hasLabel !== hasHref) throw new Error(`${source}: cta_label and cta_href travel together`);
	if (hasLabel) {
		if (typeof record.cta_label !== 'string' || record.cta_label.trim().length < 3) {
			throw new Error(`${source}: cta_label must be a useful string`);
		}
		if (typeof record.cta_href !== 'string' || !/^(\/|https:\/\/)/u.test(record.cta_href)) {
			throw new Error(`${source}: cta_href must be a site-relative path or an https URL`);
		}
	}
	if (record.source !== undefined && typeof record.source !== 'string') {
		throw new Error(`${source}: source must be a string when present`);
	}
	if (/—/u.test(`${record.title} ${record.window ?? ''} ${record.cta_label ?? ''}`)) {
		throw new Error(`${source}: no em dashes in public copy`);
	}
	assertFeaturedImageMetadata(record, source);
	return { ...(record as Omit<PublicGoalMetadata, 'order'>), order } as PublicGoalMetadata;
}
