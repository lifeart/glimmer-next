/**
 * Mapper
 *
 * Tracks position information during code generation.
 * Similar to Glint's Mapper in map-template-contents.ts
 */

import type { ASTv1 } from '@glimmer/syntax';
import type {
  SourceRange,
  MappingSource,
  Directive,
  TransformError,
  MapperOptions,
} from './types';
import { MappingTree } from './mapping-tree';
import { getNodeRange } from './types';

/**
 * Mapper for tracking source positions during code generation.
 */
export class Mapper {
  private output: string = '';
  private offset: number = 0;
  private indentLevel: number = 0;
  private indentString: string = '  ';

  private readonly template: string;

  private rootMapping: MappingTree;
  private mappingStack: MappingTree[] = [];

  public readonly directives: Directive[] = [];
  public readonly errors: TransformError[] = [];

  constructor(options: MapperOptions) {
    this.template = options.template;
    // Note: options.templateOffset is available for future use

    // Create root mapping
    this.rootMapping = new MappingTree(
      'Template',
      { start: 0, end: this.template.length },
      { start: 0, end: 0 }, // Will be updated as we emit
    );
    this.mappingStack.push(this.rootMapping);
  }

  /**
   * Get the current output code
   */
  getCode(): string {
    return this.output;
  }

  /**
   * Get the current output offset
   */
  getOffset(): number {
    return this.offset;
  }

  /**
   * Get the mapping tree
   */
  getMappingTree(): MappingTree {
    // Update root's transformed end to final offset
    this.rootMapping.transformedRange.end = this.offset;
    return this.rootMapping;
  }

  /**
   * Get the current mapping context
   */
  private getCurrentMapping(): MappingTree {
    return this.mappingStack[this.mappingStack.length - 1];
  }

  /**
   * Emit raw text without mapping
   */
  text(value: string): this {
    this.output += value;
    this.offset += value.length;
    return this;
  }

  /**
   * Emit text with a mapping to the original source
   */
  emit(value: string, originalStart: number, originalEnd: number): this {
    const transformedStart = this.offset;
    this.output += value;
    this.offset += value.length;

    // Create mapping for this emission
    const mapping = new MappingTree(
      'Synthetic',
      { start: originalStart, end: originalEnd },
      { start: transformedStart, end: this.offset },
    );
    this.getCurrentMapping().addChild(mapping);

    return this;
  }

  /**
   * Emit an identifier with mapping
   */
  identifier(name: string, originalOffset: number, originalLength?: number): this {
    const length = originalLength ?? name.length;
    const transformedStart = this.offset;

    this.output += name;
    this.offset += name.length;

    const mapping = new MappingTree(
      'Identifier',
      { start: originalOffset, end: originalOffset + length },
      { start: transformedStart, end: this.offset },
      {
        semanticTokens: true,
        completion: true,
        navigation: true,
        verification: true,
        rename: true,
      },
    );
    this.getCurrentMapping().addChild(mapping);

    return this;
  }

  /**
   * Emit code associated with an AST node
   */
  forNode<T extends ASTv1.Node>(
    node: T,
    sourceType: MappingSource,
    callback: () => void,
  ): this {
    const range = getNodeRange(node);
    const transformedStart = this.offset;

    // Push new mapping context
    const mapping = new MappingTree(
      sourceType,
      range,
      { start: transformedStart, end: transformedStart }, // Will update end
    );
    this.getCurrentMapping().addChild(mapping);
    this.mappingStack.push(mapping);

    try {
      callback();
    } finally {
      // Update transformed end and pop
      mapping.transformedRange.end = this.offset;
      this.mappingStack.pop();
    }

    return this;
  }

  /**
   * Track an AST node without emitting code
   */
  nothing(node: ASTv1.Node, sourceType: MappingSource = 'Synthetic'): this {
    const range = getNodeRange(node);
    const mapping = new MappingTree(
      sourceType,
      range,
      { start: this.offset, end: this.offset }, // Zero-length transformed
    );
    this.getCurrentMapping().addChild(mapping);
    return this;
  }

  /**
   * Emit a newline
   */
  newline(): this {
    this.output += '\n';
    this.offset += 1;
    this.output += this.indentString.repeat(this.indentLevel);
    this.offset += this.indentString.length * this.indentLevel;
    return this;
  }

  /**
   * Increase indent level
   */
  indent(): this {
    this.indentLevel++;
    return this;
  }

  /**
   * Decrease indent level
   */
  dedent(): this {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
    return this;
  }

  /**
   * Emit opening brace with newline and indent
   */
  openBlock(): this {
    return this.text('{').newline().indent();
  }

  /**
   * Emit closing brace with dedent and newline
   */
  closeBlock(): this {
    return this.dedent().text('}');
  }

  /**
   * Emit a comma-separated list
   */
  list<T>(items: T[], emitItem: (item: T, index: number) => void, separator: string = ', '): this {
    items.forEach((item, index) => {
      if (index > 0) {
        this.text(separator);
      }
      emitItem(item, index);
    });
    return this;
  }

  /**
   * Emit code wrapped in parentheses
   */
  parens(callback: () => void): this {
    this.text('(');
    callback();
    this.text(')');
    return this;
  }

  /**
   * Emit code wrapped in brackets
   */
  brackets(callback: () => void): this {
    this.text('[');
    callback();
    this.text(']');
    return this;
  }

  /**
   * Emit code wrapped in braces
   */
  braces(callback: () => void): this {
    this.text('{');
    callback();
    this.text('}');
    return this;
  }

  /**
   * Record an error
   */
  error(message: string, node?: ASTv1.Node): this {
    const error: TransformError = { message };
    if (node?.loc) {
      error.location = {
        start: { line: node.loc.start.line, column: node.loc.start.column },
        end: { line: node.loc.end.line, column: node.loc.end.column },
      };
    }
    this.errors.push(error);
    return this;
  }

  /**
   * Record a directive from a comment
   */
  recordDirective(
    kind: Directive['kind'],
    commentRange: SourceRange,
    effectRange: SourceRange,
  ): this {
    this.directives.push({
      kind,
      location: commentRange,
      areaOfEffect: effectRange,
    });
    return this;
  }

  /**
   * Snapshot type that captures full mapper state including mapping tree
   */
  private snapshotType!: {
    output: string;
    offset: number;
    mappingStackLength: number;
    childCounts: number[];
  };

  /**
   * Create a snapshot of current state including mapping tree
   */
  snapshot(): typeof this.snapshotType {
    // Capture the number of children in each mapping stack entry
    const childCounts = this.mappingStack.map(m => m.children.length);

    return {
      output: this.output,
      offset: this.offset,
      mappingStackLength: this.mappingStack.length,
      childCounts,
    };
  }

  /**
   * Restore from a snapshot (for rollback)
   * This restores both output state and mapping tree state
   */
  restore(snapshot: typeof this.snapshotType): this {
    this.output = snapshot.output;
    this.offset = snapshot.offset;

    // Restore mapping stack length
    while (this.mappingStack.length > snapshot.mappingStackLength) {
      this.mappingStack.pop();
    }

    // Restore children counts for each mapping in the stack
    for (let i = 0; i < this.mappingStack.length && i < snapshot.childCounts.length; i++) {
      const targetCount = snapshot.childCounts[i];
      const mapping = this.mappingStack[i];
      // Truncate children array to restore state
      mapping.children.length = targetCount;
    }

    return this;
  }

  /**
   * Get remaining template content from an offset
   */
  getTemplateSlice(start: number, end?: number): string {
    return this.template.slice(start, end);
  }

  /**
   * Get full template
   */
  getTemplate(): string {
    return this.template;
  }
}

/**
 * Create a mapper for a template
 */
export function createMapper(template: string, templateOffset?: number): Mapper {
  return new Mapper({ template, templateOffset });
}
