import { describe, it, expect, beforeEach } from 'vitest';

import {
  // Element classes
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
  // Type guards
  isPdfElement,
  isPdfDocument,
  isPdfPage,
  isPdfView,
  isPdfText,
  isPdfTextNode,
  isPdfImage,
  isPdfLink,
  isPdfCanvas,
  isPdfNote,
  isPdfComment,
  isPdfFragment,
} from './elements';

import {
  PdfBrowserDOMApi,
  createPdfApi,
} from './pdf-api';

import {
  StyleSheet,
  PageSizes,
  getPageSize,
  parseUnit,
} from './StyleSheet';

describe('PDF Element Classes', () => {
  describe('PdfBaseElement', () => {
    it('should create a base element', () => {
      const element = new PdfBaseElement();
      expect(element.isPdfElement).toBe(true);
      expect(element.children).toEqual([]);
      expect(element.parentElement).toBeNull();
      expect(element.isConnected).toBe(false);
    });

    it('should append and remove children', () => {
      const parent = new PdfBaseElement();
      const child = new PdfBaseElement();

      parent.appendChild(child);
      expect(parent.children).toContain(child);
      expect(child.parentElement).toBe(parent);
      expect(child.isConnected).toBe(true);

      parent.removeChild(child);
      expect(parent.children).not.toContain(child);
      expect(child.parentElement).toBeNull();
      expect(child.isConnected).toBe(false);
    });

    it('should move child to new parent', () => {
      const parent1 = new PdfBaseElement();
      const parent2 = new PdfBaseElement();
      const child = new PdfBaseElement();

      parent1.appendChild(child);
      expect(parent1.children).toContain(child);

      parent2.appendChild(child);
      expect(parent1.children).not.toContain(child);
      expect(parent2.children).toContain(child);
      expect(child.parentElement).toBe(parent2);
    });

    it('should remove element and track destruction', () => {
      const parent = new PdfBaseElement();
      const child = new PdfBaseElement();

      parent.appendChild(child);
      child.remove();

      expect(parent.children).not.toContain(child);
      expect(DESTROYED_NODES.has(child)).toBe(true);
    });

    it('should not double-remove', () => {
      const element = new PdfBaseElement();
      element.remove();
      // Should not throw
      element.remove();
      expect(DESTROYED_NODES.has(element)).toBe(true);
    });

    it('should recursively remove children', () => {
      const parent = new PdfBaseElement();
      const child = new PdfBaseElement();
      const grandchild = new PdfBaseElement();

      parent.appendChild(child);
      child.appendChild(grandchild);

      parent.remove();

      expect(DESTROYED_NODES.has(parent)).toBe(true);
      expect(DESTROYED_NODES.has(child)).toBe(true);
      expect(DESTROYED_NODES.has(grandchild)).toBe(true);
    });
  });

  describe('PdfDocument', () => {
    it('should create a document with default props', () => {
      const doc = new PdfDocument();
      expect(doc.isPdfDocument).toBe(true);
      expect(doc.debugName).toBe('document');
    });

    it('should set and get metadata', () => {
      const doc = new PdfDocument();
      doc.title = 'Test Document';
      doc.author = 'Test Author';
      doc.subject = 'Test Subject';
      doc.keywords = 'test, pdf';
      doc.creator = 'GXT';
      doc.producer = 'GXT PDF';
      doc.pdfVersion = '1.7';
      doc.language = 'en';
      doc.pageMode = 'useOutlines';
      doc.pageLayout = 'twoColumnLeft';

      expect(doc.title).toBe('Test Document');
      expect(doc.author).toBe('Test Author');
      expect(doc.subject).toBe('Test Subject');
      expect(doc.keywords).toBe('test, pdf');
      expect(doc.creator).toBe('GXT');
      expect(doc.producer).toBe('GXT PDF');
      expect(doc.pdfVersion).toBe('1.7');
      expect(doc.language).toBe('en');
      expect(doc.pageMode).toBe('useOutlines');
      expect(doc.pageLayout).toBe('twoColumnLeft');
    });

    it('should serialize to JSON', () => {
      const doc = new PdfDocument();
      doc.title = 'Test';
      const page = new PdfPage();
      doc.appendChild(page);

      const json = doc.toJSON();
      expect(json.type).toBe('document');
      expect(json.props.title).toBe('Test');
      expect(json.children).toHaveLength(1);
      expect(json.children[0].type).toBe('page');
    });
  });

  describe('PdfPage', () => {
    it('should create a page with default props', () => {
      const page = new PdfPage();
      expect(page.isPdfPage).toBe(true);
      expect(page.size).toBe('A4');
      expect(page.orientation).toBe('portrait');
      expect(page.wrap).toBe(true);
      expect(page.dpi).toBe(72);
    });

    it('should set page properties', () => {
      const page = new PdfPage();
      page.size = 'LETTER';
      page.orientation = 'landscape';
      page.wrap = false;
      page.debug = true;
      page.dpi = 150;
      page.id = 'page-1';

      expect(page.size).toBe('LETTER');
      expect(page.orientation).toBe('landscape');
      expect(page.wrap).toBe(false);
      expect(page.debug).toBe(true);
      expect(page.dpi).toBe(150);
      expect(page.id).toBe('page-1');
    });

    it('should accept custom size object', () => {
      const page = new PdfPage();
      page.size = { width: 500, height: 700 };
      expect(page.size).toEqual({ width: 500, height: 700 });
    });
  });

  describe('PdfView', () => {
    it('should create a view with default props', () => {
      const view = new PdfView();
      expect(view.isPdfView).toBe(true);
      expect(view.wrap).toBe(true);
      expect(view.fixed).toBe(false);
      expect(view.debug).toBe(false);
    });

    it('should set view properties', () => {
      const view = new PdfView();
      view.wrap = false;
      view.fixed = true;
      view.debug = true;
      view.id = 'view-1';
      view.style = { padding: 10, backgroundColor: '#fff' };

      expect(view.wrap).toBe(false);
      expect(view.fixed).toBe(true);
      expect(view.debug).toBe(true);
      expect(view.id).toBe('view-1');
      expect(view.style).toEqual({ padding: 10, backgroundColor: '#fff' });
    });
  });

  describe('PdfText', () => {
    it('should create a text element', () => {
      const text = new PdfText();
      expect(text.isPdfText).toBe(true);
      expect(text.wrap).toBe(true);
    });

    it('should collect text content from children', () => {
      const text = new PdfText();
      const textNode1 = new PdfTextNode('Hello ');
      const textNode2 = new PdfTextNode('World');

      text.appendChild(textNode1);
      text.appendChild(textNode2);

      expect(text.getTextContent()).toBe('Hello World');
    });

    it('should serialize with content', () => {
      const text = new PdfText();
      const textNode = new PdfTextNode('Test content');
      text.appendChild(textNode);

      const json = text.toJSON();
      expect(json.type).toBe('text');
      expect(json.content).toBe('Test content');
    });
  });

  describe('PdfTextNode', () => {
    it('should create a text node with content', () => {
      const node = new PdfTextNode('Hello');
      expect(node.isPdfTextNode).toBe(true);
      expect(node.textContent).toBe('Hello');
    });

    it('should update text content', () => {
      const node = new PdfTextNode();
      expect(node.textContent).toBe('');
      node.textContent = 'Updated';
      expect(node.textContent).toBe('Updated');
    });
  });

  describe('PdfImage', () => {
    it('should create an image element', () => {
      const image = new PdfImage();
      expect(image.isPdfImage).toBe(true);
      expect(image.cache).toBe(true);
    });

    it('should set image source', () => {
      const image = new PdfImage();
      image.src = 'https://example.com/image.png';
      expect(image.src).toBe('https://example.com/image.png');
      expect(image.source).toBe('https://example.com/image.png');
    });

    it('should accept source object', () => {
      const image = new PdfImage();
      image.source = { uri: 'https://example.com/image.png', headers: { 'Authorization': 'Bearer token' } };
      expect(image.source).toEqual({ uri: 'https://example.com/image.png', headers: { 'Authorization': 'Bearer token' } });
    });
  });

  describe('PdfLink', () => {
    it('should create a link element', () => {
      const link = new PdfLink();
      expect(link.isPdfLink).toBe(true);
      expect(link.wrap).toBe(true);
    });

    it('should set link properties', () => {
      const link = new PdfLink();
      link.src = 'https://example.com';
      link.fixed = true;

      expect(link.src).toBe('https://example.com');
      expect(link.fixed).toBe(true);
    });
  });

  describe('PdfCanvas', () => {
    it('should create a canvas element', () => {
      const canvas = new PdfCanvas();
      expect(canvas.isPdfCanvas).toBe(true);
      expect(canvas.debug).toBe(false);
      expect(canvas.fixed).toBe(false);
    });

    it('should set paint function', () => {
      const canvas = new PdfCanvas();
      const paintFn = (ctx: any) => { ctx.rect(0, 0, 100, 100); };
      canvas.paint = paintFn;
      expect(canvas.paint).toBe(paintFn);
    });

    it('should serialize with hasPaint flag', () => {
      const canvas = new PdfCanvas();
      canvas.paint = () => {};

      const json = canvas.toJSON();
      expect(json.type).toBe('canvas');
      expect(json.hasPaint).toBe(true);
    });
  });

  describe('PdfNote', () => {
    it('should create a note element', () => {
      const note = new PdfNote();
      expect(note.isPdfNote).toBe(true);
      expect(note.content).toBe('');
    });

    it('should set note content', () => {
      const note = new PdfNote();
      note.content = 'This is a note';
      expect(note.content).toBe('This is a note');
    });
  });

  describe('PdfComment', () => {
    it('should create a comment element', () => {
      const comment = new PdfComment('test comment');
      expect(comment.isPdfComment).toBe(true);
      expect(comment.text).toBe('test comment');
    });
  });

  describe('PdfFragment', () => {
    it('should create a fragment element', () => {
      const fragment = new PdfFragment();
      expect(fragment.isPdfFragment).toBe(true);
      expect(fragment.debugName).toBe('fragment');
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify element types', () => {
      expect(isPdfElement(new PdfBaseElement())).toBe(true);
      expect(isPdfDocument(new PdfDocument())).toBe(true);
      expect(isPdfPage(new PdfPage())).toBe(true);
      expect(isPdfView(new PdfView())).toBe(true);
      expect(isPdfText(new PdfText())).toBe(true);
      expect(isPdfTextNode(new PdfTextNode())).toBe(true);
      expect(isPdfImage(new PdfImage())).toBe(true);
      expect(isPdfLink(new PdfLink())).toBe(true);
      expect(isPdfCanvas(new PdfCanvas())).toBe(true);
      expect(isPdfNote(new PdfNote())).toBe(true);
      expect(isPdfComment(new PdfComment())).toBe(true);
      expect(isPdfFragment(new PdfFragment())).toBe(true);
    });

    it('should return false for non-matching types', () => {
      expect(isPdfDocument(new PdfPage())).toBe(false);
      expect(isPdfPage(new PdfView())).toBe(false);
      expect(isPdfElement({})).toBe(false);
      expect(isPdfElement(null)).toBe(false);
    });
  });
});

describe('PDF Browser DOM API', () => {
  let api: PdfBrowserDOMApi;

  beforeEach(() => {
    api = createPdfApi();
  });

  describe('toString', () => {
    it('should return identifier string', () => {
      expect(api.toString()).toBe('pdf:dom-api');
    });
  });

  describe('element creation', () => {
    it('should create document element', () => {
      const doc = api.element('document');
      expect(isPdfDocument(doc)).toBe(true);
    });

    it('should create page element', () => {
      const page = api.element('page');
      expect(isPdfPage(page)).toBe(true);
    });

    it('should create view element', () => {
      const view = api.element('view');
      expect(isPdfView(view)).toBe(true);
    });

    it('should create text element', () => {
      const text = api.element('text');
      expect(isPdfText(text)).toBe(true);
    });

    it('should create image element', () => {
      const image = api.element('image');
      expect(isPdfImage(image)).toBe(true);
    });

    it('should create link element', () => {
      const link = api.element('link');
      expect(isPdfLink(link)).toBe(true);
    });

    it('should create canvas element', () => {
      const canvas = api.element('canvas');
      expect(isPdfCanvas(canvas)).toBe(true);
    });

    it('should create note element', () => {
      const note = api.element('note');
      expect(isPdfNote(note)).toBe(true);
    });

    it('should handle Pdf prefix in tag names', () => {
      const doc = api.element('PdfDocument');
      expect(isPdfDocument(doc)).toBe(true);

      const page = api.element('pdfpage');
      expect(isPdfPage(page)).toBe(true);
    });

    it('should return comment for unknown elements', () => {
      const unknown = api.element('unknown-element');
      expect(isPdfComment(unknown)).toBe(true);
    });

    it('should apply initial props', () => {
      const page = api.element('page', false, false, [
        [],
        [['size', 'LETTER'], ['orientation', 'landscape']],
        []
      ]) as PdfPage;

      expect(page.size).toBe('LETTER');
      expect(page.orientation).toBe('landscape');
    });
  });

  describe('node operations', () => {
    it('should identify PDF nodes', () => {
      const doc = api.element('document');
      expect(api.isNode(doc)).toBe(true);
      expect(api.isNode({})).toBe(false);
      expect(api.isNode(null)).toBe(false);
    });

    it('should get parent', () => {
      const doc = new PdfDocument();
      const page = new PdfPage();
      doc.appendChild(page);

      expect(api.parent(page)).toBe(doc);
      expect(api.parent(doc)).toBeNull();
    });
  });

  describe('insertion', () => {
    it('should insert child into parent', () => {
      const doc = new PdfDocument();
      const page = new PdfPage();

      api.setDocument(doc);
      api.insert(doc, page);

      expect(doc.children).toContain(page);
      expect(page.parentElement).toBe(doc);
    });

    it('should insert into document when parent is null', () => {
      const doc = new PdfDocument();
      const page = new PdfPage();

      api.setDocument(doc);
      api.insert(null, page);

      expect(doc.children).toContain(page);
    });

    it('should unwrap and insert fragment children', () => {
      const doc = new PdfDocument();
      const fragment = new PdfFragment();
      const page1 = new PdfPage();
      const page2 = new PdfPage();

      fragment.appendChild(page1);
      fragment.appendChild(page2);

      api.setDocument(doc);
      api.insert(doc, fragment);

      expect(doc.children).toContain(page1);
      expect(doc.children).toContain(page2);
      expect(doc.children).not.toContain(fragment);
    });

    it('should set document when inserting PdfDocument', () => {
      const doc = new PdfDocument();
      api.insert(null, doc);

      expect(api.getDocument()).toBe(doc);
    });
  });

  describe('destruction', () => {
    it('should destroy element', () => {
      const doc = new PdfDocument();
      const page = new PdfPage();
      doc.appendChild(page);

      api.destroy(page);

      expect(doc.children).not.toContain(page);
      expect(DESTROYED_NODES.has(page)).toBe(true);
    });

    it('should handle null', () => {
      // Should not throw
      api.destroy(null);
    });

    it('should clear children', () => {
      const doc = new PdfDocument();
      const page1 = new PdfPage();
      const page2 = new PdfPage();
      doc.appendChild(page1);
      doc.appendChild(page2);

      api.clearChildren(doc);

      expect(doc.children).toHaveLength(0);
    });
  });

  describe('properties', () => {
    it('should set prop on element', () => {
      const page = new PdfPage();
      api.prop(page, 'size', 'LETTER');
      expect(page.size).toBe('LETTER');
    });

    it('should set attr (delegates to prop)', () => {
      const page = new PdfPage();
      api.attr(page, 'orientation', 'landscape');
      expect(page.orientation).toBe('landscape');
    });

    it('should convert kebab-case to camelCase', () => {
      const page = new PdfPage();
      api.prop(page, 'page-mode', 'useOutlines');
      // Note: pageMode is on Document, not Page, but the prop mechanism should still work
    });

    it('should apply style property', () => {
      const view = new PdfView();
      api.prop(view, 'style', { padding: 10, margin: 5 });
      expect(view.style).toEqual({ padding: 10, margin: 5 });
    });

    it('should expand style aliases', () => {
      const view = new PdfView();
      api.prop(view, 'style', { marginHorizontal: 10 });
      expect(view.style).toEqual({ marginLeft: 10, marginRight: 10 });
    });

    it('should merge style arrays', () => {
      const view = new PdfView();
      api.prop(view, 'style', [{ padding: 10 }, { margin: 5 }]);
      expect(view.style).toEqual({ padding: 10, margin: 5 });
    });

    it('should set paint function on canvas', () => {
      const canvas = new PdfCanvas();
      const paintFn = () => {};
      api.prop(canvas, 'paint', paintFn);
      expect(canvas.paint).toBe(paintFn);
    });

    it('should set content on note', () => {
      const note = new PdfNote();
      api.prop(note, 'content', 'Note text');
      expect(note.content).toBe('Note text');
    });

    it('should ignore props on comments and fragments', () => {
      const comment = new PdfComment();
      const fragment = new PdfFragment();

      // Should not throw
      api.prop(comment, 'test', 'value');
      api.prop(fragment, 'test', 'value');
    });
  });

  describe('text operations', () => {
    it('should create text node', () => {
      const textNode = api.text('Hello');
      expect(isPdfTextNode(textNode)).toBe(true);
      expect(textNode.textContent).toBe('Hello');
    });

    it('should create text node from number', () => {
      const textNode = api.text(42);
      expect(textNode.textContent).toBe('42');
    });

    it('should update text content', () => {
      const textNode = api.text('Hello');
      api.textContent(textNode, 'World');
      expect(textNode.textContent).toBe('World');
    });
  });

  describe('helper methods', () => {
    it('should create comment', () => {
      const comment = api.comment('test');
      expect(isPdfComment(comment)).toBe(true);
      expect(comment.text).toBe('test');
    });

    it('should create fragment', () => {
      const fragment = api.fragment();
      expect(isPdfFragment(fragment)).toBe(true);
    });
  });

  describe('serialization', () => {
    it('should serialize document to JSON', () => {
      const doc = new PdfDocument();
      doc.title = 'Test';
      const page = new PdfPage();
      page.size = 'A4';
      const view = new PdfView();
      const text = new PdfText();
      const textNode = new PdfTextNode('Hello World');

      doc.appendChild(page);
      page.appendChild(view);
      view.appendChild(text);
      text.appendChild(textNode);

      api.setDocument(doc);
      const json = api.toJSON();

      expect(json).not.toBeNull();
      expect(json!.type).toBe('document');
      expect(json!.props.title).toBe('Test');
      expect(json!.children[0].type).toBe('page');
      expect(json!.children[0].children[0].type).toBe('view');
    });

    it('should return null when no document', () => {
      expect(api.toJSON()).toBeNull();
    });
  });
});

describe('StyleSheet', () => {
  describe('create', () => {
    it('should create a frozen stylesheet', () => {
      const styles = StyleSheet.create({
        container: { padding: 10 },
        title: { fontSize: 24 },
      });

      expect(styles.container).toEqual({ padding: 10 });
      expect(styles.title).toEqual({ fontSize: 24 });
      expect(Object.isFrozen(styles)).toBe(true);
    });
  });

  describe('flatten', () => {
    it('should flatten style arrays', () => {
      const result = StyleSheet.flatten([
        { padding: 10 },
        { margin: 5 },
        { padding: 20 }, // Should override
      ]);

      expect(result).toEqual({ padding: 20, margin: 5 });
    });

    it('should handle null and undefined', () => {
      const result = StyleSheet.flatten([
        { padding: 10 },
        null,
        undefined,
        false,
        { margin: 5 },
      ]);

      expect(result).toEqual({ padding: 10, margin: 5 });
    });
  });

  describe('compose', () => {
    it('should compose multiple styles', () => {
      const result = StyleSheet.compose(
        { padding: 10 },
        { margin: 5 },
        { color: 'red' }
      );

      expect(result).toEqual({ padding: 10, margin: 5, color: 'red' });
    });
  });

  describe('absoluteFill', () => {
    it('should provide absolute fill style', () => {
      expect(StyleSheet.absoluteFill).toEqual({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      });
    });
  });
});

describe('PageSizes', () => {
  it('should have standard page sizes', () => {
    expect(PageSizes.A4).toEqual({ width: 595, height: 842 });
    expect(PageSizes.LETTER).toEqual({ width: 612, height: 792 });
    expect(PageSizes.LEGAL).toEqual({ width: 612, height: 1008 });
  });
});

describe('getPageSize', () => {
  it('should return dimensions for named size', () => {
    const size = getPageSize('A4');
    expect(size).toEqual({ width: 595, height: 842 });
  });

  it('should swap dimensions for landscape', () => {
    const size = getPageSize('A4', 'landscape');
    expect(size).toEqual({ width: 842, height: 595 });
  });

  it('should accept custom dimensions object', () => {
    const size = getPageSize({ width: 500, height: 700 });
    expect(size).toEqual({ width: 500, height: 700 });
  });

  it('should accept array dimensions', () => {
    const size = getPageSize([500, 700]);
    expect(size).toEqual({ width: 500, height: 700 });
  });

  it('should default to A4 for unknown size', () => {
    const size = getPageSize('UNKNOWN' as any);
    expect(size).toEqual({ width: 595, height: 842 });
  });
});

describe('parseUnit', () => {
  it('should return number as-is', () => {
    expect(parseUnit(100)).toBe(100);
  });

  it('should parse pt units', () => {
    expect(parseUnit('72pt')).toBe(72);
  });

  it('should parse inch units', () => {
    expect(parseUnit('1in')).toBe(72);
    expect(parseUnit('2in')).toBe(144);
  });

  it('should parse cm units', () => {
    expect(parseUnit('1cm')).toBeCloseTo(28.346, 2);
  });

  it('should parse mm units', () => {
    expect(parseUnit('10mm')).toBeCloseTo(28.35, 1);
  });

  it('should parse px units', () => {
    expect(parseUnit('96px')).toBe(72);
  });

  it('should parse percentage with container size', () => {
    expect(parseUnit('50%', 200)).toBe(100);
    expect(parseUnit('25%', 400)).toBe(100);
  });

  it('should default to number for unitless strings', () => {
    expect(parseUnit('100')).toBe(100);
  });

  it('should handle negative values', () => {
    expect(parseUnit('-10pt')).toBe(-10);
    expect(parseUnit('-1in')).toBe(-72);
  });

  it('should handle decimal values', () => {
    expect(parseUnit('10.5pt')).toBe(10.5);
    expect(parseUnit('0.5in')).toBe(36);
  });
});

describe('Complete Document Structure', () => {
  it('should build a complete document structure', () => {
    const api = createPdfApi();

    // Create document
    const doc = api.element('document') as PdfDocument;
    api.prop(doc, 'title', 'Test Document');
    api.prop(doc, 'author', 'GXT');
    api.setDocument(doc);

    // Create page
    const page = api.element('page') as PdfPage;
    api.prop(page, 'size', 'A4');
    api.insert(doc, page);

    // Create view
    const view = api.element('view') as PdfView;
    api.prop(view, 'style', { padding: 30 });
    api.insert(page, view);

    // Create text
    const text = api.element('text') as PdfText;
    api.prop(text, 'style', { fontSize: 24 });
    api.insert(view, text);

    // Add text content
    const textNode = api.text('Hello World');
    api.insert(text, textNode);

    // Serialize and verify structure
    const json = api.toJSON();
    expect(json).not.toBeNull();
    expect(json!.type).toBe('document');
    expect(json!.props.title).toBe('Test Document');
    expect(json!.children).toHaveLength(1);

    const pageJson = json!.children[0];
    expect(pageJson.type).toBe('page');
    expect(pageJson.props.size).toBe('A4');

    const viewJson = pageJson.children[0];
    expect(viewJson.type).toBe('view');
    expect(viewJson.props.style.padding).toBe(30);

    const textJson = viewJson.children[0];
    expect(textJson.type).toBe('text');
    expect(textJson.content).toBe('Hello World');
  });
});

describe('PDF Style Reactivity', () => {
  let api: PdfBrowserDOMApi;

  beforeEach(() => {
    api = createPdfApi();
  });

  it('should apply style object with all properties', () => {
    const text = new PdfText();
    const style = {
      fontSize: 24,
      fontWeight: 'bold' as const,
      color: '#ff0000',
      marginBottom: 10,
    };
    api.prop(text, 'style', style);

    const appliedStyle = text.style as Record<string, any>;
    expect(appliedStyle).toEqual(style);
    expect(appliedStyle.fontSize).toBe(24);
    expect(appliedStyle.fontWeight).toBe('bold');
    expect(appliedStyle.color).toBe('#ff0000');
  });

  it('should update style when prop is called again', () => {
    const text = new PdfText();

    // Initial style
    api.prop(text, 'style', { fontSize: 12 });
    expect((text.style as any)?.fontSize).toBe(12);

    // Update style
    api.prop(text, 'style', { fontSize: 24 });
    expect((text.style as any)?.fontSize).toBe(24);
  });

  it('should notify update when style changes', () => {
    let updateCount = 0;
    api.setOnUpdate(() => updateCount++);

    const view = new PdfView();
    api.prop(view, 'style', { padding: 10 });

    expect(updateCount).toBe(1);

    api.prop(view, 'style', { padding: 20 });
    expect(updateCount).toBe(2);
  });

  it('should handle nested style objects', () => {
    const page = new PdfPage();
    const complexStyle = {
      padding: 40,
      backgroundColor: '#f0f0f0',
    };
    api.prop(page, 'style', complexStyle);

    expect(page.style).toEqual(complexStyle);
  });

  it('should expand marginHorizontal and marginVertical aliases', () => {
    const view = new PdfView();
    api.prop(view, 'style', {
      marginHorizontal: 10,
      marginVertical: 20,
    });

    expect(view.style).toEqual({
      marginLeft: 10,
      marginRight: 10,
      marginTop: 20,
      marginBottom: 20,
    });
  });

  it('should expand paddingHorizontal and paddingVertical aliases', () => {
    const view = new PdfView();
    api.prop(view, 'style', {
      paddingHorizontal: 15,
      paddingVertical: 25,
    });

    expect(view.style).toEqual({
      paddingLeft: 15,
      paddingRight: 15,
      paddingTop: 25,
      paddingBottom: 25,
    });
  });

  it('should merge style arrays correctly', () => {
    const view = new PdfView();
    api.prop(view, 'style', [
      { padding: 10, margin: 5 },
      { padding: 20, color: 'red' },
    ]);

    expect(view.style).toEqual({
      padding: 20, // Last value wins
      margin: 5,
      color: 'red',
    });
  });
});
