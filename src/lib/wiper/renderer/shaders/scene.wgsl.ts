// The WebGPU scene shader as a template string (the build-output scanner
// classifies files by extension and fails closed on anything it does not
// know, so shaders live inside modules). The same constants as the GLSL and
// the same names: every GLSL uniform u_name appears here verbatim as a
// struct member or a binding, so the source contract can hold the two tiers
// in lockstep, and both read the one uniform block (renderer/uniform-block.ts).
// Sampling sites use textureSampleLevel so they need no uniform control
// flow; the bead field is fetched by texel with textureLoad.
import { DROP_LENS, DROP_RIM_DARKEN, DROP_RIM_LIGHTEN, DROP_SPEC, MAX_ARMS, MAX_BLOBS } from './constants';

/** A number as a WGSL f32 literal (32 reads 32.0). */
const wgslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : `${value}`);

export const SCENE_WGSL = `struct Uniforms {
	// offset 0
	u_resolution : vec2<f32>,
	// offset 8, seconds: the sheen drifts along the arm with it
	u_time : f32,
	// offset 12, device px
	u_dropCell : f32,
	// offset 16
	u_ground : vec3<f32>,
	// offset 28
	u_blend : i32,
	// offset 32
	u_frost : f32,
	// offset 36
	u_frostMax : f32,
	// offset 40
	u_layer : i32,
	// offset 44
	u_blobCount : i32,
	// offset 48
	u_armCount : i32,
	// offsets 52, 56, 60: explicit padding so the arrays start at 64
	u_pad0 : f32,
	u_pad1 : f32,
	u_pad2 : f32,
	// offset 64, stride 16: x, y, r (device px), unused
	u_blobs : array<vec4<f32>, ${MAX_BLOBS}>,
	// offset 192, stride 16: rgb, unused
	u_blobColors : array<vec4<f32>, ${MAX_BLOBS}>,
	// offset 320: pivot.xy (device px), phi (radians), length (device px)
	u_arms : array<vec4<f32>, ${MAX_ARMS}>,
	// offset 352: width, bladeFrom (device px), flex (-1..1), unused
	u_armStyle : array<vec4<f32>, ${MAX_ARMS}>,
	// offset 384: across(-park), across(halfSweep)
	u_armFan : array<vec4<f32>, ${MAX_ARMS}>,
	// offset 416: across(phi), travel (-1, 0, 1), anti-alias half-width (device px)
	u_armEdge : array<vec4<f32>, ${MAX_ARMS}>,
	// total 448 bytes
}

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var u_fieldSampler : sampler;
// The bead field: rgba32float, fetched by texel, never sampled.
@group(0) @binding(2) var u_drops : texture_2d<f32>;
@group(0) @binding(3) var u_frostTex : texture_2d<f32>;

const PI : f32 = 3.14159265;

@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> @builtin(position) vec4<f32> {
	var corners = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
	return vec4<f32>(corners[index], 0.0, 1.0);
}

// ---- the blob field ------------------------------------------------------

struct FieldSample {
	field : f32,
	tint : vec3<f32>,
}

fn blobField(p : vec2<f32>) -> FieldSample {
	var field = 0.0;
	var weight = 0.0;
	var sum = vec3<f32>(0.0);
	for (var i = 0; i < ${MAX_BLOBS}; i++) {
		if (i >= u.u_blobCount) { break; }
		let b = u.u_blobs[i];
		let d = p - b.xy;
		let f = (b.z * b.z) / (dot(d, d) + 1.0);
		field += f;
		weight += f;
		sum += u.u_blobColors[i].xyz * f;
	}
	return FieldSample(field, sum / max(weight, 1.0e-4));
}

fn blobScene(p : vec2<f32>) -> vec3<f32> {
	let sampled = blobField(p);
	let body = smoothstep(0.55, 1.6, sampled.field) * 0.72;
	let halo = smoothstep(0.03, 0.45, sampled.field) * 0.34;
	let cover = clamp(max(body, halo), 0.0, 0.72);
	let blended = select(1.0 - (1.0 - u.u_ground) * (1.0 - sampled.tint), u.u_ground * sampled.tint, u.u_blend == 0);
	return mix(u.u_ground, blended, cover);
}

// ---- the glass: swept edge, frost, droplets --------------------------------

fn sweptNow(p : vec2<f32>) -> f32 {
	var swept = 0.0;
	for (var i = 0; i < ${MAX_ARMS}; i++) {
		if (i >= u.u_armCount) { break; }
		let edge = u.u_armEdge[i];
		if (edge.z == 0.0) { continue; }
		let arm = u.u_arms[i];
		let rel = p - arm.xy;
		if (dot(rel, rel) > arm.w * arm.w) { continue; }
		let fan = u.u_armFan[i];
		let inFan = step(0.0, dot(rel, fan.xy)) * step(dot(rel, fan.zw), 0.0);
		let acrossEdge = dot(rel, edge.xy);
		let behind = select(acrossEdge, -acrossEdge, edge.z > 0.0);
		swept = max(swept, inFan * smoothstep(-edge.w, edge.w, behind));
	}
	return swept;
}

fn frost(uv : vec2<f32>, col : vec3<f32>, swept : f32) -> vec3<f32> {
	let h = textureSampleLevel(u_frostTex, u_fieldSampler, uv, 0.0).r * u.u_frost * (1.0 - swept);
	let tint = select(vec3<f32>(0.62, 0.66, 0.76), vec3<f32>(0.97, 0.98, 1.0), u.u_blend == 0);
	let soft = mix(col, mix(u.u_ground, col, 0.6), 0.5 * h);
	return mix(soft, tint, u.u_frostMax * h);
}

fn droplets(p : vec2<f32>, base : vec3<f32>, swept : f32) -> vec3<f32> {
	let g = p / u.u_dropCell - 0.5;
	let c0 = vec2<i32>(floor(g)) + vec2<i32>(1);
	var col = base;
	for (var j = 0; j < 2; j++) {
		for (var i = 0; i < 2; i++) {
			let drop = textureLoad(u_drops, c0 + vec2<i32>(i, j), 0);
			if (drop.w <= 0.0) { continue; }
			var d = p - drop.xy;
			d.y = d.y * select(1.10, 0.86, d.y > 0.0);
			let r = drop.z;
			let d2 = dot(d, d);
			if (d2 >= r * r) { continue; }
			let dist = sqrt(d2);
			let rr = dist / r;
			let h = sqrt(max(1.0 - rr * rr, 0.0));
			let seen = blobScene(drop.xy - d * ${wgslFloat(DROP_LENS)});
			let rim = smoothstep(0.55, 1.0, rr);
			var bead = select(seen + rim * ${wgslFloat(DROP_RIM_LIGHTEN)}, mix(seen, seen * ${wgslFloat(DROP_RIM_DARKEN)}, rim), u.u_blend == 0);
			let n = normalize(vec3<f32>(d / r, h));
			let spec = pow(max(dot(n, normalize(vec3<f32>(-0.42, -0.62, 0.66))), 0.0), 24.0);
			bead += spec * ${wgslFloat(DROP_SPEC)};
			let edgeAA = 1.0 - smoothstep(r - 1.0, r, dist);
			col = mix(col, bead, drop.w * edgeAA * (1.0 - swept));
		}
	}
	return col;
}

// ---- the arms -------------------------------------------------------------

fn sdSegment(q : vec2<f32>, t0 : f32, t1 : f32) -> f32 {
	let t = clamp(q.x, t0, t1);
	return length(q - vec2<f32>(t, 0.0));
}

fn sdBox(q : vec2<f32>, extent : vec2<f32>) -> f32 {
	let d = abs(q) - extent;
	return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

struct ArmHit {
	chrome : f32,
	rubber : f32,
	chromeSide : f32,
	rubberSide : f32,
}

fn armParts(q : vec2<f32>, L : f32, w : f32, b : f32, flex : f32) -> ArmHit {
	let m = vec2<f32>(q.x, -q.y);
	let bladeLen = L - b;
	let hinge = b + 0.5 * bladeLen;
	let rubberOff = 0.10 * w * abs(flex);
	let rubberHw = 0.26 * w;
	let dRubber = sdSegment(m - vec2<f32>(0.0, rubberOff), b, L) - rubberHw;
	let spineOff = 0.42 * w;
	let spineHw = 0.12 * w;
	let dSpine = sdSegment(m - vec2<f32>(0.0, spineOff), b + 0.015 * bladeLen, L - 0.02 * bladeLen) - spineHw;
	let clawMid = 0.5 * (spineOff + rubberOff);
	let clawHalf = vec2<f32>(0.17 * w, 0.5 * (spineOff - rubberOff) + 0.08 * w);
	var dClaw = 1.0e9;
	for (var k = 0; k < 4; k++) {
		let c = b + (0.08 + 0.28 * f32(k)) * bladeLen;
		dClaw = min(dClaw, sdBox(m - vec2<f32>(c, clawMid), clawHalf));
	}
	let shaftOff = 0.95 * w;
	let shaftHw = 0.34 * w * (1.0 - 0.22 * smoothstep(0.0, hinge, m.x));
	let dShaft = sdSegment(m - vec2<f32>(0.0, shaftOff), -L, hinge) - shaftHw;
	let hingeAt = vec2<f32>(hinge, 0.5 * (shaftOff + spineOff));
	let hingeHalf = vec2<f32>(0.55 * w, 0.5 * (shaftOff - spineOff) + 0.16 * w);
	let dHinge = sdBox(m - hingeAt, hingeHalf) - 0.08 * w;

	var hit : ArmHit;
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
	hit.chromeSide = -hit.chromeSide;
	hit.rubberSide = -clamp((m.y - rubberOff) / rubberHw, -1.0, 1.0);
	return hit;
}

fn duskEnv(up : f32) -> vec3<f32> {
	let zenith = select(vec3<f32>(0.30, 0.36, 0.60), vec3<f32>(0.50, 0.58, 0.78), u.u_blend == 0);
	let horizon = select(vec3<f32>(0.98, 0.72, 0.54), vec3<f32>(0.99, 0.88, 0.76), u.u_blend == 0);
	let ground = select(vec3<f32>(0.15, 0.13, 0.17), vec3<f32>(0.32, 0.28, 0.30), u.u_blend == 0);
	var env = select(
		mix(horizon, ground, smoothstep(0.0, 0.35, -up)),
		mix(horizon, zenith, smoothstep(0.0, 0.7, up)),
		up > 0.0);
	env += vec3<f32>(0.30, 0.27, 0.24) * exp(-abs(up - 0.06) * 14.0);
	return env;
}

fn shadeChrome(n : vec3<f32>, p : vec2<f32>, w : f32, along : f32) -> vec3<f32> {
	let V = vec3<f32>(0.0, 0.0, 1.0);
	let Lk = normalize(vec3<f32>(-0.42, -0.62, 0.66));
	let Lr = normalize(vec3<f32>(0.55, 0.45, 0.30));
	let R = 2.0 * n.z * n - V;
	let up = -R.y;
	var env = duskEnv(up);
	let sampled = blobField(p + R.xy * 2.5 * w);
	let seen = smoothstep(0.1, 1.2, sampled.field) * 0.72;
	let blended = select(1.0 - (1.0 - u.u_ground) * (1.0 - sampled.tint), u.u_ground * sampled.tint, u.u_blend == 0);
	env = mix(env, blended, 0.35 * seen);
	let ndl = max(dot(n, Lk), 0.0);
	let H = normalize(Lk + V);
	let spec = pow(max(dot(n, H), 0.0), 70.0);
	let Hr = normalize(Lr + V);
	let specR = pow(max(dot(n, Hr), 0.0), 24.0);
	let F0 = vec3<f32>(0.93, 0.92, 0.90);
	var col = env * F0 * (0.72 + 0.28 * ndl);
	col += spec * vec3<f32>(1.0, 0.97, 0.92) * 1.15;
	col += specR * vec3<f32>(0.65, 0.78, 1.0) * 0.40;
	let fr = pow(1.0 - n.z, 3.0);
	let irid = 0.5 + 0.5 * cos(2.0 * PI * (vec3<f32>(0.0, 0.33, 0.67) + 1.3 * (1.0 - n.z) + 0.0008 * along + 0.05 * u.u_time));
	col = mix(col, col * (0.6 + 0.9 * irid), 0.55 * fr);
	return col;
}

fn shadeRubber(n : vec3<f32>) -> vec3<f32> {
	let V = vec3<f32>(0.0, 0.0, 1.0);
	let Lk = normalize(vec3<f32>(-0.42, -0.62, 0.66));
	let base = vec3<f32>(0.10, 0.09, 0.11);
	let ndl = max(dot(n, Lk), 0.0);
	let H = normalize(Lk + V);
	let sheen = pow(max(dot(n, H), 0.0), 14.0);
	let fr = pow(1.0 - n.z, 3.0);
	return base * (0.55 + 0.45 * ndl) + sheen * vec3<f32>(0.30, 0.32, 0.36) + fr * vec3<f32>(0.10, 0.12, 0.16);
}

fn sectionNormal(across : vec2<f32>, side : f32) -> vec3<f32> {
	let nz = sqrt(max(1.0 - side * side, 0.0));
	return normalize(vec3<f32>(across * side, nz));
}

@fragment
fn fs_main(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
	// Framebuffer coordinates are already top-left, y down, pixel-centred.
	let p = pos.xy;
	let uv = p / u.u_resolution;

	if (u.u_layer == 0) {
		let blobs = blobScene(p);
		let swept = sweptNow(p);
		return vec4<f32>(droplets(p, frost(uv, blobs, swept), swept), 1.0);
	}

	var rgb = vec3<f32>(0.0);
	var alpha = 0.0;
	for (var i = 0; i < ${MAX_ARMS}; i++) {
		if (i >= u.u_armCount) { break; }
		let arm = u.u_arms[i];
		let style = u.u_armStyle[i];
		let L = arm.w;
		let w = style.x;
		let b = style.y;
		let flex = style.z;
		let along = vec2<f32>(sin(arm.z), -cos(arm.z));
		let across = vec2<f32>(cos(arm.z), sin(arm.z));
		let rel = p - arm.xy;
		let q = vec2<f32>(dot(rel, along), dot(rel, across));
		if (abs(q.y) > 4.0 * w || q.x < -w || q.x > L + w) { continue; }

		let hit = armParts(q, L, w, b, flex);
		let offset = vec2<f32>(0.45 * w, 0.60 * w);
		let relShadow = rel - offset;
		let qs = vec2<f32>(dot(relShadow, along), dot(relShadow, across));
		let under = armParts(qs, L, w, b, flex);
		let dUnder = min(under.chrome, under.rubber);
		var shadow = 0.26 * exp(-max(dUnder, 0.0) / (0.75 * w));
		shadow += 0.30 * exp(-max(hit.rubber, 0.0) / (0.22 * w));
		shadow = clamp(shadow, 0.0, 0.5);
		rgb *= 1.0 - shadow;
		alpha = shadow + alpha * (1.0 - shadow);

		let aa = 0.75;
		let rubberCover = 1.0 - smoothstep(-aa, aa, hit.rubber);
		if (rubberCover > 0.0) {
			let n = sectionNormal(across, hit.rubberSide);
			let c = shadeRubber(n);
			rgb = c * rubberCover + rgb * (1.0 - rubberCover);
			alpha = rubberCover + alpha * (1.0 - rubberCover);
		}
		let chromeCover = 1.0 - smoothstep(-aa, aa, hit.chrome);
		if (chromeCover > 0.0) {
			let n = sectionNormal(across, hit.chromeSide);
			let c = shadeChrome(n, p, w, q.x);
			rgb = c * chromeCover + rgb * (1.0 - chromeCover);
			alpha = chromeCover + alpha * (1.0 - chromeCover);
		}
	}
	return vec4<f32>(rgb, alpha);
}
`;
