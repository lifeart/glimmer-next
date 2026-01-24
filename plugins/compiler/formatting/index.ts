/**
 * Code Formatting Module
 *
 * Provides optional Prettier integration for dev-mode formatting.
 * Falls back to manual formatting when Prettier is not available.
 */

/**
 * Sourcemap in V3 format.
 */
export interface SourceMapV3 {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/**
 * Result of formatting code.
 */
export interface FormatResult {
  code: string;
  map?: SourceMapV3;
}

/**
 * Prettier format function type (for dynamic import).
 */
type PrettierFormat = (
  source: string,
  options?: {
    parser?: string;
    plugins?: unknown[];
    printWidth?: number;
    tabWidth?: number;
    useTabs?: boolean;
    semi?: boolean;
    singleQuote?: boolean;
  }
) => Promise<string>;

// Cached Prettier instance
let prettierInstance: { format: PrettierFormat } | null | undefined = undefined;

/**
 * Try to load Prettier dynamically.
 * Returns null if Prettier is not available.
 */
async function loadPrettier(): Promise<{ format: PrettierFormat } | null> {
  if (prettierInstance !== undefined) {
    return prettierInstance;
  }

  try {
    // Dynamic import to avoid bundling Prettier
    const prettier = await import('prettier');
    // Cast to our simplified interface (we only need the format function)
    prettierInstance = { format: prettier.format as PrettierFormat };
    return prettierInstance;
  } catch {
    prettierInstance = null;
    return null;
  }
}

/**
 * Format JavaScript code using Prettier (if available).
 *
 * @param code - The JavaScript code to format
 * @param options - Formatting options
 * @returns Formatted code and optional sourcemap
 */
export async function formatWithPrettier(
  code: string,
  options: {
    printWidth?: number;
    tabWidth?: number;
    useTabs?: boolean;
    semi?: boolean;
    singleQuote?: boolean;
  } = {}
): Promise<FormatResult> {
  const prettier = await loadPrettier();

  if (!prettier) {
    // Prettier not available, return code as-is
    return { code };
  }

  try {
    const formatted = await prettier.format(code, {
      parser: 'babel',
      printWidth: options.printWidth ?? 80,
      tabWidth: options.tabWidth ?? 2,
      useTabs: options.useTabs ?? false,
      semi: options.semi ?? true,
      singleQuote: options.singleQuote ?? true,
    });

    return { code: formatted };
  } catch (error) {
    // If Prettier fails, return original code
    console.warn('Prettier formatting failed:', error);
    return { code };
  }
}

/**
 * Check if Prettier is available.
 */
export async function isPrettierAvailable(): Promise<boolean> {
  const prettier = await loadPrettier();
  return prettier !== null;
}

/**
 * Synchronous format using manual indentation.
 * This is the fallback when Prettier is not available or in production mode.
 */
export function formatManually(
  code: string,
  options: {
    indent?: string;
    newline?: string;
  } = {}
): string {
  const indent = options.indent ?? '  ';
  const newline = options.newline ?? '\n';

  // Simple indentation based on brackets
  let result = '';
  let level = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const prevChar = i > 0 ? code[i - 1] : '';

    // Track string state
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }

    if (inString) {
      result += char;
      continue;
    }

    // Handle brackets and formatting
    if (char === '[' || char === '{' || char === '(') {
      result += char;
      // Check if next non-space char is closing bracket
      let j = i + 1;
      while (j < code.length && code[j] === ' ') j++;
      if (code[j] !== ']' && code[j] !== '}' && code[j] !== ')') {
        level++;
        result += newline + indent.repeat(level);
      }
    } else if (char === ']' || char === '}' || char === ')') {
      // Check if prev non-space char is opening bracket
      let j = result.length - 1;
      while (j >= 0 && (result[j] === ' ' || result[j] === '\n')) j--;
      if (result[j] !== '[' && result[j] !== '{' && result[j] !== '(') {
        level = Math.max(0, level - 1);
        result += newline + indent.repeat(level);
      }
      result += char;
    } else if (char === ',') {
      result += char + newline + indent.repeat(level);
    } else if (char === ' ' && result.endsWith(newline + indent.repeat(level))) {
      // Skip leading spaces after newline
      continue;
    } else {
      result += char;
    }
  }

  return result;
}
