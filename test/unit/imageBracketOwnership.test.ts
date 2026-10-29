import path from 'node:path';

import { Edit, Language, type Node, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser();
const language = await Language.load(path.resolve(import.meta.dirname, '../../tree-sitter-markdown_inline.wasm'));
parser.setLanguage(language);
const query = new Query(
  language,
  '[(image) (inline_link) (full_reference_link) (shortcut_link) (emphasis) (strikethrough)] @node'
);
afterAll(() => {
  query.delete();
  parser.delete();
});

for (const [source, expected] of [
  [
    '![a [b](x(y[)) c](u)',
    [
      ['image', '![a [b](x(y[)) c](u)', 0, 20],
      ['inline_link', '[b](x(y[))', 4, 14],
    ],
  ],
  ['![![([]](', []],
  [
    '![a [b](x[) c](u)',
    [
      ['image', '![a [b](x[) c](u)', 0, 17],
      ['inline_link', '[b](x[)', 4, 11],
    ],
  ],
  ['![![[]](', []],
  [
    '![~~![~~[b]',
    [
      ['strikethrough', '~~![~~', 2, 8],
      ['shortcut_link', '[b]', 8, 11],
    ],
  ],
  ['![`[`](u)', [['image', '![`[`](u)', 0, 9]]],
  ['![<i x="[">](u)', [['image', '![<i x="[">](u)', 0, 15]]],
  ['[![[a](', [['shortcut_link', '[a]', 3, 6]]],
  ['_![[_](', [['shortcut_link', '[_]', 3, 6]]],
  ['[![[.](', [['shortcut_link', '[.]', 3, 6]]],
  ['![a [ ][r] b]', [['full_reference_link', '[ ][r]', 4, 10]]],
  ['![a [ ][r](x) b]', [['full_reference_link', '[ ][r]', 4, 10]]],
  [
    '![a [ ][r] b](x)',
    [
      ['image', '![a [ ][r] b](x)', 0, 16],
      ['full_reference_link', '[ ][r]', 4, 10],
    ],
  ],
  [
    '![a [ ][r] b][ref]',
    [
      ['image', '![a [ ][r] b][ref]', 0, 18],
      ['full_reference_link', '[ ][r]', 4, 10],
    ],
  ],
  [
    '[a [] ![b] c](x)',
    [
      ['inline_link', '[a [] ![b] c](x)', 0, 16],
      ['image', '![b]', 6, 10],
    ],
  ],
  [
    '![[[foo](uri1)](uri2)](uri3)',
    [
      ['image', '![[[foo](uri1)](uri2)](uri3)', 0, 28],
      ['inline_link', '[foo](uri1)', 3, 14],
    ],
  ],
  [String.raw`![a \[ b](v)`, [['image', String.raw`![a \[ b](v)`, 0, 12]]],
  ['![a [x b](v)', [['inline_link', '[x b](v)', 4, 12]]],
  [
    '![~~[a](u)~~](v)',
    [
      ['image', '![~~[a](u)~~](v)', 0, 16],
      ['strikethrough', '~~[a](u)~~', 2, 12],
      ['inline_link', '[a](u)', 4, 10],
    ],
  ],
  [
    '![~~[a](u)![b]~~](v)',
    [
      ['image', '![~~[a](u)![b]~~](v)', 0, 20],
      ['strikethrough', '~~[a](u)![b]~~', 2, 16],
      ['inline_link', '[a](u)', 4, 10],
      ['image', '![b]', 10, 14],
    ],
  ],
  [
    '![_a [x] b_](y)',
    [
      ['image', '![_a [x] b_](y)', 0, 15],
      ['emphasis', '_a [x] b_', 2, 11],
      ['shortcut_link', '[x]', 5, 8],
    ],
  ],
  [
    '![*a [b [c]* d] e](f)',
    [
      ['image', '![*a [b [c]* d] e](f)', 0, 21],
      ['emphasis', '*a [b [c]*', 2, 12],
      ['shortcut_link', '[c]', 8, 11],
    ],
  ],
  ['*![a [] b*]', [['emphasis', '*![a [] b*', 0, 10]]],
  ['~![a [] b~]', [['strikethrough', '~![a [] b~', 0, 10]]],
  ['[outer ![[] [inner](u)] end](v)', [['inline_link', '[inner](u)', 12, 22]]],
  ['[a ![b [] c] d](u)', [['inline_link', '[a ![b [] c] d](u)', 0, 18]]],
  ['~![[![](~', [['strikethrough', '~![[![](~', 0, 9]]],
  ['[![~[](]~', []],
  [
    '[![[[]![x](]]',
    [
      ['image', '![[[]![x](]]', 1, 13],
      ['image', '![x]', 6, 10],
    ],
  ],
  ['![![[]](<', []],
  ['![![[]](x[', []],
  ['![![[]](x`', []],
  ['![![[]](x$', []],
  ['![![[]](x ![', []],
  ['![<`a>`]a>`', []],
  [
    '~a [b] c~d~',
    [
      ['strikethrough', '~a [b] c~', 0, 9],
      ['shortcut_link', '[b]', 3, 6],
    ],
  ],
] as const) {
  test(`image brackets retain their owners: ${source}`, () => {
    let tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(captures(tree)).toEqual(expected);
      const original = snapshot(tree.rootNode);
      for (let start = 0; start < source.length; start++) {
        if (source[start] !== '[' && source[start] !== ']') continue;
        const changed = source.slice(0, start) + source.slice(start + 1);
        tree = edit(tree, changed, start, 1, 0);
        tree = edit(tree, source, start, 0, 1);
        expect(snapshot(tree.rootNode)).toEqual(original);
        expect(captures(tree)).toEqual(expected);
      }
    } finally {
      tree.delete();
    }
  });
}

// `i` nests an image and `p` a link at each level; alternating owners exceed the scanner's tracked owner runs.
for (const [pattern, depth] of [
  ['i', 256],
  ['i', 600],
  ['ip', 200],
  ['ppi', 200],
] as const) {
  test(`nested images stay recognized beyond the tracked bracket owners: ${pattern} x ${depth}`, () => {
    const source = wrap(pattern, depth);
    const images = Array.from({ length: depth }, (_, level) => pattern[level % pattern.length]).filter(
      (kind) => kind === 'i'
    ).length;
    let tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('image')).toHaveLength(images);
      const leaf = source.indexOf('leaf');
      tree = edit(tree, source.slice(0, leaf) + source.slice(leaf + 1), leaf, 1, 0);
      tree = edit(tree, source, leaf, 0, 1);
      expect(tree.rootNode.descendantsOfType('image')).toHaveLength(images);
    } finally {
      tree.delete();
    }
  });
}

test('an unfinished nested image stays text beyond the scanner lookahead', () => {
  const tree = parser.parse(`![![[]](x${'a'.repeat(1030)}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(captures(tree)).toEqual([]);
  } finally {
    tree.delete();
  }
});

function wrap(pattern: string, depth: number): string {
  let text = 'leaf';
  for (let level = depth - 1; level >= 0; level--) {
    text = pattern[level % pattern.length] === 'i' ? `![${text}](u)` : `[${text}](v)`;
  }
  return text;
}

function captures(tree: Tree): unknown[] {
  return query.captures(tree.rootNode).map(({ node }) => [node.type, node.text, node.startIndex, node.endIndex]);
}

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
