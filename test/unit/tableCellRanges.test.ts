import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const cli = path.join(repositoryRoot, 'script/tree-sitter');

test('table cell ranges exclude horizontal padding and preserve internal text', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/table-cell-ranges-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const content of ['word', 'two words', 'café', String.raw`a\|b`, '*bold*']) {
      for (const padding of [' ', '\t', ' \t ']) {
        for (const [firstPrefix, nextPrefix] of [
          ['', ''],
          ['> ', '> '],
          ['- ', '  '],
        ]) {
          for (const newline of ['\n', '\r\n']) {
            const lines = [
              `${firstPrefix}|${padding}${content}${padding}|`,
              `${nextPrefix}| - |`,
              `${nextPrefix}|${padding}${content}${padding}|`,
            ];
            const source = lines.join(newline) + newline;
            writeFileSync(input, source);
            const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
              cwd: repositoryRoot,
              encoding: 'utf8',
              timeout: 10_000,
            });
            expect(tree, source).not.toMatch(/\((ERROR|MISSING)/);
            const cells = [...tree.matchAll(/\(pipe_table_cell \[(\d+), (\d+)\] - \[\d+, (\d+)\]/g)];
            expect(cells, source).toHaveLength(2);
            for (const cell of cells) {
              const line = lines[Number(cell[1])];
              assert.ok(line !== undefined);
              const bytes = Buffer.from(line);
              expect(bytes.subarray(Number(cell[2]), Number(cell[3])).toString(), source).toBe(content);
            }
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
