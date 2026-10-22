import { afterAll, expect, test } from 'vitest';
import path from 'node:path';

import { Edit, Language, type Node, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';

const Root = path.resolve(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(Root, 'tree-sitter-markdown_inline.wasm'));
const parser = new Parser();
parser.setLanguage(language);
const query = new Query(language, '[(emphasis) (strikethrough) (html_tag) (uri_autolink) (email_autolink)] @markup');
afterAll(() => {
  query.delete();
  parser.delete();
});

for (const source of [
  '*<a ~>*~',
  '*</a ~>*~',
  '*<a /~>*~',
  '*<a x="v"~>*~',
  '*<ht:bad space~>*~',
  '*<m:~>*~',
  '*<a@~>*~',
  '*<a x="~>*~',
]) {
  test(`impossible angle prefix stays emphasis: ${source}`, () => {
    const following = ' [ok](target) **tail**';
    const tree = parser.parse(source + following)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(query.captures(tree.rootNode).map(({ node }) => [node.type, node.startIndex, node.endIndex])).toEqual([
        ['emphasis', 0, source.length - 1],
      ]);
      expect(tree.rootNode.descendantsOfType('inline_link').map((node) => node.text)).toEqual(['[ok](target)']);
      expect(tree.rootNode.descendantsOfType('strong_emphasis').map((node) => node.text)).toEqual(['**tail**']);
    } finally {
      tree.delete();
    }
  });
}

for (const [source, type, content] of [
  ['*<a title="~>*">x</a>*~', 'html_tag', '<a title="~>*">'],
  ["*<a title='~>*'>x</a>*~", 'html_tag', "<a title='~>*'>"],
  ['*<a disabled title=~>*~', 'html_tag', '<a disabled title=~>'],
  ['*<a title=é>*~', 'html_tag', '<a title=é>'],
  ['*<a _flag data:x = "~>*" />x*~', 'html_tag', '<a _flag data:x = "~>*" />'],
  ['*<http:~>*~', 'uri_autolink', '<http:~>'],
  ['*<a+b:~>*~', 'uri_autolink', '<a+b:~>'],
  ['*<a@b.c>*~', 'email_autolink', '<a@b.c>'],
  ['*<a*b@c.d>*~', 'email_autolink', '<a*b@c.d>'],
] as const) {
  test(`possible angle prefix keeps its contents protected: ${source}`, () => {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('strikethrough')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('emphasis').map((node) => node.text)).toEqual([source.slice(0, -1)]);
      expect(tree.rootNode.descendantsOfType(type).map((node) => node.text)).toContain(content);
    } finally {
      tree.delete();
    }
  });
}

for (const [source, type, content] of [
  ['*<b>*.*', 'emphasis', '*<b>*'],
  ['**<b>**.**', 'strong_emphasis', '**<b>**'],
  ['*<br>*.*', 'emphasis', '*<br>*'],
  ['*<a title="~>*">x</a>*.*', 'emphasis', '*<a title="~>*">x</a>*'],
  ['*<http:*foo*>*.*', 'emphasis', '*<http:*foo*>*'],
  ['*<a*b@c.d>*.*', 'emphasis', '*<a*b@c.d>*'],
] as const) {
  test(`complete angle construct is atomic: ${source}`, () => {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType(type).map((node) => [node.text, node.startIndex, node.endIndex])).toEqual([
        [content, 0, content.length],
      ]);
      expect(tree.rootNode.descendantsOfType('strikethrough')).toHaveLength(0);
    } finally {
      tree.delete();
    }
  });
}

for (const source of [
  '*<a title="*">',
  '*<a title="_~">',
  '*<http:*>',
  '*<a*b@c.d>',
  String.raw`*<a x="a\" y="*">`,
  String.raw`*<a x="\" y="~*">`,
  '*<a x=[ y="*">',
]) {
  test(`delimiters inside an atomic construct do not certify an unclosed opener: ${source}`, () => {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType(['emphasis', 'strong_emphasis', 'strikethrough'])).toHaveLength(0);
      expect(tree.rootNode.namedChildCount).toBe(1);
      expect(tree.rootNode.namedChild(0)?.text).toBe(source.slice(1));
    } finally {
      tree.delete();
    }
  });
}

test('editing an impossible tag into an unquoted attribute and undoing preserves full trees and ranges', () => {
  const source = '*<a ~>*~ [ok](target) **tail**';
  let tree = parser.parse(source)!;
  try {
    const original = snapshot(tree.rootNode);
    const changed = source.slice(0, 4) + 'x=' + source.slice(4);
    tree = edit(tree, changed, 4, 0, 2);
    expect(tree.rootNode.descendantsOfType('html_tag').map((node) => node.text)).toEqual(['<a x=~>']);
    tree = edit(tree, source, 4, 2, 0);
    expect(snapshot(tree.rootNode)).toEqual(original);
  } finally {
    tree.delete();
  }
});

test('HTML quote boundaries keep bracket lookahead from losing an inline link', () => {
  const source = '[<a x="a\\" y="`">](u) `';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('inline_link').map((node) => node.text)).toEqual([source.slice(0, -2)]);
    expect(tree.rootNode.descendantsOfType('link_destination').map((node) => node.text)).toEqual(['u']);
    expect(tree.rootNode.descendantsOfType('html_tag').map((node) => node.text)).toEqual([source.slice(1, -6)]);
  } finally {
    tree.delete();
  }
});

test('removing a quote from a tag and undoing agrees with fresh parsing', () => {
  const source = '*<a title="*">*.* [ok](target)';
  const quote = source.indexOf('"');
  let tree = parser.parse(source)!;
  try {
    const original = snapshot(tree.rootNode);
    const changed = source.slice(0, quote) + source.slice(quote + 1);
    tree = edit(tree, changed, quote, 1, 0);
    tree = edit(tree, source, quote, 0, 1);
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
