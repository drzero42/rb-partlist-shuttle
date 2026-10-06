{ pkgs, ... }:

{
  packages = [
    pkgs.git
    pkgs.nodejs_26 # runtime for esbuild + Vitest; 26.x = current LTS line
    pkgs.pnpm_12 # package manager, pinned to major 12 (current release line)
  ];

  enterShell = ''
    echo "node $(node --version) | pnpm $(pnpm --version)"
  '';

  # `devenv test` — the real suite now that package.json exists.
  tasks."devenv:enterTest".exec = ''
    pnpm install --frozen-lockfile
    pnpm test
  '';
}
