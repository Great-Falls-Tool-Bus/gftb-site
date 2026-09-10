"""Hermetic source-validation test rules."""

def _external_runfiles_path(file):
    """Return an external executable's path beneath TEST_SRCDIR."""
    if not file.short_path.startswith("../"):
        fail("validator executable must come from an external toolchain repository")
    return file.short_path[3:]

def _gitleaks_test_impl(ctx):
    if not ctx.file.source_tree.is_directory:
        fail("gitleaks source must be a materialized directory artifact")
    launcher = ctx.actions.declare_file(ctx.label.name + ".sh")
    scanner_path = _external_runfiles_path(ctx.executable._gitleaks)

    ctx.actions.write(
        content = """#!/bin/sh
set -eu
readonly source_artifact="${TEST_SRCDIR:?}/${TEST_WORKSPACE:?}/@SOURCE_TREE@"
readonly source_root="${TEST_TMPDIR:?}/gitleaks-source"
readonly scanner="${TEST_SRCDIR:?}/@SCANNER@"
readonly config="${source_root}/@CONFIG@"
readonly ignore="${source_root}/.gitleaksignore"
readonly controls="${TEST_TMPDIR:?}/gitleaks-controls"

# The sandbox recreates directory-artifact inputs as per-file symlinks.
# Materialize only that declared tree under Bazel's own test scratch root.
# Source-relative regular files keep build-path exclusions from masking inputs.
mkdir "$source_root"
cp -R -L "$source_artifact/." "$source_root/"
residual_links="$(find "$source_root" -type l -print)"
if [ -n "$residual_links" ]; then
    echo "Declared-source materialization retained symlinks." >&2
    exit 1
fi

positive_summary() {
    awk '
        /scanned ~[0-9]+ bytes / {
            summaries++
            if ($0 ~ /scanned ~[1-9][0-9]* bytes /) positive++
        }
        END { exit !(summaries == 1 && positive == 1) }
    ' "$1"
}

scan() {
    scanner_status=0
    "$scanner" dir . --config "$config" --gitleaks-ignore-path "$ignore" \\
        --exit-code 1 --no-banner --no-color --redact=100 > "$1" 2>&1 || scanner_status=$?
    if [ "$scanner_status" -ne 0 ]; then
        return "$scanner_status"
    fi
    # The pinned scanner itself returns success for zero bytes. Fail closed
    # if its measured summary is zero, missing or ambiguous.
    if ! positive_summary "$1"; then
        return 2
    fi
}

cd "$source_root"
printf 'Declared-source regular files: '
find . -type f | wc -l
source_status=0
scan "${TEST_TMPDIR}/gitleaks-source.log" || source_status=$?
cat "${TEST_TMPDIR}/gitleaks-source.log"
if [ "$source_status" -ne 0 ]; then
    echo "Declared-source Gitleaks scan failed or scanned no bytes." >&2
    exit "$source_status"
fi

# Exercise the same wrapper and actual scanner, with the unchanged rules.
# Runtime-only synthetic bytes never enter the declared source artifact.
mkdir "$controls" "$controls/empty" "$controls/canary"
cd "$controls/empty"
empty_status=0
scan "${TEST_TMPDIR}/gitleaks-empty.log" || empty_status=$?
if [ "$scanner_status" -ne 0 ] || [ "$empty_status" -ne 2 ] || \\
    ! grep -q 'scanned ~0 bytes ' "${TEST_TMPDIR}/gitleaks-empty.log"; then
    echo "Gitleaks empty-scan control failed." >&2
    exit 1
fi

cd "$controls/canary"
printf '%s%s\\n' 'cfat_' '0123456789012345678901234567890123456789' > source.txt
canary_status=0
scan "${TEST_TMPDIR}/gitleaks-canary.log" || canary_status=$?
if [ "$scanner_status" -ne 1 ] || [ "$canary_status" -ne 1 ] || \\
    ! positive_summary "${TEST_TMPDIR}/gitleaks-canary.log" || \\
    ! grep -q 'leaks found: 1$' "${TEST_TMPDIR}/gitleaks-canary.log"; then
    echo "Gitleaks synthetic-secret control failed." >&2
    exit 1
fi
echo "Gitleaks nonempty source, empty-scan refusal and synthetic-secret controls passed."
""".replace("@SOURCE_TREE@", ctx.file.source_tree.short_path).replace("@SCANNER@", scanner_path).replace("@CONFIG@", ctx.file.config.short_path),
        is_executable = True,
        output = launcher,
    )

    runfiles = ctx.runfiles(
        files = [
            ctx.file.source_tree,
            ctx.file.config,
            ctx.executable._gitleaks,
        ],
    )
    runfiles = runfiles.merge(ctx.attr._gitleaks[DefaultInfo].default_runfiles)

    return [DefaultInfo(
        executable = launcher,
        runfiles = runfiles,
    )]

gitleaks_test = rule(
    implementation = _gitleaks_test_impl,
    attrs = {
        "source_tree": attr.label(
            allow_single_file = True,
            mandatory = True,
        ),
        "config": attr.label(
            allow_single_file = True,
            mandatory = True,
        ),
        "_gitleaks": attr.label(
            cfg = "exec",
            default = Label("@multitool//tools/gitleaks"),
            executable = True,
        ),
    },
    test = True,
)

def _actionlint_test_impl(ctx):
    launcher = ctx.actions.declare_file(ctx.label.name + ".sh")
    actionlint_path = _external_runfiles_path(ctx.executable._actionlint)
    workflow_paths = [
        '"${source_root}/%s"' % source.short_path
        for source in ctx.files.srcs
    ]

    ctx.actions.write(
        content = "\n".join([
            "#!/bin/sh",
            "set -eu",
            'readonly source_root="${TEST_SRCDIR:?}/${TEST_WORKSPACE:?}"',
            'readonly actionlint="${TEST_SRCDIR:?}/' + actionlint_path + '"',
            'exec "${actionlint}" -config-file "${source_root}/' +
            ctx.file.config.short_path +
            '" ' +
            " ".join(workflow_paths),
            "",
        ]),
        is_executable = True,
        output = launcher,
    )

    runfiles = ctx.runfiles(
        files = ctx.files.srcs + [
            ctx.file.config,
            ctx.executable._actionlint,
        ],
    )
    runfiles = runfiles.merge(ctx.attr._actionlint[DefaultInfo].default_runfiles)

    return [DefaultInfo(
        executable = launcher,
        runfiles = runfiles,
    )]

actionlint_test = rule(
    implementation = _actionlint_test_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = True,
            mandatory = True,
        ),
        "config": attr.label(
            allow_single_file = True,
            mandatory = True,
        ),
        "_actionlint": attr.label(
            cfg = "exec",
            default = Label("@multitool//tools/actionlint"),
            executable = True,
        ),
    },
    test = True,
)
