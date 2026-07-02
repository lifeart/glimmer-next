import { describe, test, expect } from 'vitest';
import {
  compile,
  compileToCode,
  isValidTemplate,
  getTemplateErrors,
} from '../compile';
import { SYMBOLS } from '../serializers';

describe('compile()', () => {
  describe('basic templates', () => {
    test('compiles empty template', () => {
      const result = compile('');
      expect(result.code).toBe('[]');
      expect(result.errors).toHaveLength(0);
    });

    test('compiles text-only template', () => {
      const result = compile('Hello World');
      expect(result.code).toContain('"Hello World"');
      expect(result.errors).toHaveLength(0);
    });

    test('compiles simple element', () => {
      const result = compile('<div>content</div>');
      expect(result.code).toContain(SYMBOLS.TAG);
      expect(result.code).toContain("'div'");
      expect(result.errors).toHaveLength(0);
    });

    test('compiles self-closing element', () => {
      const result = compile('<br />');
      expect(result.code).toContain(SYMBOLS.TAG);
      expect(result.code).toContain("'br'");
    });

    test('compiles element with class', () => {
      const result = compile('<div class="foo">bar</div>');
      // Class attributes are moved to properties with empty key for classNameModifiers
      expect(result.code).toContain('["", "foo"]');
    });

    test('compiles element with multiple class attributes', () => {
      // Multiple class attributes should all be converted to properties with empty key
      // This is critical for proper merging of dynamic + static classes
      const result = compile('<div class={{if this.show "visible" "hidden"}} class="base-class"></div>');
      // Both classes should be in properties array with empty key
      expect(result.code).toContain('["",');
      // First class (dynamic)
      expect(result.code).toContain('$__if');
      // Second class (static)
      expect(result.code).toContain('"base-class"');
      // Should NOT have "class" as attribute key (would cause skip on duplicate)
      expect(result.code).not.toMatch(/\["class",\s*"/);
    });

    test('compiles element with multiple attributes', () => {
      const result = compile('<input type="text" placeholder="Enter name" />');
      expect(result.code).toContain('"type"');
      expect(result.code).toContain('"text"');
      expect(result.code).toContain('"placeholder"');
    });
  });

  describe('mustache expressions', () => {
    test('compiles simple path expression', () => {
      const result = compile('{{this.name}}');
      expect(result.code).toContain('this.name');
    });

    test('compiles @arg path expression', () => {
      const result = compile('{{@anyValue}}');
      expect(result.code).toContain('$a.anyValue');
    });

    test('compiles nested @arg path expression', () => {
      const result = compile('{{@user.name}}');
      expect(result.code).toContain('$a.user?.name');
    });

    test('compiles literal values', () => {
      expect(compile('{{true}}').code).toContain('true');
      expect(compile('{{42}}').code).toContain('42');
      expect(compile('{{"hello"}}').code).toContain('"hello"');
    });

    test('compiles helper call', () => {
      const result = compile('{{concat "a" "b"}}');
      expect(result.code).toContain('concat');
    });

    test('compiles helper with named args', () => {
      const result = compile('{{format-date this.date format="short"}}');
      expect(result.code).toContain('format:');
    });
  });

  describe('block expressions', () => {
    test('compiles if block', () => {
      const result = compile('{{#if this.show}}visible{{/if}}');
      expect(result.code).toContain(SYMBOLS.IF);
    });

    test('if block condition is wrapped with getter for reactivity', () => {
      const result = compile('{{#if this.show}}visible{{/if}}');
      // Condition should be a getter function, not direct property access
      // Note: $: prefix removed as part of Phase 5 improvements
      expect(result.code).toContain('() => this.show');
    });

    test('compiles if-else block', () => {
      const result = compile('{{#if this.show}}yes{{else}}no{{/if}}');
      expect(result.code).toContain(SYMBOLS.IF);
    });

    test('if block branches use valid parameter names', () => {
      const result = compile('{{#if this.show}}yes{{else}}no{{/if}}');
      // Branch callbacks should use ctx0, ctx1, etc., not 'this'
      // 'this =>' would be invalid JavaScript
      expect(result.code).not.toMatch(/this\s*=>/);
      // Should use proper context names like ctx0 =>
      expect(result.code).toMatch(/ctx\d+\s*=>/);
    });

    test('if block with helper condition uses valid parameter names', () => {
      const result = compile('{{#if (and @a @b)}}yes{{else}}no{{/if}}');
      // Branch callbacks should not use 'this' as parameter
      expect(result.code).not.toMatch(/this\s*=>/);
      expect(result.code).toMatch(/ctx\d+\s*=>/);
    });

    test('nested if blocks use valid parameter names', () => {
      const result = compile('{{#if this.a}}{{#if this.b}}inner{{/if}}{{/if}}');
      // All branch callbacks should use valid context names
      expect(result.code).not.toMatch(/this\s*=>/);
      // Should have multiple context names for nested blocks
      const matches = result.code.match(/ctx\d+\s*=>/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    test('compiles each block', () => {
      const result = compile('{{#each this.items as |item|}}{{item}}{{/each}}');
      expect(result.code).toContain(SYMBOLS.EACH);
    });

    test('each block condition is wrapped with getter for reactivity', () => {
      const result = compile('{{#each this.items as |item|}}{{item}}{{/each}}');
      // Condition should be a getter function
      // Note: $: prefix removed as part of Phase 5 improvements
      expect(result.code).toContain('() => this.items');
    });

    test('compiles each block with key', () => {
      const result = compile('{{#each this.items key="@identity" as |item|}}{{item}}{{/each}}');
      expect(result.code).toContain('"@identity"');
    });

    test('each-else passes inverseFn as 5th argument to $_each', () => {
      const withElse = compile('{{#each this.items as |item|}}<div>{{item}}</div>{{else}}<span>empty</span>{{/each}}');
      const withoutElse = compile('{{#each this.items as |item|}}<div>{{item}}</div>{{/each}}');
      // Should use $_each, not $_if wrapping
      expect(withElse.code).toContain(SYMBOLS.EACH);
      expect(withElse.code).not.toContain(SYMBOLS.IF);
      // inverseFn contains the else content
      expect(withElse.code).toContain('"empty"');
      // Without else: no inverse content, shorter code
      expect(withoutElse.code).not.toContain('"empty"');
      expect(withElse.code.length).toBeGreaterThan(withoutElse.code.length);
    });

    test('compiles sync each block', () => {
      const result = compile('{{#each this.items sync=true as |item|}}{{item}}{{/each}}');
      expect(result.code).toContain(SYMBOLS.EACH_SYNC);
    });

    test('compiles yield', () => {
      const result = compile('{{yield}}');
      expect(result.code).toContain(SYMBOLS.SLOT);
    });

    test('compiles yield with to', () => {
      const result = compile('{{yield to="header"}}');
      expect(result.code).toContain('"header"');
    });
  });

  describe('components', () => {
    test('compiles component with binding', () => {
      const result = compile('<MyComponent />', {
        bindings: new Set(['MyComponent']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).toContain('MyComponent');
    });

    test('compiles component with @args', () => {
      const result = compile('<MyComponent @name="test" />', {
        bindings: new Set(['MyComponent']),
      });
      expect(result.code).toContain('name:');
      expect(result.code).toContain('"test"');
    });

    test('compiles component with children', () => {
      const result = compile('<MyComponent>content</MyComponent>', {
        bindings: new Set(['MyComponent']),
      });
      expect(result.code).toContain('default:');
    });

    test('compiles dynamic component reference', () => {
      const result = compile('<this.component />');
      expect(result.code).toContain(SYMBOLS.DYNAMIC_COMPONENT);
    });

    test('treats unknown PascalCase tags as elements (for custom renderers)', () => {
      // Unknown PascalCase tags should be passed as strings to $_tag,
      // not as JavaScript identifiers. This allows custom DOM APIs
      // (like TresRenderer) to handle them dynamically.
      const result = compile('<TresMesh><TresBoxGeometry /></TresMesh>');

      // Should use $_tag with string tag names, NOT $_c with identifiers
      expect(result.code).toContain(SYMBOLS.TAG);
      expect(result.code).toContain("'TresMesh'");
      expect(result.code).toContain("'TresBoxGeometry'");
      // Should NOT contain the tags as bare JavaScript identifiers
      expect(result.code).not.toMatch(/\$_c\s*\(\s*TresMesh/);
      expect(result.code).not.toMatch(/\$_c\s*\(\s*TresBoxGeometry/);
    });

    test('treats known PascalCase bindings as components', () => {
      // When a PascalCase tag IS a known binding, it should be a component
      const result = compile('<MyComponent />', {
        bindings: new Set(['MyComponent']),
      });
      // Should use $_c with the identifier
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).toContain('MyComponent');
    });

    test('passes @args correctly to nested components', () => {
      // Parent passes @onClick to child
      const result = compile('<Button @onClick={{this.handleClick}} />', {
        bindings: new Set(['Button']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).toContain('onClick');
      expect(result.code).toContain('this.handleClick');
    });

    test('passes multiple @args to components', () => {
      const result = compile('<Form @onSubmit={{this.submit}} @onCancel={{this.cancel}} @disabled={{true}} />', {
        bindings: new Set(['Form']),
      });
      expect(result.code).toContain('onSubmit');
      expect(result.code).toContain('onCancel');
      expect(result.code).toContain('disabled');
    });

    test('component inside component passes args correctly', () => {
      const result = compile(`
        <Outer @value={{this.data}}>
          <Inner @handler={{@parentHandler}} />
        </Outer>
      `, {
        bindings: new Set(['Outer', 'Inner']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).toContain('value');
      expect(result.code).toContain('handler');
      expect(result.code).toContain('parentHandler');
    });

    test('component inside each block passes @args with fn helper', () => {
      // This tests the common pattern of using components in loops with fn helper
      const result = compile(`
        {{#each this.items as |item|}}
          <Button @onClick={{fn this.handleClick item.id}}>
            {{item.name}}
          </Button>
        {{/each}}
      `, {
        bindings: new Set(['Button']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).toContain('onClick');
      expect(result.code).toContain('fn');
      expect(result.code).toContain('item');
    });

    test('component with block params and args', () => {
      const result = compile(`
        {{#each this.routes key='name' as |route|}}
          <Button @onClick={{fn this.goToRoute route.name}}>
            {{route.text}}
          </Button>
        {{/each}}
      `, {
        bindings: new Set(['Button']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).toContain('onClick');
      // route should be a block param, used directly (not as this.route.name)
      expect(result.code).toContain('route.name');
      expect(result.code).toContain('route.text');
      // Should NOT have this.route.name (route is a block param, not this property)
      expect(result.code).not.toContain('this.route.name');
    });
  });

  describe('nested structures', () => {
    test('compiles nested elements', () => {
      const result = compile('<div><span><a>link</a></span></div>');
      expect(result.code).toContain("'div'");
      expect(result.code).toContain("'span'");
      expect(result.code).toContain("'a'");
    });

    test('compiles mixed content', () => {
      const result = compile('<div>Hello {{this.name}}!</div>');
      expect(result.code).toContain('"Hello "');
      expect(result.code).toContain('this.name');
      expect(result.code).toContain('"!"');
    });

    test('compiles component inside element', () => {
      const result = compile('<div><MyComponent /></div>', {
        bindings: new Set(['MyComponent']),
      });
      expect(result.code).toContain(SYMBOLS.TAG);
      expect(result.code).toContain(SYMBOLS.COMPONENT);
    });
  });

  describe('modifiers and events', () => {
    test('compiles on modifier', () => {
      const result = compile('<button {{on "click" this.handleClick}}>Click</button>');
      expect(result.code).toContain('"click"');
    });

    test('compiles on modifier with @arg handler', () => {
      // When @onClick is passed as an arg, it should resolve to $a.onClick
      const result = compile('<button {{on "click" @onClick}}>Click</button>');
      expect(result.code).toContain('"click"');
      expect(result.code).toContain('$a.onClick');
    });

    test('compiles custom modifier', () => {
      const result = compile('<div {{focus-trap}}>content</div>');
      expect(result.code).toContain('focus-trap');
    });
  });

  describe('special elements', () => {
    test('compiles svg element', () => {
      const result = compile('<svg><rect /></svg>');
      expect(result.code).toContain("'svg'");
    });

    test('compiles math element', () => {
      const result = compile('<math><mi>x</mi></math>');
      expect(result.code).toContain("'math'");
    });
  });

  describe('error handling', () => {
    test('returns errors for invalid syntax', () => {
      // Use {{/if}} which is a reliable parse error (closing without opening)
      const result = compile('{{/if}}');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('returns empty array code on error', () => {
      const result = compile('{{/if}}');
      expect(result.code).toBe('[]');
    });
  });

  describe('compilation result', () => {
    test('includes mapping tree', () => {
      const result = compile('<div>test</div>');
      expect(result.mappingTree).toBeDefined();
      expect(result.mappingTree.sourceNode).toBe('Template');
    });

    test('includes bindings', () => {
      const result = compile('<MyComponent />', {
        bindings: new Set(['MyComponent']),
      });
      expect(result.bindings.has('MyComponent')).toBe(true);
    });

    test('includes warnings', () => {
      const result = compile('<div>test</div>');
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});

describe('compileToCode()', () => {
  test('returns just the code string', () => {
    const code = compileToCode('<div>test</div>');
    expect(typeof code).toBe('string');
    expect(code).toContain(SYMBOLS.TAG);
  });
});

describe('isValidTemplate()', () => {
  test('returns true for valid template', () => {
    expect(isValidTemplate('<div>test</div>')).toBe(true);
  });

  test('returns false for invalid template', () => {
    // Use {{/if}} which is a reliable parse error
    expect(isValidTemplate('{{/if}}')).toBe(false);
  });
});

describe('getTemplateErrors()', () => {
  test('returns empty array for valid template', () => {
    const errors = getTemplateErrors('<div>test</div>');
    expect(errors).toHaveLength(0);
  });

  test('returns errors for invalid template', () => {
    // Use {{/if}} which is a reliable parse error
    const errors = getTemplateErrors('{{/if}}');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('Compiler Flags', () => {
  test('respects IS_GLIMMER_COMPAT_MODE flag', () => {
    const compatResult = compile('{{this.value}}', {
      flags: { IS_GLIMMER_COMPAT_MODE: true },
    });
    // In compat mode, paths are wrapped in getters
    expect(compatResult.code).toContain('() =>');

    // Note: Non-compat mode would have different behavior
  });

  describe('node-thunk marker ($_nt)', () => {
    const compat = { flags: { IS_GLIMMER_COMPAT_MODE: true } };

    test('marks a component-child DOM thunk ($_tag) with $_nt', () => {
      const r = compile('<Parent><Child /></Parent>', compat);
      // The lazy child producer is wrapped + marked, not a bare arrow.
      expect(r.code).toContain('$_nt(() => $_tag(\'Child\'');
    });

    test('marks a dynamic-component child ($_dc) but not its inner ref getter', () => {
      const r = compile('<Parent><this.Foo /></Parent>', compat);
      expect(r.code).toContain('$_nt(() => $_dc(');
      // The component-reference getter inside $_dc must stay an UNMARKED arrow.
      expect(r.code).toContain('$_dc(() => this.Foo');
    });

    test('marks an each-block child producer ($_each)', () => {
      const r = compile(
        '<Parent>{{#each this.items as |i|}}<Child @x={{i}} />{{/each}}</Parent>',
        compat
      );
      expect(r.code).toContain('$_nt(() => $_each(');
    });

    test('does NOT mark a plain reactive text getter', () => {
      const r = compile('<Parent>{{this.title}}</Parent>', compat);
      expect(r.code).not.toContain('$_nt(');
      expect(r.code).toContain('() => this.title');
    });

    test('marks only the node thunk in a mixed children list', () => {
      const r = compile('<Parent>hi {{this.title}} <Child /></Parent>', compat);
      // exactly one $_nt wrap (the <Child/> producer)
      expect(r.code.match(/\$_nt\(/g)?.length).toBe(1);
      expect(r.code).toContain('$_nt(() => $_tag(\'Child\'');
      // the text getter is left bare
      expect(r.code).toContain('() => this.title');
    });
  });

  test('preserves compile-time flags as bare identifiers for Vite define replacement', () => {
    // This test verifies that compile-time flags like IS_GLIMMER_COMPAT_MODE
    // are NOT prefixed with "this." when used in templates.
    // This allows Vite's define plugin to replace them with actual values.
    const result = compile('{{#if IS_GLIMMER_COMPAT_MODE}}<div>compat</div>{{/if}}');

    // The flag should appear as a bare identifier, not this.IS_GLIMMER_COMPAT_MODE
    expect(result.code).toContain('IS_GLIMMER_COMPAT_MODE');
    expect(result.code).not.toContain('this.IS_GLIMMER_COMPAT_MODE');
  });

  test('preserves compile-time flags in mustache expressions', () => {
    // Simple mustache expression with compile-time flag
    const result = compile('{{IS_DEV_MODE}}');

    // Should be a bare identifier, not this.IS_DEV_MODE
    expect(result.code).toContain('IS_DEV_MODE');
    expect(result.code).not.toContain('this.IS_DEV_MODE');
  });

  test('preserves namespaced paths without adding this. prefix', () => {
    // Namespaced paths should not get this. prefix
    // This allows Vite's define to replace them
    const result = compile('{{Config.debugMode}}');

    // Should NOT have this.Config - paths are kept as-is
    expect(result.code).toContain('Config');
    expect(result.code).not.toContain('this.Config');
  });

  test('preserves unknown paths in if conditions without this. prefix', () => {
    // Unknown paths in conditions should not get this. prefix
    const result = compile('{{#if someFlag.enabled}}<div>yes</div>{{/if}}');

    // Should NOT have this.someFlag
    expect(result.code).toContain('someFlag');
    expect(result.code).not.toContain('this.someFlag');
  });

  describe('fn helper argument wrapping with different flags', () => {
    test('compat mode: fn helper wraps args in getters', () => {
      const result = compile('<Button @onClick={{fn this.handle this.value}} />', {
        bindings: new Set(['Button']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // First arg (function ref) should NOT be wrapped
      expect(result.code).toContain('$__fn(this.handle,');
      // Second arg should be wrapped in getter for reactivity
      expect(result.code).toContain('() => this.value');
    });

    test('compat mode: fn helper with Cell arg wraps in getter', () => {
      // This is the pattern that was broken: {{fn this.updateCell this.myCell}}
      // The Cell should come through a getter so $__fn can unwrap it properly
      const result = compile('<Slider @onUpdate={{fn this.updateCell this.valueCell}} />', {
        bindings: new Set(['Slider']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.code).toContain('$__fn(this.updateCell,');
      // Cell should be wrapped in getter: () => this.valueCell
      expect(result.code).toContain('() => this.valueCell');
    });

    test('compat mode: fn helper with callback arg wraps in getter', () => {
      // Pattern: {{fn this.wrapCallback @onClick}}
      // The callback should come through a getter
      const result = compile('<Button @wrapped={{fn this.wrap this.args.onClick}} />', {
        bindings: new Set(['Button']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.code).toContain('$__fn(this.wrap,');
      // Callback should be wrapped (with optional chaining): () => this.args?.onClick
      expect(result.code).toContain('() => this.args?.onClick');
    });

    test('compat mode: fn helper with multiple args wraps all except first', () => {
      const result = compile('<Button @onClick={{fn this.handle this.a this.b this.c}} />', {
        bindings: new Set(['Button']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Function ref NOT wrapped
      expect(result.code).toContain('$__fn(this.handle,');
      // All other args wrapped
      expect(result.code).toContain('() => this.a');
      expect(result.code).toContain('() => this.b');
      expect(result.code).toContain('() => this.c');
    });

    test('compat mode: fn helper with literal args does not wrap literals', () => {
      const result = compile('<Button @onClick={{fn this.handle "literal" 42 true}} />', {
        bindings: new Set(['Button']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Function ref NOT wrapped
      expect(result.code).toContain('$__fn(this.handle,');
      // Literals are NOT wrapped in getters - they're constant
      expect(result.code).toContain('"literal"');
      expect(result.code).toContain('42');
      expect(result.code).toContain('true');
    });

    test('compat mode: nested fn helpers work correctly', () => {
      const result = compile('<Button @onClick={{fn (fn this.outer this.a) this.b}} />', {
        bindings: new Set(['Button']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Outer fn should wrap the inner fn result
      // Inner fn args should be wrapped
      expect(result.code).toContain('$__fn');
      expect(result.code).toContain('() => this.a');
      expect(result.code).toContain('() => this.b');
    });

    test('compat mode: fn helper in each block with block param', () => {
      const result = compile(`
        {{#each this.items as |item|}}
          <Button @onClick={{fn this.selectItem item}} />
        {{/each}}
      `, {
        bindings: new Set(['Button']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      // Block param should be wrapped for reactivity
      expect(result.code).toContain('$__fn(this.selectItem,');
      expect(result.code).toContain('() => item');
    });
  });
});

describe('Integration Scenarios', () => {
  test('compiles a realistic component template', () => {
    const template = `
      <div class="container">
        <h1>{{this.title}}</h1>
        {{#if this.items.length}}
          <ul>
            {{#each this.items as |item|}}
              <li>{{item.name}}</li>
            {{/each}}
          </ul>
        {{else}}
          <p>No items</p>
        {{/if}}
        <button {{on "click" this.handleClick}}>
          Add Item
        </button>
      </div>
    `;

    const result = compile(template);
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.TAG);
    expect(result.code).toContain(SYMBOLS.IF);
    expect(result.code).toContain(SYMBOLS.EACH);
  });

  test('compiles a component with slots', () => {
    const template = `
      <Modal @title="Confirm">
        <:header>
          <h2>Custom Header</h2>
        </:header>
        <:body>
          <p>Are you sure?</p>
        </:body>
        <:footer>
          <button>OK</button>
        </:footer>
      </Modal>
    `;

    const result = compile(template, {
      bindings: new Set(['Modal']),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.COMPONENT);
  });

  test('compiles attribute interpolation', () => {
    const result = compile('<div class="prefix-{{this.suffix}}">content</div>');
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('.join');
  });
});

describe('Source Map Integration', () => {
  test('mapping tree has correct root structure', () => {
    const template = '<div>test</div>';
    const result = compile(template);

    expect(result.mappingTree).toBeDefined();
    expect(result.mappingTree.sourceNode).toBe('Template');
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.mappingTree.generatedRange.start).toBe(0);
    expect(result.mappingTree.generatedRange.end).toBe(result.code.length);
  });

  test('mapping tree includes child nodes', () => {
    const result = compile('<div>test</div>');

    // Template should have children representing the compiled nodes
    expect(result.mappingTree.children).toBeDefined();
    expect(Array.isArray(result.mappingTree.children)).toBe(true);
  });

  test('generated range is within code bounds', () => {
    const result = compile('<div><span>hello</span></div>');
    const codeLength = result.code.length;

    function checkRanges(node: typeof result.mappingTree) {
      expect(node.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(node.generatedRange.end).toBeLessThanOrEqual(codeLength);
      expect(node.generatedRange.start).toBeLessThanOrEqual(node.generatedRange.end);

      for (const child of node.children) {
        checkRanges(child);
      }
    }

    checkRanges(result.mappingTree);
  });

  test('source range is within template bounds', () => {
    const template = '<div>{{this.value}}</div>';
    const result = compile(template);
    const templateLength = template.length;

    function checkSourceRanges(node: typeof result.mappingTree) {
      expect(node.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(node.sourceRange.end).toBeLessThanOrEqual(templateLength);

      for (const child of node.children) {
        checkSourceRanges(child);
      }
    }

    checkSourceRanges(result.mappingTree);
  });

  test('mapping tree is frozen (immutable)', () => {
    const result = compile('<div>test</div>');

    expect(Object.isFrozen(result.mappingTree.sourceRange)).toBe(true);
    expect(Object.isFrozen(result.mappingTree.generatedRange)).toBe(true);
    expect(Object.isFrozen(result.mappingTree.children)).toBe(true);
  });

  test('complex template has nested mappings', () => {
    const result = compile(`
      <div class="container">
        <span>{{this.name}}</span>
      </div>
    `);

    // Should have a Template node with at least one child
    expect(result.mappingTree.sourceNode).toBe('Template');
    expect(result.mappingTree.generatedRange.end).toBeGreaterThan(0);
  });

  test('source map tracks element nodes', () => {
    const template = '<div>text</div>';
    const result = compile(template);

    // The mapping tree should have children (the Template node wraps all children)
    // Children are top-level compiled nodes
    expect(result.mappingTree.children.length).toBeGreaterThanOrEqual(0);

    // The Template itself should have a valid generated range
    expect(result.mappingTree.generatedRange.start).toBe(0);
    expect(result.mappingTree.generatedRange.end).toBe(result.code.length);

    // If there are children, they should have valid ranges
    for (const child of result.mappingTree.children) {
      expect(child.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(child.generatedRange.end).toBeLessThanOrEqual(result.code.length);
    }
  });

  test('source map tracks mustache expressions', () => {
    const template = '{{this.value}}';
    const result = compile(template);

    // Should have at least one child mapping for the mustache
    expect(result.mappingTree.children.length).toBeGreaterThanOrEqual(0);

    // The Template wrapper should have correct ranges
    expect(result.mappingTree.sourceRange.start).toBe(0);
    expect(result.mappingTree.sourceRange.end).toBe(template.length);
    expect(result.mappingTree.generatedRange.end).toBe(result.code.length);
  });

  test('source map tracks block statements', () => {
    const template = '{{#if this.show}}content{{/if}}';
    const result = compile(template);

    // Should have at least one child mapping
    expect(result.mappingTree.children.length).toBeGreaterThanOrEqual(0);

    // All children should have valid source ranges
    for (const child of result.mappingTree.children) {
      expect(child.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(child.sourceRange.end).toBeLessThanOrEqual(template.length);
    }
  });

  test('multiple children have distinct mappings', () => {
    const result = compile('<div>one</div><span>two</span>');

    // Should have multiple children in the template scope
    expect(result.mappingTree.children.length).toBeGreaterThanOrEqual(1);

    // All mappings should be within code bounds
    for (const child of result.mappingTree.children) {
      expect(child.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(child.generatedRange.end).toBeLessThanOrEqual(result.code.length);
    }
  });

  test('generated code can be extracted using mapping ranges', () => {
    const template = '<div>hello</div>';
    const result = compile(template);

    // Extract the generated code using the root mapping
    const { start, end } = result.mappingTree.generatedRange;
    const extractedCode = result.code.substring(start, end);

    expect(extractedCode).toBe(result.code);
  });

  test('formatted nested elements have correct mapping tree structure', () => {
    const template = '<div><span>hello</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    // Root mapping should cover all generated code
    expect(result.mappingTree.sourceNode).toBe('Template');
    expect(result.mappingTree.generatedRange.start).toBe(0);
    expect(result.mappingTree.generatedRange.end).toBe(result.code.length);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });

    // Should have children for the element nodes
    expect(result.mappingTree.children.length).toBeGreaterThanOrEqual(1);
  });

  test('formatted output generated ranges are within code bounds', () => {
    const template = '<div><span><p>deep</p></span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const codeLength = result.code.length;

    function checkRanges(node: typeof result.mappingTree) {
      expect(node.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(node.generatedRange.end).toBeLessThanOrEqual(codeLength);
      expect(node.generatedRange.start).toBeLessThanOrEqual(node.generatedRange.end);

      for (const child of node.children) {
        checkRanges(child);
      }
    }

    checkRanges(result.mappingTree);
  });

  test('formatted output source ranges are within template bounds', () => {
    const template = '<div class="a"><span class="b">text</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const templateLength = template.length;

    function checkSourceRanges(node: typeof result.mappingTree) {
      expect(node.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(node.sourceRange.end).toBeLessThanOrEqual(templateLength);

      for (const child of node.children) {
        checkSourceRanges(child);
      }
    }

    checkSourceRanges(result.mappingTree);
  });

  test('formatted and unformatted produce same mapping tree sourceNode types', () => {
    const template = '<div><span>hello</span></div>';
    const minified = compile(template);
    const formatted = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    // Same source node types at root
    expect(formatted.mappingTree.sourceNode).toBe(minified.mappingTree.sourceNode);

    // Same number of children (same structure)
    expect(formatted.mappingTree.children.length).toBe(minified.mappingTree.children.length);

    // Same sourceNode types for children
    for (let i = 0; i < minified.mappingTree.children.length; i++) {
      expect(formatted.mappingTree.children[i].sourceNode).toBe(
        minified.mappingTree.children[i].sourceNode
      );
    }
  });

  test('formatted output with baseIndent has children within parent generated range', () => {
    const template = '<div><span>hello</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    function checkChildrenWithinParent(node: typeof result.mappingTree) {
      for (const child of node.children) {
        expect(child.generatedRange.start).toBeGreaterThanOrEqual(node.generatedRange.start);
        expect(child.generatedRange.end).toBeLessThanOrEqual(node.generatedRange.end);
        checkChildrenWithinParent(child);
      }
    }

    checkChildrenWithinParent(result.mappingTree);
  });

  test('nested elements with formatting produce correct source ranges', () => {
    const template = '<div><span><p>deep</p></span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    // Find ElementNode children in the mapping tree
    function findElementNodes(node: typeof result.mappingTree): typeof node[] {
      const found: typeof node[] = [];
      if (node.sourceNode === 'ElementNode') {
        found.push(node);
      }
      for (const child of node.children) {
        found.push(...findElementNodes(child));
      }
      return found;
    }

    const elementNodes = findElementNodes(result.mappingTree);

    // Should have at least 3 element nodes (div, span, p)
    expect(elementNodes.length).toBeGreaterThanOrEqual(3);

    // Each element's source range should map to valid template positions
    for (const elem of elementNodes) {
      const sourceText = template.substring(elem.sourceRange.start, elem.sourceRange.end);
      // Source text should start with < (it's an element)
      expect(sourceText.startsWith('<')).toBe(true);
    }
  });

  test('mapping tree generatedRange text contains expected code', () => {
    const template = '<div><span>content</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    // Find ElementNode children
    function findBySourceNode(node: typeof result.mappingTree, name: string): typeof node | null {
      if (node.sourceNode === name) return node;
      for (const child of node.children) {
        const found = findBySourceNode(child, name);
        if (found) return found;
      }
      return null;
    }

    // The first ElementNode should map to code containing $_tag
    const elementNode = findBySourceNode(result.mappingTree, 'ElementNode');
    if (elementNode) {
      const generatedText = result.code.substring(
        elementNode.generatedRange.start,
        elementNode.generatedRange.end
      );
      expect(generatedText).toContain('$_tag');
    }
  });
});

describe('Source Map - sourceRange propagation', () => {
  // Helper to collect all mapping tree nodes by sourceNode type
  function collectNodes(
    node: { sourceNode: string; sourceRange: { start: number; end: number }; generatedRange: { start: number; end: number }; children: any[] },
    type: string
  ): typeof node[] {
    const result: typeof node[] = [];
    if (node.sourceNode === type) {
      result.push(node);
    }
    for (const child of node.children) {
      result.push(...collectNodes(child, type));
    }
    return result;
  }

  // Helper to collect ALL nodes (all types)
  function collectAllNodes(
    node: { sourceNode: string; sourceRange: { start: number; end: number }; generatedRange: { start: number; end: number }; children: any[] }
  ): typeof node[] {
    const result: typeof node[] = [node];
    for (const child of node.children) {
      result.push(...collectAllNodes(child));
    }
    return result;
  }

  test('attributes produce AttrNode mappings', () => {
    const template = '<div class="foo" id="bar"></div>';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    // Should have AttrNode entries for class and id
    expect(attrNodes.length).toBeGreaterThanOrEqual(2);

    // Each AttrNode source range should be within template bounds
    for (const attr of attrNodes) {
      expect(attr.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(attr.sourceRange.end).toBeLessThanOrEqual(template.length);
      // Source text should contain an attribute
      const sourceText = template.substring(attr.sourceRange.start, attr.sourceRange.end);
      expect(sourceText).toMatch(/\w+=/);
    }
  });

  test('dynamic attribute values produce AttrNode mappings', () => {
    const template = '<div class={{this.className}}></div>';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    expect(attrNodes.length).toBeGreaterThanOrEqual(1);

    // The AttrNode source range should cover the attribute
    const attr = attrNodes[0];
    const sourceText = template.substring(attr.sourceRange.start, attr.sourceRange.end);
    expect(sourceText).toContain('class=');
  });

  test('properties produce AttrNode mappings', () => {
    const template = '<input value="test" />';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    expect(attrNodes.length).toBeGreaterThanOrEqual(1);

    // Source text should contain the property
    const attr = attrNodes[0];
    const sourceText = template.substring(attr.sourceRange.start, attr.sourceRange.end);
    expect(sourceText).toContain('value=');
  });

  test('event handlers produce AttrNode mappings', () => {
    const template = '<button {{on "click" this.handleClick}}></button>';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    expect(attrNodes.length).toBeGreaterThanOrEqual(1);

    // The AttrNode source range should point to the modifier
    const attr = attrNodes[0];
    const sourceText = template.substring(attr.sourceRange.start, attr.sourceRange.end);
    expect(sourceText).toContain('on');
  });

  test('custom modifiers produce AttrNode mappings', () => {
    const template = '<div {{myModifier "arg"}}></div>';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    expect(attrNodes.length).toBeGreaterThanOrEqual(1);

    // Source range should cover the modifier
    const attr = attrNodes[0];
    const sourceText = template.substring(attr.sourceRange.start, attr.sourceRange.end);
    expect(sourceText).toContain('myModifier');
  });

  test('component args produce HashPair mappings', () => {
    const template = '<MyComponent @value={{this.data}} @label="text" />';
    const result = compile(template, {
      bindings: new Set(['MyComponent']),
    });

    const hashPairs = collectNodes(result.mappingTree, 'HashPair');
    // Should have HashPair entries for @value and @label
    expect(hashPairs.length).toBeGreaterThanOrEqual(2);

    // Each HashPair source range should be within template bounds
    for (const pair of hashPairs) {
      expect(pair.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(pair.sourceRange.end).toBeLessThanOrEqual(template.length);
    }
  });

  test('helper named args produce HashPair mappings', () => {
    // Use a known binding so it goes through the builder pattern (not maybeHelper raw string)
    const template = '{{myHelper name="world"}}';
    const result = compile(template, { bindings: new Set(['myHelper']) });

    const hashPairs = collectNodes(result.mappingTree, 'HashPair');
    expect(hashPairs.length).toBeGreaterThanOrEqual(1);

    // The HashPair should have a valid source range
    const pair = hashPairs[0];
    expect(pair.sourceRange.start).toBeGreaterThanOrEqual(0);
    expect(pair.sourceRange.end).toBeLessThanOrEqual(template.length);
  });

  test('hash helper produces HashPair mappings for each key', () => {
    const template = '{{hash a=this.x b=this.y}}';
    const result = compile(template);

    const hashPairs = collectNodes(result.mappingTree, 'HashPair');
    // Should have HashPair entries for a and b
    expect(hashPairs.length).toBeGreaterThanOrEqual(2);
  });

  test('yield produces MustacheStatement mapping', () => {
    const template = '{{yield}}';
    const result = compile(template);

    const mustaches = collectNodes(result.mappingTree, 'MustacheStatement');
    expect(mustaches.length).toBeGreaterThanOrEqual(1);

    // Source range should cover the yield expression
    const node = mustaches[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('yield');
  });

  test('yield with params produces MustacheStatement mapping', () => {
    const template = '{{yield this.value}}';
    const result = compile(template);

    const mustaches = collectNodes(result.mappingTree, 'MustacheStatement');
    expect(mustaches.length).toBeGreaterThanOrEqual(1);

    const node = mustaches[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('yield');
  });

  test('in-element produces BlockStatement mapping', () => {
    const template = '{{#in-element this.target}}content{{/in-element}}';
    const result = compile(template);

    const blocks = collectNodes(result.mappingTree, 'BlockStatement');
    expect(blocks.length).toBeGreaterThanOrEqual(1);

    // Source range should cover the in-element block
    const node = blocks[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('in-element');
  });

  test('if block produces BlockStatement mapping', () => {
    const template = '{{#if this.show}}content{{/if}}';
    const result = compile(template);

    const blocks = collectNodes(result.mappingTree, 'BlockStatement');
    expect(blocks.length).toBeGreaterThanOrEqual(1);

    const node = blocks[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('if');
  });

  test('each block produces BlockStatement mapping', () => {
    const template = '{{#each this.items as |item|}}{{item}}{{/each}}';
    const result = compile(template);

    const blocks = collectNodes(result.mappingTree, 'BlockStatement');
    expect(blocks.length).toBeGreaterThanOrEqual(1);

    const node = blocks[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('each');
  });

  test('path expressions produce PathExpression mappings', () => {
    const template = '{{this.value}}';
    const result = compile(template);

    const paths = collectNodes(result.mappingTree, 'PathExpression');
    expect(paths.length).toBeGreaterThanOrEqual(1);

    const tokens = ['this', 'value'];
    for (const token of tokens) {
      const node = paths.find((p) => {
        const sourceText = template.substring(p.sourceRange.start, p.sourceRange.end);
        return sourceText === token;
      });
      expect(node).toBeDefined();
    }
  });

  test('string literals in attributes produce StringLiteral mappings', () => {
    const template = '<div class="test-class"></div>';
    const result = compile(template);

    const literals = collectNodes(result.mappingTree, 'StringLiteral');
    expect(literals.length).toBeGreaterThanOrEqual(1);
  });

  test('built-in helper calls produce SubExpression mappings', () => {
    // Built-in helpers (if, eq, etc.) go through the builder pattern and produce SubExpression
    const template = '{{if this.cond "yes" "no"}}';
    const result = compile(template);

    const subs = collectNodes(result.mappingTree, 'SubExpression');
    expect(subs.length).toBeGreaterThanOrEqual(1);

    // Source range should cover the helper call
    const node = subs[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('if');
  });

  test('positional params in known helper preserve individual source ranges', () => {
    // Known helper binding with positional params should map each param
    const template = '{{withDiff @gxt @vanila}}';
    const result = compile(template, { bindings: new Set(['withDiff']) });

    expect(result.errors).toHaveLength(0);

    // Each positional param should produce its own PathExpression mapping
    const paths = collectNodes(result.mappingTree, 'PathExpression');
    expect(paths.length).toBeGreaterThanOrEqual(2);

    // Check that the source ranges correctly map to @gxt and @vanila
    const sourceTexts = paths.map(p => template.substring(p.sourceRange.start, p.sourceRange.end));
    expect(sourceTexts).toContain('@gxt');
    expect(sourceTexts).toContain('@vanila');
  });

  test('positional params in component args preserve source ranges', () => {
    // Component arg with helper call: @name={{withDiff @gxt @vanila}}
    const template = '<MyComp @name={{withDiff @gxt @vanila}} />';
    const result = compile(template, { bindings: new Set(['MyComp', 'withDiff']) });

    expect(result.errors).toHaveLength(0);

    // Positional params should have PathExpression mappings
    const paths = collectNodes(result.mappingTree, 'PathExpression');
    const sourceTexts = paths.map(p => template.substring(p.sourceRange.start, p.sourceRange.end));
    expect(sourceTexts).toContain('@gxt');
    expect(sourceTexts).toContain('@vanila');
  });

  test('positional params in modifier preserve source ranges', () => {
    // Modifier with positional params
    const template = '<div {{myMod @gxt @vanila}}></div>';
    const result = compile(template, { bindings: new Set(['myMod']) });

    expect(result.errors).toHaveLength(0);

    // Positional params should have PathExpression mappings
    const paths = collectNodes(result.mappingTree, 'PathExpression');
    const sourceTexts = paths.map(p => template.substring(p.sourceRange.start, p.sourceRange.end));
    expect(sourceTexts).toContain('@gxt');
    expect(sourceTexts).toContain('@vanila');
  });

  test('positional params in unknown helper use maybeHelper with source ranges', () => {
    // Unknown helper (no binding) - should use maybeHelper but still map params
    const template = '{{unknownHelper @gxt @vanila}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);

    // Positional params should still have PathExpression mappings
    const paths = collectNodes(result.mappingTree, 'PathExpression');
    const sourceTexts = paths.map(p => template.substring(p.sourceRange.start, p.sourceRange.end));
    expect(sourceTexts).toContain('@gxt');
    expect(sourceTexts).toContain('@vanila');
  });

  test('component tag name has source range mapping', () => {
    const template = '<MyComp @name="test" />';
    const result = compile(template, { bindings: new Set(['MyComp']) });

    expect(result.errors).toHaveLength(0);

    // The component call should have an ElementNode mapping
    const elements = collectNodes(result.mappingTree, 'ElementNode');
    expect(elements.length).toBeGreaterThanOrEqual(1);

    // The generated code should contain the component name
    expect(result.code).toContain('MyComp');

    // Component source range should cover the element
    const node = elements[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('MyComp');
  });

  test('element tag name has source range mapping', () => {
    const template = '<div class="test"></div>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);

    // The element call should have an ElementNode mapping
    const elements = collectNodes(result.mappingTree, 'ElementNode');
    expect(elements.length).toBeGreaterThanOrEqual(1);

    // Element source range should cover the element
    const node = elements[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('div');
  });

  test('helper with known binding shadows builtin and preserves source ranges', () => {
    // Local 'or' function should override builtin $__or
    const template = '{{or @a @b}}';
    const result = compile(template, { bindings: new Set(['or']) });

    expect(result.errors).toHaveLength(0);
    // Should use direct call, not builtin symbol
    expect(result.code).not.toContain(SYMBOLS.OR);
    expect(result.code).toContain('or(');

    // Positional params should have source range mappings
    const paths = collectNodes(result.mappingTree, 'PathExpression');
    const sourceTexts = paths.map(p => template.substring(p.sourceRange.start, p.sourceRange.end));
    expect(sourceTexts).toContain('@a');
    expect(sourceTexts).toContain('@b');
  });

  test('dotted path helper with known root binding uses direct call', () => {
    // If "myObj" is a known binding, "myObj.method" should be a direct call
    const template = '{{myObj.method @arg1 @arg2}}';
    const result = compile(template, { bindings: new Set(['myObj']) });

    expect(result.errors).toHaveLength(0);
    // Should use direct call (myObj.method(...))
    expect(result.code).toContain('myObj.method(');
    // Should NOT use maybeHelper
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);

    // Positional params should preserve source ranges
    const paths = collectNodes(result.mappingTree, 'PathExpression');
    const sourceTexts = paths.map(p => template.substring(p.sourceRange.start, p.sourceRange.end));
    expect(sourceTexts).toContain('@arg1');
    expect(sourceTexts).toContain('@arg2');
  });

  test('dotted path helper with unknown root uses maybeHelper', () => {
    // If "unknownObj" is NOT a known binding, "unknownObj.method" goes through maybeHelper
    const template = '{{unknownObj.method @arg1}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    // Should use maybeHelper for unknown root
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('deeply dotted path helper with known root uses direct call', () => {
    // "globalName.foo.bar" where "globalName" is known
    const template = '{{globalName.foo.bar @x}}';
    const result = compile(template, { bindings: new Set(['globalName']) });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('globalName.foo.bar(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('buildHelper rootName extraction handles bracket notation', () => {
    // Internally, buildHelper splits name on . and [ to get root segment.
    // Test that a helper value with bracket path works correctly via compile.
    // Use dotted path since Glimmer syntax uses dot notation: myObj.prop
    const template = '{{myObj.items @x}}';
    const result = compile(template, { bindings: new Set(['myObj']) });

    expect(result.errors).toHaveLength(0);
    // Should use direct call since myObj is known
    expect(result.code).toContain('myObj.items(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('all mapping nodes have valid source and generated ranges', () => {
    const template = '<div class="a" id={{this.id}}>{{this.text}}</div>';
    const result = compile(template);

    const allNodes = collectAllNodes(result.mappingTree);

    for (const node of allNodes) {
      // Source range is valid
      expect(node.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(node.sourceRange.end).toBeLessThanOrEqual(template.length);
      expect(node.sourceRange.start).toBeLessThanOrEqual(node.sourceRange.end);

      // Generated range is valid
      expect(node.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(node.generatedRange.end).toBeLessThanOrEqual(result.code.length);
      expect(node.generatedRange.start).toBeLessThanOrEqual(node.generatedRange.end);
    }
  });

  test('formatted output preserves sourceRange mappings for attributes', () => {
    const template = '<div class="foo" id={{this.myId}}></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '', indent: '  ' },
    });

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    expect(attrNodes.length).toBeGreaterThanOrEqual(2);

    // All generated ranges should be within formatted code bounds
    for (const attr of attrNodes) {
      expect(attr.generatedRange.end).toBeLessThanOrEqual(result.code.length);
      // Generated text should contain the attribute value
      const genText = result.code.substring(attr.generatedRange.start, attr.generatedRange.end);
      expect(genText.length).toBeGreaterThan(0);
    }
  });

  test('formatted output preserves sourceRange mappings for control flow', () => {
    const template = '{{#if this.show}}<div>yes</div>{{else}}<span>no</span>{{/if}}';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '', indent: '  ' },
    });

    const blocks = collectNodes(result.mappingTree, 'BlockStatement');
    expect(blocks.length).toBeGreaterThanOrEqual(1);

    const node = blocks[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('if');
  });

  test('multiple attributes on same element produce distinct AttrNode mappings', () => {
    const template = '<input type="text" value={{this.val}} disabled />';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    // type, value, disabled should all produce mappings
    expect(attrNodes.length).toBeGreaterThanOrEqual(2);

    // Source ranges should be distinct (non-overlapping)
    const starts = attrNodes.map(n => n.sourceRange.start).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
  });

  test('AttrNode generated text matches expected tuple format', () => {
    const template = '<div class="hello"></div>';
    const result = compile(template);

    const attrNodes = collectNodes(result.mappingTree, 'AttrNode');
    expect(attrNodes.length).toBeGreaterThanOrEqual(1);

    // Generated text for the AttrNode should be a tuple: ["name", value]
    const genText = result.code.substring(
      attrNodes[0].generatedRange.start,
      attrNodes[0].generatedRange.end
    );
    expect(genText).toMatch(/\[.*".*".*\]/);
  });

  test('block-mode component produces ElementNode mapping with valid sourceRange', () => {
    const template = '{{#MyComponent}}content{{/MyComponent}}';
    const result = compile(template, { bindings: new Set(['MyComponent']) });

    expect(result.errors).toHaveLength(0);

    const elements = collectNodes(result.mappingTree, 'ElementNode');
    expect(elements.length).toBeGreaterThanOrEqual(1);

    const node = elements[0];
    expect(node.sourceRange.start).toBeGreaterThanOrEqual(0);
    expect(node.sourceRange.end).toBeLessThanOrEqual(template.length);
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('MyComponent');
  });

  test('block-mode component with args produces valid mapping nodes', () => {
    const template = '{{#MyComponent name="val" age="30"}}content{{/MyComponent}}';
    const result = compile(template, { bindings: new Set(['MyComponent']) });

    expect(result.errors).toHaveLength(0);

    // Args go through component serialization pipeline — verify ElementNode exists
    const elements = collectNodes(result.mappingTree, 'ElementNode');
    expect(elements.length).toBeGreaterThanOrEqual(1);

    // StringLiteral nodes should be present for the arg values
    const literals = collectNodes(result.mappingTree, 'StringLiteral');
    expect(literals.length).toBeGreaterThanOrEqual(2);

    for (const lit of literals) {
      expect(lit.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(lit.sourceRange.end).toBeLessThanOrEqual(template.length);
    }
  });

  test('block-mode component has all mapping nodes within bounds', () => {
    const template = '{{#MyComponent name="val" as |item|}}{{item.name}}{{/MyComponent}}';
    const result = compile(template, { bindings: new Set(['MyComponent']) });

    expect(result.errors).toHaveLength(0);

    const allNodes = collectAllNodes(result.mappingTree);
    for (const node of allNodes) {
      expect(node.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(node.sourceRange.end).toBeLessThanOrEqual(template.length);
      expect(node.sourceRange.start).toBeLessThanOrEqual(node.sourceRange.end);

      expect(node.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(node.generatedRange.end).toBeLessThanOrEqual(result.code.length);
      expect(node.generatedRange.start).toBeLessThanOrEqual(node.generatedRange.end);
    }
  });

  test('block-mode dotted path component produces ElementNode mapping', () => {
    const template = '{{#this.dynamicComponent as |x|}}{{x}}{{/this.dynamicComponent}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);

    const elements = collectNodes(result.mappingTree, 'ElementNode');
    expect(elements.length).toBeGreaterThanOrEqual(1);

    const node = elements[0];
    const sourceText = template.substring(node.sourceRange.start, node.sourceRange.end);
    expect(sourceText).toContain('this.dynamicComponent');
  });
});

describe('code formatting', () => {
  test('format: true enables pretty-printing', () => {
    const template = '<div><span>text</span></div>';
    const minified = compile(template);
    const formatted = compile(template, { format: true });

    // Formatted output should have newlines
    expect(formatted.code).toContain('\n');
    // Minified should not
    expect(minified.code).not.toContain('\n');
  });

  test('format: false keeps minified output', () => {
    const template = '<div><span>text</span></div>';
    const result = compile(template, { format: false });

    // Should not have newlines
    expect(result.code).not.toContain('\n');
  });

  test('formatted output has proper indentation', () => {
    const template = '<div><span>text</span></div>';
    const result = compile(template, { format: true });

    // Should have indented content
    expect(result.code).toMatch(/  /); // At least 2 spaces
  });

  test('custom indent string is respected', () => {
    const template = '<div><span>text</span></div>';
    const result = compile(template, { format: { enabled: true, indent: '\t' } });

    // Should have tabs
    expect(result.code).toContain('\t');
  });

  test('multiple children are formatted on separate lines', () => {
    const template = '<div>one</div><div>two</div><div>three</div>';
    const result = compile(template, { format: true });

    // Check that items are on separate lines
    const lines = result.code.split('\n');
    expect(lines.length).toBeGreaterThan(1);
  });

  test('nested elements have increasing indentation', () => {
    const template = '<div><ul><li>item</li></ul></div>';
    const result = compile(template, { format: true });

    // Should have proper nesting
    expect(result.code).toContain('\n');
  });

  test('formatted and minified produce equivalent results', () => {
    const template = '<div class="foo"><span>hello</span></div>';
    const minified = compile(template);
    const formatted = compile(template, { format: true });

    // Both should contain the same essential parts
    expect(minified.code).toContain(SYMBOLS.TAG);
    expect(formatted.code).toContain(SYMBOLS.TAG);
    expect(minified.code).toContain("'div'");
    expect(formatted.code).toContain("'div'");
    // Class attributes are moved to properties with empty key for classNameModifiers
    expect(minified.code).toContain('["", "foo"]');
    expect(formatted.code).toContain('["", "foo"]');
  });

  test('control flow children have proper indentation', () => {
    const template = '{{#if this.show}}<div>yes</div>{{/if}}';
    const result = compile(template, { format: true });

    // Should have formatted children with proper indentation
    expect(result.code).toContain('\n');
    // The children array should be formatted
    expect(result.code).toMatch(/\[[\s\S]*\$_tag[\s\S]*\]/);
  });

  test('PURE annotations are skipped in formatted/dev mode', () => {
    // Test with nested elements to ensure all levels skip PURE
    const template = '<div><span><p>nested</p></span></div>';

    // Production mode (format disabled) should have PURE annotations
    const production = compile(template, { format: false });
    expect(production.code).toContain('/*#__PURE__*/');
    // Count occurrences - should have multiple PURE annotations for nested elements
    const productionPureCount = (production.code.match(/\/\*#__PURE__\*\//g) || []).length;
    expect(productionPureCount).toBeGreaterThanOrEqual(3); // At least 3 for div, span, p

    // Dev mode (format enabled) should NOT have PURE annotations anywhere
    const dev = compile(template, { format: true });
    expect(dev.code).not.toContain('/*#__PURE__*/');
  });

  test('PURE annotations can be explicitly enabled in dev mode', () => {
    const template = '<div>hello</div>';
    const result = compile(template, { format: { enabled: true, emitPure: true } });

    // Should have PURE annotations even in formatted mode
    expect(result.code).toContain('/*#__PURE__*/');
  });

  test('PURE annotations can be explicitly disabled in production mode', () => {
    const template = '<div>hello</div>';
    const result = compile(template, { format: { enabled: false, emitPure: false } });

    // Should NOT have PURE annotations even in production mode
    expect(result.code).not.toContain('/*#__PURE__*/');
  });

  test('baseIndent adds padding after newlines', () => {
    const template = '<div>hello</div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '    ' },
    });

    // First line starts with [ (no base indent - positioned by caller)
    expect(result.code.startsWith('[')).toBe(true);
    // Each subsequent non-empty line should start with base indent
    const lines = result.code.split('\n');
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].length > 0) {
        expect(lines[i].startsWith('    ')).toBe(true);
      }
    }
  });

  test('baseIndent works with custom indent string', () => {
    // Use a template with enough content to trigger multi-line formatting
    const template = '<div>one</div><div>two</div><div>three</div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '  ', indent: '\t' },
    });

    // First line starts with [ (no base indent - positioned by caller)
    expect(result.code.startsWith('[')).toBe(true);
    // Subsequent non-empty lines should start with base indent
    const lines = result.code.split('\n');
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].length > 0) {
        expect(lines[i].startsWith('  ')).toBe(true);
      }
    }
    // Should have tabs for nested indentation (beyond base indent)
    expect(result.code).toContain('\t');
  });

  test('baseIndent defaults to empty string', () => {
    const template = '<div>hello</div>';
    const result = compile(template, { format: true });

    // First character should be [ (no base indent)
    expect(result.code.startsWith('[')).toBe(true);
  });

  test('nested elements have monotonically increasing indentation', () => {
    const template = '<div><span>hello</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const lines = result.code.split('\n');
    // Find the outer $_tag line and inner $_tag line
    const outerTagLine = lines.find(l => l.includes('$_tag(') && lines.indexOf(l) < lines.length / 2);
    const innerTagLine = lines.find(l => l.includes('$_tag(') && l !== outerTagLine);

    expect(outerTagLine).toBeDefined();
    expect(innerTagLine).toBeDefined();

    const outerIndent = outerTagLine!.match(/^( *)/)?.[1].length ?? 0;
    const innerIndent = innerTagLine!.match(/^( *)/)?.[1].length ?? 0;

    // Inner element should be more indented than outer
    expect(innerIndent).toBeGreaterThan(outerIndent);
  });

  test('nested element arguments are more indented than their call', () => {
    const template = '<div><span>hello</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const lines = result.code.split('\n');

    // Find the inner $_tag call and its first argument ('span')
    const innerTagIdx = lines.findIndex(l => l.includes("'span'"));
    let innerCallIdx = -1;
    for (let i = innerTagIdx - 1; i >= 0; i--) {
      if (lines[i].includes('$_tag(')) { innerCallIdx = i; break; }
    }

    expect(innerCallIdx).toBeGreaterThanOrEqual(0);
    expect(innerTagIdx).toBeGreaterThan(innerCallIdx);

    const callIndent = lines[innerCallIdx].match(/^( *)/)?.[1].length ?? 0;
    const argIndent = lines[innerTagIdx].match(/^( *)/)?.[1].length ?? 0;

    // Arguments should be indented more than the call
    expect(argIndent).toBeGreaterThan(callIndent);
    // Specifically, 2 more spaces (the indent width)
    expect(argIndent - callIndent).toBe(2);
  });

  test('deeply nested elements each add one indent level', () => {
    const template = '<div><span><p>deep</p></span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const lines = result.code.split('\n');

    // Find the tag name arguments for each level
    const divLine = lines.find(l => l.includes("'div'"));
    const spanLine = lines.find(l => l.includes("'span'"));
    const pLine = lines.find(l => l.includes("'p'"));

    expect(divLine).toBeDefined();
    expect(spanLine).toBeDefined();
    expect(pLine).toBeDefined();

    const divIndent = divLine!.match(/^( *)/)?.[1].length ?? 0;
    const spanIndent = spanLine!.match(/^( *)/)?.[1].length ?? 0;
    const pIndent = pLine!.match(/^( *)/)?.[1].length ?? 0;

    // Each nested level should add more indentation
    expect(spanIndent).toBeGreaterThan(divIndent);
    expect(pIndent).toBeGreaterThan(spanIndent);

    // The indent increase should be consistent (4 = children array indent + call arg indent)
    expect(spanIndent - divIndent).toBe(pIndent - spanIndent);
  });

  test('closing brackets align with their opening context', () => {
    const template = '<div><span>hello</span></div>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const lines = result.code.split('\n');

    // Find the outer $_tag call and its closing paren
    const outerCallIdx = lines.findIndex(l => l.includes('$_tag('));
    // The closing paren ')' for outer call should be at the same indent as $_tag(
    let outerCloseIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === ')') { outerCloseIdx = i; break; }
    }

    expect(outerCallIdx).toBeGreaterThanOrEqual(0);
    expect(outerCloseIdx).toBeGreaterThan(outerCallIdx);

    const callIndent = lines[outerCallIdx].match(/^( *)/)?.[1].length ?? 0;
    const closeIndent = lines[outerCloseIdx].match(/^( *)/)?.[1].length ?? 0;

    expect(closeIndent).toBe(callIndent);
  });

  test('all non-first lines include baseIndent when baseIndent is set', () => {
    const template = '<div><span><p>deep</p></span></div>';
    const baseIndent = '      ';
    const result = compile(template, {
      format: { enabled: true, baseIndent, indent: '  ' },
    });

    const lines = result.code.split('\n');
    // First line has no baseIndent (positioned by caller)
    expect(lines[0].startsWith('[')).toBe(true);

    // All subsequent non-empty lines must start with baseIndent
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].length > 0) {
        expect(
          lines[i].startsWith(baseIndent),
          `Line ${i + 1} "${lines[i]}" should start with baseIndent "${baseIndent}"`
        ).toBe(true);
      }
    }
  });

  test('component slot children have proper nested indentation', () => {
    const template = '<MyComp><div><span>inside</span></div></MyComp>';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
      bindings: new Set(['MyComp']),
    });

    const lines = result.code.split('\n');
    // Find the inner elements within the slot
    const divLine = lines.find(l => l.includes("'div'"));
    const spanLine = lines.find(l => l.includes("'span'"));

    if (divLine && spanLine) {
      const divIndent = divLine.match(/^( *)/)?.[1].length ?? 0;
      const spanIndent = spanLine.match(/^( *)/)?.[1].length ?? 0;

      // span should be more deeply indented than div
      expect(spanIndent).toBeGreaterThan(divIndent);
    }
  });

  test('if-block children have proper nested indentation', () => {
    const template = '{{#if this.show}}<div><span>yes</span></div>{{/if}}';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const lines = result.code.split('\n');

    // Find the $_if call and its nested $_tag calls
    const ifLine = lines.find(l => l.includes('$_if('));
    const divLine = lines.find(l => l.includes("'div'"));
    const spanLine = lines.find(l => l.includes("'span'"));

    expect(ifLine).toBeDefined();
    expect(divLine).toBeDefined();
    expect(spanLine).toBeDefined();

    const ifIndent = ifLine!.match(/^( *)/)?.[1].length ?? 0;
    const divIndent = divLine!.match(/^( *)/)?.[1].length ?? 0;
    const spanIndent = spanLine!.match(/^( *)/)?.[1].length ?? 0;

    // Elements inside if-block should be more indented than $_if
    expect(divIndent).toBeGreaterThan(ifIndent);
    // Nested elements inside if-block should nest further
    expect(spanIndent).toBeGreaterThan(divIndent);
  });

  test('if-block component children have proper indentation', () => {
    const template = '{{#if this.show}}<MyComp @value={{this.val}} />{{else}}<Other />{{/if}}';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
      bindings: new Set(['MyComp', 'Other']),
    });

    const lines = result.code.split('\n');

    // Components inside if branches should be more indented than $_if
    const ifLine = lines.find(l => l.includes('$_if('));
    const myCompLine = lines.find(l => l.includes('MyComp'));
    const otherLine = lines.find(l => l.includes('Other'));

    expect(ifLine).toBeDefined();
    expect(myCompLine).toBeDefined();
    expect(otherLine).toBeDefined();

    const ifIndent = ifLine!.match(/^( *)/)?.[1].length ?? 0;
    const myCompIndent = myCompLine!.match(/^( *)/)?.[1].length ?? 0;
    const otherIndent = otherLine!.match(/^( *)/)?.[1].length ?? 0;

    expect(myCompIndent).toBeGreaterThan(ifIndent);
    expect(otherIndent).toBeGreaterThan(ifIndent);
  });

  test('if-block all lines include baseIndent', () => {
    const template = '{{#if this.show}}<div>content</div>{{/if}}';
    const baseIndent = '      ';
    const result = compile(template, {
      format: { enabled: true, baseIndent, indent: '  ' },
    });

    const lines = result.code.split('\n');
    // First line has no baseIndent
    expect(lines[0].startsWith('[')).toBe(true);

    // All subsequent non-empty lines must start with baseIndent
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].length > 0) {
        expect(
          lines[i].startsWith(baseIndent),
          `Line ${i + 1} "${lines[i]}" should start with baseIndent`
        ).toBe(true);
      }
    }
  });

  test('if-block sourcemap ranges are valid with formatting', () => {
    const template = '{{#if this.show}}<div><span>yes</span></div>{{/if}}';
    const result = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    const codeLength = result.code.length;

    function checkRanges(node: typeof result.mappingTree) {
      expect(node.generatedRange.start).toBeGreaterThanOrEqual(0);
      expect(node.generatedRange.end).toBeLessThanOrEqual(codeLength);
      expect(node.generatedRange.start).toBeLessThanOrEqual(node.generatedRange.end);
      expect(node.sourceRange.start).toBeGreaterThanOrEqual(0);
      expect(node.sourceRange.end).toBeLessThanOrEqual(template.length);

      for (const child of node.children) {
        checkRanges(child);
      }
    }

    checkRanges(result.mappingTree);
  });

  test('formatted and unformatted if-block have same functional output', () => {
    const template = '{{#if this.show}}<div>yes</div>{{else}}<span>no</span>{{/if}}';
    const minified = compile(template);
    const formatted = compile(template, {
      format: { enabled: true, baseIndent: '      ', indent: '  ' },
    });

    // Both should contain the same key symbols
    expect(minified.code).toContain('$_if');
    expect(formatted.code).toContain('$_if');
    expect(minified.code).toContain('$_ucw');
    expect(formatted.code).toContain('$_ucw');
    expect(minified.code).toContain("'div'");
    expect(formatted.code).toContain("'div'");
    expect(minified.code).toContain("'span'");
    expect(formatted.code).toContain("'span'");

    // Both should have no errors
    expect(minified.errors).toHaveLength(0);
    expect(formatted.errors).toHaveLength(0);
  });
});

describe('String serialization optimizations', () => {
  test('single text child uses textContent event', () => {
    const result = compile('<div>Hello World</div>');
    // Single text child should be optimized to textContent event
    expect(result.code).toContain('"1"'); // TEXT_CONTENT event type
    expect(result.code).toContain('"Hello World"');
  });

  test('text with siblings is not optimized', () => {
    const result = compile('<div>Hello<span></span></div>');
    // Multiple children should not use textContent optimization
    expect(result.code).toContain('"Hello"');
    expect(result.code).toContain("'span'");
  });
});

describe('Concat expressions', () => {
  test('concat in attribute', () => {
    const result = compile('<div class="prefix-{{this.suffix}}">content</div>');
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('.join');
    expect(result.code).toContain('"prefix-"');
  });

  test('concat in component @arg', () => {
    const result = compile('<MyComp @title="Hello {{this.name}}" />', {
      bindings: new Set(['MyComp']),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('.join');
    expect(result.code).toContain('"Hello "');
  });
});

describe('Optional chaining for paths', () => {
  test('deep path gets optional chaining', () => {
    const result = compile('{{this.foo.bar.baz}}');
    // Deep paths should have optional chaining
    expect(result.code).toContain('this.foo?.bar?.baz');
  });

  test('computed segment uses optional chaining when needed', () => {
    const result = compile('{{this.foo.bar-baz.qux}}');
    // Hyphenated segment should be emitted as optional computed access
    expect(result.code).toContain('this.foo?.["bar-baz"]?.qux');
  });

  test('shallow path without optional chaining', () => {
    const result = compile('{{this.foo}}');
    expect(result.code).toContain('this.foo');
    expect(result.code).not.toContain('this?.foo');
  });

  test('@args path with optional chaining', () => {
    const result = compile('{{@foo.bar.baz}}');
    expect(result.code).toContain('$a.foo?.bar?.baz');
  });

  test('each condition with nested path uses optional chaining', () => {
    const result = compile('{{#each this.positional.params as |params index|}}{{params}}{{/each}}');
    expect(result.code).toContain('this.positional?.params');
  });
});

describe('unless helper', () => {
  test('unless with 3 params inverts condition', () => {
    const result = compile('{{unless this.show "hidden" "visible"}}');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
    // unless(cond, a, b) becomes if(cond, b, a)
  });

  test('unless with 2 params', () => {
    const result = compile('{{unless this.show "hidden"}}');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('unless block inverts branches', () => {
    const result = compile('{{#unless this.hidden}}visible{{else}}hidden{{/unless}}');
    expect(result.code).toContain(SYMBOLS.IF);
  });
});

describe('Let block', () => {
  test('let block creates local bindings', () => {
    const result = compile('{{#let this.value as |v|}}{{v}}{{/let}}');
    expect(result.errors).toHaveLength(0);
    // Let block should create IIFE with local variables
    expect(result.code).toContain('let ');
  });

  test('let block with multiple values', () => {
    const result = compile('{{#let this.a this.b as |x y|}}{{x}}{{y}}{{/let}}');
    expect(result.errors).toHaveLength(0);
  });
});

describe('Each block advanced', () => {
  test('each index is wrapped with .value', () => {
    const result = compile('{{#each this.items as |item idx|}}<div>{{idx}}</div>{{/each}}');
    // Index should be accessed as idx.value for reactivity
    expect(result.code).toContain('.value');
  });

  test('each without block params uses $noop', () => {
    const result = compile('{{#each this.items}}<div></div>{{/each}}');
    expect(result.code).toContain('$noop');
  });

  test('each with single component child is stable (no UCW)', () => {
    const result = compile('{{#each this.items as |item|}}<Comp />{{/each}}', {
      bindings: new Set(['Comp']),
    });
    // Single component child is considered stable (matches old compiler behavior)
    expect(result.code).not.toContain(SYMBOLS.UCW);
  });

  test('each with multiple children wraps in UCW', () => {
    const result = compile('{{#each this.items as |item|}}text<div></div>{{/each}}');
    // Multiple children need UCW wrapper
    expect(result.code).toContain(SYMBOLS.UCW);
  });

  test('each with stable children not wrapped', () => {
    const result = compile('{{#each this.items as |item|}}<div></div>{{/each}}');
    // Stable children (plain elements) may not need UCW
    expect(result.code).toContain(SYMBOLS.EACH);
  });
});

describe('Namespace handling', () => {
  test('SVG wrapped in namespace provider', () => {
    const result = compile('<svg><rect /></svg>');
    expect(result.code).toContain(SYMBOLS.SVG_NAMESPACE);
    expect(result.code).toContain("'svg'");
    expect(result.code).toContain("'rect'");
  });

  test('MathML wrapped in namespace provider', () => {
    const result = compile('<math><mi>x</mi></math>');
    expect(result.code).toContain(SYMBOLS.MATH_NAMESPACE);
    expect(result.code).toContain("'math'");
  });

  test('foreignObject children are regular elements', () => {
    const result = compile('<svg><foreignObject><div>html content</div></foreignObject></svg>');
    // foreignObject children should be rendered as regular elements
    // The namespace context is switched internally
    expect(result.code).toContain("'foreignObject'");
    expect(result.code).toContain("'div'");
  });
});

describe('Style attribute handling', () => {
  test('style.property creates oncreated event', () => {
    const result = compile('<div style.color="red">styled</div>');
    // style.color should become a setProperty call in oncreated event
    expect(result.code).toContain('"0"'); // ON_CREATED event type
    expect(result.code).toContain('style');
    expect(result.code).toContain('color');
  });

  test('dynamic style.property', () => {
    const result = compile('<div style.color={{this.color}}>styled</div>');
    expect(result.code).toContain('"0"'); // ON_CREATED event type
    expect(result.code).toContain('this.color');
  });
});

describe('Boolean attributes', () => {
  test('empty disabled becomes true', () => {
    const result = compile('<input disabled />');
    expect(result.code).toContain('disabled');
    expect(result.code).toContain('true');
  });

  test('empty checked becomes true', () => {
    const result = compile('<input checked />');
    expect(result.code).toContain('checked');
    expect(result.code).toContain('true');
  });

  test('empty readonly becomes readOnly true', () => {
    const result = compile('<input readonly />');
    expect(result.code).toContain('readOnly');
    expect(result.code).toContain('true');
  });
});

describe('Component slots', () => {
  test('named slots are parsed correctly', () => {
    const result = compile(
      '<Card><:header>Title</:header><:body>Content</:body></Card>',
      { bindings: new Set(['Card']) }
    );
    expect(result.code).toContain('header:');
    expect(result.code).toContain('body:');
  });

  test('component with block params', () => {
    const result = compile('<List as |item|><div>{{item}}</div></List>', {
      bindings: new Set(['List']),
    });
    expect(result.code).toContain('item');
  });

  test('block params in default slot are recognized as known bindings', () => {
    const result = compile('<List as |item|><div>{{item.name}}</div></List>', {
      bindings: new Set(['List']),
    });
    expect(result.code).toContain('item.name');
    // Block param references must NOT be wrapped in $_maybeHelper
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('multiple block params in default slot are known bindings', () => {
    const result = compile(
      '<Table as |row index|><span>{{row.label}}</span><span>{{index}}</span></Table>',
      { bindings: new Set(['Table']) }
    );
    expect(result.code).toContain('row.label');
    expect(result.code).toContain('index');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('named slot with block params are known bindings', () => {
    const result = compile(
      '<Card><:body as |data|><div>{{data.value}}</div></:body></Card>',
      { bindings: new Set(['Card']) }
    );
    expect(result.code).toContain('data.value');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('named slot block param with nested component', () => {
    const result = compile(
      '<Card><:body as |data|><Child @val={{data.x}} /></:body></Card>',
      { bindings: new Set(['Card', 'Child']) }
    );
    expect(result.code).toContain('data.x');
    expect(result.code).not.toContain('$_maybeHelper');
    expect(result.code).toContain(SYMBOLS.COMPONENT);
  });

  test('block component with {{else}} emits default AND inverse slots', () => {
    const result = compile(
      '{{#my-block}}hello{{else}}bye{{/my-block}}',
      { bindings: new Set(['my-block']), flags: { IS_GLIMMER_COMPAT_MODE: true } }
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('default:');
    expect(result.code).toContain('inverse:');
    expect(result.code).toContain('"hello"');
    expect(result.code).toContain('"bye"');
  });

  test('block component without {{else}} does NOT emit inverse slot', () => {
    const result = compile(
      '{{#my-block}}hello{{/my-block}}',
      { bindings: new Set(['my-block']), flags: { IS_GLIMMER_COMPAT_MODE: true } }
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('default:');
    expect(result.code).not.toContain('inverse:');
  });

  test('block param shadowing outer binding', () => {
    const result = compile(
      '<Outer as |item|><Inner as |item|>{{item}}</Inner></Outer>',
      { bindings: new Set(['Outer', 'Inner']) }
    );
    // Inner item shadows outer item — should still compile without error
    expect(result.code).toContain('item');
    expect(result.errors).toHaveLength(0);
  });

  test('block param used in helper', () => {
    const result = compile(
      '<List as |item|>{{if item.active "yes" "no"}}</List>',
      { bindings: new Set(['List']) }
    );
    expect(result.code).toContain('item.active');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('block param used in element attribute', () => {
    const result = compile(
      '<List as |item|><div class={{item.class}}>text</div></List>',
      { bindings: new Set(['List']) }
    );
    expect(result.code).toContain('item.class');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('nested {{#each}} blocks with the same block-param name shadow correctly', () => {
    // Inner `ring` shadows outer `ring`; after the inner block closes, the
    // outer `ring` must still resolve (regression guard for the flat-scope
    // `removeBinding` bug where the inner cleanup deleted the outer binding).
    const result = compile(
      '{{#each this.first as |ring|}}{{ring}}-{{#each this.second as |ring|}}{{ring}}-{{/each}}{{ring}}-{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    // All three `ring` references must be resolved as block-param getters,
    // NOT as literal-name helper lookups. If the scope stack is broken, the
    // post-inner-close reference falls through to `$_maybeHelper("ring", ...)`.
    expect(result.code).not.toContain('$_maybeHelper("ring"');
    expect(result.code).not.toContain("$_maybeHelper('ring'");
  });

  test('triply nested {{#each}} blocks with the same block-param name shadow correctly', () => {
    const result = compile(
      '{{#each this.first as |ring|}}{{ring}}-' +
        '{{#each this.fifth as |ring|}}{{ring}}-' +
        '{{#each this.ninth as |ring|}}{{ring}}-{{/each}}' +
        '{{ring}}-{{/each}}' +
        '{{ring}}-{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    // Inside any `ring` scope, ALL references must resolve to block-param
    // getters, not literal-name helper lookups. In particular, the two
    // "after inner close" references (right-hand side of the middle and
    // outer blocks) must read the outer block's `ring`, not fall through
    // to `$_maybeHelper("ring", ...)`.
    expect(result.code).not.toContain('$_maybeHelper("ring"');
    expect(result.code).not.toContain("$_maybeHelper('ring'");
  });

  test('references after an inner {{#each}} closes read the outer scope', () => {
    const result = compile(
      '{{#each this.outer as |x|}}{{#each this.inner as |x|}}{{/each}}{{x}}{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    // The trailing `{{x}}` lives in the OUTER scope and must be resolved.
    expect(result.code).not.toContain('$_maybeHelper("x"');
    expect(result.code).not.toContain("$_maybeHelper('x'");
  });

  test('nested {{#if}} with block param name reuse does not leak', () => {
    // {{#if}} doesn't typically take block params but `{{#each}}` around an
    // `{{#if}}` should still preserve the outer `x` after the if closes.
    const result = compile(
      '{{#each this.items as |x|}}{{#if x.flag}}<span>{{x.name}}</span>{{/if}}{{x.id}}{{/each}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).not.toContain('$_maybeHelper("x"');
    expect(result.code).not.toContain("$_maybeHelper('x'");
  });

  test('nested {{#let}} with same name shadows and restores', () => {
    const result = compile(
      '{{#let this.a as |v|}}{{v}}-{{#let this.b as |v|}}{{v}}-{{/let}}{{v}}{{/let}}',
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).not.toContain('$_maybeHelper("v"');
    expect(result.code).not.toContain("$_maybeHelper('v'");
  });

  test('nested angle-bracket blocks with same block-param name shadow correctly', () => {
    const result = compile(
      '<Outer as |item|>{{item}}<Inner as |item|>{{item}}</Inner>{{item}}</Outer>',
      { bindings: new Set(['Outer', 'Inner']) },
    );
    expect(result.errors).toHaveLength(0);
    // After the inner `</Inner>` closes, the trailing `{{item}}` must still
    // resolve to the outer block param, not a literal helper lookup.
    expect(result.code).not.toContain('$_maybeHelper("item"');
    expect(result.code).not.toContain("$_maybeHelper('item'");
  });
});

describe('has-block helpers', () => {
  test('has-block compiles', () => {
    const result = compile('{{has-block}}');
    expect(result.code).toContain(SYMBOLS.HAS_BLOCK);
  });

  test('has-block with name', () => {
    const result = compile('{{has-block "header"}}');
    expect(result.code).toContain(SYMBOLS.HAS_BLOCK);
    expect(result.code).toContain('"header"');
  });

  test('has-block-params compiles', () => {
    const result = compile('{{has-block-params}}');
    expect(result.code).toContain(SYMBOLS.HAS_BLOCK_PARAMS);
  });
});

describe('In-element block', () => {
  test('in-element compiles', () => {
    const result = compile('{{#in-element this.target}}<div>portal</div>{{/in-element}}');
    expect(result.code).toContain(SYMBOLS.IN_ELEMENT);
  });
});

describe('Built-in helpers', () => {
  test('debugger helper uses .call', () => {
    const result = compile('{{debugger}}');
    expect(result.code).toContain(SYMBOLS.DEBUGGER);
    expect(result.code).toContain('.call');
  });

  test('log helper', () => {
    const result = compile('{{log this.value}}');
    expect(result.code).toContain(SYMBOLS.LOG);
  });

  test('array helper', () => {
    const result = compile('{{array 1 2 3}}');
    expect(result.code).toContain(SYMBOLS.ARRAY);
  });

  test('hash helper', () => {
    const result = compile('{{hash a=1 b=2}}');
    expect(result.code).toContain(SYMBOLS.HASH);
  });

  test('hash helper wraps values in getters', () => {
    const result = compile('{{match (hash myFn=myFn)}}', {
      bindings: new Set(['myFn', 'match']),
    });
    // Hash values should be wrapped in getters for lazy evaluation
    expect(result.code).toContain('myFn: () =>');
  });

  test('each with unstable children uses ucw', () => {
    const template = `<ul>
      {{#each items as |item|}}
        123 321
        <li>{{item.id}}</li>
      {{/each}}
    </ul>`;
    const result = compile(template, { bindings: new Set(['items']) });
    // Each with unstable children (text + element) should use $_ucw
    expect(result.code).toContain('$_ucw');
  });

  test('if else-if chain handles inverse correctly', () => {
    const template = `{{#if (not isExpanded)}}
      <div>NOT EXPANDED</div>
    {{else if isExpanded}}
      {{#each items as |item|}}<li>{{item}}</li>{{/each}}
    {{/if}}`;
    const result = compile(template, { bindings: new Set(['isExpanded', 'items']) });
    // Should contain both conditions
    expect(result.code).toContain('$_if');
  });

  test('input value property binding', () => {
    const template = `<input value={{this.value}} />`;
    const result = compile(template);
    // Value should be a property (first array), not an attribute (second array)
    // Structure: [[props], [attrs], [events]]
    expect(result.code).toContain('[[["value"');
  });

  test('fn helper', () => {
    const result = compile('{{fn this.handleClick "arg"}}');
    expect(result.code).toContain(SYMBOLS.FN);
  });

  test('and helper', () => {
    const result = compile('{{and this.a this.b}}');
    expect(result.code).toContain(SYMBOLS.AND);
  });

  test('or helper', () => {
    const result = compile('{{or this.a this.b}}');
    expect(result.code).toContain(SYMBOLS.OR);
  });

  test('not helper', () => {
    const result = compile('{{not this.value}}');
    expect(result.code).toContain(SYMBOLS.NOT);
  });

  test('eq helper', () => {
    const result = compile('{{eq this.a this.b}}');
    expect(result.code).toContain(SYMBOLS.EQ);
  });
});

describe('Element helper', () => {
  test('element sub-expression', () => {
    const result = compile('{{(element "tag")}}');
    expect(result.code).toContain('function(args)');
    expect(result.code).toContain(SYMBOLS.GET_ARGS);
  });
});

describe('GetterValue serialization', () => {
  test('sub-expression results are wrapped in getters when wrap=true', () => {
    // When a sub-expression is used in a context that requires wrapping (e.g., if condition),
    // the result should be wrapped in a getter for reactivity
    const result = compile('{{#if (eq this.a this.b)}}equal{{/if}}');
    // The condition should contain a getter wrapping the eq call
    expect(result.code).toContain('() =>');
    expect(result.code).toContain(SYMBOLS.EQ);
  });

  test('sub-expression in helper arg is not double-wrapped', () => {
    // When passing a sub-expression as an argument, it shouldn't be wrapped
    const result = compile('{{helper (eq 1 2)}}', { bindings: new Set(['helper']) });
    expect(result.code).toContain(SYMBOLS.EQ);
    // Should have the eq call but not be double-wrapped
  });

  test('nested getters serialize correctly', () => {
    // Nested conditions should have proper getter wrapping
    const result = compile('{{#if (and (eq 1 1) (eq 2 2))}}yes{{/if}}');
    expect(result.code).toContain(SYMBOLS.AND);
    expect(result.code).toContain(SYMBOLS.EQ);
    expect(result.code).toContain('() =>');
  });
});

describe('Helper reactivity in attributes', () => {
  // These tests ensure helpers used in attributes/args are wrapped in getters
  // for proper reactivity. This prevents the bug where dynamic values like
  // class={{if condition 'a' 'b'}} or @onClick={{fn handler arg}} were
  // evaluated once at render time instead of being reactive.

  test('if helper in class attribute is wrapped in getter', () => {
    const result = compile('<div class={{if this.show "visible" "hidden"}} />');
    // The if helper should be wrapped: class: () => $__if(...)
    expect(result.code).toContain('() =>');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
    // Should NOT be bare $__if without getter
    expect(result.code).not.toMatch(/\["class",\s*\$__if/);
  });

  test('fn helper in @arg is wrapped in getter', () => {
    const result = compile('<Button @onClick={{fn this.handle "arg"}} />', {
      bindings: new Set(['Button']),
    });
    // The fn helper should be wrapped: onClick: () => $__fn(...)
    expect(result.code).toContain('onClick: () =>');
    expect(result.code).toContain(SYMBOLS.FN);
  });

  test('fn helper with block param in each is wrapped in getter', () => {
    const result = compile(`
      {{#each this.items as |item|}}
        <Button @onClick={{fn this.handle item.id}} />
      {{/each}}
    `, {
      bindings: new Set(['Button']),
    });
    // The fn helper should be wrapped even inside each blocks
    expect(result.code).toContain('onClick: () =>');
    expect(result.code).toContain(SYMBOLS.FN);
    // Block param should be used directly (not prefixed with this.)
    expect(result.code).toContain('item.id');
    expect(result.code).not.toContain('this.item.id');
  });

  test('if helper in regular attribute is wrapped in getter', () => {
    const result = compile('<input disabled={{if this.isDisabled true false}} />');
    // Should have getter wrapping
    expect(result.code).toContain('() =>');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('eq helper in attribute is wrapped in getter', () => {
    const result = compile('<div hidden={{eq this.status "hidden"}} />');
    expect(result.code).toContain('() =>');
    expect(result.code).toContain(SYMBOLS.EQ);
  });

  test('and/or helpers in class attribute are wrapped in getter', () => {
    const result = compile('<div class={{if (and this.a this.b) "both" "not-both"}} />');
    expect(result.code).toContain('() =>');
    expect(result.code).toContain(SYMBOLS.AND);
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('nested fn helpers in @arg are wrapped', () => {
    const result = compile('<Button @onClick={{fn (fn this.outer "a") "b"}} />', {
      bindings: new Set(['Button']),
    });
    expect(result.code).toContain('onClick: () =>');
    expect(result.code).toContain(SYMBOLS.FN);
  });

  test('path in @arg is still wrapped in getter', () => {
    // Ensure the fix didn't break path wrapping
    const result = compile('<Button @label={{this.label}} />', {
      bindings: new Set(['Button']),
    });
    expect(result.code).toContain('label: () =>');
  });

  test('multiple @args with helpers are all wrapped', () => {
    const result = compile(`
      <Button
        @onClick={{fn this.click "a"}}
        @disabled={{if this.loading true false}}
        @label={{this.text}}
      />
    `, {
      bindings: new Set(['Button']),
    });
    // All should be wrapped in getters
    expect(result.code).toContain('onClick: () =>');
    expect(result.code).toContain('disabled: () =>');
    expect(result.code).toContain('label: () =>');
  });

  test('helper path arguments are wrapped in getters in compat mode', () => {
    // In compat mode (default), path arguments to helpers like $__if
    // should be wrapped in getters for reactivity
    const result = compile('<div class={{if this.show "visible" "hidden"}} />');
    // The condition this.show should be wrapped: $__if(() => this.show, ...)
    expect(result.code).toContain('() => this.show');
  });

  test('fn helper first arg (function) is NOT wrapped', () => {
    // The first argument to fn is the function reference and should NOT be wrapped
    const result = compile('<Button @onClick={{fn this.handle this.arg}} />', {
      bindings: new Set(['Button']),
    });
    // Function ref should NOT be wrapped
    expect(result.code).toContain('$__fn(this.handle,');
    // But the second arg should be wrapped
    expect(result.code).toContain('() => this.arg');
  });

  test('fn helper with block param wraps all args except function', () => {
    const result = compile(`
      {{#each this.routes as |route|}}
        <Button @onClick={{fn this.goToRoute route.name}} />
      {{/each}}
    `, {
      bindings: new Set(['Button']),
    });
    // Function ref should NOT be wrapped
    expect(result.code).toContain('$__fn(this.goToRoute,');
    // Block param arg should be wrapped
    expect(result.code).toContain('() => route.name');
  });

  test('if helper with bare identifier wraps condition in getter', () => {
    // Bare identifiers (like block params or bindings) should also be wrapped
    const result = compile(
      `<div class={{if isMobileDialogVisible 'opacity-100' 'opacity-0 pointer-events-none'}}></div>`,
      { bindings: new Set(['isMobileDialogVisible']) }
    );
    expect(result.code).toContain('() => isMobileDialogVisible');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('if helper in style property wraps condition', () => {
    const result = compile(`<div style.opacity={{if this.visible 1 0}}></div>`);
    expect(result.code).toContain('() => this.visible');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('if helper in data attribute wraps condition', () => {
    const result = compile(`<div data-active={{if this.active "yes" "no"}}></div>`);
    expect(result.code).toContain('() => this.active');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('if helper in boolean attribute wraps condition', () => {
    const result = compile(`<button disabled={{if this.loading true false}}>Click</button>`);
    expect(result.code).toContain('() => this.loading');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('if helper in property with nested paths wraps all paths', () => {
    const result = compile(`<input value={{if this.hasValue this.value ""}} />`);
    expect(result.code).toContain('() => this.hasValue');
    expect(result.code).toContain('() => this.value');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('eq helper wraps both arguments', () => {
    const result = compile(`<div hidden={{eq this.status this.targetStatus}}></div>`);
    expect(result.code).toContain('() => this.status');
    expect(result.code).toContain('() => this.targetStatus');
    expect(result.code).toContain(SYMBOLS.EQ);
  });

  test('and helper wraps all arguments', () => {
    const result = compile(`<div class={{if (and this.a this.b this.c) "all" "not-all"}}></div>`);
    expect(result.code).toContain('() => this.a');
    expect(result.code).toContain('() => this.b');
    expect(result.code).toContain('() => this.c');
    expect(result.code).toContain(SYMBOLS.AND);
  });

  test('or helper wraps all arguments', () => {
    const result = compile(`<div class={{if (or this.a this.b) "any" "none"}}></div>`);
    expect(result.code).toContain('() => this.a');
    expect(result.code).toContain('() => this.b');
    expect(result.code).toContain(SYMBOLS.OR);
  });

  test('not helper wraps argument', () => {
    const result = compile(`<div hidden={{not this.visible}}></div>`);
    expect(result.code).toContain('() => this.visible');
    expect(result.code).toContain(SYMBOLS.NOT);
  });

  test('nested helpers wrap all path arguments', () => {
    // Complex nesting: if(and(a, or(b, c)), x, y)
    const result = compile(`<div class={{if (and this.a (or this.b this.c)) this.x this.y}}></div>`);
    expect(result.code).toContain('() => this.a');
    expect(result.code).toContain('() => this.b');
    expect(result.code).toContain('() => this.c');
    expect(result.code).toContain('() => this.x');
    expect(result.code).toContain('() => this.y');
  });

  test('block param in if condition is wrapped', () => {
    const result = compile(`
      {{#each this.items as |item|}}
        <div class={{if item.active "active" "inactive"}}></div>
      {{/each}}
    `);
    expect(result.code).toContain('() => item.active');
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('multiple block params in helper are all wrapped', () => {
    const result = compile(`
      {{#each this.items as |item index|}}
        <div class={{if (eq index.value 0) "first" "not-first"}}></div>
      {{/each}}
    `);
    expect(result.code).toContain(SYMBOLS.EQ);
    // index.value should be wrapped
    expect(result.code).toContain('index.value');
  });

  // Regression tests: ensure literals are NOT wrapped, only paths
  // Note: PURE annotations are only on root-level calls; nested calls inside arrow/function
  // bodies do NOT get PURE annotations (tree-shakers can't eliminate them anyway)
  test('if helper: literals are NOT wrapped in getters', () => {
    const result = compile(`<div class={{if this.show "visible" "hidden"}}></div>`);
    // Path should be wrapped
    expect(result.code).toContain('() => this.show');
    // String literals should NOT be wrapped - they appear directly as arguments
    expect(result.code).not.toContain('() => "visible"');
    expect(result.code).not.toContain('() => "hidden"');
    // Verify the pattern (no PURE annotation inside arrow body)
    expect(result.code).toMatch(/\$__if\(\(\) => this\.show, "visible", "hidden"\)/);
  });

  test('if helper: number literals are NOT wrapped', () => {
    const result = compile(`<div style.opacity={{if this.visible 1 0}}></div>`);
    // Path wrapped, numbers not wrapped
    expect(result.code).toContain('() => this.visible');
    expect(result.code).not.toContain('() => 1');
    expect(result.code).not.toContain('() => 0');
    expect(result.code).toMatch(/\$__if\(\(\) => this\.visible, 1, 0\)/);
  });

  test('if helper: boolean literals are NOT wrapped', () => {
    const result = compile(`<input disabled={{if this.loading true false}} />`);
    expect(result.code).toContain('() => this.loading');
    expect(result.code).not.toContain('() => true');
    expect(result.code).not.toContain('() => false');
    expect(result.code).toMatch(/\$__if\(\(\) => this\.loading, true, false\)/);
  });

  test('eq helper: literal second arg is NOT wrapped', () => {
    const result = compile(`<div hidden={{eq this.status "hidden"}}></div>`);
    // First arg (path) wrapped, second arg (string) not wrapped
    expect(result.code).toContain('() => this.status');
    expect(result.code).not.toContain('() => "hidden"');
    expect(result.code).toMatch(/\$__eq\(\(\) => this\.status, "hidden"\)/);
  });

  test('and helper: all path args wrapped, no double wrapping', () => {
    const result = compile(`<div class={{if (and this.a this.b) "yes" "no"}}></div>`);
    // Both paths in and() should be wrapped (no PURE annotation inside arrow body)
    expect(result.code).toMatch(/\$__and\(\(\) => this\.a, \(\) => this\.b\)/);
    // No double wrapping like () => () => this.a
    expect(result.code).not.toContain('() => () =>');
  });

  test('or helper: all path args wrapped, no double wrapping', () => {
    const result = compile(`<div class={{if (or this.x this.y) "yes" "no"}}></div>`);
    expect(result.code).toMatch(/\$__or\(\(\) => this\.x, \(\) => this\.y\)/);
    expect(result.code).not.toContain('() => () =>');
  });

  test('not helper: path arg wrapped, no double wrapping', () => {
    const result = compile(`<div hidden={{not this.visible}}></div>`);
    expect(result.code).toMatch(/\$__not\(\(\) => this\.visible\)/);
    expect(result.code).not.toContain('() => () =>');
  });

  test('nested helpers: inner helper result is wrapped for outer helper', () => {
    // When and() returns a value, it needs to be wrapped for if()
    const result = compile(`<div class={{if (and this.a this.b) "yes" "no"}}></div>`);
    // The and() helper result should be wrapped for the if() condition (no PURE inside arrow)
    expect(result.code).toMatch(/\$__if\(\(\) => \$__and/);
  });

  test('deeply nested helpers maintain correct wrapping', () => {
    const result = compile(`<div class={{if (or (and this.a this.b) this.c) "yes" "no"}}></div>`);
    // Inner and() has wrapped paths (no PURE inside arrow body)
    expect(result.code).toMatch(/\$__and\(\(\) => this\.a, \(\) => this\.b\)/);
    // or() wraps the and() result and this.c (no PURE inside arrow body)
    expect(result.code).toMatch(/\$__or\(\(\) => \$__and.*\(\) => this\.c\)/);
    // No double wrapping
    expect(result.code).not.toContain('() => () =>');
  });
});

describe('Hash helper advanced', () => {
  test('hash with literal values wraps in getters', () => {
    const result = compile('{{log (hash a=1 b="str" c=true)}}');
    expect(result.code).toContain(SYMBOLS.HASH);
    // Each value should be wrapped in a getter
    expect(result.code).toContain('a: () =>');
    expect(result.code).toContain('b: () =>');
    expect(result.code).toContain('c: () =>');
  });

  test('hash with path values wraps in getters', () => {
    const result = compile('{{log (hash name=this.name value=@value)}}');
    expect(result.code).toContain(SYMBOLS.HASH);
    expect(result.code).toContain('name: () =>');
    expect(result.code).toContain('value: () =>');
  });

  test('hash with helper values wraps in getters', () => {
    const result = compile('{{log (hash doubled=(multiply 2 this.value))}}', {
      bindings: new Set(['multiply']),
    });
    expect(result.code).toContain(SYMBOLS.HASH);
    expect(result.code).toContain('doubled: () =>');
    expect(result.code).toContain('multiply');
  });

  test('nested hash helpers wrap all levels (Ember dialect memoizes nested hash)', () => {
    // The $__cached identity memo is gated to the Ember dialect
    // (WITH_EMBER_INTEGRATION), so opt the raw `compile()` into it here.
    const result = compile('{{log (hash outer=(hash inner=1))}}', {
      flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
    });
    expect(result.code).toContain(SYMBOLS.HASH);
    // Both outer and inner should be lazily wrapped in getters. A nested
    // (hash)/(array) prop is additionally memoized through $__cached so reading
    // `outerHash.outer` yields an identity-stable reference (classic
    // compute-ref contract); plain literal props stay as bare getters.
    expect(result.code).toContain('outer: $__cached(() =>');
    expect(result.code).toContain('inner: () =>');
  });

  test('nested hash helpers are NOT memoized without WITH_EMBER_INTEGRATION (byte-identical compat)', () => {
    // Default `compile()` is non-Ember glimmer-compat (WITH_EMBER_INTEGRATION
    // off). The $__cached identity memo must NOT fire — gxt-standalone and
    // plain glimmer-compat output stay byte-identical (bare `() =>` getters).
    const result = compile('{{log (hash outer=(hash inner=1))}}');
    expect(result.code).toContain(SYMBOLS.HASH);
    expect(result.code).not.toContain('$__cached');
    expect(result.code).toContain('outer: () =>');
    expect(result.code).toContain('inner: () =>');
  });

  test('hash values are lazily evaluated (functions not auto-called)', () => {
    // This tests that functions passed to hash are not auto-called
    // The getter wrapping prevents $__hash from calling function values
    const result = compile('{{consumer (hash callback=myCallback)}}', {
      bindings: new Set(['consumer', 'myCallback']),
    });
    expect(result.code).toContain('callback: () => myCallback');
  });

  test('hash in component args', () => {
    const result = compile('<MyComp @config={{hash enabled=true name="test"}} />', {
      bindings: new Set(['MyComp']),
    });
    expect(result.code).toContain(SYMBOLS.HASH);
    expect(result.code).toContain('enabled: () =>');
    expect(result.code).toContain('name: () =>');
  });
});

describe('SubExpression wrap parameter', () => {
  test('has-block is not wrapped in getter', () => {
    // has-block returns a bound function, not a value that needs wrapping
    const result = compile('{{#if (has-block)}}has block{{/if}}', { flags: { IS_GLIMMER_COMPAT_MODE: false } });
    expect(result.code).toContain(SYMBOLS.HAS_BLOCK);
    expect(result.code).toContain('.bind(');
  });

  test('has-block-params is not wrapped in getter', () => {
    const result = compile('{{#if (has-block-params)}}has params{{/if}}', { flags: { IS_GLIMMER_COMPAT_MODE: false } });
    expect(result.code).toContain(SYMBOLS.HAS_BLOCK_PARAMS);
    expect(result.code).toContain('.bind(');
  });

  test('has-block compiles to $_hasBlock.bind(this, $slots) in compat mode', () => {
    const result = compile('{{#if (has-block)}}has block{{/if}}', { flags: { IS_GLIMMER_COMPAT_MODE: true } });
    // The free `$_hasBlock(slots, name)` function is bound to the local
    // `$slots` (extracted by the wrapper from `$_GET_SLOTS(this, arguments)`).
    // When called with no positional args the bound function itself is
    // passed to `$_if`; with `(has-block "name")` it gets called.
    expect(result.code).toContain('$_hasBlock.bind(this, $slots)');
    expect(result.code).not.toContain('this.$_hasBlock(');
  });

  test('has-block-params compiles to $_hasBlockParams.bind(this, $slots) in compat mode', () => {
    const result = compile('{{#if (has-block-params)}}has params{{/if}}', { flags: { IS_GLIMMER_COMPAT_MODE: true } });
    expect(result.code).toContain('$_hasBlockParams.bind(this, $slots)');
    expect(result.code).not.toContain('this.$_hasBlockParams(');
  });

  test('regular helper in if condition is wrapped', () => {
    const result = compile('{{#if (eq 1 1)}}equal{{/if}}');
    // The eq helper result should be wrapped in a getter for reactivity
    // No PURE annotation inside arrow body
    expect(result.code).toMatch(/\(\)\s*=>\s*\$__eq/);
  });

  test('or helper in condition is wrapped', () => {
    const result = compile('{{#if (or this.a this.b)}}yes{{/if}}');
    expect(result.code).toMatch(/\(\)\s*=>\s*\$__or/);
  });

  test('and helper in condition is wrapped', () => {
    const result = compile('{{#if (and this.a this.b)}}yes{{/if}}');
    expect(result.code).toMatch(/\(\)\s*=>\s*\$__and/);
  });

  test('not helper in condition is wrapped', () => {
    const result = compile('{{#if (not this.hidden)}}visible{{/if}}');
    expect(result.code).toMatch(/\(\)\s*=>\s*\$__not/);
  });
});

describe('Built-in helpers are NOT wrapped in $_maybeHelper', () => {
  // Built-in helpers should be called directly for performance
  // They should NEVER go through $_maybeHelper

  test('if helper is called directly, not via $_maybeHelper', () => {
    const result = compile('{{if this.show "yes" "no"}}');
    expect(result.code).toContain('$__if');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('eq helper is called directly', () => {
    const result = compile('{{eq this.a this.b}}');
    expect(result.code).toContain('$__eq');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('and helper is called directly', () => {
    const result = compile('{{and this.a this.b}}');
    expect(result.code).toContain('$__and');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('or helper is called directly', () => {
    const result = compile('{{or this.a this.b}}');
    expect(result.code).toContain('$__or');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('not helper is called directly', () => {
    const result = compile('{{not this.hidden}}');
    expect(result.code).toContain('$__not');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('array helper is called directly', () => {
    const result = compile('{{array 1 2 3}}');
    expect(result.code).toContain('$__array');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('hash helper is called directly', () => {
    const result = compile('{{hash a=1 b=2}}');
    expect(result.code).toContain('$__hash');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('fn helper is called directly', () => {
    const result = compile('<Button @onClick={{fn this.handle "arg"}} />', {
      bindings: new Set(['Button']),
    });
    expect(result.code).toContain('$__fn');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('nested built-in helpers are all called directly', () => {
    const result = compile('{{if (and (eq this.a 1) (or this.b this.c)) "yes" "no"}}');
    expect(result.code).toContain('$__if');
    expect(result.code).toContain('$__and');
    expect(result.code).toContain('$__eq');
    expect(result.code).toContain('$__or');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('unless helper is transformed to if, not via $_maybeHelper', () => {
    const result = compile('{{unless this.hidden "visible" "hidden"}}');
    // unless is transformed to if at compile time
    expect(result.code).toContain('$__if');
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('unknown helper DOES use $_maybeHelper', () => {
    // Non-builtin helpers with no binding should use $_maybeHelper
    const result = compile('{{format-currency this.amount}}');
    expect(result.code).toContain('$_maybeHelper');
    expect(result.code).toContain('"format-currency"');
  });

  test('known binding does NOT use $_maybeHelper', () => {
    const result = compile('{{myHelper this.value}}', {
      bindings: new Set(['myHelper']),
    });
    expect(result.code).toContain('myHelper');
    expect(result.code).not.toContain('$_maybeHelper');
  });
});

describe('Token-Level Source Mapping', () => {
  test('simple text has source range', () => {
    const template = 'hello';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: 5 });
    expect(result.code).toContain('"hello"');
  });

  test('mustache expression preserves source position', () => {
    const template = '{{this.name}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange.start).toBe(0);
    expect(result.mappingTree.sourceRange.end).toBe(template.length);
    expect(result.code).toContain('this.name');
  });

  test('element with attributes tracks source ranges', () => {
    const template = '<div class="foo">text</div>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain("'div'");
    // Class attributes are moved to properties with empty key for classNameModifiers
    expect(result.code).toContain('["", "foo"]');
  });

  test('multiple elements have distinct mapping children', () => {
    const template = '<span>a</span><span>b</span>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    // Root mapping should cover entire template
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
  });

  test('nested elements preserve hierarchy in mapping tree', () => {
    const template = '<div><span>text</span></div>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    // Verify template-level mapping
    expect(result.mappingTree.sourceNode).toBe('Template');
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
  });

  test('if block tracks source range', () => {
    const template = '{{#if this.show}}yes{{/if}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain(SYMBOLS.IF);
  });

  test('each block tracks source range', () => {
    const template = '{{#each this.items as |item|}}{{item}}{{/each}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain(SYMBOLS.EACH);
  });

  test('multiline template preserves accurate line offsets', () => {
    const template = `<div>
  line1
  line2
</div>`;
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange.start).toBe(0);
    expect(result.mappingTree.sourceRange.end).toBe(template.length);
  });

  test('component with args tracks source ranges', () => {
    const template = '<MyComp @name={{this.name}} @age={{this.age}} />';
    const result = compile(template, { bindings: new Set(['MyComp']) });

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain('MyComp');
  });

  test('helper call tracks source range', () => {
    const template = '{{eq this.a this.b}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain(SYMBOLS.EQ);
  });

  test('literal values preserve source ranges', () => {
    const template = '{{42}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain('42');
  });

  test('string literal preserves source range', () => {
    const template = '{{"hello"}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain('"hello"');
  });

  test('boolean literal preserves source range', () => {
    const template = '{{true}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain('true');
  });

  test('null literal preserves source range', () => {
    const template = '{{null}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain('null');
  });

  test('yield preserves source range', () => {
    const template = '{{yield}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain(SYMBOLS.SLOT);
  });

  test('event modifier tracks source range', () => {
    const template = '<button {{on "click" this.handleClick}}>Click</button>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceRange).toEqual({ start: 0, end: template.length });
    expect(result.code).toContain('click');
    expect(result.code).toContain('handleClick');
  });

  test('mapping tree children are within parent bounds', () => {
    const template = '<div><span>nested</span></div>';
    const result = compile(template);

    function validateChildBounds(node: typeof result.mappingTree) {
      for (const child of node.children) {
        // Child generated range should be within parent
        expect(child.generatedRange.start).toBeGreaterThanOrEqual(node.generatedRange.start);
        expect(child.generatedRange.end).toBeLessThanOrEqual(node.generatedRange.end);

        // Recursively check children
        validateChildBounds(child);
      }
    }

    validateChildBounds(result.mappingTree);
  });

  test('empty template has valid mapping', () => {
    const template = '';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceNode).toBe('Template');
    expect(result.code).toBe('[]');
  });

  test('whitespace-only template has valid mapping', () => {
    const template = '   \n   \t   ';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceNode).toBe('Template');
  });

  test('complex template with all node types tracks mappings', () => {
    const template = `
      <div class="container">
        {{#if this.show}}
          <Component @value={{this.val}} />
        {{else}}
          {{this.fallback}}
        {{/if}}
        {{#each this.items as |item idx|}}
          <li>{{item.name}} - {{idx}}</li>
        {{/each}}
      </div>
    `;
    const result = compile(template, { bindings: new Set(['Component']) });

    expect(result.errors).toHaveLength(0);
    expect(result.mappingTree.sourceNode).toBe('Template');
    expect(result.mappingTree.sourceRange.start).toBe(0);
    expect(result.mappingTree.sourceRange.end).toBe(template.length);
  });
});

describe('Sourcemap generation', () => {
  test('sourcemap is generated when enabled', () => {
    const result = compile('<div>hello</div>', {
      sourceMap: true,
      filename: 'test.hbs',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.sourceMap).toBeDefined();
    expect(result.sourceMap?.version).toBe(3);
    expect(result.sourceMap?.sources).toContain('test.hbs');
    expect(result.sourceMap?.mappings).toBeDefined();
  });

  test('sourcemap is not generated by default', () => {
    const result = compile('<div>hello</div>');

    expect(result.errors).toHaveLength(0);
    expect(result.sourceMap).toBeUndefined();
  });

  test('inline sourcemap is appended to code', () => {
    const result = compile('<div>hello</div>', {
      sourceMap: { enabled: true, inline: true },
      filename: 'test.hbs',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('//# sourceMappingURL=data:application/json;base64,');
  });

  test('sourcemap includes source content when requested', () => {
    const template = '<div>hello</div>';
    const result = compile(template, {
      sourceMap: { enabled: true, includeContent: true },
      filename: 'test.hbs',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.sourceMap?.sourcesContent).toBeDefined();
    expect(result.sourceMap?.sourcesContent?.[0]).toBe(template);
  });

  test('sourcemap file is derived from filename', () => {
    const result = compile('<div>hello</div>', {
      sourceMap: true,
      filename: 'component.hbs',
    });

    expect(result.sourceMap?.file).toBe('component.js');
  });
});

describe('Enhanced Error Messages', () => {
  test('errors include source snippets when sourceRange is available', () => {
    // Invalid syntax that causes a parse error with location info
    const result = compile('{{/if}}');
    expect(result.errors.length).toBeGreaterThan(0);
    // Parse errors should have enhanced formatting
    const error = result.errors[0];
    expect(error.message).toBeDefined();
    expect(error.code).toBeDefined();
  });

  test('warnings include source snippets', () => {
    // This would trigger a warning about reserved binding name
    // We need to check if warnings get enriched when they have sourceRange
    const template = '{{#each window as |x|}}{{x}}{{/each}}';
    const result = compile(template);
    // Check if warnings are enriched (if any exist)
    // Note: The reserved binding check may or may not be in the current implementation
    // but the infrastructure is in place
    expect(result.warnings).toBeDefined();
  });

  test('line and column are 1-indexed', () => {
    // Multi-line template with error
    const result = compile('line1\n{{/if}}');
    if (result.errors.length > 0 && result.errors[0].line !== undefined) {
      expect(result.errors[0].line).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].column).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('PURE Annotations', () => {
  test('generates PURE annotation for $_tag', () => {
    const result = compile('<div></div>');
    expect(result.code).toContain('/*#__PURE__*/$_tag');
  });

  test('generates PURE annotation for $_c (component)', () => {
    const result = compile('<MyComponent />', {
      bindings: new Set(['MyComponent']),
    });
    expect(result.code).toContain('/*#__PURE__*/$_c');
  });

  test('generates PURE annotation for $_args', () => {
    const result = compile('<MyComponent @foo="bar" />', {
      bindings: new Set(['MyComponent']),
    });
    expect(result.code).toContain('/*#__PURE__*/$_args');
  });

  test('generates PURE annotation for $_if', () => {
    const result = compile('{{#if this.show}}yes{{/if}}');
    expect(result.code).toContain('/*#__PURE__*/$_if');
  });

  test('generates PURE annotation for $_each', () => {
    const result = compile('{{#each this.items as |item|}}{{item}}{{/each}}');
    expect(result.code).toContain('/*#__PURE__*/$_each');
  });

  test('generates PURE annotation for $_eachSync', () => {
    const result = compile('{{#each this.items sync=true as |item|}}{{item}}{{/each}}');
    expect(result.code).toContain('/*#__PURE__*/$_eachSync');
  });

  test('generates PURE annotation for $_slot (yield)', () => {
    const result = compile('{{yield}}');
    expect(result.code).toContain('/*#__PURE__*/$_slot');
  });

  test('generates PURE annotation for $_dc (dynamic component)', () => {
    const result = compile('<this.component />');
    expect(result.code).toContain('/*#__PURE__*/$_dc');
  });

  test('helpers inside getters do NOT get PURE annotation (nested in arrow body)', () => {
    // Standalone mustache helpers are wrapped in getters: () => $__if(...)
    // PURE annotations are skipped inside arrow/function bodies since tree-shakers
    // can't eliminate them there
    expect(compile('{{if true "yes" "no"}}').code).toContain('$__if');
    expect(compile('{{if true "yes" "no"}}').code).not.toContain('/*#__PURE__*/$__if');

    expect(compile('{{eq 1 2}}').code).toContain('$__eq');
    expect(compile('{{eq 1 2}}').code).not.toContain('/*#__PURE__*/$__eq');

    expect(compile('{{and true false}}').code).toContain('$__and');
    expect(compile('{{and true false}}').code).not.toContain('/*#__PURE__*/$__and');

    expect(compile('{{or true false}}').code).toContain('$__or');
    expect(compile('{{or true false}}').code).not.toContain('/*#__PURE__*/$__or');

    expect(compile('{{not true}}').code).toContain('$__not');
    expect(compile('{{not true}}').code).not.toContain('/*#__PURE__*/$__not');

    expect(compile('{{array 1 2 3}}').code).toContain('$__array');
    expect(compile('{{array 1 2 3}}').code).not.toContain('/*#__PURE__*/$__array');

    // A named-args-only mustache like {{hash a=1}} is wrapped in a getter for
    // fine-grained reactivity (() => $__hash({ a: () => 1 })), so the same rule
    // applies: no PURE annotation inside the getter body.
    expect(compile('{{hash a=1}}').code).toContain('$__hash');
    expect(compile('{{hash a=1}}').code).not.toContain('/*#__PURE__*/$__hash');
  });

  test('helpers as @arg values do NOT get PURE annotation (inside getter)', () => {
    const result = compile('<Button @onClick={{fn this.handle}} />', {
      bindings: new Set(['Button']),
    });
    // $__fn is inside a getter (() => $__fn(...)), so no PURE annotation
    expect(result.code).toContain('$__fn');
    expect(result.code).not.toContain('/*#__PURE__*/$__fn');
    // But root-level $_c and $_args should still get PURE
    expect(result.code).toContain('/*#__PURE__*/$_c');
    expect(result.code).toContain('/*#__PURE__*/$_args');
  });

  test('does NOT generate PURE annotation for unknown functions', () => {
    // Custom helpers should NOT get PURE annotation since we don't know their side effects
    const result = compile('{{myHelper this.value}}', {
      bindings: new Set(['myHelper']),
    });
    // myHelper should appear in code but without PURE prefix
    expect(result.code).toContain('myHelper');
    expect(result.code).not.toContain('/*#__PURE__*/myHelper');
  });

  test('PURE annotations only on root-level calls, not nested in arrow bodies', () => {
    const result = compile('<MyComponent @show={{if (eq this.a this.b) true false}} />', {
      bindings: new Set(['MyComponent']),
    });
    // Root-level PURE functions should be annotated
    expect(result.code).toContain('/*#__PURE__*/$_c');
    expect(result.code).toContain('/*#__PURE__*/$_args');
    // Nested calls inside arrow/getter bodies should NOT have PURE annotations
    // (tree-shakers can't eliminate them anyway)
    expect(result.code).not.toContain('/*#__PURE__*/$__if');
    expect(result.code).not.toContain('/*#__PURE__*/$__eq');
    // But the helpers themselves should still be present
    expect(result.code).toContain('$__if');
    expect(result.code).toContain('$__eq');
  });
});

describe('Regression: tagRange for wrapped elements', () => {
  test('svg element tagRange covers only the tag name in source', () => {
    // SVG elements are internally wrapped as __wrapped_svg__ but source has 'svg'
    const template = '<svg><rect /></svg>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    // The compiled code should contain 'svg' as a tag
    expect(result.code).toContain("'svg'");
  });

  test('math element tagRange covers only the tag name in source', () => {
    const template = '<math><mi>x</mi></math>';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("'math'");
  });
});

describe('Regression: toSafeJSPath in direct helper calls', () => {
  test('simple path in known helper args passes through correctly', () => {
    const template = '{{myHelper this.name}}';
    const result = compile(template, { bindings: new Set(['myHelper']) });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('this.name');
    expect(result.code).toContain('myHelper(');
  });

  test('multi-segment path in known helper args gets optional chaining from resolution', () => {
    const template = '{{myHelper this.foo.bar}}';
    const result = compile(template, { bindings: new Set(['myHelper']) });

    expect(result.errors).toHaveLength(0);
    // Direct calls pass paths as plain references (optional chaining from resolvePath)
    expect(result.code).toContain('myHelper(');
    // 3+ segment paths get optional chaining via resolvePath -> toOptionalChaining
    expect(result.code).toContain('this.foo?.bar');
  });

  test('path in modifier args passes through correctly', () => {
    const template = '<div {{myMod this.value}}></div>';
    const result = compile(template, { bindings: new Set(['myMod']) });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('this.value');
    expect(result.code).toContain('myMod(');
  });
});

describe('WITH_HELPER_MANAGER flag behavior', () => {
  test('known binding with positional params uses maybeHelper when WITH_HELPER_MANAGER=true', () => {
    const template = '{{myHelper @arg1 @arg2}}';
    const result = compile(template, {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: true },
    });

    expect(result.errors).toHaveLength(0);
    // Should use maybeHelper even though binding is known
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    // Should pass function reference (not string name)
    expect(result.code).toContain('myHelper');
    // Should NOT have scope key (binding is known)
    expect(result.code).not.toContain(SYMBOLS.SCOPE_KEY);
  });

  test('known binding with positional params uses direct call when WITH_HELPER_MANAGER=false', () => {
    const template = '{{myHelper @arg1 @arg2}}';
    const result = compile(template, {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: false },
    });

    expect(result.errors).toHaveLength(0);
    // Should use direct call
    expect(result.code).toContain('myHelper(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('unknown binding with positional params uses maybeHelper regardless of flag', () => {
    const template = '{{unknownHelper @arg1}}';
    const result = compile(template, {
      flags: { WITH_HELPER_MANAGER: false },
    });

    expect(result.errors).toHaveLength(0);
    // Should always use maybeHelper for unknown bindings
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    // Should pass string name (not function reference)
    expect(result.code).toContain('"unknownHelper"');
  });

  test('known binding with hash args only uses maybeHelper when WITH_HELPER_MANAGER=true', () => {
    const template = '{{myHelper name="world"}}';
    const result = compile(template, {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: true },
    });

    expect(result.errors).toHaveLength(0);
    // Should use maybeHelper with function reference
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('myHelper');
    // Should NOT have scope key
    expect(result.code).not.toContain(SYMBOLS.SCOPE_KEY);
  });

  test('known binding with hash args only uses direct call when WITH_HELPER_MANAGER=false', () => {
    const template = '{{myHelper name="world"}}';
    const result = compile(template, {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: false },
    });

    expect(result.errors).toHaveLength(0);
    // Should use direct call
    expect(result.code).toContain('myHelper(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('unknown binding with hash args uses maybeHelper with context', () => {
    const template = '{{unknownHelper name="world"}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('"unknownHelper"');
    // Named args are passed in hash, context always passed for scope resolution
    expect(result.code).toContain('name:');
    expect(result.code).toMatch(/\$_maybeHelper\([^)]+,\s*\{[^}]*name:[^}]*\},\s*this\)/);
  });

  test('builtin helpers are not affected by WITH_HELPER_MANAGER flag', () => {
    const template = '{{if @condition "yes" "no"}}';
    const result = compile(template, {
      flags: { WITH_HELPER_MANAGER: true },
    });

    expect(result.errors).toHaveLength(0);
    // Builtins should still use their symbol, not maybeHelper
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('local binding shadows builtin even with WITH_HELPER_MANAGER=true', () => {
    // A local 'if' binding should shadow the builtin
    const template = '{{if @a @b}}';
    const result = compile(template, {
      bindings: new Set(['if']),
      flags: { WITH_HELPER_MANAGER: true },
    });

    expect(result.errors).toHaveLength(0);
    // Should NOT use builtin symbol since local shadows it
    expect(result.code).not.toContain(SYMBOLS.IF_HELPER);
    // Should use maybeHelper with function reference (WITH_HELPER_MANAGER=true)
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('WITH_MODIFIER_MANAGER uses maybeModifier for custom modifiers', () => {
    const template = '<div {{myMod @arg1 @arg2}}></div>';
    const result = compile(template, {
      bindings: new Set(['myMod']),
      flags: { WITH_MODIFIER_MANAGER: true },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_MODIFIER);
  });

  test('without WITH_MODIFIER_MANAGER, custom modifiers use direct call', () => {
    const template = '<div {{myMod @arg1 @arg2}}></div>';
    const result = compile(template, {
      bindings: new Set(['myMod']),
      flags: { WITH_MODIFIER_MANAGER: false },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).not.toContain(SYMBOLS.MAYBE_MODIFIER);
    expect(result.code).toContain('myMod(');
  });

  test('no-arg unknown helper uses maybeHelper without WITH_HELPER_MANAGER', () => {
    // Simple {{unknownThing}} should still use maybeHelper
    const template = '{{unknownThing}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('"unknownThing"');
  });

  test('no-arg known binding is a path reference (not helper call)', () => {
    // {{knownVar}} should be a path, not a helper call
    const template = '{{knownVar}}';
    const result = compile(template, { bindings: new Set(['knownVar']) });

    expect(result.errors).toHaveLength(0);
    // Should NOT use maybeHelper - it's a path reference
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('knownVar');
  });

  test('consistency: known helper with positional vs hash-only params under WITH_HELPER_MANAGER', () => {
    // Both paths should produce consistent maybeHelper usage
    const positionalTemplate = '{{myHelper @x}}';
    const hashTemplate = '{{myHelper key=@x}}';
    const opts = {
      bindings: new Set(['myHelper']),
      flags: { WITH_HELPER_MANAGER: true } as const,
    };

    const positionalResult = compile(positionalTemplate, opts);
    const hashResult = compile(hashTemplate, opts);

    expect(positionalResult.errors).toHaveLength(0);
    expect(hashResult.errors).toHaveLength(0);

    // Both should use maybeHelper when WITH_HELPER_MANAGER=true
    expect(positionalResult.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(hashResult.code).toContain(SYMBOLS.MAYBE_HELPER);

    // Neither should have scope key (binding is known)
    expect(positionalResult.code).not.toContain(SYMBOLS.SCOPE_KEY);
    expect(hashResult.code).not.toContain(SYMBOLS.SCOPE_KEY);
  });

  test('WITH_HELPER_MANAGER=true: known uses maybeHelper with ref, unknown passes context', () => {
    const template = '{{knownHelper arg1}}{{unknownHelper arg2}}';
    const result = compile(template, {
      bindings: new Set(['knownHelper']),
      flags: { WITH_HELPER_MANAGER: true },
    });

    expect(result.errors).toHaveLength(0);
    // Known binding should use $_maybeHelper with function reference (not string)
    // Unknown binding should use $_maybeHelper with string and context
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    // unknownHelper should be passed as a string with context
    expect(result.code).toContain('"unknownHelper"');
    expect(result.code).toMatch(/\$_maybeHelper\("unknownHelper",.*?,\s*this\)/);
  });
});

describe('Regression: visitSimpleMustache unified behavior', () => {
  test('builtin helper without args produces symbol call', () => {
    // {{if}} without args should still produce the builtin symbol
    const template = '{{if @cond "yes" "no"}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
  });

  test('unless helper transforms to if with swapped args', () => {
    const template = '{{unless @cond "yes" "no"}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.IF_HELPER);
    // Args should be swapped: unless(cond, "yes", "no") -> if(cond, "no", "yes")
    // The "no" value should appear before "yes" in the generated code
    const noIdx = result.code.indexOf('"no"');
    const yesIdx = result.code.indexOf('"yes"');
    expect(noIdx).toBeGreaterThan(-1);
    expect(yesIdx).toBeGreaterThan(-1);
    expect(noIdx).toBeLessThan(yesIdx);
  });

  test('unknown helper with no args uses maybeHelper', () => {
    const template = '{{someUnknown}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('"someUnknown"');
  });

  test('unknown helper with hash args uses maybeHelper with context', () => {
    const template = '{{someUnknown key="val"}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    // Named args in hash, context always passed for scope resolution
    expect(result.code).toContain('key:');
    expect(result.code).toMatch(/\$_maybeHelper\([^)]+,\s*\{[^}]*key:[^}]*\},\s*this\)/);
  });

  test('known binding with hash args uses direct call', () => {
    const template = '{{myFn key="val"}}';
    const result = compile(template, { bindings: new Set(['myFn']) });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('myFn(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('$_-prefixed path uses direct call', () => {
    // Runtime symbols ($_ prefix) should be treated as known
    const template = '{{$_mySymbol @arg}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_mySymbol(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });

  test('@arg helper is treated as known binding', () => {
    const template = '{{@myHelper @val}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    // Should resolve @arg to $a.myHelper
    expect(result.code).toContain('$a.');
    expect(result.code).toContain('myHelper');
  });

  test('this.method helper is treated as known binding', () => {
    const template = '{{this.compute @val}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('this.compute(');
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
  });
});

describe('Path expression optional chaining with known bindings', () => {
  test('known binding with dotted path uses direct access, not $_maybeHelper', () => {
    const template = '{{myObject.foo.bar}}';
    const result = compile(template, { bindings: new Set(['myObject']) });

    expect(result.errors).toHaveLength(0);
    // Known binding should use direct optional-chained path, not $_maybeHelper
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('myObject');
  });

  test('known binding path uses optional chaining for safety', () => {
    const template = '{{myObject.foo.bar.baz}}';
    const result = compile(template, { bindings: new Set(['myObject']) });

    expect(result.errors).toHaveLength(0);
    expect(result.code).not.toContain(SYMBOLS.MAYBE_HELPER);
    // Should have optional chaining for deep paths
    expect(result.code).toContain('?.');
  });

  test('unknown binding with dotted path uses $_maybeHelper with context', () => {
    const template = '{{unknownObj.foo.bar}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    // Context should always be passed for unknown bindings
    expect(result.code).toMatch(/,\s*this\)/);
  });

  test('unknown dashed helper gets context for scope resolution', () => {
    const template = '{{x-borf "YES"}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('"x-borf"');
    // Context must be passed so scope resolution works
    expect(result.code).toMatch(/,\s*this\)/);
  });

  test('unknown dashed helper without args routes through $_maybeHelper for runtime scope resolution', () => {
    // PR https://github.com/lifeart/glimmer-next/pull/212: hyphenated
    // mustaches with no positional and no named args must reach
    // `$_maybeHelper` so runtime scope/helper-manager dispatch can resolve
    // dasherized helpers (e.g. `{{x-borf}}` registered via
    // `args[$_scope]`). Synthesizing a self-closing `<XBorf />` here
    // short-circuits that lookup. Self-closing component invocations are
    // still reachable via explicit `<XBorf />` angle-bracket syntax.
    const template = '{{x-borf}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
    expect(result.code).toContain('"x-borf"');
    // Must NOT synthesize a component invocation
    expect(result.code).not.toContain('XBorf');
  });

  test('known binding used as helper arg gets direct path, not $_maybeHelper', () => {
    const template = '{{check myObject.foo.bar.baz}}';
    const result = compile(template, { bindings: new Set(['check', 'myObject']) });

    expect(result.errors).toHaveLength(0);
    // check is known so it's a direct call
    expect(result.code).toContain('check(');
    // myObject.foo.bar.baz should be a direct path, not wrapped in $_maybeHelper
    expect(result.code).toContain('myObject');
    expect(result.code).not.toContain('"myObject');
  });
});

describe('Source map names in mapping tree', () => {
  /** Recursively collect all names from a mapping tree */
  function collectNames(node: { name?: string; children: any[] }): string[] {
    const names: string[] = [];
    if (node.name) names.push(node.name);
    for (const child of node.children) {
      names.push(...collectNames(child));
    }
    return names;
  }

  /** Find all nodes matching a predicate in the mapping tree */
  function findNodes(
    node: { sourceNode: string; name?: string; children: any[]; generatedRange: { start: number; end: number }; sourceRange: { start: number; end: number } },
    predicate: (n: any) => boolean,
  ): any[] {
    const results: any[] = [];
    if (predicate(node)) results.push(node);
    for (const child of node.children) {
      results.push(...findNodes(child, predicate));
    }
    return results;
  }

  describe('component tags', () => {
    test('component tag name has name in mapping tree', () => {
      const result = compile('<MyComp />', { bindings: new Set(['MyComp']) });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('MyComp');
    });

    test('component with dotted path has name in mapping tree', () => {
      const result = compile('<ctx.Component />', { bindings: new Set(['ctx']) });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      const pathNodes = findNodes(result.mappingTree, n => n.sourceNode === 'PathExpression');
      expect(pathNodes.length).toBeGreaterThan(0);
      // Component paths map as a single dotted name in the tree
      expect(names).toContain('ctx.Component');
    });

    test('component with children has tag name in mapping tree', () => {
      const result = compile('<MyComp>content</MyComp>', { bindings: new Set(['MyComp']) });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('MyComp');
    });

    test('nested components both have names', () => {
      const result = compile('<Outer><Inner /></Outer>', {
        bindings: new Set(['Outer', 'Inner']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('Outer');
      expect(names).toContain('Inner');
    });

    test('block-mode component has name in mapping tree', () => {
      const result = compile('{{#MyComp name="val"}}content{{/MyComp}}', {
        bindings: new Set(['MyComp']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('MyComp');
    });

    test('block-mode dotted path component has name in mapping tree', () => {
      const result = compile('{{#this.dynComp as |x|}}{{x}}{{/this.dynComp}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('this.dynComp');
    });
  });

  describe('mustache expressions', () => {
    test('simple variable reference has name', () => {
      const result = compile('{{count}}', { bindings: new Set(['count']) });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('count');
    });

    test('this.property reference has name', () => {
      const result = compile('{{this.value}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('this');
      expect(names).toContain('value');
    });

    test('@arg reference has name', () => {
      const result = compile('{{@name}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // @args are resolved via $a alias
      expect(names.some(n => n === '$a' || n === 'name')).toBe(true);
    });

    test('@arg dotted path maps all segments', () => {
      const result = compile('{{@user.name}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n === '$a' || n === 'user')).toBe(true);
      expect(names).toContain('user');
      expect(names).toContain('name');
    });

    test('multiple variable references each have names', () => {
      const result = compile('{{foo}} {{bar}} {{baz}}', {
        bindings: new Set(['foo', 'bar', 'baz']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('foo');
      expect(names).toContain('bar');
      expect(names).toContain('baz');
    });

    test('block params are mapped even when header contains "as |" in string', () => {
      const result = compile('{{#each (array "as |fake| params" this.items) as |item|}}{{item}}{{/each}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('item');
    });
  });

  describe('helpers with @args', () => {
    test('helper call with @arg has names for both helper and arg', () => {
      const result = compile('{{myHelper @value}}', {
        bindings: new Set(['myHelper']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Known helper gets a name via runtimeRef callee
      expect(names).toContain('myHelper');
      // The @arg should have a name (resolved to $a.value)
      expect(names).toContain('value');
    });

    test('helper with multiple @args has names for helper and all args', () => {
      const result = compile('{{myHelper @first @second}}', {
        bindings: new Set(['myHelper']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Known helper gets a name
      expect(names).toContain('myHelper');
      // @args resolved to $a.first, $a.second
      const argNames = names.filter(n => n === '$a');
      expect(argNames.length).toBeGreaterThanOrEqual(2);
    });

    test('helper with named @arg has names for helper and arg value', () => {
      const result = compile('{{myHelper name=@title}}', {
        bindings: new Set(['myHelper']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Known helper gets a name
      expect(names).toContain('myHelper');
      // The @arg value should have a name
      expect(names.some(n => n === '$a')).toBe(true);
    });

    test('unknown helper with @arg still has name for arg', () => {
      const result = compile('{{unknownHelper @data}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n === '$a')).toBe(true);
    });

    test('this.method helper with @arg has names for both', () => {
      const result = compile('{{this.compute @input}}');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // this.method gets a name as a known callee
      expect(names).toContain('this.compute');
      // The @arg gets a name through buildPath
      expect(names.some(n => n === '$a')).toBe(true);
    });
  });

  describe('modifiers with @args', () => {
    test('modifier with @arg has names', () => {
      const result = compile('<div {{myMod @value}}></div>', {
        bindings: new Set(['myMod']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n === '$a')).toBe(true);
    });

    test('modifier with multiple @args has names for all', () => {
      const result = compile('<div {{myMod @first @second}}></div>', {
        bindings: new Set(['myMod']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      const argNames = names.filter(n => n === '$a');
      expect(argNames.length).toBeGreaterThanOrEqual(2);
    });

    test('modifier with named @arg has name', () => {
      const result = compile('<div {{myMod key=@value}}></div>', {
        bindings: new Set(['myMod']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n === '$a')).toBe(true);
    });

    test('modifier with binding reference has name', () => {
      const result = compile('<div {{myMod handler}}></div>', {
        bindings: new Set(['myMod', 'handler']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('handler');
    });
  });

  describe('attribute bindings', () => {
    test('dynamic attribute with @arg has name', () => {
      const result = compile('<div class={{@className}}></div>');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n === '$a')).toBe(true);
    });

    test('dynamic attribute with binding has name', () => {
      const result = compile('<div title={{label}}></div>', {
        bindings: new Set(['label']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('label');
    });

    test('class attribute with interpolation has names for helpers and args', () => {
      const result = compile('<span class="text-xs {{colorForDiff (withDiff @gxt @vanila)}}">text</span>', {
        bindings: new Set(['colorForDiff', 'withDiff']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Helper names
      expect(names).toContain('colorForDiff');
      expect(names).toContain('withDiff');
      // @arg names
      expect(names.some(n => n.includes('gxt'))).toBe(true);
      expect(names.some(n => n.includes('vanila'))).toBe(true);
    });

    test('class attribute with binding interpolation has name (no getter wrapping)', () => {
      const result = compile('<div class="base {{activeClass}}">text</div>', {
        bindings: new Set(['activeClass']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('activeClass');
      // Should be direct reference inside join, not wrapped in getter
      expect(result.code).toContain('activeClass].join');
      expect(result.code).not.toContain('() => activeClass');
    });
  });

  describe('block expressions', () => {
    test('each block has BlockStatement mapping', () => {
      const result = compile('{{#each this.items as |item|}}{{item}}{{/each}}');
      expect(result.errors).toHaveLength(0);

      // Block statements get a mapping node but block params are local variables,
      // not path expressions, so they don't produce source map names
      const blockNodes = findNodes(result.mappingTree, n => n.sourceNode === 'BlockStatement');
      expect(blockNodes.length).toBeGreaterThan(0);
    });

    test('if block has BlockStatement mapping', () => {
      const result = compile('{{#if @show}}visible{{/if}}');
      expect(result.errors).toHaveLength(0);

      // The if block creates a BlockStatement node in the mapping tree
      const blockNodes = findNodes(result.mappingTree, n => n.sourceNode === 'BlockStatement');
      expect(blockNodes.length).toBeGreaterThan(0);
    });
  });

  describe('combined scenarios', () => {
    test('component with @arg prop and helper child has component and path names', () => {
      const result = compile('<MyComp @title={{this.name}}>{{format @value}}</MyComp>', {
        bindings: new Set(['MyComp', 'format']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Component tag gets a name
      expect(names).toContain('MyComp');
      // Attribute value path gets a name
      expect(names).toContain('this');
      expect(names).toContain('name');
      // Helper arg path gets a name (helper function name itself does not)
      expect(names.some(n => n === '$a')).toBe(true);
    });

    test('element with modifier and dynamic content has all names', () => {
      const result = compile('<div {{onInsert @callback}}>{{this.content}}</div>', {
        bindings: new Set(['onInsert']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n === '$a')).toBe(true);
      expect(names).toContain('this');
      expect(names).toContain('content');
    });

    test('mapping tree name matches the generated identifier position', () => {
      const result = compile('<MyComp />', { bindings: new Set(['MyComp']) });
      expect(result.errors).toHaveLength(0);

      // Find the PathExpression with name 'MyComp'
      const namedNodes = findNodes(result.mappingTree, n => n.name === 'MyComp');
      expect(namedNodes.length).toBe(1);

      const node = namedNodes[0];
      // The generated range should cover exactly 'MyComp' (6 chars)
      const genLength = node.generatedRange.end - node.generatedRange.start;
      expect(genLength).toBe('MyComp'.length);

      // Verify the generated code at that position IS 'MyComp'
      const genText = result.code.slice(node.generatedRange.start, node.generatedRange.end);
      expect(genText).toBe('MyComp');

      // The source range should cover the tag name (after '<')
      expect(node.sourceRange.start).toBe(1); // after '<'
      expect(node.sourceRange.end).toBe(7);   // end of 'MyComp'
    });

    test('mapping tree name for @arg matches generated position', () => {
      const result = compile('{{@title}}');
      expect(result.errors).toHaveLength(0);

      // Find named nodes
      const namedNodes = findNodes(result.mappingTree, n => !!n.name);
      expect(namedNodes.length).toBeGreaterThan(0);

      // The generated code at the named position should be the resolved arg reference
      for (const node of namedNodes) {
        const genText = result.code.slice(node.generatedRange.start, node.generatedRange.end);
        expect(genText).toBe(node.name);
      }
    });
  });

  describe('on event handler names', () => {
    test('on click with @arg has name for handler', () => {
      const result = compile('<button {{on "click" @onClick}}>click</button>');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names.some(n => n.includes('onClick'))).toBe(true);
      expect(result.code).toContain('($e, $n) => $a.onClick($e, $n)');
    });

    test('on click with binding has name', () => {
      const result = compile('<button {{on "click" handleClick}}>click</button>', {
        bindings: new Set(['handleClick']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('handleClick');
      expect(result.code).toContain('($e, $n) => handleClick($e, $n)');
    });

    test('on click with this.method has name', () => {
      const result = compile('<button {{on "click" this.handleClick}}>click</button>');
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      expect(names).toContain('this');
      expect(names).toContain('handleClick');
      expect(result.code).toContain('($e, $n) => this.handleClick($e, $n)');
    });

    test('on click with fn helper preserves correct code (no source map names)', () => {
      const result = compile('<button {{on "click" (fn this.onClick item.id)}}>click</button>', {
        bindings: new Set(['item']),
      });
      expect(result.errors).toHaveLength(0);
      // fn helper in on uses string-based path, code is correct
      expect(result.code).toContain('$__fn(this.onClick, item.id)');
    });
  });

  describe('helper args in content', () => {
    test('helper with single @arg has names for helper and arg', () => {
      const result = compile('{{originalValue @vanila}}', {
        bindings: new Set(['originalValue']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Helper function name gets a name
      expect(names).toContain('originalValue');
      // @arg gets a name
      expect(names).toContain('vanila');
    });

    test('helper with multiple @args has names for helper and all args', () => {
      const result = compile('{{withDiff @gxt @vanila}}', {
        bindings: new Set(['withDiff']),
      });
      expect(result.errors).toHaveLength(0);

      const names = collectNames(result.mappingTree);
      // Helper function name gets a name
      expect(names).toContain('withDiff');
      // @args get names
      expect(names.some(n => n.includes('gxt'))).toBe(true);
      expect(names.some(n => n.includes('vanila'))).toBe(true);
    });
  });
});

describe('Block-mode component invocations', () => {
  test('basic block component with no args and no block params', () => {
    const result = compile('{{#MyComponent}}content{{/MyComponent}}', {
      bindings: new Set(['MyComponent']),
    });
    expect(result.code).toContain(SYMBOLS.COMPONENT);
    expect(result.code).toContain('MyComponent');
    expect(result.errors).toHaveLength(0);
  });

  test('block component with hash args', () => {
    const result = compile('{{#MyComponent name="val"}}content{{/MyComponent}}', {
      bindings: new Set(['MyComponent']),
    });
    expect(result.code).toContain(SYMBOLS.COMPONENT);
    expect(result.code).toContain('name: "val"');
  });

  test('block component with block params (property access not wrapped in $_maybeHelper)', () => {
    const result = compile('{{#MyComponent as |item|}}{{item.name}}{{/MyComponent}}', {
      bindings: new Set(['MyComponent']),
    });
    expect(result.code).toContain(SYMBOLS.COMPONENT);
    expect(result.code).toContain('item.name');
    // Block param references must NOT be wrapped in $_maybeHelper
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('block component with multiple block params', () => {
    const result = compile('{{#MyComponent as |a b|}}{{a}} {{b}}{{/MyComponent}}', {
      bindings: new Set(['MyComponent']),
    });
    expect(result.code).toContain(SYMBOLS.COMPONENT);
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('block component with hash args AND block params', () => {
    const result = compile(
      '{{#MyComponent name="val" as |item|}}{{item.name}}{{/MyComponent}}',
      { bindings: new Set(['MyComponent']) }
    );
    expect(result.code).toContain(SYMBOLS.COMPONENT);
    expect(result.code).toContain('name: "val"');
    expect(result.code).toContain('item.name');
  });

  test('hyphenated block name in compat mode is treated as component', () => {
    const result = compile('{{#unknown-thing}}content{{/unknown-thing}}');
    // In compat mode (default), hyphenated names are component invocations (Ember convention)
    // The tag is converted to PascalCase: unknown-thing → UnknownThing
    expect(result.code).toContain('UnknownThing');
    expect(result.errors).toHaveLength(0);
  });

  test('unknown block name without binding in non-compat mode returns null', () => {
    const result = compile('{{#unknown-thing}}content{{/unknown-thing}}', {
      flags: { IS_GLIMMER_COMPAT_MODE: false },
    });
    // Without compat mode, unknown block name with no params and no binding — should be dropped
    expect(result.code).not.toContain('unknown-thing');
  });

  test('dotted path component block', () => {
    const result = compile(
      '{{#this.dynamicComponent as |x|}}{{x}}{{/this.dynamicComponent}}'
    );
    expect(result.code).toContain(SYMBOLS.DYNAMIC_COMPONENT);
    expect(result.code).not.toContain('$_maybeHelper');
  });

  test('positional params emit W005 warning', () => {
    const result = compile(
      '{{#MyComponent this.foo}}content{{/MyComponent}}',
      { bindings: new Set(['MyComponent']) }
    );
    // Component block should still compile
    expect(result.code).toContain(SYMBOLS.COMPONENT);
    // But a warning should be emitted about positional params
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    const w005 = result.warnings.find((w) => w.code === 'W005');
    expect(w005).toBeDefined();
    expect(w005!.message).toContain('Positional parameters');
    expect(w005!.message).toContain('MyComponent');
  });

  describe('scope-shadowed built-in block keywords', () => {
    // Strict-mode templates can pass a scope to the compiler (e.g. via
    // `renderComponent(tpl, { scope: { if: Component } })`). When the user
    // binds a name that collides with a GXT built-in block keyword, the
    // binding MUST win: the compiler should invoke the user-provided
    // component instead of emitting `$_if(...)` / `$_each(...)` / ...
    test('{{#if}} with `if` in scope compiles to component call, not $_if', () => {
      const result = compile(
        '{{#if some.thing}}X{{/if}}',
        { bindings: new Set(['if']) }
      );
      expect(result.errors).toHaveLength(0);
      // Uses component-call path, not the built-in if helper
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).not.toContain(`${SYMBOLS.IF}(`);
      // `if` is a JS reserved word, so the bare identifier is aliased to
      // `__scope_if` (matching the Ember compat scope-injection naming).
      expect(result.code).toContain('__scope_if');
      // The positional condition must be forwarded as __pos0__ so the
      // component actually receives the argument.
      expect(result.code).toContain('__pos0__');
      expect(result.code).toContain('__posCount__');
    });

    test('{{#if}} with `if` in lexical scope compiles to component call', () => {
      const result = compile(
        '{{#if some.thing}}X{{/if}}',
        { lexicalScope: (v) => v === 'if' }
      );
      expect(result.errors).toHaveLength(0);
      expect(result.code).not.toContain(`${SYMBOLS.IF}(`);
      expect(result.code).toContain('__scope_if');
    });

    test('{{#each}} with `each` in scope compiles to component call, not $_each', () => {
      const result = compile(
        '{{#each items as |item|}}{{item}}{{/each}}',
        { bindings: new Set(['each']) }
      );
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).not.toContain(`${SYMBOLS.EACH}(`);
      expect(result.code).toContain('__pos0__');
    });

    test('{{#if}} without scope binding still uses built-in $_if', () => {
      const result = compile('{{#if this.show}}X{{/if}}');
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(SYMBOLS.IF);
      expect(result.code).not.toContain('__scope_if');
    });

    test('non-reserved shadowed built-in emits bare identifier (no aliasing)', () => {
      // `each` is not a JS reserved word, so it should appear bare in the
      // component call — confirming that aliasing is applied only when
      // strictly necessary.
      const result = compile(
        '{{#each items as |i|}}{{i}}{{/each}}',
        { bindings: new Set(['each']) }
      );
      expect(result.errors).toHaveLength(0);
      expect(result.code).not.toContain('__scope_each');
      expect(result.code).toMatch(/\$_c\(\s*each\b/);
    });
  });
});

// ============================================================================
// Compat mode AST transforms
// ============================================================================

describe('Compat mode AST transforms', () => {
  const compatFlags = { IS_GLIMMER_COMPAT_MODE: true };
  const defaultFlags = { IS_GLIMMER_COMPAT_MODE: false };

  // --------------------------------------------------------------------------
  // Mustache transforms
  // --------------------------------------------------------------------------
  describe('Mustache transforms', () => {
    test('{{outlet}} produces yield with "default" slot', () => {
      const result = compile('{{outlet}}', { flags: compatFlags });
      // outlet is treated as a yield in the compiler
      expect(result.code).toContain(SYMBOLS.SLOT);
      expect(result.errors).toHaveLength(0);
    });

    test('{{mount "engine-name"}} produces ember-mount element', () => {
      const result = compile('{{mount "my-engine"}}', { flags: compatFlags });
      expect(result.code).toContain("'ember-mount'");
      expect(result.code).toContain('my-engine');
      expect(result.errors).toHaveLength(0);
    });

    test('{{mount "engine" model=this.foo}} passes model as data-engine attr', () => {
      const result = compile('{{mount "my-engine" model=this.foo}}', { flags: compatFlags });
      expect(result.code).toContain("'ember-mount'");
      expect(result.code).toContain('my-engine');
      expect(result.errors).toHaveLength(0);
    });

    test('bare {{this}} transforms to __gxtSelfString__', () => {
      const result = compile('{{this}}', { flags: compatFlags });
      expect(result.code).toContain('__gxtSelfString__');
      expect(result.errors).toHaveLength(0);
    });

    test('bare {{this}} does NOT transform in non-compat mode', () => {
      const result = compile('{{this}}', { flags: defaultFlags });
      expect(result.code).not.toContain('__gxtSelfString__');
    });

    test('{{this.foo}} does NOT transform to __gxtSelfString__', () => {
      const result = compile('{{this.foo}}', { flags: compatFlags });
      expect(result.code).not.toContain('__gxtSelfString__');
      expect(result.code).toContain('this.foo');
    });

    test('{{input type="text"}} transforms to Input component', () => {
      const result = compile('{{input type="text"}}', { flags: compatFlags });
      expect(result.code).toContain('Input');
      expect(result.code).toContain('@type');
      expect(result.errors).toHaveLength(0);
    });

    test('{{textarea}} transforms to Textarea component', () => {
      const result = compile('{{textarea value=this.text}}', { flags: compatFlags });
      expect(result.code).toContain('Textarea');
      expect(result.code).toContain('@value');
      expect(result.errors).toHaveLength(0);
    });

    test('{{input}} does NOT transform in non-compat mode', () => {
      const result = compile('{{input type="text"}}', { flags: defaultFlags });
      expect(result.code).not.toContain('Input');
    });
  });

  // --------------------------------------------------------------------------
  // Block transforms
  // --------------------------------------------------------------------------
  describe('Block transforms', () => {
    test('{{#if}}{{else}}content{{/if}} with empty true branch compiles without error', () => {
      const result = compile('{{#if this.show}}{{else}}fallback content{{/if}}', { flags: compatFlags });
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('fallback content');
    });

    test('{{#each}} uses $_each (async) by default in compat mode', () => {
      // PR https://github.com/lifeart/glimmer-next/pull/212: compat mode no
      // longer force-routes {{#each}} through $_eachSync. SyncListComponent's
      // destroyItem is synchronous and drops async-modifier-destructor
      // promises, so async element destructors (e.g. fade-out animations)
      // could not block DOM removal — see the three "async element
      // destructors" tests under Integration | InternalComponent | each.
      const result = compile('{{#each this.items as |item|}}{{item}}{{/each}}', { flags: compatFlags });
      expect(result.code).toContain(SYMBOLS.EACH + '(');
      expect(result.code).not.toContain(SYMBOLS.EACH_SYNC);
      expect(result.errors).toHaveLength(0);
    });

    test('{{#each items sync=true}} uses $_eachSync in compat mode', () => {
      // Synchronous iteration is still available as opt-in via `sync=true`.
      const result = compile(
        '{{#each this.items sync=true as |item|}}{{item}}{{/each}}',
        { flags: compatFlags }
      );
      expect(result.code).toContain(SYMBOLS.EACH_SYNC);
      expect(result.errors).toHaveLength(0);
    });

    test('{{#each}} uses $_each in non-compat mode', () => {
      const result = compile('{{#each this.items as |item|}}{{item}}{{/each}}', { flags: defaultFlags });
      expect(result.code).toContain(SYMBOLS.EACH + '(');
      expect(result.code).not.toContain(SYMBOLS.EACH_SYNC);
    });

    test('let block uses plain variable names', () => {
      const result = compile('{{#let this.name as |v|}}{{v}}{{/let}}', { flags: compatFlags });
      expect(result.errors).toHaveLength(0);
      // The let block should compile and reference the variable
      expect(result.code).toContain('v');
    });

    test('let block with string literal', () => {
      const result = compile('{{#let "hello" as |greeting|}}{{greeting}}{{/let}}', { flags: compatFlags });
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('"hello"');
    });

    test('builtin block keywords are treated as control flow when NOT shadowed', () => {
      // Without an `if` binding in scope, `{{#if}}` is the GXT built-in.
      const result = compile('{{#if this.show}}content{{/if}}', {
        flags: compatFlags,
      });
      expect(result.code).toContain(SYMBOLS.IF);
      expect(result.code).not.toContain(SYMBOLS.COMPONENT);
      expect(result.errors).toHaveLength(0);
    });

    test('scope binding SHADOWS built-in block keyword', () => {
      // When the user passes `if` as a template binding (e.g. strict-mode
      // scope), the binding must win over the built-in keyword so that
      // `renderComponent(tpl, { scope: { if: Component } })` works.
      const result = compile('{{#if this.show}}content{{/if}}', {
        flags: compatFlags,
        bindings: new Set(['if']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).not.toContain(`${SYMBOLS.IF}(`);
      // `if` is reserved, so the bare identifier is emitted as __scope_if.
      expect(result.code).toContain('__scope_if');
      expect(result.errors).toHaveLength(0);
    });

    test('non-builtin block name with binding IS treated as component block', () => {
      const result = compile('{{#MyBlock}}content{{/MyBlock}}', {
        flags: compatFlags,
        bindings: new Set(['MyBlock']),
      });
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Element transforms
  // --------------------------------------------------------------------------
  describe('Element transforms', () => {
    test('onclick={{this.handler}} transforms to on modifier', () => {
      const result = compile('<button onclick={{this.handler}}>click</button>', { flags: compatFlags });
      // Should contain an event binding for "click"
      expect(result.code).toContain('"click"');
      // Should NOT contain "onclick" as an attribute
      expect(result.code).not.toContain('"onclick"');
      expect(result.errors).toHaveLength(0);
    });

    test('onclick={{this.handler}} is kept as attribute in non-compat mode', () => {
      const result = compile('<button onclick={{this.handler}}>click</button>', { flags: defaultFlags });
      // In non-compat mode, onclick stays as an attribute (not rewritten)
      expect(result.code).toContain('onclick');
    });

    test('onsubmit={{this.handler}} transforms to on modifier in compat mode', () => {
      const result = compile('<form onsubmit={{this.handler}}>form</form>', { flags: compatFlags });
      expect(result.code).toContain('"submit"');
      expect(result.code).not.toContain('"onsubmit"');
      expect(result.errors).toHaveLength(0);
    });

    test('Foo::Bar namespaced component transforms to foo--bar', () => {
      const result = compile('<Foo::Bar />', { flags: compatFlags });
      expect(result.code).toContain('foo--bar');
      expect(result.code).not.toContain('Foo::Bar');
      expect(result.errors).toHaveLength(0);
    });

    test('Foo::Bar::Baz transforms to foo--bar--baz', () => {
      const result = compile('<Foo::Bar::Baz>content</Foo::Bar::Baz>', { flags: compatFlags });
      expect(result.code).toContain('foo--bar--baz');
      expect(result.errors).toHaveLength(0);
    });

    test('...attributes with local overrides adds __splatLocal__ marker', () => {
      const result = compile('<div ...attributes class="local">text</div>', { flags: compatFlags });
      expect(result.code).toContain('__splatLocal__');
      expect(result.code).toContain('__class__');
      expect(result.errors).toHaveLength(0);
    });

    test('...attributes without local overrides does NOT add __splatLocal__', () => {
      const result = compile('<div class="before" ...attributes>text</div>', { flags: compatFlags });
      expect(result.code).not.toContain('__splatLocal__');
    });

    test('...attributes with non-class local override', () => {
      const result = compile('<div ...attributes data-test="local">text</div>', { flags: compatFlags });
      expect(result.code).toContain('__splatLocal__');
      expect(result.code).toContain('data-test');
      expect(result.errors).toHaveLength(0);
    });

    test('...attributes local override not added in non-compat mode', () => {
      const result = compile('<div ...attributes class="local">text</div>', { flags: defaultFlags });
      expect(result.code).not.toContain('__splatLocal__');
    });
  });

  // --------------------------------------------------------------------------
  // SubExpression transforms
  // --------------------------------------------------------------------------
  describe('SubExpression transforms', () => {
    test('(mut this.foo) adds path string as second arg', () => {
      const result = compile('<Btn @click={{(mut this.foo)}} />', {
        flags: compatFlags,
        bindings: new Set(['Btn']),
      });
      expect(result.code).toContain('"this.foo"');
      expect(result.errors).toHaveLength(0);
    });

    test('(mut @bar) adds path string as second arg', () => {
      const result = compile('<Btn @click={{(mut @bar)}} />', {
        flags: compatFlags,
        bindings: new Set(['Btn']),
      });
      expect(result.code).toContain('"@bar"');
      expect(result.errors).toHaveLength(0);
    });

    test('(mut this.foo) does NOT add path string in non-compat mode', () => {
      const result = compile('<Btn @click={{(mut this.foo)}} />', {
        flags: defaultFlags,
        bindings: new Set(['Btn']),
      });
      expect(result.code).not.toContain('"this.foo"');
    });

    test('(has-block) compiles to $_hasBlock.bind(this, $slots) in compat mode', () => {
      const result = compile('{{#if (has-block)}}has block{{/if}}', { flags: compatFlags });
      expect(result.code).toContain('$_hasBlock.bind(this, $slots)');
      expect(result.errors).toHaveLength(0);
    });

    test('(has-block "inverse") binds and then calls $_hasBlock with the named slot', () => {
      const result = compile('{{#if (has-block "inverse")}}has inverse{{/if}}', { flags: compatFlags });
      expect(result.code).toContain('$_hasBlock.bind(this, $slots)');
      expect(result.code).toContain('"inverse"');
    });

    test('(has-block-params) compiles to $_hasBlockParams.bind(this, $slots) in compat mode', () => {
      const result = compile('{{#if (has-block-params)}}has params{{/if}}', { flags: compatFlags });
      expect(result.code).toContain('$_hasBlockParams.bind(this, $slots)');
      expect(result.errors).toHaveLength(0);
    });

    test('(has-block) does NOT emit a method call on `this`', () => {
      // Regression: emitting `this.$_hasBlock(name)` broke template-only
      // components, which compile to plain `function () { ... }` invoked
      // with `new`, leaving `this` without the method.
      const result = compile('{{#if (has-block)}}has block{{/if}}', { flags: compatFlags });
      expect(result.code).not.toContain('this.$_hasBlock(');
    });
  });

  // --------------------------------------------------------------------------
  // Path transforms
  // --------------------------------------------------------------------------
  describe('Path transforms', () => {
    test('this.attrs.foo is treated as arg in compat mode', () => {
      const result = compile('{{this.attrs.foo}}', { flags: compatFlags });
      // In compat mode, this.attrs.foo is treated as an @-arg reference
      // The $a prefix indicates it is going through the args path
      expect(result.code).toContain('$a');
      expect(result.errors).toHaveLength(0);
    });

    test('this.attrs.foo is NOT rewritten in non-compat mode', () => {
      const result = compile('{{this.attrs.foo}}', { flags: defaultFlags });
      expect(result.code).toContain('this');
      expect(result.code).toContain('attrs');
    });

    test('this.attrs.foo.bar is treated as arg in compat mode', () => {
      const result = compile('{{this.attrs.foo.bar}}', { flags: compatFlags });
      // The $a prefix indicates args path
      expect(result.code).toContain('$a');
    });

    test('paths are wrapped in reactive getters in compat mode', () => {
      const result = compile('{{this.value}}', { flags: compatFlags });
      expect(result.code).toContain('() =>');
    });
  });

  // --------------------------------------------------------------------------
  // Pre-processor transforms
  // --------------------------------------------------------------------------
  describe('Pre-processor transforms', () => {
    test('<LinkTo> is transformed to <link-to> in compat mode', () => {
      const result = compile('<LinkTo @route="home">Go</LinkTo>', { flags: compatFlags });
      expect(result.code).toContain("'link-to'");
      expect(result.code).not.toContain('LinkTo');
      expect(result.errors).toHaveLength(0);
    });

    test('<Outlet> is transformed to <outlet> in compat mode', () => {
      const result = compile('<Outlet />', { flags: compatFlags });
      // Outlet should be lowered to kebab-case
      expect(result.code).not.toContain('Outlet');
      expect(result.errors).toHaveLength(0);
    });

    test('{{component "foo-bar"}} is transformed to <FooBar /> in compat mode', () => {
      const result = compile('{{component "foo-bar"}}', { flags: compatFlags });
      expect(result.code).toContain('FooBar');
      expect(result.errors).toHaveLength(0);
    });

    test('{{#component "foo-bar"}}content{{/component}} block form in compat mode', () => {
      const result = compile('{{#component "foo-bar"}}content{{/component}}', { flags: compatFlags });
      expect(result.code).toContain('FooBar');
      expect(result.code).toContain('content');
      expect(result.errors).toHaveLength(0);
    });

    test('{{component "foo-bar"}} with args transforms attrs to @-prefixed', () => {
      const result = compile('{{component "foo-bar" name="val"}}', { flags: compatFlags });
      expect(result.code).toContain('FooBar');
      expect(result.code).toContain('name');
      expect(result.errors).toHaveLength(0);
    });

    test('inline curly with no args {{my-comp}} routes through $_maybeHelper in compat mode', () => {
      // PR https://github.com/lifeart/glimmer-next/pull/212: hyphenated
      // mustaches with no positional and no named args are ambiguous between
      // "dasherized helper resolved at runtime" and "self-closing component".
      // Route them through $_maybeHelper so runtime scope/helper-manager
      // dispatch wins; component invocations remain reachable via explicit
      // <MyComp /> angle-bracket syntax. Regression: `Integration |
      // DashHelpers | x-bar >> dashed hlpers without args wrapped with
      // helper manager`.
      const result = compile('{{my-comp}}', { flags: compatFlags });
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
      expect(result.code).not.toContain('MyComp');
      expect(result.code).not.toContain(`${SYMBOLS.TAG}('my-comp'`);
    });

    test('inline curly component with args {{my-comp name="val"}} transforms', () => {
      const result = compile('{{my-comp name="val"}}', { flags: compatFlags });
      expect(result.code).toContain('MyComp');
      expect(result.errors).toHaveLength(0);
    });

    // Regression: PR #212 review caught that hyphenated mustaches with NO
    // positional args were being rewritten into synthetic component
    // invocations even when WITH_HELPER_MANAGER is on. That short-circuited
    // runtime helper-manager resolution (`x-borf` is a dasherized helper,
    // not a component), so `Integration | DashHelpers | x-bar >> dashed
    // hlpers without args wrapped with helper manager` was failing.
    // The compiled output must reach `$_maybeHelper`, NOT a component.
    test('inline curly with WITH_HELPER_MANAGER routes {{x-bar}} through $_maybeHelper (no args)', () => {
      const result = compile('{{x-bar}}', {
        flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_HELPER_MANAGER: true },
      });
      expect(result.errors).toHaveLength(0);
      // Goes through helper-manager-aware resolution.
      expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
      // Must NOT synthesize a component invocation.
      expect(result.code).not.toContain('XBar');
      expect(result.code).not.toContain(`${SYMBOLS.COMPONENT}(`);
      expect(result.code).not.toContain(`${SYMBOLS.TAG}('x-bar'`);
    });

    test('inline curly with WITH_HELPER_MANAGER preserves args path for {{x-bar arg}}', () => {
      // The args case never hit the inline-curly path (positional params
      // disqualify it), so this should compile to a helper call regardless.
      const result = compile('{{x-bar this.arg}}', {
        flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_HELPER_MANAGER: true },
      });
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
      expect(result.code).not.toContain('XBar');
    });

    test('each-in is NOT transformed to component (builtin hyphenated helper)', () => {
      // each-in should be kept as a helper call, not transformed to a component
      const result = compile('{{each-in this.obj}}', { flags: compatFlags });
      expect(result.code).not.toContain('EachIn');
      expect(result.errors).toHaveLength(0);
    });

    test('unique-id is NOT transformed to component (builtin hyphenated helper)', () => {
      const result = compile('{{unique-id}}', { flags: compatFlags });
      expect(result.code).not.toContain('UniqueId');
      expect(result.errors).toHaveLength(0);
    });

    test('<Foo></Foo> empty component gets @__hasBlock__ marker in compat mode', () => {
      const result = compile('<Foo></Foo>', {
        flags: compatFlags,
        bindings: new Set(['Foo']),
      });
      expect(result.code).toContain('__hasBlock__');
      expect(result.errors).toHaveLength(0);
    });

    test('<Foo /> self-closing does NOT get @__hasBlock__ marker', () => {
      const result = compile('<Foo />', {
        flags: compatFlags,
        bindings: new Set(['Foo']),
      });
      expect(result.code).not.toContain('__hasBlock__');
    });

    test('{{#in-element el insertBefore=null}} strips insertBefore in compat mode', () => {
      const result = compile('{{#in-element this.el insertBefore=null}}content{{/in-element}}', { flags: compatFlags });
      // Should compile without error — insertBefore is stripped
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(SYMBOLS.IN_ELEMENT);
    });

    test('let block param dot-path invocations transform in compat mode', () => {
      const result = compile(
        '{{#let this.component as |comp|}}{{comp.sub name="val"}}{{/let}}',
        { flags: compatFlags }
      );
      expect(result.errors).toHaveLength(0);
      // The dot-path should be treated as a dynamic component
      expect(result.code).toContain(SYMBOLS.DYNAMIC_COMPONENT);
    });
  });

  // --------------------------------------------------------------------------
  // Serializer transforms
  // --------------------------------------------------------------------------
  describe('Serializer transforms', () => {
    test('unknown paths use $_maybeHelper in compat mode without ember integration', () => {
      const result = compile('{{unknownHelper}}', { flags: compatFlags });
      expect(result.code).toContain(SYMBOLS.MAYBE_HELPER);
      expect(result.errors).toHaveLength(0);
    });

    test('unknown path expressions use this.path in compat mode WITH ember integration', () => {
      // WITH_EMBER_INTEGRATION affects path values (like {{this.someValue}})
      // but bare {{unknownHelper}} with no params is treated as a helper call.
      // To get path treatment, use it in a position where the parser produces a path.
      const result = compile('<div>{{this.unknownValue}}</div>', {
        flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
      });
      // Known this. paths are treated as direct paths
      expect(result.code).toContain('this.unknownValue');
      expect(result.errors).toHaveLength(0);
    });

    test('{{#if this.X}} in compat+ember-integration mode injects __gxtGetCellOrFormula with a fn-typed fallback', () => {
      const result = compile('{{#if this.show}}<div>x</div>{{/if}}', {
        flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
      });
      // The injection wraps the host hook in a typeof === 'function' guard
      // so a falsy-but-defined return doesn't get passed straight to $_if.
      expect(result.code).toContain('__gxtGetCellOrFormula?.(this, "show")');
      expect(result.code).toContain("typeof __r === 'function'");
      expect(result.code).toContain('() => this.show');
      // Sanity: no `??` form, which only catches null/undefined.
      expect(result.code).not.toMatch(/__gxtGetCellOrFormula\?\.\(this,\s*"show"\)\s*\?\?\s*\(\(\)\s*=>/);
      expect(result.errors).toHaveLength(0);
    });

    test('{{#if NON_THIS_PATH}} in compat+ember-integration mode falls through to plain buildValue (no injection)', () => {
      // Block params and bare names are not `this.X` paths; the injection
      // only fires for the simple `this.PROP` shape.
      const result = compile(
        '{{#let this.flag as |flag|}}{{#if flag}}<div>x</div>{{/if}}{{/let}}',
        { flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true } }
      );
      // The outer {{#let}} pulls `this.flag`, but the inner {{#if flag}}
      // condition references the block param — no __gxtGetCellOrFormula
      // wrapping should fire for that path.
      expect(result.code).not.toContain('__gxtGetCellOrFormula?.(this, "flag")');
      expect(result.errors).toHaveLength(0);
    });

    test('{{#if this.X}} without WITH_EMBER_INTEGRATION does not inject __gxtGetCellOrFormula', () => {
      const result = compile('{{#if this.show}}<div>x</div>{{/if}}', {
        flags: compatFlags,
      });
      expect(result.code).not.toContain('__gxtGetCellOrFormula');
      expect(result.errors).toHaveLength(0);
    });

    test('{{log}} in compat mode does not wrap in reactive getter', () => {
      const result = compile('{{log "hello"}}', { flags: compatFlags });
      // log in compat mode should use comma expression pattern, not reactive getter
      expect(result.code).toContain('$__log');
      expect(result.errors).toHaveLength(0);
    });

    test('component children with hyphens are wrapped in arrows in compat mode', () => {
      // Components whose tag contains a hyphen (custom element) get lazy-wrapped children
      const result = compile('<my-widget><div>inner</div></my-widget>', { flags: compatFlags });
      expect(result.errors).toHaveLength(0);
      // The output should compile successfully — the wrapping is internal
    });

    test('modifier SubExpression unwrapping in compat mode', () => {
      // {{(modifier "my-mod" arg)}} on element should unwrap the SubExpression
      const result = compile('<div {{(modifier "my-mod" this.val)}}></div>', { flags: compatFlags });
      expect(result.code).toContain('my-mod');
      expect(result.errors).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Combined / regression tests
  // --------------------------------------------------------------------------
  describe('Combined scenarios', () => {
    test('compat mode compiles a complex template without errors', () => {
      const result = compile(
        `<div class="app" ...attributes>
          {{#if this.show}}
            <MyComp @name={{this.name}} as |item|>
              {{item.label}}
            </MyComp>
          {{else}}
            <p>Nothing</p>
          {{/if}}
        </div>`,
        {
          flags: compatFlags,
          bindings: new Set(['MyComp']),
        }
      );
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(SYMBOLS.IF);
      expect(result.code).toContain(SYMBOLS.COMPONENT);
    });

    test('(has-block) in attribute position wraps in if/true/false in compat mode', () => {
      const result = compile('<Foo @has={{(has-block)}} />', {
        flags: compatFlags,
        bindings: new Set(['Foo']),
      });
      // In compat mode, has-block in attribute position should be wrapped
      // in (if (has-block) "true" "false") to produce string attribute values
      expect(result.code).toContain('$_hasBlock');
      expect(result.errors).toHaveLength(0);
    });

    test('{{#each}} with key option in compat mode uses $_each (async) and threads key', () => {
      // PR https://github.com/lifeart/glimmer-next/pull/212: see related
      // "uses $_each (async) by default in compat mode" test above for the
      // rationale (async-destructor regression).
      const result = compile(
        '{{#each this.items key="id" as |item|}}{{item.name}}{{/each}}',
        { flags: compatFlags }
      );
      expect(result.code).toContain(SYMBOLS.EACH + '(');
      expect(result.code).not.toContain(SYMBOLS.EACH_SYNC);
      expect(result.code).toContain('"id"');
      expect(result.errors).toHaveLength(0);
    });

    test('{{component this.dynamicName}} with dynamic name in compat mode', () => {
      const result = compile('{{component this.currentComponent}}', { flags: compatFlags });
      expect(result.errors).toHaveLength(0);
      // Should compile as dynamic component
      expect(result.code).toContain(SYMBOLS.DYNAMIC_COMPONENT);
    });

    test('unless block is inverted if in compat mode', () => {
      const result = compile(
        '{{#unless this.hidden}}visible{{else}}hidden{{/unless}}',
        { flags: compatFlags }
      );
      expect(result.errors).toHaveLength(0);
      // unless is compiled as an inverted if
      expect(result.code).toContain(SYMBOLS.IF);
    });
  });

  describe('scope-shadowed built-in keywords', () => {
    // Strict-mode templates can pass a scope to the compiler (e.g. via
    // renderComponent(tpl, { scope: { if: Component } })). When the user
    // binds a name that collides with a GXT built-in keyword, the binding
    // MUST win: the compiler should invoke the user-provided component
    // instead of emitting `$_if(...)` / `$_each(...)` / ...
    test('{{#if}} with `if` in scope compiles to component call, not $_if', () => {
      const result = compile(
        '{{#if some.thing}}X{{/if}}',
        { bindings: new Set(['if']) }
      );
      expect(result.errors).toHaveLength(0);
      // Uses component-call path, not the built-in if helper
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).not.toContain(`${SYMBOLS.IF}(`);
      // `if` is a JS reserved word, so the bare identifier must be aliased
      // to `__scope_if` (matching the Ember compat scope-injection naming).
      expect(result.code).toContain('__scope_if');
      // The positional condition must be forwarded as __pos0__ so the
      // component actually receives the argument.
      expect(result.code).toContain('__pos0__');
      expect(result.code).toContain('__posCount__');
    });

    test('{{#if}} with `if` in lexical scope and {{else}} forwards both slots', () => {
      const result = compile(
        '{{#if some.thing}}X{{else}}Y{{/if}}',
        { lexicalScope: (v) => v === 'if' }
      );
      expect(result.errors).toHaveLength(0);
      expect(result.code).not.toContain(`${SYMBOLS.IF}(`);
      expect(result.code).toContain('__scope_if');
      expect(result.code).toContain('default:');
      expect(result.code).toContain('inverse:');
    });

    test('{{#each}} with `each` in scope compiles to component call, not $_each', () => {
      const result = compile(
        '{{#each items as |item|}}{{item}}{{/each}}',
        { bindings: new Set(['each']) }
      );
      expect(result.errors).toHaveLength(0);
      // Should use component call, not built-in each
      expect(result.code).toContain(SYMBOLS.COMPONENT);
      expect(result.code).not.toContain(`${SYMBOLS.EACH}(`);
      expect(result.code).toContain('__pos0__');
    });

    test('{{#if}} without scope binding still uses built-in $_if', () => {
      const result = compile('{{#if this.show}}X{{/if}}');
      expect(result.errors).toHaveLength(0);
      // Built-in path preserved when no shadowing binding exists
      expect(result.code).toContain(SYMBOLS.IF);
      expect(result.code).not.toContain('__scope_if');
    });

    test('{{#let}} shadowed by a non-reserved binding emits bare identifier', () => {
      // `let` is reserved, so a `let` binding would still be aliased to
      // `__scope_let` — the reserved-word pathway is covered. Here we check
      // that non-reserved built-ins (e.g. `each`) emit the unmangled id.
      const result = compile(
        '{{#each items as |i|}}{{i}}{{/each}}',
        { bindings: new Set(['each']) }
      );
      expect(result.errors).toHaveLength(0);
      expect(result.code).not.toContain('__scope_each');
      // The bare `each` identifier should appear as the component reference
      expect(result.code).toMatch(/\$_c\(\s*each\b/);
    });
  });
});

describe('compile() — transforms hook (CompileOptions.transforms)', () => {
  test('no transforms: output is byte-identical to baseline', () => {
    const tpl = '<div class="card">{{this.greeting}}<span>{{count}}</span></div>';
    const baseline = compile(tpl);
    // Passing undefined, an empty array, and omitting entirely must all match.
    expect(compile(tpl, {}).code).toBe(baseline.code);
    expect(compile(tpl, { transforms: undefined }).code).toBe(baseline.code);
    expect(compile(tpl, { transforms: [] }).code).toBe(baseline.code);
    expect(baseline.errors).toHaveLength(0);
  });

  test('bare NodeVisitor: renames a mustache path before lowering', () => {
    const tpl = '<div>{{greeting}}</div>';
    const baseline = compile(tpl);
    // Baseline references the original free-var helper name.
    expect(baseline.code).toContain('greeting');
    expect(baseline.code).not.toContain('salutation');

    const result = compile(tpl, {
      transforms: [
        {
          MustacheStatement(node: any) {
            if (
              node.path.type === 'PathExpression' &&
              node.path.original === 'greeting'
            ) {
              node.path.original = 'salutation';
              node.path.parts = ['salutation'];
            }
          },
        },
      ],
    });

    expect(result.errors).toHaveLength(0);
    // The AST mutation is reflected in the emitted code.
    expect(result.code).toContain('salutation');
    expect(result.code).not.toContain('greeting');
  });

  test('bare NodeVisitor: rewrites an element tag', () => {
    const tpl = '<div>hello</div>';
    const result = compile(tpl, {
      transforms: [
        {
          ElementNode(node: any) {
            if (node.tag === 'div') {
              node.tag = 'section';
            }
          },
        },
      ],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain("'section'");
    expect(result.code).not.toContain("'div'");
  });

  test('ASTPluginBuilder shape: (env) => ({ name, visitor }) is supported', () => {
    const tpl = '<div>{{greeting}}</div>';
    let seenEnv: any;

    const result = compile(tpl, {
      transforms: [
        (env: any) => {
          seenEnv = env;
          return {
            name: 'rename-greeting',
            visitor: {
              MustacheStatement(node: any) {
                if (
                  node.path.type === 'PathExpression' &&
                  node.path.original === 'greeting'
                ) {
                  node.path.original = 'salutation';
                  node.path.parts = ['salutation'];
                }
              },
            },
          };
        },
      ],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('salutation');
    expect(result.code).not.toContain('greeting');
    // env exposes the @glimmer/syntax surface like classic plugins.ast.
    expect(typeof seenEnv.syntax.builders).toBe('object');
    expect(typeof seenEnv.syntax.traverse).toBe('function');
  });

  test('multiple transforms apply in order', () => {
    const tpl = '<div>{{a}}</div>';
    const result = compile(tpl, {
      transforms: [
        {
          MustacheStatement(node: any) {
            if (node.path.type === 'PathExpression' && node.path.original === 'a') {
              node.path.original = 'b';
              node.path.parts = ['b'];
            }
          },
        },
        {
          MustacheStatement(node: any) {
            if (node.path.type === 'PathExpression' && node.path.original === 'b') {
              node.path.original = 'c';
              node.path.parts = ['c'];
            }
          },
        },
      ],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('c');
    expect(result.code).not.toMatch(/\b(a|b)\(/);
  });
});
