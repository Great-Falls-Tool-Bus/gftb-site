"""Rules for the qualified GFTB application layer."""


def _source_marker_impl(ctx):
    # Only this small projection reads Bazel status. Vite and the application
    # layer consume its deterministic bytes, not host/time-bearing status files.
    marker = ctx.actions.declare_file("health.sha")
    ctx.actions.run_shell(
        arguments = [ctx.info_file.path, marker.path],
        command = """
set -eu
source_sha=
source_sha_seen=0
while IFS=' ' read -r key value remainder; do
  if [ "$key" = BUILD_EMBED_LABEL ]; then
    if [ "$source_sha_seen" -ne 0 ] || [ -n "$remainder" ]; then
      echo "BUILD_EMBED_LABEL must occur exactly once with one value" >&2
      exit 1
    fi
    source_sha="$value"
    source_sha_seen=1
  fi
done < "$1"
if [ "$source_sha_seen" -ne 1 ] || [ "${#source_sha}" -ne 40 ]; then
  echo "BUILD_EMBED_LABEL must be exactly 40 lowercase hex characters" >&2
  exit 1
fi
case "$source_sha" in
  *[!0-9a-f]*)
    echo "BUILD_EMBED_LABEL must be exactly 40 lowercase hex characters" >&2
    exit 1
    ;;
esac
printf '%s' "$source_sha" > "$2"
""",
        inputs = [ctx.info_file],
        mnemonic = "GftbSourceMarker",
        outputs = [marker],
        progress_message = "Writing exact GFTB source marker",
    )
    return DefaultInfo(files = depset([marker]))


source_marker = rule(
    implementation = _source_marker_impl,
    doc = "Writes the exact qualified source SHA from Bazel's native BUILD_EMBED_LABEL.",
)
