import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('closing fence ranges exclude trailing whitespace with and without a final newline', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/fence-ranges-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const cli = path.join(repositoryRoot, 'script/tree-sitter');
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const fence of ['```', '~~~']) {
      for (const whitespace of ['   ', '\t']) {
        for (const newline of ['', '\n']) {
          for (const nested of [false, true]) {
            const indent = nested ? '  ' : '';
            const source = `${nested ? '- ' : ''}${fence}\n${indent}x\n${indent}${fence}${whitespace}${newline}`;
            writeFileSync(input, source);
            const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
              cwd: repositoryRoot,
              encoding: 'utf8',
              timeout: 10_000,
            });
            expect(tree, source).not.toContain('ERROR');
            expect(tree, source).toContain(
              `(fenced_code_block_delimiter [2, ${indent.length}] - [2, ${indent.length + 3}])`
            );
          }
        }
      }
    }
    for (const fence of ['```', '~~~']) {
      for (const whitespace of ['   ', '\t']) {
        const source = `${fence}\nx\n${whitespace}`;
        writeFileSync(input, source);
        const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
          cwd: repositoryRoot,
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(tree, source).not.toContain('ERROR');
        expect(tree, source).toContain(`(code_fence_content [1, 0] - [2, ${whitespace.length}]`);
      }
      for (const prefix of ['    ', '     ', '\t', 'text ']) {
        for (const newline of ['', '\n']) {
          for (const nested of [false, true]) {
            const indent = nested ? '  ' : '';
            const contentPrefix = nested && prefix === '\t' ? '\t\t' : prefix;
            const source = `${nested ? '- ' : ''}${fence}\n${indent}x\n${indent}${contentPrefix}${fence}${newline}`;
            writeFileSync(input, source);
            const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
              cwd: repositoryRoot,
              encoding: 'utf8',
              timeout: 10_000,
            });
            expect(tree, source).not.toContain('ERROR');
            expect(tree.match(/\(fenced_code_block_delimiter /g), source).toHaveLength(1);
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
