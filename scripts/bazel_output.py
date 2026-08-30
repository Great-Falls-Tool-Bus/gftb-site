#!/usr/bin/env python3
"""Materialize and preview Bazel-produced SvelteKit output trees."""

from __future__ import annotations

import argparse
import ctypes
import errno
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
MATERIALIZED_OUTPUT_NAMES = frozenset({"build", "coverage", ".svelte-kit", ".bundle-stats"})


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


def _directory_open_flags() -> int:
    directory_flag = getattr(os, "O_DIRECTORY", None)
    nofollow_flag = getattr(os, "O_NOFOLLOW", None)
    if directory_flag is None or nofollow_flag is None:
        raise OutputError("descriptor-custodied materialization requires O_DIRECTORY and O_NOFOLLOW")
    return os.O_RDONLY | directory_flag | nofollow_flag | getattr(os, "O_CLOEXEC", 0)


def _inode_identity(metadata: os.stat_result) -> tuple[int, int, int]:
    return (metadata.st_dev, metadata.st_ino, stat.S_IFMT(metadata.st_mode))


def _assert_inode_identity(
    metadata: os.stat_result,
    expected_identity: tuple[int, int, int],
    label: str,
) -> None:
    if _inode_identity(metadata) != expected_identity:
        raise OutputError(f"identity changed for {label}; transaction was left untouched")


def _linux_mount_id(file_descriptor: int) -> int:
    try:
        with open(f"/proc/self/fdinfo/{file_descriptor}", encoding="ascii") as descriptor_info:
            for line in descriptor_info:
                key, separator, value = line.partition(":")
                if separator and key == "mnt_id":
                    return int(value.strip())
    except (OSError, ValueError) as error:
        raise OutputError(f"cannot establish Linux mount identity for fd {file_descriptor}: {error}") from error
    raise OutputError(f"Linux fdinfo for fd {file_descriptor} has no mnt_id")


def _mount_identity(file_descriptor: int, metadata: os.stat_result) -> tuple[int, int | None]:
    mount_id = _linux_mount_id(file_descriptor) if sys.platform.startswith("linux") else None
    return (metadata.st_dev, mount_id)


def _assert_same_mount(
    expected_mount: tuple[int, int | None],
    candidate_mount: tuple[int, int | None],
    label: str,
) -> None:
    if candidate_mount != expected_mount:
        raise OutputError(f"refusing materialization across a mount boundary at {label}")


def _entry_exists_at(parent_fd: int, name: str) -> bool:
    try:
        os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    return True


def _open_custodied_directory(
    parent_fd: int,
    name: str,
    expected_metadata: os.stat_result,
) -> int:
    try:
        directory_fd = os.open(name, _directory_open_flags(), dir_fd=parent_fd)
    except OSError as error:
        raise OutputError(f"cannot open materialization directory {name} without following links: {error}") from error
    try:
        held_metadata = os.fstat(directory_fd)
        _assert_inode_identity(held_metadata, _inode_identity(expected_metadata), name)
        if not stat.S_ISDIR(held_metadata.st_mode):
            raise OutputError(f"materialization entry is not a held directory: {name}")
        return directory_fd
    except BaseException:
        os.close(directory_fd)
        raise


def _assert_named_transaction_custody(
    parent_fd: int,
    transaction_name: str,
    transaction_fd: int,
    expected_prefix: str,
    expected_identity: tuple[int, int, int],
    expected_mount: tuple[int, int | None],
) -> None:
    if (
        not transaction_name
        or transaction_name in {".", ".."}
        or "/" in transaction_name
        or not transaction_name.startswith(expected_prefix)
        or len(transaction_name) <= len(expected_prefix)
    ):
        raise OutputError(f"invalid owned transaction name: {transaction_name!r}")
    try:
        named_metadata = os.stat(transaction_name, dir_fd=parent_fd, follow_symlinks=False)
        held_metadata = os.fstat(transaction_fd)
    except OSError as error:
        raise OutputError(f"cannot revalidate owned transaction {transaction_name}: {error}") from error
    if not stat.S_ISDIR(named_metadata.st_mode) or not stat.S_ISDIR(held_metadata.st_mode):
        raise OutputError(f"owned transaction path was replaced: {transaction_name}")
    if _inode_identity(named_metadata) != expected_identity or _inode_identity(held_metadata) != expected_identity:
        raise OutputError(f"owned transaction path was replaced: {transaction_name}")
    _assert_same_mount(expected_mount, _mount_identity(transaction_fd, held_metadata), transaction_name)


def _rename_directory_noreplace(
    source_fd: int,
    source_name: str,
    destination_fd: int,
    destination_name: str,
) -> None:
    """Atomically publish one held directory without replacing any destination."""

    if not sys.platform.startswith("linux"):
        raise OutputError("atomic no-replace materialization requires Linux renameat2")
    try:
        renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
    except (AttributeError, OSError) as error:
        raise OutputError(f"atomic no-replace materialization is unavailable: {error}") from error

    renameat2.argtypes = (
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    )
    renameat2.restype = ctypes.c_int
    rename_noreplace = 1
    if (
        renameat2(
            source_fd,
            os.fsencode(source_name),
            destination_fd,
            os.fsencode(destination_name),
            rename_noreplace,
        )
        == 0
    ):
        return

    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
        raise OutputError(
            f"destination appeared before publish and was left untouched: {destination_name}; "
            "transaction was retained"
        )
    raise OutputError(
        f"atomic no-replace materialization failed; transaction was retained: {os.strerror(error_number)}"
    )


def _assert_required_file_at(directory_fd: int, required_path: Path) -> None:
    try:
        metadata = os.stat(os.fspath(required_path), dir_fd=directory_fd, follow_symlinks=False)
    except OSError as error:
        raise OutputError(f"staged output is missing required file {required_path}: {error}") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise OutputError(f"staged output is missing required file {required_path}")


def materialize_tree(source: Path, destination: Path, required_path: Path, manifest_path: Path) -> None:
    """Publish into an absent allowlisted destination; never clean or replace output."""

    destination = resolve_materialize_destination(manifest_path, destination)
    if _path_exists(destination):
        raise OutputError(
            f"destination already exists and was left untouched: {destination}; "
            "materialization only publishes fresh output"
        )

    source = source.resolve(strict=True)
    required_path = Path(required_path)
    if not source.is_dir():
        raise OutputError(f"Bazel output is not a directory: {source}")
    if required_path.is_absolute() or not required_path.parts or ".." in required_path.parts:
        raise OutputError(f"required path must stay within the output tree: {required_path}")
    if not (source / required_path).is_file():
        raise OutputError(f"Bazel output {source} is missing required file {required_path}")

    destination_parent = destination.parent
    _assert_no_materialization_residue(destination)
    destination_resolved = destination.resolve(strict=False)
    if destination_resolved == source or destination_resolved.is_relative_to(source):
        raise OutputError("destination must not be the Bazel output or one of its children")

    parent_fd = os.open(destination_parent, _directory_open_flags())
    transaction_fd: int | None = None
    try:
        if _entry_exists_at(parent_fd, destination.name):
            raise OutputError(f"destination appeared before transaction creation and was left untouched: {destination}")

        parent_metadata = os.fstat(parent_fd)
        parent_mount = _mount_identity(parent_fd, parent_metadata)
        transaction_prefix = f".{destination.name}.transaction-"
        transaction = Path(tempfile.mkdtemp(prefix=transaction_prefix, dir=destination_parent))
        transaction_name = transaction.name
        try:
            transaction_fd = os.open(transaction_name, _directory_open_flags(), dir_fd=parent_fd)
        except OSError as error:
            raise OutputError(
                f"cannot take custody of new transaction {transaction_name}; it was retained: {error}"
            ) from error

        transaction_metadata = os.fstat(transaction_fd)
        if stat.S_IMODE(transaction_metadata.st_mode) & 0o077:
            raise OutputError(f"new transaction is not private and was retained: {transaction_name}")
        transaction_identity = _inode_identity(transaction_metadata)
        transaction_mount = _mount_identity(transaction_fd, transaction_metadata)
        _assert_same_mount(parent_mount, transaction_mount, transaction_name)
        _assert_named_transaction_custody(
            parent_fd,
            transaction_name,
            transaction_fd,
            transaction_prefix,
            transaction_identity,
            transaction_mount,
        )

        stage = transaction / "stage"
        shutil.copytree(source, stage, symlinks=False)
        _assert_named_transaction_custody(
            parent_fd,
            transaction_name,
            transaction_fd,
            transaction_prefix,
            transaction_identity,
            transaction_mount,
        )

        try:
            named_stage_metadata = os.stat("stage", dir_fd=transaction_fd, follow_symlinks=False)
        except OSError as error:
            raise OutputError(f"cannot inspect staged output without following links: {error}") from error
        if not stat.S_ISDIR(named_stage_metadata.st_mode):
            raise OutputError("staged output is not a directory; transaction was retained")

        stage_fd = _open_custodied_directory(transaction_fd, "stage", named_stage_metadata)
        try:
            held_stage_metadata = os.fstat(stage_fd)
            stage_identity = _inode_identity(held_stage_metadata)
            stage_mount = _mount_identity(stage_fd, held_stage_metadata)
            _assert_same_mount(transaction_mount, stage_mount, "stage")
            _assert_required_file_at(stage_fd, required_path)

            _assert_named_transaction_custody(
                parent_fd,
                transaction_name,
                transaction_fd,
                transaction_prefix,
                transaction_identity,
                transaction_mount,
            )
            named_stage_metadata = os.stat("stage", dir_fd=transaction_fd, follow_symlinks=False)
            _assert_inode_identity(named_stage_metadata, stage_identity, "stage")
            held_stage_metadata = os.fstat(stage_fd)
            _assert_inode_identity(held_stage_metadata, stage_identity, "stage")
            _assert_same_mount(transaction_mount, _mount_identity(stage_fd, held_stage_metadata), "stage")
            if _entry_exists_at(parent_fd, destination.name):
                raise OutputError(
                    f"destination appeared before publish and was left untouched: {destination}; "
                    "transaction was retained"
                )

            _rename_directory_noreplace(
                transaction_fd,
                "stage",
                parent_fd,
                destination.name,
            )
        finally:
            os.close(stage_fd)

        _assert_named_transaction_custody(
            parent_fd,
            transaction_name,
            transaction_fd,
            transaction_prefix,
            transaction_identity,
            transaction_mount,
        )
        try:
            remaining_entries = os.listdir(transaction_fd)
        except OSError as error:
            raise OutputError(
                f"cannot prove published transaction is empty; {transaction_name} was retained: {error}"
            ) from error
        if remaining_entries:
            raise OutputError(
                f"published transaction has unexpected residue and was retained: {transaction_name}"
            )
        _assert_named_transaction_custody(
            parent_fd,
            transaction_name,
            transaction_fd,
            transaction_prefix,
            transaction_identity,
            transaction_mount,
        )
        os.rmdir(transaction_name, dir_fd=parent_fd)
    finally:
        if transaction_fd is not None:
            os.close(transaction_fd)
        os.close(parent_fd)


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

    materialize = subparsers.add_parser("materialize", help="publish a fresh output tree without replacing or cleaning")
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
