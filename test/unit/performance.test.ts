import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { describe, expect, test } from 'vitest';

import { generationInputMtime } from '../helpers/generationInputs.js';
import { type Grammar, WasmFiles } from '../helpers/grammars.js';

const Root = path.join(import.meta.dirname, '../..');
// How many times longer the large input of a linear-time check is than its small input.
const Growth = 10;
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
          const lines = (count: number): string => `- a\n${`\n${padding}\n`.repeat(count)}  tail\n`;
          expectLinearGrowth(parser, lines(1000), lines(1000 * Growth));
        }
      });
      for (const delimiter of ['*', '_', '`', '~', '* ']) {
        test(
          `parses a long ${JSON.stringify(delimiter)} run in a paragraph in linear time`,
          { timeout: 60_000 },
          () => {
            // A run is read faster than a line, so it needs more repetitions for a measurable CPU time.
            expectLinearParsing(parser, delimiter, (run) => `a\n${run}x${run}\n`, 20_000 / delimiter.length);
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
  expectLinearGrowth(parser, wrap(line.repeat(smallCount)), wrap(line.repeat(smallCount * Growth)));
}

// The thread CPU time of a parse on CI virtual machines varies up to about twice between runs, and a longer
// measurement is likelier to include such an inflated period. Each sample therefore parses the small input `Growth`
// times so that both inputs are measured over the same amount of work; linear parsing keeps the ratio near 1, while
// quadratic parsing makes it near `Growth`.
function expectLinearGrowth(parser: Parser, small: string, large: string): void {
  parseCpuTime(parser, large);
  parseCpuTime(parser, large);
  const samples: { smallCpu: number; largeCpu: number }[] = [];
  for (let run = 0; run < 3; run++) {
    let smallCpu = 0;
    for (let repetition = 0; repetition < Growth; repetition++) smallCpu += parseCpuTime(parser, small);
    samples.push({ smallCpu, largeCpu: parseCpuTime(parser, large) });
  }
  const smallFastest = Math.min(...samples.map(({ smallCpu }) => smallCpu));
  const largeFastest = Math.min(...samples.map(({ largeCpu }) => largeCpu));
  expect(largeFastest / smallFastest, JSON.stringify(samples)).toBeLessThan(1.8);
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
