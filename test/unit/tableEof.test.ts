import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const cli = path.join(repositoryRoot, 'script/tree-sitter');

test('complete table delimiter rows accept EOF and survive final-newline edits', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/table-eof-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const [firstPrefix, nextPrefix] of [
      ['', ''],
      ['> ', '> '],
      ['- ', '  '],
    ]) {
      for (const delimiter of ['| - | - |', '- | -', '| :- | -: |', ':- | -:']) {
        for (const padding of ['', ' ', '\t']) {
          for (const newline of ['\n', '\r\n']) {
            const source = `${firstPrefix}| a | b |${newline}${nextPrefix}${delimiter}${padding}`;
            const original = parse(library, input, source);
            expect(original.match(/\(pipe_table /g), source).toHaveLength(1);
            expect(original.match(/\(pipe_table_delimiter_cell /g), source).toHaveLength(2);
            const end = Buffer.byteLength(source);
            expect(parse(library, input, source, [`${end} 0 ${newline}`])).toBe(
              parse(library, input, source + newline)
            );
            expect(parse(library, input, source, [`${end} 0 ${newline}`, `${end} ${newline.length} `])).toBe(original);
            expect(parse(library, input, source + newline, [`${end} ${newline.length} `])).toBe(original);
          }
        }
      }
    }
    for (const delimiter of ['-', '| -', '| - | - |', '| : |', '| - x |']) {
      const source = `| a |\n${delimiter}`;
      expect(parse(library, input, source), source).not.toContain('(pipe_table ');
    }
    for (const delimiter of ['| - | |', '|| - |', '- | |', '| | - |']) {
      const source = `| a | b |\n${delimiter}`;
      expect(parse(library, input, source), source).not.toContain('(pipe_table ');
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
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000 }
  );
  expect(tree, source).not.toMatch(/\((ERROR|MISSING)/);
  return tree;
}
