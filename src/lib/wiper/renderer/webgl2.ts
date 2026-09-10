// WebGL2 tier: one program, one full-viewport triangle, a few small data
// textures, no render targets. Every failure returns through the handle or the
// selection result; nothing here ever writes to the console (the no-JS spec
// fails the home page on any console error or warning).
import { MAX_ARMS, MAX_BLOBS } from './shaders/constants';
import { SCENE_FRAGMENT, SCENE_VERTEX } from './shaders/scene.glsl';
import type { RendererFailure, RendererHandle, RendererOptions, RendererSelection, SceneFrame } from './types';
import { UNIFORM_OFFSETS, createUniformBlock, packUniformBlock, scaleDroplets } from './uniform-block';

interface Program {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation | null>;
	dropsTexture: WebGLTexture;
	frostTexture: WebGLTexture;
}

const UNIFORMS = [
	'u_layer',
	'u_resolution',
	'u_ground',
	'u_blend',
	'u_time',
	'u_blobCount',
	'u_blobs',
	'u_blobColors',
	'u_armCount',
	'u_arms',
	'u_armStyle',
	'u_drops',
	'u_dropCell',
	'u_frostTex',
	'u_frost',
	'u_frostMax',
	'u_armFan',
	'u_armEdge',
];

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function build(gl: WebGL2RenderingContext): Program | RendererFailure {
	const vertex = compile(gl, gl.VERTEX_SHADER, SCENE_VERTEX);
	if (!vertex) return { kind: 'compile', stage: 'vertex' };
	const fragment = compile(gl, gl.FRAGMENT_SHADER, SCENE_FRAGMENT);
	if (!fragment) {
		gl.deleteShader(vertex);
		return { kind: 'compile', stage: 'fragment' };
	}
	const program = gl.createProgram();
	if (!program) return { kind: 'compile', stage: 'link' };
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return { kind: 'compile', stage: 'link' };
	}
	const uniforms: Record<string, WebGLUniformLocation | null> = {};
	for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
	const makeField = (width: number, height: number): WebGLTexture | null => {
		const texture = gl.createTexture();
		if (!texture) return null;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	};
	const frostTexture = makeField(1, 1);
	// The bead field is float data fetched by texel: NEAREST, no filtering.
	const dropsTexture = frostTexture ? gl.createTexture() : null;
	if (!frostTexture || !dropsTexture) {
		if (frostTexture) gl.deleteTexture(frostTexture);
		gl.deleteProgram(program);
		return { kind: 'compile', stage: 'link' };
	}
	gl.bindTexture(gl.TEXTURE_2D, dropsTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return { program, uniforms, dropsTexture, frostTexture };
}

export function createWebGL2Renderer(
	canvas: HTMLCanvasElement,
	options: RendererOptions = { layer: 'scene' },
): RendererSelection {
	// The scene is opaque; the blades layer composites over the notes with
	// premultiplied alpha, which is what the fragment writes.
	const gl = canvas.getContext('webgl2', {
		alpha: options.layer === 'blades',
		premultipliedAlpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		preserveDrawingBuffer: false,
		powerPreference: 'low-power',
	});
	if (!gl) return { ok: false, why: { kind: 'no-context' } };
	let built = build(gl);
	if (!('program' in built)) return { ok: false, why: built };
	let program: Program = built;
	let lost = false;
	let cssWidth = 0;
	let cssHeight = 0;
	let dpr = 1;
	// Both tiers read the one uniform block; this rung uploads its slices.
	const block = createUniformBlock();
	let dropCellCss = 0;
	let pendingDrops: { data: Float32Array; cols: number; rows: number; cellCss: number } | null = null;
	let pendingFrost: { field: Uint8Array; width: number; height: number } | null = null;
	const lostCallbacks: Array<(failure: RendererFailure) => void> = [];

	const onContextLost = (event: Event) => {
		event.preventDefault();
		lost = true;
		for (const callback of lostCallbacks) callback({ kind: 'context-lost' });
	};
	const onContextRestored = () => {
		built = build(gl);
		if ('program' in built) {
			program = built;
			lost = false;
			if (pendingDrops)
				handle.uploadDroplets(pendingDrops.data, pendingDrops.cols, pendingDrops.rows, pendingDrops.cellCss);
			if (pendingFrost) handle.uploadFrost(pendingFrost.field, pendingFrost.width, pendingFrost.height);
		}
	};
	canvas.addEventListener('webglcontextlost', onContextLost);
	canvas.addEventListener('webglcontextrestored', onContextRestored);

	const handle: RendererHandle = {
		tier: 'webgl2',
		layer: options.layer,
		resize(width, height, ratio) {
			cssWidth = width;
			cssHeight = height;
			dpr = ratio;
			const backingWidth = Math.max(1, Math.round(width * ratio));
			const backingHeight = Math.max(1, Math.round(height * ratio));
			if (canvas.width !== backingWidth) canvas.width = backingWidth;
			if (canvas.height !== backingHeight) canvas.height = backingHeight;
		},
		uploadDroplets(data, cols, rows, cellCss) {
			pendingDrops = { data, cols, rows, cellCss };
			dropCellCss = cellCss;
			if (lost) return;
			// The field is CSS px; the shader works in device px.
			gl.bindTexture(gl.TEXTURE_2D, program.dropsTexture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols + 2, rows + 2, 0, gl.RGBA, gl.FLOAT, scaleDroplets(data, dpr));
		},
		uploadFrost(field, width, height) {
			pendingFrost = { field, width, height };
			if (lost) return;
			gl.bindTexture(gl.TEXTURE_2D, program.frostTexture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, field);
		},
		render(frame: SceneFrame) {
			if (lost || cssWidth <= 0 || cssHeight <= 0) return;
			gl.viewport(0, 0, canvas.width, canvas.height);
			if (options.layer === 'blades') {
				// Clear the whole layer, then shade only the box the arms can
				// touch; parked blades cost nothing at all.
				gl.disable(gl.SCISSOR_TEST);
				gl.clearColor(0, 0, 0, 0);
				gl.clear(gl.COLOR_BUFFER_BIT);
				const box = frame.scissor;
				if (!box || box.width <= 0 || box.height <= 0) return;
				const x = Math.max(0, Math.floor(box.x * dpr));
				const top = Math.max(0, Math.floor(box.y * dpr));
				const right = Math.min(canvas.width, Math.ceil((box.x + box.width) * dpr));
				const bottom = Math.min(canvas.height, Math.ceil((box.y + box.height) * dpr));
				if (right <= x || bottom <= top) return;
				gl.enable(gl.SCISSOR_TEST);
				gl.scissor(x, canvas.height - bottom, right - x, bottom - top);
			} else {
				gl.disable(gl.SCISSOR_TEST);
			}
			gl.useProgram(program.program);
			const u = program.uniforms;
			const o = UNIFORM_OFFSETS;
			const counts = packUniformBlock(block, frame, options.layer, dpr, dropCellCss, canvas.width, canvas.height);
			const { f32, i32 } = block;
			gl.uniform1i(u.u_layer, i32[o.layer]);
			gl.uniform2f(u.u_resolution, f32[o.resolution], f32[o.resolution + 1]);
			gl.uniform3f(u.u_ground, f32[o.ground], f32[o.ground + 1], f32[o.ground + 2]);
			gl.uniform1i(u.u_blend, i32[o.blend]);
			gl.uniform1f(u.u_time, f32[o.time]);
			gl.uniform1i(u.u_blobCount, counts.blobCount);
			gl.uniform4fv(u.u_blobs, f32.subarray(o.blobs, o.blobs + MAX_BLOBS * 4));
			gl.uniform4fv(u.u_blobColors, f32.subarray(o.blobColors, o.blobColors + MAX_BLOBS * 4));
			gl.uniform1i(u.u_armCount, counts.armCount);
			gl.uniform4fv(u.u_arms, f32.subarray(o.arms, o.arms + MAX_ARMS * 4));
			gl.uniform4fv(u.u_armStyle, f32.subarray(o.armStyle, o.armStyle + MAX_ARMS * 4));
			gl.uniform4fv(u.u_armFan, f32.subarray(o.armFan, o.armFan + MAX_ARMS * 4));
			gl.uniform4fv(u.u_armEdge, f32.subarray(o.armEdge, o.armEdge + MAX_ARMS * 4));
			gl.uniform1f(u.u_dropCell, f32[o.dropCell]);
			gl.uniform1f(u.u_frost, f32[o.frost]);
			gl.uniform1f(u.u_frostMax, f32[o.frostMax]);
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, program.dropsTexture);
			gl.uniform1i(u.u_drops, 2);
			gl.activeTexture(gl.TEXTURE3);
			gl.bindTexture(gl.TEXTURE_2D, program.frostTexture);
			gl.uniform1i(u.u_frostTex, 3);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		onLost(callback) {
			lostCallbacks.push(callback);
		},
		destroy() {
			canvas.removeEventListener('webglcontextlost', onContextLost);
			canvas.removeEventListener('webglcontextrestored', onContextRestored);
			if (!lost) {
				gl.deleteTexture(program.dropsTexture);
				gl.deleteTexture(program.frostTexture);
				gl.deleteProgram(program.program);
				gl.getExtension('WEBGL_lose_context')?.loseContext();
			}
		},
	};
	return { ok: true, handle };
}
