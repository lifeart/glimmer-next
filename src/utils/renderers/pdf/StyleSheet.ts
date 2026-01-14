/**
 * StyleSheet utility for PDF styling
 * Similar to React Native's StyleSheet.create()
 */

import type { PdfStyle } from './types';

export type StyleSheetStyles<T extends Record<string, PdfStyle>> = {
  [K in keyof T]: PdfStyle;
};

/**
 * Create a stylesheet with named styles
 * This provides type safety and allows for future optimizations
 *
 * @example
 * const styles = StyleSheet.create({
 *   container: {
 *     flexDirection: 'row',
 *     padding: 10,
 *   },
 *   title: {
 *     fontSize: 24,
 *     fontWeight: 'bold',
 *   },
 * });
 */
export const StyleSheet = {
  /**
   * Create a stylesheet from an object of style definitions
   */
  create<T extends Record<string, PdfStyle>>(styles: T): StyleSheetStyles<T> {
    // For now, just return the styles as-is
    // In the future, this could flatten styles, validate properties, etc.
    return Object.freeze({ ...styles }) as StyleSheetStyles<T>;
  },

  /**
   * Flatten an array of styles into a single style object
   */
  flatten(styles: (PdfStyle | undefined | null | false)[]): PdfStyle {
    return styles.reduce<PdfStyle>((acc, style) => {
      if (style && typeof style === 'object') {
        return { ...acc, ...style };
      }
      return acc;
    }, {});
  },

  /**
   * Compose multiple styles together
   */
  compose(...styles: (PdfStyle | undefined | null | false)[]): PdfStyle {
    return StyleSheet.flatten(styles);
  },

  /**
   * Absolute fill style (fills parent container)
   */
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as PdfStyle,

  /**
   * Absolute fill object (same as absoluteFill but as an object for spreading)
   */
  absoluteFillObject: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as PdfStyle,
};

/**
 * Common page sizes in points (72 dpi)
 */
export const PageSizes = {
  // ISO A series (in points)
  A0: { width: 2384, height: 3370 },
  A1: { width: 1684, height: 2384 },
  A2: { width: 1191, height: 1684 },
  A3: { width: 842, height: 1191 },
  A4: { width: 595, height: 842 },
  A5: { width: 420, height: 595 },
  A6: { width: 298, height: 420 },
  A7: { width: 210, height: 298 },
  A8: { width: 148, height: 210 },
  A9: { width: 105, height: 148 },
  A10: { width: 74, height: 105 },

  // ISO B series
  B0: { width: 2835, height: 4008 },
  B1: { width: 2004, height: 2835 },
  B2: { width: 1417, height: 2004 },
  B3: { width: 1001, height: 1417 },
  B4: { width: 709, height: 1001 },
  B5: { width: 499, height: 709 },
  B6: { width: 354, height: 499 },
  B7: { width: 249, height: 354 },
  B8: { width: 176, height: 249 },
  B9: { width: 125, height: 176 },
  B10: { width: 88, height: 125 },

  // ISO C series
  C0: { width: 2599, height: 3677 },
  C1: { width: 1837, height: 2599 },
  C2: { width: 1298, height: 1837 },
  C3: { width: 918, height: 1298 },
  C4: { width: 649, height: 918 },
  C5: { width: 459, height: 649 },
  C6: { width: 323, height: 459 },
  C7: { width: 230, height: 323 },
  C8: { width: 162, height: 230 },
  C9: { width: 113, height: 162 },
  C10: { width: 79, height: 113 },

  // US sizes
  LETTER: { width: 612, height: 792 },
  LEGAL: { width: 612, height: 1008 },
  TABLOID: { width: 792, height: 1224 },
  EXECUTIVE: { width: 522, height: 756 },
  FOLIO: { width: 612, height: 936 },

  // Raw archive sizes
  RA0: { width: 2438, height: 3458 },
  RA1: { width: 1729, height: 2438 },
  RA2: { width: 1219, height: 1729 },
  RA3: { width: 865, height: 1219 },
  RA4: { width: 610, height: 865 },

  // Supplementary raw archive sizes
  SRA0: { width: 2551, height: 3628 },
  SRA1: { width: 1814, height: 2551 },
  SRA2: { width: 1276, height: 1814 },
  SRA3: { width: 907, height: 1276 },
  SRA4: { width: 638, height: 907 },
} as const;

/**
 * Get page dimensions for a given size
 */
export function getPageSize(
  size: keyof typeof PageSizes | { width: number; height: number } | [number, number],
  orientation: 'portrait' | 'landscape' = 'portrait',
): { width: number; height: number } {
  let dimensions: { width: number; height: number };

  if (typeof size === 'string') {
    dimensions = PageSizes[size] || PageSizes.A4;
  } else if (Array.isArray(size)) {
    dimensions = { width: size[0], height: size[1] };
  } else {
    dimensions = size;
  }

  // Swap dimensions for landscape
  if (orientation === 'landscape') {
    return { width: dimensions.height, height: dimensions.width };
  }

  return dimensions;
}

/**
 * Parse a CSS unit value to points
 * Supports: pt, in, cm, mm, px, %
 */
export function parseUnit(value: string | number, containerSize = 0): number {
  if (typeof value === 'number') {
    return value;
  }

  const match = value.match(/^(-?\d*\.?\d+)(pt|in|cm|mm|px|%|vw|vh)?$/);
  if (!match) {
    return parseFloat(value) || 0;
  }

  const num = parseFloat(match[1]);
  const unit = match[2] || 'pt';

  switch (unit) {
    case 'pt':
      return num;
    case 'in':
      return num * 72;
    case 'cm':
      return num * 28.346;
    case 'mm':
      return num * 2.835;
    case 'px':
      return num * 0.75; // Assuming 96 DPI screen
    case '%':
      return (num / 100) * containerSize;
    case 'vw':
    case 'vh':
      // These would need document dimensions passed in
      return num;
    default:
      return num;
  }
}
