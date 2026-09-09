"""Register from the root package so the real shared schemas retain their paths."""

load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")
load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")

def site_draft_compiler_targets():
    """Compile and test the source-only package; this does not publish a BCR module."""
    if native.package_name() != "":
        fail("site_draft_compiler_targets must be registered at the repository root")

    scripts = [
        "scripts/lib/featured-image.mjs",
        "scripts/lib/leak-scan.mjs",
        "scripts/lib/log-content.mjs",
        "scripts/lib/log-projection.mjs",
        "scripts/lib/log-source-guard.mjs",
    ]
    typed_sources = [
        Label("//tools/site-draft-compiler:compiler.ts"),
        "src/lib/featured-image-schema.ts",
        "src/lib/public-log-schema.ts",
    ]
    runtime_packages = [
        ":node_modules/mdsvex",
        ":node_modules/prettier",
        ":node_modules/prettier-plugin-svelte",
        ":node_modules/svelte",
    ]
    ts_project(
        name = "site_draft_compiler_js",
        srcs = typed_sources + scripts,
        allow_js = True,
        declaration = True,
        out_dir = "site-draft-compiler-js",
        transpiler = "tsc",
        tsconfig = {
            "compilerOptions": {
                "target": "ES2022",
                "module": "ESNext",
                "moduleResolution": "Bundler",
                "strict": True,
                "checkJs": False,
                "skipLibCheck": True,
                "esModuleInterop": True,
                "types": ["node"],
            },
        },
        deps = runtime_packages + [":node_modules/@types/node"],
    )
    copy_to_directory(
        name = "site_draft_compiler_package",
        srcs = [":site_draft_compiler_js"] + typed_sources + [
            Label("//tools/site-draft-compiler:defs.bzl"),
            Label("//tools/site-draft-compiler:BUILD.bazel"),
            ".prettierrc",
            "MODULE.bazel",
            "package.json",
            "pnpm-lock.yaml",
            "scripts/lib/leak-scan-rules.json",
        ],
        root_paths = ["site-draft-compiler-js"],
        visibility = ["//visibility:public"],
    )
    js_test(
        name = "site_draft_compiler_test",
        entry_point = Label("//tools/site-draft-compiler:compiler.test.mjs"),
        data = [
            ":site_draft_compiler_package",
            ":app_srcs",
            ".prettierrc",
            "tinyland.repo.json",
        ] + runtime_packages,
        env = {"SITE_DRAFT_COMPILER_PACKAGE": "$(rootpath :site_draft_compiler_package)"},
        timeout = "short",
    )
