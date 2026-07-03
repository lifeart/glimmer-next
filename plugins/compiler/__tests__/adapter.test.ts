import { describe, test, expect } from 'vitest';
import { templateToTypescript } from '../adapter';
import { compile } from '../compile';
import type { Flags } from '../../flags';

describe('Adapter Layer', () => {
  const defaultFlags: Flags = {
    IS_GLIMMER_COMPAT_MODE: true,
  } as Flags;

  describe('templateToTypescript()', () => {
    test('returns RewriteResult with correct structure', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('mapping');
      expect(result).toHaveProperty('directives');
      expect(result).toHaveProperty('errors');
    });

    test('generates valid code', () => {
      const result = templateToTypescript('<div>Hello</div>', defaultFlags);

      expect(typeof result.code).toBe('string');
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.code).toContain('$_tag');
    });

    test('returns empty errors for valid template', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      expect(result.errors).toHaveLength(0);
    });

    test('returns errors for invalid template', () => {
      const result = templateToTypescript('{{/if}}', defaultFlags);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('mapping has old API format', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const mapping = result.mapping;

      // Old format uses transformedRange/originalRange
      expect(mapping).toHaveProperty('transformedRange');
      expect(mapping).toHaveProperty('originalRange');
      expect(mapping).toHaveProperty('children');
      expect(mapping).toHaveProperty('sourceNode');

      // Should have methods
      expect(typeof mapping.clone).toBe('function');
      expect(typeof mapping.shiftOriginal).toBe('function');
      expect(typeof mapping.shiftTransformed).toBe('function');
      expect(typeof mapping.addChild).toBe('function');
    });

    test('mapping transformedRange has correct bounds', () => {
      const template = '<div>test</div>';
      const result = templateToTypescript(template, defaultFlags);

      expect(result.mapping.transformedRange.start).toBe(0);
      expect(result.mapping.transformedRange.end).toBe(result.code.length);
    });

    test('mapping originalRange has correct bounds', () => {
      const template = '<div>test</div>';
      const result = templateToTypescript(template, defaultFlags);

      expect(result.mapping.originalRange.start).toBe(0);
      expect(result.mapping.originalRange.end).toBe(template.length);
    });

    test('clone() creates a copy', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const cloned = result.mapping.clone();

      expect(cloned).not.toBe(result.mapping);
      expect(cloned.transformedRange).toEqual(result.mapping.transformedRange);
      expect(cloned.originalRange).toEqual(result.mapping.originalRange);
    });

    test('shiftOriginal() shifts all ranges', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const originalStart = result.mapping.originalRange.start;
      const originalEnd = result.mapping.originalRange.end;

      result.mapping.shiftOriginal(100);

      expect(result.mapping.originalRange.start).toBe(originalStart + 100);
      expect(result.mapping.originalRange.end).toBe(originalEnd + 100);
    });

    test('shiftTransformed() shifts all ranges', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      const transformedStart = result.mapping.transformedRange.start;
      const transformedEnd = result.mapping.transformedRange.end;

      result.mapping.shiftTransformed(50);

      expect(result.mapping.transformedRange.start).toBe(transformedStart + 50);
      expect(result.mapping.transformedRange.end).toBe(transformedEnd + 50);
    });

    test('respects bindings', () => {
      const bindings = new Set(['MyComponent']);
      const result = templateToTypescript('<MyComponent />', defaultFlags, bindings);

      expect(result.code).toContain('$_c');
      expect(result.code).toContain('MyComponent');
    });

    test('compiles mustache expressions', () => {
      const result = templateToTypescript('{{this.name}}', defaultFlags);

      expect(result.code).toContain('this.name');
    });

    test('compiles block expressions', () => {
      const result = templateToTypescript('{{#if this.show}}yes{{/if}}', defaultFlags);

      expect(result.code).toContain('$_if');
    });

    test('compiles each blocks', () => {
      const result = templateToTypescript(
        '{{#each this.items as |item|}}{{item}}{{/each}}',
        defaultFlags
      );

      expect(result.code).toContain('$_each');
    });
  });

  // Regression: the adapter used to forward ONLY IS_GLIMMER_COMPAT_MODE into
  // compile(), silently dropping every other host opt-in. The most visible
  // casualty was FORCE_SYNC_LIST — a `templateToTypescript(tpl, { FORCE_SYNC_LIST:
  // true })` call still emitted async `$_each(` / `$_eachRecycled(`, so hosts
  // (the Ember bridge) had to keep a `$_each(` -> `$_eachSync(` regex over the
  // emitted JS. See adapter.ts.
  describe('templateToTypescript() flag forwarding', () => {
    const syncFlags: Flags = {
      IS_GLIMMER_COMPAT_MODE: true,
      FORCE_SYNC_LIST: true,
    } as Flags;

    test('FORCE_SYNC_LIST reaches buildEach: plain each emits $_eachSync, never async $_each(', () => {
      const result = templateToTypescript(
        '{{#each this.items as |item|}}<div>{{item}}</div>{{/each}}',
        syncFlags
      );
      expect(result.code).toContain('$_eachSync(');
      // `$_each(` is not a substring of `$_eachSync(` — the async entry point
      // must not appear anywhere.
      expect(result.code).not.toContain('$_each(');
    });

    test('FORCE_SYNC_LIST reaches buildEach: key="@recycle" emits $_eachSyncRecycled, never async $_eachRecycled(', () => {
      const result = templateToTypescript(
        '{{#each this.items key="@recycle" as |item|}}<div>{{item.label}}</div>{{/each}}',
        syncFlags
      );
      expect(result.code).toContain('$_eachSyncRecycled(');
      expect(result.code).not.toContain('$_eachRecycled(');
    });

    test('flag OFF (default): plain each still emits async $_each — unchanged behaviour', () => {
      const result = templateToTypescript(
        '{{#each this.items as |item|}}<div>{{item}}</div>{{/each}}',
        defaultFlags
      );
      expect(result.code).toContain('$_each(');
      expect(result.code).not.toContain('$_eachSync(');
    });

    test('adapter output is byte-identical to compile() for the same flags (seam parity)', () => {
      const tpl = '{{#each this.items as |item|}}<div>{{item}}</div>{{/each}}';
      const adapterCode = templateToTypescript(tpl, syncFlags).code;
      const compileCode = compile(tpl, {
        flags: { IS_GLIMMER_COMPAT_MODE: true, FORCE_SYNC_LIST: true },
      }).code;
      expect(adapterCode).toBe(compileCode);
    });

    // FORCE_SYNC_LIST-on sweep across a battery of each-shapes. Flag-on output
    // must NEVER contain the async entry points, no matter where the each sits.
    describe('FORCE_SYNC_LIST sweep — no async $_each in any shape', () => {
      const SHAPES: Record<string, string> = {
        plain: '{{#each this.items as |i|}}<span>{{i}}</span>{{/each}}',
        noParams: '{{#each this.items}}x{{/each}}',
        withIndex: '{{#each this.items as |i idx|}}<span>{{idx}}{{i}}</span>{{/each}}',
        keyed: '{{#each this.items key="id" as |i|}}<b>{{i}}</b>{{/each}}',
        identity: '{{#each this.items key="@identity" as |i|}}{{i}}{{/each}}',
        recycle: '{{#each this.items key="@recycle" as |i|}}<b>{{i}}</b>{{/each}}',
        recycleIndex: '{{#each this.items key="@recycle" as |i idx|}}<b>{{idx}}{{i}}</b>{{/each}}',
        recycleElse: '{{#each this.items key="@recycle" as |i|}}<b>{{i}}</b>{{else}}none{{/each}}',
        withElse: '{{#each this.items as |i|}}<b>{{i}}</b>{{else}}none{{/each}}',
        elseWithEach: '{{#each this.a as |i|}}{{i}}{{else}}{{#each this.b as |j|}}{{j}}{{/each}}{{/each}}',
        nested: '{{#each this.rows as |r|}}{{#each r.cols as |c|}}{{c}}{{/each}}{{/each}}',
        nested3: '{{#each this.a as |r|}}{{#each r.b as |c|}}{{#each c.d as |y|}}{{y}}{{/each}}{{/each}}{{/each}}',
        inIf: '{{#if this.x}}{{#each this.items as |i|}}{{i}}{{/each}}{{/if}}',
        inIfElse: '{{#if this.x}}a{{else}}{{#each this.items as |i|}}{{i}}{{/each}}{{/if}}',
        inUnless: '{{#unless this.x}}{{#each this.items as |i|}}{{i}}{{/each}}{{/unless}}',
        inLet: '{{#let this.items as |xs|}}{{#each xs as |i|}}{{i}}{{/each}}{{/let}}',
        inComponent: '<Foo>{{#each this.items as |i|}}<b>{{i}}</b>{{/each}}</Foo>',
        inNamedBlock: '<Foo><:body>{{#each this.items as |i|}}<b>{{i}}</b>{{/each}}</:body></Foo>',
        inNamedBlockElse: '<Foo><:body>{{#each this.a as |i|}}{{i}}{{/each}}</:body><:else>{{#each this.b as |j|}}{{j}}{{/each}}</:else></Foo>',
        unstableChild: '{{#each this.items as |i|}}{{#if i.on}}<b>{{i}}</b>{{else}}<i>{{i}}</i>{{/if}}{{/each}}',
        staticBlock: '{{#each this.items as |i|}}<div class="row">{{i}}</div>{{/each}}',
        inInElement: '{{#in-element this.t}}{{#each this.items as |i|}}{{i}}{{/each}}{{/in-element}}',
        eachInElement: '{{#each this.items as |i|}}{{#in-element i.t}}{{i}}{{/in-element}}{{/each}}',
        eachInWithEach: '{{#each-in this.obj as |k v|}}{{#each v as |i|}}{{i}}{{/each}}{{/each-in}}',
        twoSiblings: '{{#each this.a as |i|}}{{i}}{{/each}}{{#each this.b as |j|}}{{j}}{{/each}}',
      };

      for (const [name, tpl] of Object.entries(SHAPES)) {
        test(name, () => {
          const result = templateToTypescript(tpl, syncFlags);
          expect(result.errors, `${name} compiled with errors`).toHaveLength(0);
          expect(
            result.code.includes('$_each('),
            `${name} leaks async $_each(`
          ).toBe(false);
          expect(
            result.code.includes('$_eachRecycled('),
            `${name} leaks async $_eachRecycled(`
          ).toBe(false);
        });
      }
    });
  });

  describe('directives', () => {
    test('returns empty directives array', () => {
      const result = templateToTypescript('<div>test</div>', defaultFlags);
      expect(result.directives).toEqual([]);
    });
  });
});
