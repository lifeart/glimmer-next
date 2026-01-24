import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

function collectNames(node: any): string[] {
  const names: string[] = [];
  if (node.name) names.push(node.name);
  for (const child of (node.children || [])) {
    names.push(...collectNames(child));
  }
  return names;
}

describe('user scenarios', () => {
  test('Button component template', () => {
    const template = '<Button {{on "click" @onClick}} type="button">{{yield}}</Button>';
    const result = compile(template, {
      bindings: new Set(['Button']),
      sourceMap: { enabled: true },
    });
    console.log('Button NAMES:', collectNames(result.mappingTree));
    console.log('Button SOURCEMAP NAMES:', result.sourceMap?.names);
    const names = collectNames(result.mappingTree);
    expect(names.some(n => n.includes('onClick'))).toBe(true);
    expect(names).toContain('Button');
    expect(result.sourceMap?.names).toContain('Button');
  });

  test('table cell template', () => {
    const template = `<td class="py-2.5 px-2 text-center">
      <span class="text-slate-300 text-xs">{{originalValue @vanila}}</span>
      <span class="text-xs ml-1 {{colorForDiff (withDiff @gxt @vanila)}}">{{withDiff @gxt @vanila}}</span>
    </td>`;
    const result = compile(template, {
      bindings: new Set(['originalValue', 'colorForDiff', 'withDiff']),
    });
    console.log('Table cell NAMES:', collectNames(result.mappingTree));
    const names = collectNames(result.mappingTree);

    // Helper function names
    expect(names).toContain('originalValue');
    expect(names).toContain('colorForDiff');
    expect(names).toContain('withDiff');

    // @args
    expect(names.some(n => n.includes('vanila'))).toBe(true);
    expect(names.some(n => n.includes('gxt'))).toBe(true);
  });
});
