// Criação de elementos sem innerHTML: todo texto entra como nó de texto.

const SVG_NS = 'http://www.w3.org/2000/svg';

function appendChildren(node, children) {
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [props] `class`, `dataset`, `on<evento>`, propriedades do DOM ou atributos.
 * @param {...(Node|string|null|false|Array<Node|string|null|false>)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  return appendChildren(node, children);
}

/**
 * @param {string} tag
 * @param {Record<string, string|number>} [attrs]
 * @param {...(Node|string|null|false)} children
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return appendChildren(node, children);
}

/** @param {string} id @returns {HTMLElement} */
export function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} não encontrado na página.`);
  return node;
}

// Só toca no DOM quando o texto muda, para não gerar trabalho a cada quadro.
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
