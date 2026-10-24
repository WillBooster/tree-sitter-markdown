import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('empty table cells and pipe-only body rows parse and remain editable', () => {
  const cli = execFileSync(path.join(repositoryRoot, 'script/tree-sitter'), ['--print-path'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/empty-table-cells-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const parse = (source: string, edits: string[] = []): string => {
    writeFileSync(input, source);
    const tree = execFileSync(
      cli,
      ['parse', '-l', library, '--lang-name', 'markdown', input, ...(edits.length > 0 ? ['--edits', ...edits] : [])],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
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
            const at = Buffer.byteLength(before + row[0]);
            const changed = before + row[0] + 'v' + row.slice(1) + ending;
            expect(parse(source, [`${at} 0 v`]), source).toBe(parse(changed));
            expect(parse(source, [`${at} 0 v`, `${at} 1 `]), source).toBe(tree);
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
            const at = Buffer.byteLength(prefix + '|');
            const changed = source.slice(0, at) + 'v' + source.slice(at);
            expect(parse(source, [`${at} 0 v`]), source).toBe(parse(changed));
            expect(parse(source, [`${at} 0 v`, `${at} 1 `]), source).toBe(tree);
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
