export * from '@glint/template/-private/dsl';
export { Globals } from './globals';

import './integration-declarations';

import {
  ElementForTagName,
  ResolveOrReturn,
} from '@glint/template/-private/dsl';
import {
  ComponentReturn,
  AnyContext,
  AnyFunction,
  DirectInvokable,
  HasContext,
  InvokableInstance,
  Invoke,
  InvokeDirect,
  TemplateContext,
  ModifierReturn,
} from '@glint/template/-private/integration';

// Items that can be directly invoked by value
export declare function resolve<T extends DirectInvokable>(
  item: T,
): T[typeof InvokeDirect];
// Items whose instance type can be invoked
export declare function resolve<
  Args extends unknown[],
  Instance extends InvokableInstance,
>(
  item: (abstract new (...args: Args) => Instance) | null | undefined,
): (
  ...args: Parameters<Instance[typeof Invoke]>
) => ReturnType<Instance[typeof Invoke]>;
// Plain functions
export declare function resolve<
  T extends ((...params: any) => any) | null | undefined,
>(item: T): NonNullable<T>;

export declare const resolveOrReturn: ResolveOrReturn<typeof resolve>;

// We customize the top-level `templateExpression` wrapper function for this environment to
// return a type that's assignable to `TemplateOnlyComponent` from '@ember/component/template-only'.
// Longer term we should rationalize this to a type that doesn't carry extra baggage
// and likely comes from a more sensible path.

import { TemplateOnlyComponent } from '@ember/component/template-only';
import { AttrValue } from '@glint/template';

export declare function templateExpression<
  Signature extends AnyFunction = () => ComponentReturn<{}>,
  Context extends AnyContext = TemplateContext<void, {}, {}, void>,
>(
  f: (𝚪: Context, χ: never) => void,
): TemplateOnlyComponent<never> &
  (abstract new () => InvokableInstance<Signature> & HasContext<Context>);

// We customize `applyModifier` to accept `void | () => void` as a valid modifier return type
export declare function applyModifier(
  modifierResult: Promise<void> | ModifierReturn | void | (() => void),
): void;

// =============================================================================
// PDF Element Type Definitions
// =============================================================================

// PDF element attribute types - import from the PDF types module
import type {
  PdfStyle,
  PageSize,
  PageOrientation,
  PageMode,
  PageLayout,
  ImageSource,
} from './pdf-types';

// PDF element types - branded interfaces for unique type identification
interface PdfDocumentElement extends HTMLElement { readonly __pdfType: 'document'; }
interface PdfPageElement extends HTMLElement { readonly __pdfType: 'page'; }
interface PdfViewElement extends HTMLElement { readonly __pdfType: 'view'; }
interface PdfTextElement extends HTMLElement { readonly __pdfType: 'text'; }
interface PdfImageElement extends HTMLElement { readonly __pdfType: 'image'; }
interface PdfLinkElement extends HTMLElement { readonly __pdfType: 'link'; }

// PDF element attribute interfaces
interface PdfDocumentAttributes {
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

interface PdfPageAttributes {
  size?: PageSize;
  orientation?: PageOrientation;
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  dpi?: number;
  id?: string;
  bookmark?: string | { title: string; fit?: boolean };
}

interface PdfViewAttributes {
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  id?: string;
  bookmark?: string | { title: string; fit?: boolean };
}

interface PdfTextAttributes {
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  hyphenationCallback?: (word: string) => string[];
  id?: string;
  bookmark?: string | { title: string; fit?: boolean };
}

interface PdfImageAttributes {
  src?: ImageSource;
  source?: ImageSource;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  cache?: boolean;
  bookmark?: string | { title: string; fit?: boolean };
}

interface PdfLinkAttributes {
  src?: string;
  wrap?: boolean;
  style?: PdfStyle | PdfStyle[];
  debug?: boolean;
  fixed?: boolean;
  bookmark?: string | { title: string; fit?: boolean };
}

// =============================================================================
// Element Emission
// =============================================================================

/**
 * Given a tag name, returns an appropriate `Element` subtype.
 * NOTE: This will return a union for elements that exist both in HTML and SVG. Technically, this will be too permissive.
 */
type WithShadowRoot = { shadowrootmode?: 'open' | 'closed' };

// PDF element type mapping - returns branded PDF element types for PDF tag names
type PdfElementForTagName<Name extends string> =
  Name extends 'pdfDocument' ? PdfDocumentElement :
  Name extends 'pdfPage' ? PdfPageElement :
  Name extends 'pdfView' ? PdfViewElement :
  Name extends 'pdfText' ? PdfTextElement :
  Name extends 'pdfImage' ? PdfImageElement :
  Name extends 'pdfLink' ? PdfLinkElement :
  ElementForTagName<Name>;

export declare function emitElement<Name extends string>(
  name: Name,
): { element: PdfElementForTagName<Name> & WithShadowRoot };

// =============================================================================
// Attribute Application
// =============================================================================

// Overloads for PDF elements (must come before the general fallback)
export declare function applyAttributes(
  element: PdfDocumentElement,
  attrs: Partial<PdfDocumentAttributes>,
): void;
export declare function applyAttributes(
  element: PdfPageElement,
  attrs: Partial<PdfPageAttributes>,
): void;
export declare function applyAttributes(
  element: PdfViewElement,
  attrs: Partial<PdfViewAttributes>,
): void;
export declare function applyAttributes(
  element: PdfTextElement,
  attrs: Partial<PdfTextAttributes>,
): void;
export declare function applyAttributes(
  element: PdfImageElement,
  attrs: Partial<PdfImageAttributes>,
): void;
export declare function applyAttributes(
  element: PdfLinkElement,
  attrs: Partial<PdfLinkAttributes>,
): void;
// General fallback for all other elements
export declare function applyAttributes(
  element: Element,
  attrs: Record<string, AttrValue> & WithShadowRoot,
): void;

export declare function applySplattributes(
  element: Element,
  attrs: unknown,
): void;

// =============================================================================
// Global Type Augmentations
// =============================================================================

// Extend HTMLElementTagNameMap for PDF elements so they are recognized as valid tag names
declare global {
  interface HTMLElementTagNameMap {
    'pdfDocument': PdfDocumentElement;
    'pdfPage': PdfPageElement;
    'pdfView': PdfViewElement;
    'pdfText': PdfTextElement;
    'pdfImage': PdfImageElement;
    'pdfLink': PdfLinkElement;
  }
}
