import type { Component } from 'svelte';
import { publishedLogEntries } from './generated/log-manifest';
import type { PublicLogMetadata } from './public-log-schema';

// The home page, archive, permalinks and sitemap share the manifest. Filter unpublished drafts
// before generating imports so their contents stay out of the client bundle.

export interface PublicLog {
	slug: string;
	metadata: PublicLogMetadata;
	/** Repo-relative .svx path for the entry's SourceLink. */
	sourcePath: string;
	/** Load the body when the reader opens the entry. */
	loadComponent: () => Promise<{ default: Component }>;
}

/** Archive page size for pagination without JavaScript. */
export const LOG_PAGE_SIZE = 10;

/** The home page shows up to five of the newest entries. */
export const HOME_LOG_COUNT = 5;

/** One date formatter for every log surface (home row, archive, permalink). */
export const formatLogDate = (value: string): string =>
	new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));

/** Skip a summary that would repeat the title. */
export const summaryDiffersFromTitle = (metadata: { title: string; summary: string }): boolean =>
	metadata.summary.trim() !== metadata.title.trim();

/** The manifest contains only published entries. Sort them newest first. */
export const publicLogs: PublicLog[] = [...publishedLogEntries].sort((left, right) =>
	right.metadata.date.localeCompare(left.metadata.date),
);

/** Archive pages after the first: /log is page 1, /log/page/<n> follow. */
export function logPageCount(): number {
	return Math.max(1, Math.ceil(publicLogs.length / LOG_PAGE_SIZE));
}

export function logPage(page: number): PublicLog[] {
	return publicLogs.slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE);
}
