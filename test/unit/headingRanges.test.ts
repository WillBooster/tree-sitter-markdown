import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('heading ranges exclude closing syntax and following container prefixes', () => {
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/heading-ranges-'));
  const library = path.join(directory, 'markdown.dylib');
  const input = path.join(directory, 'input.md');
  const cli = path.join(repositoryRoot, 'script/tree-sitter');
  const cases = [
    { heading: '## go ##', content: 'go' },
    { heading: '# foo   ', content: 'foo' },
    { heading: '# foo\t ', content: 'foo' },
    { heading: '#   ', content: undefined },
    { heading: '# \t', content: undefined },
    { heading: '## go#', content: 'go#' },
    { heading: '### foo ### b', content: 'foo ### b' },
    { heading: '# foo # ##', content: 'foo #' },
    { heading: '# foo \\###', content: 'foo \\###' },
    { heading: '# café\t###\t', content: 'café' },
    { heading: '# ###', content: undefined },
    { heading: '#   ###', content: undefined },
  ];
  try {
    execFileSync(cli, ['build', 'tree-sitter-markdown', '-o', library], { cwd: repositoryRoot, timeout: 60_000 });
    for (const { heading, content } of cases) {
      for (const prefix of ['', '> ', '- ']) {
        for (const newline of ['', '\n', '\r\n']) {
          const source = `${prefix}${heading}${newline}`;
          writeFileSync(input, source);
          const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(tree, source).not.toMatch(/ERROR|MISSING/);
          const match = /heading_content: \(inline \[0, (\d+)\] - \[0, (\d+)\]/.exec(tree);
          if (content === undefined) {
            expect(match, source).toBeNull();
          } else {
            expect(match, source).not.toBeNull();
            const bytes = Buffer.from(source);
            expect(bytes.subarray(Number(match?.[1]), Number(match?.[2])).toString(), source).toBe(content);
          }
        }
      }
    }
    for (let level = 1; level <= 6; level++) {
      for (const [prefix, continuation] of [
        ['> ', '> '],
        ['> > ', '> > '],
        ['- ', '  '],
      ]) {
        for (const newline of ['\n', '\r\n']) {
          for (const following of ['text', '# next']) {
            const source = `${prefix}${'#'.repeat(level)} heading${newline}${continuation}${following}${newline}`;
            writeFileSync(input, source);
            const tree = execFileSync(cli, ['parse', '-l', library, '--lang-name', 'markdown', input], {
              cwd: repositoryRoot,
              encoding: 'utf8',
              timeout: 10_000,
            });
            expect(tree, source).not.toMatch(/ERROR|MISSING/);
            const heading = /\(atx_heading \[0, \d+\] - \[(\d+), (\d+)\]/.exec(tree);
            expect(heading, source).not.toBeNull();
            expect(heading?.slice(1), source).toEqual(['1', '0']);
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
