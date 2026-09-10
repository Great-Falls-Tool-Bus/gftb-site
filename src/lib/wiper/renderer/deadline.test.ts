import { describe, expect, it } from 'vitest';
import { manualTimer, withDeadline } from './deadline';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const UNSETTLED = Symbol('unsettled');
const probe = <T>(promise: Promise<T>) => Promise.race([promise, flush().then(() => UNSETTLED)]);

describe('withDeadline', () => {
	it('passes a fast value through and clears its timer', async () => {
		const timer = manualTimer();
		const result = await withDeadline(Promise.resolve(7), 1500, timer);
		expect(result).toEqual({ settled: true, value: 7 });
		expect(timer.pending.size).toBe(0);
	});

	it('arms the timer with the deadline it was given', async () => {
		const timer = manualTimer();
		void withDeadline(new Promise(() => {}), 1500, timer);
		expect([...timer.pending.values()].map((entry) => entry.ms)).toEqual([1500]);
	});

	it('reports a promise that never settles once the deadline fires', async () => {
		const timer = manualTimer();
		const bounded = withDeadline(new Promise<number>(() => {}), 1500, timer);
		expect(await probe(bounded)).toBe(UNSETTLED);
		timer.fire();
		expect(await bounded).toEqual({ settled: false });
	});

	it('keeps the deadline verdict when the work lands late, and the work still resolves', async () => {
		const timer = manualTimer();
		let release: (value: number) => void = () => {};
		const work = new Promise<number>((resolve) => {
			release = resolve;
		});
		const bounded = withDeadline(work, 1500, timer);
		timer.fire();
		expect(await bounded).toEqual({ settled: false });
		release(42);
		expect(await work).toBe(42);
		expect(await bounded).toEqual({ settled: false });
	});

	it('passes a rejection through and clears the timer', async () => {
		const timer = manualTimer();
		await expect(withDeadline(Promise.reject(new Error('refused')), 1500, timer)).rejects.toThrow('refused');
		expect(timer.pending.size).toBe(0);
	});

	it('uses the host timer by default', async () => {
		expect(await withDeadline(new Promise(() => {}), 0)).toEqual({ settled: false });
	});
});
