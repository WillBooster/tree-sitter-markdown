import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('link destinations expose their contents without surrounding angle brackets', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/link-ranges-'));
  const cli = path.join(repositoryRoot, 'script/tree-sitter');
  const input = path.join(directory, 'input.md');
  const destinations = ['https://example.com', 'café/file', 'a b', String.raw`a\>b`, 'a&amp;b', ''];
  try {
    for (const grammar of ['markdown', 'markdown_inline']) {
      const library = path.join(directory, `${grammar}.dylib`);
      execFileSync(
        cli,
        ['build', grammar === 'markdown' ? 'tree-sitter-markdown' : 'tree-sitter-markdown-inline', '-o', library],
        {
          cwd: repositoryRoot,
          timeout: 60_000,
        }
      );
      for (const kind of grammar === 'markdown' ? ['link_reference_definition'] : ['inline_link', 'image']) {
        for (const destination of destinations) {
          for (const newline of ['', '\n', '\r\n']) {
            const source = `${kind === 'link_reference_definition' ? `[label]: <${destination}>` : `${kind === 'image' ? '!' : ''}[label](<${destination}>)`}${newline}`;
            writeFileSync(input, source);
            const tree = execFileSync(cli, ['parse', '--lib-path', library, '--lang-name', grammar, input], {
              cwd: repositoryRoot,
              encoding: 'utf8',
              timeout: 10_000,
            });
            expect(tree, source).not.toMatch(/ERROR|MISSING/);
            expect(tree, source).toContain(`(${kind} `);
            const match = /\(link_destination \[0, (\d+)\] - \[0, (\d+)\]/.exec(tree);
            if (destination === '') {
              expect(match, source).toBeNull();
            } else {
              expect(match, source).not.toBeNull();
              expect(Buffer.from(source).subarray(Number(match?.[1]), Number(match?.[2])).toString(), source).toBe(
                destination
              );
            }
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
