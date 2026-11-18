/**
 * The rewrite of the references to a block param a row reads through its item
 * reference (serializers/binding-refs.ts): `item` → `item.value` in a
 * positional `{{#each}}` row, `k` / `v` → `$__entry.value[0]` / `[1]` in a
 * native `{{#each-in}}` row.
 */
import { describe, test, expect } from 'vitest';
import { B, serializeJS } from '../builder';
import { replaceBindingRefs, replaceInCode } from '../serializers/binding-refs';

const ITEM = new Map([['item', 'item.value']]);

describe('replaceInCode', () => {
  test('a standalone reference is replaced', () => {
    expect(replaceInCode('item', ITEM)).toBe('item.value');
    expect(replaceInCode('item.name', ITEM)).toBe('item.value.name');
    expect(replaceInCode('item?.[0]', ITEM)).toBe('item.value?.[0]');
    expect(replaceInCode('$__tag(item, "name")', ITEM)).toBe('$__tag(item.value, "name")');
    expect(replaceInCode('f(a, item, b)', ITEM)).toBe('f(a, item.value, b)');
    expect(replaceInCode('[...item]', ITEM)).toBe('[...item.value]');
    expect(replaceInCode('c ? item : x', ITEM)).toBe('c ? item.value : x');
    expect(replaceInCode('{ a: item, b: () => item }', ITEM)).toBe(
      '{ a: item.value, b: () => item.value }',
    );
  });

  test('member names, object keys, longer identifiers and strings are left alone', () => {
    expect(replaceInCode('this.item', ITEM)).toBe('this.item');
    expect(replaceInCode('a?.item', ITEM)).toBe('a?.item');
    expect(replaceInCode('{ item: 1 }', ITEM)).toBe('{ item: 1 }');
    expect(replaceInCode('{ a: 1, item: 2 }', ITEM)).toBe('{ a: 1, item: 2 }');
    expect(replaceInCode('items + $item + item2 + _item', ITEM)).toBe(
      'items + $item + item2 + _item',
    );
    expect(replaceInCode('"an item" + \'item\' + "it\\"item"', ITEM)).toBe(
      '"an item" + \'item\' + "it\\"item"',
    );
    expect(replaceInCode('/* item */ f(/*#__PURE__*/ item)', ITEM)).toBe(
      '/* item */ f(/*#__PURE__*/ item.value)',
    );
  });

  test('template literals: the text is left alone, the parts are rewritten', () => {
    expect(replaceInCode('`item ${item} ${{ item: item }.item}`', ITEM)).toBe(
      '`item ${item.value} ${{ item: item.value }.item}`',
    );
  });

  test('several names in one pass, with no rewrite of a replacement', () => {
    const entry = new Map([
      ['k', '$__entry.value[0]'],
      ['value', '$__entry.value[1]'],
    ]);
    expect(replaceInCode('f(k, value, value.id)', entry)).toBe(
      'f($__entry.value[0], $__entry.value[1], $__entry.value[1].id)',
    );
  });
});

describe('replaceBindingRefs', () => {
  const out = (node: Parameters<typeof replaceBindingRefs>[0]) =>
    serializeJS(replaceBindingRefs(node, ITEM), { emitPure: false });

  test('identifiers, runtime references and raw code', () => {
    expect(out(B.id('item'))).toBe('item.value');
    expect(out(B.runtimeRef('item.name'))).toBe('item.value.name');
    expect(out(B.call('item.fn', [B.id('x')]))).toBe('item.value.fn(x)');
    expect(out(B.raw('globalThis.f(() => (item.a))'))).toBe('globalThis.f(() => (item.value.a))');
    expect(out(B.member(B.id('item'), 'name'))).toBe('item.value.name');
    expect(out(B.string('item'))).toBe('"item"');
  });

  test('object keys stay, shorthand properties are spelled out', () => {
    expect(out(B.object([B.prop('item', B.id('item'))]))).toBe('{ item: item.value }');
    expect(out(B.object([B.shorthand('item')]))).toBe('{ item: item.value }');
  });

  test('a param of the same name shadows it inside its function', () => {
    const inner = B.arrow(['item', 'ctx1'], B.runtimeRef('item.v'));
    expect(out(B.call('$_each', [B.getter(B.runtimeRef('item.cells')), inner]))).toBe(
      '$_each(() => item.value.cells, (item, ctx1) => item.v)',
    );
    // a destructuring param
    expect(out(B.arrow(['[item, x]', 'ctx'], B.id('item')))).toBe('([item, x], ctx) => item');
    // another param does not
    expect(out(B.arrow(['ctx2'], B.id('item')))).toBe('ctx2 => item.value');
  });

  test('a variable of the same name shadows it from its declaration on', () => {
    const block = B.arrowBlock(
      [],
      [B.varDecl('let', 'item', B.arrow([], B.id('item'))), B.ret(B.array([B.id('item')]))],
    );
    const code = out(B.call(block, []));
    expect(code).toContain('let item = () => item.value');
    expect(code).toContain('return [item]');
  });

  test('a function declaring the root of a replacement would capture it: the rewrite throws', () => {
    const entry = new Map([['k', '$__entry_ctx0.value[0]']]);
    const inner = B.arrow(['$__entry_ctx0', 'ctx1'], B.id('k'));
    expect(() => replaceBindingRefs(B.call('f', [inner]), entry)).toThrow(
      /declares `\$__entry_ctx0`, which the rewrite of `k`/,
    );
    // another entry name is no capture
    const other = B.arrow(['$__entry_ctx1', 'ctx1'], B.id('k'));
    expect(serializeJS(replaceBindingRefs(other, entry), { emitPure: false })).toBe(
      '($__entry_ctx1, ctx1) => $__entry_ctx0.value[0]',
    );
  });

  test('nodes without a reference are returned as they are', () => {
    const node = B.call('$_tag', [B.string('div'), B.array([B.id('x')])]);
    expect(replaceBindingRefs(node, ITEM)).toBe(node);
    expect(replaceBindingRefs(B.id('item'), new Map())).toEqual(B.id('item'));
  });
});
