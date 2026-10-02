import { publishedHoursEntries, type GeneratedHoursEntry } from './generated/hours-manifest';
import { HOURS_WEEKDAYS, type PublicHoursSlot } from './public-hours-schema';

// Staffed work sessions on the bus render from src/content/hours/*.json
// through the checked-in, drift-checked manifest
// (scripts/build-hours-manifest.mjs): published slots only, and no dates.
// Dates come from src/lib/hours-recurrence.ts on the visitor's clock.

export type PublicHoursEntry = GeneratedHoursEntry;

const byWeekThenTime = (left: PublicHoursEntry, right: PublicHoursEntry): number =>
	HOURS_WEEKDAYS.indexOf(left.slot.weekday) - HOURS_WEEKDAYS.indexOf(right.slot.weekday) ||
	left.slot.start.localeCompare(right.slot.start) ||
	left.id.localeCompare(right.id);

/** Published entries, Monday first, then by start time. */
export const publicHoursEntries: PublicHoursEntry[] = [...publishedHoursEntries].sort(byWeekThenTime);

/** The slots alone, in the same order, ready for expandSlot / upcomingSessions. */
export const publicHoursSlots: PublicHoursSlot[] = publicHoursEntries.map((entry) => entry.slot);
