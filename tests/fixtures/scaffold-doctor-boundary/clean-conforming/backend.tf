# Fixture: the conforming shape — generic S3, endpoint-free, credential-free.
# Mirrors the checked-in tofu/backend.tf posture.

terraform {
  backend "s3" {
    bucket = "tofu-state"
    key    = "spokes/fixture-spoke/terraform.tfstate"
    region = "us-east-1" # provider-required; the substrate ignores it

    # endpoint + credentials: env/operator authority.

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
  }
}
