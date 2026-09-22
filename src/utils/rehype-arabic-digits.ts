import { toArabicDigits } from './arabicDigits';

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

const skipTags = new Set(['code', 'pre', 'kbd', 'samp', 'var']);

function walk(node: HastNode): void {
  if (node.type === 'text') {
    node.value = toArabicDigits(node.value ?? '');
    return;
  }
  if (node.tagName && skipTags.has(node.tagName)) return;
  for (const child of node.children ?? []) walk(child);
}

export default function rehypeArabicDigits() {
  return (tree: HastNode) => {
    walk(tree);
  };
}
