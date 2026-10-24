/** Presentation adapter for the existing plain-text section labels in published briefs.
 * It never evaluates code, invents expected results, or changes stored Markdown.
 */
type BriefNode = {
  type: string;
  value?: string;
  depth?: number;
  lang?: string | null;
  children?: BriefNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

function plainParagraph(node: BriefNode): string | null {
  return node.type === 'paragraph' && node.children?.every((child) => child.type === 'text')
    ? node.children.map((child) => child.value ?? '').join('')
    : null;
}

function literalHtml(node: BriefNode) {
  if (node.type === 'html') {
    node.type = 'text';
    return;
  }
  node.children?.forEach(literalHtml);
}

function exampleCode(value: string) {
  const lines = value.trim().split('\n');
  // Legacy examples explicitly contain function calls followed by source comments.
  // Prose after an example stays prose, and arbitrary paragraphs are never guessed as code.
  return (
    lines.some((line) => /^\s*\/\//.test(line)) &&
    lines.every((line) => !line.trim() || /^\s*(?:\/\/|[\w.$:]+\s*\(.*\)\s*;?\s*$)/.test(line))
  );
}

export function briefPresentation() {
  return (tree: BriefNode) => {
    literalHtml(tree);
    const expanded: BriefNode[] = [];
    for (const node of tree.children ?? []) {
      const value = plainParagraph(node);
      const lines = value?.split('\n');
      if (lines && /^(?:examples?|rules):?$/i.test(lines[0]!.trim())) {
        expanded.push({
          type: 'heading',
          depth: 3,
          children: [{ type: 'text', value: lines[0]!.replace(/:$/, '') }],
        });
        if (lines.length > 1)
          expanded.push({
            type: 'paragraph',
            children: [{ type: 'text', value: lines.slice(1).join('\n') }],
          });
      } else expanded.push(node);
    }
    const output: BriefNode[] = [];
    let examples: BriefNode | null = null;
    let exampleDepth = 0;
    for (let node of expanded) {
      if (node.type === 'heading') {
        const label = node.children
          ?.map((child) => child.value ?? '')
          .join('')
          .trim();
        if (/^examples?$/i.test(label ?? '')) {
          exampleDepth = node.depth ?? 3;
          examples = {
            type: 'blockquote',
            data: {
              hName: 'section',
              hProperties: { 'data-brief-examples': true, 'aria-label': label },
            },
            children: [node],
          };
          output.push(examples);
          continue;
        }
        if ((node.depth ?? 1) <= exampleDepth) examples = null;
      }
      if (examples) {
        const value = plainParagraph(node);
        if (value !== null && exampleCode(value)) node = { type: 'code', lang: null, value };
        examples.children!.push(node);
      } else output.push(node);
    }
    tree.children = output;
  };
}
