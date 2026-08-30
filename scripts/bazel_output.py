#!/usr/bin/env python3
"""Materialize and preview Bazel-produced SvelteKit output trees."""

from __future__ import annotations

import argparse
import functools
import json
import os
import shlex
import shutil
import stat
import sys
import tempfile
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


STATIC_ROLES = {"static-spoke", "static-spoke-scaffold"}
MATERIALIZED_OUTPUT_NAMES = frozenset({"build", "coverage", "build-stamped", ".svelte-kit", ".bundle-stats"})


class OutputError(RuntimeError):
    """Raised when an output tree does not satisfy the spoke contract."""


@dataclass(frozen=True)
class AdapterContract:
    name: str
    required_entrypoint: Path


def adapter_contract(manifest_path: Path) -> AdapterContract:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        taxonomy = manifest["taxonomy"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise OutputError(f"cannot read adapter role from {manifest_path}: {error}") from error

    role = taxonomy.get("spawned_repo_role") or taxonomy.get("primary_role")
    if role in STATIC_ROLES:
        return AdapterContract("adapter-static", Path("index.html"))
    raise OutputError(f"unsupported taxonomy role in {manifest_path}: {role!r}")


def _path_exists(path: Path) -> bool:
    return os.path.lexists(path)


def resolve_materialize_destination(manifest_path: Path, destination: Path) -> Path:
    """Return one allowlisted direct child of the manifest root, or fail before mutation."""

    if destination.is_absolute():
        raise OutputError(f"destination must be a lexical direct child of the manifest root: {destination}")
    if len(destination.parts) != 1 or destination.name not in MATERIALIZED_OUTPUT_NAMES:
        raise OutputError(
            f"destination must be one exact generated-output name: {', '.join(sorted(MATERIALIZED_OUTPUT_NAMES))}"
        )

    manifest = manifest_path.resolve(strict=True)
    root = manifest.parent
    candidate = root / destination.name
    resolved = candidate.resolve(strict=False)
    if candidate == root or resolved.parent != root or resolved.name != destination.name:
        raise OutputError(f"destination resolves outside the manifest root: {destination}")
    if candidate.is_symlink():
        raise OutputError(f"destination must not be a symlink: {destination}")
    return candidate


def _make_owner_writable(root: Path) -> None:
    for current, directories, files in os.walk(root):
        current_path = Path(current)
        current_path.chmod(current_path.stat().st_mode | stat.S_IWUSR | stat.S_IXUSR)
        for name in directories:
            path = current_path / name
            if not path.is_symlink():
                path.chmod(path.stat().st_mode | stat.S_IWUSR | stat.S_IXUSR)
        for name in files:
            path = current_path / name
            if not path.is_symlink():
                path.chmod(path.stat().st_mode | stat.S_IWUSR)


def _materialization_residue_prefixes(destination: Path) -> tuple[str, str, str]:
    return (
        f".{destination.name}.previous-",
        f".{destination.name}.materialize-",
        f".{destination.name}.transaction-",
    )


def _assert_no_materialization_residue(destination: Path) -> None:
    prefixes = _materialization_residue_prefixes(destination)
    try:
        residues = sorted(
            child.name
            for child in destination.parent.iterdir()
            if any(child.name.startswith(prefix) for prefix in prefixes)
        )
    except OSError as error:
        raise OutputError(f"cannot inspect materialization residue beside {destination}: {error}") from error
    if residues:
        raise OutputError(
            "pre-existing materialization residue must be inspected manually and was left untouched: "
            + ", ".join(residues)
        )


def _remove_owned_transaction(
    transaction: Path,
    destination_parent: Path,
    expected_prefix: str,
    expected_identity: tuple[int, int],
) -> None:
    if not _path_exists(transaction):
        return
    if (
        not transaction.name
        or transaction == Path(transaction.anchor)
        or transaction.parent != destination_parent
        or not transaction.name.startswith(expected_prefix)
        or len(transaction.name) <= len(expected_prefix)
    ):
        raise OutputError(f"refusing to remove an invalid materialization transaction path: {transaction}")
    try:
        metadata = transaction.lstat()
    except OSError as error:
        raise OutputError(f"cannot inspect materialization transaction {transaction}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise OutputError(f"refusing to remove a non-directory materialization transaction: {transaction}")
    if (metadata.st_dev, metadata.st_ino) != expected_identity:
        raise OutputError(f"refusing to remove a replaced materialization transaction: {transaction}")
    try:
        shutil.rmtree(transaction)
    except OSError as error:
        raise OutputError(f"cannot remove owned materialization transaction {transaction}: {error}") from error


def materialize_tree(source: Path, destination: Path, required_path: Path, manifest_path: Path) -> None:
    destination = resolve_materialize_destination(manifest_path, destination)
    source = source.resolve(strict=True)
    required_path = Path(required_path)

    if not source.is_dir():
        raise OutputError(f"Bazel output is not a directory: {source}")
    if required_path.is_absolute() or ".." in required_path.parts:
        raise OutputError(f"required path must stay within the output tree: {required_path}")
    if not (source / required_path).is_file():
        raise OutputError(f"Bazel output {source} is missing required file {required_path}")

    destination_parent = destination.parent
    _assert_no_materialization_residue(destination)
    destination_resolved = destination.resolve(strict=False)
    if destination_resolved == source or destination_resolved.is_relative_to(source):
        raise OutputError("destination must not be the Bazel output or one of its children")

    transaction_prefix = f".{destination.name}.transaction-"
    transaction = Path(tempfile.mkdtemp(prefix=transaction_prefix, dir=destination_parent))
    transaction_metadata = transaction.lstat()
    transaction_identity = (transaction_metadata.st_dev, transaction_metadata.st_ino)
    stage = transaction / "stage"
    previous = transaction / "previous"
    moved_destination = False
    cleanup_transaction = True

    try:
        shutil.copytree(source, stage, symlinks=False)
        _make_owner_writable(stage)
        if not (stage / required_path).is_file():
            raise OutputError(f"staged output is missing required file {required_path}")

        if _path_exists(destination):
            os.replace(destination, previous)
            moved_destination = True
        os.replace(stage, destination)
    except BaseException:
        if moved_destination:
            try:
                if _path_exists(destination):
                    raise OutputError(f"cannot roll back {destination}: destination path reappeared")
                if not _path_exists(previous):
                    raise OutputError(f"cannot roll back {destination}: previous output is missing")
                os.replace(previous, destination)
                moved_destination = False
            except BaseException as rollback_error:
                cleanup_transaction = False
                raise OutputError(
                    f"materialization rollback failed; owned transaction {transaction.name} was left untouched"
                ) from rollback_error
        raise
    finally:
        if cleanup_transaction:
            _remove_owned_transaction(
                transaction,
                destination_parent,
                transaction_prefix,
                transaction_identity,
            )

def _normalize_base_path(value: str) -> str:
    if not value or value == "/":
        return ""
    parts = [part for part in value.split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        raise OutputError(f"invalid BASE_PATH: {value!r}")
    return "/" + "/".join(parts)


def _strip_static_base_path(path: str, base_path: str) -> str | None:
    parsed = urlsplit(path)
    if not base_path:
        stripped = parsed.path
    elif parsed.path == base_path:
        stripped = "/"
    elif parsed.path.startswith(f"{base_path}/"):
        stripped = parsed.path[len(base_path) :]
    else:
        return None
    return urlunsplit(("", "", stripped, parsed.query, parsed.fragment))


class _StaticPreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, base_path: str, **kwargs: object) -> None:
        self.base_path = base_path
        super().__init__(*args, **kwargs)

    def _fallback_document(self) -> bytes | None:
        """The adapter-static SPA fallback, if this build carries one."""
        fallback = Path(self.directory) / "404.html"
        try:
            return fallback.read_bytes()
        except OSError:
            return None

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        """Answer a miss with build/404.html, the way the served plane does.

        TIN-3932: the promoted site answered every unknown path with a zero-byte
        body because nothing was wired to serve the fallback adapter-static
        already produces. The Caddyfile in flake.nix now serves it; this handler
        does the same so the preview -- which is what Playwright and a local
        `curl` measure -- models the serving plane rather than Python's stock
        error page. The status is preserved: only the body changes.
        """
        document = self._fallback_document() if code == HTTPStatus.NOT_FOUND else None
        if document is None:
            super().send_error(code, message, explain)
            return
        self.log_error("code %d, message %s", code, message or "Not Found")
        self.send_response(code, message)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(document)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(document)

    def _serve(self, method: str) -> None:
        rewritten = _strip_static_base_path(self.path, self.base_path)
        if rewritten is None:
            self.send_error(404)
            return
        original = self.path
        self.path = rewritten
        try:
            getattr(super(), method)()
        finally:
            self.path = original

    def do_GET(self) -> None:
        self._serve("do_GET")

    def do_HEAD(self) -> None:
        self._serve("do_HEAD")


def serve_static(build_dir: Path, host: str, port: int, base_path: str) -> None:
    base_path = _normalize_base_path(base_path)
    handler = functools.partial(
        _StaticPreviewHandler,
        directory=str(build_dir.resolve(strict=True)),
        base_path=base_path,
    )
    with ThreadingHTTPServer((host, port), handler) as server:
        prefix = base_path or "/"
        print(f"serving {build_dir} at http://{host}:{port}{prefix}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def preview_command(
    build_dir: Path,
    contract: AdapterContract,
    host: str,
    port: int,
    base_path: str = "",
) -> tuple[list[str], dict[str, str]]:
    entrypoint = build_dir / contract.required_entrypoint
    if not entrypoint.is_file():
        raise OutputError(f"{contract.name} preview requires {entrypoint}")

    environment = os.environ.copy()
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "serve-static",
        "--build-dir",
        str(build_dir),
        "--host",
        host,
        "--port",
        str(port),
    ]
    normalized_base_path = _normalize_base_path(base_path)
    if normalized_base_path:
        command.extend(["--base-path", normalized_base_path])
    return command, environment


def _parse_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("port must be an integer") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    materialize = subparsers.add_parser("materialize", help="transactionally replace an output tree")
    materialize.add_argument("--source", type=Path, required=True)
    materialize.add_argument("--destination", type=Path, required=True)
    materialize.add_argument("--manifest", type=Path, default=Path("tinyland.repo.json"))
    materialize.add_argument("--required-path", type=Path)

    preview = subparsers.add_parser("preview", help="serve a materialized output tree")
    preview.add_argument("--build-dir", type=Path, default=Path("build"))
    preview.add_argument("--manifest", type=Path, default=Path("tinyland.repo.json"))
    preview.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    preview.add_argument("--port", type=_parse_port, default=_parse_port(os.environ.get("PORT", "4173")))
    preview.add_argument("--base-path", default=os.environ.get("BASE_PATH", ""))
    preview.add_argument("--print-command", action="store_true")

    static_server = subparsers.add_parser("serve-static", help="serve static output with BASE_PATH routing")
    static_server.add_argument("--build-dir", type=Path, required=True)
    static_server.add_argument("--host", required=True)
    static_server.add_argument("--port", type=_parse_port, required=True)
    static_server.add_argument("--base-path", default="")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "materialize":
            contract = adapter_contract(args.manifest)
            required_path = args.required_path or contract.required_entrypoint
            materialize_tree(args.source, args.destination, required_path, args.manifest)
            print(f"materialized {args.source} -> {args.destination} ({required_path})")
            return 0

        if args.command == "serve-static":
            serve_static(args.build_dir, args.host, args.port, args.base_path)
            return 0

        contract = adapter_contract(args.manifest)
        command, environment = preview_command(
            args.build_dir,
            contract,
            args.host,
            args.port,
            args.base_path,
        )
        if args.print_command:
            print(shlex.join(command))
            return 0
        os.execvpe(command[0], command, environment)
    except (OSError, OutputError) as error:
        print(f"bazel-output: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
