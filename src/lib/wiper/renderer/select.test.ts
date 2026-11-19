import { describe, expect, it } from 'vitest';
import { resolveCeiling } from './select';

// The html attribute caps the renderer and the page can only lower its ceiling. Unknown
// values request the top rung.
describe('resolveCeiling', () => {
	it('caps from the attribute and never raises above the page ceiling', () => {
		expect(resolveCeiling(undefined, 'webgpu')).toBe('webgpu');
		expect(resolveCeiling('webgl2', 'webgpu')).toBe('webgl2');
		expect(resolveCeiling('none', 'webgpu')).toBe('none');
		expect(resolveCeiling(undefined, 'webgl2')).toBe('webgl2');
		expect(resolveCeiling('webgpu', 'webgl2')).toBe('webgl2');
		expect(resolveCeiling('none', 'webgl2')).toBe('none');
		expect(resolveCeiling('webgl2', 'none')).toBe('none');
		expect(resolveCeiling('anything else', 'webgpu')).toBe('webgpu');
		expect(resolveCeiling('', 'webgpu')).toBe('webgpu');
	});

	it('starts a reload on WebGL2 and lets the attribute cap it further', () => {
		expect(resolveCeiling(undefined, 'webgpu', 'reload')).toBe('webgl2');
		expect(resolveCeiling(undefined, 'webgpu', 'navigate')).toBe('webgpu');
		expect(resolveCeiling(undefined, 'webgpu', 'back_forward')).toBe('webgpu');
		expect(resolveCeiling(undefined, 'webgpu', undefined)).toBe('webgpu');
		expect(resolveCeiling('none', 'webgpu', 'reload')).toBe('none');
		expect(resolveCeiling(undefined, 'none', 'reload')).toBe('none');
	});
});
