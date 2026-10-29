import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

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

for (const [domain, valid] of [
  ['x'.repeat(63), true],
  ['x'.repeat(64), false],
  ['x'.repeat(63) + '.y', true],
  ['x.' + 'y'.repeat(64), false],
  ['x' + '-'.repeat(61) + 'x', true],
  ['x' + '-'.repeat(62) + 'x', false],
] as const) {
  test(`email label boundaries preserve delimiters: ${domain}`, () => {
    const source = '*<a*b@' + domain + '>';
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(query.captures(tree.rootNode).map(({ node }) => [node.type, node.startIndex, node.endIndex])).toEqual(
        valid ? [['email_autolink', 1, source.length]] : [['emphasis', 0, 4]]
      );
    } finally {
      tree.delete();
    }
  });
}

test('an email label at and past its limit parses without errors', () => {
  const source = '*<a*b@' + 'x'.repeat(63) + '>';
  const end = source.indexOf('>');
  const changed = source.slice(0, end) + 'x' + source.slice(end);
  for (const text of [source, changed]) {
    const tree = parser.parse(text)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      if (text === changed) {
        expect(tree.rootNode.descendantsOfType('emphasis').map((node) => node.text)).toEqual(['*<a*']);
      }
    } finally {
      tree.delete();
    }
  }
});

test('an impossible tag and the unquoted attribute it becomes parse without errors', () => {
  const source = '*<a ~>*~ [ok](target) **tail**';
  const changed = source.slice(0, 4) + 'x=' + source.slice(4);
  for (const text of [source, changed]) {
    const tree = parser.parse(text)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      if (text === changed) {
        expect(tree.rootNode.descendantsOfType('html_tag').map((node) => node.text)).toEqual(['<a x=~>']);
      }
    } finally {
      tree.delete();
    }
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

for (const marker of ['!', '?']) {
  test(`unfinished special angle prefixes preserve escaped delimiters: ${marker}`, () => {
    const source = `*<${marker}x \\* *a*`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('backslash_escape').map((node) => node.text)).toEqual([String.raw`\*`]);
      expect(query.captures(tree.rootNode).map(({ node }) => [node.text, node.startIndex, node.endIndex])).toEqual([
        ['*a*', 8, 11],
      ]);
      expectParsesWithoutErrors(source.slice(0, 2) + 'a' + source.slice(3));
    } finally {
      tree.delete();
    }
  });

  test(`unfinished special angle prefixes preserve following links: ${marker}`, () => {
    const source = `*<${marker}x [a*](u)`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(
        tree.rootNode.descendantsOfType('inline_link').map((node) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([['[a*](u)', 5, 12]]);
      expect(tree.rootNode.descendantsOfType('link_destination').map((node) => node.text)).toEqual(['u']);
      expect(query.captures(tree.rootNode)).toHaveLength(0);
      expectParsesWithoutErrors(source.slice(0, 2) + 'a' + source.slice(3));
    } finally {
      tree.delete();
    }
  });

  test(`unfinished special angle prefixes preserve the enclosing link: ${marker}`, () => {
    const source = `[*<${marker}x](u)*`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(
        tree.rootNode.descendantsOfType('inline_link').map((node) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([[source.slice(0, -1), 0, source.length - 1]]);
      expect(tree.rootNode.descendantsOfType('link_destination').map((node) => node.text)).toEqual(['u']);
      expect(query.captures(tree.rootNode)).toHaveLength(0);
      expectParsesWithoutErrors(source.slice(0, 3) + 'a' + source.slice(4));
    } finally {
      tree.delete();
    }
  });
}

test('a tag with and without a quote parses without errors', () => {
  const source = '*<a title="*">*.* [ok](target)';
  const quote = source.indexOf('"');
  expectParsesWithoutErrors(source);
  expectParsesWithoutErrors(source.slice(0, quote) + source.slice(quote + 1));
});

function expectParsesWithoutErrors(source: string): void {
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
  }
}
