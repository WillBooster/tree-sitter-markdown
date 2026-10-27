import path from 'node:path';

import { Edit, Language, type Node, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(path.resolve(import.meta.dirname, '../../tree-sitter-markdown_inline.wasm')));
afterAll(() => parser.delete());

for (const unit of ['**a*.[', '**a*.[x]', '**a*[', '**a*.<']) {
  test(`partial runs retain their emphasis across proof windows: ${unit}`, () => {
    const tree = parser.parse(unit.repeat(2000))!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const emphasis = tree.rootNode.descendantsOfType('emphasis');
      expect(emphasis).toHaveLength(2000);
      expect(emphasis.every((node) => node.text === '*a*')).toBe(true);
    } finally {
      tree.delete();
    }
  });
}

test('single-backtick spans retain their delimiter ownership across proof windows', () => {
  const unit = '**`* ';
  const source = unit.repeat(2000);
  let tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const spans = tree.rootNode.descendantsOfType('code_span');
    const emphasis = tree.rootNode.descendantsOfType('emphasis');
    expect(spans).toHaveLength(1000);
    expect(spans.every((node) => node.text === '`* **`')).toBe(true);
    expect(emphasis).toHaveLength(1000);
    expect(emphasis.every((node) => node.text === '*`* **`*')).toBe(true);
    tree = edit(tree, source.slice(0, -unit.length), source.length - unit.length, unit.length, 0);
    tree = edit(tree, source, source.length - unit.length, 0, unit.length);
  } finally {
    tree.delete();
  }
});

for (const prefix of ['**a*.[', '**a*.['.repeat(300)]) {
  test(`distant closers preserve partially matched emphasis owners: ${prefix.length}`, () => {
    const source = `${prefix}${'x'.repeat(2000)}*`;
    let tree = parser.parse(source)!;
    try {
      const emphasis = tree.rootNode.descendantsOfType('emphasis');
      expect(emphasis[0]?.text).toBe(source);
      expect(emphasis[1]?.text).toBe('*a*');
      tree = edit(tree, source.slice(0, -1), source.length - 1, 1, 0);
      tree = edit(tree, source, source.length - 1, 0, 1);
      expect(tree.rootNode.descendantsOfType('emphasis')[0]?.text).toBe(source);
    } finally {
      tree.delete();
    }
  });
}

for (const prefixLength of [1019, 1020]) {
  for (const atom of ['<b>', '<http:x>', '<a title="*">']) {
    test(`valid angle atoms straddling the proof boundary keep their owner: ${prefixLength}, ${atom}`, () => {
      const source = `**a*.${'x'.repeat(prefixLength)}${atom}*`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.descendantsOfType('emphasis').map((node) => node.text)).toEqual([source, '*a*']);
        expect(
          tree.rootNode.descendantsOfType(atom === '<http:x>' ? 'uri_autolink' : 'html_tag').map((node) => node.text)
        ).toEqual([atom]);
      } finally {
        tree.delete();
      }
    });
  }
}

test('adding and removing a closing bracket invalidates cached absence', () => {
  const source = '**a*.['.repeat(300);
  let tree = parser.parse(source)!;
  try {
    const original = snapshot(tree.rootNode);
    tree = edit(tree, `${source}]`, source.length, 0, 1);
    tree = edit(tree, source, source.length, 1, 0);
    expect(snapshot(tree.rootNode)).toEqual(original);
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
      startPosition: { row: 0, column: start },
      oldEndPosition: { row: 0, column: start + removed },
      newEndPosition: { row: 0, column: start + inserted },
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
