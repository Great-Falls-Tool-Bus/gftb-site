export const PUBLIC_LOG_REQUIRED_KEYS = ['date', 'title', 'summary', 'tags', 'published'] as const;
export const PUBLIC_LOG_OPTIONAL_KEYS = ['updated'] as const;

export interface PublicLogMetadata {
	date: string;
	title: string;
	summary: string;
	tags: string[];
	/**
	 * Publication gate (spec §3): `true` is the only value production OUTPUT
	 * may carry — the loader (src/lib/public-logs.ts) excludes `false` drafts
	 * from every rendered index, page, and feed. `false` files may sit in the
	 * content tree as operator-pending TODO(jess) drafts (addendum B1.2: all
	 * agent-drafted text ships as published:false drafts).
	 */
	published: boolean;
	updated?: string;
}

const allowedKeys = new Set<string>([...PUBLIC_LOG_REQUIRED_KEYS, ...PUBLIC_LOG_OPTIONAL_KEYS]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !isoDate.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function assertPublicLogMetadata(input: unknown, source = 'public log'): PublicLogMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error(`${source}: frontmatter must be an object`);
	}

	const record = input as Record<string, unknown>;
	const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(`${source}: unsupported public frontmatter keys: ${unknownKeys.join(', ')}`);
	}

	const missingKeys = PUBLIC_LOG_REQUIRED_KEYS.filter((key) => !(key in record));
	if (missingKeys.length > 0) {
		throw new Error(`${source}: missing public frontmatter keys: ${missingKeys.join(', ')}`);
	}

	if (!isValidIsoDate(record.date)) throw new Error(`${source}: date must be YYYY-MM-DD`);
	if (typeof record.title !== 'string' || record.title.trim().length < 3) {
		throw new Error(`${source}: title must be a useful string`);
	}
	if (typeof record.summary !== 'string' || record.summary.trim().length < 12) {
		throw new Error(`${source}: summary must be a useful string`);
	}
	if (
		!Array.isArray(record.tags) ||
		record.tags.length === 0 ||
		record.tags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0)
	) {
		throw new Error(`${source}: tags must be a non-empty string array`);
	}
	if (typeof record.published !== 'boolean') {
		throw new Error(`${source}: published must be a boolean; drafts carry published: false`);
	}
	if (record.updated !== undefined && !isValidIsoDate(record.updated)) {
		throw new Error(`${source}: updated must be YYYY-MM-DD when present`);
	}
	if (typeof record.updated === 'string' && record.updated < record.date) {
		throw new Error(`${source}: updated cannot predate date`);
	}

	return record as unknown as PublicLogMetadata;
}
