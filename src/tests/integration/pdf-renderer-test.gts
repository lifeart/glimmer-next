import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@/utils/reactive';
import {
  PdfDocument,
  PdfPage,
  PdfView,
  PdfText,
  PdfTextNode,
  PdfImage,
  PdfLink,
  StyleSheet,
  PageSizes,
  createPdfApi,
} from '@/utils/renderers/pdf';

module('Integration | PDF Renderer', function () {
  test('PdfDocument can be created with reactive title', async function (assert) {
    const title = cell('Initial Title');
    const doc = new PdfDocument();

    // Render a component that updates doc title reactively
    await render(
      <template>
        <div data-test-title>{{title.value}}</div>
      </template>,
    );

    doc.title = title.value;
    assert.strictEqual(doc.title, 'Initial Title', 'document has initial title');

    title.update('Updated Title');
    await rerender();
    doc.title = title.value;

    assert.strictEqual(doc.title, 'Updated Title', 'document title updates');
    assert.dom('[data-test-title]').hasText('Updated Title');
  });

  test('PdfPage accepts different page sizes', async function (assert) {
    const pageSize = cell<'A4' | 'LETTER'>('A4');

    await render(
      <template>
        <div data-test-size>{{pageSize.value}}</div>
      </template>,
    );

    const page = new PdfPage();
    page.size = pageSize.value;

    assert.strictEqual(page.size, 'A4', 'page has A4 size');
    assert.dom('[data-test-size]').hasText('A4');

    pageSize.update('LETTER');
    await rerender();
    page.size = pageSize.value;

    assert.strictEqual(page.size, 'LETTER', 'page size updates to LETTER');
    assert.dom('[data-test-size]').hasText('LETTER');
  });

  test('PdfText supports reactive content', async function (assert) {
    const content = cell('Hello World');

    await render(
      <template>
        <span data-test-content>{{content.value}}</span>
      </template>,
    );

    const text = new PdfText();
    const textNode = new PdfTextNode(content.value);
    text.appendChild(textNode);

    assert.strictEqual(textNode.textContent, 'Hello World', 'text node has initial content');
    assert.dom('[data-test-content]').hasText('Hello World');

    content.update('Updated Text');
    await rerender();

    // Create new text node with updated content
    const updatedNode = new PdfTextNode(content.value);
    assert.strictEqual(updatedNode.textContent, 'Updated Text', 'new text node has updated content');
    assert.dom('[data-test-content]').hasText('Updated Text');
  });

  test('StyleSheet.create produces valid styles', async function (assert) {
    const styles = StyleSheet.create({
      container: {
        padding: 20,
        flexDirection: 'column',
      },
      title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1e293b',
      },
    });

    assert.strictEqual(styles.container.padding, 20, 'container has padding');
    assert.strictEqual(styles.container.flexDirection, 'column', 'container has flexDirection');
    assert.strictEqual(styles.title.fontSize, 24, 'title has fontSize');
    assert.strictEqual(styles.title.fontWeight, 'bold', 'title has fontWeight');
    assert.strictEqual(styles.title.color, '#1e293b', 'title has color');
  });

  test('PageSizes contains standard sizes', async function (assert) {
    assert.ok(PageSizes.A4, 'A4 size exists');
    assert.strictEqual(PageSizes.A4.width, 595, 'A4 has correct width');
    assert.strictEqual(PageSizes.A4.height, 842, 'A4 has correct height');

    assert.ok(PageSizes.LETTER, 'LETTER size exists');
    assert.strictEqual(PageSizes.LETTER.width, 612, 'LETTER has correct width');
    assert.strictEqual(PageSizes.LETTER.height, 792, 'LETTER has correct height');
  });

  test('createPdfApi creates functional API', async function (assert) {
    const api = createPdfApi();

    assert.ok(api, 'API is created');
    assert.strictEqual(api.getDocument(), null, 'initially no document');

    const doc = new PdfDocument();
    doc.title = 'Test Doc';
    api.setDocument(doc);

    assert.strictEqual(api.getDocument(), doc, 'document is set');
    assert.strictEqual(api.getDocument()?.title, 'Test Doc', 'document has correct title');
  });

  test('PDF document hierarchy renders to JSON', async function (assert) {
    const api = createPdfApi();

    const doc = new PdfDocument();
    doc.title = 'Test Document';
    doc.author = 'Test Author';

    const page = new PdfPage();
    page.size = 'A4';
    page.style = { padding: 40 };

    const view = new PdfView();
    view.style = { flexDirection: 'column' };

    const text = new PdfText();
    text.style = { fontSize: 24, fontWeight: 'bold' };
    const textNode = new PdfTextNode('Hello PDF');
    text.appendChild(textNode);

    view.appendChild(text);
    page.appendChild(view);
    doc.appendChild(page);

    api.setDocument(doc);
    const json = api.toJSON();

    assert.ok(json, 'toJSON returns a value');
    assert.strictEqual(json!.type, 'document', 'root is document');
    assert.strictEqual(json!.props.title, 'Test Document', 'document has title');
    assert.strictEqual(json!.props.author, 'Test Author', 'document has author');
    assert.ok(json!.children, 'document has children');
    assert.strictEqual(json!.children![0].type, 'page', 'first child is page');
    assert.strictEqual(json!.children![0].props.size, 'A4', 'page has size');
  });

  test('PdfImage accepts src and dimensions', async function (assert) {
    const image = new PdfImage();
    image.src = '/logo.png';
    image.style = { width: 100, height: 100 };

    assert.strictEqual(image.src, '/logo.png', 'image has src');
    assert.strictEqual(image.style?.width, 100, 'image has width');
    assert.strictEqual(image.style?.height, 100, 'image has height');
  });

  test('PdfLink accepts href and renders children', async function (assert) {
    const link = new PdfLink();
    link.src = 'https://example.com';
    link.style = { color: '#3b82f6' };

    const linkText = new PdfText();
    const textNode = new PdfTextNode('Click here');
    linkText.appendChild(textNode);
    link.appendChild(linkText);

    assert.strictEqual(link.src, 'https://example.com', 'link has href');
    assert.strictEqual(link.children.length, 1, 'link has one child');
  });

  test('StyleSheet.compose merges styles', async function (assert) {
    const base = { padding: 10, margin: 5 };
    const override = { padding: 20, color: 'red' };

    const composed = StyleSheet.compose(base, override);

    assert.strictEqual(composed.padding, 20, 'padding is overridden');
    assert.strictEqual(composed.margin, 5, 'margin is preserved');
    assert.strictEqual(composed.color, 'red', 'color is added');
  });

  test('StyleSheet.flatten handles arrays', async function (assert) {
    const styles = [
      { padding: 10 },
      { margin: 5 },
      { padding: 20, color: 'blue' },
    ];

    const flattened = StyleSheet.flatten(styles);

    assert.strictEqual(flattened.padding, 20, 'last padding wins');
    assert.strictEqual(flattened.margin, 5, 'margin is preserved');
    assert.strictEqual(flattened.color, 'blue', 'color is added');
  });

  test('reactive styles update document', async function (assert) {
    const fontSize = cell(12);
    const color = cell('#333');

    await render(
      <template>
        <div data-test-style style="font-size: {{fontSize.value}}px; color: {{color.value}}">
          Styled text
        </div>
      </template>,
    );

    assert.dom('[data-test-style]').hasStyle({
      'font-size': '12px',
      color: 'rgb(51, 51, 51)',
    });

    fontSize.update(24);
    color.update('#ff0000');
    await rerender();

    assert.dom('[data-test-style]').hasStyle({
      'font-size': '24px',
      color: 'rgb(255, 0, 0)',
    });
  });

  test('PdfText style is applied via API', async function (assert) {
    const api = createPdfApi();
    const text = new PdfText();

    // Apply style via API (simulating template attribute binding)
    api.prop(text, 'style', { fontSize: 24, fontWeight: 'bold', color: '#1e293b' });
    const appliedStyle = text.style as Record<string, any>;

    assert.ok(appliedStyle, 'style should be set');
    assert.strictEqual(appliedStyle.fontSize, 24, 'fontSize should be 24');
    assert.strictEqual(appliedStyle.fontWeight, 'bold', 'fontWeight should be bold');
    assert.strictEqual(appliedStyle.color, '#1e293b', 'color should be set');
  });

  test('PdfView style is applied via API', async function (assert) {
    const api = createPdfApi();
    const view = new PdfView();

    api.prop(view, 'style', {
      padding: 20,
      flexDirection: 'column',
      backgroundColor: '#f0f0f0',
    });
    const appliedStyle = view.style as Record<string, any>;

    assert.ok(appliedStyle, 'style should be set');
    assert.strictEqual(appliedStyle.padding, 20, 'padding should be 20');
    assert.strictEqual(appliedStyle.flexDirection, 'column', 'flexDirection should be column');
  });

  test('PdfPage style is applied via API', async function (assert) {
    const api = createPdfApi();
    const page = new PdfPage();

    api.prop(page, 'style', { padding: 40 });
    api.prop(page, 'size', 'A4');
    const appliedStyle = page.style as Record<string, any>;

    assert.strictEqual(appliedStyle.padding, 40, 'page padding should be 40');
    assert.strictEqual(page.size, 'A4', 'page size should be A4');
  });

  test('style updates notify API', async function (assert) {
    const api = createPdfApi();
    const view = new PdfView();
    let updateCount = 0;

    api.setOnUpdate(() => updateCount++);

    api.prop(view, 'style', { padding: 10 });
    assert.strictEqual(updateCount, 1, 'first style update triggers notification');

    api.prop(view, 'style', { padding: 20 });
    assert.strictEqual(updateCount, 2, 'second style update triggers notification');
  });
});
