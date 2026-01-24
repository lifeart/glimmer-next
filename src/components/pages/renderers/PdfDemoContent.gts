import { cell, type Cell } from '@lifeart/gxt';
import {
  PdfViewer,
  createPdfApi,
  createPdfContextState,
  PdfDocument,
  PdfPage,
  PdfView,
  PdfText,
  PdfTextNode,
  PdfLink,
  PdfImage,
} from '@/core/renderers/pdf';

function updateCell<T extends string | number>(
  el: Cell<T>,
  e: InputEvent & { target: HTMLInputElement },
) {
  if (e.target.type === 'number' || e.target.type === 'range') {
    el.update(e.target.valueAsNumber as T);
  } else {
    el.update(e.target.value as T);
  }
}

function updateSelect(
  el: Cell<string>,
  e: Event & { target: HTMLSelectElement },
) {
  el.update(e.target.value);
}

function ColorInput({
  label: labelText,
  value,
  onUpdate,
}: {
  label: string;
  value: Cell<string>;
  onUpdate: <T extends string | number>(cell: Cell<T>, e: InputEvent & { target: HTMLInputElement }) => void;
}) {
  return <template>
    <div class='space-y-1'>
      <label class='text-xs text-slate-400 uppercase tracking-wide'>{{labelText}}</label>
      <div class='flex items-center gap-2'>
        <input
          type='color'
          value={{value.value}}
          {{on 'input' (fn onUpdate value)}}
          class='w-8 h-8 rounded cursor-pointer border-0 p-0'
        />
        <input
          type='text'
          value={{value.value}}
          {{on 'input' (fn onUpdate value)}}
          class='flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs font-mono'
        />
      </div>
    </div>
  </template>;
}

function RangeInput({
  label: labelText,
  value,
  min,
  max,
  onUpdate,
}: {
  label: string;
  value: Cell<number>;
  min: number;
  max: number;
  onUpdate: <T extends string | number>(cell: Cell<T>, e: InputEvent & { target: HTMLInputElement }) => void;
}) {
  return <template>
    <div class='space-y-1'>
      <label class='text-xs text-slate-400 uppercase tracking-wide'>{{labelText}}: {{value.value}}</label>
      <input
        type='range'
        value={{value.value}}
        min={{min}}
        max={{max}}
        {{on 'input' (fn onUpdate value)}}
        class='w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500'
      />
    </div>
  </template>;
}

// PDF Document Preview using actual PdfViewer with template-based elements
function PdfLivePreview({
  title,
  author,
  heading,
  paragraph,
  headingSize,
  textSize,
  headingColor,
  textColor,
  pageSize,
  showImage,
  showTable,
  tableData,
  linkUrl,
  linkText,
}: {
  title: Cell<string>;
  author: Cell<string>;
  heading: Cell<string>;
  paragraph: Cell<string>;
  headingSize: Cell<number>;
  textSize: Cell<number>;
  headingColor: Cell<string>;
  textColor: Cell<string>;
  pageSize: Cell<string>;
  showImage: Cell<boolean>;
  showTable: Cell<boolean>;
  tableData: { feature: string; supported: string }[];
  linkUrl: Cell<string>;
  linkText: Cell<string>;
}) {
  // Reactive style objects for PDF elements - compiler wraps functions in formulas
  const pageStyle = () => ({ padding: 40 });

  const containerStyle = () => ({ flexDirection: 'column' as const });

  const headingStyle = () => ({
    fontSize: headingSize.value,
    fontWeight: 'bold' as const,
    color: headingColor.value,
    marginBottom: 20,
  });

  const paragraphStyle = () => ({
    fontSize: textSize.value,
    color: textColor.value,
    lineHeight: 1.6,
    marginBottom: 20,
  });

  const imageStyle = () => ({
    width: 60,
    height: 60,
    marginBottom: 20,
  });

  const tableHeaderRowStyle = () => ({
    flexDirection: 'row' as const,
    marginBottom: 5,
    backgroundColor: '#f3f4f6',
    padding: 5,
  });

  const tableHeaderCellStyle = () => ({
    fontSize: textSize.value,
    fontWeight: 'bold' as const,
    color: '#374151',
    width: 100,
  });

  const tableRowStyle = () => ({
    flexDirection: 'row' as const,
    marginBottom: 3,
    padding: 3,
  });

  const tableCellStyle = () => ({
    fontSize: textSize.value,
    color: '#4b5563',
    width: 100,
  });

  const linkContainerStyle = () => ({
    color: '#3b82f6',
    marginBottom: 20,
  });

  const linkTextStyle = () => ({
    fontSize: textSize.value,
    color: '#3b82f6',
  });

  // Use PdfViewer with template-based PDF elements for live preview
  return <template>
    <div
      class='bg-white rounded shadow-lg overflow-hidden'
      style='aspect-ratio: 1/1.414; max-height: 400px;'
      data-test-pdf-preview
    >
      <PdfViewer @width="100%" @height="100%">
        <pdfDocument title={{title.value}} author={{author.value}}>
          <pdfPage size={{pageSize.value}} style={{pageStyle}}>
            <pdfView style={{containerStyle}}>
              {{! Heading }}
              <pdfText style={{headingStyle}}>{{heading.value}}</pdfText>

              {{! Paragraph }}
              <pdfText style={{paragraphStyle}}>{{paragraph.value}}</pdfText>

              {{! Image (if enabled) }}
              {{#if showImage.value}}
                <pdfImage src="/logo.png" style={{imageStyle}} />
              {{/if}}

              {{! Table (if enabled) }}
              {{#if showTable.value}}
                {{! Table header }}
                <pdfView style={{tableHeaderRowStyle}}>
                  <pdfText style={{tableHeaderCellStyle}}>Feature</pdfText>
                  <pdfText style={{tableHeaderCellStyle}}>Status</pdfText>
                </pdfView>
                {{! Table rows }}
                {{#each tableData as |row|}}
                  <pdfView style={{tableRowStyle}}>
                    <pdfText style={{tableCellStyle}}>{{row.feature}}</pdfText>
                    <pdfText style={{tableCellStyle}}>{{row.supported}}</pdfText>
                  </pdfView>
                {{/each}}
              {{/if}}

              {{! Link (if URL provided) }}
              {{#if linkUrl.value}}
                <pdfLink src={{linkUrl.value}} style={{linkContainerStyle}}>
                  <pdfText style={{linkTextStyle}}>{{linkText.value}}</pdfText>
                </pdfLink>
              {{/if}}
            </pdfView>
          </pdfPage>
        </pdfDocument>
      </PdfViewer>
    </div>
  </template>;
}

// JSON Structure Preview
function JsonPreview({
  title,
  author,
  heading,
  paragraph,
  headingSize,
  textSize,
  headingColor,
  textColor,
  pageSize,
}: {
  title: Cell<string>;
  author: Cell<string>;
  heading: Cell<string>;
  paragraph: Cell<string>;
  headingSize: Cell<number>;
  textSize: Cell<number>;
  headingColor: Cell<string>;
  textColor: Cell<string>;
  pageSize: Cell<string>;
}) {
  // Build document structure reactively - compiler wraps functions in formulas
  const jsonOutput = () => {
    const api = createPdfApi();

    const doc = new PdfDocument();
    doc.title = title.value;
    doc.author = author.value;

    const page = new PdfPage();
    page.size = pageSize.value as any;
    page.style = { padding: 40 };

    const view = new PdfView();
    view.style = { flexDirection: 'column' };

    const headingText = new PdfText();
    headingText.style = {
      fontSize: headingSize.value,
      fontWeight: 'bold',
      color: headingColor.value,
      marginBottom: 20,
    };
    const headingNode = new PdfTextNode(heading.value);
    headingText.appendChild(headingNode);

    const paraText = new PdfText();
    paraText.style = {
      fontSize: textSize.value,
      color: textColor.value,
      lineHeight: 1.6,
    };
    const paraNode = new PdfTextNode(paragraph.value);
    paraText.appendChild(paraNode);

    view.appendChild(headingText);
    view.appendChild(paraText);
    page.appendChild(view);
    doc.appendChild(page);

    api.setDocument(doc);
    return JSON.stringify(api.toJSON(), null, 2);
  };

  return <template>
    <div class='bg-slate-900 rounded-lg p-3 overflow-auto max-h-64' data-test-pdf-json>
      <pre class='text-xs text-green-400 font-mono whitespace-pre-wrap'>{{jsonOutput}}</pre>
    </div>
  </template>;
}

export function PdfDemoContent() {
  // Document metadata
  const docTitle = cell('My PDF Document');
  const docAuthor = cell('GXT Framework');

  // Content
  const heading = cell('Welcome to PDF Rendering');
  const paragraph = cell('This demonstrates the PDF renderer for GXT. You can create PDF documents with reactive content, styled text, images, and links.');

  // Typography
  const headingSize = cell(24);
  const textSize = cell(12);
  const headingColor = cell('#1e293b');
  const textColor = cell('#475569');

  // Page settings
  const pageSize = cell('A4');
  const pageSizes = [
    { value: 'A4', label: 'A4 (210 x 297 mm)' },
    { value: 'LETTER', label: 'Letter (8.5 x 11 in)' },
    { value: 'LEGAL', label: 'Legal (8.5 x 14 in)' },
    { value: 'A3', label: 'A3 (297 x 420 mm)' },
    { value: 'A5', label: 'A5 (148 x 210 mm)' },
  ];

  // Optional elements
  const showImage = cell(true);
  const showTable = cell(true);
  const tableData = [
    { feature: 'Document', supported: 'Yes' },
    { feature: 'Pages', supported: 'Yes' },
    { feature: 'Text', supported: 'Yes' },
    { feature: 'Images', supported: 'Yes' },
    { feature: 'Links', supported: 'Yes' },
  ];
  const linkUrl = cell('https://github.com/nicolo-ribaudo/glimmer-next');
  const linkText = cell('View on GitHub');

  // Tab state
  const activeTab = cell<'preview' | 'structure'>('preview');

  // Computed values for button classes - compiler wraps functions in formulas
  const previewButtonClass = () =>
    activeTab.value === 'preview'
      ? 'px-3 py-1 text-xs rounded-l-lg transition-colors bg-blue-600 text-white'
      : 'px-3 py-1 text-xs rounded-l-lg transition-colors bg-slate-700 text-slate-300 hover:bg-slate-600';

  const structureButtonClass = () =>
    activeTab.value === 'structure'
      ? 'px-3 py-1 text-xs rounded-r-lg transition-colors bg-blue-600 text-white'
      : 'px-3 py-1 text-xs rounded-r-lg transition-colors bg-slate-700 text-slate-300 hover:bg-slate-600';

  const isPreviewTab = () => activeTab.value === 'preview';

  // Handlers
  const toggleShowImage = () => {
    showImage.update(!showImage.value);
  };

  const toggleShowTable = () => {
    showTable.update(!showTable.value);
  };

  const selectPreview = () => {
    activeTab.update('preview');
  };

  const selectStructure = () => {
    activeTab.update('structure');
  };

  // Build PDF document from current reactive state
  const buildPdfDocument = () => {
    const doc = new PdfDocument();
    doc.title = docTitle.value;
    doc.author = docAuthor.value;

    const page = new PdfPage();
    page.size = pageSize.value as any;
    page.style = { padding: 40 };

    const view = new PdfView();
    view.style = { flexDirection: 'column' };

    // Heading
    const headingText = new PdfText();
    headingText.style = {
      fontSize: headingSize.value,
      fontWeight: 'bold',
      color: headingColor.value,
      marginBottom: 20,
    };
    headingText.appendChild(new PdfTextNode(heading.value));
    view.appendChild(headingText);

    // Paragraph
    const paraText = new PdfText();
    paraText.style = {
      fontSize: textSize.value,
      color: textColor.value,
      lineHeight: 1.6,
      marginBottom: 20,
    };
    paraText.appendChild(new PdfTextNode(paragraph.value));
    view.appendChild(paraText);

    // Image (if enabled)
    if (showImage.value) {
      const image = new PdfImage();
      image.src = '/logo.png';
      image.style = { width: 60, height: 60, marginBottom: 20 };
      view.appendChild(image);
    }

    // Table (if enabled) - rendered as text rows since PDF doesn't have native tables
    if (showTable.value) {
      // Table header
      const headerRow = new PdfView();
      headerRow.style = { flexDirection: 'row', marginBottom: 5, backgroundColor: '#f3f4f6', padding: 5 };

      const headerFeature = new PdfText();
      headerFeature.style = { fontSize: textSize.value, fontWeight: 'bold', color: '#374151', width: 100 };
      headerFeature.appendChild(new PdfTextNode('Feature'));
      headerRow.appendChild(headerFeature);

      const headerStatus = new PdfText();
      headerStatus.style = { fontSize: textSize.value, fontWeight: 'bold', color: '#374151', width: 100 };
      headerStatus.appendChild(new PdfTextNode('Status'));
      headerRow.appendChild(headerStatus);

      view.appendChild(headerRow);

      // Table data rows
      for (const row of tableData) {
        const dataRow = new PdfView();
        dataRow.style = { flexDirection: 'row', marginBottom: 3, padding: 3 };

        const featureCell = new PdfText();
        featureCell.style = { fontSize: textSize.value, color: '#4b5563', width: 100 };
        featureCell.appendChild(new PdfTextNode(row.feature));
        dataRow.appendChild(featureCell);

        const statusCell = new PdfText();
        statusCell.style = { fontSize: textSize.value, color: '#4b5563', width: 100 };
        statusCell.appendChild(new PdfTextNode(row.supported));
        dataRow.appendChild(statusCell);

        view.appendChild(dataRow);
      }

      // Add spacing after table
      const tableSpacer = new PdfView();
      tableSpacer.style = { marginBottom: 20 };
      view.appendChild(tableSpacer);
    }

    // Link (if URL provided)
    if (linkUrl.value) {
      const link = new PdfLink();
      link.src = linkUrl.value;
      link.style = { color: '#3b82f6', marginBottom: 20 };
      const linkTextEl = new PdfText();
      linkTextEl.style = { fontSize: textSize.value, color: '#3b82f6' };
      linkTextEl.appendChild(new PdfTextNode(linkText.value));
      link.appendChild(linkTextEl);
      view.appendChild(link);
    }

    page.appendChild(view);
    doc.appendChild(page);

    return doc;
  };

  // Download handler - uses the PDF renderer's built-in generation
  const isDownloading = cell(false);

  const downloadPdf = async () => {
    if (isDownloading.value) return;
    isDownloading.update(true);

    try {
      // Build the document using our declarative structure
      const doc = buildPdfDocument();

      // Use the PDF API and context - let the renderer handle PDF generation
      const api = createPdfApi();
      api.setDocument(doc);

      // Create PDF context which has the render/download methods
      const pdfContext = createPdfContextState(api);

      // Use the context's download method - it handles jsPDF internally
      const filename = `${(doc.title || 'document').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
      await pdfContext.download(filename);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
    } finally {
      isDownloading.update(false);
    }
  };

  return <template>
    <div class='grid grid-cols-1 lg:grid-cols-2 gap-6'>
      {{! Preview Area }}
      <div class='order-1 lg:order-2'>
        <div class='flex items-center gap-2 mb-3'>
          <h3 class='text-sm font-medium text-slate-400'>Output</h3>
          <div class='flex-1'></div>
          <button
            type='button'
            class={{previewButtonClass}}
            {{on 'click' selectPreview}}
          >
            Preview
          </button>
          <button
            type='button'
            class={{structureButtonClass}}
            {{on 'click' selectStructure}}
          >
            Structure
          </button>
          <button
            type='button'
            class='ml-2 px-3 py-1 text-xs rounded-lg transition-colors bg-green-600 hover:bg-green-500 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed'
            {{on 'click' downloadPdf}}
            disabled={{isDownloading.value}}
            data-test-pdf-download
          >
            {{#if isDownloading.value}}
              <span class='animate-spin'>⏳</span>
              Generating...
            {{else}}
              ⬇️ Download PDF
            {{/if}}
          </button>
        </div>

        {{#if (isPreviewTab)}}
          <PdfLivePreview
            @title={{docTitle}}
            @author={{docAuthor}}
            @heading={{heading}}
            @paragraph={{paragraph}}
            @headingSize={{headingSize}}
            @textSize={{textSize}}
            @headingColor={{headingColor}}
            @textColor={{textColor}}
            @pageSize={{pageSize}}
            @showImage={{showImage}}
            @showTable={{showTable}}
            @tableData={{tableData}}
            @linkUrl={{linkUrl}}
            @linkText={{linkText}}
          />
        {{else}}
          <JsonPreview
            @title={{docTitle}}
            @author={{docAuthor}}
            @heading={{heading}}
            @paragraph={{paragraph}}
            @headingSize={{headingSize}}
            @textSize={{textSize}}
            @headingColor={{headingColor}}
            @textColor={{textColor}}
            @pageSize={{pageSize}}
          />
        {{/if}}

        <p class='mt-2 text-xs text-slate-500'>
          {{#if (isPreviewTab)}}
            Visual representation of the PDF document structure.
          {{else}}
            JSON structure that would be used for PDF generation.
          {{/if}}
        </p>
      </div>

      {{! Controls }}
      <div class='space-y-4 order-2 lg:order-1'>
        {{! Document Metadata }}
        <div class='bg-slate-700/50 rounded-lg p-3'>
          <h4 class='text-sm font-medium text-pink-400 mb-2 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-pink-400'></span>
            Document Metadata
          </h4>
          <div class='space-y-2'>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Title</label>
              <input
                type='text'
                value={{docTitle.value}}
                {{on 'input' (fn updateCell docTitle)}}
                class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm'
                data-test-pdf-title-input
              />
            </div>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Author</label>
              <input
                type='text'
                value={{docAuthor.value}}
                {{on 'input' (fn updateCell docAuthor)}}
                class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm'
                data-test-pdf-author-input
              />
            </div>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Page Size</label>
              <select
                {{on 'change' (fn updateSelect pageSize)}}
                class='w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm'
              >
                {{#each pageSizes as |opt|}}
                  <option value={{opt.value}} selected={{eq opt.value pageSize.value}}>{{opt.label}}</option>
                {{/each}}
              </select>
            </div>
          </div>
        </div>

        {{! Content }}
        <div class='bg-slate-700/50 rounded-lg p-3'>
          <h4 class='text-sm font-medium text-blue-400 mb-2 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-blue-400'></span>
            Content
          </h4>
          <div class='space-y-2'>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Heading</label>
              <input
                type='text'
                value={{heading.value}}
                {{on 'input' (fn updateCell heading)}}
                class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm'
                data-test-pdf-heading-input
              />
            </div>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Paragraph</label>
              <textarea
                {{on 'input' (fn updateCell paragraph)}}
                rows='3'
                class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm resize-none'
                data-test-pdf-paragraph-input
              >{{paragraph.value}}</textarea>
            </div>
          </div>
        </div>

        {{! Typography }}
        <div class='bg-slate-700/50 rounded-lg p-3'>
          <h4 class='text-sm font-medium text-purple-400 mb-2 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-purple-400'></span>
            Typography
          </h4>
          <div class='grid grid-cols-2 gap-2'>
            <RangeInput @label='Heading Size' @value={{headingSize}} @min={{16}} @max={{48}} @onUpdate={{updateCell}} />
            <RangeInput @label='Text Size' @value={{textSize}} @min={{8}} @max={{24}} @onUpdate={{updateCell}} />
            <ColorInput @label='Heading Color' @value={{headingColor}} @onUpdate={{updateCell}} />
            <ColorInput @label='Text Color' @value={{textColor}} @onUpdate={{updateCell}} />
          </div>
        </div>

        {{! Optional Elements }}
        <div class='bg-slate-700/50 rounded-lg p-3'>
          <h4 class='text-sm font-medium text-green-400 mb-2 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-green-400'></span>
            Optional Elements
          </h4>
          <div class='space-y-2'>
            <label class='flex items-center gap-2 cursor-pointer'>
              <input
                type='checkbox'
                checked={{showImage.value}}
                {{on 'change' toggleShowImage}}
                class='w-4 h-4 rounded border-slate-500 bg-slate-600 text-blue-500'
              />
              <span class='text-sm text-slate-300'>Include Logo Image</span>
            </label>
            <label class='flex items-center gap-2 cursor-pointer'>
              <input
                type='checkbox'
                checked={{showTable.value}}
                {{on 'change' toggleShowTable}}
                class='w-4 h-4 rounded border-slate-500 bg-slate-600 text-blue-500'
              />
              <span class='text-sm text-slate-300'>Include Feature Table</span>
            </label>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Link URL</label>
              <input
                type='text'
                value={{linkUrl.value}}
                {{on 'input' (fn updateCell linkUrl)}}
                class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm'
              />
            </div>
            <div class='space-y-1'>
              <label class='text-xs text-slate-400'>Link Text</label>
              <input
                type='text'
                value={{linkText.value}}
                {{on 'input' (fn updateCell linkText)}}
                class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm'
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>;
}
