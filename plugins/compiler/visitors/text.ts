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
 * Whether the template's text is Glimmer's: the Ember native layer
 * (EMBER_NATIVE) and Ember compat's opt-in (EMBER_WHITESPACE). The template is
 * then parsed as Glimmer parses it (compile.ts: Handlebars standalone-line and
 * `~` whitespace control, entities decoded by the tokenizer) and every
 * whitespace-only text node is kept (`dropsWhitespaceText`).
 */
export function usesGlimmerText(ctx: CompilerContext): boolean {
  return ctx.flags.EMBER_NATIVE === true || ctx.flags.EMBER_WHITESPACE === true;
}

/**
 * Whether a whitespace-only text node is DROPPED as formatting whitespace.
 *
 * gxt's own dialect drops whitespace-only text that spans lines or has more
 * than one character (`isWhitespaceOnly`). Glimmer keeps every text node the
 * parser produced (Handlebars' standalone-line stripping and `~` already ran),
 * so `{{a}}⏎  {{b}}` renders "a⏎  b" and `<p></p>⏎<p></p>` keeps the newline.
 * With Glimmer's text (`usesGlimmerText`) gxt follows Glimmer; whitespace
 * between named blocks is still ignored by the slot builder, as in Glimmer.
 * Standalone output, and compat output without EMBER_WHITESPACE, are unchanged.
 */
export function dropsWhitespaceText(ctx: CompilerContext, str: string): boolean {
  return !usesGlimmerText(ctx) && isWhitespaceOnly(str);
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
  // or have multiple whitespace characters (not with Glimmer's text)
  if (dropsWhitespaceText(_ctx, chars)) {
    return null;
  }

  // Decode HTML entities (Glimmer's parse already decoded them)
  return usesGlimmerText(_ctx) ? chars : decodeHtmlEntities(chars);
}
