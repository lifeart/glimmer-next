/**
 * Utility functions for Tres renderer
 * Simplified version with only the functions needed by tres-api.ts
 */

export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const HTML_TAGS =
  'html,body,base,head,link,meta,style,title,address,article,aside,footer,' +
  'header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,' +
  'figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,' +
  'data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,' +
  'time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,' +
  'canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,' +
  'th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,' +
  'option,output,progress,select,textarea,details,dialog,menu,' +
  'summary,template,blockquote,iframe,tfoot';

function makeMap(str: string, expectsLowerCase?: boolean): (key: string) => boolean {
  const map: Record<string, boolean> = Object.create(null);
  const list: string[] = str.split(',');
  for (let i = 0; i < list.length; i++) {
    map[list[i]] = true;
  }
  return expectsLowerCase ? (val) => !!map[val.toLowerCase()] : (val) => !!map[val];
}

export const isHTMLTag = makeMap(HTML_TAGS);

export function deepEqual(a: any, b: any): boolean {
  // If both are primitives, return true if they are equal
  if (a === b) {
    return true;
  }

  // If either of them is null or not an object, return false
  if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') {
    return false;
  }

  // Get the keys of both objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  // If they have different number of keys, they are not equal
  if (keysA.length !== keysB.length) {
    return false;
  }

  // Check each key in A to see if it exists in B and its value is the same in both
  for (const key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

export function deepArrayEqual(arr1: any[], arr2: any[]): boolean {
  // If they're not both arrays, return false
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
    return false;
  }

  // If they don't have the same length, they're not equal
  if (arr1.length !== arr2.length) {
    return false;
  }

  // Check each element of arr1 against the corresponding element of arr2
  for (let i = 0; i < arr1.length; i++) {
    if (!deepEqual(arr1[i], arr2[i])) {
      return false;
    }
  }

  return true;
}
