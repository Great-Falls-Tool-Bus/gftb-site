// This route exists to be a FILE, not a destination. adapter-static writes a
// prerendered `/404` to `build/404.html`, which is what the Caddyfile's
// `handle_errors` block serves for every missing path.
//
// It replaces the SPA fallback that used to occupy that filename. A fallback is
// rendered with `ssr: false` and an empty branch, so its body was empty and a
// scriptless client saw nothing at all — the same blank page the zero-byte 404
// gave them.
export const prerender = true;

// No hydration. The served HTML is the whole page, so booting the client router
// here would only add a route/URL mismatch (the bytes are prerendered for
// `/404` but served at whatever path the visitor asked for) in exchange for
// nothing. It also makes the JavaScript-off and JavaScript-on renderings
// byte-identical, which is the property the acceptance suite asserts.
export const csr = false;
