# Changelog

All notable changes to the `gftb_site` Bazel module (this repository and its
`@gftb/site-draft-compiler` package) are recorded here. The module is
distributed through the Tinyland Bazel registry (`xoxd-ai/bazel-registry`)
only; nothing is published to npm.

## 1.0.0 (2026-10-15)

The site moves to the house frontend stack (SvelteKit 3, TypeScript 7). The
peer and runtime stack changed, so this is a major version.

### Changed

- Exact pins: `@sveltejs/kit` 3.0.1, `svelte` 5.57.2, `vite` 8.3.3,
  `typescript` 7.0.2, `@sveltejs/vite-plugin-svelte` 7.3.1,
  `@sveltejs/adapter-static` 4.0.0, `vitest` and `@vitest/coverage-v8` 5.0.3,
  `@playwright/test` 1.64.0, `svelte-check` 4.7.6. Skeleton and Skeleton
  Svelte stay at 5.0.1.
- Node: the engine range is `^22.17.0 || >=24 <25` (SvelteKit 3 needs
  Node 22.17 or later) and the Bazel Node toolchain is 22.22.0.
- SvelteKit 3 no longer reads `svelte.config.js`. Its options moved, unchanged,
  to `kit.config.js`, which `vite.config.ts` passes to `sveltekit()`. The
  former `kit.*` block is now top level in that object.
- SvelteKit 3 removed the `$lib` alias. Imports use the Node subpath import
  `#lib/*` (`package.json` `imports`), with an explicit extension: `.svelte`
  for components, `.js` for TypeScript modules (`#lib/public-logs.js`), and
  `.svelte.js` for rune modules (`#lib/theme.svelte.js`).
- `tsconfig.json` extends `$app/tsconfig` (written by `svelte-kit sync` under
  `node_modules/$app`) and lists `include`.
- Type checking is `svelte-check --tsgo`: TypeScript 7.0.2 checks every
  `.svelte` and `.ts` file. The new `//:svelte_check_canary_test` seeds one
  `.ts` and one `.svelte` error and fails unless both are reported.
- TypeScript 7 has no in-process JavaScript API. The shared patch set from
  `xoxd-ai/site.scaffold` is copied verbatim: `patches/`, `.pnpmfile.cjs` and
  the pnpm settings in `pnpm-workspace.yaml`. Kit sync, svelte2tsx and
  typescript-eslint load `@typescript/typescript6` 6.0.2 as their parser
  (operator ruling RU13b); nothing type-checks with it. See
  `patches/README.md` for the exact gaps.
- Bazel: `aspect_rules_ts` 3.10.1 with `typescript.deps(version = "7.0.2")`;
  `npm_translate_lock` declares the pnpm hook and every patch as inputs.
- First-party modules: `tummycrypt_vite_plugin_a11y` 1.0.0 and
  `tummycrypt_tinyvectors` 1.0.0. The registry pin in `.bazelrc` moved from
  `tinyland-inc/bazel-registry` to its canonical home, `xoxd-ai/bazel-registry`.
- `@gftb/site-draft-compiler` is 1.0.0; its runtime closure is the locked
  `svelte` 5.57.2, `mdsvex`, `prettier` and `prettier-plugin-svelte`.
- Dependabot ignores the exact stack pins above (one grouped weekly PR for
  everything else).

### Migration

1. Consumers of the module (for example `greatfallstoolbus.org`) re-pin with
   `bazel_dep(name = "gftb_site", version = "1.0.0")` and refresh
   `MODULE.bazel.lock`. The compiler API is unchanged; its package version is
   1.0.0 and it brings `svelte` 5.57.2.
2. A checkout needs Node 22.17 or later and pnpm 10.13.1 (`packageManager`).
   Run `just setup` again: the lockfile changed, and the install applies the
   patches in `patches/`.
3. New code imports library modules as `#lib/...` with an explicit extension,
   never `$lib/...`. Configure SvelteKit in `kit.config.js`; do not add a
   `svelte.config.js` (SvelteKit 3 fails the build when one exists).
4. Shared types that other modules import belong in a `.ts` module, not in a
   `.svelte` file's `<script module>` block (under `--tsgo` such exports are
   not visible through `#lib/...`).
