# Fixture: every HCL comment form carrying endpoint/credential wiring that is
# INERT. A comment-aware scan must pass this file; the regex-naive scan this
# checker replaced flagged the `//` and `/* */` forms (false positive) while
# HCL treats all three as comments.

terraform {
  backend "s3" {
    bucket = "tofu-state"
    key    = "spokes/fixture-spoke/terraform.tfstate"
    region = "us-east-1"

    # endpoint = "http://tofu-state-rustfs.tofu-state.svc:9000"
    // endpoint = "http://tofu-pr-state-rustfs.tofu-state.svc:9000"
    /*
    endpoints = {
      s3 = "http://attic-rustfs-hl.nix-cache.svc:9000"
    }
    access_key = "fixture-inert-not-a-credential"
    secret_key = "fixture-inert-not-a-credential"
    */

    # A string containing a comment character is not a comment terminator:
    bucket_prefix_note = "anchor#value//still-a-string"

    skip_credentials_validation = true
    use_path_style              = true
  }
}
