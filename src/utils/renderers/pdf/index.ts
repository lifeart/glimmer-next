/**
 * PDF Renderer for GXT
 *
 * A PDF document generation renderer inspired by react-pdf.
 * Allows building PDF documents using a declarative component-based API.
 *
 * @example
 * ```gts
 * import { PdfViewer, PdfDocument, PdfPage, PdfView, PdfText, StyleSheet } from '@gxt/pdf';
 *
 * const styles = StyleSheet.create({
 *   page: { padding: 30 },
 *   title: { fontSize: 24, marginBottom: 10 },
 *   text: { fontSize: 12, color: '#333' },
 * });
 *
 * <template>
 *   <PdfViewer>
 *     <PdfDocument title="My Document" author="GXT">
 *       <PdfPage size="A4" style={{styles.page}}>
 *         <PdfView>
 *           <PdfText style={{styles.title}}>Hello World</PdfText>
 *           <PdfText style={{styles.text}}>This is a PDF document.</PdfText>
 *         </PdfView>
 *       </PdfPage>
 *     </PdfDocument>
 *   </PdfViewer>
 * </template>
 * ```
 */

// Types
export type {
  PageSize,
  PageOrientation,
  PageMode,
  PageLayout,
  PdfStyle,
  DocumentProps,
  PageProps,
  ViewProps,
  TextProps,
  ImageProps,
  LinkProps,
  CanvasProps,
  NoteProps,
  ImageSource,
  PdfPaintContext,
  PdfElementType,
  PdfElementNode,
  PdfRenderOptions,
  PdfContext as PdfContextType,
  FontData,
  ImageData,
} from './types';

// Element classes
export {
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

// DOM API
export {
  PdfBrowserDOMApi,
  createPdfApi,
} from './pdf-api';

// Components
export {
  PdfViewer,
  PdfDownloadLink,
  BlobProvider,
  PDF_CONTEXT,
  createPdfContextState,
  type PdfViewerProps,
  type PdfDownloadLinkProps,
  type BlobProviderProps,
  type PdfContext,
} from './PdfViewer';

// StyleSheet
export {
  StyleSheet,
  PageSizes,
  getPageSize,
  parseUnit,
  type StyleSheetStyles,
} from './StyleSheet';

// Utility function to get PDF context from a component
import type { Component } from '@/utils/component';
import { getContext } from '@/utils/context';
import { PDF_CONTEXT, type PdfContext } from './PdfViewer';

/**
 * Get the PDF context from a component
 */
export function usePdf(ctx: Component<any>): PdfContext | null {
  return getContext(ctx, PDF_CONTEXT) as PdfContext | null;
}

/**
 * Get the PDF API from a component
 */
export function usePdfApi(ctx: Component<any>): PdfBrowserDOMApi | null {
  const pdfContext = usePdf(ctx);
  return pdfContext?.api ?? null;
}

// Re-export the API class for direct usage
import { PdfBrowserDOMApi } from './pdf-api';
export { PdfBrowserDOMApi as PdfApi };
