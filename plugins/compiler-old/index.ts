/**
 * Converter V2
 *
 * Template-to-JavaScript converter with Glint-style source mapping.
 */

// Types (SourceRange is the type for source code ranges)
export type {
  SourceRange,
  SourceRange as Range,  // Alias for backward compatibility
  SourceLocation,
  CodeInformation,
  CodeMapping,
  MappingSource,
  Directive,
  TransformError,
  RewriteResult,
  MappingTreeNode,
  CorrelatedSpan,
  RewriteInput,
  MapperOptions,
  HBSNodeV2,
  HBSControlExpressionV2,
  ComplexJSTypeV2,
} from './types';

export { getNodeRange, getSourceLocation } from './types';

// Mapping Tree
export { MappingTree, createRootMapping } from './mapping-tree';

// Mapper
export { Mapper, createMapper } from './mapper';

// Transformed Module
export { TransformedModule, TransformedModuleBuilder } from './transformed-module';

// Converter
export { templateToTypescript, convert } from './legacy-converter';

// Type alias for backward compatibility
export type { ComplexJSType } from './legacy-converter';

// Source Map Generation
export {
  generateSourceMap,
  generateEmptySourceMap,
  mergeSourceMaps,
  shiftSourceMap,
  createIdentityMap,
  sourceMapToDataUrl,
  appendSourceMapComment,
} from './source-map';

export type { RawSourceMap } from './source-map';
