// A bound on a promise the host may never settle. Chrome has been seen to
// hold a WebGPU adapter or device request open until the next compositor
// event (a viewport resize), which left the wiper's canvases pending for as
// long as the visitor kept still. The timer is injected so a node test can
// drive the deadline by hand; nothing here reads the page or the host.
export interface DeadlineTimer {
	set(run: () => void, ms: number): unknown;
	clear(token: unknown): void;
}

export const HOST_TIMER: DeadlineTimer = {
	set: (run, ms) => setTimeout(run, ms),
	clear: (token) => clearTimeout(token as ReturnType<typeof setTimeout>),
};

export type Deadlined<T> = { readonly settled: true; readonly value: T } | { readonly settled: false };

/**
 * Resolves with the value when `work` settles first, or `{ settled: false }`
 * at the deadline. A rejection passes through either way. The caller keeps
 * its own reference to `work` for whatever should happen to a late answer.
 */
export function withDeadline<T>(
	work: Promise<T>,
	ms: number,
	timer: DeadlineTimer = HOST_TIMER,
): Promise<Deadlined<T>> {
	return new Promise((resolve, reject) => {
		const token = timer.set(() => resolve({ settled: false }), ms);
		work.then(
			(value) => {
				timer.clear(token);
				resolve({ settled: true, value });
			},
			(error: unknown) => {
				timer.clear(token);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/** Test seam: a timer that fires only when told to. */
export interface ManualTimer extends DeadlineTimer {
	readonly pending: Map<number, { run: () => void; ms: number }>;
	fire(): void;
}

export function manualTimer(): ManualTimer {
	const pending = new Map<number, { run: () => void; ms: number }>();
	let next = 1;
	return {
		pending,
		set(run, ms) {
			const id = next;
			next += 1;
			pending.set(id, { run, ms });
			return id;
		},
		clear(token) {
			pending.delete(token as number);
		},
		fire() {
			for (const [id, entry] of [...pending]) {
				pending.delete(id);
				entry.run();
			}
		},
	};
}
