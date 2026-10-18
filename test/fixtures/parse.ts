// A source and the tree each grammar parses it to: the block grammar leaves inline content as `inline` nodes, which
// the inline grammar parses.
export const ExpectedTrees = {
  markdown: {
    source: '# Hello\n\nSome *text*.\n',
    tree: '(document (section (atx_heading (atx_h1_marker) heading_content: (inline)) (paragraph (inline))))',
  },
  markdown_inline: {
    source: 'Some *text*.',
    tree: '(inline (emphasis (emphasis_delimiter) (emphasis_delimiter)))',
  },
};
