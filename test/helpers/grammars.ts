// The grammar directories, each with its own grammar.js, src/, and test/corpus, and the names of their Wasm builds.
export const WasmFiles = {
  'tree-sitter-markdown': 'tree-sitter-markdown.wasm',
  'tree-sitter-markdown-inline': 'tree-sitter-markdown_inline.wasm',
} as const;

export type Grammar = keyof typeof WasmFiles;

export const Grammars = Object.keys(WasmFiles) as Grammar[];
