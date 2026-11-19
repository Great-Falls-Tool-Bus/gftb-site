import { defineConfig } from 'vitest/config';

// SvelteKit 3 resolves #lib/* through package.json imports. The unit suite uses the same
// mapping.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts', 'scripts/**/*.test.mts'],
		environment: 'node',
		globals: true,
		passWithNoTests: false,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			thresholds: {
				lines: 50,
				functions: 50,
				branches: 50,
				statements: 50,
			},
			include: ['src/lib/contact-form.ts', 'src/lib/public-log-schema.ts'],
			exclude: ['**/*.test.ts', '**/*.test.mts', '**/*.test.svelte.ts'],
		},
	},
});
