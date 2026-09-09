// WebGL2 tier: one program, one full-viewport triangle, one R8 ink texture,
// no render targets. Every failure returns through the handle or the
// selection result; nothing here ever writes to the console (the no-JS spec
// fails the home page on any console error or warning).
import { INK_FIELD_HEIGHT, INK_FIELD_WIDTH, MAX_BLOBS } from './shaders/constants';
import { SCENE_FRAGMENT, SCENE_VERTEX } from './shaders/scene.glsl';
import type { RendererFailure, RendererHandle, RendererSelection, SceneFrame } from './types';

interface Program {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation | null>;
	inkTexture: WebGLTexture;
}

const UNIFORMS = [
	'u_resolution',
	'u_ground',
	'u_blend',
	'u_inkAlpha',
	'u_time',
	'u_blobCount',
	'u_blobs',
	'u_blobColors',
	'u_ink',
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
	const inkTexture = gl.createTexture();
	if (!inkTexture) {
		gl.deleteProgram(program);
		return { kind: 'compile', stage: 'link' };
	}
	gl.bindTexture(gl.TEXTURE_2D, inkTexture);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, INK_FIELD_WIDTH, INK_FIELD_HEIGHT, 0, gl.RED, gl.UNSIGNED_BYTE, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return { program, uniforms, inkTexture };
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): RendererSelection {
	const gl = canvas.getContext('webgl2', {
		alpha: false,
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
		render(frame: SceneFrame) {
			if (lost || cssWidth <= 0 || cssHeight <= 0) return;
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.useProgram(program.program);
			const u = program.uniforms;
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
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, program.inkTexture);
			gl.uniform1i(u.u_ink, 0);
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
				gl.deleteProgram(program.program);
				gl.getExtension('WEBGL_lose_context')?.loseContext();
			}
		},
	};
	return { ok: true, handle };
}
