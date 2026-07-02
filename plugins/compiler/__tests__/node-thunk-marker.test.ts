/**
 * Seam test for the node-thunk marker.
 *
 * The Ember integration compiles registry templates in IS_GLIMMER_COMPAT_MODE
 * with NO compile-time bindings, so component tags lower through the element
 * (`$_tag`) path and their DOM-producing children are emitted as lazy thunks
 * (`() => $_tag(...)` / `() => $_dc(...)` / `() => $_each(...)`) alongside plain
 * reactive-text getters (`() => this.x`). A host must tell these apart. This
 * test pins the compiler→runtime seam: the compiler MARKS node thunks with
 * `$_nt`, and the runtime predicate `isNodeThunk` detects them — no
 * `.toString()` source-sniffing, so it survives minification.
 */
import { describe, test, expect } from 'vitest';
import { compileTemplate, setupGlobalScope } from '../../runtime-compiler';
import { $_nt, isNodeThunk } from '../../../src/core/dom';

describe('node-thunk marker seam (compiler $_nt -> runtime isNodeThunk)', () => {
  test('compiler marks node-producing children, not text getters', () => {
    // No bindings + compat mode == the Ember registry-template path.
    const r = compileTemplate('<Parent>{{this.title}}<Child /></Parent>');
    expect(r.code).toContain("$_nt(() => $_tag('Child'");
    expect(r.code).toContain('() => this.title');
    // Exactly one marked thunk (the <Child/> producer).
    expect(r.code.match(/\$_nt\(/g)?.length).toBe(1);
  });

  test('$_nt is exposed on the global scope the host relies on', () => {
    setupGlobalScope();
    expect(typeof (globalThis as any).$_nt).toBe('function');
  });

  test('isNodeThunk distinguishes marked thunks from text getters', () => {
    const nodeThunk = $_nt(() => 'a()'); // minified-like body (no $_* substrings)
    const textGetter = () => 'title';
    expect(isNodeThunk(nodeThunk)).toBe(true);
    expect(isNodeThunk(textGetter)).toBe(false);
  });
});
