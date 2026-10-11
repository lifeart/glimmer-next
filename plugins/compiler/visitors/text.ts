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
 * Whether a whitespace-only text node is DROPPED as formatting whitespace.
 *
 * gxt's own dialect drops whitespace-only text that spans lines or has more
 * than one character (`isWhitespaceOnly`). Glimmer keeps every text node the
 * parser produced (Handlebars' standalone-line stripping and `~` already ran),
 * so `{{a}}⏎  {{b}}` renders "a⏎  b" and `<p></p>⏎<p></p>` keeps the newline.
 * Under the Ember native layer (EMBER_NATIVE) gxt follows Glimmer; whitespace
 * between named blocks is still ignored by the slot builder, as in Glimmer.
 * Standalone and compat output are unchanged.
 */
export function dropsWhitespaceText(ctx: CompilerContext, str: string): boolean {
  return ctx.flags.EMBER_NATIVE !== true && isWhitespaceOnly(str);
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
  // or have multiple whitespace characters (not under EMBER_NATIVE)
  if (dropsWhitespaceText(_ctx, chars)) {
    return null;
  }

  // Decode HTML entities (the EMBER_NATIVE parse already decoded them)
  return _ctx.flags.EMBER_NATIVE === true ? chars : decodeHtmlEntities(chars);
}
