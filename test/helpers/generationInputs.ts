import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { Grammar } from './grammars.js';

// Returns the latest modification time of the inputs from which script/generate generates the grammar's src/.
export function generationInputMtime(root: string, grammar: Grammar): number {
  const corpus = path.join(root, grammar, 'test/corpus');
  const examples = execFileSync('git', ['ls-files', '-z', '--', 'examples'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const recordedPath = path.join(root, '.tmp/generation-profiles/examples.z');
  if (!fs.existsSync(recordedPath)) {
    throw new Error('Generation inputs have not been recorded; run `bun run build/ci`');
  }
  const recordedExamples = fs.readFileSync(recordedPath, 'utf8');
  if (examples.join('\0') + (examples.length > 0 ? '\0' : '') !== recordedExamples) {
    throw new Error('Git-tracked generation examples changed; run `bun run build/ci`');
  }
  const inputs = [
    path.join(root, 'tree-sitter.json'),
    path.join(root, 'common/common.js'),
    path.join(root, 'common/html_entities.json'),
    path.join(root, grammar, 'grammar.js'),
    // The inline grammar reads its Unicode punctuation from the scanner's header.
    ...(grammar === 'tree-sitter-markdown-inline' ? [path.join(root, grammar, 'src/unicode_punctuation.h')] : []),
    corpus,
    ...fs.readdirSync(corpus, { recursive: true, encoding: 'utf8' }).map((file) => path.join(corpus, file)),
    ...examples.map((file) => path.join(root, file)),
  ];
  return Math.max(
    ...inputs.map((file) => {
      try {
        return fs.statSync(file).mtimeMs;
      } catch (error) {
        throw Object.assign(
          new Error(
            `Cannot read generation input ${path.relative(root, file)}; restore it or stage removed examples, then run \`bun run build/ci\``
          ),
          { cause: error }
        );
      }
    })
  );
}
