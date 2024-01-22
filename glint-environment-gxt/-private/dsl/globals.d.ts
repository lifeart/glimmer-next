import { Globals as EELGlobals } from '@glint/environment-ember-loose/-private/dsl';
import Globals from '../../globals';
import { EachKeyword } from '../intrinsics/each';
import type { ComponentLike } from '@glint/template';
import { ModifierReturn } from '@glint/template/-private/integration';

interface Keywords
  extends Pick<
    EELGlobals,
    | 'component'
    | 'debugger'
    | 'has-block'
    | 'has-block-params'
    | 'helper'
    | 'if'
    | 'in-element'
    | 'let'
    | 'log'
    | 'modifier'
    | 'unless'
    | 'yield'
  > {
    
  }

interface Internal {
  each: EachKeyword,
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
