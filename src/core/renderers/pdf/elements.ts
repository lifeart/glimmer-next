/**
 * PDF Element Classes
 * These represent the virtual PDF document structure before rendering
 */

import type {
  PdfStyle,
  PageSize,
  PageOrientation,
  PageMode,
  PageLayout,
  ImageSource,
  PdfPaintContext,
  DocumentProps,
  PageProps,
  ViewProps,
  TextProps,
  ImageProps,
  LinkProps,
  CanvasProps,
  NoteProps,
} from './types';

// WeakSet to track destroyed elements
export const DESTROYED_NODES: WeakSet<PdfBaseElement> = new WeakSet();

/**
 * Base class for all PDF elements
 */
export class PdfBaseElement {
  readonly isPdfElement = true;
  debugName?: string;
  parentElement: PdfBaseElement | null = null;
  children: PdfBaseElement[] = [];
  isConnected = false;

  get parentNode(): PdfBaseElement | null {
    return this.parentElement;
  }

  removeChild(child: PdfBaseElement): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
      child.isConnected = false;
    }
  }

  appendChild(child: PdfBaseElement): void {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
  }

  remove(): void {
    if (DESTROYED_NODES.has(this)) {
      return;
    }
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
    this.isConnected = false;
    DESTROYED_NODES.add(this);
    // Recursively remove children
    this.children.forEach(child => child.remove());
    this.children.length = 0;
    this.parentElement = null;
  }

  get childNodes(): PdfBaseElement[] {
    return this.children;
  }

  /**
   * Serialize element to a plain object for PDF generation
   */
  toJSON(): Record<string, any> {
    return {
      type: 'base',
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * Comment/placeholder element (invisible)
 */
export class PdfComment extends PdfBaseElement {
  readonly isPdfComment = true;
  text: string;

  constructor(text?: string) {
    super();
    this.text = text || '';
    this.debugName = text || 'comment';
  }

  toJSON(): Record<string, any> {
    return { type: 'comment', text: this.text };
  }
}

/**
 * Fragment element for grouping
 */
export class PdfFragment extends PdfBaseElement {
  readonly isPdfFragment = true;

  constructor() {
    super();
    this.debugName = 'fragment';
  }

  toJSON(): Record<string, any> {
    return {
      type: 'fragment',
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * Text node element
 */
export class PdfTextNode extends PdfBaseElement {
  readonly isPdfTextNode = true;
  textContent = '';

  constructor(text?: string) {
    super();
    this.textContent = text || '';
    this.debugName = 'textNode';
  }

  toJSON(): Record<string, any> {
    return { type: 'textNode', content: this.textContent };
  }
}

/**
 * Document element - root container for PDF
 */
export class PdfDocument extends PdfBaseElement {
  readonly isPdfDocument = true;
  props: DocumentProps = {};

  constructor() {
    super();
    this.debugName = 'document';
  }

  // Document metadata
  get title(): string | undefined { return this.props.title; }
  set title(value: string | undefined) { this.props.title = value; }

  get author(): string | undefined { return this.props.author; }
  set author(value: string | undefined) { this.props.author = value; }

  get subject(): string | undefined { return this.props.subject; }
  set subject(value: string | undefined) { this.props.subject = value; }

  get keywords(): string | undefined { return this.props.keywords; }
  set keywords(value: string | undefined) { this.props.keywords = value; }

  get creator(): string | undefined { return this.props.creator; }
  set creator(value: string | undefined) { this.props.creator = value; }

  get producer(): string | undefined { return this.props.producer; }
  set producer(value: string | undefined) { this.props.producer = value; }

  get pdfVersion(): string | undefined { return this.props.pdfVersion; }
  set pdfVersion(value: string | undefined) { this.props.pdfVersion = value; }

  get language(): string | undefined { return this.props.language; }
  set language(value: string | undefined) { this.props.language = value; }

  get pageMode(): PageMode | undefined { return this.props.pageMode; }
  set pageMode(value: PageMode | undefined) { this.props.pageMode = value; }

  get pageLayout(): PageLayout | undefined { return this.props.pageLayout; }
  set pageLayout(value: PageLayout | undefined) { this.props.pageLayout = value; }

  get onRender(): ((blob: Blob) => void) | undefined { return this.props.onRender; }
  set onRender(value: ((blob: Blob) => void) | undefined) { this.props.onRender = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'document',
      props: { ...this.props },
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * Page element - represents a single page in the PDF
 */
export class PdfPage extends PdfBaseElement {
  readonly isPdfPage = true;
  props: PageProps = {
    size: 'A4',
    orientation: 'portrait',
    wrap: true,
  };

  constructor() {
    super();
    this.debugName = 'page';
  }

  get size(): PageSize { return this.props.size || 'A4'; }
  set size(value: PageSize) { this.props.size = value; }

  get orientation(): PageOrientation { return this.props.orientation || 'portrait'; }
  set orientation(value: PageOrientation) { this.props.orientation = value; }

  get wrap(): boolean { return this.props.wrap ?? true; }
  set wrap(value: boolean) { this.props.wrap = value; }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get debug(): boolean { return this.props.debug ?? false; }
  set debug(value: boolean) { this.props.debug = value; }

  get dpi(): number { return this.props.dpi || 72; }
  set dpi(value: number) { this.props.dpi = value; }

  get id(): string | undefined { return this.props.id; }
  set id(value: string | undefined) { this.props.id = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'page',
      props: { ...this.props },
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * View element - layout container (like a div)
 */
export class PdfView extends PdfBaseElement {
  readonly isPdfView = true;
  props: ViewProps = {
    wrap: true,
  };

  constructor() {
    super();
    this.debugName = 'view';
  }

  get wrap(): boolean { return this.props.wrap ?? true; }
  set wrap(value: boolean) { this.props.wrap = value; }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get debug(): boolean { return this.props.debug ?? false; }
  set debug(value: boolean) { this.props.debug = value; }

  get fixed(): boolean { return this.props.fixed ?? false; }
  set fixed(value: boolean) { this.props.fixed = value; }

  get id(): string | undefined { return this.props.id; }
  set id(value: string | undefined) { this.props.id = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'view',
      props: { ...this.props },
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * Text element - displays text content
 */
export class PdfText extends PdfBaseElement {
  readonly isPdfText = true;
  props: TextProps = {
    wrap: true,
  };

  constructor() {
    super();
    this.debugName = 'text';
  }

  get wrap(): boolean { return this.props.wrap ?? true; }
  set wrap(value: boolean) { this.props.wrap = value; }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get debug(): boolean { return this.props.debug ?? false; }
  set debug(value: boolean) { this.props.debug = value; }

  get fixed(): boolean { return this.props.fixed ?? false; }
  set fixed(value: boolean) { this.props.fixed = value; }

  get id(): string | undefined { return this.props.id; }
  set id(value: string | undefined) { this.props.id = value; }

  /**
   * Get the text content from children
   */
  getTextContent(): string {
    const collectText = (element: PdfBaseElement): string => {
      if (element instanceof PdfTextNode) {
        return element.textContent;
      }
      return element.children.map(collectText).join('');
    };
    return collectText(this);
  }

  toJSON(): Record<string, any> {
    return {
      type: 'text',
      props: { ...this.props },
      content: this.getTextContent(),
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * Image element - displays images
 */
export class PdfImage extends PdfBaseElement {
  readonly isPdfImage = true;
  props: ImageProps = {
    cache: true,
  };

  constructor() {
    super();
    this.debugName = 'image';
  }

  get src(): ImageSource | undefined { return this.props.src || this.props.source; }
  set src(value: ImageSource | undefined) { this.props.src = value; }

  get source(): ImageSource | undefined { return this.props.source || this.props.src; }
  set source(value: ImageSource | undefined) { this.props.source = value; }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get debug(): boolean { return this.props.debug ?? false; }
  set debug(value: boolean) { this.props.debug = value; }

  get fixed(): boolean { return this.props.fixed ?? false; }
  set fixed(value: boolean) { this.props.fixed = value; }

  get cache(): boolean { return this.props.cache ?? true; }
  set cache(value: boolean) { this.props.cache = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'image',
      props: { ...this.props },
    };
  }
}

/**
 * Link element - creates hyperlinks
 */
export class PdfLink extends PdfBaseElement {
  readonly isPdfLink = true;
  props: LinkProps = {
    wrap: true,
  };

  constructor() {
    super();
    this.debugName = 'link';
  }

  get src(): string | undefined { return this.props.src; }
  set src(value: string | undefined) { this.props.src = value; }

  get wrap(): boolean { return this.props.wrap ?? true; }
  set wrap(value: boolean) { this.props.wrap = value; }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get debug(): boolean { return this.props.debug ?? false; }
  set debug(value: boolean) { this.props.debug = value; }

  get fixed(): boolean { return this.props.fixed ?? false; }
  set fixed(value: boolean) { this.props.fixed = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'link',
      props: { ...this.props },
      children: this.children.map(child => child.toJSON()),
    };
  }
}

/**
 * Canvas element - for custom drawing
 */
export class PdfCanvas extends PdfBaseElement {
  readonly isPdfCanvas = true;
  props: CanvasProps = {};
  private _paint?: (ctx: PdfPaintContext, width: number, height: number) => void;

  constructor() {
    super();
    this.debugName = 'canvas';
  }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get paint(): ((ctx: PdfPaintContext, width: number, height: number) => void) | undefined {
    return this._paint;
  }
  set paint(value: ((ctx: PdfPaintContext, width: number, height: number) => void) | undefined) {
    this._paint = value;
  }

  get debug(): boolean { return this.props.debug ?? false; }
  set debug(value: boolean) { this.props.debug = value; }

  get fixed(): boolean { return this.props.fixed ?? false; }
  set fixed(value: boolean) { this.props.fixed = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'canvas',
      props: { ...this.props },
      hasPaint: !!this._paint,
    };
  }
}

/**
 * Note element - creates annotations
 */
export class PdfNote extends PdfBaseElement {
  readonly isPdfNote = true;
  props: NoteProps = {};
  content = '';

  constructor() {
    super();
    this.debugName = 'note';
  }

  get style(): PdfStyle | PdfStyle[] | undefined { return this.props.style; }
  set style(value: PdfStyle | PdfStyle[] | undefined) { this.props.style = value; }

  get fixed(): boolean { return this.props.fixed ?? false; }
  set fixed(value: boolean) { this.props.fixed = value; }

  toJSON(): Record<string, any> {
    return {
      type: 'note',
      props: { ...this.props },
      content: this.content,
    };
  }
}

/**
 * Type guard functions
 */
export function isPdfElement(node: unknown): node is PdfBaseElement {
  return node instanceof PdfBaseElement;
}

export function isPdfDocument(node: unknown): node is PdfDocument {
  return node instanceof PdfDocument;
}

export function isPdfPage(node: unknown): node is PdfPage {
  return node instanceof PdfPage;
}

export function isPdfView(node: unknown): node is PdfView {
  return node instanceof PdfView;
}

export function isPdfText(node: unknown): node is PdfText {
  return node instanceof PdfText;
}

export function isPdfTextNode(node: unknown): node is PdfTextNode {
  return node instanceof PdfTextNode;
}

export function isPdfImage(node: unknown): node is PdfImage {
  return node instanceof PdfImage;
}

export function isPdfLink(node: unknown): node is PdfLink {
  return node instanceof PdfLink;
}

export function isPdfCanvas(node: unknown): node is PdfCanvas {
  return node instanceof PdfCanvas;
}

export function isPdfNote(node: unknown): node is PdfNote {
  return node instanceof PdfNote;
}

export function isPdfComment(node: unknown): node is PdfComment {
  return node instanceof PdfComment;
}

export function isPdfFragment(node: unknown): node is PdfFragment {
  return node instanceof PdfFragment;
}
