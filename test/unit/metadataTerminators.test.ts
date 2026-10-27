import path from 'node:path';

import { Edit, Language, type Node, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(path.resolve(import.meta.dirname, '../../tree-sitter-markdown.wasm')));
afterAll(() => parser.delete());

for (const delimiter of ['---', '...']) {
  for (const ending of ['\n', '\r\n', '']) {
    test(`YAML metadata closes at ${delimiter} with ${JSON.stringify(ending)}`, () => {
      const metadata = `---\ntitle: example\n${delimiter} \t${ending}`;
      const source = `${metadata}${ending ? '\nbody\n' : ''}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.descendantsOfType('minus_metadata').map((node) => node.text)).toEqual([metadata]);
        expect(tree.rootNode.descendantsOfType('paragraph').map((node) => node.text)).toEqual(ending ? ['body\n'] : []);
      } finally {
        tree.delete();
      }
    });
  }
}

for (const invalid of ['.', '..', '....', '.-.', '...x', '---x', ' ...', '\t...']) {
  test(`YAML metadata does not close at ${JSON.stringify(invalid)}`, () => {
    const metadata = `---\ntitle: example\n${invalid}\nmore: content\n---\n`;
    const tree = parser.parse(`${metadata}\nbody\n`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('minus_metadata').map((node) => node.text)).toEqual([metadata]);
      expect(tree.rootNode.descendantsOfType('paragraph').map((node) => node.text)).toEqual(['body\n']);
    } finally {
      tree.delete();
    }
  });
}

test('editing a YAML document-end marker keeps incremental and fresh trees equal', () => {
  const source = '---\ntitle: example\n...\n\nbody\n';
  const start = source.indexOf('...');
  let tree = parser.parse(source)!;
  try {
    tree = edit(tree, source.replace('...', '....'), start, 3, 4);
    tree = edit(tree, source, start, 4, 3);
    expect(tree.rootNode.descendantsOfType('minus_metadata')).toHaveLength(1);
  } finally {
    tree.delete();
  }
});

function edit(previous: Tree, source: string, start: number, removed: number, inserted: number): Tree {
  previous.edit(
    new Edit({
      startIndex: start,
      oldEndIndex: start + removed,
      newEndIndex: start + inserted,
      startPosition: { row: 2, column: 0 },
      oldEndPosition: { row: 2, column: removed },
      newEndPosition: { row: 2, column: inserted },
    })
  );
  const incremental = parser.parse(source, previous)!;
  const fresh = parser.parse(source)!;
  try {
    expect(incremental.rootNode.hasError).toBe(false);
    expect(snapshot(incremental.rootNode)).toEqual(snapshot(fresh.rootNode));
  } finally {
    previous.delete();
    fresh.delete();
  }
  return incremental;
}

function snapshot(node: Node): unknown[] {
  return [node.type, node.startIndex, node.endIndex, node.isMissing, node.children.map(snapshot)];
}
