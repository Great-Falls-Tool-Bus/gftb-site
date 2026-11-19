import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				extraFileExtensions: ['.svelte'],
			},
		},
	},
	{
		// Keep scripts/lib/leak-scan-rules.json and its detection patterns out of the public
		// client bundle. src/lib/leak-scan.test.ts also checks this boundary.
		files: ['src/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/scripts/lib/*', '**/scripts/lib/**'],
							message:
								'scripts/lib/* is acceptance-test-only (it carries credential regexes). Shipped code under src/ must not import it; test files reach it by relative path from src/lib/*.test.ts only.',
						},
					],
				},
			],
		},
	},
	{
		// The unit suite is the one caller allowed to reach the test-only modules.
		files: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts'],
		rules: {
			'no-restricted-imports': 'off',
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'error',
			// TIN-2225: a direct arrow makes $derived store the function itself.
			// Use $derived(expr) for an expression or $derived.by(() => …) for a callback.
			'no-restricted-syntax': [
				'error',
				{
					selector: "CallExpression[callee.type='Identifier'][callee.name='$derived'] > ArrowFunctionExpression",
					message:
						'Do not pass an arrow-function thunk to $derived(...). Use $derived(expr) for an expression, or $derived.by(() => …) for a multi-statement derivation.',
				},
			],
			// Svelte 5 / Skeleton 4 adjustments
			'svelte/no-at-html-tags': 'warn',
			'svelte/no-dom-manipulating': 'off',
			'svelte/require-each-key': 'error',
			'svelte/no-navigation-without-resolve': 'off',
		},
	},
	{
		ignores: [
			'build/',
			'**/build/**',
			'.svelte-kit/',
			'**/.svelte-kit/**',
			'dist/',
			'**/dist/**',
			'node_modules/',
			'**/node_modules/**',
			'scripts/',
			'static/',
			'coverage/',
			'**/coverage/**',
			'test-results/',
			'playwright-report/',
			'.claude/',
			'.claude/**',
			'.serena/',
			'.serena/**',
			'.aider*',
			'bazel-*',
			'bazel-*/**',
			'*.config.*',
		],
	},
);
