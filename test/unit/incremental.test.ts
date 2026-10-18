import { expect } from 'vitest';

import { Grammars } from '../helpers/grammars.js';
import { testCommand } from './run.js';

// Edits each corpus case at random and reparses it incrementally, then undoes the edits and reparses
// again: the changed ranges must cover every change and the final tree must match the corpus. The CLI
// exits zero even when a case fails or no corpus is found, so its output decides: it must list the cases
// it fuzzed and print no failure summary. script/fuzz-corpus sets the seed and the iteration and edit counts, since its
// list of excluded cases holds for them; TREE_SITTER_SEED, TREE_SITTER_ITERATIONS, and TREE_SITTER_EDITS explore
// further locally, where a failure may be one that upstream's parser shares.
for (const grammar of Grammars) {
  testCommand(
    `reparses the ${grammar} corpus consistently after random edits`,
    ['script/fuzz-corpus', grammar],
    900_000,
    {
      check: (output) => {
        expect(output).toMatch(/^ +\d+\. .+ - corpus - /m);
        expect(output).not.toContain('failed fuzzing');
      },
    }
  );
}
