import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('setext headings and thematic breaks leave the following container prefix outside their ranges', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/block-continuation-ranges-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const cli = path.join(repositoryRoot, 'script/tree-sitter');
  const cases = [
    { lines: ['heading', '==='], kind: 'setext_heading' },
    { lines: ['heading', '---'], kind: 'setext_heading' },
    { lines: ['***'], kind: 'thematic_break' },
    { lines: ['___'], kind: 'thematic_break' },
    { lines: ['---'], kind: 'thematic_break' },
  ];
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const { lines, kind } of cases) {
      for (const [prefix, continuation] of [
        ['', ''],
        ['> ', '> '],
        ['> > ', '> > '],
        ['+ ', '  '],
      ] as const) {
        for (const newline of ['\n', '\r\n']) {
          for (const following of ['text', '# next']) {
            const source =
              lines.map((line, i) => `${i ? continuation : prefix}${line}${newline}`).join('') +
              `${continuation}${following}${newline}`;
            writeFileSync(input, source);
            const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
              cwd: repositoryRoot,
              encoding: 'utf8',
              timeout: 10_000,
            });
            expect(tree, source).not.toMatch(/ERROR|MISSING/);
            const block = new RegExp(`\\(${kind} \\[0, \\d+\\] - \\[(\\d+), (\\d+)\\]`).exec(tree);
            expect(block, source).not.toBeNull();
            expect(block?.slice(1), source).toEqual([String(lines.length), '0']);
            const next = following === 'text' ? 'paragraph' : 'atx_heading';
            expect(tree, source).toMatch(new RegExp(`\\(${next} \\[${lines.length}, ${continuation.length}\\]`));
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
