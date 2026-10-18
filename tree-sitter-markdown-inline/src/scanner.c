#include "tree_sitter/parser.h"

typedef enum {
    ERROR,
    TRIGGER_ERROR,
    CODE_SPAN_START,
    CODE_SPAN_CLOSE,
    EMPHASIS_OPEN_STAR,
    EMPHASIS_OPEN_UNDERSCORE,
    EMPHASIS_CLOSE_STAR,
    EMPHASIS_CLOSE_UNDERSCORE,
    LAST_TOKEN_WHITESPACE,
    LAST_TOKEN_PUNCTUATION,
    STRIKETHROUGH_OPEN,
    STRIKETHROUGH_CLOSE,
    LATEX_SPAN_START,
    LATEX_SPAN_CLOSE,
    UNCLOSED_SPAN,
    LITERAL_EMPHASIS_RUN
} TokenType;

static bool is_punctuation(int32_t chr) {
    return (chr >= '!' && chr <= '/') || (chr >= ':' && chr <= '@') ||
           (chr >= '[' && chr <= '`') || (chr >= '{' && chr <= '~');
}

static const uint8_t CONTEXT_WORD = 0;
static const uint8_t STATE_EMPHASIS_DELIMITER_IS_OPEN = 0x1 << 2;

static bool error(TSLexer *lexer) {
    lexer->result_symbol = ERROR;
    return true;
}

typedef struct {
    uint8_t state;
    uint8_t context;
    bool context_pending;
    uint8_t code_span_delimiter_length;
    uint8_t latex_span_delimiter_length;
    uint8_t num_emphasis_delimiters_left;
} Scanner;

static unsigned serialize(Scanner *s, char *buffer) {
    unsigned size = 0;
    buffer[size++] = (char)s->state;
    buffer[size++] = (char)s->code_span_delimiter_length;
    buffer[size++] = (char)s->latex_span_delimiter_length;
    buffer[size++] = (char)s->num_emphasis_delimiters_left;
    buffer[size++] = (char)s->context;
    buffer[size++] = s->context_pending;
    return size;
}

static void deserialize(Scanner *s, const char *buffer, unsigned length) {
    s->context = LAST_TOKEN_WHITESPACE;
    s->context_pending = false;
    s->state = 0;
    s->code_span_delimiter_length = 0;
    s->latex_span_delimiter_length = 0;
    s->num_emphasis_delimiters_left = 0;
    if (length >= 6) {
        size_t size = 0;
        s->state = (uint8_t)buffer[size++];
        s->code_span_delimiter_length = (uint8_t)buffer[size++];
        s->latex_span_delimiter_length = (uint8_t)buffer[size++];
        s->num_emphasis_delimiters_left = (uint8_t)buffer[size++];
        s->context = (uint8_t)buffer[size++];
        s->context_pending = buffer[size++];
    }
}

static bool parse_leaf_delimiter(TSLexer *lexer, uint8_t *delimiter_length,
                                 const bool *valid_symbols,
                                 const char delimiter,
                                 const TokenType open_token,
                                 const TokenType close_token) {
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
    if (valid_symbols[open_token]) {
        size_t close_level = 0;
        while (!lexer->eof(lexer)) {
            if (lexer->lookahead == delimiter) {
                close_level++;
            } else {
                if (close_level == level) {
                    break;
                }
                close_level = 0;
            }
            lexer->advance(lexer, false);
        }
        if (close_level == level) {
            *delimiter_length = level;
            lexer->result_symbol = open_token;
            return true;
        }
        if (valid_symbols[UNCLOSED_SPAN]) {
            lexer->result_symbol = UNCLOSED_SPAN;
            return true;
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

static bool parse_emphasis(Scanner *s, TSLexer *lexer, const bool *valid_symbols,
                           char delimiter, TokenType open_token, TokenType close_token) {
    lexer->advance(lexer, false);
    if (s->num_emphasis_delimiters_left > 0) {
        if ((s->state & STATE_EMPHASIS_DELIMITER_IS_OPEN) &&
            valid_symbols[open_token]) {
            s->state &= (~STATE_EMPHASIS_DELIMITER_IS_OPEN);
            lexer->result_symbol = open_token;
            s->num_emphasis_delimiters_left--;
            return true;
        }
        if (valid_symbols[close_token]) {
            lexer->result_symbol = close_token;
            s->num_emphasis_delimiters_left--;
            return true;
        }
    }
    lexer->mark_end(lexer);
    uint8_t delimiter_count = 1;
    while (lexer->lookahead == delimiter) {
        delimiter_count++;
        lexer->advance(lexer, false);
    }
    bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
                    lexer->eof(lexer);
    if (valid_symbols[open_token] ||
        valid_symbols[close_token]) {
        s->num_emphasis_delimiters_left = delimiter_count - 1;
        bool next_symbol_whitespace =
            line_end || lexer->lookahead == ' ' || lexer->lookahead == '\t';
        bool next_symbol_punctuation = is_punctuation(lexer->lookahead);
        if (valid_symbols[close_token] &&
            s->context != LAST_TOKEN_WHITESPACE &&
            (s->context != LAST_TOKEN_PUNCTUATION ||
             next_symbol_punctuation || next_symbol_whitespace)) {
            s->state &= ~STATE_EMPHASIS_DELIMITER_IS_OPEN;
            lexer->result_symbol = close_token;
            return true;
        }
        if (!next_symbol_whitespace && (!next_symbol_punctuation ||
                                        (s->context == LAST_TOKEN_PUNCTUATION) ||
                                        (s->context == LAST_TOKEN_WHITESPACE))) {
            s->state |= STATE_EMPHASIS_DELIMITER_IS_OPEN;
            lexer->result_symbol = open_token;
            return true;
        }
    }
    if (valid_symbols[LITERAL_EMPHASIS_RUN]) {
        s->num_emphasis_delimiters_left = 0;
        lexer->mark_end(lexer);
        lexer->result_symbol = LITERAL_EMPHASIS_RUN;
        return true;
    }
    return false;
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[TRIGGER_ERROR]) {
        return error(lexer);
    }

    if (!s->context_pending) {
        s->context = CONTEXT_WORD;
    }
    const TokenType contexts[] = {LAST_TOKEN_WHITESPACE, LAST_TOKEN_PUNCTUATION};
    for (unsigned i = 0; i < 2; i++) {
        if ((!s->context_pending || s->context != contexts[i]) &&
            valid_symbols[contexts[i]] && valid_symbols[LITERAL_EMPHASIS_RUN] &&
            (lexer->lookahead == '*' || lexer->lookahead == '_' || lexer->lookahead == '~')) {
            s->context = contexts[i];
            s->context_pending = true;
            lexer->result_symbol = contexts[i];
            lexer->mark_end(lexer);
            return true;
        }
    }

    bool result = false;
    switch (lexer->lookahead) {
        case '`':
            result = parse_backtick(s, lexer, valid_symbols);
            break;
        case '$':
            result = parse_dollar(s, lexer, valid_symbols);
            break;
        case '*':
            result = parse_emphasis(s, lexer, valid_symbols, '*', EMPHASIS_OPEN_STAR, EMPHASIS_CLOSE_STAR);
            break;
        case '_':
            result = parse_emphasis(s, lexer, valid_symbols, '_', EMPHASIS_OPEN_UNDERSCORE, EMPHASIS_CLOSE_UNDERSCORE);
            break;
        case '~':
            result = parse_emphasis(s, lexer, valid_symbols, '~', STRIKETHROUGH_OPEN, STRIKETHROUGH_CLOSE);
            break;
    }
    if (result) {
        s->context_pending = false;
    }
    return result;
}

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
