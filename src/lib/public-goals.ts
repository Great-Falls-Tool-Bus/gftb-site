import { publishedGoalEntries, type GeneratedGoalEntry } from './generated/goals-manifest';

// The home page reads published goals from the manifest built by
// scripts/build-goals-manifest.mjs.

export type PublicGoal = GeneratedGoalEntry;

const byOrder = (left: PublicGoal, right: PublicGoal): number =>
	left.metadata.order - right.metadata.order || left.slug.localeCompare(right.slug);

const ofKind = (kind: PublicGoal['metadata']['kind']): PublicGoal[] =>
	publishedGoalEntries.filter((entry) => entry.metadata.kind === kind).sort(byOrder);

/** The order field sets the timeline sequence. */
export const publicGoals: PublicGoal[] = ofKind('goal');
/** Specific asks with a CTA each. */
export const publicHelpAsks: PublicGoal[] = ofKind('help');
/** What every member gets once membership opens. */
export const memberBenefits: PublicGoal[] = ofKind('benefit');
