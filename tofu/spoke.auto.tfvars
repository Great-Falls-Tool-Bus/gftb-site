# Spoke-specific inputs. Rewritten by scripts/rebrand.sh on template
# instantiation. Contract: docs/CI-SCHEMA.md §8.

spoke_slug = "site-scaffold"
github_org = "tinyland-inc"

# Subset of the master runner-class enum the spoke may dispatch to. See
# docs/CI-SCHEMA.md §5 for the full list. Hard-deny enforcement.
allowed_runner_classes = ["tinyland-nix"]

# Aggregate cache quota in GiB (Attic + Bazel combined). Default 50.
cache_quota_gib = 50
