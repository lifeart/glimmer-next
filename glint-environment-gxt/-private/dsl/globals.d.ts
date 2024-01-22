import { Globals as EELGlobals } from '@glint/environment-ember-loose/-private/dsl';
import Globals from '../../globals';
import { EachKeyword } from '../intrinsics/each';

interface Keywords
  extends Pick<
    EELGlobals,
    | 'component'
    | 'debugger'
    | 'each'
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
  each: EachKeyword
}

export const Globals: Keywords & Globals & Internal;
