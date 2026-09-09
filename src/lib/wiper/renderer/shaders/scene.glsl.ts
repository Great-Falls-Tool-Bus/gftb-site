// The WebGL2 scene shader as template strings (the build-output scanner
// classifies files by extension and fails closed on anything it does not
// know, so shaders live inside modules). No URLs, no mailboxes in here.
//
// One program, one triangle, two layers. Layer 0, the scene behind the
// notes: the page ground, tinyvectors' blob field, frost and beads. The
// notes themselves are translucent glass panes whose inks were chosen to
// read over any backdrop, so the scene owes them nothing under text
// (operator ruling at the M4 ratification: the former ink clamp is gone).
// Layer 1, the blades over the notes: the wiper arms as 2D signed-distance
// chrome and rubber lit analytically (a dusk sky reflected in a half-cylinder
// cross-section, a key light, a rim light, a fresnel-weighted iridescent
// sheen) and their soft shadow, written premultiplied over transparency so
// the blade passes over the panes it wipes.
import { DROP_LENS, DROP_RIM_DARKEN, DROP_RIM_LIGHTEN, DROP_SPEC, MAX_ARMS, MAX_BLOBS } from './constants';

/** A number as a GLSL float literal (32 reads 32.0). */
const glslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

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
// 0: the opaque scene behind the notes; 1: the transparent blade layer over them.
uniform int u_layer;
uniform vec2 u_resolution;
uniform vec3 u_ground;
uniform int u_blend;
uniform float u_time;
uniform int u_blobCount;
uniform vec4 u_blobs[${MAX_BLOBS}];
// rgb in xyz; vec4 so the shared uniform block's 16-byte stride binds directly.
uniform vec4 u_blobColors[${MAX_BLOBS}];
uniform int u_armCount;
// pivot.xy (device px), phi (radians, conic convention), length (device px)
uniform vec4 u_arms[${MAX_ARMS}];
// width, bladeFrom (device px), flex (-1..1), unused
uniform vec4 u_armStyle[${MAX_ARMS}];
// M4: the bead field, one texel per grid cell with a zero border: x, y, r
// (device px) and alpha; NEAREST, fetched by texel.
uniform highp sampler2D u_drops;
uniform float u_dropCell;
// M4: the frost grain and its strength ahead of the blades.
uniform sampler2D u_frostTex;
uniform float u_frost;
uniform float u_frostMax;
// M4: per arm, across(-park) and across(halfSweep): the fan's two edges.
uniform vec4 u_armFan[${MAX_ARMS}];
// M4: per arm, across(phi), travel (-1, 0, 1) and the edge's anti-alias width.
uniform vec4 u_armEdge[${MAX_ARMS}];
out vec4 outColor;

const float PI = 3.14159265;

// ---- the blob field ------------------------------------------------------

// Metaball field over the blobs the physics hands us this frame; the tint
// is the field-weighted mean of the blob colours.
float blobField(vec2 p, out vec3 tint) {
	float field = 0.0;
	float weight = 0.0;
	vec3 sum = vec3(0.0);
	for (int i = 0; i < ${MAX_BLOBS}; i++) {
		if (i >= u_blobCount) break;
		vec4 b = u_blobs[i];
		vec2 d = p - b.xy;
		float f = (b.z * b.z) / (dot(d, d) + 1.0);
		field += f;
		weight += f;
		sum += u_blobColors[i].xyz * f;
	}
	tint = sum / max(weight, 1e-4);
	return field;
}

// Distinct shapes, not a wall of colour: a firm body, a wide soft halo,
// and a ceiling well below full so the ground always shows through.
vec3 blobScene(vec2 p, out float cover) {
	vec3 tint;
	float field = blobField(p, tint);
	float body = smoothstep(0.55, 1.6, field) * 0.72;
	float halo = smoothstep(0.03, 0.45, field) * 0.34;
	cover = clamp(max(body, halo), 0.0, 0.72);
	// The SVG layer's blend per scheme: multiply lightens nothing, screen darkens nothing.
	vec3 blended = (u_blend == 0) ? u_ground * tint : 1.0 - (1.0 - u_ground) * (1.0 - tint);
	return mix(u_ground, blended, cover);
}

// ---- the glass: swept edge, frost, droplets --------------------------------

// How far behind a moving blade's edge this pixel lies, 0 ahead, 1 behind,
// within that arm's fan and reach. The bead field and the frost read it so
// the rubber eats them as it passes rather than after.
float sweptNow(vec2 p) {
	float swept = 0.0;
	for (int i = 0; i < ${MAX_ARMS}; i++) {
		if (i >= u_armCount) break;
		vec4 edge = u_armEdge[i];
		if (edge.z == 0.0) continue;
		vec4 arm = u_arms[i];
		vec2 rel = p - arm.xy;
		if (dot(rel, rel) > arm.w * arm.w) continue;
		vec4 fan = u_armFan[i];
		float inFan = step(0.0, dot(rel, fan.xy)) * step(dot(rel, fan.zw), 0.0);
		float acrossEdge = dot(rel, edge.xy);
		float behind = (edge.z > 0.0) ? -acrossEdge : acrossEdge;
		swept = max(swept, inFan * smoothstep(-edge.w, edge.w, behind));
	}
	return swept;
}

// Frost: the grain raster times the clock's strength, gone behind the edge.
// It softens the field toward the ground and tints it cold.
vec3 frost(vec2 uv, vec3 col, float swept) {
	float h = texture(u_frostTex, uv).r * u_frost * (1.0 - swept);
	vec3 tint = (u_blend == 0) ? vec3(0.97, 0.98, 1.0) : vec3(0.62, 0.66, 0.76);
	vec3 soft = mix(col, mix(u_ground, col, 0.6), 0.5 * h);
	return mix(soft, tint, u_frostMax * h);
}

// Droplets: the four cells around the pixel can hold a bead that reaches
// it. Each bead is a lens over the blob field (sampled toward its centre),
// darker at the rim in light, brighter in dark, with one specular point.
vec3 droplets(vec2 p, vec3 base, float swept) {
	vec2 g = p / u_dropCell - 0.5;
	ivec2 c0 = ivec2(floor(g)) + ivec2(1);
	vec3 col = base;
	for (int j = 0; j < 2; j++) {
		for (int i = 0; i < 2; i++) {
			vec4 drop = texelFetch(u_drops, c0 + ivec2(i, j), 0);
			if (drop.w <= 0.0) continue;
			vec2 d = p - drop.xy;
			d.y *= (d.y > 0.0) ? 0.86 : 1.10;
			float r = drop.z;
			float d2 = dot(d, d);
			if (d2 >= r * r) continue;
			float dist = sqrt(d2);
			float rr = dist / r;
			float h = sqrt(max(1.0 - rr * rr, 0.0));
			float lensCover;
			vec3 seen = blobScene(drop.xy - d * ${glslFloat(DROP_LENS)}, lensCover);
			float rim = smoothstep(0.55, 1.0, rr);
			vec3 bead = (u_blend == 0)
				? mix(seen, seen * ${glslFloat(DROP_RIM_DARKEN)}, rim)
				: seen + rim * ${glslFloat(DROP_RIM_LIGHTEN)};
			vec3 n = normalize(vec3(d / r, h));
			float spec = pow(max(dot(n, normalize(vec3(-0.42, -0.62, 0.66))), 0.0), 24.0);
			bead += spec * ${glslFloat(DROP_SPEC)};
			float edgeAA = 1.0 - smoothstep(r - 1.0, r, dist);
			col = mix(col, bead, drop.w * edgeAA * (1.0 - swept));
		}
	}
	return col;
}

// ---- the arms -------------------------------------------------------------

float sdSegment(vec2 q, float t0, float t1) {
	float t = clamp(q.x, t0, t1);
	return length(q - vec2(t, 0.0));
}

float sdBox(vec2 q, vec2 extent) {
	vec2 d = abs(q) - extent;
	return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// The parts of one arm in its own frame (x along the arm from the hub, y
// across it). The rubber rides the mask edge (y = 0) and trails the frame
// against travel; the blade's chrome spine, the four claws that hold the
// rubber, the hinge and the arm shaft sit on the swept side (the blades
// travel clockwise, so that is -y), over notes already wiped.
struct ArmHit {
	float chrome;
	float rubber;
	// signed cross-section coordinate of the nearest chrome part, -1..1
	float chromeSide;
	float rubberSide;
};

ArmHit armParts(vec2 q, float L, float w, float b, float flex) {
	// m grows toward the swept side.
	vec2 m = vec2(q.x, -q.y);
	float bladeLen = L - b;
	float hinge = b + 0.5 * bladeLen;
	// Rubber on the edge, lagging the frame against travel.
	float rubberOff = 0.10 * w * abs(flex);
	float rubberHw = 0.26 * w;
	float dRubber = sdSegment(m - vec2(0.0, rubberOff), b, L) - rubberHw;
	// Blade spine.
	float spineOff = 0.42 * w;
	float spineHw = 0.12 * w;
	float dSpine = sdSegment(m - vec2(0.0, spineOff), b + 0.015 * bladeLen, L - 0.02 * bladeLen) - spineHw;
	// Claws bridging spine and rubber.
	float clawMid = 0.5 * (spineOff + rubberOff);
	vec2 clawHalf = vec2(0.17 * w, 0.5 * (spineOff - rubberOff) + 0.08 * w);
	float dClaw = 1e9;
	for (int k = 0; k < 4; k++) {
		float c = b + (0.08 + 0.28 * float(k)) * bladeLen;
		dClaw = min(dClaw, sdBox(m - vec2(c, clawMid), clawHalf));
	}
	// Arm shaft from the hub to the hinge, beside the blade, tapering toward it.
	float shaftOff = 0.95 * w;
	float shaftHw = 0.34 * w * (1.0 - 0.22 * smoothstep(0.0, hinge, m.x));
	float dShaft = sdSegment(m - vec2(0.0, shaftOff), -L, hinge) - shaftHw;
	// Hinge: the arm's hook over the spine.
	vec2 hingeAt = vec2(hinge, 0.5 * (shaftOff + spineOff));
	vec2 hingeHalf = vec2(0.55 * w, 0.5 * (shaftOff - spineOff) + 0.16 * w);
	float dHinge = sdBox(m - hingeAt, hingeHalf) - 0.08 * w;

	ArmHit hit;
	hit.chrome = min(min(dShaft, dHinge), min(dSpine, dClaw));
	hit.rubber = dRubber;
	if (hit.chrome == dShaft) {
		hit.chromeSide = clamp((m.y - shaftOff) / shaftHw, -1.0, 1.0);
	} else if (hit.chrome == dSpine) {
		hit.chromeSide = clamp((m.y - spineOff) / spineHw, -1.0, 1.0);
	} else if (hit.chrome == dHinge) {
		hit.chromeSide = clamp((m.y - hingeAt.y) / hingeHalf.y, -1.0, 1.0);
	} else {
		hit.chromeSide = clamp((m.y - clawMid) / clawHalf.y, -1.0, 1.0);
	}
	// Back to the arm's own frame for the lighting normal.
	hit.chromeSide = -hit.chromeSide;
	hit.rubberSide = -clamp((m.y - rubberOff) / rubberHw, -1.0, 1.0);
	return hit;
}

// The sky reflected in chrome: dusk over the dark scheme (warm horizon,
// deep zenith, dark ground), a paler evening over the light one so the
// chrome stays silver on the cream page; both carry the bright horizon band
// every chrome part shows.
vec3 duskEnv(float up) {
	vec3 zenith = (u_blend == 0) ? vec3(0.50, 0.58, 0.78) : vec3(0.30, 0.36, 0.60);
	vec3 horizon = (u_blend == 0) ? vec3(0.99, 0.88, 0.76) : vec3(0.98, 0.72, 0.54);
	vec3 ground = (u_blend == 0) ? vec3(0.32, 0.28, 0.30) : vec3(0.15, 0.13, 0.17);
	vec3 env = up > 0.0
		? mix(horizon, zenith, smoothstep(0.0, 0.7, up))
		: mix(horizon, ground, smoothstep(0.0, 0.35, -up));
	env += vec3(0.30, 0.27, 0.24) * exp(-abs(up - 0.06) * 14.0);
	return env;
}

vec3 shadeChrome(vec3 n, vec2 p, float w, float along) {
	vec3 V = vec3(0.0, 0.0, 1.0);
	vec3 Lk = normalize(vec3(-0.42, -0.62, 0.66));
	vec3 Lr = normalize(vec3(0.55, 0.45, 0.30));
	vec3 R = 2.0 * n.z * n - V;
	float up = -R.y;
	vec3 env = duskEnv(up);
	// The blobs behind the glass show in the chrome too.
	vec3 tint;
	float field = blobField(p + R.xy * 2.5 * w, tint);
	float seen = smoothstep(0.1, 1.2, field) * 0.72;
	vec3 blended = (u_blend == 0) ? u_ground * tint : 1.0 - (1.0 - u_ground) * (1.0 - tint);
	env = mix(env, blended, 0.35 * seen);
	float ndl = max(dot(n, Lk), 0.0);
	vec3 H = normalize(Lk + V);
	float spec = pow(max(dot(n, H), 0.0), 70.0);
	vec3 Hr = normalize(Lr + V);
	float specR = pow(max(dot(n, Hr), 0.0), 24.0);
	vec3 F0 = vec3(0.93, 0.92, 0.90);
	vec3 col = env * F0 * (0.72 + 0.28 * ndl);
	col += spec * vec3(1.0, 0.97, 0.92) * 1.15;
	col += specR * vec3(0.65, 0.78, 1.0) * 0.40;
	// Y2K sheen: a thin-film palette weighted by the fresnel term, strongest
	// at the rounded edges, drifting slowly along the arm.
	float fr = pow(1.0 - n.z, 3.0);
	vec3 irid = 0.5 + 0.5 * cos(2.0 * PI * (vec3(0.0, 0.33, 0.67) + 1.3 * (1.0 - n.z) + 0.0008 * along));
	col = mix(col, col * (0.6 + 0.9 * irid), 0.55 * fr);
	return col;
}

vec3 shadeRubber(vec3 n) {
	vec3 V = vec3(0.0, 0.0, 1.0);
	vec3 Lk = normalize(vec3(-0.42, -0.62, 0.66));
	vec3 base = vec3(0.10, 0.09, 0.11);
	float ndl = max(dot(n, Lk), 0.0);
	vec3 H = normalize(Lk + V);
	float sheen = pow(max(dot(n, H), 0.0), 14.0);
	float fr = pow(1.0 - n.z, 3.0);
	return base * (0.55 + 0.45 * ndl) + sheen * vec3(0.30, 0.32, 0.36) + fr * vec3(0.10, 0.12, 0.16);
}

// Half-cylinder normal in screen space from a signed cross-section coordinate.
vec3 sectionNormal(vec2 across, float side) {
	float nz = sqrt(max(1.0 - side * side, 0.0));
	return normalize(vec3(across * side, nz));
}

void main() {
	vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
	vec2 uv = p / u_resolution;

	if (u_layer == 0) {
		float cover;
		vec3 blobs = blobScene(p, cover);
		// The glass: frost and beads ride the field and vanish behind a
		// moving edge; the blades themselves live on layer 1.
		float swept = sweptNow(p);
		outColor = vec4(droplets(p, frost(uv, blobs, swept), swept), 1.0);
		return;
	}

	// The blade layer, accumulated premultiplied: each arm darkens what lies
	// beneath (a soft shadow cast down and right, a tight contact shadow where
	// the rubber meets the glass), then lays its lit parts over it.
	vec3 rgb = vec3(0.0);
	float alpha = 0.0;
	for (int i = 0; i < ${MAX_ARMS}; i++) {
		if (i >= u_armCount) break;
		vec4 arm = u_arms[i];
		vec4 style = u_armStyle[i];
		float L = arm.w;
		float w = style.x;
		float b = style.y;
		float flex = style.z;
		vec2 along = vec2(sin(arm.z), -cos(arm.z));
		vec2 across = vec2(cos(arm.z), sin(arm.z));
		vec2 rel = p - arm.xy;
		vec2 q = vec2(dot(rel, along), dot(rel, across));
		// Cheap reject far from the arm.
		if (abs(q.y) > 4.0 * w || q.x < -w || q.x > L + w) continue;

		ArmHit hit = armParts(q, L, w, b, flex);
		vec2 offset = vec2(0.45 * w, 0.60 * w);
		vec2 relShadow = rel - offset;
		vec2 qs = vec2(dot(relShadow, along), dot(relShadow, across));
		ArmHit under = armParts(qs, L, w, b, flex);
		float dUnder = min(under.chrome, under.rubber);
		float shadow = 0.26 * exp(-max(dUnder, 0.0) / (0.75 * w));
		shadow += 0.30 * exp(-max(hit.rubber, 0.0) / (0.22 * w));
		shadow = clamp(shadow, 0.0, 0.5);
		rgb *= 1.0 - shadow;
		alpha = shadow + alpha * (1.0 - shadow);

		float aa = 0.75;
		float rubberCover = 1.0 - smoothstep(-aa, aa, hit.rubber);
		if (rubberCover > 0.0) {
			vec3 n = sectionNormal(across, hit.rubberSide);
			vec3 c = shadeRubber(n);
			rgb = c * rubberCover + rgb * (1.0 - rubberCover);
			alpha = rubberCover + alpha * (1.0 - rubberCover);
		}
		float chromeCover = 1.0 - smoothstep(-aa, aa, hit.chrome);
		if (chromeCover > 0.0) {
			vec3 n = sectionNormal(across, hit.chromeSide);
			vec3 c = shadeChrome(n, p, w, q.x);
			rgb = c * chromeCover + rgb * (1.0 - chromeCover);
			alpha = chromeCover + alpha * (1.0 - chromeCover);
		}
	}
	outColor = vec4(rgb, alpha);
}
`;
