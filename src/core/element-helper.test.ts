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

    // Should contain the tag and $_tag call
    expect(result.code).toContain('tagName');
    expect(result.code).toContain('$_tag');
    // Tag should be wrapped in a getter for reactivity
    expect(result.code).toContain('() => tagName');
  });

  test('element helper rejects more than one positional argument', () => {
    // Matches Ember's element helper contract (RFC 0389): it takes exactly one
    // positional argument. Extra arguments are an authoring error, so the
    // compiled code throws at runtime rather than silently using the first arg.
    // See ember.js integration/helpers/element-test.js
    // ("it requires no more than one argument").
    const result = compile(`
      {{#let (element 'div' 'extra') as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    expect(result.code).toContain('$_tag');
    // Arity is validated rather than coerced to "div".
    expect(result.code).toContain('takes a single positional argument');
    expect(result.code).not.toContain('"div"');
  });

  test('element helper with path expression', () => {
    const result = compile(`
      {{#let (element this.tagName) as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should generate a getter that references this.tagName
    // Arrow function IIFEs preserve `this` from enclosing scope
    expect(result.code).toContain('this.tagName');
    expect(result.code).toContain('$_tag');
  });

  test('element helper with args path expression', () => {
    const result = compile(`
      {{#let (element this.args.tagName) as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    // Should generate a getter that references args
    expect(result.code).toContain('this.args');
    expect(result.code).toContain('$_tag');
  });
});

describe('Element helper - edge cases', () => {
  test('element helper requires at least one positional argument', () => {
    // Matches Ember's element helper contract (RFC 0389): a bare {{element}}
    // with no tag name is an authoring error, so the compiled code throws at
    // runtime rather than defaulting to "div".
    // See ember.js integration/helpers/element-test.js
    // ("it requires at least one argument").
    const result = compile(`
      {{#let (element) as |Tag|}}
        <Tag>content</Tag>
      {{/let}}
    `);

    expect(result.code).toContain('takes a single positional argument');
    expect(result.code).not.toContain('"div"');
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
    expect(result.code).toContain('() => tagName');
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
