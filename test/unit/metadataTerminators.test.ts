import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
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

test('YAML metadata with a document-end marker or a longer dot run parses without errors', () => {
  const source = '---\ntitle: example\n...\n\nbody\n';
  for (const text of [source, source.replace('...', '....')]) {
    const tree = parser.parse(text)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      if (text === source) expect(tree.rootNode.descendantsOfType('minus_metadata')).toHaveLength(1);
    } finally {
      tree.delete();
    }
  }
});
