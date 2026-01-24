/**
 * PdfViewer - A component for rendering PDF documents in GXT
 *
 * This component provides a container for building PDF documents
 * using a declarative component-based API similar to react-pdf.
 *
 * Usage:
 * ```gts
 * <PdfViewer @onRender={{this.handleRender}}>
 *   <PdfDocument>
 *     <PdfPage size="A4">
 *       <PdfView style={{this.containerStyle}}>
 *         <PdfText style={{this.titleStyle}}>Hello World</PdfText>
 *       </PdfView>
 *     </PdfPage>
 *   </PdfDocument>
 * </PdfViewer>
 * ```
 */

import {
  $_tag,
  $_fin,
  $_GET_ARGS,
  $_GET_SLOTS,
  setParentContext,
} from '@/core/dom';
import { Component } from '@/core/component';
import { registerDestructor } from '@/core/glimmer/destroyable';
import { initDOM, provideContext, RENDERING_CONTEXT } from '@/core/context';
import { PdfBrowserDOMApi } from './pdf-api';
import {
  PdfDocument,
  PdfPage,
  PdfView,
  PdfText,
  PdfTextNode,
  PdfImage,
  PdfLink,
  isPdfPage,
  isPdfView,
  isPdfText,
  isPdfTextNode,
  isPdfImage,
  isPdfLink,
} from './elements';
import {
  addToTree,
  cId,
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
  $template,
} from '@/core/shared';
import type { Root } from '@/core/dom';
import { renderElement } from '@/core/render-core';
import { PageSizes, StyleSheet } from './StyleSheet';
import type { PdfStyle } from './types';
import { calculateLayout, type LayoutNode } from './yoga-layout';

/**
 * Normalize style to a single object (flatten if array)
 */
function normalizeStyle(style?: PdfStyle | PdfStyle[]): PdfStyle {
  if (!style) return {};
  if (Array.isArray(style)) {
    return StyleSheet.flatten(style);
  }
  return style;
}

/**
 * Convert a style value to number (handles strings with units)
 */
function toNumber(value: number | string | undefined, defaultValue = 0): number {
  if (value === undefined) return defaultValue;
  if (typeof value === 'number') return value;
  // Parse string values (e.g., "10px", "1in", "2cm")
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a hex color string to RGB values
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');

  // Handle shorthand hex (e.g., #fff -> #ffffff)
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(c => c + c).join('')
    : cleanHex;

  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);

  return { r: isNaN(r) ? 0 : r, g: isNaN(g) ? 0 : g, b: isNaN(b) ? 0 : b };
}

// Context symbol for PDF
export const PDF_CONTEXT = Symbol('PDF_CONTEXT');

export interface PdfViewerSignature {
  Args: {
    /** Width of the viewer */
    width?: string;
    /** Height of the viewer */
    height?: string;
    /** Show toolbar in viewer */
    showToolbar?: boolean;
    /** Called when PDF is rendered */
    onRender?: (blob: Blob) => void;
    /** Called on error */
    onError?: (error: Error) => void;
    /** Auto-update on changes (default: true) */
    autoUpdate?: boolean;
    /** CSS class for the container */
    className?: string;
  };
  Blocks: {
    default: [];
  };
  [key: string]: unknown;
}

export type PdfViewerProps = PdfViewerSignature['Args'];

export interface PdfContext {
  api: PdfBrowserDOMApi;
  document: PdfDocument | null;
  render: () => Promise<Blob | null>;
  download: (filename?: string) => Promise<void>;
  getBlob: () => Promise<Blob | null>;
  getDataUrl: () => Promise<string | null>;
}

/**
 * Create PDF context state
 */
export function createPdfContextState(api: PdfBrowserDOMApi): PdfContext {
  return {
    api,
    get document() {
      return api.getDocument();
    },
    async render() {
      const doc = api.getDocument();
      if (!doc) return null;
      return renderPdfDocument(doc);
    },
    async download(filename = 'document.pdf') {
      const blob = await this.render();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    },
    async getBlob() {
      return this.render();
    },
    async getDataUrl() {
      const blob = await this.render();
      if (!blob) return null;
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    },
  };
}

/**
 * Get page dimensions from size specification
 */
function getPageDimensions(
  size: string | { width: number; height: number } | [number, number] | undefined,
  orientation: 'portrait' | 'landscape' = 'portrait'
): { width: number; height: number } {
  let width: number;
  let height: number;

  if (Array.isArray(size)) {
    // Handle [width, height] tuple
    [width, height] = size;
  } else if (typeof size === 'object' && size !== null) {
    width = size.width;
    height = size.height;
  } else {
    const sizeKey = (String(size) || 'A4').toUpperCase() as keyof typeof PageSizes;
    const pageSize = PageSizes[sizeKey] || PageSizes.A4;
    width = pageSize.width;
    height = pageSize.height;
  }

  // Swap for landscape
  if (orientation === 'landscape') {
    [width, height] = [height, width];
  }

  return { width, height };
}

/**
 * Create a text measurement function for yoga layout
 */
function createTextMeasurer(pdf: InstanceType<typeof import('jspdf').jsPDF>) {
  return (text: string, style?: PdfStyle): { width: number; height: number } => {
    const fontSize = toNumber(style?.fontSize, 12);
    const lineHeight = toNumber(style?.lineHeight, 1.2) * fontSize;

    // Set font for measurement
    pdf.setFontSize(fontSize);

    // Get text width
    const textWidth = pdf.getTextWidth(text);

    // Simple height calculation based on single line
    const height = lineHeight;

    return { width: textWidth, height };
  };
}

/**
 * Render a PDF document to a Blob using jsPDF with yoga layout
 */
async function renderPdfDocument(doc: PdfDocument): Promise<Blob> {
  // Dynamically import jsPDF to keep it lazy-loaded
  const { jsPDF } = await import('jspdf');

  // Get first page to determine initial size
  const firstPage = doc.children.find(isPdfPage) as PdfPage | undefined;
  const firstPageDims = getPageDimensions(
    firstPage?.size,
    firstPage?.orientation
  );

  // Create jsPDF instance
  const pdf = new jsPDF({
    orientation: firstPage?.orientation || 'portrait',
    unit: 'pt',
    format: [firstPageDims.width, firstPageDims.height],
  });

  // Set document properties
  pdf.setProperties({
    title: doc.title || '',
    author: doc.author || '',
    subject: doc.subject || '',
    keywords: doc.keywords || '',
    creator: doc.creator || 'GXT PDF Renderer',
  });

  // Create text measurer for yoga
  const measureText = createTextMeasurer(pdf);

  let isFirstPage = true;

  // Process each page
  for (const child of doc.children) {
    if (isPdfPage(child)) {
      const page = child as PdfPage;
      const dims = getPageDimensions(page.size, page.orientation);

      if (!isFirstPage) {
        pdf.addPage([dims.width, dims.height], page.orientation || 'portrait');
      }
      isFirstPage = false;

      // Calculate layout using yoga
      const layoutTree = await calculateLayout(page, dims.width, dims.height, measureText);

      // Render using computed layout
      await renderLayoutNode(pdf, layoutTree, 0, 0);
    }
  }

  // Generate blob
  return pdf.output('blob');
}

/**
 * Render a layout node and its children using computed positions
 */
async function renderLayoutNode(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  layoutNode: LayoutNode,
  parentX: number,
  parentY: number
): Promise<void> {
  const { element, layout, children } = layoutNode;
  const x = parentX + layout.left;
  const y = parentY + layout.top;

  if (isPdfView(element)) {
    await renderViewWithLayout(pdf, element as PdfView, x, y, layout.width, layout.height);
  } else if (isPdfText(element)) {
    await renderTextWithLayout(pdf, element as PdfText, x, y, layout.width);
  } else if (isPdfImage(element)) {
    await renderImageWithLayout(pdf, element as PdfImage, x, y, layout.width, layout.height);
  } else if (isPdfLink(element)) {
    await renderLinkWithLayout(pdf, element as PdfLink, x, y, layout.width, layout.height, children);
  }

  // Render children (except for link which handles its own children)
  if (!isPdfLink(element)) {
    for (const child of children) {
      await renderLayoutNode(pdf, child, x, y);
    }
  }
}

/**
 * Render a View with computed layout
 */
async function renderViewWithLayout(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  view: PdfView,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  const style = normalizeStyle(view.style);

  // Apply background color
  if (style.backgroundColor) {
    const bgColor = style.backgroundColor;
    if (typeof bgColor === 'string' && bgColor.match(/^#?[0-9a-fA-F]{3,6}$/)) {
      const { r, g, b } = parseHexColor(bgColor);
      pdf.setFillColor(r, g, b);
    } else {
      pdf.setFillColor(bgColor);
    }
    pdf.rect(x, y, width, height, 'F');
  }
}

/**
 * Render text with computed layout
 */
async function renderTextWithLayout(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  text: PdfText,
  x: number,
  y: number,
  maxWidth: number
): Promise<void> {
  const style = normalizeStyle(text.style);

  // Set font properties
  const fontSize = toNumber(style.fontSize, 12);
  const fontWeight = style.fontWeight === 'bold' ? 'bold' : 'normal';
  const fontStyle = style.fontStyle === 'italic' ? 'italic' : 'normal';
  const fontFamily = String(style.fontFamily ?? 'helvetica');

  // Map font family to jsPDF font
  let pdfFont = 'helvetica';
  if (fontFamily.toLowerCase().includes('times')) {
    pdfFont = 'times';
  } else if (fontFamily.toLowerCase().includes('courier')) {
    pdfFont = 'courier';
  }

  // Set font style string for jsPDF
  let fontStyleStr = 'normal';
  if (fontWeight === 'bold' && fontStyle === 'italic') {
    fontStyleStr = 'bolditalic';
  } else if (fontWeight === 'bold') {
    fontStyleStr = 'bold';
  } else if (fontStyle === 'italic') {
    fontStyleStr = 'italic';
  }

  pdf.setFont(pdfFont, fontStyleStr);
  pdf.setFontSize(fontSize);

  // Set text color
  const colorValue = style.color ?? '#000000';
  if (typeof colorValue === 'string' && colorValue.match(/^#?[0-9a-fA-F]{3,6}$/)) {
    const { r, g, b } = parseHexColor(colorValue);
    pdf.setTextColor(r, g, b);
  } else {
    pdf.setTextColor(0, 0, 0);
  }

  // Collect text content
  let textContent = '';
  for (const child of text.children) {
    if (isPdfTextNode(child)) {
      textContent += (child as PdfTextNode).textContent;
    }
  }

  // Handle text alignment
  const align = style.textAlign ?? 'left';
  let textX = x;
  if (align === 'center') {
    textX = x + maxWidth / 2;
  } else if (align === 'right') {
    textX = x + maxWidth;
  }

  // Render text with word wrapping
  const lineHeight = toNumber(style.lineHeight, 1.2) * fontSize;
  const lines = pdf.splitTextToSize(textContent, maxWidth);
  const textY = y + fontSize; // jsPDF y is baseline

  lines.forEach((line: string, index: number) => {
    pdf.text(line, textX, textY + index * lineHeight, {
      align: align as 'left' | 'center' | 'right',
    });
  });
}

/**
 * Render image with computed layout
 */
async function renderImageWithLayout(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  image: PdfImage,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  if (!image.src || typeof image.src !== 'string') return;

  try {
    if (image.src.startsWith('data:')) {
      pdf.addImage(image.src, 'PNG', x, y, width, height);
    } else {
      const response = await fetch(image.src);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      let format = 'PNG';
      if (image.src.toLowerCase().endsWith('.jpg') || image.src.toLowerCase().endsWith('.jpeg')) {
        format = 'JPEG';
      }

      pdf.addImage(dataUrl, format, x, y, width, height);
    }
  } catch (error) {
    console.warn('[PDF] Failed to load image:', image.src, error);
    // Draw placeholder
    pdf.setDrawColor(204, 204, 204);
    pdf.setFillColor(240, 240, 240);
    pdf.rect(x, y, width, height, 'FD');
    pdf.setFontSize(10);
    pdf.setTextColor(153, 153, 153);
    pdf.text('Image', x + width / 2, y + height / 2, { align: 'center' });
  }
}

/**
 * Render link with computed layout
 */
async function renderLinkWithLayout(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  link: PdfLink,
  x: number,
  y: number,
  width: number,
  height: number,
  children: LayoutNode[]
): Promise<void> {
  const style = normalizeStyle(link.style);

  // Set link color
  const colorValue = style.color ?? '#0000EE';
  if (typeof colorValue === 'string' && colorValue.match(/^#?[0-9a-fA-F]{3,6}$/)) {
    const { r, g, b } = parseHexColor(colorValue);
    pdf.setTextColor(r, g, b);
  } else {
    pdf.setTextColor(0, 0, 238);
  }

  // Render children
  for (const child of children) {
    await renderLayoutNode(pdf, child, x, y);
  }

  // Add link annotation
  if (link.src) {
    pdf.link(x, y, width, height, { url: link.src });
  }

  // Reset text color
  pdf.setTextColor(0, 0, 0);
}


/**
 * PdfViewer Component
 */
export class PdfViewer extends Component<PdfViewerSignature> {
  private containerNode!: HTMLDivElement;
  private iframeNode!: HTMLIFrameElement;
  private api!: PdfBrowserDOMApi;
  private pdfContext!: PdfContext;
  private root!: Root;
  private renderTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // @ts-expect-error args types
    super(...arguments);
    // @ts-expect-error args types
    this[$template] = this._template;
  }

  private scheduleRender = () => {
    const args = this.args;
    if (args.autoUpdate === false) return;
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    this.renderTimeout = setTimeout(async () => {
      try {
        const blob = await this.pdfContext.render();
        if (blob) {
          const url = URL.createObjectURL(blob);
          this.iframeNode.src = url;
          args.onRender?.(blob);
        }
      } catch (error) {
        args.onError?.(error as Error);
      }
    }, 100);
  };

  private cleanup = () => {
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    if (this.iframeNode?.src && this.iframeNode.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.iframeNode.src);
    }
  };

  _template() {
    $_GET_ARGS(this, arguments);
    const args = this.args;

    // Create container element
    this.containerNode = $_tag('div', [[], [], []], [], this) as HTMLDivElement;
    this.containerNode.style.display = 'block';
    this.containerNode.style.width = args.width ?? '100%';
    this.containerNode.style.height = args.height ?? '600px';
    this.containerNode.style.position = 'relative';
    if (args.className) {
      this.containerNode.className = args.className;
    }

    // Create iframe for PDF display
    this.iframeNode = document.createElement('iframe');
    this.iframeNode.style.width = '100%';
    this.iframeNode.style.height = '100%';
    this.iframeNode.style.border = 'none';
    this.containerNode.appendChild(this.iframeNode);

    const parentApi = initDOM(this);
    const comment = parentApi.comment('pdf-placeholder');

    const $slots = $_GET_SLOTS(this, arguments);

    // Create the PDF API
    this.api = new PdfBrowserDOMApi();

    // Create context state
    this.pdfContext = createPdfContextState(this.api);

    // Create a context for GXT rendering
    this.root = {
      [COMPONENT_ID_PROPERTY]: cId(),
      [RENDERED_NODES_PROPERTY]: [],
    } as unknown as Root;

    // Provide the rendering context on BOTH the component AND the root
    // This ensures slot content can find it through the parent chain
    provideContext(this, RENDERING_CONTEXT, this.api);
    provideContext(this.root, RENDERING_CONTEXT, this.api);
    provideContext(this.root, PDF_CONTEXT, this.pdfContext);

    addToTree(this, this.root as unknown as Component<PdfViewerSignature>);

    // Set up update callback
    this.api.setOnUpdate(this.scheduleRender);

    registerDestructor(this, this.cleanup);

    // Render slots with proper context
    let nodes: unknown[] = [];
    try {
      setParentContext(this.root);
      nodes = $slots.default(this.root);
    } finally {
      setParentContext(null);
    }

    // Use the same callback pattern as CanvasRenderer for proper timing
    return $_fin(
      [
        this.containerNode,
        // @ts-expect-error internal callback
        () => {
          // Process nodes - find document and set it
          nodes.forEach((node: unknown) => {
            if (node instanceof PdfDocument) {
              this.api.setDocument(node);
            }
          });

          // Render elements with proper context
          const doc = this.api.getDocument();
          if (doc) {
            // @ts-expect-error internal rendering
            renderElement(this.api, this.root, doc, $_fin(nodes, this.root));
          }

          // Initial render
          this.scheduleRender();

          return comment;
        },
      ],
      this,
    );
  }
}

/**
 * PdfDownloadLink - A component for downloading PDFs
 */
export interface PdfDownloadLinkProps {
  document: PdfDocument;
  fileName?: string;
  className?: string;
  style?: Record<string, string>;
}

// @ts-expect-error internal component typing
export function PdfDownloadLink(this: Component<PdfDownloadLinkProps>) {
  $_GET_ARGS(this, arguments);
  const args = this.args as PdfDownloadLinkProps;
  const $slots = $_GET_SLOTS(this, arguments);

  const linkNode = $_tag('a', [[], [], []], [], this) as HTMLAnchorElement;
  linkNode.href = '#';
  linkNode.style.cursor = 'pointer';
  if (args.className) {
    linkNode.className = args.className;
  }
  if (args.style) {
    Object.assign(linkNode.style, args.style);
  }

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault();
    try {
      const blob = await renderPdfDocument(args.document);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = args.fileName || 'document.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[PdfDownloadLink] Error generating PDF:', error);
    }
  };

  linkNode.addEventListener('click', handleClick);

  registerDestructor(this, () => {
    linkNode.removeEventListener('click', handleClick);
  });

  // Render slot content into link
  const parentApi = initDOM(this);
  const root = {
    [COMPONENT_ID_PROPERTY]: cId(),
    [RENDERED_NODES_PROPERTY]: [],
  } as unknown as Root;

  let nodes: any[] = [];
  try {
    setParentContext(root);
    nodes = $slots.default?.(root) || [];
  } finally {
    setParentContext(null);
  }

  // Append text/element nodes to link
  nodes.forEach((node: any) => {
    if (typeof node === 'string') {
      linkNode.appendChild(document.createTextNode(node));
    } else if (node instanceof Node) {
      linkNode.appendChild(node);
    }
  });

  return $_fin([linkNode, parentApi.comment('pdf-download-link')], this);
}

/**
 * BlobProvider - Provides PDF blob data via render prop pattern
 */
export interface BlobProviderProps {
  document: PdfDocument;
}

// @ts-expect-error internal component typing
export function BlobProvider(this: Component<BlobProviderProps>) {
  $_GET_ARGS(this, arguments);
  const args = this.args as BlobProviderProps;
  const $slots = $_GET_SLOTS(this, arguments);

  const parentApi = initDOM(this);
  const comment = parentApi.comment('blob-provider');

  // State for blob data
  let blob: Blob | null = null;
  let url: string | null = null;
  let loading = true;
  let error: Error | null = null;

  const root = {
    [COMPONENT_ID_PROPERTY]: cId(),
    [RENDERED_NODES_PROPERTY]: [],
  } as unknown as Root;

  // Generate PDF
  renderPdfDocument(args.document)
    .then((result) => {
      blob = result;
      url = URL.createObjectURL(result);
      loading = false;
    })
    .catch((err) => {
      error = err;
      loading = false;
    });

  registerDestructor(this, () => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  });

  // Render with blob data
  let nodes: any[] = [];
  try {
    setParentContext(root);
    nodes = $slots.default?.(root, { blob, url, loading, error }) || [];
  } finally {
    setParentContext(null);
  }

  return $_fin([...nodes, comment], this);
}
