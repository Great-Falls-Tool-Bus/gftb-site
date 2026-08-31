import { publishedGoalEntries, type GeneratedGoalEntry } from './generated/goals-manifest';

// The home page's "Near-term goals" row (spec §3 row 4) renders from
// src/content/goals/*.md through the checked-in, drift-checked manifest
// (scripts/build-goals-manifest.mjs), the same build-time pattern as the
// public log: published entries only, nothing baked into the page.

export type PublicGoal = GeneratedGoalEntry;

const byOrder = (left: PublicGoal, right: PublicGoal): number =>
	left.metadata.order - right.metadata.order || left.slug.localeCompare(right.slug);

const ofKind = (kind: PublicGoal['metadata']['kind']): PublicGoal[] =>
	publishedGoalEntries.filter((entry) => entry.metadata.kind === kind).sort(byOrder);

/** Timeline items, soonest first (operator-ordered via `order`). */
export const publicGoals: PublicGoal[] = ofKind('goal');
/** Specific asks with a CTA each. */
export const publicHelpAsks: PublicGoal[] = ofKind('help');
/** What every member gets once membership opens. */
export const memberBenefits: PublicGoal[] = ofKind('benefit');
