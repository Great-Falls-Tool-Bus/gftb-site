// WebGL2 tier: one program, one full-viewport triangle, one R8 ink texture,
// no render targets. Every failure returns through the handle or the
// selection result; nothing here ever writes to the console (the no-JS spec
// fails the home page on any console error or warning).
import { INK_FIELD_HEIGHT, INK_FIELD_WIDTH, MAX_ARMS, MAX_BLOBS } from './shaders/constants';
import { SCENE_FRAGMENT, SCENE_VERTEX } from './shaders/scene.glsl';
import type { RendererFailure, RendererHandle, RendererOptions, RendererSelection, SceneFrame } from './types';

interface Program {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation | null>;
	inkTexture: WebGLTexture;
	movingTexture: WebGLTexture;
}

const UNIFORMS = [
	'u_layer',
	'u_resolution',
	'u_ground',
	'u_blend',
	'u_inkAlpha',
	'u_time',
	'u_blobCount',
	'u_blobs',
	'u_blobColors',
	'u_armCount',
	'u_arms',
	'u_armStyle',
	'u_ink',
	'u_inkMoving',
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
	const inkTexture = makeField(INK_FIELD_WIDTH, INK_FIELD_HEIGHT);
	const movingTexture = inkTexture ? makeField(1, 1) : null;
	if (!inkTexture || !movingTexture) {
		if (inkTexture) gl.deleteTexture(inkTexture);
		gl.deleteProgram(program);
		return { kind: 'compile', stage: 'link' };
	}
	// An empty moving field: one zero texel until a stroke fills it.
	gl.bindTexture(gl.TEXTURE_2D, movingTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
	return { program, uniforms, inkTexture, movingTexture };
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
	const blobData = new Float32Array(MAX_BLOBS * 4);
	const colorData = new Float32Array(MAX_BLOBS * 3);
	const armData = new Float32Array(MAX_ARMS * 4);
	const armStyle = new Float32Array(MAX_ARMS * 4);
	const lostCallbacks: Array<(failure: RendererFailure) => void> = [];
	let pendingInk: { field: Uint8Array; width: number; height: number } | null = null;

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
			if (pendingInk) handle.uploadInk(pendingInk.field, pendingInk.width, pendingInk.height);
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
		uploadInk(field, width, height) {
			pendingInk = { field, width, height };
			if (lost) return;
			gl.bindTexture(gl.TEXTURE_2D, program.inkTexture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, field);
		},
		uploadMovingInk(field, width, height) {
			if (lost) return;
			gl.bindTexture(gl.TEXTURE_2D, program.movingTexture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			if (field) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, field);
			else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
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
			gl.uniform1i(u.u_layer, options.layer === 'blades' ? 1 : 0);
			gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
			gl.uniform3f(u.u_ground, frame.ground[0], frame.ground[1], frame.ground[2]);
			gl.uniform1i(u.u_blend, frame.blend === 'screen' ? 1 : 0);
			gl.uniform1f(u.u_inkAlpha, frame.inkAlpha);
			gl.uniform1f(u.u_time, frame.time);
			const count = Math.min(frame.blobs.length, MAX_BLOBS);
			for (let index = 0; index < count; index += 1) {
				const blob = frame.blobs[index];
				blobData[index * 4] = blob.x * dpr;
				blobData[index * 4 + 1] = blob.y * dpr;
				blobData[index * 4 + 2] = blob.r * dpr;
				blobData[index * 4 + 3] = 0;
				colorData[index * 3] = blob.color[0];
				colorData[index * 3 + 1] = blob.color[1];
				colorData[index * 3 + 2] = blob.color[2];
			}
			gl.uniform1i(u.u_blobCount, count);
			gl.uniform4fv(u.u_blobs, blobData);
			gl.uniform3fv(u.u_blobColors, colorData);
			const armCount = Math.min(frame.arms.length, MAX_ARMS);
			for (let index = 0; index < armCount; index += 1) {
				const arm = frame.arms[index];
				armData[index * 4] = arm.pivotX * dpr;
				armData[index * 4 + 1] = arm.pivotY * dpr;
				armData[index * 4 + 2] = arm.phi;
				armData[index * 4 + 3] = arm.length * dpr;
				armStyle[index * 4] = arm.width * dpr;
				armStyle[index * 4 + 1] = arm.bladeFrom * dpr;
				armStyle[index * 4 + 2] = arm.flex;
				armStyle[index * 4 + 3] = 0;
			}
			gl.uniform1i(u.u_armCount, armCount);
			gl.uniform4fv(u.u_arms, armData);
			gl.uniform4fv(u.u_armStyle, armStyle);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, program.inkTexture);
			gl.uniform1i(u.u_ink, 0);
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, program.movingTexture);
			gl.uniform1i(u.u_inkMoving, 1);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		onLost(callback) {
			lostCallbacks.push(callback);
		},
		destroy() {
			canvas.removeEventListener('webglcontextlost', onContextLost);
			canvas.removeEventListener('webglcontextrestored', onContextRestored);
			if (!lost) {
				gl.deleteTexture(program.inkTexture);
				gl.deleteTexture(program.movingTexture);
				gl.deleteProgram(program.program);
				gl.getExtension('WEBGL_lose_context')?.loseContext();
			}
		},
	};
	return { ok: true, handle };
}
