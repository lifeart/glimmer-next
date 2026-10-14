/**
 * Ember compat runtime for a test file: templates compiled with the flags the
 * Ember compat build passes to gxt's compiler, rendered with the
 * WITH_EMBER_INTEGRATION build constant on and EMBER_NATIVE off (vitest exposes
 * both as globals), as the Ember compat build defines them. `this` in a
 * template is the render node, which carries the given fields.
 */
import { beforeEach, afterEach, expect } from 'vitest';
import * as main from '../index';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, COMPONENT_ID_PROPERTY, addToTree, $template } from '../shared';
import { cId } from '../tree';
import { $_c, $_args, $_edp } from '../dom';
import { renderElement } from '../render-core';
import { createDOMFixture, type DOMFixture } from './index';
import { compileTemplateSource } from '../../../plugins/runtime-compiler';

export const COMPAT_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  TRY_CATCH_ERROR_HANDLING: false,
};

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

export type CompatTemplate = (...args: unknown[]) => unknown;

/** Compile a template with the compat flags; `bindings` are its lexical scope. */
export function compileCompat(
  tpl: string,
  bindings: Record<string, unknown> = {},
  flags: Record<string, boolean> = {},
): CompatTemplate {
  const { source, scopeNames, errors } = compileTemplateSource(tpl, {
    flags: { ...COMPAT_FLAGS, ...flags },
    bindings: new Set(Object.keys(bindings)),
  });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  const names = Object.keys(bindings);
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, ...names, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
    ...names.map((name) => bindings[name]),
  ) as CompatTemplate;
}

export interface CompatRuntime {
  readonly fixture: DOMFixture;
  /** Render `template` as a component whose node carries `self`'s fields. */
  render(template: CompatTemplate, self?: Record<string, unknown>): void;
}

/** Turn the compat runtime on for each test of the calling file. */
export function useEmberCompatRuntime(): CompatRuntime {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;
  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = false;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
  });
  afterEach(() => {
    fixture.cleanup();
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
  });
  return {
    get fixture() {
      return fixture;
    },
    render(template, self = {}) {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parent);
      const Host = function Host() {
        return { [COMPONENT_ID_PROPERTY]: cId(), [$template]: template, ...self };
      };
      const instance = $_c(Host as any, $_args({}, false, $_edp as any), parent);
      renderElement(fixture.api, parent, fixture.container, instance);
    },
  };
}
