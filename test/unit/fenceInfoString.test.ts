import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser();
const language = await Language.load(path.resolve(import.meta.dirname, '../../tree-sitter-markdown.wasm'));
parser.setLanguage(language);
afterAll(() => parser.delete());

test('queries distinguish fences with and without an info string', () => {
  const source = '```ts extra\ncode\n```\n\n~~~\nplain\n~~~\n\n> ~~~ js\n> nested\n> ~~~\n';
  const tree = parser.parse(source)!;
  const specified = new Query(language, '(fenced_code_block info_string: (info_string) @info)');
  const unspecified = new Query(language, '(fenced_code_block !info_string) @plain');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(specified.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(['ts extra', 'js']);
    expect(unspecified.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(['~~~\nplain\n~~~\n']);
    expect(
      tree.rootNode.descendantsOfType('fenced_code_block').map((node) => node.childForFieldName('info_string')?.text)
    ).toEqual(['ts extra', undefined, 'js']);
  } finally {
    specified.delete();
    unspecified.delete();
    tree.delete();
  }
});
