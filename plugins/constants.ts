import { SYMBOLS } from "./symbols";
export const booleanAttributes = [
  'checked',
  'readonly',
  'autoplay',
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'required',
  'reversed',
  'selected',
];

export const propertyKeys = [
  'class',
  'shadowrootmode',
  // boolean attributes (https://meiert.com/en/blog/boolean-attributes-of-html/)
  'checked',
  'readonly',
  'value',
  'autoplay',
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'required',
  'reversed',
  'selected',
];
export const COMPILE_TIME_HELPERS = ['has-block-params', 'has-block'];

export const BUILTIN_HELPERS = {
  'or': SYMBOLS.$__or,
  'and': SYMBOLS.$__and,
  'eq': SYMBOLS.$__eq,
  'not': SYMBOLS.$__not,
  'if': SYMBOLS.$__if,
  'debugger': `${SYMBOLS.$__debugger}.call`,
  'log': SYMBOLS.$__log,
  'array': SYMBOLS.$__array,
  'hash': SYMBOLS.$__hash,
  'fn': SYMBOLS.$__fn,
}

// Reserved names that may cause conflicts when used as variable names in templates
// These include JS globals and HTML/SVG element names that could be mistaken for components
export const JS_GLOBALS = new Set([
  // Primitive constructors
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Function', 'Symbol', 'BigInt',
  // Error types
  'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
  // Built-in objects
  'Math', 'JSON', 'Date', 'RegExp', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Proxy', 'Reflect', 'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array',
  // Global functions
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'eval', 'undefined', 'NaN', 'Infinity',
  // DOM globals (commonly confused)
  'window', 'document', 'console', 'location', 'history', 'navigator',
  'Element', 'Node', 'Event', 'URL',
]);

// SVG/HTML element names that could be confused with component references
export const ELEMENT_TAG_NAMES = new Set([
  // SVG elements commonly used in canvas-like rendering
  'text', 'line', 'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline',
  'image', 'use', 'g', 'svg', 'defs', 'symbol', 'marker', 'pattern',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'filter',
  'foreignObject', 'switch', 'a', 'tspan', 'textPath',
  // HTML elements that might be used as variable names
  'input', 'button', 'form', 'label', 'select', 'option', 'textarea',
  'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'header', 'footer', 'main', 'nav', 'section', 'article', 'aside',
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'video', 'audio', 'canvas', 'iframe', 'embed', 'object',
  'link', 'meta', 'style', 'script', 'title', 'base',
  'br', 'hr', 'pre', 'code', 'blockquote', 'q', 'cite',
  'abbr', 'address', 'time', 'mark', 'del', 'ins', 'sub', 'sup',
  'small', 'strong', 'em', 'b', 'i', 'u', 's',
]);