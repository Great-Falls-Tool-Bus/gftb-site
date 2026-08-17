# Fixture: hard-coded state credentials. Values are deliberately non-secret
# placeholders — the law fires on the KEY, not the value.

terraform {
  backend "s3" {
    bucket     = "tofu-state"
    key        = "spokes/fixture-spoke/terraform.tfstate"
    region     = "us-east-1"
    access_key = "fixture-not-a-real-credential"
    secret_key = "fixture-not-a-real-credential"
  }
}
