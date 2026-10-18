fn main() {
    let block_dir = std::path::Path::new("tree-sitter-markdown").join("src");
    let inline_dir = std::path::Path::new("tree-sitter-markdown-inline").join("src");

    let mut c_config = cc::Build::new();
    // `tree-sitter generate` writes the same tree_sitter/ headers into each src/, which the scanners include.
    c_config.std("c11").include(&block_dir);

    #[cfg(target_env = "msvc")]
    c_config.flag("-utf-8");

    if std::env::var("TARGET").unwrap() == "wasm32-unknown-unknown" {
        let Ok(wasm_headers) = std::env::var("DEP_TREE_SITTER_LANGUAGE_WASM_HEADERS") else {
            panic!(
                "Environment variable DEP_TREE_SITTER_LANGUAGE_WASM_HEADERS must be set by the language crate (tree-sitter-language 0.1.6 or later)"
            );
        };

        // The scanners' C library functions, including `malloc` and `free`, are linked from the willbooster-tree-sitter
        // runtime, which builds them into the application for this target.
        c_config.include(&wasm_headers);
    }

    for path in [
        block_dir.join("parser.c"),
        block_dir.join("scanner.c"),
        inline_dir.join("parser.c"),
        inline_dir.join("scanner.c"),
    ] {
        c_config.file(&path);
        println!("cargo:rerun-if-changed={}", path.display());
    }

    c_config.compile("tree-sitter-markdown");
}
