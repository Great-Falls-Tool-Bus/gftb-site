# Fixture: live wiring with a trailing comment on the same line. The comment
# does not neutralize the assignment — this is the evasion shape a naive
# "line contains a comment marker, skip it" parser false-passes.

terraform {
  backend "s3" {
    bucket   = "tofu-state"
    key      = "spokes/fixture-spoke/terraform.tfstate"
    region   = "us-east-1"
    endpoint = "http://garage.tofu-state.svc:3900" # TODO: move to env
  }
}
