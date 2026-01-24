/**
 * CodeEmitter - Code generation with source mapping.
 *
 * Handles appending generated code while tracking source positions
 * and building a hierarchical mapping tree.
 */

import type {
  SourceRange,
  GeneratedRange,
  MappingTreeNode,
  MappingSource,
} from '../types';

/**
 * Mutable mapping tree node used during construction.
 */
interface MutableMappingNode {
  sourceRange: SourceRange;
  generatedRange: GeneratedRange;
  sourceNode: MappingSource;
  children: MutableMappingNode[];
  name?: string;
}

/**
 * CodeEmitter handles code generation with automatic source mapping.
 *
 * @example
 * ```typescript
 * const emitter = new CodeEmitter(sourceLength);
 *
 * emitter.pushScope({ start: 0, end: 50 }, 'ElementNode');
 * emitter.emit('<div>');
 * emitter.emitMapped('content', { start: 5, end: 12 }, 'TextNode');
 * emitter.emit('</div>');
 * emitter.popScope();
 *
 * const code = emitter.getCode();
 * const mappings = emitter.getMappingTree();
 * ```
 */
export class CodeEmitter {
  private code = '';
  private position = 0;
  private readonly originalSourceLength: number;

  // Mapping tree construction
  private readonly mappingStack: MutableMappingNode[] = [];
  private readonly rootMapping: MutableMappingNode;

  constructor(originalSourceLength: number) {
    this.originalSourceLength = originalSourceLength;

    // Initialize root mapping
    this.rootMapping = {
      sourceRange: { start: 0, end: originalSourceLength },
      generatedRange: { start: 0, end: 0 }, // Updated when finalized
      sourceNode: 'Template',
      children: [],
    };

    this.mappingStack.push(this.rootMapping);
  }

  /**
   * Emit code without source mapping.
   */
  emit(code: string): void {
    this.code += code;
    this.position += code.length;
  }

  /**
   * Emit code with source mapping.
   */
  emitMapped(
    code: string,
    sourceRange: SourceRange | undefined,
    sourceNode: MappingSource,
    name?: string
  ): void {
    const range = this.normalizeRange(sourceRange);
    if (!range || range.start === range.end) {
      // No valid source range, emit without mapping
      this.emit(code);
      return;
    }

    const startPosition = this.position;
    this.emit(code);
    const endPosition = this.position;

    const mapping: MutableMappingNode = {
      sourceRange: range,
      generatedRange: { start: startPosition, end: endPosition },
      sourceNode,
      children: [],
      name,
    };

    this.currentScope.children.push(mapping);
  }

  /**
   * Push a new scope onto the mapping stack.
   * All subsequent mappings will be children of this scope.
   */
  pushScope(sourceRange: SourceRange | undefined, sourceNode: MappingSource): void {
    const range = this.normalizeRange(sourceRange) ?? { start: 0, end: 0 };
    const mapping: MutableMappingNode = {
      sourceRange: range,
      generatedRange: { start: this.position, end: this.position },
      sourceNode,
      children: [],
    };

    this.currentScope.children.push(mapping);
    this.mappingStack.push(mapping);
  }

  /**
   * Pop the current scope from the mapping stack.
   * Updates the scope's generated range end position.
   */
  popScope(): void {
    if (this.mappingStack.length <= 1) {
      // Don't pop the root
      return;
    }

    const scope = this.mappingStack.pop()!;
    scope.generatedRange = {
      start: scope.generatedRange.start,
      end: this.position,
    };
  }

  /**
   * Execute a function within a scope.
   * The scope is automatically popped when the function returns.
   */
  withScope<T>(
    sourceRange: SourceRange | undefined,
    sourceNode: MappingSource,
    fn: () => T
  ): T {
    this.pushScope(sourceRange, sourceNode);
    try {
      return fn();
    } finally {
      this.popScope();
    }
  }

  /**
   * Get the generated code.
   */
  getCode(): string {
    return this.code;
  }

  /**
   * Get the current position in the generated code.
   */
  getPosition(): number {
    return this.position;
  }

  /**
   * Get the finalized mapping tree.
   */
  getMappingTree(): MappingTreeNode {
    // Update root's generated range
    this.rootMapping.generatedRange = {
      start: 0,
      end: this.position,
    };

    // Convert to immutable structure
    return this.freezeMapping(this.rootMapping);
  }

  /**
   * Emit a newline.
   */
  newline(): void {
    this.emit('\n');
  }

  /**
   * Emit code with indentation.
   */
  emitIndented(code: string, indent: number): void {
    const indentation = '  '.repeat(indent);
    this.emit(indentation + code);
  }

  /**
   * Emit a comma-separated list.
   */
  emitList(
    items: readonly string[],
    separator = ', '
  ): void {
    this.emit(items.join(separator));
  }

  /**
   * Emit a function call.
   */
  emitCall(
    functionName: string,
    args: readonly string[],
    sourceRange?: SourceRange,
    sourceNode: MappingSource = 'Synthetic'
  ): void {
    const code = `${functionName}(${args.join(', ')})`;
    if (sourceRange) {
      this.emitMapped(code, sourceRange, sourceNode);
    } else {
      this.emit(code);
    }
  }

  /**
   * Emit an arrow function.
   */
  emitArrowFunction(
    params: readonly string[],
    body: string,
    sourceRange?: SourceRange
  ): void {
    const paramsStr = params.length === 1 ? params[0] : `(${params.join(', ')})`;
    const code = `${paramsStr} => ${body}`;
    if (sourceRange) {
      this.emitMapped(code, sourceRange, 'Synthetic');
    } else {
      this.emit(code);
    }
  }

  /**
   * Emit a getter (for reactive values).
   */
  emitGetter(expression: string, sourceRange?: SourceRange): void {
    const code = `() => ${expression}`;
    if (sourceRange) {
      this.emitMapped(code, sourceRange, 'PathExpression');
    } else {
      this.emit(code);
    }
  }

  private get currentScope(): MutableMappingNode {
    return this.mappingStack[this.mappingStack.length - 1];
  }

  private normalizeRange(range?: SourceRange): SourceRange | null {
    if (!range) return null;
    const start = Math.max(0, Math.min(this.originalSourceLength, range.start));
    const end = Math.max(start, Math.min(this.originalSourceLength, range.end));
    return { start, end };
  }

  private freezeMapping(node: MutableMappingNode): MappingTreeNode {
    const result: MappingTreeNode = {
      sourceRange: Object.freeze({ ...node.sourceRange }),
      generatedRange: Object.freeze({ ...node.generatedRange }),
      sourceNode: node.sourceNode,
      children: Object.freeze(node.children.map(child => this.freezeMapping(child))) as MappingTreeNode[],
      ...(node.name ? { name: node.name } : {}),
    };
    return result;
  }
}

/**
 * Create a new code emitter.
 */
export function createCodeEmitter(originalSourceLength: number): CodeEmitter {
  return new CodeEmitter(originalSourceLength);
}
