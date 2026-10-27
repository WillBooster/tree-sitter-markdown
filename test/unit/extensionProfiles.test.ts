import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const extensionVariables = [
  'ALL_EXTENSIONS',
  'EXTENSION_GFM',
  'EXTENSION_TASK_LIST',
  'EXTENSION_STRIKETHROUGH',
  'EXTENSION_PIPE_TABLE',
  'EXTENSION_MINUS_METADATA',
  'EXTENSION_PLUS_METADATA',
  'EXTENSION_TAGS',
  'EXTENSION_LATEX',
  'EXTENSION_WIKI_LINK',
];

test('generates an inline parser without default extensions and parses literal tildes', { timeout: 120_000 }, () => {
  const cli = execFileSync(path.join(root, 'script/tree-sitter'), ['--print-path'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const workspace = fs.mkdtempSync(path.join(root, '.tmp/extension-profile-'));
  try {
    fs.cpSync(path.join(root, 'common'), path.join(workspace, 'common'), { recursive: true });
    const grammar = path.join(workspace, 'tree-sitter-markdown-inline');
    fs.cpSync(path.join(root, 'tree-sitter-markdown-inline'), grammar, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, NO_DEFAULT_EXTENSIONS: '1' };
    for (const name of extensionVariables) delete env[name];
    execFileSync(cli, ['generate', path.join(grammar, 'grammar.js')], { cwd: root, env });
    const library = path.join(workspace, `markdown_inline.${process.platform === 'darwin' ? 'dylib' : 'so'}`);
    execFileSync(cli, ['build', '--output', library, grammar], { cwd: root });
    const input = path.join(workspace, 'input.md');
    fs.writeFileSync(input, '~a~ ~~b~~ $c$ *d* `~e~`\n');
    const output = execFileSync(cli, ['parse', '--lib-path', library, '--lang-name', 'markdown_inline', input], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('(emphasis ');
    expect(output).toContain('(code_span ');
    expect(output).not.toMatch(/\((?:strikethrough|latex_block|ERROR|MISSING)\b/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
