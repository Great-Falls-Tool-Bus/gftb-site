#!/usr/bin/env python3
"""Validate tinyland.repo.json against its checked-in repository schema."""
from __future__ import annotations

import json
import sys
from pathlib import Path


SCHEMA = Path("docs/schemas/tinyland-repo-manifest.schema.json")
INSTANCE = Path("tinyland.repo.json")


def main() -> int:
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        print("error: `jsonschema` not installed. Run inside `nix develop`.", file=sys.stderr)
        return 2

    if not SCHEMA.exists() or not INSTANCE.exists():
        print("error: repository manifest or schema is missing", file=sys.stderr)
        return 2

    schema = json.loads(SCHEMA.read_text())
    instance = json.loads(INSTANCE.read_text())
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(instance),
        key=lambda error: list(error.absolute_path),
    )
    if not errors:
        print(f"{INSTANCE}: valid against {SCHEMA}")
        return 0

    for error in errors:
        path = "/" + "/".join(str(part) for part in error.absolute_path)
        print(f"  at {path or '/'}: {error.message}", file=sys.stderr)
    print(f"{INSTANCE}: {len(errors)} validation error(s)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
