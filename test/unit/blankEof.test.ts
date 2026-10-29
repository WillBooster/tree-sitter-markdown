import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('a whitespace-only final line does not create a paragraph or code block', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/blank-eof-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const cli = path.join(repositoryRoot, 'script/tree-sitter');
  const parse = (source: string): string => {
    writeFileSync(input, source);
    return execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
  };
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], {
      cwd: repositoryRoot,
      timeout: 60_000,
    });
    for (const newline of ['\n', '\r\n']) {
      for (const before of [
        '',
        `a${newline}${newline}`,
        `- a${newline}${newline}`,
        `> a${newline}>${newline}> `,
        `- outer${newline}  - a${newline}${newline}`,
      ]) {
        for (const padding of [' ', '   ', '    ', '\t', ' \t ', '\t  ']) {
          const source = before + padding;
          const tree = parse(source);
          expect(tree, source).not.toMatch(/ERROR|MISSING|indented_code_block/);
          expect([...tree.matchAll(/\(paragraph \[/g)], source).toHaveLength(
            before.includes('outer') ? 2 : before ? 1 : 0
          );
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
