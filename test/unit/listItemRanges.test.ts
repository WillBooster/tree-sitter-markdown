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
  const cli = execFileSync(path.join(repositoryRoot, 'script/tree-sitter'), ['--print-path'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
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
    for (const first of ['-', '+', '*', '1.', '1)']) {
      for (const second of ['-', '+', '*', '1.', '1)']) {
        for (const container of ['> ', '> > ', '  ']) {
          const heading = container === '  ' ? '- outer\n' : '';
          const source = `${heading}${container}${first} a\n${container}${second} b\n`;
          const tree = parse(source);
          const expectedLists = (first === second ? 1 : 2) + (heading ? 1 : 0);
          expect([...tree.matchAll(/\(list \[/g)], source).toHaveLength(expectedLists);
          const row = heading ? 2 : 1;
          expect(tree, source).toContain(`(list_item [${row}, 0]`);
          const position = Buffer.byteLength(`${heading}${container}${first} a\n${container}`);
          const changed = `${heading}${container}${first} a\n${container}${first} b\n`;
          expect(parse(source, [`${position} ${second.length} ${first}`])).toBe(parse(changed));
          expect(
            parse(source, [`${position} ${second.length} ${first}`, `${position} ${first.length} ${second}`])
          ).toBe(tree);
        }
      }
    }
    for (const outer of ['-', '1.']) {
      for (const inner of ['-', '+', '*', '1.', '1)']) {
        for (const container of ['', '> ']) {
          for (const extra of [3, 4, 5]) {
            const prefix = `${container}${outer} a\n${container}\n${container}`;
            const indentation = ' '.repeat(outer.length + 1 + extra);
            const source = `${prefix}${indentation}${inner} b\n`;
            const tree = parse(source);
            expect([...tree.matchAll(/\(indented_code_block /g)], source).toHaveLength(extra >= 4 ? 1 : 0);
            expect([...tree.matchAll(/\(list_item /g)], source).toHaveLength(extra >= 4 ? 1 : 2);
            const position = Buffer.byteLength(prefix);
            expect(parse(source, [`${position} 0 ` + ' '])).toBe(parse(`${prefix} ${indentation}${inner} b\n`));
            expect(parse(source, [`${position} 0 ` + ' ', `${position} 1 `])).toBe(tree);
          }
        }
      }
    }
    for (const marker of ['-', '+', '*', '1.', '1)']) {
      for (const prefix of ['', '> ']) {
        for (const blanks of [1, 2, 3]) {
          for (const newline of ['\n', '\r\n']) {
            const start = `${prefix}${marker}${newline}`;
            const separator = `${prefix}${newline}`;
            const source = start + separator.repeat(blanks) + `${prefix}${marker} b${newline}`;
            const tree = parse(source);
            expect([...tree.matchAll(/\(list \[/g)], source).toHaveLength(1);
            expect([...tree.matchAll(/\(list_item \[/g)], source).toHaveLength(2);
            const position = Buffer.byteLength(start);
            const added = start + separator.repeat(blanks + 1) + `${prefix}${marker} b${newline}`;
            expect(parse(source, [`${position} 0 ${separator}`])).toBe(parse(added));
            expect(parse(source, [`${position} 0 ${separator}`, `${position} ${Buffer.byteLength(separator)} `])).toBe(
              tree
            );
          }
        }
      }
    }
    for (const preceding of [
      ['  ```', '  x', '  ```'],
      ['  ~~~', '  x', '  ~~~'],
      ['  > b'],
      ['  > > b'],
      ['', '      code'],
      ['  <!-- x -->'],
      ['  <script>x</script>'],
      ['  <div>', ''],
    ]) {
      for (const prefix of ['', '> ']) {
        for (const marker of ['-', '+', '*', '1.', '1)']) {
          for (const newline of ['\n', '\r\n']) {
            const lines = ['- a', ...preceding, `  ${marker} c`, `  ${marker} d`].map((line) => prefix + line);
            const source = lines.join(newline) + newline;
            const tree = parse(source);
            const row = preceding.length + 1;
            expect(tree, source).toContain(`(list_item [${row}, 0] - [${row + 1}, 0]`);
            const position = Buffer.byteLength(lines.slice(0, row).join(newline) + newline);
            const length = Buffer.byteLength(lines[row] + newline);
            const deleted = lines.filter((_, index) => index !== row).join(newline) + newline;
            expect(parse(source, [`${position} ${length} `])).toBe(parse(deleted));
            expect(parse(source, [`${position} ${length} `, `${position} 0 ${lines[row] + newline}`])).toBe(tree);
          }
        }
      }
    }
    for (const child of [
      ['  - b', '    > q'],
      ['  - b', '    > > q'],
      ['  - ```', '    x', '    ```'],
      ['  - ```', '    x'],
      ['  - b', '', '        code'],
      ['  - <div>'],
      ['  - <script>', '    x'],
    ]) {
      for (const prefix of ['', '> ']) {
        for (const newline of ['\n', '\r\n']) {
          const lines = ['- a', ...child, '  - d'].map((line) => prefix + line);
          const source = lines.join(newline) + newline;
          const tree = parse(source);
          const nextRow = lines.length - 1;
          expect(tree, source).toContain(`(list_item [1, 0] - [${nextRow}, 0]`);
          expect(tree, source).toContain(`(list_item [${nextRow}, 0]`);
          const start = Buffer.byteLength(lines[0] + newline);
          const removed = child.map((line) => prefix + line + newline).join('');
          const deleted = `${lines[0]}${newline}${lines[nextRow]}${newline}`;
          const deletion = `${start} ${Buffer.byteLength(removed)} `;
          expect(parse(source, [deletion])).toBe(parse(deleted));
          expect(parse(source, [deletion, `${start} 0 ${removed}`])).toBe(tree);
          expect([...parse(deleted).matchAll(/\(list_item /g)], source).toHaveLength(2);
        }
      }
    }
    for (const content of ['- a', '> - a', '- a\n  - b']) {
      for (const blankLines of [1, 2, 3]) {
        for (const padding of ['', ' ', '  ', '\t', ' \t ']) {
          const quotePrefix = content.startsWith('>') ? '> ' : '';
          const source = `${content}\n${`${quotePrefix}\n`.repeat(blankLines)}${quotePrefix}${padding}`;
          const tree = parse(source);
          expect(tree, source).not.toMatch(/^    \(paragraph /m);
          const position = Buffer.byteLength(source);
          expect(parse(source, [`${position} 0 ` + ' '])).toBe(parse(source + ' '));
          expect(parse(source, [`${position} 0 ` + ' ', `${position} 1 `])).toBe(tree);
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
