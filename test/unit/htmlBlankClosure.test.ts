import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

test('a blank line closes an HTML block within its surrounding container', () => {
  const cli = execFileSync(path.join(repositoryRoot, 'script/tree-sitter'), ['--print-path'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
  mkdirSync(path.join(repositoryRoot, '.tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(repositoryRoot, '.tmp/html-blank-close-'));
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
    for (const tag of ['div', 'custom']) {
      for (const [prefix, continuation] of [
        ['', ''],
        ['> ', '> '],
        ['> > ', '> > '],
        ['- ', '  '],
      ] as const) {
        for (const padding of ['', ' ', '\t']) {
          for (const newline of ['\n', '\r\n']) {
            for (const following of ['after', '# heading']) {
              const first = `${prefix}<${tag}>${newline}`;
              const blank = `${continuation}${padding}${newline}`;
              const rest = `${continuation}${following}${newline}`;
              const source = first + blank + rest;
              const tree = parse(source);
              const kind = following === 'after' ? 'paragraph' : 'atx_heading';
              expect([...tree.matchAll(new RegExp(`\\(${kind} \\[`, 'g'))], source).toHaveLength(1);
              expect([...tree.matchAll(/\(html_block \[/g)], source).toHaveLength(1);
              expect([...tree.matchAll(/\(block_quote \[/g)], source).toHaveLength([...prefix.matchAll(/>/g)].length);
              expect([...tree.matchAll(/\(list_item \[/g)], source).toHaveLength(prefix === '- ' ? 1 : 0);
              const ancestors: { depth: number; kind: string }[] = [];
              for (const line of tree.split('\n')) {
                const node = line.match(/^( *)(?:\w+: )?\((\w+) \[/);
                if (!node) continue;
                const depth = node[1]!.length;
                while (ancestors.length > 0 && ancestors.at(-1)!.depth >= depth) ancestors.pop();
                if (node[2] === kind) {
                  expect(
                    ancestors.filter((parent) => parent.kind === 'block_quote'),
                    source
                  ).toHaveLength([...prefix.matchAll(/>/g)].length);
                  expect(
                    ancestors.filter((parent) => parent.kind === 'list_item'),
                    source
                  ).toHaveLength(prefix === '- ' ? 1 : 0);
                }
                ancestors.push({ depth, kind: node[2]! });
              }
              const removed = first + rest;
              const fresh = parse(removed);
              expect(fresh, source).not.toMatch(/\((paragraph|atx_heading) \[/);
              const at = Buffer.byteLength(first);
              const length = Buffer.byteLength(blank);
              expect(parse(source, [`${at} ${length} `]), source).toBe(fresh);
              expect(parse(source, [`${at} ${length} `, `${at} 0 ${blank}`]), source).toBe(tree);
            }
          }
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
