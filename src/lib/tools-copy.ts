// Every new public string for the links into the members Tools pages (operator
// answers on the public Tools pages: they live in the members app, opened up).
// The words below wait for the operator's approval as written.
//
// This module holds words only. The members address stays a literal in the
// markup of src/routes/+layout.svelte and src/routes/+page.svelte, because the
// gated-member-app-url leak-scan rule passes a members URL only on an anchor
// whose data-public-member mark comes before its exact href. A URL constant here
// would reach the client bundle as a bare string and fail that rule.
//
// The members pages carry the tool data: names, photos, status and where each
// tool lives. This site shows none of it, so nothing here can go stale.

/** The header and footer item for the members Tools pages. */
export const TOOLS_LINK_LABEL = 'Tools';

/** The home section that sends visitors to the members Tools pages. */
export const TOOLS_SECTION = {
	heading: 'Tools to borrow',
	paragraphs: [
		'Members borrow tools from the Tool Bus for their projects and repairs.',
		'Anyone can search them and see a photo of each tool and where it lives, since not every tool lives on the bus.',
		'When a tool is out on loan, its page says when it is due back.',
	],
	linkLabel: 'Browse the tools',
} as const;
