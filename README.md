# @willbooster/tree-sitter-markdown

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-markdown.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-markdown)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-markdown.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-markdown)
[![Test](https://github.com/WillBooster/tree-sitter-markdown/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-markdown/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-markdown/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-markdown/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-20.41.9-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-md.svg)](https://crates.io/crates/willbooster-tree-sitter-md)

Markdown grammars for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter-grammars/tree-sitter-markdown](https://github.com/tree-sitter-grammars/tree-sitter-markdown). We are
grateful to its authors and contributors. This is not an official release of that project.

This fork builds on the grammars, external scanners, and queries of upstream's version 0.5.3 and generates the parsers
with the [WillBooster/tree-sitter](https://github.com/WillBooster/tree-sitter) generator. The block scanner compares the
digits of an ordered list marker with `'0'` and `'9'` instead of calling `isdigit`, which the C headers for
`wasm32-unknown-unknown` do not declare; both accept the ASCII digits only. The parsers carry that fork's
own ABI number (`0x57420001`) and load only with that fork's runtime, version 2.0.0 or later: upstream's tree-sitter
runtime rejects them. They parse as the parsers in upstream's 0.5.3 packages do, with these exceptions:

- Link reference definitions labelled `[x]` or `[X]` are recognized even with task-list support enabled.
- HTML declarations end on the first line containing `>`, leaving subsequent Markdown outside the HTML block.
- Short HTML comments such as `<!-->` and `<!--->` end on their opening line. Malformed `<!-` prefixes remain ordinary text.
- Block containers nest to a maximum depth of 255. Additional quote, list, code, or HTML block openers remain literal text inside the deepest container.
- Final headings, thematic breaks, empty list items, and opening code fences are recognized without a trailing newline.
- A closing code fence at the end of a file is recognized even without a trailing line ending.
- Trailing spaces and tabs at EOF are excluded from the preceding block’s inline range, as they are before a line ending.
- Ordered lists interrupt a paragraph only when the first marker has numeric value 1, including leading-zero forms such as `01.`. Markers contain at most nine digits.
- A NUL character is part of the text around it, in both grammars, where upstream's lexers report it as an unexpected
  character in an `ERROR` node.
- A block that starts with bracketed text holding a backslash escape or a character reference, such as
  `[\<g> element](/a)` or `[&lt;a&gt;] b`, has an error in both parsers. Upstream's parser reads an `ERROR` that holds the
  `link_label`, followed by a paragraph. When the rest of the line reads as a single link destination, as in both
  examples, this parser reads a `link_reference_definition` whose `:` is `MISSING` instead.

It holds two grammars, as upstream does: `markdown` (in `tree-sitter-markdown/`) parses the block structure of a
document, and `markdown_inline` (in `tree-sitter-markdown-inline/`) parses the inline content that the block grammar
leaves in `inline` and `pipe_table_cell` nodes. Both parsers include the extensions that upstream enables by default:
GitHub Flavored Markdown (task lists, strikethrough, and pipe tables), YAML and TOML metadata blocks, and LaTeX spans.
Tags and wiki links, which upstream adds only when its parsers are generated with environment variables set, are not
included, as they are not in upstream's packages.

## Usage

The npm package ships `tree-sitter-markdown.wasm` and `tree-sitter-markdown_inline.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter) version 2.0.0 or later, which
runs in Node.js, Bun, browsers, and Cloudflare Workers. Parse a document with the block grammar, then parse the inline
content of each `inline` or `pipe_table_cell` node with the inline grammar, limited to the node's range without its
named children (block continuations such as the `>` of a block quote). In Node.js and Bun, load the grammars from their
paths:

```js
import { fileURLToPath } from 'node:url';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const load = (name) =>
  Language.load(fileURLToPath(import.meta.resolve(`@willbooster/tree-sitter-markdown/${name}.wasm`)));
const blockParser = new Parser();
blockParser.setLanguage(await load('tree-sitter-markdown'));
const inlineParser = new Parser();
inlineParser.setLanguage(await load('tree-sitter-markdown_inline'));

const source = '# Title\n\n> Some *emphasized*\n> text.\n';
const tree = blockParser.parse(source);
for (const node of tree.rootNode.descendantsOfType(['inline', 'pipe_table_cell'])) {
  const includedRanges = [];
  let start = { index: node.startIndex, position: node.startPosition };
  for (const child of node.namedChildren) {
    includedRanges.push({
      startIndex: start.index,
      startPosition: start.position,
      endIndex: child.startIndex,
      endPosition: child.startPosition,
    });
    start = { index: child.endIndex, position: child.endPosition };
  }
  includedRanges.push({
    startIndex: start.index,
    startPosition: start.position,
    endIndex: node.endIndex,
    endPosition: node.endPosition,
  });
  const inlineTree = inlineParser.parse(source, null, { includedRanges });
}
```

In browsers, serve the `.wasm` files and load them by URL (the example uses Vite's `?url` imports):

```js
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';
import markdownUrl from '@willbooster/tree-sitter-markdown/tree-sitter-markdown.wasm?url';
import markdownInlineUrl from '@willbooster/tree-sitter-markdown/tree-sitter-markdown_inline.wasm?url';

await Parser.init({ locateFile: () => runtimeUrl });
const blockParser = new Parser();
blockParser.setLanguage(await Language.load(markdownUrl));
const inlineParser = new Parser();
inlineParser.setLanguage(await Language.load(markdownInlineUrl));
```

Cloudflare Workers do not allow compiling Wasm at run time, so import the `.wasm` files as modules, with or without
Node.js compatibility:

```js
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtime from '@willbooster/web-tree-sitter/web-tree-sitter.wasm';
import markdown from '@willbooster/tree-sitter-markdown/tree-sitter-markdown.wasm';
import markdownInline from '@willbooster/tree-sitter-markdown/tree-sitter-markdown_inline.wasm';

await Parser.init({ wasmModule: runtime });
const blockParser = new Parser();
blockParser.setLanguage(await Language.load(markdown));
const inlineParser = new Parser();
inlineParser.setLanguage(await Language.load(markdownInline));
```

The package also ships the grammar definitions (`common/common.js`, `common/html_entities.json`,
`tree-sitter-markdown/grammar.js`, and `tree-sitter-markdown-inline/grammar.js`), the queries in
`tree-sitter-markdown/queries/` and `tree-sitter-markdown-inline/queries/`, and the node types in
`tree-sitter-markdown/src/node-types.json` and `tree-sitter-markdown-inline/src/node-types.json`.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-md) and on
[willbooster-tree-sitter](https://crates.io/crates/willbooster-tree-sitter), the runtime this package is tested and
fuzzed with:

```toml
[dependencies]
tree-sitter = { package = "willbooster-tree-sitter", version = "2" }
tree-sitter-md = { package = "willbooster-tree-sitter-md", version = "1" }
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_md::LANGUAGE.into())?;
```

The crate keeps the API of upstream's `tree-sitter-md` crate: `tree_sitter_md::INLINE_LANGUAGE` is the inline grammar,
and the `parser` feature adds `MarkdownParser`, which parses a document with both grammars into a `MarkdownTree`.
The `parser` feature requires runtime version 2.0.18 or later, which supports UTF-8 characters split across short input chunks.
`MarkdownCursor::field_name` returns a name that borrows from the tree (`Option<&'tree str>`), since the
willbooster-tree-sitter runtime returns field names with that lifetime, where upstream's returns `Option<&'static str>`.

## Development

```sh
mise install
bun install --frozen-lockfile
bun run test/ci-setup # installs Chromium for the browser test
bun run build/ci
bun run test
script/parse-examples
cargo test --all-features
```

The scripts and tests generate, build, test, and parse with `script/tree-sitter`, the tree-sitter CLI of the
WillBooster/tree-sitter runtime version locked in `Cargo.lock`, since the generator and the runtime of upstream's CLI are
not the ones this package ships with. Its first run downloads that CLI from the runtime's GitHub Release, or builds it
with `cargo` (whose build runs the CMake that `mise.toml` pins) when the download fails or the release has no binary
that runs here. Run other CLI commands through it as well (e.g. `script/tree-sitter parse --grammar-path
tree-sitter-markdown file.md`).

`bun run generate` records a fresh generation profile for each grammar from the cases in its `test/corpus` (and, for the
block grammar, from Git-tracked files in `examples/`, of which there are none), then generates compact parser tables.
It generates the parsers with upstream's default extensions whatever extension variables (e.g. `ALL_EXTENSIONS`) the
environment holds. The parsers also embed metadata from `tree-sitter.json`. After changing a grammar, `common/`,
`tree-sitter.json`, or a corpus case, regenerate and commit `tree-sitter-markdown/src/` and
`tree-sitter-markdown-inline/src/`. Profiles in `.tmp/generation-profiles/` are temporary and must not be committed.
`bun run build-wasm`, `bun run build/ci`, and the release build regenerate the parsers before compiling them.

`bun run test` runs:

- the corpus of each grammar (`script/test-corpus`), with the native build and with the Wasm build (the first run
  downloads the WASI SDK). The corpora are upstream's, which expect every extension: `script/corpus-exclusions` lists
  the cases of the tags and wiki-link extensions, which these parsers leave out;
- an incremental-parsing check (`test/unit/incremental.test.ts`): `script/fuzz-corpus` runs `tree-sitter fuzz` for a
  grammar, which edits each of its corpus cases at random, reparses it, undoes the edits, and reparses again.
  `TREE_SITTER_SEED`, `TREE_SITTER_ITERATIONS`, and `TREE_SITTER_EDITS` run other or more edits. It skips the cases that
  `script/fuzz-corpus` excludes, which upstream's parser fails as well;
- a check that the real-world Markdown files in `examples/` fail to parse with the block grammar exactly as listed in
  `script/known-failures.txt`. The first run clones the repositories. The example repositories are pinned to commits in
  `script/parse-examples`. After a grammar change or a moved pin alters that list, `script/parse-examples` rewrites it;
  review its diff before committing;
- a performance check (`test/unit/performance.test.ts`) that input leaving constructs open on each line parses in
  linear time with both grammars, since consumers parse files while they are being edited. It loads the Wasm builds
  through @willbooster/web-tree-sitter, which `bun run build/ci` rebuilds after regenerating the parsers;
- a check (`test/unit/runtimeVersion.test.ts`) that `@willbooster/web-tree-sitter` in `package.json` and
  `willbooster-tree-sitter` in `Cargo.lock` are the same version, since the Wasm tests run on the former and the Rust
  tests, the fuzzer, and the CLI on the latter;
- tests that load the Wasm builds with @willbooster/web-tree-sitter in Chromium (`test/e2e/browser.test.ts`) and in
  Cloudflare Workers with and without Node.js compatibility (`test/e2e/workers.test.ts`).

The tests compile the parsers into `.tmp/tree-sitter-lib` rather than the CLI's cache shared by every checkout;
`script/fuzz-corpus` and `script/parse-examples` build a parser of their own in `.tmp/` for each run and delete it
afterwards.

CI also runs these tests on Linux arm64 and macOS, where the CLI compiles the parsers and the scanners natively, and
fuzzes both parsers with libFuzzer and sanitizers (`.github/workflows/robustness.yml`).

### References

- [CommonMark Spec](https://spec.commonmark.org/)
- [GitHub Flavored Markdown Spec](https://github.github.com/gfm/)
