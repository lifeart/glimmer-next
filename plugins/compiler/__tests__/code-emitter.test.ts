import { describe, test, expect, beforeEach } from 'vitest';
import { CodeEmitter, createCodeEmitter } from '../tracking/code-emitter';

describe('CodeEmitter', () => {
  let emitter: CodeEmitter;

  beforeEach(() => {
    emitter = new CodeEmitter(100);
  });

  describe('initialization', () => {
    test('starts with empty code', () => {
      expect(emitter.getCode()).toBe('');
    });

    test('starts at position 0', () => {
      expect(emitter.getPosition()).toBe(0);
    });

    test('createCodeEmitter factory works', () => {
      const e = createCodeEmitter(50);
      expect(e.getCode()).toBe('');
    });
  });

  describe('emit', () => {
    test('appends code', () => {
      emitter.emit('hello');
      expect(emitter.getCode()).toBe('hello');
    });

    test('updates position', () => {
      emitter.emit('hello');
      expect(emitter.getPosition()).toBe(5);
    });

    test('concatenates multiple emits', () => {
      emitter.emit('hello');
      emitter.emit(' ');
      emitter.emit('world');
      expect(emitter.getCode()).toBe('hello world');
      expect(emitter.getPosition()).toBe(11);
    });
  });

  describe('emitMapped', () => {
    test('emits code with mapping', () => {
      emitter.emitMapped('content', { start: 0, end: 7 }, 'TextNode');
      expect(emitter.getCode()).toBe('content');
    });

    test('creates mapping in tree', () => {
      emitter.emitMapped('text', { start: 5, end: 9 }, 'TextNode');
      const tree = emitter.getMappingTree();

      expect(tree.children.length).toBe(1);
      expect(tree.children[0].sourceNode).toBe('TextNode');
      expect(tree.children[0].sourceRange).toEqual({ start: 5, end: 9 });
      expect(tree.children[0].generatedRange).toEqual({ start: 0, end: 4 });
    });

    test('skips mapping for undefined range', () => {
      emitter.emitMapped('text', undefined, 'TextNode');
      expect(emitter.getCode()).toBe('text');

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(0);
    });

    test('skips mapping for zero-width range', () => {
      emitter.emitMapped('text', { start: 5, end: 5 }, 'TextNode');
      expect(emitter.getCode()).toBe('text');

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(0);
    });
  });

  describe('scope management', () => {
    test('pushScope creates nested mapping', () => {
      emitter.pushScope({ start: 0, end: 50 }, 'ElementNode');
      emitter.emit('content');
      emitter.popScope();

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].sourceNode).toBe('ElementNode');
    });

    test('popScope updates generated range', () => {
      emitter.pushScope({ start: 0, end: 50 }, 'ElementNode');
      emitter.emit('12345'); // 5 chars
      emitter.popScope();

      const tree = emitter.getMappingTree();
      expect(tree.children[0].generatedRange).toEqual({ start: 0, end: 5 });
    });

    test('nested scopes create nested mappings', () => {
      emitter.pushScope({ start: 0, end: 100 }, 'ElementNode');
      emitter.emit('<div>');

      emitter.pushScope({ start: 5, end: 10 }, 'TextNode');
      emitter.emit('text');
      emitter.popScope();

      emitter.emit('</div>');
      emitter.popScope();

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].sourceNode).toBe('ElementNode');
      expect(tree.children[0].children.length).toBe(1);
      expect(tree.children[0].children[0].sourceNode).toBe('TextNode');
    });

    test('popScope does nothing at root level', () => {
      emitter.popScope(); // Should not throw
      emitter.emit('test');
      expect(emitter.getCode()).toBe('test');
    });

    test('withScope auto-pops scope', () => {
      const result = emitter.withScope({ start: 0, end: 10 }, 'ElementNode', () => {
        emitter.emit('inner');
        return 'result';
      });

      expect(result).toBe('result');

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].generatedRange).toEqual({ start: 0, end: 5 });
    });

    test('withScope pops even on error', () => {
      emitter.pushScope({ start: 0, end: 50 }, 'Template');

      expect(() => {
        emitter.withScope({ start: 5, end: 10 }, 'ElementNode', () => {
          throw new Error('test');
        });
      }).toThrow('test');

      // Should still be in outer scope
      emitter.emit('after');
      emitter.popScope();

      const tree = emitter.getMappingTree();
      // Outer scope should contain the failed inner scope
      expect(tree.children.length).toBe(1);
    });
  });

  describe('getMappingTree', () => {
    test('returns frozen tree structure', () => {
      emitter.emit('test');
      const tree = emitter.getMappingTree();

      expect(Object.isFrozen(tree.sourceRange)).toBe(true);
      expect(Object.isFrozen(tree.generatedRange)).toBe(true);
      expect(Object.isFrozen(tree.children)).toBe(true);
    });

    test('root has correct source range', () => {
      emitter = new CodeEmitter(150);
      const tree = emitter.getMappingTree();
      expect(tree.sourceRange).toEqual({ start: 0, end: 150 });
    });

    test('root has correct generated range', () => {
      emitter.emit('hello world'); // 11 chars
      const tree = emitter.getMappingTree();
      expect(tree.generatedRange).toEqual({ start: 0, end: 11 });
    });
  });

  describe('helper methods', () => {
    test('newline emits newline character', () => {
      emitter.emit('line1');
      emitter.newline();
      emitter.emit('line2');
      expect(emitter.getCode()).toBe('line1\nline2');
    });

    test('emitIndented adds indentation', () => {
      emitter.emitIndented('content', 2);
      expect(emitter.getCode()).toBe('    content');
    });

    test('emitIndented with 0 indent', () => {
      emitter.emitIndented('content', 0);
      expect(emitter.getCode()).toBe('content');
    });

    test('emitList joins items', () => {
      emitter.emitList(['a', 'b', 'c']);
      expect(emitter.getCode()).toBe('a, b, c');
    });

    test('emitList with custom separator', () => {
      emitter.emitList(['a', 'b', 'c'], ' | ');
      expect(emitter.getCode()).toBe('a | b | c');
    });

    test('emitCall generates function call', () => {
      emitter.emitCall('foo', ['a', 'b', 'c']);
      expect(emitter.getCode()).toBe('foo(a, b, c)');
    });

    test('emitCall with source range creates mapping', () => {
      emitter.emitCall('foo', ['a'], { start: 0, end: 5 }, 'SubExpression');

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].sourceNode).toBe('SubExpression');
    });

    test('emitArrowFunction with single param', () => {
      emitter.emitArrowFunction(['x'], 'x + 1');
      expect(emitter.getCode()).toBe('x => x + 1');
    });

    test('emitArrowFunction with multiple params', () => {
      emitter.emitArrowFunction(['a', 'b'], 'a + b');
      expect(emitter.getCode()).toBe('(a, b) => a + b');
    });

    test('emitGetter creates getter function', () => {
      emitter.emitGetter('this.value');
      expect(emitter.getCode()).toBe('() => this.value');
    });

    test('emitGetter with source range creates mapping', () => {
      emitter.emitGetter('this.value', { start: 0, end: 10 });

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].sourceNode).toBe('PathExpression');
    });
  });

  describe('complex scenarios', () => {
    test('realistic element with children', () => {
      // Simulating: <div class="foo">Hello</div>
      emitter.pushScope({ start: 0, end: 30 }, 'ElementNode');
      emitter.emit('$_tag(');
      emitter.emitMapped("'div'", { start: 1, end: 4 }, 'ElementNode');
      emitter.emit(', ');
      emitter.emit("[[\"class\", \"foo\"]]");
      emitter.emit(', ');
      emitter.emitMapped('"Hello"', { start: 17, end: 22 }, 'TextNode');
      emitter.emit(')');
      emitter.popScope();

      expect(emitter.getCode()).toBe("$_tag('div', [[\"class\", \"foo\"]], \"Hello\")");

      const tree = emitter.getMappingTree();
      expect(tree.children.length).toBe(1);
      expect(tree.children[0].children.length).toBe(2); // 'div' and 'Hello'
    });

    test('nested components', () => {
      // Simulating: <Parent><Child /></Parent>
      emitter.pushScope({ start: 0, end: 30 }, 'ComponentNode');
      emitter.emit('$_c(Parent, {}, ');

      emitter.pushScope({ start: 8, end: 18 }, 'ComponentNode');
      emitter.emit('$_c(Child, {})');
      emitter.popScope();

      emitter.emit(')');
      emitter.popScope();

      const tree = emitter.getMappingTree();
      expect(tree.children[0].sourceNode).toBe('ComponentNode');
      expect(tree.children[0].children[0].sourceNode).toBe('ComponentNode');
    });
  });
});
