// ── HOUSE CANON IDIOM ────────────────────────────────────────────────────────
// Deterministic name → tint. A pure, dependency-free hash that maps any string
// (a person's name, a steward, a tool label) to a STABLE hue, so an avatar tile
// or chip gets a consistent background without storing a color per record. Same
// input always yields the same hue across renders, sessions, and SSR/CSR, so
// there is no hydration flicker.
//
// This helper is intentionally brand-neutral: it returns raw HSL parts and a
// ready-to-use `hsl(...)` string. Saturation/lightness default to muted values
// that read on both light and dark themes; a spoke can override them or feed the
// hue into its own theme tokens. The *shape* of the tile that consumes this
// (square vs. rounded, border, ring) is a per-spoke styling choice, not encoded
// here.

export interface NameTint {
	/** Stable hue in [0, 360). */
	hue: number;
	/** `hsl(h s% l%)` string for a background fill. */
	background: string;
	/** A readable foreground (`hsl`) paired with `background`. */
	foreground: string;
}

export interface NameTintOptions {
	/** Saturation percent for the background. Defaults to 55. */
	saturation?: number;
	/** Lightness percent for the background. Defaults to 82. */
	lightness?: number;
	/** Lightness percent for the paired foreground text. Defaults to 28. */
	foregroundLightness?: number;
}

/** FNV-1a 32-bit hash - small, fast, well-distributed for short strings. */
function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		// 32-bit FNV prime multiply via shifts (stays in 32-bit unsigned range).
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash >>> 0;
}

/** Map a name to a stable, theme-safe tint. Trims + lowercases so casing/spacing
 * variants of the same name share a color. */
export function nameTint(name: string, options: NameTintOptions = {}): NameTint {
	const saturation = options.saturation ?? 55;
	const lightness = options.lightness ?? 82;
	const foregroundLightness = options.foregroundLightness ?? 28;
	const hue = fnv1a(name.trim().toLowerCase()) % 360;
	return {
		hue,
		background: `hsl(${hue} ${saturation}% ${lightness}%)`,
		foreground: `hsl(${hue} ${Math.min(saturation + 10, 100)}% ${foregroundLightness}%)`,
	};
}

/** Up-to-two-character initials from a name, for avatar fallbacks. */
export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
