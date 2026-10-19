import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { generationInputMtime } from '../helpers/generationInputs.js';
import { type Grammar, WasmFiles } from '../helpers/grammars.js';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = path.join(import.meta.dirname, '../..');
// A line that leaves constructs open for the rest of the input: nested block containers around a paragraph with an
// unclosed link and emphasis for the block grammar, and an unclosed link after emphasis for the inline grammar.
const OpenLines: Record<Grammar, string> = {
  'tree-sitter-markdown': '> - > [a *b\n',
  'tree-sitter-markdown-inline': 'a *b* [c\n',
};
await Parser.init();

for (const [grammar, line] of Object.entries(OpenLines) as [Grammar, string][]) {
  // The Wasm build is the one the package ships.
  const wasmPath = path.join(Root, WasmFiles[grammar]);
  const parser = new Parser();
  parser.setLanguage(await Language.load(wasmPath));

  describe(grammar, () => {
    // The tests load the existing Wasm build, so a stale one would hide an edit that makes parsing slower than linear.
    // `tree-sitter build --wasm` compiles src/ without regenerating it, so each step is checked on its own.
    test('uses a Wasm build built from the current parser', () => {
      const mtime = (file: string): number => fs.statSync(path.join(Root, grammar, file)).mtimeMs;
      expect(
        generationInputMtime(Root, grammar) > mtime('src/parser.c'),
        `generation inputs changed after ${grammar}/src/parser.c was generated; run \`bun run build/ci\``
      ).toBe(false);
      expect(
        Math.max(mtime('src/parser.c'), mtime('src/scanner.c'), mtime('src/tree_sitter/parser.h')) >
          fs.statSync(wasmPath).mtimeMs,
        `${grammar}/src/ changed after the Wasm build was built; run \`bun run build/ci\``
      ).toBe(false);
    });

    if (grammar === 'tree-sitter-markdown') {
      test('does not rescan a long blank suffix for every closing list depth', { timeout: 60_000 }, () => {
        const shallow = listWithBlankSuffix(25);
        const deep = listWithBlankSuffix(250);
        parseCpuTime(parser, shallow);
        parseCpuTime(parser, deep);
        let shallowFastest = Infinity;
        let deepFastest = Infinity;
        for (let run = 0; run < 3; run++) {
          shallowFastest = Math.min(shallowFastest, parseCpuTime(parser, shallow));
          deepFastest = Math.min(deepFastest, parseCpuTime(parser, deep));
        }
        expect(deepFastest / shallowFastest).toBeLessThan(8);
      });
    }

    // Consumers parse files being edited, so input that leaves constructs open on every line must still parse in linear
    // time: ten times the lines take about ten times as long, against a hundred times for quadratic parsing. The ratio
    // catches a cost that grows faster than the input even on a slow CI runner. The parses are timed in the CPU time of
    // the thread that runs them: wall-clock time is inflated unevenly by the test files running alongside, and the
    // process's CPU time also counts the engine's background threads, which compile the Wasm build and collect garbage
    // during the parses. 2,000 and 20,000 lines are measured after warm-up parses and in alternation, each keeping its
    // fastest run; their ratio is about 10 locally, and 18 leaves a margin over that while failing for growth faster
    // than about n^1.25.
    test('parses a construct left open on each line in linear time', { timeout: 60_000 }, () => {
      const small = line.repeat(2000);
      const large = line.repeat(20_000);
      parseCpuTime(parser, large);
      parseCpuTime(parser, large);
      let smallFastest = Infinity;
      let largeFastest = Infinity;
      for (let run = 0; run < 5; run++) {
        smallFastest = Math.min(smallFastest, parseCpuTime(parser, small));
        largeFastest = Math.min(largeFastest, parseCpuTime(parser, large));
      }
      expect(largeFastest / smallFastest).toBeLessThan(18);
    });
  });
}

function listWithBlankSuffix(depth: number): string {
  return (
    Array.from({ length: depth }, (_, index) => `${'  '.repeat(index)}- a\n`).join('') + '\n'.repeat(100_000) + 'tail\n'
  );
}

function parseCpuTime(parser: Parser, source: string): number {
  const start = process.threadCpuUsage();
  const tree = parser.parse(source);
  const { system, user } = process.threadCpuUsage(start);
  if (!tree) throw new Error('The parser returned no tree');
  // Both lines parse without an error, which shows that the input exercises parsing rather than error recovery.
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(false);
  return system + user;
}
