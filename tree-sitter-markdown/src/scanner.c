#include "tree_sitter/parser.h"
#include <assert.h>
#include <ctype.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>

// For explanation of the tokens see grammar.js
typedef enum {
    LINE_ENDING,
    SOFT_LINE_ENDING,
    BLOCK_CLOSE,
    BLOCK_CONTINUATION,
    BLOCK_QUOTE_START,
    INDENTED_CHUNK_START,
    ATX_H1_MARKER,
    ATX_H2_MARKER,
    ATX_H3_MARKER,
    ATX_H4_MARKER,
    ATX_H5_MARKER,
    ATX_H6_MARKER,
    SETEXT_H1_UNDERLINE,
    SETEXT_H2_UNDERLINE,
    THEMATIC_BREAK,
    LIST_MARKER_MINUS,
    LIST_MARKER_PLUS,
    LIST_MARKER_STAR,
    LIST_MARKER_PARENTHESIS,
    LIST_MARKER_DOT,
    LIST_MARKER_MINUS_DONT_INTERRUPT,
    LIST_MARKER_PLUS_DONT_INTERRUPT,
    LIST_MARKER_STAR_DONT_INTERRUPT,
    LIST_MARKER_PARENTHESIS_DONT_INTERRUPT,
    LIST_MARKER_DOT_DONT_INTERRUPT,
    FENCED_CODE_BLOCK_START_BACKTICK,
    FENCED_CODE_BLOCK_START_TILDE,
    BLANK_LINE_START,
    FENCED_CODE_BLOCK_END_BACKTICK,
    FENCED_CODE_BLOCK_END_TILDE,
    HTML_BLOCK_1_START,
    HTML_BLOCK_1_END,
    HTML_BLOCK_2_START,
    HTML_BLOCK_3_START,
    HTML_BLOCK_4_START,
    HTML_BLOCK_5_START,
    HTML_BLOCK_6_START,
    HTML_BLOCK_7_START,
    CLOSE_BLOCK,
    NO_INDENTED_CHUNK,
    ERROR,
    TRIGGER_ERROR,
    TOKEN_EOF,
    MINUS_METADATA,
    PLUS_METADATA,
    PIPE_TABLE_START,
    PIPE_TABLE_LINE_ENDING,
    CODE_FENCE_LINE,
    ATX_HEADING_CLOSING_SEQUENCE,
    LIST_BLANK_GUARD,
    LIST_BLANK_SEPARATOR,
    LIST_ITEM_PREFIX,
} TokenType;

// Description of a block on the block stack.
//
// LIST_ITEM is a list item with minimal indentation (content begins at indent
// level 2) while LIST_ITEM_MAX_INDENTATION represents a list item with maximal
// indentation without being considered a indented code block.
//
// ANONYMOUS represents any block that whose close is not handled by the
// external s.
typedef enum {
    BLOCK_QUOTE,
    INDENTED_CODE_BLOCK,
    LIST_ITEM,
    LIST_ITEM_1_INDENTATION,
    LIST_ITEM_2_INDENTATION,
    LIST_ITEM_3_INDENTATION,
    LIST_ITEM_4_INDENTATION,
    LIST_ITEM_5_INDENTATION,
    LIST_ITEM_6_INDENTATION,
    LIST_ITEM_7_INDENTATION,
    LIST_ITEM_8_INDENTATION,
    LIST_ITEM_9_INDENTATION,
    LIST_ITEM_10_INDENTATION,
    LIST_ITEM_11_INDENTATION,
    LIST_ITEM_12_INDENTATION,
    LIST_ITEM_13_INDENTATION,
    LIST_ITEM_14_INDENTATION,
    LIST_ITEM_MAX_INDENTATION,
    FENCED_CODE_BLOCK,
    ANONYMOUS,
} Block;

// Determines if a character is punctuation as defined by the markdown spec.
static bool is_punctuation(char chr) {
    return (chr >= '!' && chr <= '/') || (chr >= ':' && chr <= '@') ||
           (chr >= '[' && chr <= '`') || (chr >= '{' && chr <= '~');
}

// Returns the indentation level which lines of a list item should have at
// minimum. Should only be called with blocks for which `is_list_item` returns
// true.
static uint8_t list_item_indentation(Block block) {
    return (uint8_t)(block - LIST_ITEM + 2);
}

#define NUM_HTML_TAG_NAMES_RULE_1 3

static const char *const HTML_TAG_NAMES_RULE_1[NUM_HTML_TAG_NAMES_RULE_1] = {
    "pre", "script", "style"};

#define NUM_HTML_TAG_NAMES_RULE_7 62

static const char *const HTML_TAG_NAMES_RULE_7[NUM_HTML_TAG_NAMES_RULE_7] = {
    "address",  "article",    "aside",  "base",     "basefont", "blockquote",
    "body",     "caption",    "center", "col",      "colgroup", "dd",
    "details",  "dialog",     "dir",    "div",      "dl",       "dt",
    "fieldset", "figcaption", "figure", "footer",   "form",     "frame",
    "frameset", "h1",         "h2",     "h3",       "h4",       "h5",
    "h6",       "head",       "header", "hr",       "html",     "iframe",
    "legend",   "li",         "link",   "main",     "menu",     "menuitem",
    "nav",      "noframes",   "ol",     "optgroup", "option",   "p",
    "param",    "section",    "source", "summary",  "table",    "tbody",
    "td",       "tfoot",      "th",     "thead",    "title",    "tr",
    "track",    "ul"};

// For explanation of the tokens see grammar.js
static const bool paragraph_interrupt_symbols[] = {
    false, // LINE_ENDING,
    false, // SOFT_LINE_ENDING,
    false, // BLOCK_CLOSE,
    false, // BLOCK_CONTINUATION,
    true,  // BLOCK_QUOTE_START,
    false, // INDENTED_CHUNK_START,
    true,  // ATX_H1_MARKER,
    true,  // ATX_H2_MARKER,
    true,  // ATX_H3_MARKER,
    true,  // ATX_H4_MARKER,
    true,  // ATX_H5_MARKER,
    true,  // ATX_H6_MARKER,
    true,  // SETEXT_H1_UNDERLINE,
    true,  // SETEXT_H2_UNDERLINE,
    true,  // THEMATIC_BREAK,
    true,  // LIST_MARKER_MINUS,
    true,  // LIST_MARKER_PLUS,
    true,  // LIST_MARKER_STAR,
    true,  // LIST_MARKER_PARENTHESIS,
    true,  // LIST_MARKER_DOT,
    false, // LIST_MARKER_MINUS_DONT_INTERRUPT,
    false, // LIST_MARKER_PLUS_DONT_INTERRUPT,
    false, // LIST_MARKER_STAR_DONT_INTERRUPT,
    false, // LIST_MARKER_PARENTHESIS_DONT_INTERRUPT,
    false, // LIST_MARKER_DOT_DONT_INTERRUPT,
    true,  // FENCED_CODE_BLOCK_START_BACKTICK,
    true,  // FENCED_CODE_BLOCK_START_TILDE,
    true,  // BLANK_LINE_START,
    false, // FENCED_CODE_BLOCK_END_BACKTICK,
    false, // FENCED_CODE_BLOCK_END_TILDE,
    true,  // HTML_BLOCK_1_START,
    false, // HTML_BLOCK_1_END,
    true,  // HTML_BLOCK_2_START,
    true,  // HTML_BLOCK_3_START,
    true,  // HTML_BLOCK_4_START,
    true,  // HTML_BLOCK_5_START,
    true,  // HTML_BLOCK_6_START,
    false, // HTML_BLOCK_7_START,
    false, // CLOSE_BLOCK,
    false, // NO_INDENTED_CHUNK,
    false, // ERROR,
    false, // TRIGGER_ERROR,
    false, // EOF,
    false, // MINUS_METADATA,
    false, // PLUS_METADATA,
    true,  // PIPE_TABLE_START,
    false, // PIPE_TABLE_LINE_ENDING,
    false, // CODE_FENCE_LINE,
    false, // ATX_HEADING_CLOSING_SEQUENCE,
    false, // LIST_BLANK_GUARD,
    false, // LIST_BLANK_SEPARATOR,
    false, // LIST_ITEM_PREFIX,
};
_Static_assert(sizeof(paragraph_interrupt_symbols) / sizeof(bool) ==
                   LIST_ITEM_PREFIX + 1,
               "paragraph interruption symbols cover every external token");

// State bitflags used with `Scanner.state`

// Currently matching (at the beginning of a line)
static const uint8_t STATE_MATCHING = 0x1 << 0;
// Last line break was inside a paragraph
static const uint8_t STATE_WAS_SOFT_LINE_BREAK = 0x1 << 1;
static const uint8_t STATE_BLANK_CONTINUES = 0x4;
// Block should be closed after next line break
static const uint8_t STATE_CLOSE_BLOCK = 0x1 << 4;

static size_t roundup_32(size_t x) {
    x--;

    x |= x >> 1;
    x |= x >> 2;
    x |= x >> 4;
    x |= x >> 8;
    x |= x >> 16;

    x++;

    return x;
}

typedef struct {
    // A stack of open blocks in the current parse state
    struct {
        size_t size;
        size_t capacity;
        Block *items;
    } open_blocks;

    // Parser state flags
    uint8_t state;
    // Number of blocks that have been matched so far. Only changes during
    // matching and is reset after every line ending
    uint8_t matched;
    // Consumed but "unused" indentation. Sometimes a tab needs to be "split" to
    // be used in multiple tokens.
    uint8_t indentation;
    // The current column. Used to decide how many spaces a tab should equal
    uint8_t column;
    // The delimiter length of the currently open fenced code block
    uint8_t fenced_code_block_delimiter_length;

    bool simulate;
} Scanner;

_Static_assert(5 + 2 * UINT8_MAX <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE, "block state must fit");

static bool push_block(Scanner *s, Block b) {
    if (s->simulate) return s->matched < UINT8_MAX;
    if (s->open_blocks.size >= UINT8_MAX) return false;
    if (s->open_blocks.size == s->open_blocks.capacity) {
        s->open_blocks.capacity =
            s->open_blocks.capacity ? s->open_blocks.capacity << 1 : 8;
        void *tmp = realloc(s->open_blocks.items,
                            sizeof(Block) * s->open_blocks.capacity);
        assert(tmp != NULL);
        s->open_blocks.items = tmp;
    }

    s->open_blocks.items[s->open_blocks.size++] = b;
    return true;
}

static inline Block pop_block(Scanner *s) {
    return s->open_blocks.items[--s->open_blocks.size];
}

static unsigned serialize(Scanner *s, char *buffer) {
    unsigned size = 0;
    buffer[size++] = (char)s->state;
    buffer[size++] = (char)s->matched;
    buffer[size++] = (char)s->indentation;
    buffer[size++] = (char)s->column;
    buffer[size++] = (char)s->fenced_code_block_delimiter_length;
    for (size_t i = 0; i < s->open_blocks.size; i++) {
        unsigned block = s->open_blocks.items[i];
        buffer[size++] = (char)block;
        buffer[size++] = (char)(block >> 8);
    }
    return size;
}

static void deserialize(Scanner *s, const char *buffer, unsigned length) {
    s->open_blocks.size = 0;
    s->state = 0;
    s->matched = 0;
    s->indentation = 0;
    s->column = 0;
    s->fenced_code_block_delimiter_length = 0;
    if (length > 0) {
        size_t size = 0;
        s->state = (uint8_t)buffer[size++];
        s->matched = (uint8_t)buffer[size++];
        s->indentation = (uint8_t)buffer[size++];
        s->column = (uint8_t)buffer[size++];
        s->fenced_code_block_delimiter_length = (uint8_t)buffer[size++];
        size_t blocks_size = length - size;
        if (blocks_size > 0) {
            size_t blocks_count = blocks_size / 2;

            if (s->open_blocks.capacity < blocks_count) {
              size_t capacity = roundup_32(blocks_count);
              void *tmp = realloc(s->open_blocks.items,
                            sizeof(Block) * capacity);
              assert(tmp != NULL);
              s->open_blocks.items = tmp;
              s->open_blocks.capacity = capacity;
            }
            for (size_t i = 0; i < blocks_count; i++) {
                unsigned block = (uint8_t)buffer[size++];
                block |= (unsigned)(uint8_t)buffer[size++] << 8;
                s->open_blocks.items[i] = (Block)block;
            }
            s->open_blocks.size = blocks_count;
        }
    }
}

static void mark_end(Scanner *s, TSLexer *lexer) {
    if (!s->simulate) {
        lexer->mark_end(lexer);
    }
}

// Convenience function to emit the error token. This is done to stop invalid
// parse branches. Specifically:
// 1. When encountering a newline after a line break that ended a paragraph, and
// no new block
//    has been opened.
// 2. When encountering a new block after a soft line break.
// 3. When a `$._trigger_error` token is valid, which is used to stop parse
// branches through
//    normal tree-sitter grammar rules.
//
// See also the `$._soft_line_break` and `$._paragraph_end_newline` tokens in
// grammar.js
static bool error(TSLexer *lexer) {
    lexer->result_symbol = ERROR;
    return true;
}

// Advance the lexer one character
// Also keeps track of the current column, counting tabs as spaces with tab stop
// 4 See https://github.github.com/gfm/#tabs
static size_t advance(Scanner *s, TSLexer *lexer) {
    size_t size = 1;
    if (lexer->lookahead == '\t') {
        size = 4 - s->column;
        s->column = 0;
    } else {
        s->column = (s->column + 1) % 4;
    }
    lexer->advance(lexer, false);
    return size;
}

// Try to match the given block, i.e. consume all tokens that belong to the
// block. These are
// 1. indentation for list items and indented code blocks
// 2. '>' for block quotes
// Returns true if the block is matched and false otherwise
static bool match(Scanner *s, TSLexer *lexer, Block block) {
    switch (block) {
        case INDENTED_CODE_BLOCK:
            while (s->indentation < 4) {
                if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    s->indentation += advance(s, lexer);
                } else {
                    break;
                }
            }
            if (s->indentation >= 4 && lexer->lookahead != '\n' &&
                lexer->lookahead != '\r') {
                s->indentation -= 4;
                return true;
            }
            break;
        case LIST_ITEM:
        case LIST_ITEM_1_INDENTATION:
        case LIST_ITEM_2_INDENTATION:
        case LIST_ITEM_3_INDENTATION:
        case LIST_ITEM_4_INDENTATION:
        case LIST_ITEM_5_INDENTATION:
        case LIST_ITEM_6_INDENTATION:
        case LIST_ITEM_7_INDENTATION:
        case LIST_ITEM_8_INDENTATION:
        case LIST_ITEM_9_INDENTATION:
        case LIST_ITEM_10_INDENTATION:
        case LIST_ITEM_11_INDENTATION:
        case LIST_ITEM_12_INDENTATION:
        case LIST_ITEM_13_INDENTATION:
        case LIST_ITEM_14_INDENTATION:
        case LIST_ITEM_MAX_INDENTATION:
            while (s->indentation < list_item_indentation(block)) {
                if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    s->indentation += advance(s, lexer);
                } else {
                    break;
                }
            }
            if (s->indentation >= list_item_indentation(block)) {
                s->indentation -= list_item_indentation(block);
                return true;
            }
            if (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
                s->indentation = 0;
                return true;
            }
            break;
        case BLOCK_QUOTE:
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                s->indentation += advance(s, lexer);
            }
            if (lexer->lookahead == '>') {
                advance(s, lexer);
                s->indentation = 0;
                if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    s->indentation += advance(s, lexer) - 1;
                }
                return true;
            }
            break;
        case FENCED_CODE_BLOCK:
        case ANONYMOUS:
            return true;
    }
    return false;
}

static bool parse_fenced_code_block(Scanner *s, const char delimiter,
                                    TSLexer *lexer, const bool *valid_symbols) {
    uint8_t level = 0;
    while (lexer->lookahead == delimiter) {
        advance(s, lexer);
        level++;
    }
    mark_end(s, lexer);
    // If this is able to close a fenced code block then that is the only valid
    // interpretation. It can only close a fenced code block if the number of
    // backticks is at least the number of backticks of the opening delimiter.
    // Also it cannot be indented more than 3 spaces.
    if ((delimiter == '`' ? valid_symbols[FENCED_CODE_BLOCK_END_BACKTICK]
                          : valid_symbols[FENCED_CODE_BLOCK_END_TILDE]) &&
        s->indentation < 4 && level >= s->fenced_code_block_delimiter_length) {
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(s, lexer);
        }
        if (lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
            lexer->eof(lexer)) {
            s->fenced_code_block_delimiter_length = 0;
            lexer->result_symbol = delimiter == '`'
                                       ? FENCED_CODE_BLOCK_END_BACKTICK
                                       : FENCED_CODE_BLOCK_END_TILDE;
            return true;
        }
    }
    if (level < 3 ||
        !(delimiter == '`' ? valid_symbols[FENCED_CODE_BLOCK_START_BACKTICK]
                          : valid_symbols[FENCED_CODE_BLOCK_START_TILDE])) {
        return false;
    }
    if (delimiter == '`') {
        while (lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
               !lexer->eof(lexer)) {
            if (lexer->lookahead == '`') {
                return false;
            }
            advance(s, lexer);
        }
    }
    lexer->result_symbol = delimiter == '`'
                               ? FENCED_CODE_BLOCK_START_BACKTICK
                               : FENCED_CODE_BLOCK_START_TILDE;
    if (!push_block(s, FENCED_CODE_BLOCK)) return false;
    s->fenced_code_block_delimiter_length = level;
    s->indentation = 0;
    return true;
}

static bool push_list_item(Scanner *s, uint8_t extra_indentation, size_t marker_digits);

static bool parse_star(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    advance(s, lexer);
    mark_end(s, lexer);
    // Otherwise count the number of stars permitting whitespaces between them.
    size_t star_count = 1;
    // Also remember how many stars there are before the first whitespace...
    // ...and how many spaces follow the first star.
    uint8_t extra_indentation = 0;
    for (;;) {
        if (lexer->lookahead == '*') {
            if (star_count == 1 && extra_indentation >= 1 &&
                valid_symbols[LIST_MARKER_STAR]) {
                // If we get to this point then the token has to be at least
                // this long. We need to call `mark_end` here in case we decide
                // later that this is a list item.
                mark_end(s, lexer);
            }
            star_count++;
            advance(s, lexer);
        } else if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            if (star_count == 1) {
                extra_indentation += advance(s, lexer);
            } else {
                advance(s, lexer);
            }
        } else {
            break;
        }
    }
    bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->eof(lexer);
    bool dont_interrupt = false;
    if (star_count == 1 && line_end) {
        extra_indentation = 1;
        // line is empty so don't interrupt paragraphs if this is a list marker
        dont_interrupt = s->matched == s->open_blocks.size;
    }
    // If there were at least 3 stars then this could be a thematic break
    bool thematic_break = star_count >= 3 && line_end;
    // If there was a star and at least one space after that star then this
    // could be a list marker.
    bool list_marker_star = star_count >= 1 && extra_indentation >= 1;
    if (valid_symbols[THEMATIC_BREAK] && thematic_break && s->indentation < 4) {
        // If a thematic break is valid then it takes precedence
        lexer->result_symbol = THEMATIC_BREAK;
        mark_end(s, lexer);
        s->indentation = 0;
        return true;
    }
    if (!(dont_interrupt ? valid_symbols[LIST_MARKER_STAR_DONT_INTERRUPT]
                         : valid_symbols[LIST_MARKER_STAR]) || !list_marker_star) {
        return false;
    }
    if (star_count == 1) {
        mark_end(s, lexer);
    }
    if (!push_list_item(s, extra_indentation - 1, 0)) return false;
    lexer->result_symbol =
        dont_interrupt ? LIST_MARKER_STAR_DONT_INTERRUPT : LIST_MARKER_STAR;
    return true;
}

static bool parse_thematic_break_underscore(Scanner *s, TSLexer *lexer,
                                            const bool *valid_symbols) {
    advance(s, lexer);
    mark_end(s, lexer);
    size_t underscore_count = 1;
    for (;;) {
        if (lexer->lookahead == '_') {
            underscore_count++;
            advance(s, lexer);
        } else if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(s, lexer);
        } else {
            break;
        }
    }
    bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->eof(lexer);
    if (underscore_count >= 3 && line_end && valid_symbols[THEMATIC_BREAK]) {
        lexer->result_symbol = THEMATIC_BREAK;
        mark_end(s, lexer);
        s->indentation = 0;
        return true;
    }
    return false;
}

static bool parse_block_quote(Scanner *s, TSLexer *lexer,
                              const bool *valid_symbols) {
    if (valid_symbols[BLOCK_QUOTE_START]) {
        advance(s, lexer);
        s->indentation = 0;
        if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            s->indentation += advance(s, lexer) - 1;
        }
        lexer->result_symbol = BLOCK_QUOTE_START;
        if (!push_block(s, BLOCK_QUOTE)) return false;
        return true;
    }
    return false;
}

static bool parse_atx_heading_closing_sequence(Scanner *s, TSLexer *lexer) {
    while (lexer->lookahead == '#') advance(s, lexer);
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(s, lexer);
    if (lexer->lookahead != '\n' && lexer->lookahead != '\r' && !lexer->eof(lexer)) return false;
    mark_end(s, lexer);
    lexer->result_symbol = ATX_HEADING_CLOSING_SEQUENCE;
    return true;
}

static bool parse_atx_heading(Scanner *s, TSLexer *lexer,
                              const bool *valid_symbols) {
    if (valid_symbols[ATX_H1_MARKER] && s->indentation <= 3) {
        mark_end(s, lexer);
        uint16_t level = 0;
        while (lexer->lookahead == '#' && level <= 6) {
            advance(s, lexer);
            level++;
        }
        if (level <= 6 &&
            (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
             lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->eof(lexer))) {
            lexer->result_symbol = ATX_H1_MARKER + (level - 1);
            s->indentation = 0;
            mark_end(s, lexer);
            return true;
        }
    }
    return false;
}

static bool parse_setext_underline(Scanner *s, TSLexer *lexer,
                                   const bool *valid_symbols) {
    if (valid_symbols[SETEXT_H1_UNDERLINE] &&
        s->matched == s->open_blocks.size) {
        mark_end(s, lexer);
        while (lexer->lookahead == '=') {
            advance(s, lexer);
        }
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(s, lexer);
        }
        if (lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->eof(lexer)) {
            lexer->result_symbol = SETEXT_H1_UNDERLINE;
            mark_end(s, lexer);
            return true;
        }
    }
    return false;
}

static bool parse_plus(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (s->indentation <= 3 &&
        (valid_symbols[LIST_MARKER_PLUS] ||
         valid_symbols[LIST_MARKER_PLUS_DONT_INTERRUPT] ||
         valid_symbols[PLUS_METADATA])) {
        advance(s, lexer);
        if (valid_symbols[PLUS_METADATA] && lexer->lookahead == '+') {
            advance(s, lexer);
            if (lexer->lookahead != '+') {
                return false;
            }
            advance(s, lexer);
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                advance(s, lexer);
            }
            if (lexer->lookahead != '\n' && lexer->lookahead != '\r') {
                return false;
            }
            for (;;) {
                // advance over newline
                if (lexer->lookahead == '\r') {
                    advance(s, lexer);
                    if (lexer->lookahead == '\n') {
                        advance(s, lexer);
                    }
                } else {
                    advance(s, lexer);
                }
                // check for pluses
                size_t plus_count = 0;
                while (lexer->lookahead == '+') {
                    plus_count++;
                    advance(s, lexer);
                }
                if (plus_count == 3) {
                    // if exactly 3 check if next symbol (after eventual
                    // whitespace) is newline
                    while (lexer->lookahead == ' ' ||
                           lexer->lookahead == '\t') {
                        advance(s, lexer);
                    }
                    if (lexer->lookahead == '\r' || lexer->lookahead == '\n') {
                        // if so also consume newline
                        if (lexer->lookahead == '\r') {
                            advance(s, lexer);
                            if (lexer->lookahead == '\n') {
                                advance(s, lexer);
                            }
                        } else {
                            advance(s, lexer);
                        }
                        mark_end(s, lexer);
                        lexer->result_symbol = PLUS_METADATA;
                        return true;
                    }
                }
                // otherwise consume rest of line
                while (lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
                       !lexer->eof(lexer)) {
                    advance(s, lexer);
                }
                // if end of file is reached, then this is not metadata
                if (lexer->eof(lexer)) {
                    break;
                }
            }
        } else {
            uint8_t extra_indentation = 0;
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                extra_indentation += advance(s, lexer);
            }
            bool dont_interrupt = false;
            if (lexer->lookahead == '\r' || lexer->lookahead == '\n' || lexer->eof(lexer)) {
                extra_indentation = 1;
                dont_interrupt = true;
            }
            dont_interrupt =
                dont_interrupt && s->matched == s->open_blocks.size;
            if (extra_indentation >= 1 &&
                (dont_interrupt ? valid_symbols[LIST_MARKER_PLUS_DONT_INTERRUPT]
                                : valid_symbols[LIST_MARKER_PLUS])) {
                lexer->result_symbol = dont_interrupt
                                           ? LIST_MARKER_PLUS_DONT_INTERRUPT
                                           : LIST_MARKER_PLUS;
                if (!push_list_item(s, extra_indentation - 1, 0)) return false;
                return true;
            }
        }
    }
    return false;
}

static bool parse_ordered_list_marker(Scanner *s, TSLexer *lexer,
                                      const bool *valid_symbols) {
    if (s->indentation > 3 ||
        !(valid_symbols[LIST_MARKER_PARENTHESIS] ||
          valid_symbols[LIST_MARKER_DOT] ||
          valid_symbols[LIST_MARKER_PARENTHESIS_DONT_INTERRUPT] ||
          valid_symbols[LIST_MARKER_DOT_DONT_INTERRUPT])) {
        return false;
    }
    size_t digits = 1;
    uint32_t start_number = (uint32_t)(lexer->lookahead - '0');
    advance(s, lexer);
    while (lexer->lookahead >= '0' && lexer->lookahead <= '9') {
        if (++digits > 9) return false;
        start_number = start_number * 10 + (uint32_t)(lexer->lookahead - '0');
        advance(s, lexer);
    }
    if (lexer->lookahead != '.' && lexer->lookahead != ')') {
        return false;
    }
    bool dont_interrupt = start_number != 1;
    bool dot = lexer->lookahead == '.';
    advance(s, lexer);
    uint8_t extra_indentation = 0;
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        extra_indentation += advance(s, lexer);
    }
    if (lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->eof(lexer)) {
        extra_indentation = 1;
        dont_interrupt = true;
    }
    dont_interrupt = dont_interrupt && s->matched == s->open_blocks.size;
    int marker = dot ? LIST_MARKER_DOT : LIST_MARKER_PARENTHESIS;
    int non_interrupting_marker = dot ? LIST_MARKER_DOT_DONT_INTERRUPT
                                                : LIST_MARKER_PARENTHESIS_DONT_INTERRUPT;
    if (extra_indentation < 1 ||
        !valid_symbols[dont_interrupt ? non_interrupting_marker : marker]) {
        return false;
    }
    lexer->result_symbol = marker;
    if (!push_list_item(s, extra_indentation - 1, digits)) return false;
    return true;
}

static bool parse_minus(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if (s->indentation <= 3 &&
        (valid_symbols[LIST_MARKER_MINUS] ||
         valid_symbols[LIST_MARKER_MINUS_DONT_INTERRUPT] ||
         valid_symbols[SETEXT_H2_UNDERLINE] || valid_symbols[THEMATIC_BREAK] ||
         valid_symbols[MINUS_METADATA])) {
        mark_end(s, lexer);
        bool whitespace_after_minus = false;
        bool minus_after_whitespace = false;
        size_t minus_count = 0;
        uint8_t extra_indentation = 0;

        for (;;) {
            if (lexer->lookahead == '-') {
                if (minus_count == 1 && extra_indentation >= 1) {
                    mark_end(s, lexer);
                }
                minus_count++;
                advance(s, lexer);
                minus_after_whitespace = whitespace_after_minus;
            } else if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                if (minus_count == 1) {
                    extra_indentation += advance(s, lexer);
                } else {
                    advance(s, lexer);
                }
                whitespace_after_minus = true;
            } else {
                break;
            }
        }
        bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r';
        bool rest_empty = line_end || lexer->eof(lexer);
        bool dont_interrupt = false;
        if (minus_count == 1 && rest_empty) {
            extra_indentation = 1;
            dont_interrupt = true;
        }
        dont_interrupt = dont_interrupt && s->matched == s->open_blocks.size;
        bool thematic_break = minus_count >= 3 && rest_empty;
        bool underline =
            minus_count >= 1 && !minus_after_whitespace && rest_empty &&
            s->matched ==
                s->open_blocks
                    .size; // setext heading can not break lazy continuation
        bool list_marker_minus = minus_count >= 1 && extra_indentation >= 1;
        bool success = false;
        if (valid_symbols[SETEXT_H2_UNDERLINE] && underline) {
            lexer->result_symbol = SETEXT_H2_UNDERLINE;
            mark_end(s, lexer);
            s->indentation = 0;
            success = true;
        } else if (valid_symbols[THEMATIC_BREAK] &&
                   thematic_break) { // underline is false if list_marker_minus
                                     // is true
            lexer->result_symbol = THEMATIC_BREAK;
            mark_end(s, lexer);
            s->indentation = 0;
            success = true;
        } else if ((dont_interrupt
                        ? valid_symbols[LIST_MARKER_MINUS_DONT_INTERRUPT]
                        : valid_symbols[LIST_MARKER_MINUS]) &&
                   list_marker_minus) {
            if (minus_count == 1) {
                mark_end(s, lexer);
            }
            if (!push_list_item(s, extra_indentation - 1, 0)) return false;
            lexer->result_symbol = dont_interrupt
                                       ? LIST_MARKER_MINUS_DONT_INTERRUPT
                                       : LIST_MARKER_MINUS;
            return true;
        }
        if (minus_count == 3 && (!minus_after_whitespace) && line_end &&
            valid_symbols[MINUS_METADATA]) {
            for (;;) {
                // advance over newline
                if (lexer->lookahead == '\r') {
                    advance(s, lexer);
                    if (lexer->lookahead == '\n') {
                        advance(s, lexer);
                    }
                } else {
                    advance(s, lexer);
                }
                // check for minuses
                minus_count = 0;
                while (lexer->lookahead == '-') {
                    minus_count++;
                    advance(s, lexer);
                }
                if (minus_count == 3) {
                    // if exactly 3 check if next symbol (after eventual
                    // whitespace) is newline
                    while (lexer->lookahead == ' ' ||
                           lexer->lookahead == '\t') {
                        advance(s, lexer);
                    }
                    if (lexer->lookahead == '\r' || lexer->lookahead == '\n') {
                        // if so also consume newline
                        if (lexer->lookahead == '\r') {
                            advance(s, lexer);
                            if (lexer->lookahead == '\n') {
                                advance(s, lexer);
                            }
                        } else {
                            advance(s, lexer);
                        }
                        mark_end(s, lexer);
                        lexer->result_symbol = MINUS_METADATA;
                        return true;
                    }
                }
                // otherwise consume rest of line
                while (lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
                       !lexer->eof(lexer)) {
                    advance(s, lexer);
                }
                // if end of file is reached, then this is not metadata
                if (lexer->eof(lexer)) {
                    break;
                }
            }
        }
        if (success) {
            return true;
        }
    }
    return false;
}

static bool push_list_item(Scanner *s, uint8_t extra_indentation, size_t marker_digits) {
    if (extra_indentation <= 3) {
        extra_indentation += s->indentation;
        s->indentation = 0;
    } else {
        uint8_t marker_indentation = s->indentation;
        s->indentation = extra_indentation;
        extra_indentation = marker_indentation;
    }
    return push_block(s, (Block)(LIST_ITEM + extra_indentation + marker_digits));
}

static bool parse_html_block(Scanner *s, TSLexer *lexer,
                             const bool *valid_symbols) {
    if (!(valid_symbols[HTML_BLOCK_1_START] ||
          valid_symbols[HTML_BLOCK_1_END] ||
          valid_symbols[HTML_BLOCK_2_START] ||
          valid_symbols[HTML_BLOCK_3_START] ||
          valid_symbols[HTML_BLOCK_4_START] ||
          valid_symbols[HTML_BLOCK_5_START] ||
          valid_symbols[HTML_BLOCK_6_START] ||
          valid_symbols[HTML_BLOCK_7_START])) {
        return false;
    }
    advance(s, lexer);
    if (lexer->lookahead == '?' && valid_symbols[HTML_BLOCK_3_START]) {
        advance(s, lexer);
        lexer->result_symbol = HTML_BLOCK_3_START;
        if (!push_block(s, ANONYMOUS)) return false;
        return true;
    }
    if (lexer->lookahead == '!') {
        // could be block 2
        advance(s, lexer);
        if (lexer->lookahead == '-') {
            // Block 2 ends at the first `-->`, which may overlap the opening
            // `<!--` as in `<!-->` and `<!--->`. For those, end the token
            // after `<!` so that the closing `-->` is left for the block.
            mark_end(s, lexer);
            uint8_t column = s->column;
            advance(s, lexer);
            if (lexer->lookahead != '-' || !valid_symbols[HTML_BLOCK_2_START]) {
                return false;
            }
            advance(s, lexer);
            if (lexer->lookahead == '>' || lexer->lookahead == '-') {
                s->column = column;
            } else {
                mark_end(s, lexer);
            }
            lexer->result_symbol = HTML_BLOCK_2_START;
            if (!push_block(s, ANONYMOUS)) return false;
            return true;
        } else if ('A' <= lexer->lookahead && lexer->lookahead <= 'Z' &&
                   valid_symbols[HTML_BLOCK_4_START]) {
            advance(s, lexer);
            lexer->result_symbol = HTML_BLOCK_4_START;
            if (!push_block(s, ANONYMOUS)) return false;
            return true;
        } else if (lexer->lookahead == '[') {
            advance(s, lexer);
            if (lexer->lookahead == 'C') {
                advance(s, lexer);
                if (lexer->lookahead == 'D') {
                    advance(s, lexer);
                    if (lexer->lookahead == 'A') {
                        advance(s, lexer);
                        if (lexer->lookahead == 'T') {
                            advance(s, lexer);
                            if (lexer->lookahead == 'A') {
                                advance(s, lexer);
                                if (lexer->lookahead == '[' &&
                                    valid_symbols[HTML_BLOCK_5_START]) {
                                    advance(s, lexer);
                                    lexer->result_symbol = HTML_BLOCK_5_START;
                                    if (!push_block(s, ANONYMOUS)) return false;
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    bool starting_slash = lexer->lookahead == '/';
    if (starting_slash) {
        advance(s, lexer);
    }
    char name[11];
    size_t name_length = 0;
    while (('a' <= lexer->lookahead && lexer->lookahead <= 'z') ||
           ('A' <= lexer->lookahead && lexer->lookahead <= 'Z') ||
           (name_length > 0 && '0' <= lexer->lookahead && lexer->lookahead <= '9')) {
        if (name_length < 10) {
            name[name_length++] = (char)towlower((wint_t)lexer->lookahead);
        } else {
            name_length = 12;
        }
        advance(s, lexer);
    }
    if (name_length == 0) {
        return false;
    }
    bool tag_closed = false;
    if (name_length < 11) {
        name[name_length] = 0;
        bool next_symbol_valid =
            lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
            lexer->lookahead == '\n' || lexer->lookahead == '\r' ||
            lexer->lookahead == '>';
        if (next_symbol_valid) {
            // try block 1 names
            for (size_t i = 0; i < NUM_HTML_TAG_NAMES_RULE_1; i++) {
                if (strcmp(name, HTML_TAG_NAMES_RULE_1[i]) == 0) {
                    if (starting_slash) {
                        if (valid_symbols[HTML_BLOCK_1_END]) {
                            lexer->result_symbol = HTML_BLOCK_1_END;
                            return true;
                        }
                    } else if (valid_symbols[HTML_BLOCK_1_START]) {
                        lexer->result_symbol = HTML_BLOCK_1_START;
                        if (!push_block(s, ANONYMOUS)) return false;
                        return true;
                    }
                }
            }
        }
        if (!next_symbol_valid && lexer->lookahead == '/') {
            advance(s, lexer);
            if (lexer->lookahead != '>') return false;
            advance(s, lexer);
            tag_closed = true;
        }
        if (next_symbol_valid || tag_closed) {
            // try block 2 names
            for (size_t i = 0; i < NUM_HTML_TAG_NAMES_RULE_7; i++) {
                if (strcmp(name, HTML_TAG_NAMES_RULE_7[i]) == 0 &&
                    valid_symbols[HTML_BLOCK_6_START]) {
                    lexer->result_symbol = HTML_BLOCK_6_START;
                    if (!push_block(s, ANONYMOUS)) return false;
                    return true;
                }
            }
        }
    }

    if (!valid_symbols[HTML_BLOCK_7_START] || (starting_slash && tag_closed)) {
        return false;
    }

    if (!tag_closed) {
        // tag name (continued)
        while (iswalnum((wint_t)lexer->lookahead) || lexer->lookahead == '-') {
            advance(s, lexer);
        }
        if (!starting_slash) {
            // attributes
            bool had_whitespace = false;
            for (;;) {
                // whitespace
                while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    had_whitespace = true;
                    advance(s, lexer);
                }
                if (lexer->lookahead == '/') {
                    advance(s, lexer);
                    break;
                }
                if (lexer->lookahead == '>') {
                    break;
                }
                // attribute name
                if (!had_whitespace) {
                    return false;
                }
                if (!iswalpha((wint_t)lexer->lookahead) &&
                    lexer->lookahead != '_' && lexer->lookahead != ':') {
                    return false;
                }
                had_whitespace = false;
                advance(s, lexer);
                while (iswalnum((wint_t)lexer->lookahead) ||
                       lexer->lookahead == '_' || lexer->lookahead == '.' ||
                       lexer->lookahead == ':' || lexer->lookahead == '-') {
                    advance(s, lexer);
                }
                // attribute value specification
                // optional whitespace
                while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    had_whitespace = true;
                    advance(s, lexer);
                }
                // =
                if (lexer->lookahead == '=') {
                    advance(s, lexer);
                    had_whitespace = false;
                    // optional whitespace
                    while (lexer->lookahead == ' ' ||
                           lexer->lookahead == '\t') {
                        advance(s, lexer);
                    }
                    // attribute value
                    if (lexer->lookahead == '\'' || lexer->lookahead == '"') {
                        char delimiter = (char)lexer->lookahead;
                        advance(s, lexer);
                        while (lexer->lookahead != delimiter &&
                               lexer->lookahead != '\n' &&
                               lexer->lookahead != '\r' && !lexer->eof(lexer)) {
                            advance(s, lexer);
                        }
                        if (lexer->lookahead != delimiter) {
                            return false;
                        }
                        advance(s, lexer);
                    } else {
                        // unquoted attribute value
                        bool had_one = false;
                        while (lexer->lookahead != ' ' &&
                               lexer->lookahead != '\t' &&
                               lexer->lookahead != '"' &&
                               lexer->lookahead != '\'' &&
                               lexer->lookahead != '=' &&
                               lexer->lookahead != '<' &&
                               lexer->lookahead != '>' &&
                               lexer->lookahead != '`' &&
                               lexer->lookahead != '\n' &&
                               lexer->lookahead != '\r' && !lexer->eof(lexer)) {
                            advance(s, lexer);
                            had_one = true;
                        }
                        if (!had_one) {
                            return false;
                        }
                    }
                }
            }
        } else {
            while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                advance(s, lexer);
            }
        }
        if (lexer->lookahead != '>') {
            return false;
        }
        advance(s, lexer);
    }
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        advance(s, lexer);
    }
    if (lexer->lookahead == '\r' || lexer->lookahead == '\n') {
        lexer->result_symbol = HTML_BLOCK_7_START;
        if (!push_block(s, ANONYMOUS)) return false;
        return true;
    }
    return false;
}

static bool parse_pipe_table(Scanner *s, TSLexer *lexer,
                             const bool *valid_symbols) {

    // unused
    (void)(valid_symbols);

    // PIPE_TABLE_START is zero width
    mark_end(s, lexer);
    // count number of cells
    size_t cell_count = 0;
    // also remember if we see starting and ending pipes, as empty headers have
    // to have both
    bool starting_pipe = false;
    bool ending_pipe = false;
    bool empty = true;
    if (lexer->lookahead == '|') {
        starting_pipe = true;
        advance(s, lexer);
    }
    while (lexer->lookahead != '\r' && lexer->lookahead != '\n' &&
           !lexer->eof(lexer)) {
        if (lexer->lookahead == '|') {
            cell_count++;
            ending_pipe = true;
            advance(s, lexer);
        } else {
            if (lexer->lookahead != ' ' && lexer->lookahead != '\t') {
                ending_pipe = false;
            }
            if (lexer->lookahead == '\\') {
                advance(s, lexer);
                if (is_punctuation((char)lexer->lookahead)) {
                    advance(s, lexer);
                }
            } else {
                advance(s, lexer);
            }
        }
    }
    if (empty && cell_count == 0 && !(starting_pipe && ending_pipe)) {
        return false;
    }
    if (!ending_pipe) {
        cell_count++;
    }

    // check the following line for a delimiter row
    // parse a newline
    if (lexer->lookahead == '\n') {
        advance(s, lexer);
    } else if (lexer->lookahead == '\r') {
        advance(s, lexer);
        if (lexer->lookahead == '\n') {
            advance(s, lexer);
        }
    } else {
        return false;
    }
    s->indentation = 0;
    s->column = 0;
    for (;;) {
        if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            s->indentation += advance(s, lexer);
        } else {
            break;
        }
    }
    s->simulate = true;
    uint8_t matched_temp = 0;
    while (matched_temp < (uint8_t)s->open_blocks.size) {
        if (match(s, lexer, s->open_blocks.items[matched_temp])) {
            matched_temp++;
        } else {
            return false;
        }
    }

    // check if delimiter row has the same number of cells and at least one pipe
    size_t delimiter_cell_count = 0;
    if (lexer->lookahead == '|') {
        advance(s, lexer);
    }
    for (;;) {
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(s, lexer);
        }
        if (lexer->lookahead == '|') {
            delimiter_cell_count++;
            advance(s, lexer);
            continue;
        }
        if (lexer->lookahead == ':') {
            advance(s, lexer);
            if (lexer->lookahead != '-') {
                return false;
            }
        }
        bool had_one_minus = false;
        while (lexer->lookahead == '-') {
            had_one_minus = true;
            advance(s, lexer);
        }
        if (had_one_minus) {
            delimiter_cell_count++;
        }
        if (lexer->lookahead == ':') {
            if (!had_one_minus) {
                return false;
            }
            advance(s, lexer);
        }
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(s, lexer);
        }
        if (lexer->lookahead == '|') {
            if (!had_one_minus) {
                delimiter_cell_count++;
            }
            advance(s, lexer);
            continue;
        }
        if (lexer->lookahead != '\r' && lexer->lookahead != '\n') {
            return false;
        } else {
            break;
        }
    }
    // if the cell counts are not equal then this is not a table
    if (cell_count != delimiter_cell_count) {
        return false;
    }

    lexer->result_symbol = PIPE_TABLE_START;
    return true;
}

static bool parse_code_fence_line(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    if ((lexer->lookahead == '`' || lexer->lookahead == '~') &&
        parse_fenced_code_block(s, lexer->lookahead, lexer, valid_symbols)) {
        return true;
    }
    while (!lexer->eof(lexer) && lexer->lookahead != '\n' && lexer->lookahead != '\r') {
        advance(s, lexer);
    }
    mark_end(s, lexer);
    s->indentation = 0;
    lexer->result_symbol = CODE_FENCE_LINE;
    return true;
}

typedef enum { BOUNDARY_NONE, BOUNDARY_EMITTED, BOUNDARY_REJECTED } BoundaryResult;

static BoundaryResult list_blank_boundary(Scanner *s, TSLexer *lexer,
                                         const bool *valid_symbols, Scanner before_match);
static bool list_marker_follows(Scanner *s, TSLexer *lexer);
static bool list_continues_after_blanks(Scanner probe, TSLexer *lexer);

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
    // A normal tree-sitter rule decided that the current branch is invalid and
    // now "requests" an error to stop the branch
    if (valid_symbols[TRIGGER_ERROR]) {
        return error(lexer);
    }

    bool heading_closing_candidate = valid_symbols[ATX_HEADING_CLOSING_SEQUENCE] &&
        (lexer->lookahead == ' ' || lexer->lookahead == '\t');

    // Close the inner most block after the next line break as requested. See
    // `$._close_block` in grammar.js
    if (valid_symbols[CLOSE_BLOCK]) {
        s->state |= STATE_CLOSE_BLOCK;
        lexer->result_symbol = CLOSE_BLOCK;
        return true;
    }

    // if we are at the end of the file and there are still open blocks close
    // them all
    if (lexer->eof(lexer)) {
        if (valid_symbols[TOKEN_EOF]) {
            lexer->result_symbol = TOKEN_EOF;
            return true;
        }
        if (s->open_blocks.size > 0) {
            lexer->result_symbol = BLOCK_CLOSE;
            if (!s->simulate)
                pop_block(s);
            return true;
        }
        return false;
    }

    if (!(s->state & STATE_MATCHING)) {
        // Parse any preceeding whitespace and remember its length. This makes a
        // lot of parsing quite a bit easier.
        for (;;) {
            if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                s->indentation += advance(s, lexer);
            } else {
                break;
            }
        }
        if (heading_closing_candidate && lexer->lookahead == '#') {
            return parse_atx_heading_closing_sequence(s, lexer);
        }
        if (lexer->eof(lexer) && valid_symbols[TOKEN_EOF]) {
            lexer->result_symbol = TOKEN_EOF;
            return true;
        }
        if (valid_symbols[CODE_FENCE_LINE] && lexer->lookahead != '\n' && lexer->lookahead != '\r') {
            return parse_code_fence_line(s, lexer, valid_symbols);
        }
        // We are not matching. This is where the parsing logic for most
        // "normal" token is. Most importantly parsing logic for the start of
        // new blocks.
        if (valid_symbols[INDENTED_CHUNK_START] &&
            !valid_symbols[NO_INDENTED_CHUNK]) {
            if (s->indentation >= 4 && lexer->lookahead != '\n' &&
                lexer->lookahead != '\r') {
                lexer->result_symbol = INDENTED_CHUNK_START;
                if (!push_block(s, INDENTED_CODE_BLOCK)) return false;
                s->indentation -= 4;
                return true;
            }
        }
        // Decide which tokens to consider based on the first non-whitespace
        // character
        switch (lexer->lookahead) {
            case '\r':
            case '\n':
                if (valid_symbols[BLANK_LINE_START] && !valid_symbols[LIST_BLANK_SEPARATOR]) {
                    // A blank line token is actually just 0 width, so do not
                    // consume the characters
                    lexer->result_symbol = BLANK_LINE_START;
                    return true;
                }
                break;
            case '`':
                // A backtick could mark the beginning or ending of a fenced
                // code block.
                return parse_fenced_code_block(s, '`', lexer, valid_symbols);
            case '~':
                // A tilde could mark the beginning or ending of a fenced code
                // block.
                return parse_fenced_code_block(s, '~', lexer, valid_symbols);
            case '*':
                // A star could either mark  a list item or a thematic break.
                // This code is similar to the code for '_' and '+'.
                return parse_star(s, lexer, valid_symbols);
            case '_':
                return parse_thematic_break_underscore(s, lexer, valid_symbols);
            case '>':
                // A '>' could mark the beginning of a block quote
                return parse_block_quote(s, lexer, valid_symbols);
            case '#':
                // A '#' could mark a atx heading
                return parse_atx_heading(s, lexer, valid_symbols);
            case '=':
                // A '=' could mark a setext underline
                return parse_setext_underline(s, lexer, valid_symbols);
            case '+':
                // A '+' could be a list marker
                return parse_plus(s, lexer, valid_symbols);
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                // A number could be a list marker (if followed by a dot or a
                // parenthesis)
                return parse_ordered_list_marker(s, lexer, valid_symbols);
            case '-':
                // A minus could mark a list marker, a thematic break or a
                // setext underline
                return parse_minus(s, lexer, valid_symbols);
            case '<':
                // A < could mark the beginning of a html block
                return parse_html_block(s, lexer, valid_symbols);
        }
        if (lexer->lookahead != '\r' && lexer->lookahead != '\n' &&
            valid_symbols[PIPE_TABLE_START]) {
            return parse_pipe_table(s, lexer, valid_symbols);
        }
    } else { // we are in the state of trying to match all currently open blocks
        Scanner before_match = *s;
        uint32_t prefix_column = lexer->get_column(lexer);
        mark_end(s, lexer);
        bool partial_success = false;
        while (s->matched < (uint8_t)s->open_blocks.size) {
            if (s->matched == (uint8_t)s->open_blocks.size - 1 &&
                (s->state & STATE_CLOSE_BLOCK)) {
                if (!partial_success)
                    s->state &= ~STATE_CLOSE_BLOCK;
                break;
            }
            if (match(s, lexer, s->open_blocks.items[s->matched])) {
                partial_success = true;
                s->matched++;
            } else {
                if (s->state & STATE_WAS_SOFT_LINE_BREAK) {
                    s->state &= (~STATE_MATCHING);
                }
                break;
            }
        }
        if (valid_symbols[BLOCK_CLOSE] && partial_success && s->matched < s->open_blocks.size &&
            s->open_blocks.items[s->open_blocks.size - 1] >= LIST_ITEM &&
            s->open_blocks.items[s->open_blocks.size - 1] <= LIST_ITEM_MAX_INDENTATION &&
            !(s->state & STATE_WAS_SOFT_LINE_BREAK)) {
            *s = before_match;
            s->state &= ~STATE_CLOSE_BLOCK;
            if (!s->simulate) pop_block(s);
            if (!s->open_blocks.size) s->state &= ~STATE_MATCHING;
            lexer->result_symbol = BLOCK_CLOSE;
            return true;
        }
        if (partial_success) {
            BoundaryResult boundary = list_blank_boundary(s, lexer, valid_symbols, before_match);
            if (boundary != BOUNDARY_NONE) return boundary == BOUNDARY_EMITTED;
            mark_end(s, lexer);
            if (s->matched == s->open_blocks.size) {
                s->state &= (~STATE_MATCHING);
            }
            if (valid_symbols[LIST_ITEM_PREFIX] && s->matched == s->open_blocks.size &&
                lexer->get_column(lexer) > prefix_column && !s->simulate &&
                list_marker_follows(s, lexer)) {
                lexer->result_symbol = LIST_ITEM_PREFIX;
                return true;
            }
            lexer->result_symbol = BLOCK_CONTINUATION;
            return true;
        }

        if (!(s->state & STATE_WAS_SOFT_LINE_BREAK)) {
            *s = before_match;
            s->state &= ~STATE_CLOSE_BLOCK;
            lexer->result_symbol = BLOCK_CLOSE;
            pop_block(s);
            if (s->matched == s->open_blocks.size) {
                s->state &= (~STATE_MATCHING);
            }
            return true;
        }
    }

    // The parser just encountered a line break. Setup the state correspondingly
    if ((valid_symbols[LIST_BLANK_SEPARATOR] || valid_symbols[LINE_ENDING] || valid_symbols[SOFT_LINE_ENDING] ||
         valid_symbols[PIPE_TABLE_LINE_ENDING]) &&
        (lexer->lookahead == '\n' || lexer->lookahead == '\r')) {
        if (lexer->lookahead == '\r') {
            advance(s, lexer);
            if (lexer->lookahead == '\n') {
                advance(s, lexer);
            }
        } else {
            advance(s, lexer);
        }
        s->indentation = 0;
        s->column = 0;
        if (!valid_symbols[LIST_BLANK_SEPARATOR] && !(s->state & STATE_CLOSE_BLOCK) &&
            (valid_symbols[SOFT_LINE_ENDING] ||
             valid_symbols[PIPE_TABLE_LINE_ENDING])) {
            lexer->mark_end(lexer);
            for (;;) {
                if (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    s->indentation += advance(s, lexer);
                } else {
                    break;
                }
            }
            s->simulate = true;
            uint8_t matched_temp = s->matched;
            s->matched = 0;
            bool one_will_be_matched = false;
            while (s->matched < (uint8_t)s->open_blocks.size) {
                if (match(s, lexer, s->open_blocks.items[s->matched])) {
                    s->matched++;
                    one_will_be_matched = true;
                } else {
                    break;
                }
            }
            bool all_will_be_matched = s->matched == s->open_blocks.size;
            bool interrupt_symbols[sizeof(paragraph_interrupt_symbols) /
                                   sizeof(*paragraph_interrupt_symbols)];
            memcpy(interrupt_symbols, paragraph_interrupt_symbols,
                   sizeof(interrupt_symbols));
            if (valid_symbols[PIPE_TABLE_LINE_ENDING]) {
                interrupt_symbols[PIPE_TABLE_START] = false;
            }
            if (!lexer->eof(lexer) && !scan(s, lexer, interrupt_symbols)) {
                s->matched = matched_temp;
                // If the last line break ended a paragraph and no new block
                // opened, the last line break should have been a soft line
                // break Reset the counter for matched blocks
                s->matched = 0;
                s->indentation = 0;
                s->column = 0;
                // If there is at least one open block, we should be in the
                // matching state. Also set the matching flag if a
                // `$._soft_line_break_marker` can be emitted so it does get
                // emitted.
                if (one_will_be_matched) {
                    s->state |= STATE_MATCHING;
                } else {
                    s->state &= (~STATE_MATCHING);
                }
                if (valid_symbols[PIPE_TABLE_LINE_ENDING]) {
                    if (all_will_be_matched) {
                        lexer->result_symbol = PIPE_TABLE_LINE_ENDING;
                        return true;
                    }
                } else {
                    lexer->result_symbol = SOFT_LINE_ENDING;
                    // reset some state variables
                    s->state |= STATE_WAS_SOFT_LINE_BREAK;
                    return true;
                }
            } else {
                s->matched = matched_temp;
            }
            s->indentation = 0;
            s->column = 0;
        }
        if (valid_symbols[LINE_ENDING] || valid_symbols[LIST_BLANK_SEPARATOR]) {
            // If the last line break ended a paragraph and no new block opened,
            // the last line break should have been a soft line break Reset the
            // counter for matched blocks
            s->matched = 0;
            // If there is at least one open block, we should be in the matching
            // state. Also set the matching flag if a
            // `$._soft_line_break_marker` can be emitted so it does get
            // emitted.
            if (s->open_blocks.size > 0) {
                s->state |= STATE_MATCHING;
            } else {
                s->state &= (~STATE_MATCHING);
            }
            // reset some state variables
            s->state &= (~STATE_WAS_SOFT_LINE_BREAK);
            lexer->result_symbol = valid_symbols[LIST_BLANK_SEPARATOR] ? LIST_BLANK_SEPARATOR : LINE_ENDING;
            return true;
        }
    }
    return false;
}

static BoundaryResult list_blank_boundary(Scanner *s, TSLexer *lexer,
                                         const bool *valid_symbols, Scanner before_match) {
    if (s->matched != s->open_blocks.size || s->simulate ||
        (s->state & STATE_WAS_SOFT_LINE_BREAK)) return BOUNDARY_NONE;
    Block last = s->open_blocks.items[s->open_blocks.size - 1];
    if (last < LIST_ITEM || last > LIST_ITEM_MAX_INDENTATION) return BOUNDARY_NONE;
    if (lexer->lookahead != '\n' && lexer->lookahead != '\r') {
        s->state &= ~STATE_BLANK_CONTINUES;
        return BOUNDARY_NONE;
    }
    if ((s->state & STATE_BLANK_CONTINUES) || !valid_symbols[LIST_BLANK_GUARD]) return BOUNDARY_NONE;
    bool continues = list_continues_after_blanks(*s, lexer);
    if (!continues && !valid_symbols[BLOCK_CLOSE]) return BOUNDARY_REJECTED;
    *s = before_match;
    if (continues) {
        s->state |= STATE_BLANK_CONTINUES;
        lexer->result_symbol = LIST_BLANK_GUARD;
    } else {
        s->state &= ~STATE_CLOSE_BLOCK;
        pop_block(s);
        if (!s->open_blocks.size) s->state &= ~STATE_MATCHING;
        lexer->result_symbol = BLOCK_CLOSE;
    }
    return BOUNDARY_EMITTED;
}

static bool list_continues_after_blanks(Scanner probe, TSLexer *lexer) {
    probe.simulate = true;
    while (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
        bool carriage_return = lexer->lookahead == '\r';
        advance(&probe, lexer);
        if (carriage_return && lexer->lookahead == '\n') advance(&probe, lexer);
        probe.indentation = 0;
        probe.column = 0;
        for (size_t i = 0; i < probe.open_blocks.size; i++) {
            if (!match(&probe, lexer, probe.open_blocks.items[i])) return false;
        }
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(&probe, lexer);
    }
    return !lexer->eof(lexer);
}

static bool list_marker_follows(Scanner *s, TSLexer *lexer) {
    Scanner matched_state = *s;
    bool marker_symbols[sizeof(paragraph_interrupt_symbols) / sizeof(bool)];
    memcpy(marker_symbols, paragraph_interrupt_symbols, sizeof(marker_symbols));
    for (unsigned i = LIST_MARKER_MINUS; i <= LIST_MARKER_DOT_DONT_INTERRUPT; i++) {
        marker_symbols[i] = true;
    }
    s->simulate = true;
    bool found = scan(s, lexer, marker_symbols) &&
        lexer->result_symbol >= LIST_MARKER_MINUS &&
        lexer->result_symbol <= LIST_MARKER_DOT_DONT_INTERRUPT;
    *s = matched_state;
    return found;
}

void *tree_sitter_markdown_external_scanner_create(void) {
    Scanner *s = (Scanner *)calloc(1, sizeof(Scanner));
#if defined(__STDC_VERSION__) && (__STDC_VERSION__ >= 201112L)
    _Static_assert(ATX_H6_MARKER == ATX_H1_MARKER + 5, "");
#else
    assert(ATX_H6_MARKER == ATX_H1_MARKER + 5);
#endif
    deserialize(s, NULL, 0);

    return s;
}

bool tree_sitter_markdown_external_scanner_scan(void *payload, TSLexer *lexer,
                                                const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;
    scanner->simulate = false;
    return scan(scanner, lexer, valid_symbols);
}

unsigned tree_sitter_markdown_external_scanner_serialize(void *payload,
                                                         char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    return serialize(scanner, buffer);
}

void tree_sitter_markdown_external_scanner_deserialize(void *payload,
                                                       const char *buffer,
                                                       unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    deserialize(scanner, buffer, length);
}

void tree_sitter_markdown_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    free(scanner->open_blocks.items);
    free(scanner);
}
