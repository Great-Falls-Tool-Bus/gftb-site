import type { Component } from 'svelte';
import { assertPublicLogMetadata, type PublicLogMetadata } from './public-log-schema';

// The build-time log pipeline: an eager glob over the content tree with a
// frontmatter decode gate, the demo site's cells.ts pattern
// (greatfallstoolbus.org@origin/main src/lib/data/cells.ts) applied to the
// ratified spec §3 log schema. Every rendered surface — the home row, the
// /log archive and its pagination pages, the /log/<slug> permalinks, the
// sitemap — is driven by THIS module, so no surface can drift.

interface PublicLogModule {
	default: Component;
	metadata: unknown;
}

export interface PublicLog {
	slug: string;
	component: Component;
	metadata: PublicLogMetadata;
	/** Repo-relative .svx path, for the per-post SourceLink (#94 / B1.2). */
	sourcePath: string;
}

/** Older entries per archive page (spec :90-91 pagination, no-JS path). */
export const LOG_PAGE_SIZE = 10;

const modules = import.meta.glob<PublicLogModule>('../content/log/*.svx', { eager: true });

const entries: PublicLog[] = Object.entries(modules).map(([path, module]) => {
	const file = path.split('/').at(-1) ?? path;
	return {
		slug: file.replace(/\.svx$/, ''),
		component: module.default,
		metadata: assertPublicLogMetadata(module.metadata, path),
		sourcePath: `src/content/log/${file}`,
	};
});

// Loader fences (spec §3 :112-116): duplicate dates and slugs are rejected —
// the date prefix is the reader-visible sort key, and two posts on one day
// need a deliberate operator decision, not a silent tie-break.
const seenDates = new Map<string, string>();
for (const entry of entries) {
	if (!entry.slug.startsWith(entry.metadata.date)) {
		throw new Error(`${entry.sourcePath}: filename date prefix must equal the frontmatter date`);
	}
	const previous = seenDates.get(entry.metadata.date);
	if (previous) {
		throw new Error(`duplicate public log date ${entry.metadata.date}: ${previous} and ${entry.slug}`);
	}
	seenDates.set(entry.metadata.date, entry.slug);
}

/**
 * Published entries only, newest first. Unpublished (`published: false`)
 * TODO(jess) drafts are EXCLUDED from production output here, at the one
 * choke point every rendered surface reads (spec §3: the loader rejects
 * unpublished entries in production output).
 */
export const publicLogs: PublicLog[] = entries
	.filter((entry) => entry.metadata.published)
	.sort((left, right) => right.metadata.date.localeCompare(left.metadata.date));

/** Archive pages after the first: /log is page 1, /log/page/<n> follow. */
export function logPageCount(): number {
	return Math.max(1, Math.ceil(publicLogs.length / LOG_PAGE_SIZE));
}

export function logPage(page: number): PublicLog[] {
	return publicLogs.slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE);
}
