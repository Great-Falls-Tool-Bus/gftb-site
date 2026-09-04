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
          bazelisk
          gitleaks
          syft
          python3
          python3Packages.jsonschema
          jq
          qrencode
          actionlint
          nixfmt
        ];
        playwrightRuntimeLibraries = pkgs.lib.optionals pkgs.stdenv.isLinux (
          with pkgs;
          [
            alsa-lib
            at-spi2-atk
            at-spi2-core
            atk
            cairo
            cups
            dbus
            expat
            fontconfig
            freetype
            glib
            gtk3
            libdrm
            libgbm
            libgcc.lib
            libxkbcommon
            mesa
            nspr
            nss
            pango
            libx11
            libxscrnsaver
            libxcomposite
            libxcursor
            libxdamage
            libxext
            libxfixes
            libxi
            libxrandr
            libxrender
            libxtst
          ]
        );
        playwrightPatchTools = pkgs.lib.optionals pkgs.stdenv.isLinux (
          with pkgs;
          [
            auto-patchelf
            patchelfUnstable
          ]
        );
        playwrightFontConfig = pkgs.makeFontsConf {
          fontDirectories = [ pkgs.dejavu_fonts.minimal ];
        };
        shellHook = extra: ''
          corepack enable >/dev/null 2>&1 || true
          ${extra}
          echo "gftb-site dev shell"
          echo "  node     $(node --version)"
          echo "  pnpm     $(pnpm --version 2>/dev/null || echo unavailable)"
          echo "  just     $(just --version)"
          echo "  bazel    $(bazelisk --version 2>&1 | head -n1)"
          echo "  gitleaks $(gitleaks version 2>&1 | head -n1)"
        '';
        playwrightHook = pkgs.lib.optionalString pkgs.stdenv.isLinux ''
          unset LD_LIBRARY_PATH
          export PLAYWRIGHT_NIX_LIBRARY_PATH="${pkgs.lib.makeLibraryPath playwrightRuntimeLibraries}"
          export PLAYWRIGHT_NIX_DYNAMIC_LINKER="${pkgs.stdenv.cc.bintools.dynamicLinker}"
          export PLAYWRIGHT_NIX_PATCHELF="${pkgs.patchelfUnstable}/bin/patchelf"
          export FONTCONFIG_FILE="${playwrightFontConfig}"
        '';

        n2c = nix2container.packages.${system}.nix2container;
        appBuildEnv = builtins.getEnv "APP_BUILD";
        appBuild =
          if appBuildEnv == "" then
            throw "flake .#image requires APP_BUILD pointing at the Bazel-materialized static build"
          else
            builtins.path {
              name = "gftb-static-build";
              path = appBuildEnv;
            };
        envOr =
          name: fallback:
          let
            value = builtins.getEnv name;
          in
          if value == "" then fallback else value;
        commitSha = envOr "BUILD_COMMIT_SHA" "unknown";
        commitRef = envOr "BUILD_COMMIT_REF" "unknown";
        created = envOr "BUILD_DATE" "1970-01-01T00:00:00Z";
        imageName = "ghcr.io/great-falls-tool-bus/gftb-site";
        # Bazel and the legacy Nix candidate builder consume the same reviewed
        # server configuration. The qualified layer packages these exact bytes.
        caddyfile = ./Caddyfile;
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
        appLayer = n2c.buildLayer {
          copyToRoot = pkgs.runCommand "gftb-static-site" { } ''
            mkdir -p "$out/srv" "$out/etc/caddy" "$out/tmp"
            chmod 1777 "$out/tmp"
            cp -a ${appBuild}/. "$out/srv/"
            # cp -a propagates the read-only store mode (0555) of the materialized
            # build root onto $out/srv; reopen it so the source marker can land.
            chmod u+w "$out/srv"
            printf '%s' '${commitSha}' > "$out/srv/health.sha"
            cp ${caddyfile} "$out/etc/caddy/Caddyfile"
          '';
        };
        # A source-independent, content-addressed carrier for the exact runtime
        # closure used by the existing candidate image. GF-I09 may publish and
        # read back this base separately; the legacy candidate stays assembled
        # from runtimeRoot below until its workflow is atomically retired.
        runtimeBaseImage = n2c.buildImage {
          name = imageName;
          copyToRoot = runtimeRoot;
          config = runtimeConfig;
        };
        image = n2c.buildImage {
          name = imageName;
          tag = "sha-${commitSha}";
          inherit created;
          copyToRoot = runtimeRoot;
          layers = [ appLayer ];
          config = runtimeConfig // {
            Labels = runtimeConfig.Labels // {
              "org.opencontainers.image.revision" = commitSha;
              "org.opencontainers.image.ref.name" = commitRef;
              "org.opencontainers.image.created" = created;
            };
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = corePackages;
          shellHook = shellHook "";
        };
        devShells.playwright = pkgs.mkShell {
          buildInputs = corePackages ++ playwrightRuntimeLibraries ++ playwrightPatchTools;
          shellHook = shellHook playwrightHook;
        };
        packages.image = image;
        packages."runtime-base-image" = runtimeBaseImage;
        packages."runtime-root" = runtimeRoot;
        formatter = pkgs.nixfmt;
      }
    );
}
