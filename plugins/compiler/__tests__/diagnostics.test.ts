import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

import { extractSnippet } from '../errors';

describe('Compiler Diagnostics', () => {
  test('extracts snippet with context correctly (fixes off-by-one)', () => {
    const template = `
<div class="row">
  <span class=foo>
    Hello
  </span>
</div>`.trim();
    // Error on line 2 ('foo')
    // Context lines: 1. Expect snippet to start at line 1.
    
    const start = template.indexOf('foo'); 
    const end = start + 3;
    const snippet = extractSnippet(template, { start, end }, 1);
    
    expect(snippet.startLine).toBe(1); // Was returning 2 before fix
    expect(snippet.lines[0]).toContain('<div class="row">');
  });

  test('reports Parse Error (E005) with location', () => {
    const template = '{{/if}}';
    const result = compile(template);

    expect(result.errors).toHaveLength(1);
    const error = result.errors[0];

    expect(error.code).toBe('E012');
    // Expect message to contain info about the token
    expect(error.message).toContain('OPEN_ENDBLOCK');
    
    // Check location
    expect(error.line).toBe(1);
    expect(error.column).toBe(1); // 1-based index for {{/if}} start
    
    // Check snippet
    expect(error.snippet).toContain('1 | {{/if}}');
    expect(error.pointer).toBeDefined();
  });

  test('reports Parse Error with expected tokens hint', () => {
    const template = '{{/if}}';
    const result = compile(template);
    const error = result.errors[0];

    // Hint should list expected tokens
    expect(error.message).toContain('Expected:');
    // Should expect something valid like content or open block, not EOF necessarily?
    // The parser message usually includes "Expecting 'EOF', ..."
    // Our implementation appends "Expected: ..."
  });

  test('reports Parse Error with correct checking for multiline', () => {
    const template = `
      <div>
        {{/if}}
      </div>
    `;
    const result = compile(template);
    const error = result.errors[0];

    expect(error.line).toBe(3);
    expect(error.snippet).toContain('3 |         {{/if}}');
  });

  test('supports diagnostics options for context lines', () => {
    const template = `line 1
line 2
{{/if}}
line 4
line 5`;
    
    // Default context (now 2 lines)
    // Line 1, 2 (above), Line 3 (error), Pointer, Line 4, 5 (below) => 6 lines
    const resultDefault = compile(template);
    expect(resultDefault.errors[0].snippet?.split('\n')).toHaveLength(6);

    // Custom context (0 lines)
    const resultZero = compile(template, {
      diagnostics: { contextLines: 0 }
    });
    // Line 3 (error), Pointer => 2 lines
    expect(resultZero.errors[0].snippet?.split('\n')).toHaveLength(2);

    // Custom context (3 lines)
    // Line 1, 2 (above), Line 3 (error), Pointer, 4, 5 (below) => 6 lines
    const resultMoreContext = compile(template, {
      diagnostics: { contextLines: 3 }
    });
    expect(resultMoreContext.errors[0].snippet?.split('\n')).toHaveLength(6);

    // Custom context (2 lines)
    const resultTwo = compile(template, {
      diagnostics: { contextLines: 2 }
    });
    expect(resultTwo.errors[0].snippet?.split('\n')).toHaveLength(6);
  });
});
