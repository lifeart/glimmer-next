/**
 * PDF Browser DOM API
 * Implements the renderer interface for PDF document generation
 */

import {
  PdfBaseElement,
  PdfDocument,
  PdfPage,
  PdfView,
  PdfText,
  PdfTextNode,
  PdfImage,
  PdfLink,
  PdfCanvas,
  PdfNote,
  PdfComment,
  PdfFragment,
  DESTROYED_NODES,
  isPdfElement,
  isPdfFragment,
  isPdfDocument,
} from './elements';
import type { PdfStyle } from './types';

// Tag name to element class mapping
const ELEMENT_MAP: Record<string, new () => PdfBaseElement> = {
  document: PdfDocument,
  page: PdfPage,
  view: PdfView,
  text: PdfText,
  image: PdfImage,
  link: PdfLink,
  canvas: PdfCanvas,
  note: PdfNote,
};

// Style property aliases and shortcuts
const STYLE_ALIASES: Record<string, string[]> = {
  marginHorizontal: ['marginLeft', 'marginRight'],
  marginVertical: ['marginTop', 'marginBottom'],
  paddingHorizontal: ['paddingLeft', 'paddingRight'],
  paddingVertical: ['paddingTop', 'paddingBottom'],
};

type Props = [any[], [string, any][], any[]];

/**
 * PDF Browser DOM API class
 * Manages PDF element creation, insertion, and property updates
 */
export class PdfBrowserDOMApi {
  private _document: PdfDocument | null = null;
  private _onUpdate: (() => void) | null = null;

  toString(): string {
    return 'pdf:dom-api';
  }

  /**
   * Set the document root
   */
  setDocument(doc: PdfDocument): void {
    this._document = doc;
  }

  /**
   * Get the document root
   */
  getDocument(): PdfDocument | null {
    return this._document;
  }

  /**
   * Set callback for document updates
   */
  setOnUpdate(callback: () => void): void {
    this._onUpdate = callback;
  }

  /**
   * Notify that the document structure has changed
   */
  private notifyUpdate(): void {
    this._onUpdate?.();
  }

  /**
   * Check if a value is a PDF node
   */
  isNode(node: unknown): node is PdfBaseElement {
    return isPdfElement(node);
  }

  /**
   * Get parent of a node
   */
  parent(node: PdfBaseElement | null): PdfBaseElement | null {
    return node?.parentElement ?? null;
  }

  /**
   * Clear all children from a node
   */
  clearChildren(node: PdfBaseElement | null): void {
    if (!node) return;
    while (node.children.length > 0) {
      const child = node.children[0];
      this.destroy(child);
    }
    this.notifyUpdate();
  }

  /**
   * Add event listener (no-op for PDF, but required by interface)
   */
  addEventListener(
    _node: PdfBaseElement,
    _eventName: string,
    _fn: EventListener,
  ): undefined {
    // PDF elements don't support DOM events
    return undefined;
  }

  /**
   * Create a new element by tag name
   */
  element(
    tag: string,
    _isSVG = false,
    _anchor = false,
    _props: Props = [[], [], []],
  ): PdfBaseElement | null {
    const lowerTag = tag.toLowerCase();

    // Check for Pdf prefix and strip it
    const cleanTag = lowerTag.startsWith('pdf') ? lowerTag.slice(3) : lowerTag;

    const ElementClass = ELEMENT_MAP[cleanTag];
    if (!ElementClass) {
      console.warn(`[PdfRenderer] Unknown element type: ${tag}`);
      return new PdfComment(`unknown:${tag}`);
    }

    const element = new ElementClass();

    // Apply initial props from the props array
    const propPairs = _props[1];
    propPairs.forEach(([name, value]) => {
      this.prop(element, name, value);
    });

    return element;
  }

  /**
   * Insert a child into a parent
   */
  insert(
    parent: PdfBaseElement | null,
    child: PdfBaseElement | null,
    _anchor?: PdfBaseElement | null,
  ): void {
    if (!child) return;

    // Track document when first inserted (before parentNode check)
    if (isPdfDocument(child)) {
      this._document = child;
      // Document doesn't need to be inserted into a parent
      this.notifyUpdate();
      return;
    }

    const parentNode = parent || this._document;
    if (!parentNode) return;

    // Handle fragment insertion - unwrap and insert children
    if (isPdfFragment(child)) {
      const children = [...child.children];
      children.forEach((grandchild) => {
        this.insert(parentNode, grandchild, _anchor);
      });
      return;
    }

    // Standard insertion
    if (_anchor && parentNode.children.includes(_anchor)) {
      const index = parentNode.children.indexOf(_anchor);
      child.parentElement = parentNode;
      child.isConnected = true;
      parentNode.children.splice(index, 0, child);
    } else {
      parentNode.appendChild(child);
    }

    this.notifyUpdate();
  }

  /**
   * Destroy/remove a node from the tree
   */
  destroy(node: PdfBaseElement | null): void {
    if (!node) return;
    if (DESTROYED_NODES.has(node)) return;

    node.remove();
    this.notifyUpdate();
  }

  /**
   * Set an attribute on a node (delegates to prop)
   */
  attr(node: PdfBaseElement | null, name: string, value: any): void {
    this.prop(node, name, value);
  }

  /**
   * Set a property on a node
   */
  prop(node: PdfBaseElement | null, name: string, value: any): void {
    if (!node || node instanceof PdfComment || node instanceof PdfFragment) return;

    // Convert kebab-case to camelCase
    const propName = kebabToCamel(name);

    // Handle style property specially
    if (propName === 'style') {
      this.applyStyle(node, value);
      this.notifyUpdate();
      return;
    }

    // Handle paint function for canvas
    if (propName === 'paint' && node instanceof PdfCanvas) {
      node.paint = value;
      this.notifyUpdate();
      return;
    }

    // Handle content for note
    if (propName === 'content' && node instanceof PdfNote) {
      node.content = value;
      this.notifyUpdate();
      return;
    }

    // Set property directly if it exists on the element's props
    if ('props' in node && typeof node.props === 'object') {
      (node.props as Record<string, any>)[propName] = value;
      this.notifyUpdate();
    }
  }

  /**
   * Apply style object to a node
   */
  private applyStyle(node: PdfBaseElement, style: PdfStyle | PdfStyle[] | undefined): void {
    if (!style) return;
    if (!('props' in node)) return;

    // Merge style arrays into a single object
    const mergedStyle = Array.isArray(style)
      ? style.reduce((acc, s) => ({ ...acc, ...s }), {} as PdfStyle)
      : style;

    // Expand style aliases
    const expandedStyle: PdfStyle = {};
    for (const [key, value] of Object.entries(mergedStyle)) {
      if (STYLE_ALIASES[key]) {
        STYLE_ALIASES[key].forEach(aliasKey => {
          (expandedStyle as any)[aliasKey] = value;
        });
      } else {
        (expandedStyle as any)[key] = value;
      }
    }

    (node.props as any).style = expandedStyle;
  }

  /**
   * Create a comment node
   */
  comment(text?: string): PdfComment {
    return new PdfComment(text);
  }

  /**
   * Create a text node
   */
  text(text: string | number): PdfTextNode {
    return new PdfTextNode(String(text));
  }

  /**
   * Update text content of a text node
   */
  textContent(node: PdfTextNode | null, text: string): void {
    if (node instanceof PdfTextNode) {
      node.textContent = text;
      this.notifyUpdate();
    }
  }

  /**
   * Create a fragment node
   */
  fragment(): PdfFragment {
    return new PdfFragment();
  }

  /**
   * Serialize the document to JSON
   */
  toJSON(): Record<string, any> | null {
    return this._document?.toJSON() ?? null;
  }
}

/**
 * Convert kebab-case to camelCase
 */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Create a new PDF API instance
 */
export function createPdfApi(): PdfBrowserDOMApi {
  return new PdfBrowserDOMApi();
}
