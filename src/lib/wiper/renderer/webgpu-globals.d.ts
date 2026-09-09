// The shipped lib.dom (TypeScript 6.0) declares the WebGPU interfaces
// (GPUDevice, GPUCanvasContext, GPUTexture and the rest) but not the four
// constant namespaces nor the canvas context overload, and this spoke ships
// no @webgpu/types package (no new npm package: house ruling). These are the
// spec's own shapes, nothing more; they vanish the day lib.dom carries them.

declare const GPUShaderStage: {
	readonly VERTEX: 1;
	readonly FRAGMENT: 2;
	readonly COMPUTE: 4;
};

declare const GPUTextureUsage: {
	readonly COPY_SRC: 1;
	readonly COPY_DST: 2;
	readonly TEXTURE_BINDING: 4;
	readonly STORAGE_BINDING: 8;
	readonly RENDER_ATTACHMENT: 16;
};

declare const GPUBufferUsage: {
	readonly MAP_READ: 1;
	readonly MAP_WRITE: 2;
	readonly COPY_SRC: 4;
	readonly COPY_DST: 8;
	readonly INDEX: 16;
	readonly VERTEX: 32;
	readonly UNIFORM: 64;
	readonly STORAGE: 128;
	readonly INDIRECT: 256;
	readonly QUERY_RESOLVE: 512;
};

declare const GPUMapMode: {
	readonly READ: 1;
	readonly WRITE: 2;
};

interface HTMLCanvasElement {
	getContext(contextId: 'webgpu'): GPUCanvasContext | null;
}
