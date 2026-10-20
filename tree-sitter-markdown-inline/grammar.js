
/// <reference types="tree-sitter-cli/dsl" />

const common = require('../common/common');

const PRECEDENCE_LEVEL_EMPHASIS = 10;
const EMPHASIS_DELIMITERS = ['star', 'underscore'];
const EMPHASIS_FLANKS = ['left', 'right', 'both'];
const emphasisTokens = delimiter => ['open', 'close', 'literal', 'candidate'].flatMap(role => EMPHASIS_FLANKS.flatMap(flank => [0, 1, 2].map(modulo => `_emphasis_${delimiter}_${role}_${flank}_${modulo}`)));
const literalTokens = delimiter => emphasisTokens(delimiter).filter(name => name.includes('_literal_'));
const openTokens = delimiter => emphasisTokens(delimiter).filter(name => name.includes('_candidate_'));
const PRECEDENCE_LEVEL_LINK = 100;

const PUNCTUATION_CHARACTERS_REGEX = '!-/:-@\\[-`\\{-~';

module.exports = grammar(add_inline_rules({
    name: 'markdown_inline',

    externals: $ => [
        $._error,
        $._trigger_error,

        $._code_span_start,
        $._code_span_close,

        ...EMPHASIS_DELIMITERS.flatMap(delimiter => emphasisTokens(delimiter).map(name => $[name])),

        $._last_token_whitespace,
        $._last_token_punctuation,

        $._strikethrough_open,
        $._strikethrough_close,
        $._strikethrough_forced_open,
        $._strikethrough_literal,

        $._latex_span_start,
        $._latex_span_close,

        $._unclosed_span,
        $._literal_emphasis_run,
        $._open_bracket,
        $._unclosed_open_bracket,
        $._close_bracket_no_label,
        $._close_bracket_with_label,
        $._close_bracket_unknown_label
    ],
    precedences: $ => [
        [$.hard_line_break, $._whitespace],
        [$.hard_line_break, $._text_base_no_emphasis],
    ],
    conflicts: $ => [
        [$._image_shortcut_link, $._image_description_no_label],
        [$.shortcut_link, $._link_text_no_label],
        [$.link_destination, $.link_title],
        [$._link_destination_parenthesis, $.link_title],

        [$.wiki_link, $._inline_element],

        [$.wiki_link, $._inline_element_no_tilde],
    ],
    extras: $ => [],

    rules: {
        inline: $ => seq(optional($._last_token_whitespace), $._inline),

        ...common.rules,

        code_span: $ => seq(
            alias($._code_span_start, $.code_span_delimiter),
            repeat(choice($._text_base, '[', ']', $._soft_line_break, $._html_tag)),
            alias($._code_span_close, $.code_span_delimiter)
        ),

        latex_block: $ => seq(
            alias($._latex_span_start, $.latex_span_delimiter),
            repeat(choice($._text_base, '[', ']', $._soft_line_break, $._html_tag, $.backslash_escape)),
            alias($._latex_span_close, $.latex_span_delimiter),
        ),

        shortcut_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, $._link_text_non_empty_no_label),
        full_reference_link: $ => prec.dynamic(2 * PRECEDENCE_LEVEL_LINK, seq(
            $._link_text_with_label,
            $.link_label
        )),
        collapsed_reference_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq(
            $._link_text_with_label,
            '[',
            ']'
        )),
        inline_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq(
            $._link_text_no_label,
            '(',
            repeat(choice($._whitespace, $._soft_line_break)),
            optional(seq(
                choice(
                    seq(
                        $._link_destination,
                        optional(seq(
                            repeat1(choice($._whitespace, $._soft_line_break)),
                            $.link_title
                        ))
                    ),
                    $.link_title,
                ),
                repeat(choice($._whitespace, $._soft_line_break)),
            )),
            ')'
        )),

        wiki_link: $ => prec.dynamic(2 * PRECEDENCE_LEVEL_LINK, seq(
            '[', '[',
            alias($._wiki_link_destination, $.link_destination),
            optional(seq(
                '|',
                alias($._wiki_link_text, $.link_text)
            )),
            ']', ']'
            )
        ),

        _wiki_link_destination: $ => repeat1(choice(
            $._word,
            common.punctuation_without($, ['[',']', '|']),
            $._whitespace,
        )),

        _wiki_link_text: $ => repeat1(choice(
            $._word,
            common.punctuation_without($, ['[',']']),
            $._whitespace,
        )),

        image: $ => choice(
            $._image_inline_link,
            $._image_shortcut_link,
            $._image_full_reference_link,
            $._image_collapsed_reference_link
        ),
        _image_inline_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq(
            $._image_description_no_label,
            '(',
            repeat(choice($._whitespace, $._soft_line_break)),
            optional(seq(
                choice(
                    seq(
                        $._link_destination,
                        optional(seq(
                            repeat1(choice($._whitespace, $._soft_line_break)),
                            $.link_title
                        ))
                    ),
                    $.link_title,
                ),
                repeat(choice($._whitespace, $._soft_line_break)),
            )),
            ')'
        )),
        _image_shortcut_link: $ => prec.dynamic(3 * PRECEDENCE_LEVEL_LINK, $._image_description_non_empty_no_label),
        _image_full_reference_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq($._image_description_with_label, $.link_label)),
        _image_collapsed_reference_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq($._image_description_with_label, '[', ']')),

        // Autolinks. Uri autolinks actually accept protocolls of arbitrary length which does not
        // align with the spec. This is because the binary for the grammar gets to large if done
        // otherwise as tree-sitters code generation is not very concise for this type of regex.
        //
        // Email autolinks do not match every valid email (emails normally should not be parsed
        // using regexes), but this is how they are defined in the spec.
        //
        // https://github.github.com/gfm/#autolinks
        uri_autolink: $ => /<[a-zA-Z][a-zA-Z0-9+\.\-][a-zA-Z0-9+\.\-]*:[^ \t\r\n<>]*>/,
        email_autolink: $ =>
            /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/,

        _html_tag: $ => choice($._open_tag, $._closing_tag, $._html_comment, $._processing_instruction, $._declaration, $._cdata_section),
        _open_tag: $ => token(/<[A-Za-z][A-Za-z0-9-]*([ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:\-]*([ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*'|[^ \t\r\n"'=<>`]+)))*[ \t\r\n]*\/?>/),
        _closing_tag: $ => token(/<\/[A-Za-z][A-Za-z0-9-]*[ \t\r\n]*>/),
        _html_comment: $ => token(seq('<!--', optional(seq(choice(/[^->]/, seq('-', /[^>]/)), repeat(choice(/[^-]/, seq('-', /[^-]/))))), '-->')),
        _processing_instruction: $ => token(/<\?([^?]|\?+[^?>])*\?+>/),
        _declaration: $ => token(/<![A-Z]+[ \t\r\n][^>]*>/),
        _cdata_section: $ => token(/<!\[CDATA\[([^\]]|\][^\]]|\]\]+[^\]>])*\]\]+>/),

        hard_line_break: $ => seq(choice('\\', $._whitespace_ge_2), $._soft_line_break),
        _text: $ => choice($._word, common.punctuation_without($, []), $._whitespace),

        _whitespace_ge_2: $ => /\t| [ \t]+/,
        _whitespace: $ => seq(choice($._whitespace_ge_2, / /), optional($._last_token_whitespace)),

        _word: $ => choice($._word_no_digit, $._digits),
        _word_no_digit: $ => new RegExp('[^' + PUNCTUATION_CHARACTERS_REGEX + ' \\t\\n\\r0-9]+(_+[^' + PUNCTUATION_CHARACTERS_REGEX + ' \\t\\n\\r0-9]+)*'),
        _digits: $ => choice(/[0-9]([0-9_]*[0-9])?/, seq(/[0-9][0-9_]*_/, optional($._last_token_punctuation))),
        _soft_line_break: $ => seq($._newline_token, optional($._last_token_whitespace)),

        _inline_base: $ => choice(
            $.image,
            $._soft_line_break,
            $.backslash_escape,
            $.hard_line_break,
            $.uri_autolink,
            $.email_autolink,
            $.entity_reference,
            $.numeric_character_reference,
            (common.EXTENSION_LATEX ? $.latex_block : choice()),
            $.code_span,
            alias($._html_tag, $.html_tag),
            $._text_base_no_emphasis,
            ...EMPHASIS_DELIMITERS.flatMap(delimiter => literalTokens(delimiter).map(name => prec.dynamic(1, $[name]))),
            common.EXTENSION_TAGS ? $.tag : choice(),
            $._unclosed_span,
            $._literal_emphasis_run,
            ...(common.EXTENSION_STRIKETHROUGH ? [$._strikethrough_literal] : []),
        ),
        _text_base: $ => choice($._text_base_no_emphasis, '*', '_', '~'),
        _text_base_no_emphasis: $ => choice(
            $._word,
            common.punctuation_without($, ['[', ']', '*', '_', ...(common.EXTENSION_STRIKETHROUGH ? ['~'] : [])]),
            $._whitespace,
            '<!--',
            /<![A-Z]+/,
            '<?',
            '<![CDATA[',
        ),
        _text_inline_no_link: $ => choice(
            $._text_base_no_emphasis,
            ...EMPHASIS_DELIMITERS.flatMap(delimiter => emphasisTokens(delimiter).filter(name => !name.includes('_close_') && !name.includes('_open_')).map(name => $[name])),
            $._unclosed_span,
            $._literal_emphasis_run,
            ...(common.EXTENSION_STRIKETHROUGH ? [$._strikethrough_literal] : []),
        ),

        ...(common.EXTENSION_TAGS ? {
            tag: $ => /#[0-9]*[a-zA-Z_\-\/][a-zA-Z_\-\/0-9]*/,
        } : {}),

    },
}));

function add_inline_rules(grammar) {
    const conflicts = [];
    addOpenerRules(grammar);
    for (const link of [true, false]) {
        const suffix = link ? '' : '_no_link';
        for (const noTilde of [false, true]) addInlineCollection(grammar, conflicts, suffix, link, noTilde);
        addEmphasisRules(grammar, suffix);
    }

    addReferenceHeads(grammar, conflicts);
    add_context_rules(grammar);
    for (const name of Object.keys(grammar.rules)) {
        const rule = grammar.rules[name];
        grammar.rules[name] = $ => replace_bracket(rule($), $, ['link_label', 'collapsed_reference_link', 'wiki_link', '_image_collapsed_reference_link'].includes(name) || name.startsWith('_link_text_') || name.startsWith('_image_description_'));
    }

    let old = grammar.conflicts
    grammar.conflicts = $ => {
        let cs = old($);
        for (let conflict of conflicts) {
            let c = [];
            for (let rule of conflict) {
                c.push($[rule]);
            }
            cs.push(c);
        }
        return cs;
    }

    return grammar;
}

function addOpenerRules(grammar) {
    for (const kind of EMPHASIS_DELIMITERS) for (const flank of ['left', 'both']) for (const modulo of [0, 1, 2]) {
        grammar.rules[`_preferred_opener_${kind}_${flank}_${modulo}`] = $ => prec.dynamic(2, choice(...['open', 'candidate'].map(role => $[`_emphasis_${kind}_${role}_${flank}_${modulo}`])));
    }
}

function addInlineCollection(grammar, conflicts, suffixLink, link, noTilde) {
    const suffix = (noTilde ? '_no_tilde' : '') + suffixLink;
    grammar.rules['_inline_element' + suffix] = $ => inlineElements($, suffixLink, link, noTilde);
    grammar.rules['_inline' + suffix] = $ => repeat1($['_inline_element' + suffix]);
    for (const kind of EMPHASIS_DELIMITERS) {
        for (const flank of ['left', 'both']) for (const modulo of [0, 1, 2]) {
            conflicts.push(['_inline_element' + suffix, `_preferred_opener_${kind}_${flank}_${modulo}`]);
        }
        if (!noTilde) conflicts.push(['_inline_element' + suffix, '_strong_emphasis_' + kind + suffixLink]);
    }
    if (common.EXTENSION_STRIKETHROUGH && !noTilde) {
        conflicts.push(['_inline_element' + suffix, '_strikethrough' + suffixLink]);
    }
}

function inlineElements($, suffixLink, link, noTilde) {
    return choice(
        $._inline_base,
        ...EMPHASIS_DELIMITERS.flatMap(kind => [
            alias($['_emphasis_' + kind + suffixLink], $.emphasis),
            alias($['_strong_emphasis_' + kind + suffixLink], $.strong_emphasis),
            ...openTokens(kind).map(name => prec.dynamic(1, $[name])),
        ]),
        ...(common.EXTENSION_STRIKETHROUGH ? [alias($['_strikethrough' + suffixLink], $.strikethrough)] : []),
        ...(noTilde ? [] : [$._strikethrough_open]),
        ...(link ? [
            $.shortcut_link, $.full_reference_link, $.collapsed_reference_link, $.inline_link,
            seq(choice('[', ']'), optional($._last_token_punctuation)),
            ...(common.EXTENSION_WIKI_LINK ? [$.wiki_link] : []),
        ] : []),
    );
}

function addEmphasisRules(grammar, suffix) {
    for (const delimiter of EMPHASIS_DELIMITERS) {
        const emphasis = '_emphasis_' + delimiter + suffix;
        const strong = '_strong_emphasis_' + delimiter + suffix;
        grammar.rules[emphasis] = $ => emphasisRule($, delimiter, suffix, false);
        grammar.rules[strong] = $ => emphasisRule($, delimiter, suffix, true);
    }
    if (common.EXTENSION_STRIKETHROUGH) {
        grammar.rules['_strikethrough' + suffix] = $ => prec.dynamic(PRECEDENCE_LEVEL_EMPHASIS, seq(alias(choice($._strikethrough_forced_open, $._strikethrough_open), $.emphasis_delimiter), $['_inline_no_tilde' + suffix], alias($._strikethrough_close, $.emphasis_delimiter)));
    }
}

function emphasisRule($, delimiter, suffix, strong) {
    return prec.dynamic((strong ? 2 : 1) * PRECEDENCE_LEVEL_EMPHASIS, choice(
        ...['left', 'both'].flatMap(openFlank => [0, 1, 2].map(openModulo => seq(
            alias($[`_preferred_opener_${delimiter}_${openFlank}_${openModulo}`], $.emphasis_delimiter),
            $[(strong ? '_emphasis_' + delimiter : '_inline') + suffix],
            choice(...['right', 'both'].flatMap(closeFlank => [0, 1, 2].filter(closeModulo =>
                (openFlank !== 'both' && closeFlank !== 'both') ||
                (openModulo + closeModulo) % 3 !== 0 ||
                (openModulo === 0 && closeModulo === 0)
            ).map(closeModulo => alias($[`_emphasis_${delimiter}_close_${closeFlank}_${closeModulo}`], $.emphasis_delimiter))))
        )))
    ));
}

function add_context_rules(grammar) {
    for (const name of ['image', 'code_span', 'latex_block', 'inline_link', 'shortcut_link',
        'full_reference_link', 'collapsed_reference_link', 'wiki_link', 'backslash_escape',
        'entity_reference', 'numeric_character_reference', 'uri_autolink', 'email_autolink', '_html_tag']) {
        grammar.rules[name] = with_context(grammar.rules[name]);
    }
}

function with_context(rule) {
    return $ => {
        const definition = rule($);
        return definition.type === 'PREC_DYNAMIC'
            ? prec.dynamic(definition.value, seq(definition.content, optional($._last_token_punctuation)))
            : seq(definition, optional($._last_token_punctuation));
    };
}

function replace_bracket(rule, $, requiresClose) {
    if (rule.type === 'STRING' && rule.value === ']') return alias(choice($._close_bracket_no_label, $._close_bracket_with_label, $._close_bracket_unknown_label), ']');
    if (rule.type === 'STRING' && rule.value === '[') return alias(requiresClose ? $._open_bracket : choice($._open_bracket, $._unclosed_open_bracket), '[');
    if (rule.content) return {...rule, content: replace_bracket(rule.content, $, requiresClose)};
    if (rule.members) return {...rule, members: rule.members.map(member => replace_bracket(member, $, requiresClose))};
    return rule;
}

function addReferenceHeads(grammar, conflicts) {
    for (const kind of ['link_text', 'image_description']) for (const label of ['no_label', 'with_label']) {
        const nonempty = `_${kind}_non_empty_${label}`;
        grammar.rules[nonempty] = $ => referenceHead($, kind, label);
        grammar.rules[`_${kind}_${label}`] = $ => prec.dynamic(
            (kind === 'image_description' ? 3 : 1) * PRECEDENCE_LEVEL_LINK,
            choice($[nonempty], referenceHead($, kind, label, true))
        );
    }
    for (const suffix of ['', '_no_tilde']) for (const label of ['no_label', 'with_label']) conflicts.push(['_inline_element' + suffix, '_link_text_' + label]);
    for (const suffix of ['', '_no_tilde']) conflicts.push(
        ['_inline_element' + suffix, '_link_text_non_empty_no_label', '_link_text_non_empty_with_label'],
        ['_inline_element' + suffix, '_link_text_no_label', '_link_text_with_label'],
    );
    conflicts.push(
        ['_text_base_no_emphasis', '_image_description_non_empty_no_label', '_image_description_no_label', '_image_description_non_empty_with_label', '_image_description_with_label'],
        ['_link_text_non_empty_no_label', '_link_text_non_empty_with_label'],
        ['_image_description_non_empty_no_label', '_image_description_non_empty_with_label'],
    );
}

function referenceHead($, kind, label, empty = false) {
    const image = kind === 'image_description';
    const close = alias(choice($['_close_bracket_' + label], $._close_bracket_unknown_label), ']');
    return seq(
        ...(image ? ['!'] : []), '[',
        ...(empty ? [] : [alias(image ? $._inline : $._inline_no_link, $[kind])]),
        image ? prec(1, close) : close,
    );
}
