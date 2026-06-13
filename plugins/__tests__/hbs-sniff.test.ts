import { describe, it, expect } from 'vitest';
import { hasHbsTaggedTemplate } from '../compiler';

describe('hasHbsTaggedTemplate', () => {
  it('matches genuine tagged templates', () => {
    expect(hasHbsTaggedTemplate('const t = hbs`<div></div>`;')).toBe(true);
    expect(hasHbsTaggedTemplate('return hbs `{{x}}`;')).toBe(true);
    expect(hasHbsTaggedTemplate('fn(hbs`{{x}}`)')).toBe(true);
    expect(hasHbsTaggedTemplate('hbs`top of file`')).toBe(true);
  });

  it('ignores file-extension and inline-code prose', () => {
    // The emberjs/ember.js#21340 docs sentence: closing backtick of an
    // inline-code span directly after "hbs".
    expect(
      hasHbsTaggedTemplate('// components were authored in paired `.hbs` and `.js` files')
    ).toBe(false);
    expect(hasHbsTaggedTemplate("// rename 'template.hbs' to `template.gjs`")).toBe(false);
    expect(hasHbsTaggedTemplate('/** see `hbs` for details */')).toBe(false);
    expect(hasHbsTaggedTemplate('// "hbs" files')).toBe(false);
    expect(hasHbsTaggedTemplate('const stubhbs = stubhbs`x`;')).toBe(false);
  });
});
