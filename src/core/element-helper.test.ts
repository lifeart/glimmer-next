import { describe, test, expect } from 'vitest';
import { compile } from '../../plugins/compiler/compile';

describe('Element helper - compiler integration', () => {
  test('element helper with literal string compiles correctly', () => {
    const result = compile(`
      {{#let (element 'div') as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should generate the element helper wrapper function
    expect(result.code).toContain('$_tag');
    expect(result.code).toContain('$_GET_ARGS');
    expect(result.code).toContain('$_fin');
    expect(result.code).toContain('"div"');
  });

  test('element helper with block param compiles correctly', () => {
    const result = compile(`
      {{#let 'span' as |tagName|}}
        {{#let (element tagName) as |Tag|}}
          <Tag>content</Tag>
        {{/let}}
      {{/let}}
    `);

    // Should reference the block param in the getter
    expect(result.code).toContain('Let_tagName_scope');
    expect(result.code).toContain('$_tag');
    // Tag should be wrapped in a getter for reactivity
    expect(result.code).toContain('() => Let_tagName_scope');
  });

  test('element helper ignores extra arguments', () => {
    // The element helper should only use the first argument (tag name)
    // Extra arguments should be ignored (they're not part of the element helper API)
    const result = compile(`
      {{#let (element 'div' 'extra') as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should still compile without errors
    expect(result.code).toContain('$_tag');
    // The tag should be 'div', not affected by 'extra'
    expect(result.code).toContain('"div"');
  });

  test('element helper with path expression', () => {
    const result = compile(`
      {{#let (element this.tagName) as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should generate a getter that references self.tagName
    // The compiler uses 'self' instead of 'this' in closures
    expect(result.code).toContain('self.tagName');
    expect(result.code).toContain('$_tag');
  });

  test('element helper with args path expression', () => {
    const result = compile(`
      {{#let (element this.args.tagName) as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should generate a getter that references args
    expect(result.code).toContain('self.args');
    expect(result.code).toContain('$_tag');
  });
});

describe('Element helper - edge cases', () => {
  test('element helper defaults to div when no argument provided', () => {
    const result = compile(`
      {{#let (element) as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should default to 'div'
    expect(result.code).toContain('"div"');
  });

  test('element helper works with custom element names', () => {
    const result = compile(`
      {{#let (element 'my-custom-element') as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    expect(result.code).toContain('"my-custom-element"');
  });

  test('element helper works with shadowrootmode attribute', () => {
    const result = compile(`
      {{#let (element 'secret-content') as |MySecret|}}
        <MySecret shadowrootmode='open'>
          <span>hidden content</span>
        </MySecret>
      {{/let}}
    `);

    expect(result.code).toContain('"secret-content"');
    expect(result.code).toContain('shadowrootmode');
  });

  test('nested element helpers work correctly', () => {
    const result = compile(`
      {{#let (element 'div') as |Outer|}}
        {{#let (element 'span') as |Inner|}}
          <Outer>
            <Inner>nested</Inner>
          </Outer>
        {{/let}}
      {{/let}}
    `);

    expect(result.code).toContain('"div"');
    expect(result.code).toContain('"span"');
  });
});

describe('Element helper - _DOM tag resolution', () => {
  test('compiled output wraps block param tag in getter', () => {
    const result = compile(`
      {{#let 'article' as |tagName|}}
        {{#let (element tagName) as |Tag|}}
          <Tag data-test>content</Tag>
        {{/let}}
      {{/let}}
    `);

    // The tag should be accessed via a getter for reactivity
    expect(result.code).toContain('() => Let_tagName_scope');
    // The wrapper function should use $_tag
    expect(result.code).toContain('$_tag(');
  });

  test('compiled output for literal tag is still wrapped', () => {
    const result = compile(`
      {{#let (element 'section') as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Even literal tags go through the element helper wrapper
    expect(result.code).toContain('$_tag(');
    expect(result.code).toContain('"section"');
  });

  test('element helper in each loop with index', () => {
    const result = compile(`
      {{#each this.items as |item index|}}
        {{#let (element item.tag) as |Tag|}}
          <Tag data-index={{index}}>{{item.text}}</Tag>
        {{/let}}
      {{/each}}
    `);

    expect(result.code).toContain('$_tag');
    expect(result.code).toContain('item.tag');
  });
});

describe('Element helper - component wrapper structure', () => {
  test('generates proper component wrapper function', () => {
    const result = compile(`
      {{#let (element 'div') as |Tag|}}
        <Tag class="test">content</Tag>
      {{/let}}
    `);

    // Should generate a function that takes 'args'
    expect(result.code).toContain('function(args)');
    // Should get args, fw, and slots
    expect(result.code).toContain('$_GET_ARGS(this, arguments)');
    expect(result.code).toContain('$_GET_FW(this, arguments)');
    expect(result.code).toContain('$_GET_SLOTS(this, arguments)');
    // Should finalize the component
    expect(result.code).toContain('$_fin(');
    // Should create a default slot
    expect(result.code).toContain('$_slot("default"');
  });

  test('element helper passes forward properties', () => {
    const result = compile(`
      {{#let (element 'button') as |Btn|}}
        <Btn class="primary" disabled>Click me</Btn>
      {{/let}}
    `);

    // Forward properties ($fw) should be used
    expect(result.code).toContain('$fw');
    // Attributes should be passed through (class is encoded as empty key with value)
    expect(result.code).toContain('"primary"');
    expect(result.code).toContain('disabled');
  });
});
