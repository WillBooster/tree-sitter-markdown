import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const cli = path.join(repositoryRoot, 'script/tree-sitter');

test('deep block containers retain bounded state across edits and undo', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/block-depth-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const depth of [253, 254, 255, 256, 512]) {
      const prefix = '> '.repeat(depth);
      const source = `${prefix}first\n${prefix}second\n\noutside\n`;
      const original = parse(library, input, source);
      expect(original.match(/\(block_quote /g), `depth ${depth}`).toHaveLength(Math.min(depth, 255));
      expect(original).toContain(`(inline [0, ${2 * Math.min(depth, 255)}]`);
      for (const offset of [0, Math.min(508, prefix.length - 2)]) {
        const inserted = `${source.slice(0, offset)}> ${source.slice(offset)}`;
        expect(parse(library, input, source, [`${offset} 0 > `])).toBe(parse(library, input, inserted));
        expect(parse(library, input, source, [`${offset} 0 > `, `${offset} 2 `])).toBe(original);
        const removed = source.slice(0, offset) + source.slice(offset + 2);
        expect(parse(library, input, source, [`${offset} 2 `])).toBe(parse(library, input, removed));
        expect(parse(library, input, source, [`${offset} 2 `, `${offset} 0 > `])).toBe(original);
      }
    }
    for (const [payload, node] of [
      ['- text', 'list_item'],
      ['```', 'fenced_code_block'],
      ['<!DOCTYPE html>', 'html_block'],
      ['<!-->', 'html_block'],
      ['<!--->', 'html_block'],
    ]) {
      const firstLine = `${'> '.repeat(255)}first\n`;
      for (const continuedDepth of [0, 1, 254]) {
        const source = `${firstLine}${'> '.repeat(continuedDepth)}${payload}\n`;
        expect(parse(library, input, source)).toContain(
          `(${node} [1, ${node === 'list_item' ? 0 : continuedDepth * 2}]`
        );
      }
      const boundedSource = `${firstLine}${'> '.repeat(255)}${payload}\n`;
      const shallowerSource = `${firstLine}${'> '.repeat(254)}${payload}\n`;
      expect(parse(library, input, boundedSource, [`${firstLine.length} 2 `])).toBe(
        parse(library, input, shallowerSource)
      );
      expect(parse(library, input, boundedSource, [`${firstLine.length} 2 `, `${firstLine.length} 0 > `])).toBe(
        parse(library, input, boundedSource)
      );
      for (const ending of ['\n\noutside\n', '']) {
        expect(parse(library, input, `${'> '.repeat(254)}${payload}${ending}`)).toContain(`(${node} `);
        const bounded = parse(library, input, `${'> '.repeat(255)}${payload}${ending}`);
        expect(bounded).not.toContain(`(${node} `);
        expect(bounded).toContain('(inline [0, 510]');
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);

function parse(library: string, input: string, source: string, edits: string[] = []): string {
  writeFileSync(input, source);
  const tree = execFileSync(
    cli,
    ['parse', '-l', library, '--lang-name', 'markdown', input, ...edits.flatMap((edit) => ['--edits', edit])],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  expect(tree, source).not.toMatch(/\((ERROR|MISSING)/);
  return tree;
}
