import { expect, test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('list item selections own their leading prefixes and leave following lines intact', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/list-item-ranges-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const cli = path.join(repositoryRoot, 'script/tree-sitter');
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
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const prefix of ['', '> ', '> > ']) {
      for (const marker of ['-', '+', '*', '1.', '1)']) {
        for (const newline of ['\n', '\r\n']) {
          const lines = [
            `${prefix}- Elements`,
            `${prefix}    ${marker} Water`,
            `${prefix}    ${marker} Earth`,
            `${prefix}    `,
            'A paragraph.',
          ];
          const source = lines.join(newline) + newline;
          const tree = parse(source);
          for (const row of [1, 2]) {
            const selected = tree.match(new RegExp(`\\(list_item \\[${row}, (\\d+)\\] - \\[(\\d+), (\\d+)\\]`));
            assert.ok(selected, source);
            const start = Buffer.byteLength(lines.slice(0, row).join(newline) + newline) + Number(selected[1]);
            const end =
              Buffer.byteLength(lines.slice(0, Number(selected[2])).join(newline) + newline) + Number(selected[3]);
            const bytes = Buffer.from(source);
            const deleted = Buffer.concat([bytes.subarray(0, start), bytes.subarray(end)]).toString();
            expect(deleted, source).toBe(lines.filter((_, index) => index !== row).join(newline) + newline);
            parse(deleted);
          }
        }
      }
    }
    for (const depth of [1, 3, 16]) {
      for (const blankLines of [1, 2, 32, 1000]) {
        for (const newline of ['\n', '\r\n']) {
          const prefix =
            Array.from({ length: depth }, (_, index) => `${'  '.repeat(index)}- a${newline}`).join('') +
            newline.repeat(blankLines);
          const source = `${prefix}tail${newline}`;
          const position = Buffer.byteLength(prefix);
          const indentation = '  '.repeat(depth);
          const changed = `${prefix}${indentation}tail${newline}`;
          expect(parse(source, [`${position} 0 ${indentation}`])).toBe(parse(changed));
          expect(parse(source, [`${position} 0 ${indentation}`, `${position} ${indentation.length} `])).toBe(
            parse(source)
          );
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
