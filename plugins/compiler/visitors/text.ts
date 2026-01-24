/**
 * Text Node Visitor
 *
 * Handles text nodes in the template AST.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext } from '../context';

/**
 * Common HTML entities that need to be decoded.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': '\u00A0',
  '&#39;': "'",
};

/**
 * Decode HTML entities in a string.
 */
function decodeHtmlEntities(str: string): string {
  // First handle named entities
  let result = str;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char);
  }

  // Handle numeric entities like &#60; or &#x3C;
  result = result.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return result;
}

/**
 * Check if a string contains only whitespace.
 */
export function isWhitespaceOnly(str: string): boolean {
  return str.trim().length === 0 && (str.includes('\n') || str.length > 1);
}

/**
 * Visit a TextNode.
 *
 * Returns the text content as a string, or null for whitespace-only nodes.
 *
 * @param ctx - The compiler context
 * @param node - The TextNode to visit
 */
export function visitText(
  _ctx: CompilerContext,
  node: ASTv1.TextNode
): string | null {
  const chars = node.chars;

  // Filter out whitespace-only text nodes that span multiple lines
  // or have multiple whitespace characters
  if (isWhitespaceOnly(chars)) {
    return null;
  }

  // Decode HTML entities
  return decodeHtmlEntities(chars);
}
