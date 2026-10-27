import path from 'node:path';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.resolve(import.meta.dirname, '../../tree-sitter-markdown_inline.wasm'));
const parser = new Parser();
parser.setLanguage(language);
const query = new Query(language, '(autolink_delimiter) @delimiter');
afterAll(() => {
  query.delete();
  parser.delete();
});

for (const [type, atom] of [
  ['uri_autolink', '<https://example.com/a?b=c>'],
  ['uri_autolink', '<ab:>'],
  ['uri_autolink', '<ab:*_~`$[x]😀\0>'],
  ['uri_autolink', `<${'a'.repeat(2048)}:x>`],
  ['email_autolink', '<foo.bar+tag@example.com>'],
  ['email_autolink', `<${'a'.repeat(5000)}@example.com>`],
  ['email_autolink', '<!a@b>'],
  ['email_autolink', `<x@${'a'.repeat(63)}.com>`],
] as const) {
  test(`queries both ${type} delimiters across its source range: ${atom.length}`, () => {
    const source = `😀 ${atom} tail`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const node = tree.rootNode.descendantsOfType(type)[0]!;
      expect(node.text).toBe(atom);
      expect(node.namedChildren.map((child) => child.type)).toEqual(['autolink_delimiter', 'autolink_delimiter']);
      expect(
        query
          .captures(tree.rootNode)
          .map(({ node: delimiter }) => [delimiter.text, delimiter.startIndex, delimiter.endIndex])
      ).toEqual([
        ['<', 3, 4],
        ['>', 3 + atom.length - 1, 3 + atom.length],
      ]);
    } finally {
      tree.delete();
    }
  });
}

for (const source of [
  '<http://foo.bar/baz bim>',
  '<a:foo>',
  '<http://unfinished',
  '<x@-example.com>',
  `<x@${'a'.repeat(64)}.com>`,
]) {
  test(`malformed autolinks retain their literal text path: ${source.length}`, () => {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType(['uri_autolink', 'email_autolink'])).toEqual([]);
      expect(query.captures(tree.rootNode)).toEqual([]);
    } finally {
      tree.delete();
    }
  });
}

test('editing the closing bracket invalidates the autolink opener and preserves query ranges', () => {
  const original = 'go <http:x> now';
  const start = original.indexOf('>');
  let tree = parser.parse(original)!;
  try {
    for (const [source, removed, inserted] of [
      [original.replace('>', ''), 1, 0],
      [original, 0, 1],
    ] as const) {
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + removed,
          newEndIndex: start + inserted,
          startPosition: { row: 0, column: start },
          oldEndPosition: { row: 0, column: start + removed },
          newEndPosition: { row: 0, column: start + inserted },
        })
      );
      const incremental = parser.parse(source, tree)!;
      const fresh = parser.parse(source)!;
      try {
        expect(incremental.rootNode.hasError).toBe(false);
        expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
        const captures = (value: typeof tree): unknown[][] =>
          query
            .captures(value.rootNode)
            .map(({ node }) => [node.text, node.startIndex, node.endIndex, node.startPosition, node.endPosition]);
        expect(captures(incremental)).toEqual(captures(fresh));
      } finally {
        tree.delete();
        fresh.delete();
      }
      tree = incremental;
    }
    expect(query.captures(tree.rootNode)).toHaveLength(2);
  } finally {
    tree.delete();
  }
});
