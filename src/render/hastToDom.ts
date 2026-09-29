import type { SvgElement } from '@tracespace/renderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Converts a `@tracespace/renderer` hast element tree into real SVG DOM
 * nodes. Small enough to hand-roll rather than pull in a hast-to-DOM
 * package (and avoids any risk of a hast-version mismatch between it and
 * the renderer).
 */
export function hastToSvg(node: SvgElement): SVGElement {
  const el = document.createElementNS(SVG_NS, node.tagName);
  for (const [key, value] of Object.entries(node.properties ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    const attrName = key === 'className' ? 'class' : key;
    el.setAttribute(attrName, Array.isArray(value) ? value.join(' ') : String(value));
  }
  for (const child of node.children ?? []) {
    if (child.type === 'element') {
      el.appendChild(hastToSvg(child as SvgElement));
    } else if (child.type === 'text') {
      el.appendChild(document.createTextNode(child.value));
    }
  }
  return el;
}
