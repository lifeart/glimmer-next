/**
 * Seam test for the named-block thunk marker.
 *
 * The Ember integration compiles registry templates in IS_GLIMMER_COMPAT_MODE
 * with NO compile-time bindings, so a `<:name>…</:name>` named block inside a
 * component lowers to a lazy factory producing `$_tag(':name', …)` (which the
 * ember runtime turns into a `__isNamedBlock` marker). A host must (a) tell it
 * apart from plain component-child / text thunks and (b) learn the slot NAME.
 * This test pins the compiler→runtime seam: the compiler MARKS named-block
 * factories with `$_nbt(fn, name)`, and the runtime predicate
 * `getNamedBlockName` recovers the name — no `.toString()` source-sniffing of
 * `$_tag(':`, so it survives minification.
 */
import { describe, test, expect } from 'vitest';
import { compileTemplate, setupGlobalScope } from '../../runtime-compiler';
import { $_nbt, getNamedBlockName, isNodeThunk } from '../../../src/core/dom';

describe('named-block marker seam (compiler $_nbt -> runtime getNamedBlockName)', () => {
  test('compiler marks named-block factories with their slot name', () => {
    // No bindings + compat mode == the Ember registry-template path.
    const r = compileTemplate('<Foo><:header>hi</:header><:body>bye</:body></Foo>');
    expect(r.code).toContain("$_nbt(() => $_tag(':header'");
    expect(r.code).toContain("'header')");
    expect(r.code).toContain("$_nbt(() => $_tag(':body'");
    expect(r.code).toContain("'body')");
    // one marked factory per named block
    expect(r.code.match(/\$_nbt\(/g)?.length).toBe(2);
  });

  test('$_nbt is exposed on the global scope the host relies on', () => {
    setupGlobalScope();
    expect(typeof (globalThis as any).$_nbt).toBe('function');
  });

  test('getNamedBlockName recovers the slot name; isNodeThunk stays true', () => {
    const headerFactory = $_nbt(() => 'a()', 'header'); // minified-like body
    expect(getNamedBlockName(headerFactory)).toBe('header');
    // Must still count as a node thunk (a named-block factory is invoked).
    expect(isNodeThunk(headerFactory)).toBe(true);
    // A plain function is not a named block.
    expect(getNamedBlockName(() => 'title')).toBe(null);
  });
});
