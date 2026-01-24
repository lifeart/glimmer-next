# Converter V2

Template-to-JavaScript converter with Glint-style source mapping infrastructure and Vite integration.

## Overview

Converter V2 is a redesigned template converter that provides bidirectional source mapping between template source code and generated JavaScript. The architecture is inspired by [Glint](https://github.com/typed-ember/glint)'s transformation pipeline.

Key features:
- **Hierarchical source mapping** - Track source positions through the transformation
- **Vite integration** - Generate standard source maps for browser DevTools
- **Bidirectional lookup** - Map from original → generated and generated → original
- **Volar compatibility** - Export mappings in Volar's CodeMapping format

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     templateToTypescript()                   │
│                                                             │
│  ┌─────────┐    ┌────────┐    ┌──────────────────────────┐ │
│  │ Mapper  │───▶│ AST    │───▶│ HBSNode/ControlExpression│ │
│  │         │    │ Parser │    │ with source locations    │ │
│  └─────────┘    └────────┘    └──────────────────────────┘ │
│       │                                   │                 │
│       ▼                                   ▼                 │
│  ┌─────────────┐                ┌─────────────────────┐    │
│  │ MappingTree │◀───────────────│ emitValue/emitNode  │    │
│  │ (hierarchical)               │ (with source mapping)│    │
│  └─────────────┘                └─────────────────────┘    │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────┐      ┌──────────────────────────┐    │
│  │ TransformedModule│ ───▶│ generateSourceMap()      │    │
│  └─────────────────┘      │ (Vite-compatible v3 map) │    │
│                           └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Modules

### `types.ts`
Core type definitions including:
- `SourceRange` - Represents a range in source code (start/end offsets)
- `MappingTreeNode` - Interface for hierarchical source mappings
- `HBSNodeV2` / `HBSControlExpressionV2` - Template node types with location info
- `CodeMapping` - Volar-compatible code mapping format

### `mapping-tree.ts`
Hierarchical structure for tracking source-to-generated mappings:
- `MappingTree` - Tree structure with parent-child relationships
- Supports bidirectional offset lookup (source ↔ generated)
- Can export to Volar's `CodeMapping` format

### `mapper.ts`
Position tracking during code generation:
- `Mapper` - Tracks output position and builds mapping tree
- `emit()` - Emit text with source mapping
- `forNode()` - Scoped emission for AST nodes
- `snapshot()/restore()` - Checkpoint and rollback support

### `transformed-module.ts`
Result container with bidirectional offset translation:
- `TransformedModule` - Final result with offset translation methods
- `getOriginalOffset()` / `getTransformedOffset()` - Bidirectional mapping
- `TransformedModuleBuilder` - Builder pattern for construction

### `converter.ts`
Main converter with both new and compatibility APIs:
- `templateToTypescript()` - New API with full source mapping
- `convert()` - Compatibility layer matching old converter API

### `source-map.ts`
Source map generation for Vite/browser DevTools integration:
- `generateSourceMap()` - Convert MappingTree to standard source map v3 format
- `generateEmptySourceMap()` - Create empty source map
- `createIdentityMap()` - Create 1:1 identity mapping for passthrough code
- `shiftSourceMap()` - Shift mappings by line offset (for embedding)
- `sourceMapToDataUrl()` - Convert to inline data URL
- `appendSourceMapComment()` - Add inline source map comment to code
- VLQ encoding utilities for the `mappings` field

## Usage

### New API (with source mapping)

```typescript
import { templateToTypescript } from './converter-v2';
import { defaultFlags } from '../flags';

const result = templateToTypescript('<div>{{name}}</div>', defaultFlags(), new Set(['name']));

console.log(result.code);     // Generated JavaScript
console.log(result.mapping);  // MappingTree for source mapping
console.log(result.errors);   // Any conversion errors
```

### Compatibility API (drop-in replacement)

```typescript
import { convert } from './converter-v2';

const { ToJSType, ElementToNode } = convert(seenNodes, flags, bindings);

// Use with AST traversal as before
traverse(ast, {
  ElementNode(node) {
    const converted = ElementToNode(node);
    // ...
  }
});
```

## Source Mapping

The converter tracks source locations through the transformation:

1. **Input**: Template string with character offsets
2. **Parsing**: Glimmer parser provides AST with location info
3. **Conversion**: Each HBS node retains its `loc` property
4. **Emission**: `mapper.emit()` creates mapping entries
5. **Output**: `MappingTree` with hierarchical offset mappings

### Offset Translation

```typescript
const module = new TransformedModule({ ... });

// Find original position from generated position
const original = module.getOriginalOffset(42);
// { offset: 15, found: true, mapping: {...} }

// Find generated position from original position
const generated = module.getTransformedOffset(15);
// { offset: 42, found: true, mapping: {...} }
```

## Differences from Original Converter

| Feature | Original | Converter V2 |
|---------|----------|--------------|
| Source mapping | No | Yes (hierarchical) |
| Return type | `{ ToJSType, ElementToNode }` | `{ code, mapping, errors }` |
| Location tracking | Lost during conversion | Preserved in `loc` |
| Snapshot/restore | N/A | Full state including mappings |
| Variable naming | `Math.random()` | Deterministic counter |

## Integration with Volar

The mapping tree can be exported to Volar's `CodeMapping` format:

```typescript
const mappings = result.mapping.toCodeMappings();
// Array of { sourceOffsets, generatedOffsets, lengths, data }
```

This enables integration with Volar-based language services for:
- Go to definition
- Find references
- Rename refactoring
- Semantic highlighting

## Integration with Vite

The plugin returns source maps to Vite for browser DevTools integration:

### How It Works

1. **Babel generates source maps** during TypeScript/template transformation
2. The `transform()` function returns `{ code, map }` to Vite
3. Vite processes the source map for the browser

### TransformResult Format

```typescript
interface TransformResult {
  code: string;
  map?: RawSourceMap | null;
}

interface RawSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;  // VLQ-encoded mappings
}
```

### Generating Source Maps from MappingTree

```typescript
import { generateSourceMap, type RawSourceMap } from './converter-v2';

const map: RawSourceMap = generateSourceMap(
  originalSource,      // Original template source
  generatedSource,     // Generated JavaScript
  mappingTree,         // MappingTree from converter
  'component.hbs',     // Source file name
  'component.js',      // Generated file name (optional)
);
```

### Inline Source Maps

For development, you can embed source maps directly in the code:

```typescript
import { appendSourceMapComment, createIdentityMap } from './converter-v2';

const map = createIdentityMap(source, 'file.ts');
const codeWithMap = appendSourceMapComment(code, map);
// Output: code + '\n//# sourceMappingURL=data:application/json;...'
```

### Benefits

With source maps enabled:
- **Browser DevTools** show original `.gts`/`.hbs` files instead of generated JS
- **Error stack traces** point to original source locations
- **Breakpoints** can be set in original template code
- **Step debugging** works through template expressions

## Testing

```bash
# Run all converter-v2 tests
npm test -- plugins/converter-v2/

# Run specific test files
npm test -- plugins/converter-v2/converter.test.ts
npm test -- plugins/converter-v2/source-map.test.ts

# Run transform integration tests
npm test -- plugins/transform.test.ts
```

The test suite covers:
- MappingTree operations and hierarchical lookups
- Mapper emit functions with source tracking
- TransformedModule offset translation (bidirectional)
- Source map generation (VLQ encoding, line/column conversion)
- Full template conversion scenarios
- Vite TransformResult format compliance
