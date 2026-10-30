import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser();
const language = await Language.load(path.resolve(import.meta.dirname, '../../tree-sitter-markdown.wasm'));
parser.setLanguage(language);
afterAll(() => parser.delete());

test('exposes the info string field only on fences that specify one', () => {
  const source = '```ts extra\ncode\n```\n\n~~~\nplain\n~~~\n\n> ~~~ js\n> nested\n> ~~~\n';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      tree.rootNode.descendantsOfType('fenced_code_block').map((node) => node.childForFieldName('info_string')?.text)
    ).toEqual(['ts extra', undefined, 'js']);
  } finally {
    tree.delete();
  }
});
