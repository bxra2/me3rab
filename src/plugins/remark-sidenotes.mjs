export default function remarkSidenotes() {
  const PATTERN = /\^\[([^\]]+)\]/g;

  const expand = (value, state) => {
    PATTERN.lastIndex = 0;
    const nodes = [];
    let last = 0;
    let m;
    while ((m = PATTERN.exec(value)) !== null) {
      if (m.index > last) {
        nodes.push({ type: 'text', value: value.slice(last, m.index) });
      }
      state.count += 1;
      const n = state.count;
      nodes.push({ type: 'html', value: `<sup class="sidenote-ref">${n}</sup>` });
      nodes.push({
        type: 'html',
        value: `<span class="sidenote"><span class="sidenote-num">${n}.</span> ${m[1].trim()}</span>`,
      });
      last = m.index + m[0].length;
    }
    if (last < value.length) {
      nodes.push({ type: 'text', value: value.slice(last) });
    }
    return nodes;
  };

  return (tree) => {
    const state = { count: 0 };
    const walk = (node) => {
      if (Array.isArray(node.children)) {
        node.children = node.children.flatMap((child) => {
          PATTERN.lastIndex = 0;
          if (child.type === 'text' && PATTERN.test(child.value)) {
            return expand(child.value, state);
          }
          walk(child);
          return [child];
        });
      }
    };
    walk(tree);
  };
}
