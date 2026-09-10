{
  description = "Great Falls Tool Bus public static microsite";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nix2container.url = "github:nlewo/nix2container";
    nix2container.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      nix2container,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        corePackages = with pkgs; [
          nodejs_22
          pnpm
          typescript
          typescript-language-server
          just
          git
          gh
          gitleaks
          syft
          python3
          python3Packages.jsonschema
          jq
          qrencode
          actionlint
          nixfmt
        ];
        shellHook = extra: ''
          corepack enable >/dev/null 2>&1 || true
          ${extra}
          echo "gftb-site dev shell"
          echo "  node     $(node --version)"
          echo "  pnpm     $(pnpm --version 2>/dev/null || echo unavailable)"
          echo "  just     $(just --version)"
          echo "  gitleaks $(gitleaks version 2>&1 | head -n1)"
        '';
        n2c = nix2container.packages.${system}.nix2container;
        imageName = "ghcr.io/great-falls-tool-bus/gftb-site";
        runtimeRoot = pkgs.buildEnv {
          name = "gftb-static-image-root";
          paths = [
            pkgs.caddy
            pkgs.dumb-init
            pkgs.cacert
          ];
          pathsToLink = [
            "/bin"
            "/etc"
            "/share"
            "/lib"
          ];
        };
        runtimeConfig = {
          Entrypoint = [
            "/bin/dumb-init"
            "--"
          ];
          Cmd = [
            "/bin/caddy"
            "run"
            "--config"
            "/etc/caddy/Caddyfile"
            "--adapter"
            "caddyfile"
          ];
          User = "65532:65532";
          WorkingDir = "/srv";
          ExposedPorts = {
            "3000/tcp" = { };
          };
          Env = [
            "HOME=/tmp"
            "XDG_CONFIG_HOME=/tmp"
            "XDG_DATA_HOME=/tmp"
            "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
          ];
          Labels = {
            "org.opencontainers.image.source" = "https://github.com/Great-Falls-Tool-Bus/gftb-site";
            "org.opencontainers.image.description" = "Great Falls Tool Bus static runtime";
          };
        };
        # The GF-I09 publisher composes this source-independent runtime base
        # with the qualified application layer exported by the action fabric.
        runtimeBaseImage = n2c.buildImage {
          name = imageName;
          copyToRoot = runtimeRoot;
          config = runtimeConfig;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = corePackages;
          shellHook = shellHook "";
        };
        packages."runtime-base-image" = runtimeBaseImage;
        packages."runtime-root" = runtimeRoot;
        formatter = pkgs.nixfmt;
      }
    );
}
