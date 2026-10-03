import { describe, expect, it, vi } from 'vitest';
import {
	ACCESS_PROBE_URL,
	MEMBERSHIP_OVERRIDE_KEY,
	MEMBERSHIP_SURFACE_ATTR,
	PROBE_TIMEOUT_MS,
	TAILNET_PROBE_URL,
	applyMembershipSurface,
	bustCache,
	probeImage,
	readOverride,
	resolveMembershipSurface,
	type OverrideStorage,
	type ProbeImage,
} from './membership-surface';

/** An Image stand-in whose outcome the test decides. */
function fakeImage() {
	const image: ProbeImage & { fire(kind: 'load' | 'error'): void } = {
		onload: null,
		onerror: null,
		src: '',
		fire(kind) {
			(kind === 'load' ? this.onload : this.onerror)?.();
		},
	};
	return image;
}

function memoryStorage(initial: Record<string, string> = {}): OverrideStorage & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		getItem: (key) => (key in data ? data[key] : null),
		setItem: (key, value) => {
			data[key] = value;
		},
		removeItem: (key) => {
			delete data[key];
		},
	};
}

const throwingStorage: OverrideStorage = {
	getItem: () => {
		throw new Error('denied');
	},
	setItem: () => {
		throw new Error('denied');
	},
	removeItem: () => {
		throw new Error('denied');
	},
};

describe('probeImage', () => {
	it('resolves true when the image loads, with a cache-busting query', async () => {
		const image = fakeImage();
		const pending = probeImage(ACCESS_PROBE_URL, { makeImage: () => image, now: () => 42 });
		expect(image.src).toBe(`${ACCESS_PROBE_URL}?flag-probe=42`);
		image.fire('load');
		await expect(pending).resolves.toBe(true);
	});

	it('resolves false when the image fails (the Access login page is not an image)', async () => {
		const image = fakeImage();
		const pending = probeImage(ACCESS_PROBE_URL, { makeImage: () => image });
		image.fire('error');
		await expect(pending).resolves.toBe(false);
	});

	it('resolves false after the timeout and ignores a late load', async () => {
		vi.useFakeTimers();
		try {
			const image = fakeImage();
			const pending = probeImage(ACCESS_PROBE_URL, { makeImage: () => image });
			const late = image.onload;
			vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
			await expect(pending).resolves.toBe(false);
			late?.();
			expect(image.onload).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('resolves false when no image can be made', async () => {
		await expect(
			probeImage(ACCESS_PROBE_URL, {
				makeImage: () => {
					throw new Error('no Image');
				},
			}),
		).resolves.toBe(false);
	});

	it('appends to an existing query', () => {
		expect(bustCache('https://example.test/a.svg?x=1', 7)).toBe('https://example.test/a.svg?x=1&flag-probe=7');
	});

	it('logs nothing on any outcome', async () => {
		const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
		for (const kind of ['load', 'error'] as const) {
			const image = fakeImage();
			const pending = probeImage(ACCESS_PROBE_URL, { makeImage: () => image });
			image.fire(kind);
			await pending;
		}
		for (const spy of spies) {
			expect(spy).not.toHaveBeenCalled();
			spy.mockRestore();
		}
	});
});

describe('readOverride', () => {
	it('?flags=membership sets the key and turns the override on', () => {
		const storage = memoryStorage();
		expect(readOverride('?flags=membership', () => storage)).toBe(true);
		expect(storage.data[MEMBERSHIP_OVERRIDE_KEY]).toBe('on');
		expect(readOverride('', () => storage)).toBe(true);
	});

	it('?flags=none clears the key', () => {
		const storage = memoryStorage({ [MEMBERSHIP_OVERRIDE_KEY]: 'on' });
		expect(readOverride('?flags=none', () => storage)).toBe(false);
		expect(MEMBERSHIP_OVERRIDE_KEY in storage.data).toBe(false);
	});

	it('is off with no request and no stored key, and ignores other values', () => {
		expect(readOverride('', () => memoryStorage())).toBe(false);
		expect(readOverride('?flags=everything', () => memoryStorage())).toBe(false);
	});

	it('survives storage that throws: the request still counts for this page only', () => {
		expect(readOverride('?flags=membership', () => throwingStorage)).toBe(true);
		expect(readOverride('', () => throwingStorage)).toBe(false);
		expect(
			readOverride('?flags=membership', () => {
				throw new Error('localStorage is not available');
			}),
		).toBe(true);
		expect(readOverride('', () => null)).toBe(false);
	});
});

describe('resolveMembershipSurface', () => {
	const off = (_url: string) => Promise.resolve(false);

	it('is off when every source is off', async () => {
		const probe = vi.fn(off);
		await expect(
			resolveMembershipSurface({ search: '', getStorage: () => memoryStorage(), tailnetUrl: '', probe }),
		).resolves.toBe(false);
		expect(probe.mock.calls.map(([url]) => url)).toEqual([ACCESS_PROBE_URL]);
	});

	it('turns on for an Access session alone', async () => {
		const probe = (url: string) => Promise.resolve(url === ACCESS_PROBE_URL);
		await expect(resolveMembershipSurface({ search: '', getStorage: () => null, tailnetUrl: '', probe })).resolves.toBe(
			true,
		);
	});

	it('turns on for the tailnet probe alone, when one is configured', async () => {
		const tailnetUrl = 'https://probe.example.test/pixel.png';
		const probe = vi.fn((url: string) => Promise.resolve(url === tailnetUrl));
		await expect(resolveMembershipSurface({ search: '', getStorage: () => null, tailnetUrl, probe })).resolves.toBe(
			true,
		);
		expect(probe.mock.calls.map(([url]) => url)).toEqual([ACCESS_PROBE_URL, tailnetUrl]);
	});

	it('skips the tailnet probe when its URL is empty', async () => {
		const probe = vi.fn(off);
		await resolveMembershipSurface({ search: '', getStorage: () => null, tailnetUrl: '', probe });
		expect(probe).toHaveBeenCalledTimes(1);
	});

	it('turns on for the override without probing', async () => {
		const probe = vi.fn(off);
		await expect(
			resolveMembershipSurface({
				search: '?flags=membership',
				getStorage: () => memoryStorage(),
				tailnetUrl: '',
				probe,
			}),
		).resolves.toBe(true);
		expect(probe).not.toHaveBeenCalled();
	});

	it('treats a rejecting probe as off', async () => {
		const probe = () => Promise.reject(new Error('boom'));
		await expect(resolveMembershipSurface({ search: '', getStorage: () => null, tailnetUrl: '', probe })).resolves.toBe(
			false,
		);
	});

	it('ships with no tailnet probe URL unless the build sets one', () => {
		expect(TAILNET_PROBE_URL).toBe('');
	});
});

describe('applyMembershipSurface', () => {
	it('marks the root only when the flag is on', async () => {
		const on = { setAttribute: vi.fn() };
		await applyMembershipSurface(on, { search: '?flags=membership', getStorage: () => null, tailnetUrl: '' });
		expect(on.setAttribute).toHaveBeenCalledWith(MEMBERSHIP_SURFACE_ATTR, 'on');

		const offRoot = { setAttribute: vi.fn() };
		await applyMembershipSurface(offRoot, {
			search: '',
			getStorage: () => null,
			tailnetUrl: '',
			probe: () => Promise.resolve(false),
		});
		expect(offRoot.setAttribute).not.toHaveBeenCalled();
	});
});
