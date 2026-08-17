# OpenTofu state backend.
#
# State lives in an operator-provisioned S3-compatible bucket. In Tinyland today
# that storage plane is RustFS ONLY — never Garage, never MinIO. Provider
# receipts and runtime placement remain infrastructure-owner evidence, not a
# source-level receiver binding in this scaffold.
#
# House rule (AGENTS.md / docs/CI-SCHEMA.md §8): spokes MUST NOT hard-code the
# provider endpoint. The S3 endpoint + credentials are env/operator authority,
# supplied at init via AWS_* env (e.g.
# AWS_ENDPOINT_URL_S3=http://attic-rustfs-hl.nix-cache.svc:9000) or
# `tofu init -backend-config=...`. See tofu/README.md.

terraform {
  backend "s3" {
    bucket = "tofu-state"
    key    = "spokes/site-scaffold/terraform.tfstate"
    region = "us-east-1" # provider-required; RustFS ignores

    # endpoint + credentials: env/operator authority (see header + tofu/README.md).

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}
