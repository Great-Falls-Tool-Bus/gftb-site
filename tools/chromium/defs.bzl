"""The Chromium that //:e2e_test drives (R583, TIN-7477).

Two implementations of one toolchain type: the GF provisioned /bin/chromium on
rbe-linux-x86_64 (TIN-1131), and a Nix store Chromium on a lab host (sting,
neo, pzm). The toolchain() targets live in //tools/chromium, in this
repository; only the Nix implementation lives in the @chromium_nix repository,
which is fetched only when a target resolves this toolchain type (critique N1).
"""

ChromiumInfo = provider(
    doc = "A Chromium executable outside the action inputs, named by absolute path.",
    fields = {
        "executable": "Absolute path of the Chromium executable.",
        "fontconfig_file": "Absolute path of a fonts.conf for Linux, or empty.",
        "revision": "The Playwright Chromium revision this executable is (browsers.json), or empty when unknown.",
        "source": "\"nix\" or \"gf_rbe\".",
    },
)

def _chromium_toolchain_impl(ctx):
    if not ctx.attr.executable.startswith("/"):
        fail("chromium_toolchain.executable must be an absolute path")
    return [platform_common.ToolchainInfo(chromium = ChromiumInfo(
        executable = ctx.attr.executable,
        fontconfig_file = ctx.attr.fontconfig_file,
        revision = ctx.attr.revision,
        source = ctx.attr.source,
    ))]

chromium_toolchain = rule(
    implementation = _chromium_toolchain_impl,
    attrs = {
        "executable": attr.string(mandatory = True),
        "fontconfig_file": attr.string(default = ""),
        "revision": attr.string(default = ""),
        "source": attr.string(mandatory = True, values = ["gf_rbe", "nix"]),
    },
)

_TOOLCHAIN_TYPE = Label("//tools/chromium:toolchain_type")

def _resolved_chromium_impl(ctx):
    info = ctx.toolchains[_TOOLCHAIN_TYPE].chromium
    return [platform_common.TemplateVariableInfo({
        "GF_E2E_CHROMIUM_EXECUTABLE": info.executable,
        "GF_E2E_CHROMIUM_REVISION": info.revision,
        "GF_E2E_CHROMIUM_SOURCE": info.source,
        "GF_E2E_FONTCONFIG_FILE": info.fontconfig_file,
    })]

resolved_chromium = rule(
    implementation = _resolved_chromium_impl,
    doc = "Make variables for the resolved Chromium toolchain, for a test's `toolchains` and `env`.",
    toolchains = [_TOOLCHAIN_TYPE],
)
