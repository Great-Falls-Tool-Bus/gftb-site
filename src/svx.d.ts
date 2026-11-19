// The published log manifest imports individual .svx files as Svelte components.
declare module '*.svx' {
	import type { Component } from 'svelte';

	const component: Component;
	export default component;
	export const metadata: Record<string, unknown>;
}
