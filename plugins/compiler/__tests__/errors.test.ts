import { describe, test, expect } from 'vitest';
import {
  offsetToLineColumn,
  extractSnippet,
  generatePointer,
  getErrorHint,
  enrichError,
  enrichWarning,
  formatErrorForDisplay,
  formatWarningForDisplay,
  ERROR_HINTS,
} from '../errors';

describe('offsetToLineColumn()', () => {
  test('returns 1,1 for offset 0', () => {
    const result = offsetToLineColumn('hello', 0);
    expect(result).toEqual({ line: 1, column: 1 });
  });

  test('handles first line correctly', () => {
    const result = offsetToLineColumn('hello world', 6);
    expect(result).toEqual({ line: 1, column: 7 });
  });

  test('handles newlines correctly', () => {
    const source = 'line1\nline2\nline3';
    expect(offsetToLineColumn(source, 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn(source, 5)).toEqual({ line: 1, column: 6 }); // at \n
    expect(offsetToLineColumn(source, 6)).toEqual({ line: 2, column: 1 }); // start of line2
    expect(offsetToLineColumn(source, 12)).toEqual({ line: 3, column: 1 }); // start of line3
  });

  test('handles empty string', () => {
    const result = offsetToLineColumn('', 0);
    expect(result).toEqual({ line: 1, column: 1 });
  });

  test('offset beyond string length clamps to end', () => {
    const result = offsetToLineColumn('hello', 100);
    expect(result).toEqual({ line: 1, column: 6 });
  });
});

describe('extractSnippet()', () => {
  test('extracts single line', () => {
    const source = 'line1\nline2\nline3';
    const result = extractSnippet(source, { start: 6, end: 11 });
    expect(result.lines.length).toBe(1);
    expect(result.lines[0]).toContain('line2');
    expect(result.startLine).toBe(2);
  });

  test('includes context lines', () => {
    const source = 'line1\nline2\nline3\nline4\nline5';
    const result = extractSnippet(source, { start: 12, end: 17 }, 1);
    expect(result.lines.length).toBe(3); // line2, line3, line4
    expect(result.lines[0]).toContain('line2');
    expect(result.lines[1]).toContain('line3');
    expect(result.lines[2]).toContain('line4');
  });

  test('handles start of file', () => {
    const source = 'first\nsecond';
    const result = extractSnippet(source, { start: 0, end: 5 }, 1);
    expect(result.lines[0]).toContain('first');
    expect(result.startLine).toBe(1);
  });

  test('handles end of file', () => {
    const source = 'first\nsecond';
    const result = extractSnippet(source, { start: 6, end: 12 }, 1);
    expect(result.lines[result.lines.length - 1]).toContain('second');
  });

  test('formats line numbers with proper padding', () => {
    const source = Array(100).fill('x').join('\n');
    const result = extractSnippet(source, { start: 198, end: 199 }); // line 100
    // Line number should be padded to match max width
    expect(result.lines[0]).toMatch(/^\s*100 \|/);
  });
});

describe('generatePointer()', () => {
  test('generates pointer at correct position', () => {
    const pointer = generatePointer(5, 3, 2);
    // 2 digits + " | " = 5 chars prefix, then column-1 spaces, then ^^^
    expect(pointer).toBe('         ^^^');
  });

  test('handles single character', () => {
    const pointer = generatePointer(1, 1, 1);
    expect(pointer).toBe('    ^');
  });

  test('handles long underlines', () => {
    const pointer = generatePointer(3, 10, 2);
    expect(pointer).toContain('^^^^^^^^^^');
  });

  test('minimum length is 1', () => {
    const pointer = generatePointer(1, 0, 1);
    expect(pointer).toContain('^');
  });
});

describe('getErrorHint()', () => {
  test('returns hint for known error code', () => {
    const hint = getErrorHint('W002');
    expect(hint).toBeDefined();
    expect(hint).toContain('browser globals');
  });

  test('returns undefined for unknown error code', () => {
    const hint = getErrorHint('UNKNOWN');
    expect(hint).toBeUndefined();
  });

  test('all ERROR_HINTS have values', () => {
    for (const [code, hint] of Object.entries(ERROR_HINTS)) {
      expect(hint).toBeDefined();
      expect(hint.length).toBeGreaterThan(0);
      expect(code).toMatch(/^[EW]\d{3}$/);
    }
  });
});

describe('enrichError()', () => {
  test('enriches error with source snippet', () => {
    const source = 'hello\n{{window}}\nworld';
    const error = {
      message: '"window" is a reserved binding name',
      code: 'W002',
      sourceRange: { start: 6, end: 16 },
    };

    const enriched = enrichError(error, source);

    expect(enriched.message).toBe(error.message);
    expect(enriched.code).toBe(error.code);
    expect(enriched.sourceRange).toEqual(error.sourceRange);
    expect(enriched.snippet).toContain('{{window}}');
    expect(enriched.pointer).toContain('^');
    expect(enriched.hint).toBeDefined();
    expect(enriched.line).toBe(2);
    expect(enriched.column).toBe(1);
  });

  test('handles error without sourceRange', () => {
    const error = {
      message: 'General error',
      code: 'E001',
    };

    const enriched = enrichError(error, 'some source');

    expect(enriched.message).toBe(error.message);
    expect(enriched.code).toBe(error.code);
    expect(enriched.snippet).toBeUndefined();
    expect(enriched.pointer).toBeUndefined();
    expect(enriched.line).toBeUndefined();
    expect(enriched.column).toBeUndefined();
  });

  test('includes hint from ERROR_HINTS', () => {
    const error = {
      message: 'Test error',
      code: 'W002',
      sourceRange: { start: 0, end: 5 },
    };

    const enriched = enrichError(error, 'hello');

    expect(enriched.hint).toBe(ERROR_HINTS['W002']);
  });
});

describe('enrichWarning()', () => {
  test('enriches warning same as error', () => {
    const source = 'test source';
    const warning = {
      message: 'Test warning',
      code: 'W001',
      sourceRange: { start: 0, end: 4 },
    };

    const enriched = enrichWarning(warning, source);

    expect(enriched.message).toBe(warning.message);
    expect(enriched.code).toBe(warning.code);
    expect(enriched.snippet).toBeDefined();
    expect(enriched.pointer).toBeDefined();
    expect(enriched.line).toBe(1);
    expect(enriched.column).toBe(1);
  });
});

describe('formatErrorForDisplay()', () => {
  test('formats error with all fields', () => {
    const error = {
      message: 'Test error message',
      code: 'E001',
      sourceRange: { start: 0, end: 5 },
      snippet: '1 | hello\n    ^^^^^',
      pointer: '    ^^^^^',
      hint: 'This is a helpful hint.',
      line: 1,
      column: 1,
    };

    const formatted = formatErrorForDisplay(error);

    expect(formatted).toContain('error: This is a helpful hint. (E001)');
    expect(formatted).toContain('--> 1:1');
    expect(formatted).toContain('1 | hello');
    expect(formatted).toContain('^^^^^');
    expect(formatted).toContain('note: Test error message');
  });

  test('formats error without optional fields', () => {
    const error = {
      message: 'Simple error',
      code: 'E002',
    };

    const formatted = formatErrorForDisplay(error);

    expect(formatted).toContain('error: Simple error (E002)');
    expect(formatted).not.toContain('-->');
    expect(formatted).toContain('note: Simple error');
  });
});

describe('formatWarningForDisplay()', () => {
  test('formats warning with all fields', () => {
    const warning = {
      message: 'Test warning message',
      code: 'W001',
      sourceRange: { start: 0, end: 5 },
      snippet: '1 | hello\n    ^^^^^',
      pointer: '    ^^^^^',
      hint: 'Consider doing X instead.',
      line: 1,
      column: 1,
    };

    const formatted = formatWarningForDisplay(warning);

    expect(formatted).toContain('warning: Consider doing X instead. (W001)');
    expect(formatted).toContain('--> 1:1');
    expect(formatted).toContain('1 | hello');
    expect(formatted).toContain('^^^^^');
    expect(formatted).toContain('note: Test warning message');
  });

  test('uses "Warning" prefix instead of "Error"', () => {
    const warning = {
      message: 'Some warning',
      code: 'W002',
    };

    const formatted = formatWarningForDisplay(warning);

    expect(formatted).toContain('warning: Some warning (W002)');
    expect(formatted).not.toContain('error:');
  });
});

describe('integration', () => {
  test('full enrichment and formatting workflow', () => {
    const source = `<div>
  {{#each window as |item|}}
    {{item}}
  {{/each}}
</div>`;

    const error = {
      message: '"window" is a reserved binding name',
      code: 'W002',
      sourceRange: { start: 14, end: 20 }, // "window" in the source
    };

    const enriched = enrichError(error, source);
    const formatted = formatErrorForDisplay(enriched);

    // Should have proper line info
    expect(enriched.line).toBe(2);
    expect(enriched.snippet).toContain('each window');

    // Formatted output should be human-readable
    expect(formatted).toContain('error: Avoid using browser globals (window, document, console) as binding names. (W002)');
    expect(formatted).toContain('reserved binding name');
    expect(formatted).toContain('note:');
  });
});
