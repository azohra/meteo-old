/* Tiny DOM builders for the elements binding: h() for HTML, hs() for SVG.
 * Each element renders as a pure `state → Node` function through these, so
 * the produced DOM is inspectable, escapable-by-construction (text becomes
 * text nodes, never markup), and byte-comparable to the react binding's
 * output in the parity suite. Internal — not part of the public surface.
 *
 * Attr rules mirror how react serializes: null/undefined/false skip the
 * attribute, true sets it empty (`hidden=""`), numbers stringify, and keys
 * beginning with "on" attach listeners instead of attributes. */

export type ElementChild = Node | string | number | null | undefined | false | ElementChild[];

type Attrs = Record<
  string,
  string | number | boolean | null | undefined | EventListener
> | null;

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(element: Element, attrs: Attrs, children: ElementChild[]): void {
  if (attrs != null) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (typeof value === "function") {
        element.addEventListener(name.slice(2), value);
        continue;
      }
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
  appendChildren(element, children);
}

function appendChildren(element: Element, children: ElementChild[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(element, child);
      continue;
    }
    element.append(typeof child === "number" ? String(child) : child);
  }
}

export function h(tag: string, attrs: Attrs = null, ...children: ElementChild[]): HTMLElement {
  const element = document.createElement(tag);
  apply(element, attrs, children);
  return element;
}

export function hs(tag: string, attrs: Attrs = null, ...children: ElementChild[]): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  apply(element, attrs, children);
  return element;
}
