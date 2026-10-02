import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	assertHoursEntry,
	distinctiveDraftHoursLiterals,
	readHoursEntries,
	renderHoursManifestSource,
} from '../../scripts/lib/hours-content.mjs';
import { assertPublicHoursSlot, isGeneratedOccurrence } from './public-hours-schema';
import { isValidIsoDate } from './public-log-schema';

const EM_DASH = '—';
const hoursDir = path.resolve(__dirname, '../content/hours');

const valid = {
	id: 'thursday-weekly',
	published: true,
	weekday: 'thursday',
	start: '15:00',
	end: '16:00',
	timezone: 'America/New_York',
	staff: ['Jess'],
	repeat: { kind: 'weekly', startsOn: '2026-10-02' },
	skip: ['2026-10-15'],
	location: 'the bus',
	notes: 'Bring work gloves if you have them.',
	source: 'operator interview 2026-10-02',
};

type Fixture = Record<string, unknown>;

// Every shape the contract refuses. Each one is refused by BOTH the binding
// schema and the generator's mirror (scripts/lib/hours-content.mjs).
const rejected: Array<[string, Fixture, RegExp]> = [
	['an unknown top-level key', { ...valid, room: 'front' }, /unsupported hours keys/u],
	['an unknown repeat key', { ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', every: 2 } }, /repeat/u],
	['a missing required key', { ...valid, timezone: undefined }, /timezone/u],
	['an em dash in any string', { ...valid, notes: `Gloves ${EM_DASH} if you have them` }, /em dash/u],
	['an em dash in source', { ...valid, source: `operator ${EM_DASH} 2026-10-02` }, /em dash/u],
	['a non-kebab id', { ...valid, id: 'Thursday_Weekly' }, /id/u],
	['a non-boolean published', { ...valid, published: 'false' }, /published/u],
	['an unknown weekday', { ...valid, weekday: 'thursdays' }, /weekday/u],
	['a malformed time', { ...valid, start: '3:00' }, /start/u],
	['a 01:30 start', { ...valid, start: '01:30' }, /start/u],
	['an end after 23:00', { ...valid, end: '23:30' }, /end/u],
	['an end before the start', { ...valid, start: '16:00', end: '15:00' }, /end/u],
	['an end equal to the start', { ...valid, end: '15:00' }, /end/u],
	['another timezone', { ...valid, timezone: 'America/Chicago' }, /timezone/u],
	['more than 3 staff', { ...valid, staff: ['Jess', 'Jess', 'Jess', 'Jess'] }, /staff/u],
	['a name without consent', { ...valid, staff: ['Pat'] }, /staff/u],
	['a repeated name', { ...valid, staff: ['Jess', 'Jess'] }, /staff/u],
	['staff that is not a list', { ...valid, staff: 'Jess' }, /staff/u],
	['an unknown repeat kind', { ...valid, repeat: { kind: 'daily', startsOn: '2026-10-02' } }, /repeat\.kind/u],
	['an invalid startsOn', { ...valid, repeat: { kind: 'weekly', startsOn: '2026-02-30' } }, /startsOn/u],
	[
		'count and until together',
		{ ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 2, until: '2026-12-31' } },
		/count/u,
	],
	['a zero count', { ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 0 } }, /count/u],
	['a fractional count', { ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 1.5 } }, /count/u],
	[
		'until before the first occurrence',
		{ ...valid, skip: undefined, repeat: { kind: 'weekly', startsOn: '2026-10-02', until: '2026-10-05' } },
		/until/u,
	],
	['a once repeat with a count', { ...valid, repeat: { kind: 'once', startsOn: '2026-10-08', count: 1 } }, /once/u],
	['a once repeat off its weekday', { ...valid, repeat: { kind: 'once', startsOn: '2026-10-02' } }, /once/u],
	['a skip date that is not an occurrence', { ...valid, skip: ['2026-10-16'] }, /not a generated occurrence/u],
	['a skip date before the first occurrence', { ...valid, skip: ['2026-10-01'] }, /not a generated occurrence/u],
	[
		'a skip date past the counted series',
		{ ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 2 }, skip: ['2026-10-22'] },
		/not a generated occurrence/u,
	],
	['a repeated skip date', { ...valid, skip: ['2026-10-15', '2026-10-15'] }, /skip/u],
	['any other location', { ...valid, location: 'the shop' }, /location/u],
	['notes over 200 characters', { ...valid, notes: 'x'.repeat(201) }, /notes/u],
	['empty notes', { ...valid, notes: '  ' }, /notes/u],
	['a tracker id in source', { ...valid, source: 'see ABC-123' }, /source/u],
];

const withoutUndefined = (fixture: Fixture): Fixture =>
	Object.fromEntries(Object.entries(fixture).filter(([, value]) => value !== undefined));

describe('assertPublicHoursSlot', () => {
	it('accepts a complete slot and drops the internal source key', () => {
		const slot = assertPublicHoursSlot(valid, 'valid', 'thursday-weekly');
		expect(slot.weekday).toBe('thursday');
		expect(slot.skip).toEqual(['2026-10-15']);
		expect('source' in slot).toBe(false);
	});

	it('accepts an empty staff list, which renders as "a keyholder"', () => {
		expect(assertPublicHoursSlot({ ...valid, staff: [] }).staff).toEqual([]);
	});

	it('accepts the edges of the day, a counted series, an until series, and a once slot', () => {
		expect(() => assertPublicHoursSlot({ ...valid, start: '06:00', end: '23:00' })).not.toThrow();
		expect(() =>
			assertPublicHoursSlot({ ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 3 } }),
		).not.toThrow();
		expect(() =>
			assertPublicHoursSlot({ ...valid, repeat: { kind: 'weekly', startsOn: '2026-10-02', until: '2026-10-15' } }),
		).not.toThrow();
		expect(() =>
			assertPublicHoursSlot({ ...valid, skip: undefined, repeat: { kind: 'once', startsOn: '2026-10-08' } }),
		).not.toThrow();
	});

	it('requires the id to equal the file stem when one is given', () => {
		expect(() => assertPublicHoursSlot(valid, 'x.json', 'monday-october')).toThrow(/file stem/u);
	});

	for (const [label, fixture, message] of rejected) {
		it(`rejects ${label}, in the schema and in the generator mirror`, () => {
			const input = withoutUndefined(fixture);
			expect(() => assertPublicHoursSlot(input, 'fixture')).toThrow(message);
			const stem = typeof input.id === 'string' ? input.id : 'thursday-weekly';
			expect(() =>
				assertHoursEntry({ file: `${stem}.json`, id: stem, sourcePath: `src/content/hours/${stem}.json`, data: input }),
			).toThrow();
		});
	}

	it('the mirror accepts what the schema accepts', () => {
		expect(() =>
			assertHoursEntry({
				file: 'thursday-weekly.json',
				id: 'thursday-weekly',
				sourcePath: 'src/content/hours/thursday-weekly.json',
				data: valid,
			}),
		).not.toThrow();
	});

	it('knows the generated occurrences of a series', () => {
		const slot = assertPublicHoursSlot(valid);
		expect(isGeneratedOccurrence(slot, '2026-10-08')).toBe(true);
		expect(isGeneratedOccurrence(slot, '2026-10-02')).toBe(false);
		expect(isGeneratedOccurrence(slot, '2027-01-07')).toBe(true);
	});

	it('exports the shared ISO date check', () => {
		expect(isValidIsoDate('2026-10-08')).toBe(true);
		expect(isValidIsoDate('2026-02-30')).toBe(false);
	});

	it('validates every file in src/content/hours', () => {
		const files = readdirSync(hoursDir).filter((file) => file.endsWith('.json'));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const raw = readFileSync(path.join(hoursDir, file), 'utf8');
			const stem = file.replace(/\.json$/u, '');
			expect(() => assertPublicHoursSlot(JSON.parse(raw), file, stem)).not.toThrow();
		}
		for (const entry of readHoursEntries(hoursDir)) expect(() => assertHoursEntry(entry)).not.toThrow();
	});
});

describe('hours manifest', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const published = {
		file: 'friday-test.json',
		id: 'friday-test',
		sourcePath: 'src/content/hours/friday-test.json',
		data: { ...valid, id: 'friday-test', weekday: 'friday', skip: undefined, source: 'fixture' },
	};

	it('renders identical bytes under two fake clocks', () => {
		const entries = [...readHoursEntries(hoursDir), published];
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-02T16:00:00Z'));
		const first = renderHoursManifestSource(entries);
		vi.setSystemTime(new Date('2027-03-14T06:30:00Z'));
		const second = renderHoursManifestSource(entries);
		expect(second).toBe(first);
		expect(first).toContain('id: "friday-test"');
	});

	it('never reads the wall clock in the reader and renderer the generator delegates to', () => {
		// scripts/build-hours-manifest.mjs only reads, renders through this
		// module, and runs Prettier; //:hours_manifest_drift_test checks its bytes.
		const source = readFileSync(path.resolve(__dirname, '../../scripts/lib/hours-content.mjs'), 'utf8');
		expect(source).not.toMatch(/Date\.now\(|new Date\(\)|performance\.now\(/u);
	});

	it('emits published entries only and never the source key', () => {
		const draft = { ...published, id: 'draft-test', data: { ...published.data, id: 'draft-test', published: false } };
		const rendered = renderHoursManifestSource([published, draft]);
		expect(rendered).toContain('"friday-test"');
		expect(rendered).not.toContain('draft-test');
		expect(rendered).not.toContain('source:');
		expect(rendered).not.toContain('fixture');
	});

	it('the committed manifest carries no unpublished slot', () => {
		const manifest = readFileSync(path.resolve(__dirname, 'generated/hours-manifest.ts'), 'utf8');
		for (const entry of readHoursEntries(hoursDir)) {
			if (entry.data.published === false) expect(manifest).not.toContain(`'${entry.id}'`);
		}
	});

	it('folds only long notes from unpublished files into the leak denylist', () => {
		const base = { ...valid, published: false };
		const literals = distinctiveDraftHoursLiterals([
			{ file: 'a.json', id: 'a', sourcePath: 'src/content/hours/a.json', data: base },
			{ file: 'b.json', id: 'b', sourcePath: 'src/content/hours/b.json', data: { ...base, notes: 'Short.' } },
			{
				file: 'c.json',
				id: 'c',
				sourcePath: 'src/content/hours/c.json',
				data: { ...base, published: true, notes: 'Published notes are already public copy.' },
			},
		]);
		// Staff names, times and "the bus" never join it: the FAQ renders those.
		expect(literals).toEqual(['Bring work gloves if you have them.']);
	});
});
