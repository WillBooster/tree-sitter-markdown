import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { describe, expect, test } from 'vitest';

import { generationInputMtime } from '../helpers/generationInputs.js';
import { type Grammar, WasmFiles } from '../helpers/grammars.js';

const Root = path.join(import.meta.dirname, '../..');
const OpenLines: Record<Grammar, string> = {
  'tree-sitter-markdown': '> - > [a *b\n',
  'tree-sitter-markdown-inline': 'a *b* [c\n',
};
await Parser.init();

for (const [grammar, line] of Object.entries(OpenLines) as [Grammar, string][]) {
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
      test('parses alternating blank and padded list lines in linear time', { timeout: 60_000 }, () => {
        for (const padding of ['      ', '\t ']) {
          const small = `- a\n${`\n${padding}\n`.repeat(1000)}  tail\n`;
          const large = `- a\n${`\n${padding}\n`.repeat(10_000)}  tail\n`;
          parseCpuTime(parser, small);
          parseCpuTime(parser, large);
          const samples: { smallCpu: number; largeCpu: number }[] = [];
          for (let run = 0; run < 3; run++) {
            samples.push({ smallCpu: parseCpuTime(parser, small), largeCpu: parseCpuTime(parser, large) });
          }
          const smallFastest = Math.min(...samples.map(({ smallCpu }) => smallCpu));
          const largeFastest = Math.min(...samples.map(({ largeCpu }) => largeCpu));
          expect(largeFastest / smallFastest, JSON.stringify({ padding, samples })).toBeLessThan(18);
        }
      });
      for (const delimiter of ['*', '_', '`', '~', '* ']) {
        test(
          `parses a long ${JSON.stringify(delimiter)} run in a paragraph in linear time`,
          { timeout: 60_000 },
          () => {
            // A run is read faster than a line, so it needs more repetitions for a measurable CPU time.
            expectLinearParsing(parser, delimiter, (run) => `a\n${run}x${run}\n`, 20_000);
          }
        );
      }
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

    test('parses a construct left open on each line in linear time', { timeout: 60_000 }, () => {
      expectLinearParsing(parser, line);
    });
    if (grammar === 'tree-sitter-markdown-inline') {
      // One test per line keeps each within the timeout on slow runners.
      for (const line of ['1_*_*a ', 'b_*_*a ', '~~a ', '~a ', '**a*.', 'foo **bar* baz. ']) {
        test(`parses repeated delimiter runs ${JSON.stringify(line)} in linear time`, { timeout: 60_000 }, () => {
          expectLinearParsing(parser, line);
        });
      }
      for (const line of ['*<a ~>*~ ', '*<a title="~>*">x</a>*~ ', '*<b>*.* ']) {
        test(`parses repeated angle prefixes ${JSON.stringify(line)} in linear time`, { timeout: 60_000 }, () => {
          expectLinearParsing(parser, line);
        });
      }
      for (const line of ['a <?a\n', 'a <![CDATA[a\n', 'a <!X a\n']) {
        test(
          `parses repeated unterminated raw HTML ${JSON.stringify(line)} in linear time`,
          { timeout: 60_000 },
          () => {
            expectLinearParsing(parser, line);
          }
        );
      }
    }
  });
}

function expectLinearParsing(
  parser: Parser,
  line: string,
  wrap = (lines: string): string => lines,
  smallCount = 2000
): void {
  const small = wrap(line.repeat(smallCount));
  const large = wrap(line.repeat(smallCount * 10));
  parseCpuTime(parser, large);
  parseCpuTime(parser, large);
  let smallFastest = Infinity;
  let largeFastest = Infinity;
  for (let run = 0; run < 5; run++) {
    smallFastest = Math.min(smallFastest, parseCpuTime(parser, small));
    largeFastest = Math.min(largeFastest, parseCpuTime(parser, large));
  }
  expect(largeFastest / smallFastest).toBeLessThan(18);
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
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(false);
  return system + user;
}
