/**
 * Glimmer Template Compiler - New Architecture
 *
 * This module provides a clean, dependency-injected compiler for Glimmer templates.
 * All state is explicit through the CompilerContext object.
 *
 * @example
 * ```typescript
 * import { compile } from './plugins/compiler';
 *
 * const result = compile('<div>{{this.name}}</div>', {
 *   bindings: new Set(['MyComponent']),
 *   flags: { IS_GLIMMER_COMPAT_MODE: true },
 * });
 *
 * console.log(result.code);
 * console.log(result.errors);
 * ```
 */

// Re-export types
export type {
  // Core types
  SourceRange,
  GeneratedRange,
  MappingSource,
  MappingTreeNode,
  CompilerFlags,
  CompileOptions,
  CompileResult,
  CompilerError,
  CompilerWarning,
  SourceMapV3,
  SourceMapOptions,
  // Binding types
  BindingKind,
  BindingInfo,
  // Value types
  SerializedValue,
  LiteralValue,
  PathValue,
  SpreadValue,
  RawValue,
  HelperValue,
  // Node types
  HBSNode,
  HBSControlExpression,
  HBSChild,
  ControlType,
  AttributeTuple,
  EventTuple,
  PropertyTuple,
  // Tag types
  RuntimeTag,
  HBSTag,
  // Namespace types
  ElementNamespace,
  ElementContext,
} from './types';

// Re-export type utilities
export {
  // Type guards
  isHBSNode,
  isHBSControlExpression,
  isSerializedValue,
  isTextChild,
  isRuntimeTag,
  getTagName,
  // Value constructors
  literal,
  path,
  spread,
  raw,
  helper,
  runtimeTag,
  // Flags
  createFlags,
  DEFAULT_FLAGS,
} from './types';

// Re-export context
export type { CompilerContext } from './context';
export {
  createContext,
  addError,
  addWarning,
  nextContextName,
  resetContextCounter,
  withElementContext,
  isKnownBinding,
  resolveBinding,
  getAllBindingNames,
} from './context';

// Re-export tracking
export { ScopeTracker, createScopeTracker } from './tracking/scope-tracker';
export { CodeEmitter, createCodeEmitter } from './tracking/code-emitter';

// Re-export visitors
export {
  visit,
  visitChildren,
  visitText,
  visitMustache,
  visitBlock,
  visitElement,
  getNodeRange,
  resolvePath,
  serializeValueToString, // String-based serialization for visiting phase
  isWhitespaceOnly,
} from './visitors';

// Re-export serializers
export {
  serialize,
  serializeNode,
  serializeChildren,
  serializeChildArray,
  serializeElement,
  serializeComponent,
  serializeControl,
  serializeValue, // CodeBuilder-based serialization for output phase
  escapeString,
  isPath,
  nextCtxName, // Now requires ctx parameter: nextCtxName(ctx)
  SYMBOLS,
  EVENT_TYPE,
} from './serializers';

// Re-export compile entry point
export {
  compile,
  compileToCode,
  isValidTemplate,
  getTemplateErrors,
} from './compile';

export {
  formatErrorForDisplay,
  formatWarningForDisplay,
} from './errors';

// Re-export sourcemap utilities
export {
  generateSourceMap,
  generateInlineSourceMap,
  appendInlineSourceMap,
} from './sourcemap';

// Re-export formatting utilities
export {
  formatWithPrettier,
  formatManually,
  isPrettierAvailable,
} from './formatting';

// Re-export adapter for backward compatibility
export {
  templateToTypescript,
  createLegacyConverter,
} from './adapter';
