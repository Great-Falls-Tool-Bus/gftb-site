import type { Component } from 'svelte';
import { assertPublicLogMetadata, type PublicLogMetadata } from './public-log-schema';

interface PublicLogModule {
	default: Component;
	metadata: unknown;
}

export interface PublicLog {
	slug: string;
	component: Component;
	metadata: PublicLogMetadata;
}

const modules = import.meta.glob<PublicLogModule>('../content/log/*.svx', { eager: true });

export const publicLogs: PublicLog[] = Object.entries(modules)
	.map(([path, module]) => ({
		slug:
			path
				.split('/')
				.at(-1)
				?.replace(/\.svx$/, '') ?? path,
		component: module.default,
		metadata: assertPublicLogMetadata(module.metadata, path),
	}))
	.filter((entry) => entry.metadata.published)
	.sort((left, right) => right.metadata.date.localeCompare(left.metadata.date));
