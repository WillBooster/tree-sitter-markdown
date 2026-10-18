import { expect } from 'vitest';

import { Grammars } from '../helpers/grammars.js';
import { testCommand } from './run.js';

// The CLI exits zero when it finds no corpus case, so its summary must show that cases were parsed.
for (const grammar of Grammars) {
  testCommand(`parses the corpus in ${grammar}/test/corpus as expected`, ['script/test-corpus', grammar], 300_000, {
    check: (output) => expect(output).toMatch(/Total parses: [1-9]/),
  });
}
