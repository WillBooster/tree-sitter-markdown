import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('empty table cells and pipe-only body rows parse with and without inserted cell content', () => {
  const cli = execFileSync(path.join(repositoryRoot, 'script/tree-sitter'), ['--print-path'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/empty-table-cells-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const parse = (source: string): string => {
    writeFileSync(input, source);
    const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(tree, source).not.toMatch(/ERROR|MISSING/);
    return tree;
  };
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], {
      cwd: repositoryRoot,
      timeout: 60_000,
    });
    for (const row of [
      '|',
      '| ',
      '| \t',
      ' |',
      '  |',
      '\t|',
      ' \t|',
      ' ||',
      '||',
      '|||',
      '|x||',
      '||x|',
      '|x||y|',
      String.raw`||x\|y||`,
      '| |',
      '|x| |y|',
    ]) {
      for (const [prefix, continuation] of [
        ['', ''],
        ['> ', '> '],
        ['- ', '  '],
      ] as const) {
        for (const newline of ['\n', '\r\n']) {
          for (const ending of ['', newline]) {
            const before = `${prefix}|a|b|c|${newline}${continuation}|-|-|-|${newline}${continuation}`;
            const source = before + row + ending;
            const tree = parse(source);
            expect([...tree.matchAll(/\(pipe_table_row \[/g)], source).toHaveLength(row.trim() === '|' ? 0 : 1);
            parse(before + row[0] + 'v' + row.slice(1) + ending);
          }
        }
      }
    }
    for (const [header, delimiter, cells] of [
      ['|||||', '|-|-|-|-|', 0],
      ['||a|', '|-|-|', 1],
    ] as const) {
      for (const [prefix, continuation] of [
        ['', ''],
        ['> ', '> '],
        ['- ', '  '],
      ]) {
        for (const newline of ['\n', '\r\n']) {
          for (const ending of ['', newline]) {
            const source = `${prefix}${header}${newline}${continuation}${delimiter}${newline}${continuation}||${ending}`;
            const tree = parse(source);
            expect([...tree.matchAll(/\(pipe_table_header \[/g)], source).toHaveLength(1);
            expect([...tree.matchAll(/\(pipe_table_cell \[/g)], source).toHaveLength(cells);
            const at = (prefix + '|').length;
            parse(source.slice(0, at) + 'v' + source.slice(at));
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
