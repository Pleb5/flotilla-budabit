{
description = ''A flake that creates a devShell containing the following:
			- Nixvim (based on nixos-unstable)
      - Stuff required for Flotilla-Budabit
		'';

inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nvim.url = "github:Pleb5/neovim-flake/master";
};

outputs = { nixpkgs, flake-utils, nvim, ... }:

    flake-utils.lib.eachDefaultSystem (system:
        let
            pkgs = nixpkgs.legacyPackages.${system};
            lib = nixpkgs.lib; 
            flotilla_nvim = nvim.packages.${system}.nvim.extend {
                opts = {
                    tabstop = lib.mkForce 2;  # Project-specific settings
                    shiftwidth = lib.mkForce 2;
                };
            };
            
        in {
            devShell = pkgs.mkShell {
                buildInputs = [ 
                    flotilla_nvim
                    pkgs.ripgrep
                    pkgs.nodejs_22
                    pkgs.just
                    pkgs.prettierd
                ];
                shellHook = ''
                    # for ngit
                    export PATH="$HOME/.cargo/bin:$PATH";

                    # FOR LINKING WELSHMAN LOCALLY WITH NPM
                    # Local linking is NOT used in the current workflow
                    # Would have to create a PNPM workspace-based config
                    # to do that in a clean way
                    #npm config set prefix=$HOME/.pnpm-global/bin
                    #export PATH="$HOME/.pnpm-global/bin:$PATH"
                '';
            };
        }
    );    
}
