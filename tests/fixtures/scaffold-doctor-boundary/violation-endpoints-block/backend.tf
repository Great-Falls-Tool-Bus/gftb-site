# Fixture: modern endpoints-block wiring (the shape current AWS providers
# use). Must fail the same as the legacy single-endpoint form.

terraform {
  backend "s3" {
    bucket = "tofu-state"
    key    = "spokes/fixture-spoke/terraform.tfstate"
    region = "us-east-1"

    endpoints = {
      s3 = "http://minio.tofu-state.svc:9000"
    }
  }
}
