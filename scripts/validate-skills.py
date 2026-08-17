#!/usr/bin/env python3
"""Validate every .agents/skills/<name>/SKILL.md against the Anthropic SKILL.md
contract: frontmatter present, required fields (name, description), name matches
directory, description length cap (1536 chars combined with when_to_use), body
under 500 lines, and no pre-authorized Linear write tool in allowed-tools
(TIN-3447).

Usage: validate-skills.py [REPO_ROOT]   (default: cwd)
Exit 0 if all skills pass, 1 otherwise. Used by `just skills-validate` and CI.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DESCRIPTION_CAP = 1536
BODY_LINE_CAP = 500

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)

# --- Linear-write guard (TIN-3447) -------------------------------------------
# A skill that pre-authorizes a Linear mutation lets an agent silently flip an
# issue status with no human in the loop. Linear writes are never allowed-tools;
# they go through an explicit operator confirmation instead.
LINEAR_WRITE_RE = re.compile(
    r"mcp__linear__(?:save|create|delete|merge|submit|resolve|prepare)_\w+"
)
# Bare server / glob grants every Linear tool, writes included.
LINEAR_WILDCARD = {"mcp__linear", "mcp__linear*", "mcp__linear__*"}


def linear_write_violations(raw: str) -> list[str]:
    """Return the offending tool patterns found in an allowed-tools value."""
    bad = set(LINEAR_WRITE_RE.findall(raw))
    for chunk in re.split(r"[\n,]", raw.strip().strip("[]")):
        entry = chunk.strip().lstrip("-").strip().strip("'\"")
        if entry in LINEAR_WILDCARD:
            bad.add(entry)
    return sorted(bad)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    raw, body = m.group(1), m.group(2)
    fields: dict[str, str] = {}
    key, buf = None, []
    for line in raw.splitlines():
        if re.match(r"^[a-z][a-z0-9_-]*:", line):
            if key is not None:
                fields[key] = "\n".join(buf).strip()
            key, _, rest = line.partition(":")
            buf = [rest.strip()]
        elif key is not None and (line.startswith("  ") or line.startswith("\t") or line.startswith("- ") or line.startswith("|")):
            buf.append(line.strip())
        elif key is not None:
            buf.append(line.strip())
    if key is not None:
        fields[key] = "\n".join(buf).strip()
    return fields, body


def validate(skill_dir: Path) -> list[str]:
    """Return list of error strings; empty list means pass."""
    errors: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return [f"{skill_dir.name}: missing SKILL.md"]
    text = skill_md.read_text()
    parsed = parse_frontmatter(text)
    if parsed is None:
        return [f"{skill_dir.name}: SKILL.md missing YAML frontmatter (--- delimited)"]
    fields, body = parsed

    if "name" not in fields:
        errors.append(f"{skill_dir.name}: frontmatter missing 'name'")
    elif fields["name"] != skill_dir.name:
        errors.append(
            f"{skill_dir.name}: frontmatter name='{fields['name']}' != directory '{skill_dir.name}'"
        )

    if "description" not in fields:
        errors.append(f"{skill_dir.name}: frontmatter missing 'description'")
    else:
        combined = fields["description"]
        if "when_to_use" in fields:
            combined += "\n" + fields["when_to_use"]
        if len(combined) > DESCRIPTION_CAP:
            errors.append(
                f"{skill_dir.name}: description+when_to_use is {len(combined)} chars (>{DESCRIPTION_CAP})"
            )

    raw_tools = fields.get("allowed-tools", "") + "\n" + fields.get("allowed_tools", "")
    for bad in linear_write_violations(raw_tools):
        errors.append(
            f"{skill_dir.name}: allowed-tools pre-authorizes Linear write tool "
            f"'{bad}'; Linear mutations require an explicit human step (TIN-3447)"
        )

    body_lines = body.count("\n")
    if body_lines > BODY_LINE_CAP:
        errors.append(
            f"{skill_dir.name}: SKILL.md body is {body_lines} lines (>{BODY_LINE_CAP}); move detail to reference.md"
        )

    return errors


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve() if len(argv) > 1 else Path(".").resolve()
    skills_dir = root / ".agents" / "skills"
    if not skills_dir.is_dir():
        print(f"[skills-validate] no {skills_dir} directory found", file=sys.stderr)
        return 1

    failures: list[str] = []
    pass_count = 0
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        errors = validate(skill_dir)
        if errors:
            failures.extend(errors)
        else:
            pass_count += 1
            print(f"PASS {skill_dir.name}")

    if failures:
        print("\nFAILURES:", file=sys.stderr)
        for e in failures:
            print(f"  - {e}", file=sys.stderr)
        print(
            f"\nSUMMARY: {pass_count} passed, {len(failures)} failures",
            file=sys.stderr,
        )
        return 1

    print(f"\nSUMMARY: {pass_count} skill(s) passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
