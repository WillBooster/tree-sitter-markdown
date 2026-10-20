#include "tree_sitter/parser.h"
#include <string.h>
#include <stddef.h>
#include <assert.h>

typedef enum {
    ERROR,
    TRIGGER_ERROR,
    CODE_SPAN_START,
    CODE_SPAN_CLOSE,
    EMPHASIS_STAR_OPEN_LEFT_0,
    EMPHASIS_STAR_OPEN_LEFT_1,
    EMPHASIS_STAR_OPEN_LEFT_2,
    EMPHASIS_STAR_OPEN_RIGHT_0,
    EMPHASIS_STAR_OPEN_RIGHT_1,
    EMPHASIS_STAR_OPEN_RIGHT_2,
    EMPHASIS_STAR_OPEN_BOTH_0,
    EMPHASIS_STAR_OPEN_BOTH_1,
    EMPHASIS_STAR_OPEN_BOTH_2,
    EMPHASIS_STAR_CLOSE_LEFT_0,
    EMPHASIS_STAR_CLOSE_LEFT_1,
    EMPHASIS_STAR_CLOSE_LEFT_2,
    EMPHASIS_STAR_CLOSE_RIGHT_0,
    EMPHASIS_STAR_CLOSE_RIGHT_1,
    EMPHASIS_STAR_CLOSE_RIGHT_2,
    EMPHASIS_STAR_CLOSE_BOTH_0,
    EMPHASIS_STAR_CLOSE_BOTH_1,
    EMPHASIS_STAR_CLOSE_BOTH_2,
    EMPHASIS_STAR_LITERAL_LEFT_0,
    EMPHASIS_STAR_LITERAL_LEFT_1,
    EMPHASIS_STAR_LITERAL_LEFT_2,
    EMPHASIS_STAR_LITERAL_RIGHT_0,
    EMPHASIS_STAR_LITERAL_RIGHT_1,
    EMPHASIS_STAR_LITERAL_RIGHT_2,
    EMPHASIS_STAR_LITERAL_BOTH_0,
    EMPHASIS_STAR_LITERAL_BOTH_1,
    EMPHASIS_STAR_LITERAL_BOTH_2,
    EMPHASIS_STAR_CANDIDATE_LEFT_0,
    EMPHASIS_STAR_CANDIDATE_LEFT_1,
    EMPHASIS_STAR_CANDIDATE_LEFT_2,
    EMPHASIS_STAR_CANDIDATE_RIGHT_0,
    EMPHASIS_STAR_CANDIDATE_RIGHT_1,
    EMPHASIS_STAR_CANDIDATE_RIGHT_2,
    EMPHASIS_STAR_CANDIDATE_BOTH_0,
    EMPHASIS_STAR_CANDIDATE_BOTH_1,
    EMPHASIS_STAR_CANDIDATE_BOTH_2,
    EMPHASIS_UNDERSCORE_OPEN_LEFT_0,
    EMPHASIS_UNDERSCORE_OPEN_LEFT_1,
    EMPHASIS_UNDERSCORE_OPEN_LEFT_2,
    EMPHASIS_UNDERSCORE_OPEN_RIGHT_0,
    EMPHASIS_UNDERSCORE_OPEN_RIGHT_1,
    EMPHASIS_UNDERSCORE_OPEN_RIGHT_2,
    EMPHASIS_UNDERSCORE_OPEN_BOTH_0,
    EMPHASIS_UNDERSCORE_OPEN_BOTH_1,
    EMPHASIS_UNDERSCORE_OPEN_BOTH_2,
    EMPHASIS_UNDERSCORE_CLOSE_LEFT_0,
    EMPHASIS_UNDERSCORE_CLOSE_LEFT_1,
    EMPHASIS_UNDERSCORE_CLOSE_LEFT_2,
    EMPHASIS_UNDERSCORE_CLOSE_RIGHT_0,
    EMPHASIS_UNDERSCORE_CLOSE_RIGHT_1,
    EMPHASIS_UNDERSCORE_CLOSE_RIGHT_2,
    EMPHASIS_UNDERSCORE_CLOSE_BOTH_0,
    EMPHASIS_UNDERSCORE_CLOSE_BOTH_1,
    EMPHASIS_UNDERSCORE_CLOSE_BOTH_2,
    EMPHASIS_UNDERSCORE_LITERAL_LEFT_0,
    EMPHASIS_UNDERSCORE_LITERAL_LEFT_1,
    EMPHASIS_UNDERSCORE_LITERAL_LEFT_2,
    EMPHASIS_UNDERSCORE_LITERAL_RIGHT_0,
    EMPHASIS_UNDERSCORE_LITERAL_RIGHT_1,
    EMPHASIS_UNDERSCORE_LITERAL_RIGHT_2,
    EMPHASIS_UNDERSCORE_LITERAL_BOTH_0,
    EMPHASIS_UNDERSCORE_LITERAL_BOTH_1,
    EMPHASIS_UNDERSCORE_LITERAL_BOTH_2,
    EMPHASIS_UNDERSCORE_CANDIDATE_LEFT_0,
    EMPHASIS_UNDERSCORE_CANDIDATE_LEFT_1,
    EMPHASIS_UNDERSCORE_CANDIDATE_LEFT_2,
    EMPHASIS_UNDERSCORE_CANDIDATE_RIGHT_0,
    EMPHASIS_UNDERSCORE_CANDIDATE_RIGHT_1,
    EMPHASIS_UNDERSCORE_CANDIDATE_RIGHT_2,
    EMPHASIS_UNDERSCORE_CANDIDATE_BOTH_0,
    EMPHASIS_UNDERSCORE_CANDIDATE_BOTH_1,
    EMPHASIS_UNDERSCORE_CANDIDATE_BOTH_2,
    LAST_TOKEN_WHITESPACE,
    LAST_TOKEN_PUNCTUATION,
    STRIKETHROUGH_OPEN,
    STRIKETHROUGH_CLOSE,
    STRIKETHROUGH_FORCED_OPEN,
    STRIKETHROUGH_LITERAL,
    LATEX_SPAN_START,
    LATEX_SPAN_CLOSE,
    UNCLOSED_SPAN,
    LITERAL_EMPHASIS_RUN,
    OPEN_BRACKET,
    UNCLOSED_OPEN_BRACKET,
    CLOSE_BRACKET_NO_LABEL,
    CLOSE_BRACKET_WITH_LABEL,
    CLOSE_BRACKET_UNKNOWN_LABEL,
    HTML_SPECIAL,
    HTML_SPECIAL_OPENER
} TokenType;

// Constructs whose terminator is known to be missing from the scanned position to the end of the input.
enum {
    UNTERMINATED_PROCESSING_INSTRUCTION = 1,
    UNTERMINATED_DECLARATION = 2,
    UNTERMINATED_CDATA = 4,
};

typedef enum {
    EMPHASIS_ROLE_OPEN,
    EMPHASIS_ROLE_CLOSE,
    EMPHASIS_ROLE_LITERAL,
    EMPHASIS_ROLE_CANDIDATE,
} EmphasisRole;

static const uint8_t CONTEXT_WORD = 0;
static const uint8_t STATE_EMPHASIS_DELIMITER_IS_OPEN = 0x1 << 2;

enum { CERTIFIED_LIMIT = 1024 };

typedef struct {
    uint8_t state;
    uint8_t context;
    uint8_t emphasis_context;
    bool context_pending;
    char run_delimiter;
    bool no_closing_bracket;
    uint8_t unterminated_html;
    uint32_t bracket_depth;
    uint32_t flat_head_depth;
    uint8_t code_span_delimiter_length;
    uint8_t latex_span_delimiter_length;
    uint32_t num_emphasis_delimiters_left;
    uint8_t run_flank;
    uint8_t run_modulo;
    bool run_can_open;
    bool run_proved;
    uint32_t run_open_count;
    uint16_t certified_depth;
    uint16_t discarded_count;
    uint16_t tilde_cursor;
    bool run_suppressed;
    uint32_t root_repetitions;
    bool root_group_opening;
    uint8_t certified_openers[(CERTIFIED_LIMIT + 1) / 2];
    uint8_t discarded_frames[(CERTIFIED_LIMIT + 7) / 8];
    uint8_t discarded_tildes[(CERTIFIED_LIMIT + 7) / 8];
    bool delimiter_adjacent;
    unsigned discard_offset;
} Scanner;

enum {
    SCANNER_HEADER_SIZE = offsetof(Scanner, certified_openers),
};

_Static_assert(SCANNER_HEADER_SIZE + sizeof(((Scanner *)0)->certified_openers) +
                   sizeof(((Scanner *)0)->discarded_frames) + sizeof(((Scanner *)0)->discarded_tildes) <=
                   TREE_SITTER_SERIALIZATION_BUFFER_SIZE,
               "Certified delimiter state must fit the scanner buffer");

typedef struct {
    bool can_open;
    bool can_close;
} DelimiterFlanks;

typedef struct {
    int previous;
    uint32_t count;
    uint8_t modulo;
    char delimiter;
    bool can_close;
} PendingDelimiter;

// How far a `<` read by a delimiter proof can still begin raw HTML or an autolink, whose contents are not emphasis text.
typedef enum {
    ANGLE_NONE,
    ANGLE_HTML_OR_URI,
    ANGLE_EMAIL_LOCAL,
    ANGLE_EMAIL_DOMAIN,
} ProofAngle;

typedef struct {
    PendingDelimiter pending[CERTIFIED_LIMIT + 1];
    unsigned used;
    unsigned budget;
    int top;
    uint32_t initial_count;
    uint32_t matched_initial;
    unsigned tilde_runs;
    unsigned discard_offset;
    bool strikethrough;
    const bool *scope_symbols;
    ProofAngle angle;
    unsigned pending_bracket;
    int32_t previous;
    int32_t emphasis_previous;
} DelimiterProof;

typedef struct {
    char delimiter;
    uint32_t count;
    uint8_t modulo;
    DelimiterFlanks flanks;
    bool oversized;
} FutureDelimiter;

typedef enum {
    PROOF_DELIMITER,
    PROOF_TEXT,
    PROOF_UNCERTAIN,
    PROOF_SCOPE_END,
} ProofStep;

static char opener_delimiter(uint8_t opener) {
    return opener >= 12 ? '~' : opener >= 6 ? '_' : '*';
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols);
static bool error(TSLexer *lexer);
static bool emit_context(Scanner *s, TSLexer *lexer, const bool *valid_symbols);
static bool dispatch_delimiter(Scanner *s, TSLexer *lexer, const bool *valid_symbols);
static bool parse_backtick(Scanner *s, TSLexer *lexer,
                           const bool *valid_symbols);
static bool parse_html_special(Scanner *s, TSLexer *lexer, const bool *valid_symbols);
static bool scan_html_terminator(TSLexer *lexer, const char *terminator);
static bool parse_dollar(Scanner *s, TSLexer *lexer,
                         const bool *valid_symbols);
static bool parse_leaf_delimiter(TSLexer *lexer, uint8_t *delimiter_length,
                                 const bool *valid_symbols, const char delimiter,
                                 const TokenType open_token, const TokenType close_token);
static bool parse_emphasis(Scanner *s, TSLexer *lexer, const bool *valid_symbols,
                            char delimiter, TokenType first_token);
static bool literal_emphasis_run(TSLexer *lexer, const bool *valid_symbols);
static EmphasisRole emphasis_role(Scanner *s, TSLexer *lexer, const bool *valid_symbols,
                                  bool fresh_run, bool strikethrough, FutureDelimiter *following);
static void read_remaining_emphasis(Scanner *s, TSLexer *lexer, bool strikethrough, FutureDelimiter *following);
static uint32_t proved_open_count(Scanner *s, TSLexer *lexer, bool strikethrough, FutureDelimiter *following, const bool *scope_symbols);
static bool finish_proof_run(Scanner *s, TSLexer *lexer, DelimiterProof *proof,
                             FutureDelimiter *run, uint32_t *result);
static bool proof_boundary(Scanner *s, DelimiterProof *proof, char delimiter, uint8_t modulo, bool can_open);
static uint32_t oversized_proof(Scanner *s, TSLexer *lexer, DelimiterProof *proof,
                                FutureDelimiter *run);
static uint32_t uncertain_proof(Scanner *s, TSLexer *lexer, DelimiterProof *proof,
                                bool matching_run);
static bool possible_closer(TSLexer *lexer, unsigned budget, char delimiter, uint8_t modulo, bool opener_can_close, bool strikethrough);
static void match_future_delimiter(DelimiterProof *proof, FutureDelimiter *run);
static bool record_emphasis_role(Scanner *s, EmphasisRole role);
static void pop_certified_opener(Scanner *s);
static bool parse_bracket(Scanner *s, TSLexer *lexer, const bool *valid_symbols);
static bool parse_close_bracket(Scanner *s, TSLexer *lexer, const bool *valid_symbols);
static TokenType following_label(TSLexer *lexer);
static unsigned serialize(Scanner *s, char *buffer);
static void deserialize(Scanner *s, const char *buffer, unsigned length);
static TokenType emphasis_token(Scanner *s, TokenType first_token, EmphasisRole role);
static int32_t context_character(uint8_t context);
static uint32_t certify_protected_suffix(Scanner *s, TSLexer *lexer, DelimiterProof *proof, uint32_t result);
static bool record_discard(Scanner *s);
static bool push_certified_opener(Scanner *s);
static bool certified_closer(Scanner *s);
static uint8_t certified_opener(Scanner *s, unsigned index);
static bool delimiter_pair_allowed(bool opener_closes, uint8_t opener_modulo,
                                   bool closer_opens, uint8_t closer_modulo);
static bool opener_can_close(uint8_t opener);
static uint8_t opener_modulo(uint8_t opener);
static ProofStep advance_proof_text(Scanner *s, TSLexer *lexer, DelimiterProof *proof);
static bool proof_uncertain_character(int32_t character);
static ProofAngle opening_angle(int32_t next);
static ProofAngle next_angle(ProofAngle angle, int32_t next);
static bool is_email_local(int32_t character);
static ProofStep read_proof_escape(TSLexer *lexer, DelimiterProof *proof);
static ProofStep read_proof_bracket(Scanner *s, TSLexer *lexer, DelimiterProof *proof);
static void read_transparent_tildes(TSLexer *lexer, DelimiterProof *proof,
                                      FutureDelimiter *run, FutureDelimiter *tildes);
static bool consume_emphasis_run(Scanner *s, TSLexer *lexer, char delimiter,
                                  bool strikethrough, FutureDelimiter *following);
static void read_emphasis_run(Scanner *s, TSLexer *lexer, char delimiter,
                               bool strikethrough, FutureDelimiter *following);
static FutureDelimiter read_future_delimiter(unsigned *budget, TSLexer *lexer, int32_t previous);
static bool is_punctuation(int32_t chr);
static bool is_whitespace(int32_t character);
static DelimiterFlanks delimiter_flanks(char delimiter, bool previous_space, bool previous_punctuation,
                                       bool next_space, bool next_punctuation);
static bool is_inline_delimiter(int32_t character);
static void advance_tilde(Scanner *s);

void *tree_sitter_markdown_inline_external_scanner_create() {
    Scanner *s = (Scanner *)malloc(sizeof(Scanner));
    deserialize(s, NULL, 0);
    return s;
}

bool tree_sitter_markdown_inline_external_scanner_scan(
    void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;
    return scan(scanner, lexer, valid_symbols);
}

unsigned tree_sitter_markdown_inline_external_scanner_serialize(void *payload,
                                                                char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    return serialize(scanner, buffer);
}

void tree_sitter_markdown_inline_external_scanner_deserialize(void *payload,
                                                              const char *buffer,
                                                              unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    deserialize(scanner, buffer, length);
}

void tree_sitter_markdown_inline_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    free(scanner);
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[TRIGGER_ERROR]) return error(lexer);
    if (emit_context(s, lexer, valid_symbols)) return true;
    int32_t delimiter = lexer->lookahead;
    bool result = dispatch_delimiter(s, lexer, valid_symbols);
    if (delimiter == '[' || delimiter == ']') return result;
    if (result) {
        s->context = LAST_TOKEN_PUNCTUATION;
        if (delimiter != '~') s->emphasis_context = LAST_TOKEN_PUNCTUATION;
        s->context_pending = is_inline_delimiter(delimiter) &&
            (s->num_emphasis_delimiters_left || s->delimiter_adjacent);
    }
    return result;
}

static bool error(TSLexer *lexer) {
    lexer->result_symbol = ERROR;
    return true;
}

static bool emit_context(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (s->context_pending) return false;
    s->context = CONTEXT_WORD;
    s->emphasis_context = CONTEXT_WORD;
    if (!valid_symbols[LITERAL_EMPHASIS_RUN] || !is_inline_delimiter(lexer->lookahead)) return false;
    const TokenType contexts[] = {LAST_TOKEN_WHITESPACE, LAST_TOKEN_PUNCTUATION};
    for (unsigned i = 0; i < 2; i++) {
        if (valid_symbols[contexts[i]]) {
            s->context = contexts[i];
            s->emphasis_context = contexts[i];
            s->context_pending = true;
            lexer->result_symbol = contexts[i];
            lexer->mark_end(lexer);
            return true;
        }
    }
    return false;
}

static bool dispatch_delimiter(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    switch (lexer->lookahead) {
        case ']': return parse_close_bracket(s, lexer, valid_symbols);
        case '[': return parse_bracket(s, lexer, valid_symbols);
        case '`': return parse_backtick(s, lexer, valid_symbols);
        case '$': return parse_dollar(s, lexer, valid_symbols);
        case '<': return parse_html_special(s, lexer, valid_symbols);
        case '*': return parse_emphasis(s, lexer, valid_symbols, '*', EMPHASIS_STAR_OPEN_LEFT_0);
        case '_': return parse_emphasis(s, lexer, valid_symbols, '_', EMPHASIS_UNDERSCORE_OPEN_LEFT_0);
        case '~': return parse_emphasis(s, lexer, valid_symbols, '~', STRIKETHROUGH_FORCED_OPEN);
        default: return false;
    }
}

static bool parse_html_special(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[HTML_SPECIAL] && !valid_symbols[HTML_SPECIAL_OPENER]) return false;
    lexer->advance(lexer, false);
    uint8_t kind;
    const char *terminator;
    if (lexer->lookahead == '?') {
        lexer->advance(lexer, false);
        kind = UNTERMINATED_PROCESSING_INSTRUCTION;
        terminator = "?>";
    } else if (lexer->lookahead == '!') {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '[') {
            for (const char *c = "[CDATA["; *c; c++) {
                if (lexer->lookahead != *c) return false;
                lexer->advance(lexer, false);
            }
            kind = UNTERMINATED_CDATA;
            terminator = "]]>";
        } else {
            if (lexer->lookahead < 'A' || lexer->lookahead > 'Z') return false;
            while (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') lexer->advance(lexer, false);
            kind = UNTERMINATED_DECLARATION;
            terminator = is_whitespace(lexer->lookahead) ? ">" : NULL;
        }
    } else {
        return false;
    }
    lexer->mark_end(lexer);
    if (terminator && valid_symbols[HTML_SPECIAL] && !(s->unterminated_html & kind)) {
        if (scan_html_terminator(lexer, terminator)) {
            lexer->mark_end(lexer);
            lexer->result_symbol = HTML_SPECIAL;
            return true;
        }
        s->unterminated_html |= kind;
    }
    if (!valid_symbols[HTML_SPECIAL_OPENER]) return false;
    lexer->result_symbol = HTML_SPECIAL_OPENER;
    return true;
}

// Advances past the first occurrence of `terminator`, whose characters other than the first never begin it again.
static bool scan_html_terminator(TSLexer *lexer, const char *terminator) {
    size_t matched = 0;
    while (!lexer->eof(lexer)) {
        int32_t character = lexer->lookahead;
        lexer->advance(lexer, false);
        if (character == terminator[matched]) {
            if (!terminator[++matched]) return true;
        } else if (matched && character == terminator[0] && terminator[0] == terminator[matched - 1]) {
            continue;
        } else {
            matched = character == terminator[0];
        }
    }
    return false;
}

static bool parse_backtick(Scanner *s, TSLexer *lexer,
                           const bool *valid_symbols) {
    return parse_leaf_delimiter(lexer, &s->code_span_delimiter_length,
                                valid_symbols, '`', CODE_SPAN_START,
                                CODE_SPAN_CLOSE);
}

static bool parse_dollar(Scanner *s, TSLexer *lexer,
                         const bool *valid_symbols) {
    return parse_leaf_delimiter(lexer, &s->latex_span_delimiter_length,
                                valid_symbols, '$', LATEX_SPAN_START,
                                LATEX_SPAN_CLOSE);
}

static bool parse_leaf_delimiter(TSLexer *lexer, uint8_t *delimiter_length,
                                 const bool *valid_symbols, const char delimiter,
                                 const TokenType open_token, const TokenType close_token) {
    uint8_t level = 0;
    while (lexer->lookahead == delimiter) {
        lexer->advance(lexer, false);
        level++;
    }
    lexer->mark_end(lexer);
    if (level == *delimiter_length && valid_symbols[close_token]) {
        *delimiter_length = 0;
        lexer->result_symbol = close_token;
        return true;
    }
    if (!valid_symbols[open_token]) return false;
    size_t close_level = 0;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == delimiter) close_level++;
        else {
            if (close_level == level) break;
            close_level = 0;
        }
        lexer->advance(lexer, false);
    }
    if (close_level == level) {
        *delimiter_length = level;
        lexer->result_symbol = open_token;
        return true;
    }
    if (!valid_symbols[UNCLOSED_SPAN]) return false;
    lexer->result_symbol = UNCLOSED_SPAN;
    return true;
}

static bool parse_emphasis(Scanner *s, TSLexer *lexer, const bool *valid_symbols,
                            char delimiter, TokenType first_token) {
    bool strikethrough = valid_symbols[STRIKETHROUGH_FORCED_OPEN] || valid_symbols[STRIKETHROUGH_CLOSE] ||
        valid_symbols[STRIKETHROUGH_OPEN] || valid_symbols[STRIKETHROUGH_LITERAL];
    if (delimiter == '~' && !strikethrough) {
        if (!valid_symbols[LITERAL_EMPHASIS_RUN]) return false;
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        s->num_emphasis_delimiters_left = 0;
        s->delimiter_adjacent = is_inline_delimiter(lexer->lookahead);
        s->emphasis_context = LAST_TOKEN_PUNCTUATION;
        lexer->result_symbol = LITERAL_EMPHASIS_RUN;
        return true;
    }
    FutureDelimiter following = {0};
    bool fresh_run = consume_emphasis_run(s, lexer, delimiter, strikethrough, &following);
    if (s->run_flank == 3) {
        if (delimiter == '~') s->num_emphasis_delimiters_left = 0;
        return literal_emphasis_run(lexer, valid_symbols);
    }
    EmphasisRole role = s->run_suppressed ? EMPHASIS_ROLE_LITERAL
        : emphasis_role(s, lexer, valid_symbols, fresh_run, strikethrough, &following);
    TokenType token = emphasis_token(s, first_token, role);
    if (!valid_symbols[token]) {
        if (s->certified_depth && (role == EMPHASIS_ROLE_OPEN || role == EMPHASIS_ROLE_CLOSE)) return false;
        role = EMPHASIS_ROLE_LITERAL;
        token = emphasis_token(s, first_token, role);
    }
    if (!valid_symbols[token] || !record_emphasis_role(s, role)) return false;
    if (s->discard_offset && !record_discard(s)) return false;
    lexer->result_symbol = token;
    if (delimiter == '~') s->num_emphasis_delimiters_left = 0;
    return true;
}

static bool literal_emphasis_run(TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[LITERAL_EMPHASIS_RUN]) return false;
    lexer->result_symbol = LITERAL_EMPHASIS_RUN;
    return true;
}

static EmphasisRole emphasis_role(Scanner *s, TSLexer *lexer, const bool *valid_symbols,
                                  bool fresh_run, bool strikethrough, FutureDelimiter *following) {
    TokenType first = s->run_delimiter == '_' ? EMPHASIS_UNDERSCORE_OPEN_LEFT_0 : EMPHASIS_STAR_OPEN_LEFT_0;
    bool closing_valid = valid_symbols[emphasis_token(s, first, EMPHASIS_ROLE_CLOSE)];
    bool continued = s->state & STATE_EMPHASIS_DELIMITER_IS_OPEN;
    if (!continued && s->run_flank != 0 && (s->certified_depth ? certified_closer(s) : closing_valid)) return EMPHASIS_ROLE_CLOSE;
    if (s->run_can_open && !continued && !s->run_proved) {
        if (!fresh_run) read_remaining_emphasis(s, lexer, strikethrough, following);
        s->run_proved = true;
        s->run_open_count = proved_open_count(s, lexer, strikethrough, following, valid_symbols);
    }
    if (!s->run_can_open) return EMPHASIS_ROLE_LITERAL;
    if (s->run_open_count == UINT32_MAX) return EMPHASIS_ROLE_CANDIDATE;
    return s->num_emphasis_delimiters_left + 1 > s->run_open_count ? EMPHASIS_ROLE_LITERAL : EMPHASIS_ROLE_OPEN;
}

static void read_remaining_emphasis(Scanner *s, TSLexer *lexer, bool strikethrough, FutureDelimiter *following) {
    while (lexer->lookahead == s->run_delimiter) lexer->advance(lexer, false);
    if (strikethrough && s->run_delimiter != '~' && lexer->lookahead == '~') {
        unsigned budget = CERTIFIED_LIMIT;
        *following = read_future_delimiter(&budget, lexer, s->run_delimiter);
    }
}

static uint32_t proved_open_count(Scanner *s, TSLexer *lexer, bool strikethrough, FutureDelimiter *following, const bool *scope_symbols) {
    uint32_t count = s->num_emphasis_delimiters_left + 1;
    DelimiterProof proof = {.used = 1, .top = 0, .initial_count = count, .budget = CERTIFIED_LIMIT,
        .strikethrough = strikethrough, .scope_symbols = scope_symbols, .previous = s->run_delimiter,
        .emphasis_previous = s->run_delimiter == '~' ? context_character(s->emphasis_context) : s->run_delimiter,
        .pending = {{.previous = -1, .count = count, .modulo = s->run_modulo,
                     .delimiter = s->run_delimiter, .can_close = s->run_flank == 2}}};
    uint32_t result;
    if (following->count) {
        proof.budget -= following->count < proof.budget ? following->count : proof.budget;
        if (finish_proof_run(s, lexer, &proof, following, &result)) return certify_protected_suffix(s, lexer, &proof, result);
        proof.previous = '~';
    }
    while (!lexer->eof(lexer)) {
        if (!proof.budget) return uncertain_proof(s, lexer, &proof, false);
        ProofStep step = advance_proof_text(s, lexer, &proof);
        if (step == PROOF_UNCERTAIN) return uncertain_proof(s, lexer, &proof, false);
        if (step == PROOF_SCOPE_END) return certify_protected_suffix(s, lexer, &proof, proof.matched_initial);
        if (step == PROOF_TEXT) continue;
        FutureDelimiter run = read_future_delimiter(&proof.budget, lexer, proof.previous);
        FutureDelimiter tildes = {0};
        if (strikethrough && run.delimiter != '~') read_transparent_tildes(lexer, &proof, &run, &tildes);
        if (finish_proof_run(s, lexer, &proof, &run, &result)) return certify_protected_suffix(s, lexer, &proof, result);
        proof.previous = run.delimiter;
        if (run.delimiter != '~') proof.emphasis_previous = run.delimiter;
        if (!tildes.count) continue;
        if (finish_proof_run(s, lexer, &proof, &tildes, &result)) return certify_protected_suffix(s, lexer, &proof, result);
        proof.previous = '~';
    }
    return certify_protected_suffix(s, lexer, &proof, proof.matched_initial);
}

static bool finish_proof_run(Scanner *s, TSLexer *lexer, DelimiterProof *proof,
                             FutureDelimiter *run, uint32_t *result) {
    if (run->delimiter == '~') proof->tilde_runs++;
    if (run->oversized) {
        *result = oversized_proof(s, lexer, proof, run);
        return true;
    }
    match_future_delimiter(proof, run);
    *result = proof->matched_initial;
    if (!proof->pending[0].count) return true;
    if (run->flanks.can_close && run->count &&
        proof_boundary(s, proof, run->delimiter, run->modulo, run->flanks.can_open)) return true;
    if (run->flanks.can_open && run->count) {
        assert(proof->used <= CERTIFIED_LIMIT);
        proof->pending[proof->used] = (PendingDelimiter){.previous = proof->top, .count = run->count,
            .modulo = run->modulo, .delimiter = run->delimiter, .can_close = run->flanks.can_close};
        proof->top = proof->used++;
    }
    return false;
}

static bool proof_boundary(Scanner *s, DelimiterProof *proof, char delimiter, uint8_t modulo, bool can_open) {
    if (!s->certified_depth) {
        if (delimiter == '~') return proof->scope_symbols[STRIKETHROUGH_CLOSE];
        unsigned first = delimiter == '_' ? EMPHASIS_UNDERSCORE_CLOSE_LEFT_0 : EMPHASIS_STAR_CLOSE_LEFT_0;
        return proof->scope_symbols[first + (can_open ? 6 : 3) + modulo];
    }
    for (unsigned i = s->certified_depth; i > 0; i--) {
        uint8_t opener = certified_opener(s, i - 1);
        if (opener_delimiter(opener) != delimiter) continue;
        if (delimiter_pair_allowed(opener_can_close(opener), opener_modulo(opener), can_open, modulo)) return true;
    }
    return false;
}

static uint32_t oversized_proof(Scanner *s, TSLexer *lexer, DelimiterProof *proof,
                                FutureDelimiter *run) {
    PendingDelimiter *first = &proof->pending[0];
    bool matching = proof->top == 0 && run->delimiter == first->delimiter && run->flanks.can_close &&
        delimiter_pair_allowed(first->can_close, first->modulo, run->flanks.can_open, run->modulo);
    if (matching && run->count >= first->count) return proof->initial_count;
    if (matching && lexer->eof(lexer)) return proof->initial_count - first->count + run->count;
    return uncertain_proof(s, lexer, proof, matching);
}

static uint32_t uncertain_proof(Scanner *s, TSLexer *lexer, DelimiterProof *proof,
                                bool matching_run) {
    PendingDelimiter *first = &proof->pending[0];
    s->run_can_open = first->count < proof->initial_count || matching_run ||
        // Every opener gets the same window of two budgets, wherever its proof stopped.
        possible_closer(lexer, CERTIFIED_LIMIT + proof->budget, first->delimiter, first->modulo, first->can_close, proof->strikethrough);
    return UINT32_MAX;
}

static bool possible_closer(TSLexer *lexer, unsigned budget, char delimiter, uint8_t modulo, bool opener_can_close, bool strikethrough) {
    int32_t previous = delimiter;
    for (; budget && !lexer->eof(lexer); budget--) {
        if (lexer->lookahead != delimiter) {
            if (!strikethrough || lexer->lookahead != '~' || delimiter == '~') previous = lexer->lookahead;
            lexer->advance(lexer, false);
            continue;
        }
        uint32_t count = 0;
        do { count++; lexer->advance(lexer, false); } while (lexer->lookahead == delimiter);
        if (strikethrough && delimiter != '~') while (lexer->lookahead == '~') lexer->advance(lexer, false);
        DelimiterFlanks flanks = delimiter_flanks(delimiter, is_whitespace(previous), is_punctuation(previous),
            lexer->eof(lexer) || is_whitespace(lexer->lookahead), is_punctuation(lexer->lookahead));
        if (flanks.can_close && delimiter_pair_allowed(opener_can_close, modulo, flanks.can_open, count % 3)) return true;
        previous = delimiter;
    }
    // Keeping every opener without a nearby closer as a candidate makes the parse stacks grow with the input.
    return false;
}

static void match_future_delimiter(DelimiterProof *proof, FutureDelimiter *run) {
    if (!run->flanks.can_close) return;
    int opener = proof->top;
    while (opener >= 0 && run->count) {
        PendingDelimiter *candidate = &proof->pending[opener];
        if (candidate->delimiter != run->delimiter ||
            !delimiter_pair_allowed(candidate->can_close, candidate->modulo, run->flanks.can_open, run->modulo)) {
            opener = candidate->previous;
            continue;
        }
        if (run->delimiter == '~' && candidate->count != run->count) {
            if (!opener) proof->discard_offset = proof->tilde_runs;
            candidate->count = run->count = 0;
            proof->top = candidate->previous;
            return;
        }
        uint32_t matched = candidate->count < run->count ? candidate->count : run->count;
        if (!opener) proof->matched_initial += matched;
        candidate->count -= matched;
        run->count -= matched;
        proof->top = candidate->count ? opener : candidate->previous;
        opener = proof->top;
    }
}

static bool record_emphasis_role(Scanner *s, EmphasisRole role) {
    if (role == EMPHASIS_ROLE_OPEN || role == EMPHASIS_ROLE_CANDIDATE) s->state |= STATE_EMPHASIS_DELIMITER_IS_OPEN;
    if (role == EMPHASIS_ROLE_OPEN) return push_certified_opener(s);
    if (role == EMPHASIS_ROLE_CLOSE && s->certified_depth) pop_certified_opener(s);
    return true;
}

static void pop_certified_opener(Scanner *s) {
    uint8_t opener = certified_opener(s, s->certified_depth - 1);
    assert(opener_delimiter(opener) == s->run_delimiter);
    assert(s->run_delimiter != '~' || (opener >= 14 ? 2 : 1) == s->run_modulo);
    assert(delimiter_pair_allowed(opener_can_close(opener), opener_modulo(opener), s->run_flank == 2, s->run_modulo));
    if (s->certified_depth == 1 && s->root_repetitions > 1) {
        s->root_repetitions--;
        return;
    }
    unsigned index = --s->certified_depth;
    s->certified_openers[index / 2] &= ~(15 << (4 * (index % 2)));
    if (!index) s->root_repetitions = 0;
}

static bool parse_bracket(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[OPEN_BRACKET] && !valid_symbols[UNCLOSED_OPEN_BRACKET]) return false;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    s->context = LAST_TOKEN_PUNCTUATION;
    s->emphasis_context = LAST_TOKEN_PUNCTUATION;
    s->context_pending = is_inline_delimiter(lexer->lookahead);
    s->num_emphasis_delimiters_left = 0;
    if (!s->no_closing_bracket) {
        for (unsigned remaining = 1024; remaining && !lexer->eof(lexer) && lexer->lookahead != ']'; remaining--) {
            lexer->advance(lexer, false);
        }
        s->no_closing_bracket = lexer->eof(lexer);
    }
    lexer->result_symbol = s->no_closing_bracket ? UNCLOSED_OPEN_BRACKET : OPEN_BRACKET;
    if (!valid_symbols[lexer->result_symbol]) return false;
    s->bracket_depth++;
    s->flat_head_depth = s->bracket_depth;
    return true;
}

static bool parse_close_bracket(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[CLOSE_BRACKET_NO_LABEL] && !valid_symbols[CLOSE_BRACKET_WITH_LABEL] && !valid_symbols[CLOSE_BRACKET_UNKNOWN_LABEL]) return false;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    s->context = LAST_TOKEN_PUNCTUATION;
    s->emphasis_context = LAST_TOKEN_PUNCTUATION;
    s->context_pending = is_inline_delimiter(lexer->lookahead);
    s->num_emphasis_delimiters_left = 0;
    lexer->result_symbol = following_label(lexer);
    if (!valid_symbols[lexer->result_symbol]) return false;
    if (s->bracket_depth) s->bracket_depth--;
    if (s->flat_head_depth > s->bracket_depth) s->flat_head_depth = 0;
    return true;
}

static TokenType following_label(TSLexer *lexer) {
    if (lexer->lookahead != '[') return CLOSE_BRACKET_NO_LABEL;
    lexer->advance(lexer, false);
    for (unsigned remaining = CERTIFIED_LIMIT; remaining; remaining--) {
        if (lexer->eof(lexer)) return CLOSE_BRACKET_NO_LABEL;
        switch (lexer->lookahead) {
            case '[': return CLOSE_BRACKET_NO_LABEL;
            case 0: return CLOSE_BRACKET_UNKNOWN_LABEL;
            case ']':
                lexer->advance(lexer, false);
                return lexer->lookahead == '(' ? CLOSE_BRACKET_UNKNOWN_LABEL : CLOSE_BRACKET_WITH_LABEL;
            case '\\':
                lexer->advance(lexer, false);
                if (remaining == 1 || lexer->eof(lexer)) return CLOSE_BRACKET_UNKNOWN_LABEL;
                remaining--;
                break;
        }
        lexer->advance(lexer, false);
    }
    return CLOSE_BRACKET_UNKNOWN_LABEL;
}

static unsigned serialize(Scanner *s, char *buffer) {
    unsigned size = SCANNER_HEADER_SIZE;
    memcpy(buffer, s, size);
    unsigned bytes = (s->certified_depth + 1) / 2;
    memcpy(buffer + size, s->certified_openers, bytes);
    size += bytes;
    if (s->discarded_count) {
        bytes = (s->certified_depth + 7) / 8;
        memcpy(buffer + size, s->discarded_frames, bytes);
        size += bytes;
        memcpy(buffer + size, s->discarded_tildes, sizeof(s->discarded_tildes));
        size += sizeof(s->discarded_tildes);
    }
    return size;
}

static void deserialize(Scanner *s, const char *buffer, unsigned length) {
    memset(s, 0, sizeof(Scanner));
    s->context = s->emphasis_context = LAST_TOKEN_WHITESPACE;
    s->run_open_count = UINT32_MAX;
    if (length < SCANNER_HEADER_SIZE) return;
    uint16_t depth, discarded;
    memcpy(&depth, buffer + offsetof(Scanner, certified_depth), sizeof(depth));
    memcpy(&discarded, buffer + offsetof(Scanner, discarded_count), sizeof(discarded));
    unsigned size = SCANNER_HEADER_SIZE + (depth + 1) / 2;
    if (discarded) size += (depth + 7) / 8 + sizeof(s->discarded_tildes);
    if (depth > CERTIFIED_LIMIT || discarded > depth || length < size) return;
    memcpy(s, buffer, SCANNER_HEADER_SIZE);
    unsigned offset = SCANNER_HEADER_SIZE;
    unsigned bytes = (depth + 1) / 2;
    memcpy(s->certified_openers, buffer + offset, bytes);
    offset += bytes;
    if (discarded) {
        bytes = (depth + 7) / 8;
        memcpy(s->discarded_frames, buffer + offset, bytes);
        memcpy(s->discarded_tildes, buffer + offset + bytes, sizeof(s->discarded_tildes));
    }
}

static TokenType emphasis_token(Scanner *s, TokenType first_token, EmphasisRole role) {
    const TokenType tilde[] = {STRIKETHROUGH_FORCED_OPEN, STRIKETHROUGH_CLOSE, STRIKETHROUGH_LITERAL, STRIKETHROUGH_OPEN};
    return s->run_delimiter == '~' ? tilde[role] : first_token + 3 * s->run_flank + s->run_modulo + 9 * role;
}

static int32_t context_character(uint8_t context) {
    return context == LAST_TOKEN_WHITESPACE ? ' ' : context == LAST_TOKEN_PUNCTUATION ? '.' : 'a';
}

static uint32_t certify_protected_suffix(Scanner *s, TSLexer *lexer, DelimiterProof *proof, uint32_t result) {
    while ((proof->pending_bracket || proof->angle) && proof->budget && !lexer->eof(lexer)) {
        ProofStep step = advance_proof_text(s, lexer, proof);
        if (step == PROOF_UNCERTAIN || step == PROOF_SCOPE_END) return uncertain_proof(s, lexer, proof, false);
        if (step == PROOF_DELIMITER) {
            proof->budget--;
            lexer->advance(lexer, false);
        }
    }
    if ((proof->pending_bracket || proof->angle) && !lexer->eof(lexer)) return uncertain_proof(s, lexer, proof, false);
    s->discard_offset = proof->discard_offset;
    return result;
}

static bool record_discard(Scanner *s) {
    assert(s->run_delimiter == '~');
    if (!push_certified_opener(s)) return false;
    unsigned index = s->certified_depth - 1;
    s->discarded_frames[index / 8] |= 1 << (index % 8);
    index = (s->tilde_cursor + s->discard_offset) % CERTIFIED_LIMIT;
    uint8_t bit = 1 << (index % 8);
    assert(!(s->discarded_tildes[index / 8] & bit));
    s->discarded_tildes[index / 8] |= bit;
    s->discarded_count++;
    s->state |= STATE_EMPHASIS_DELIMITER_IS_OPEN;
    s->discard_offset = 0;
    return true;
}

static bool push_certified_opener(Scanner *s) {
    uint8_t opener = s->run_delimiter == '~' ? 12 + (s->run_modulo == 2 ? 2 : 0) + (s->run_flank == 2)
        : (s->run_delimiter == '_' ? 6 : 0) + (s->run_flank == 2 ? 3 : 0) + s->run_modulo;
    if (s->root_group_opening && s->certified_depth == 1 && certified_opener(s, 0) == opener) {
        s->root_repetitions++;
        return true;
    }
    if (s->certified_depth >= CERTIFIED_LIMIT) return false;
    unsigned index = s->certified_depth++;
    if (!index) s->root_repetitions = 1;
    uint8_t shift = 4 * (index % 2);
    s->certified_openers[index / 2] = (s->certified_openers[index / 2] & ~(15 << shift)) | (opener << shift);
    return true;
}

static bool certified_closer(Scanner *s) {
    unsigned index = s->certified_depth - 1;
    if (s->discarded_frames[index / 8] & (1 << (index % 8))) return false;
    uint8_t opener = certified_opener(s, index);
    return opener_delimiter(opener) == s->run_delimiter &&
        (s->run_delimiter != '~' || (opener >= 14 ? 2 : 1) == s->run_modulo) &&
        delimiter_pair_allowed(opener_can_close(opener), opener_modulo(opener), s->run_flank == 2, s->run_modulo);
}

static uint8_t certified_opener(Scanner *s, unsigned index) {
    return (s->certified_openers[index / 2] >> (4 * (index % 2))) & 15;
}

static bool delimiter_pair_allowed(bool opener_closes, uint8_t opener_modulo,
                                   bool closer_opens, uint8_t closer_modulo) {
    return (!opener_closes && !closer_opens) ||
           (opener_modulo + closer_modulo) % 3 != 0 ||
           (!opener_modulo && !closer_modulo);
}

static bool opener_can_close(uint8_t opener) {
    return opener >= 12 ? opener & 1 : opener % 6 >= 3;
}

static uint8_t opener_modulo(uint8_t opener) {
    return opener >= 12 ? (opener >= 14 ? 2 : 1) : opener % 3;
}

static ProofStep advance_proof_text(Scanner *s, TSLexer *lexer, DelimiterProof *proof) {
    int32_t next = lexer->lookahead;
    if (next == '\\') return read_proof_escape(lexer, proof);
    if (next == '[') return read_proof_bracket(s, lexer, proof);
    if (next == ']' && proof->pending_bracket) return PROOF_UNCERTAIN;
    if (next == ']' && s->flat_head_depth == s->bracket_depth && s->bracket_depth) return PROOF_SCOPE_END;
    if (next == ']' && s->bracket_depth) return PROOF_UNCERTAIN;
    proof->angle = next_angle(proof->angle, next);
    if (next == '>' && proof->angle) return PROOF_UNCERTAIN;
    if (proof_uncertain_character(next)) return PROOF_UNCERTAIN;
    if (next == '*' || next == '_' || (proof->strikethrough && next == '~')) return PROOF_DELIMITER;
    proof->budget--;
    proof->previous = proof->emphasis_previous = next;
    lexer->advance(lexer, false);
    // A `<` inside a tag or processing instruction still belongs to that construct.
    if (next == '<' && !proof->angle) proof->angle = opening_angle(lexer->lookahead);
    return PROOF_TEXT;
}

static ProofAngle opening_angle(int32_t next) {
    if ((next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z') || next == '/' || next == '!' || next == '?') {
        return ANGLE_HTML_OR_URI;
    }
    return is_email_local(next) ? ANGLE_EMAIL_LOCAL : ANGLE_NONE;
}

static ProofAngle next_angle(ProofAngle angle, int32_t next) {
    if (angle == ANGLE_EMAIL_LOCAL) return next == '@' ? ANGLE_EMAIL_DOMAIN : is_email_local(next) ? angle : ANGLE_NONE;
    if (angle != ANGLE_EMAIL_DOMAIN || next == '>' || next == '.' || next == '-') return angle;
    return (next >= '0' && next <= '9') || (next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z') ? angle : ANGLE_NONE;
}

static bool is_email_local(int32_t character) {
    return (character >= '0' && character <= '9') || (character >= 'A' && character <= 'Z') ||
        (character >= 'a' && character <= 'z') || (character > 0 && character < 128 && strchr(".!#$%&'*+/=?^_`{|}~-", character));
}

static bool proof_uncertain_character(int32_t character) {
    return character > 0 && character < 128 && strchr("`$", character);
}

static ProofStep read_proof_bracket(Scanner *s, TSLexer *lexer, DelimiterProof *proof) {
    proof->budget--;
    lexer->advance(lexer, false);
    proof->previous = proof->emphasis_previous = '[';
    if (lexer->lookahead != ']') {
        if (!s->no_closing_bracket) proof->pending_bracket++;
        return PROOF_TEXT;
    }
    if (!proof->budget) return PROOF_UNCERTAIN;
    proof->budget--;
    lexer->advance(lexer, false);
    if (lexer->lookahead == '(' || lexer->lookahead == '[') return PROOF_UNCERTAIN;
    proof->previous = proof->emphasis_previous = ']';
    return PROOF_TEXT;
}

static void read_transparent_tildes(TSLexer *lexer, DelimiterProof *proof,
                                      FutureDelimiter *run, FutureDelimiter *tildes) {
    if (lexer->lookahead == '~') *tildes = read_future_delimiter(&proof->budget, lexer, run->delimiter);
    run->flanks = delimiter_flanks(run->delimiter, is_whitespace(proof->emphasis_previous), is_punctuation(proof->emphasis_previous),
        lexer->eof(lexer) || is_whitespace(lexer->lookahead), is_punctuation(lexer->lookahead));
}

static bool consume_emphasis_run(Scanner *s, TSLexer *lexer, char delimiter,
                                  bool strikethrough, FutureDelimiter *following) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    s->delimiter_adjacent = is_inline_delimiter(lexer->lookahead);
    bool fresh_run = s->run_delimiter != delimiter || !s->num_emphasis_delimiters_left;
    if (fresh_run) read_emphasis_run(s, lexer, delimiter, strikethrough, following);
    else s->num_emphasis_delimiters_left--;
    if (fresh_run && delimiter == '~') {
        lexer->mark_end(lexer);
        advance_tilde(s);
    }
    return fresh_run;
}

static void read_emphasis_run(Scanner *s, TSLexer *lexer, char delimiter,
                               bool strikethrough, FutureDelimiter *following) {
    s->state &= ~STATE_EMPHASIS_DELIMITER_IS_OPEN;
    s->run_suppressed = false;
    s->discard_offset = 0;
    uint32_t count = 1;
    while (lexer->lookahead == delimiter) {
        count++;
        lexer->advance(lexer, false);
    }
    s->delimiter_adjacent = is_inline_delimiter(lexer->lookahead);
    if (strikethrough && delimiter != '~' && lexer->lookahead == '~') {
        unsigned budget = CERTIFIED_LIMIT;
        *following = read_future_delimiter(&budget, lexer, delimiter);
    }
    uint8_t context = delimiter == '~' ? s->context : s->emphasis_context;
    DelimiterFlanks flanks = delimiter_flanks(delimiter, context == LAST_TOKEN_WHITESPACE,
        context == LAST_TOKEN_PUNCTUATION,
        lexer->eof(lexer) || is_whitespace(lexer->lookahead), is_punctuation(lexer->lookahead));
    if (delimiter == '~' && count > 2) flanks = (DelimiterFlanks){0};
    s->run_delimiter = delimiter;
    s->num_emphasis_delimiters_left = count - 1;
    s->run_modulo = count % 3;
    s->run_flank = flanks.can_open ? (flanks.can_close ? 2 : 0) : (flanks.can_close ? 1 : 3);
    s->run_can_open = flanks.can_open;
    s->run_proved = false;
    s->run_open_count = UINT32_MAX;
    s->root_group_opening = !s->certified_depth;
}

static FutureDelimiter read_future_delimiter(unsigned *budget, TSLexer *lexer, int32_t previous) {
    FutureDelimiter run = {.delimiter = (char)lexer->lookahead};
    do {
        run.count++;
        lexer->advance(lexer, false);
        if (*budget) (*budget)--;
        else run.oversized = true;
    } while (lexer->lookahead == run.delimiter);
    run.modulo = run.count % 3;
    run.flanks = delimiter_flanks(run.delimiter, is_whitespace(previous), is_punctuation(previous),
        lexer->eof(lexer) || is_whitespace(lexer->lookahead), is_punctuation(lexer->lookahead));
    if (run.delimiter == '~' && run.count > 2) run.flanks = (DelimiterFlanks){0};
    return run;
}



static bool is_whitespace(int32_t character) {
    return character == ' ' || character == '\t' || character == '\r' || character == '\n';
}

static DelimiterFlanks delimiter_flanks(char delimiter, bool previous_space, bool previous_punctuation,
                                       bool next_space, bool next_punctuation) {
    bool left = !next_space && (!next_punctuation || previous_space || previous_punctuation);
    bool right = !previous_space && (!previous_punctuation || next_space || next_punctuation);
    return (DelimiterFlanks){
        .can_open = left && (delimiter != '_' || !right || previous_punctuation),
        .can_close = right && (delimiter != '_' || !left || next_punctuation),
    };
}

static bool is_inline_delimiter(int32_t character) {
    return character == '*' || character == '_' || character == '~';
}

static void advance_tilde(Scanner *s) {
    s->tilde_cursor = (s->tilde_cursor + 1) % CERTIFIED_LIMIT;
    unsigned index = s->tilde_cursor;
    uint8_t bit = 1 << (index % 8);
    if (!(s->discarded_tildes[index / 8] & bit)) {
        if (!s->discarded_count) s->tilde_cursor = 0;
        return;
    }
    s->discarded_tildes[index / 8] &= ~bit;
    index = --s->certified_depth;
    bit = 1 << (index % 8);
    assert(s->discarded_frames[index / 8] & bit);
    s->discarded_frames[index / 8] &= ~bit;
    s->certified_openers[index / 2] &= ~(15 << (4 * (index % 2)));
    if (!index) s->root_repetitions = 0;
    if (!--s->discarded_count) s->tilde_cursor = 0;
    s->run_suppressed = true;
}

static ProofStep read_proof_escape(TSLexer *lexer, DelimiterProof *proof) {
    proof->budget--;
    lexer->advance(lexer, false);
    proof->previous = proof->emphasis_previous = '\\';
    if (!is_punctuation(lexer->lookahead)) return PROOF_TEXT;
    if (!proof->budget) return PROOF_UNCERTAIN;
    proof->budget--;
    proof->previous = proof->emphasis_previous = lexer->lookahead;
    lexer->advance(lexer, false);
    return PROOF_TEXT;
}

static bool is_punctuation(int32_t chr) {
    return (chr >= '!' && chr <= '/') || (chr >= ':' && chr <= '@') ||
           (chr >= '[' && chr <= '`') || (chr >= '{' && chr <= '~');
}

