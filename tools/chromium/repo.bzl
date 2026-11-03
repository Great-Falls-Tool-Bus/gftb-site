"""@chromium_nix: the Nix store Chromium of this host (R583, TIN-7477).

Reads the pinned store path for the host system from nix-paths.json and fails
unless its bin/chromium exists and is executable. Nothing here downloads:
`just chromium-pin` realises the flake output first. Only //:e2e_test resolves
the toolchain that names this repository, so a host without the store path
(the GFTB cell's vendor host) never fetches it (critique N1).
"""

_SYSTEMS = {
    ("linux", "amd64"): "x86_64-linux",
    ("linux", "x86_64"): "x86_64-linux",
    ("mac os x", "aarch64"): "aarch64-darwin",
    ("mac os x", "arm64"): "aarch64-darwin",
}

def _chromium_nix_impl(rctx):
    pins = json.decode(rctx.read(rctx.attr.paths))
    system = _SYSTEMS.get((rctx.os.name.lower(), rctx.os.arch))
    if system == None or system not in pins["systems"]:
        fail("no e2e Chromium is pinned for %s %s in tools/chromium/nix-paths.json" % (rctx.os.name, rctx.os.arch))
    entry = pins["systems"][system]
    store_path = entry["store_path"]
    if not store_path.startswith("/nix/store/") or "/" in store_path[len("/nix/store/"):]:
        fail("tools/chromium/nix-paths.json: %s is not a top-level Nix store path" % store_path)
    executable = store_path + "/bin/chromium"
    if rctx.execute(["/bin/sh", "-c", 'test -x "$1"', "sh", executable]).return_code != 0:
        fail("%s is missing or not executable: run `just chromium-pin` (nix build .#e2e-chromium)" % executable)
    fontconfig_file = store_path + "/etc/fonts/fonts.conf" if system.endswith("-linux") else ""
    rctx.file("BUILD.bazel", """load("@@//tools/chromium:defs.bzl", "chromium_toolchain")

chromium_toolchain(
    name = "impl",
    executable = {executable},
    fontconfig_file = {fontconfig_file},
    revision = {revision},
    source = "nix",
    visibility = ["//visibility:public"],
)
""".format(
        executable = json.encode(executable),
        fontconfig_file = json.encode(fontconfig_file),
        revision = json.encode(pins["playwright_chromium_revision"]),
    ))

chromium_nix = repository_rule(
    implementation = _chromium_nix_impl,
    attrs = {"paths": attr.label(allow_single_file = [".json"], mandatory = True)},
    local = True,
)
