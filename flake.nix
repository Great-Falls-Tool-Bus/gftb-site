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
        caddyfile = pkgs.writeText "Caddyfile" ''
          {
            admin off
            persist_config off
          }

          :3000 {
            root * /srv
            encode zstd gzip
            respond /health "ok" 200
            respond /healthz "ok" 200

            # TIN-3959. The ONLY thing missing before this fix was
            # Cache-Control itself, which file_server never sets on its own —
            # with no Cache-Control and an epoch-era Last-Modified, browsers
            # fell back to RFC 7234 heuristic freshness (~10% of
            # now-minus-last-modified), which for an epoch date is decades:
            # returning visitors kept whatever the browser had cached,
            # essentially forever, without ever revalidating on plain
            # navigation.
            #
            # Vite's content-hashed build output (Cache-Control:
            # public,max-age=31536000,immutable — the filename itself changes
            # on any content change, so a long-lived, non-revalidating cache
            # is correct there, and is the one category the missing-header
            # bug never touched by accident: a stale cached copy of a
            # hash-named file is always the SAME content that hash names)
            # versus everything else (Cache-Control: no-cache — prerendered
            # HTML, which is nearly the whole site since every route is
            # prerendered, plus robots.txt, favicon.svg, /qr/**, and any
            # other static/** passthrough file: revalidate on every use
            # rather than trust a heuristic) are matched with an explicit
            # `not`-guarded pair, not directive order: Caddy's Caddyfile
            # adapter does NOT preserve the written order between a
            # path-matched `header` and a matcher-less one — both are
            # non-terminal and the matcher-less one runs for every request
            # regardless of position, so a plain "generic block first,
            # specific block second" (relying on "last write wins") silently
            # lets the generic no-cache rule clobber the immutable rule on
            # every hashed-asset request. Verified against the compiled
            # `caddy adapt` JSON route order, not assumed.
            #
            # `@not_hashed_immutable` ALSO strips Last-Modified and ETag
            # (adversarial review, PR #34, B1). `appLayer` is a
            # `pkgs.runCommand`, so `/srv` is a Nix store path, and the Nix
            # store normalizes every file's mtime to exactly 1
            # (1970-01-01T00:00:01Z) — not a per-build-varying value, the
            # SAME constant on every single deploy. file_server derives both
            # Last-Modified and its own ETag from (mtime, size) alone, and at
            # this pinned Caddy version, mtime 1 keeps Last-Modified while
            # dropping ETag. A validator that never changes across
            # generations is worse than none: `no-cache` forces revalidation
            # on every navigation, the browser offers back the one frozen
            # epoch date it was ever given, and file_server correctly answers
            # 304 by its own logic every single time — pinning every visitor
            # to whichever generation they first loaded, permanently. Ship no
            # validator instead, so the forced revalidation is an
            # unconditional GET. (A real per-content validator, e.g. via
            # `file_server { etag_file_extensions .sha256 }` against
            # build-time sidecar hashes, would restore 304s for HTML safely —
            # tracked as a follow-up, not required here: full 200 responses
            # on 35 small published files is an acceptable trade against a
            # permanent-staleness bug.)
            #
            # Stripping the RESPONSE validators alone is not sufficient, and
            # this was verified the hard way: `header -Last-Modified/-Etag`
            # only edits what file_server already decided to send. Go's
            # http.ServeContent (what file_server serves through) makes its
            # 304-or-200 decision from the file's real on-disk mtime against
            # whatever If-Modified-Since/If-None-Match the REQUEST carries,
            # entirely before a downstream `header` directive gets a chance
            # to touch anything — so with only the response side stripped, a
            # client offered the frozen mtime-1 date once still got a real
            # 304 back on every later re-navigation (confirmed live: same
            # frozen date in, `HTTP/1.1 304 Not Modified` out, `Cache-Control:
            # no-cache` present but with no Last-Modified/Etag to show for
            # it — the tautology was merely hidden, not fixed). The
            # `request_header` removals below strip those conditional
            # headers from the REQUEST before file_server ever evaluates
            # them, so it can never see a match and must always answer with
            # a full body.
            #
            # `/_app/immutable/*` is hardcoded rather than read from
            # BASE_PATH (svelte.config.js: `paths.base = process.env.BASE_PATH
            # ?? '''`). Harmless at the apex, where BASE_PATH is unset — but if
            # a spoke build ever sets it, every hashed asset would silently
            # fall back to the `no-cache` rule below instead of erroring.
            @hashed_immutable path /_app/immutable/*
            @not_hashed_immutable not path /_app/immutable/*

            header @hashed_immutable Cache-Control "public, max-age=31536000, immutable"
            header @not_hashed_immutable {
              Cache-Control "no-cache"
              -Last-Modified
              -Etag
            }

            request_header @not_hashed_immutable -If-Modified-Since
            request_header @not_hashed_immutable -If-None-Match
            request_header @not_hashed_immutable -If-Unmodified-Since
            request_header @not_hashed_immutable -If-Match

            file_server

            # TIN-3932: a bare `file_server` answers an unknown path with the
            # status line and nothing else, which is why the promoted site
            # returned 404 with a zero-byte body. build/404.html is the
            # PRERENDERED src/routes/404 page (not an SPA fallback, which would
            # have an empty body), so serving it gives a scriptless visitor the
            # same branded page a scripted one gets. `status` keeps the original
            # code instead of the 200 a plain `file_server` would write.
            #
            # scripts/bazel_output.py mirrors this for the preview, and
            # scripts/test-bazel-cutover-contracts.py pins the two together.
            #
            # TIN-3959 E1 (adversarial review, PR #34): the `header
            # @hashed_immutable` rule above runs unconditionally against the
            # REQUEST path, before file_server decides whether that path
            # actually resolves — so a miss under /_app/immutable/* (a
            # deploy race, or an edge/client holding HTML that references a
            # hash the origin hasn't got yet) inherited the year-long
            # immutable Cache-Control on its 404 body too, non-revalidating,
            # at that exact URL: the same poisoning class this PR exists to
            # kill. handle_errors composes its own response and runs after,
            # so resetting the three headers here is what actually wins for
            # every error path, hashed or not.
            handle_errors {
              header Cache-Control "no-cache"
              header -Last-Modified
              header -Etag
              rewrite * /404.html
              file_server {
                status {err.status_code}
              }
            }
          }
        '';
        imageRoot = pkgs.buildEnv {
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
        image = n2c.buildImage {
          name = imageName;
          tag = "sha-${commitSha}";
          inherit created;
          copyToRoot = imageRoot;
          layers = [ appLayer ];
          config = {
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
              "org.opencontainers.image.revision" = commitSha;
              "org.opencontainers.image.ref.name" = commitRef;
              "org.opencontainers.image.created" = created;
              "org.opencontainers.image.description" = "Great Falls Tool Bus static candidate";
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
        formatter = pkgs.nixfmt;
      }
    );
}
