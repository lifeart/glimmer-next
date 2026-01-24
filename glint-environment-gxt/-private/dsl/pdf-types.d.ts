/**
 * PDF Renderer Types
 * Based on react-pdf API: https://react-pdf.org/
 */

// Page sizes supported by PDF
export type PageSize =
  | 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10'
  | 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10'
  | 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10'
  | 'RA0' | 'RA1' | 'RA2' | 'RA3' | 'RA4'
  | 'SRA0' | 'SRA1' | 'SRA2' | 'SRA3' | 'SRA4'
  | 'EXECUTIVE' | 'FOLIO' | 'LEGAL' | 'LETTER' | 'TABLOID'
  | { width: number; height: number }
  | [number, number];

export type PageOrientation = 'portrait' | 'landscape';

export type PageMode =
  | 'useNone'
  | 'useOutlines'
  | 'useThumbs'
  | 'fullScreen'
  | 'useOC'
  | 'useAttachments';

export type PageLayout =
  | 'singlePage'
  | 'oneColumn'
  | 'twoColumnLeft'
  | 'twoColumnRight'
  | 'twoPageLeft'
  | 'twoPageRight';

// CSS-like style properties for PDF elements
export interface PdfStyle {
  // Dimensions
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;

  // Margin
  margin?: number | string;
  marginTop?: number | string;
  marginRight?: number | string;
  marginBottom?: number | string;
  marginLeft?: number | string;
  marginHorizontal?: number | string;
  marginVertical?: number | string;

  // Padding
  padding?: number | string;
  paddingTop?: number | string;
  paddingRight?: number | string;
  paddingBottom?: number | string;
  paddingLeft?: number | string;
  paddingHorizontal?: number | string;
  paddingVertical?: number | string;

  // Positioning
  position?: 'absolute' | 'relative';
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
  zIndex?: number;

  // Flexbox
  display?: 'flex' | 'none';
  flexDirection?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  flexFlow?: string;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  flex?: number | string;
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around';
  gap?: number | string;
  rowGap?: number | string;
  columnGap?: number | string;

  // Background
  backgroundColor?: string;
  backgroundImage?: string;

  // Border
  border?: number | string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  borderColor?: string;
  borderTop?: number | string;
  borderTopWidth?: number;
  borderTopStyle?: 'solid' | 'dashed' | 'dotted';
  borderTopColor?: string;
  borderRight?: number | string;
  borderRightWidth?: number;
  borderRightStyle?: 'solid' | 'dashed' | 'dotted';
  borderRightColor?: string;
  borderBottom?: number | string;
  borderBottomWidth?: number;
  borderBottomStyle?: 'solid' | 'dashed' | 'dotted';
  borderBottomColor?: string;
  borderLeft?: number | string;
  borderLeftWidth?: number;
  borderLeftStyle?: 'solid' | 'dashed' | 'dotted';
  borderLeftColor?: string;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;

  // Text
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontWeight?: number | 'thin' | 'ultralight' | 'light' | 'normal' | 'medium' | 'semibold' | 'bold' | 'ultrabold' | 'heavy';
  letterSpacing?: number;
  lineHeight?: number | string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textDecoration?: 'none' | 'underline' | 'line-through' | 'underline line-through';
  textDecorationColor?: string;
  textDecorationStyle?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  textIndent?: number;
  textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase';
  verticalAlign?: 'sub' | 'super';

  // Opacity
  opacity?: number;

  // Overflow
  overflow?: 'visible' | 'hidden';

  // Object fit (for images)
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  objectPosition?: string;

  // Transform
  transform?: string;
  transformOrigin?: string;
}

// Document metadata
export interface DocumentProps {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  pdfVersion?: string;
  language?: string;
  pageMode?: PageMode;
  pageLayout?: PageLayout;
  onRender?: (blob: Blob) => void;
}

// Page props
export interface PageProps {
  size?: PageSize;
  orientation?: PageOrientation;
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  dpi?: number;
  id?: string;
  bookmark?: string | { title: string; fit?: boolean };
}

// View props
export interface ViewProps {
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  id?: string;
  bookmark?: string | { title: string; fit?: boolean };
}

// Text props
export interface TextProps {
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  hyphenationCallback?: (word: string) => string[];
  id?: string;
  bookmark?: string | { title: string; fit?: boolean };
}

// Image source types
export type ImageSource =
  | string
  | { uri: string; method?: string; headers?: Record<string, string>; body?: string }
  | { data: ArrayBuffer | Uint8Array; format: 'jpg' | 'png' }
  | ArrayBuffer
  | Uint8Array;

// Image props
export interface ImageProps {
  src?: ImageSource;
  source?: ImageSource;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  cache?: boolean;
  bookmark?: string | { title: string; fit?: boolean };
}

// Link props
export interface LinkProps {
  src?: string;
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  bookmark?: string | { title: string; fit?: boolean };
}

// Canvas paint context
export interface PdfPaintContext {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number): void;
  circle(x: number, y: number, r: number): void;
  polygon(...points: number[]): void;
  path(d: string): void;
  fill(color?: string): void;
  stroke(color?: string): void;
  fillAndStroke(fillColor?: string, strokeColor?: string): void;
  clip(): void;
  save(): void;
  restore(): void;
  lineWidth(width: number): void;
  lineCap(cap: 'butt' | 'round' | 'square'): void;
  lineJoin(join: 'miter' | 'round' | 'bevel'): void;
  dash(length: number, options?: { space?: number; phase?: number }): void;
  undash(): void;
  opacity(value: number): void;
  fillOpacity(value: number): void;
  strokeOpacity(value: number): void;
  fillColor(color: string): void;
  strokeColor(color: string): void;
  linearGradient(x1: number, y1: number, x2: number, y2: number): any;
  radialGradient(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): any;
  text(text: string, x: number, y: number, options?: any): void;
  font(name: string): void;
  fontSize(size: number): void;
  rotate(angle: number, options?: { origin?: [number, number] }): void;
  scale(x: number, y?: number, options?: { origin?: [number, number] }): void;
  translate(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

// Canvas props
export interface CanvasProps {
  style?: PdfStyle | PdfStyle[];
  paint?: (ctx: PdfPaintContext, availableWidth: number, availableHeight: number) => void;
  debug?: boolean;
  fixed?: boolean;
  bookmark?: string | { title: string; fit?: boolean };
}

// Note props
export interface NoteProps {
  style?: PdfStyle | PdfStyle[];
  fixed?: boolean;
}

// PDF element types
export type PdfElementType =
  | 'document'
  | 'page'
  | 'view'
  | 'text'
  | 'image'
  | 'link'
  | 'canvas'
  | 'note';

// Base PDF element interface
export interface PdfElementNode {
  type: PdfElementType;
  props: Record<string, any>;
  children: (PdfElementNode | string)[];
  parent: PdfElementNode | null;
}

// PDF render options
export interface PdfRenderOptions {
  compress?: boolean;
}

// PDF context for rendering
export interface PdfContext {
  document: PdfElementNode | null;
  fonts: Map<string, FontData>;
  images: Map<string, ImageData>;
}

// Font registration data
export interface FontData {
  family: string;
  src: string | ArrayBuffer;
  fontWeight?: string | number;
  fontStyle?: string;
}

// Cached image data
export interface ImageData {
  src: ImageSource;
  data?: ArrayBuffer;
  width?: number;
  height?: number;
}
