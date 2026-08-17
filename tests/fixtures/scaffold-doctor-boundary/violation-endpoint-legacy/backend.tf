# Fixture: legacy single-endpoint wiring. Live `endpoint =` must fail no
# matter which provider the value names — provider selection is not the law,
# endpoint-freedom is.

terraform {
  backend "s3" {
    bucket   = "tofu-state"
    key      = "spokes/fixture-spoke/terraform.tfstate"
    region   = "us-east-1"
    endpoint = "http://tofu-pr-state-rustfs.tofu-state.svc:9000"
  }
}
