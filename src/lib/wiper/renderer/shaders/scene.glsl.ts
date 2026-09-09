// The WebGL2 scene shader as template strings (the build-output scanner
// classifies files by extension and fails closed on anything it does not
// know, so shaders live inside modules). No URLs, no mailboxes in here.
import { MAX_BLOBS } from './constants';

export const SCENE_VERTEX = `#version 300 es
precision highp float;
// One full-viewport triangle from gl_VertexID; no buffers.
void main() {
	vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
	gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}
`;

export const SCENE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform vec3 u_ground;
uniform int u_blend;
uniform float u_inkAlpha;
uniform float u_time;
uniform int u_blobCount;
uniform vec4 u_blobs[${MAX_BLOBS}];
uniform vec3 u_blobColors[${MAX_BLOBS}];
uniform sampler2D u_ink;
out vec4 outColor;

void main() {
	vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
	vec2 uv = p / u_resolution;

	// Metaball field over the blobs the physics hands us this frame.
	float field = 0.0;
	float weight = 0.0;
	vec3 tint = vec3(0.0);
	for (int i = 0; i < ${MAX_BLOBS}; i++) {
		if (i >= u_blobCount) break;
		vec4 b = u_blobs[i];
		vec2 d = p - b.xy;
		float f = (b.z * b.z) / (dot(d, d) + 1.0);
		field += f;
		weight += f;
		tint += u_blobColors[i] * f;
	}
	tint /= max(weight, 1e-4);
	// Distinct shapes, not a wall of colour: a firm body, a wide soft halo,
	// and a ceiling well below full so the ground always shows through.
	float body = smoothstep(0.55, 1.6, field) * 0.72;
	float halo = smoothstep(0.03, 0.45, field) * 0.34;
	float cover = clamp(max(body, halo), 0.0, 0.72);

	// The SVG layer's blend per scheme: multiply lightens nothing, screen darkens nothing.
	vec3 blended = (u_blend == 0) ? u_ground * tint : 1.0 - (1.0 - u_ground) * (1.0 - tint);
	vec3 scene = mix(u_ground, blended, cover);

	// The ink clamp, last: under measured text the scene may leave the ground
	// by at most u_inkAlpha of its own deviation.
	float k = texture(u_ink, uv).r;
	vec3 rgb = mix(u_ground, scene, 1.0 - k * (1.0 - u_inkAlpha));
	outColor = vec4(rgb, 1.0);
}
`;
