import type { Globals as EELGlobals } from '@glint/environment-ember-loose/-private/dsl';
import type Globals from '../../globals';
import type { EachKeyword } from '../intrinsics/each';
import type { ComponentLike } from '@glint/template';
import type { ModifierReturn } from '@glint/template/-private/integration';
import type { InElementKeyword } from '../intrinsics/in-element';

interface Keywords
  extends Pick<
    EELGlobals,
    | 'component'
    | 'debugger'
    | 'has-block'
    | 'has-block-params'
    | 'helper'
    | 'if'
    | 'let'
    | 'log'
    | 'modifier'
    | 'unless'
    | 'yield'
  > {
    
  }

interface Internal {
  each: EachKeyword,
  'in-element': InElementKeyword,
  on: (
    noop: unknown,
    event: string,
    callback: (e: Event, element: Element) => void,
  ) => ModifierReturn;
  array: <T extends unknown>(...params: T[]) => T[];
  hash: <T extends Record<string, unknown>>(obj: T) => T;
  fn: (...args: any) => (...args: any) => void;
  eq: (...args: any) => boolean;
  element: (tagName: string) => ComponentLike<{
    Element: Element;
    Blocks: {
      default: [];
    };
  }>;
}

export const Globals: Keywords & Globals & Internal;
