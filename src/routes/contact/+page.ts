// Directory-shaped output (contact/index.html): the serving plane is a plain
// static file server (Caddy `file_server` in flake.nix, mirrored by
// scripts/bazel_output.py preview) with no extension rewriting, so nested
// pages must prerender as directories to be reachable at clean URLs.
export const trailingSlash = 'always';
