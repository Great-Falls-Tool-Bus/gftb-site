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
		// Test-only modules live in scripts/lib precisely so shipped code cannot
		// reach them: scripts/lib/leak-scan-rules.json carries credential-detection
		// regexes (ghp_, AKIA/ASIA, glpat-, JWT, kubeconfig fragments) that do not
		// belong in a public client bundle. The file location is the primary
		// defence; this is the second, and src/lib/leak-scan.test.ts asserts it
		// from the other side.
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
			// House canon (TIN-2225): ban the `$derived(() => …)` thunk. Passing an
			// arrow to `$derived` stores the *function* as the rune's value instead
			// of evaluating it — a silent reactivity bug. Correct forms:
			//   • `$derived(expr)`        for a single expression
			//   • `$derived.by(() => …)`  for multi-statement derivations
			// `$derived.by(...)` has a MemberExpression callee, so the selector
			// (Identifier callee named `$derived` with a direct arrow argument)
			// leaves it untouched.
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
