// wbfy:start oxfmt-base
import type { OxfmtConfig } from 'oxfmt';

// oxlint-disable unicorn/prefer-module -- Oxfmt config files are only auto-discovered as .ts, and CommonJS avoids ESM package loading issues.
const oxfmtConfig = require('@willbooster/oxfmt-config');

const oxfmtResolvedConfig: OxfmtConfig = oxfmtConfig.default ?? oxfmtConfig;
// wbfy:end oxfmt-base

// `tree-sitter generate` writes each grammar's src/ and `tree-sitter init` writes bindings/ in their own style. The
// grammar definitions and scanners keep upstream's style, so that `diff` against upstream shows only functional changes
// and a later upstream version replaces them.
oxfmtResolvedConfig.ignorePatterns = [
  ...(oxfmtResolvedConfig.ignorePatterns ?? []),
  'bindings/**',
  'common/**',
  'tree-sitter-markdown/**',
  'tree-sitter-markdown-inline/**',
];

// wbfy:start oxfmt-export
module.exports = oxfmtResolvedConfig;
// wbfy:end oxfmt-export
