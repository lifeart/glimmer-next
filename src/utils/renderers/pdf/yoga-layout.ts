/**
 * Yoga Layout integration for PDF Renderer
 *
 * Uses Facebook's yoga-layout engine for proper flexbox support
 */

import type { Node as YogaNode, Yoga } from 'yoga-layout/load';
import type { PdfStyle } from './types';
import {
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

// Lazy-loaded Yoga instance
let yogaInstance: Yoga | null = null;

/**
 * Load and initialize Yoga
 * Uses yoga-layout/load entry point for environments without top-level await
 */
async function initYoga(): Promise<Yoga> {
  if (yogaInstance) return yogaInstance;

  // Use the /load entry point which doesn't require top-level await
  const { loadYoga } = await import('yoga-layout/load');
  yogaInstance = await loadYoga();
  return yogaInstance;
}

/**
 * Computed layout result
 */
export interface ComputedLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Layout node with computed values
 */
export interface LayoutNode {
  element: unknown;
  layout: ComputedLayout;
  children: LayoutNode[];
}

/**
 * Convert a style value to number
 */
function toNumber(value: number | string | undefined, defaultValue = 0): number {
  if (value === undefined) return defaultValue;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Apply PdfStyle to a Yoga node
 */
function applyStyle(yoga: Yoga, node: YogaNode, style?: PdfStyle | PdfStyle[]): void {
  if (!style) return;

  // Flatten array styles
  const flatStyle = Array.isArray(style)
    ? style.reduce((acc, s) => ({ ...acc, ...s }), {} as PdfStyle)
    : style;

  // Dimensions
  if (flatStyle.width !== undefined) {
    node.setWidth(toNumber(flatStyle.width));
  }
  if (flatStyle.height !== undefined) {
    node.setHeight(toNumber(flatStyle.height));
  }
  if (flatStyle.minWidth !== undefined) {
    node.setMinWidth(toNumber(flatStyle.minWidth));
  }
  if (flatStyle.minHeight !== undefined) {
    node.setMinHeight(toNumber(flatStyle.minHeight));
  }
  if (flatStyle.maxWidth !== undefined) {
    node.setMaxWidth(toNumber(flatStyle.maxWidth));
  }
  if (flatStyle.maxHeight !== undefined) {
    node.setMaxHeight(toNumber(flatStyle.maxHeight));
  }

  // Padding
  if (flatStyle.padding !== undefined) {
    const p = toNumber(flatStyle.padding);
    node.setPadding(yoga.EDGE_ALL, p);
  }
  if (flatStyle.paddingTop !== undefined) {
    node.setPadding(yoga.EDGE_TOP, toNumber(flatStyle.paddingTop));
  }
  if (flatStyle.paddingRight !== undefined) {
    node.setPadding(yoga.EDGE_RIGHT, toNumber(flatStyle.paddingRight));
  }
  if (flatStyle.paddingBottom !== undefined) {
    node.setPadding(yoga.EDGE_BOTTOM, toNumber(flatStyle.paddingBottom));
  }
  if (flatStyle.paddingLeft !== undefined) {
    node.setPadding(yoga.EDGE_LEFT, toNumber(flatStyle.paddingLeft));
  }
  if (flatStyle.paddingHorizontal !== undefined) {
    const p = toNumber(flatStyle.paddingHorizontal);
    node.setPadding(yoga.EDGE_HORIZONTAL, p);
  }
  if (flatStyle.paddingVertical !== undefined) {
    const p = toNumber(flatStyle.paddingVertical);
    node.setPadding(yoga.EDGE_VERTICAL, p);
  }

  // Margin
  if (flatStyle.margin !== undefined) {
    const m = toNumber(flatStyle.margin);
    node.setMargin(yoga.EDGE_ALL, m);
  }
  if (flatStyle.marginTop !== undefined) {
    node.setMargin(yoga.EDGE_TOP, toNumber(flatStyle.marginTop));
  }
  if (flatStyle.marginRight !== undefined) {
    node.setMargin(yoga.EDGE_RIGHT, toNumber(flatStyle.marginRight));
  }
  if (flatStyle.marginBottom !== undefined) {
    node.setMargin(yoga.EDGE_BOTTOM, toNumber(flatStyle.marginBottom));
  }
  if (flatStyle.marginLeft !== undefined) {
    node.setMargin(yoga.EDGE_LEFT, toNumber(flatStyle.marginLeft));
  }
  if (flatStyle.marginHorizontal !== undefined) {
    const m = toNumber(flatStyle.marginHorizontal);
    node.setMargin(yoga.EDGE_HORIZONTAL, m);
  }
  if (flatStyle.marginVertical !== undefined) {
    const m = toNumber(flatStyle.marginVertical);
    node.setMargin(yoga.EDGE_VERTICAL, m);
  }

  // Flexbox
  if (flatStyle.flexDirection !== undefined) {
    const dirMap: Record<string, number> = {
      'row': yoga.FLEX_DIRECTION_ROW,
      'row-reverse': yoga.FLEX_DIRECTION_ROW_REVERSE,
      'column': yoga.FLEX_DIRECTION_COLUMN,
      'column-reverse': yoga.FLEX_DIRECTION_COLUMN_REVERSE,
    };
    node.setFlexDirection(dirMap[flatStyle.flexDirection] ?? yoga.FLEX_DIRECTION_COLUMN);
  }

  if (flatStyle.justifyContent !== undefined) {
    const justifyMap: Record<string, number> = {
      'flex-start': yoga.JUSTIFY_FLEX_START,
      'flex-end': yoga.JUSTIFY_FLEX_END,
      'center': yoga.JUSTIFY_CENTER,
      'space-between': yoga.JUSTIFY_SPACE_BETWEEN,
      'space-around': yoga.JUSTIFY_SPACE_AROUND,
      'space-evenly': yoga.JUSTIFY_SPACE_EVENLY,
    };
    node.setJustifyContent(justifyMap[flatStyle.justifyContent] ?? yoga.JUSTIFY_FLEX_START);
  }

  if (flatStyle.alignItems !== undefined) {
    const alignMap: Record<string, number> = {
      'flex-start': yoga.ALIGN_FLEX_START,
      'flex-end': yoga.ALIGN_FLEX_END,
      'center': yoga.ALIGN_CENTER,
      'stretch': yoga.ALIGN_STRETCH,
      'baseline': yoga.ALIGN_BASELINE,
    };
    node.setAlignItems(alignMap[flatStyle.alignItems] ?? yoga.ALIGN_STRETCH);
  }

  if (flatStyle.alignSelf !== undefined) {
    const alignMap: Record<string, number> = {
      'auto': yoga.ALIGN_AUTO,
      'flex-start': yoga.ALIGN_FLEX_START,
      'flex-end': yoga.ALIGN_FLEX_END,
      'center': yoga.ALIGN_CENTER,
      'stretch': yoga.ALIGN_STRETCH,
      'baseline': yoga.ALIGN_BASELINE,
    };
    node.setAlignSelf(alignMap[flatStyle.alignSelf] ?? yoga.ALIGN_AUTO);
  }

  if (flatStyle.alignContent !== undefined) {
    const alignMap: Record<string, number> = {
      'flex-start': yoga.ALIGN_FLEX_START,
      'flex-end': yoga.ALIGN_FLEX_END,
      'center': yoga.ALIGN_CENTER,
      'stretch': yoga.ALIGN_STRETCH,
      'space-between': yoga.ALIGN_SPACE_BETWEEN,
      'space-around': yoga.ALIGN_SPACE_AROUND,
    };
    node.setAlignContent(alignMap[flatStyle.alignContent] ?? yoga.ALIGN_FLEX_START);
  }

  if (flatStyle.flexWrap !== undefined) {
    const wrapMap: Record<string, number> = {
      'nowrap': yoga.WRAP_NO_WRAP,
      'wrap': yoga.WRAP_WRAP,
      'wrap-reverse': yoga.WRAP_WRAP_REVERSE,
    };
    node.setFlexWrap(wrapMap[flatStyle.flexWrap] ?? yoga.WRAP_NO_WRAP);
  }

  if (flatStyle.flexGrow !== undefined) {
    node.setFlexGrow(flatStyle.flexGrow);
  }
  if (flatStyle.flexShrink !== undefined) {
    node.setFlexShrink(flatStyle.flexShrink);
  }
  if (flatStyle.flexBasis !== undefined) {
    node.setFlexBasis(toNumber(flatStyle.flexBasis));
  }

  // Gap
  if (flatStyle.gap !== undefined) {
    node.setGap(yoga.GUTTER_ALL, toNumber(flatStyle.gap));
  }
  if (flatStyle.rowGap !== undefined) {
    node.setGap(yoga.GUTTER_ROW, toNumber(flatStyle.rowGap));
  }
  if (flatStyle.columnGap !== undefined) {
    node.setGap(yoga.GUTTER_COLUMN, toNumber(flatStyle.columnGap));
  }

  // Position
  if (flatStyle.position !== undefined) {
    node.setPositionType(
      flatStyle.position === 'absolute' ? yoga.POSITION_TYPE_ABSOLUTE : yoga.POSITION_TYPE_RELATIVE
    );
  }
  if (flatStyle.top !== undefined) {
    node.setPosition(yoga.EDGE_TOP, toNumber(flatStyle.top));
  }
  if (flatStyle.right !== undefined) {
    node.setPosition(yoga.EDGE_RIGHT, toNumber(flatStyle.right));
  }
  if (flatStyle.bottom !== undefined) {
    node.setPosition(yoga.EDGE_BOTTOM, toNumber(flatStyle.bottom));
  }
  if (flatStyle.left !== undefined) {
    node.setPosition(yoga.EDGE_LEFT, toNumber(flatStyle.left));
  }
}

/**
 * Build yoga node tree from PDF element
 */
function buildYogaTree(
  yoga: Yoga,
  element: unknown,
  measureText: (text: string, style?: PdfStyle) => { width: number; height: number }
): YogaNode {
  const node = yoga.Node.create();

  if (isPdfPage(element)) {
    const page = element as PdfPage;
    applyStyle(yoga, node, page.style);

    // Add children
    page.children.forEach((child, index) => {
      const childNode = buildYogaTree(yoga, child, measureText);
      node.insertChild(childNode, index);
    });
  } else if (isPdfView(element)) {
    const view = element as PdfView;
    applyStyle(yoga, node, view.style);

    // Add children
    view.children.forEach((child, index) => {
      const childNode = buildYogaTree(yoga, child, measureText);
      node.insertChild(childNode, index);
    });
  } else if (isPdfText(element)) {
    const text = element as PdfText;
    applyStyle(yoga, node, text.style);

    // Set up measure function for text
    const flatStyle = Array.isArray(text.style)
      ? text.style.reduce((acc, s) => ({ ...acc, ...s }), {} as PdfStyle)
      : text.style;

    // Collect text content
    let textContent = '';
    for (const child of text.children) {
      if (isPdfTextNode(child)) {
        textContent += (child as PdfTextNode).textContent;
      }
    }

    node.setMeasureFunc((_width: number, _widthMode: number, _height: number, _heightMode: number) => {
      return measureText(textContent, flatStyle);
    });
  } else if (isPdfImage(element)) {
    const image = element as PdfImage;
    applyStyle(yoga, node, image.style);
    // Images have fixed dimensions from style
  } else if (isPdfLink(element)) {
    const link = element as PdfLink;
    applyStyle(yoga, node, link.style);

    // Add children
    link.children.forEach((child, index) => {
      const childNode = buildYogaTree(yoga, child, measureText);
      node.insertChild(childNode, index);
    });
  }

  return node;
}

/**
 * Extract computed layout from yoga tree
 */
function extractLayout(yoga: Yoga, node: YogaNode, element: unknown): LayoutNode {
  const layout = node.getComputedLayout();

  const children: LayoutNode[] = [];
  const childCount = node.getChildCount();

  // Get element children
  let elementChildren: unknown[] = [];
  if (isPdfPage(element)) {
    elementChildren = (element as PdfPage).children;
  } else if (isPdfView(element)) {
    elementChildren = (element as PdfView).children;
  } else if (isPdfLink(element)) {
    elementChildren = (element as PdfLink).children;
  }

  for (let i = 0; i < childCount; i++) {
    const childNode = node.getChild(i);
    const childElement = elementChildren[i];
    children.push(extractLayout(yoga, childNode, childElement));
  }

  return {
    element,
    layout: {
      left: layout.left,
      top: layout.top,
      width: layout.width,
      height: layout.height,
    },
    children,
  };
}

/**
 * Free yoga nodes recursively
 */
function freeYogaTree(node: YogaNode): void {
  const childCount = node.getChildCount();
  for (let i = childCount - 1; i >= 0; i--) {
    const child = node.getChild(i);
    node.removeChild(child);
    freeYogaTree(child);
  }
  node.free();
}

/**
 * Calculate layout for a PDF page using Yoga
 */
export async function calculateLayout(
  page: PdfPage,
  pageWidth: number,
  pageHeight: number,
  measureText: (text: string, style?: PdfStyle) => { width: number; height: number }
): Promise<LayoutNode> {
  const yoga = await initYoga();

  // Build yoga tree
  const rootNode = buildYogaTree(yoga, page, measureText);

  // Set root size to page dimensions
  rootNode.setWidth(pageWidth);
  rootNode.setHeight(pageHeight);

  // Calculate layout
  rootNode.calculateLayout(pageWidth, pageHeight, yoga.DIRECTION_LTR);

  // Extract computed layout
  const result = extractLayout(yoga, rootNode, page);

  // Clean up yoga nodes
  freeYogaTree(rootNode);

  return result;
}
