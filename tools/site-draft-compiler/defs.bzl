"""Register from the root package so the real shared schemas retain their paths."""

load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")
load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")
load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@aspect_rules_js//npm:defs.bzl", "npm_link_package", "npm_package")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")

def site_draft_compiler_targets():
    """Compile, package and test the compiler; this does not publish a BCR module."""
    if native.package_name() != "":
        fail("site_draft_compiler_targets must be registered at the repository root")

    scripts = [
        "scripts/lib/featured-image.mjs",
        "scripts/lib/leak-scan.mjs",
        "scripts/lib/log-content.mjs",
        "scripts/lib/log-projection.mjs",
        "scripts/lib/log-source-guard.mjs",
    ]
    compiler_source = Label("//tools/site-draft-compiler:compiler.ts")
    typed_sources = [
        "tools/site-draft-compiler/compiler.ts",
        "src/lib/featured-image-schema.ts",
        "src/lib/public-log-schema.ts",
    ]
    # Stage exact original artifacts under one generated root. rules_ts needs
    # string source paths to predict outputs, and a root alias cannot cross the
    # compiler's child BUILD package. Removing only this staging prefix keeps
    # all relative imports and public runtime/declaration paths unchanged.
    input_root = "site-draft-compiler-inputs"
    staged_sources = []
    for index, source in enumerate(typed_sources + scripts):
        staged = input_root + "/" + source
        copy_file(
            name = "site_draft_compiler_input_{}".format(index),
            src = compiler_source if index == 0 else source,
            out = staged,
        )
        staged_sources.append(staged)
    runtime_packages = [
        ":node_modules/mdsvex",
        ":node_modules/prettier",
        ":node_modules/prettier-plugin-svelte",
        ":node_modules/svelte",
    ]
    ts_project(
        name = "site_draft_compiler_js",
        srcs = staged_sources,
        allow_js = True,
        declaration = True,
        out_dir = "site-draft-compiler-js",
        root_dir = input_root,
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
    # Preserve exact source bytes separately: tsc may rewrite the .mjs files
    # it emits, so runtime bytes cannot stand in for canonical Git preimages.
    copy_to_directory(
        name = "site_draft_compiler_sources",
        out = "site-draft-compiler-source",
        srcs = [compiler_source] + typed_sources[1:] + scripts + [
            Label("//tools/site-draft-compiler:defs.bzl"),
            Label("//tools/site-draft-compiler:BUILD.bazel"),
            Label("//tools/site-draft-compiler:package.json"),
            ".prettierrc",
            "MODULE.bazel",
            "package.json",
            "pnpm-lock.yaml",
            "scripts/lib/leak-scan-rules.json",
        ],
        root_paths = ["."],
        hardlink = "off",
    )
    # Carry emitted files without forwarding TypeScript's build-only @types
    # dependencies into the runtime package-store graph.
    copy_to_directory(
        name = "site_draft_compiler_runtime",
        out = "site-draft-compiler-runtime",
        srcs = [":site_draft_compiler_js", "scripts/lib/leak-scan-rules.json"],
        root_paths = ["site-draft-compiler-js"],
    )
    npm_package(
        name = "pkg",
        srcs = [
            ":site_draft_compiler_runtime",
            ":site_draft_compiler_sources",
            Label("//tools/site-draft-compiler:package.json"),
            "LICENSE",
        ],
        # Propagate package-store providers, not an ambient root node_modules.
        # npm_link_package consumers receive this complete dependency closure.
        data = runtime_packages,
        package = "@gftb/site-draft-compiler",
        version = "0.3.0",
        root_paths = ["."],
        replace_prefixes = {
            "site-draft-compiler-runtime/": "",
            "site-draft-compiler-source": "source",
            "tools/site-draft-compiler/package.json": "package.json",
        },
        publishable = False,
        visibility = ["//visibility:public"],
    )
    npm_link_package(
        name = "node_modules/@gftb/site-draft-compiler",
        src = ":pkg",
        visibility = ["//visibility:private"],
    )
    js_test(
        name = "site_draft_compiler_behavior_test",
        entry_point = Label("//tools/site-draft-compiler:compiler.test.mjs"),
        data = [
            ":pkg",
            ":app_srcs",
            Label("//tools/site-draft-compiler:fixtures.mjs"),
            ".prettierrc",
            "tinyland.repo.json",
        ] + runtime_packages,
        env = {"SITE_DRAFT_COMPILER_PACKAGE": "$(rootpath :pkg)"},
        timeout = "short",
    )
    js_test(
        name = "site_draft_compiler_consumer_test",
        entry_point = Label("//tools/site-draft-compiler:consumer.test.mjs"),
        data = [
            ":node_modules/@gftb/site-draft-compiler",
            Label("//tools/site-draft-compiler:fixtures.mjs"),
        ],
        timeout = "short",
    )
    native.test_suite(
        name = "site_draft_compiler_test",
        tests = [
            ":site_draft_compiler_behavior_test",
            ":site_draft_compiler_consumer_test",
        ],
    )
