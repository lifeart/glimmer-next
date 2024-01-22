// import * as VM from '@glint/template/-private/keywords';

import { EachKeyword } from '../intrinsics/each';

import Registry from '../../registry';

// The keyword vs global breakdown here is loosely matched with
// the listing in http://emberjs.github.io/rfcs/0496-handlebars-strict-mode.html

interface Keywords {
 
  each: EachKeyword;
}

export interface Globals extends Keywords, Registry {

}

export declare const Globals: Globals;