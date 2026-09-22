// Build-time flag for the list-signup capture modal (rehearsal only).
//
// vite.config.ts defines __SUBSCRIBE_CAPTURE__ from PUBLIC_SUBSCRIBE_CAPTURE at
// build time; the default is off. +layout.svelte imports the component only
// inside a branch on this constant, so an off build neither ships nor mounts
// it. vitest evaluates modules without Vite's define step, so the global can
// be absent entirely; the typeof guard keeps that path on the off branch.
export const SUBSCRIBE_CAPTURE_ENABLED: boolean =
	typeof __SUBSCRIBE_CAPTURE__ === 'undefined' ? false : __SUBSCRIBE_CAPTURE__ === true;
