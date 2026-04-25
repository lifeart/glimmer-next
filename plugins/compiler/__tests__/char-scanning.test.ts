/**
 * Direct unit tests for the character-scanning helpers used by
 * error-span refinement in compile.ts.
 *
 * These functions are perf-sensitive (they run on the unhappy path of
 * every parse error) and use raw charCode comparisons instead of regex
 * or `.includes`. The boundary tests below pin down each magic number
 * so an off-by-one regression (e.g. `c >= 65 && c < 90` instead of
 * `<= 90`) is caught immediately.
 */
import { describe, test, expect } from 'vitest';
import {
  findFirstWhitespace,
  findFirstNonIdentChar,
} from '../compile';

describe('findFirstWhitespace', () => {
  test('returns -1 for an empty string', () => {
    expect(findFirstWhitespace('')).toBe(-1);
  });

  test('returns -1 for a string with no whitespace', () => {
    expect(findFirstWhitespace('hello')).toBe(-1);
    expect(findFirstWhitespace('a-b=c@d:e_f')).toBe(-1);
    expect(findFirstWhitespace(' punct ')).toBe(-1); // NBSP / en-quad ignored
  });

  test('matches space (charCode 32)', () => {
    expect(findFirstWhitespace(' x')).toBe(0);
    expect(findFirstWhitespace('foo bar')).toBe(3);
    expect(findFirstWhitespace(' ')).toBe(0);
  });

  test('matches tab (charCode 9)', () => {
    expect(findFirstWhitespace('\tx')).toBe(0);
    expect(findFirstWhitespace('foo\tbar')).toBe(3);
  });

  test('matches LF (charCode 10)', () => {
    expect(findFirstWhitespace('\nx')).toBe(0);
    expect(findFirstWhitespace('foo\nbar')).toBe(3);
  });

  test('matches CR (charCode 13)', () => {
    expect(findFirstWhitespace('\rx')).toBe(0);
    expect(findFirstWhitespace('foo\rbar')).toBe(3);
  });

  test('does NOT match VT (11), FF (12), BS (8) — outside the documented set', () => {
    // The helper deliberately only treats space/tab/LF/CR as whitespace
    // because the upstream tokenizer only emits these in error spans;
    // VT/FF/BS would produce false splits.
    expect(findFirstWhitespace('ab')).toBe(-1); // VT (11)
    expect(findFirstWhitespace('ab')).toBe(-1); // FF (12)
    expect(findFirstWhitespace('ab')).toBe(-1); // BS (8)
  });

  test('returns the FIRST whitespace index when several are present', () => {
    expect(findFirstWhitespace('xxx \tabc')).toBe(3);
    expect(findFirstWhitespace('\n\r\t ')).toBe(0);
  });

  test('boundary: charCode 9 (tab) is included; charCode 8 (BS) and 11 (VT) are not', () => {
    expect(findFirstWhitespace(String.fromCharCode(8))).toBe(-1);
    expect(findFirstWhitespace(String.fromCharCode(9))).toBe(0);
    expect(findFirstWhitespace(String.fromCharCode(10))).toBe(0);
    expect(findFirstWhitespace(String.fromCharCode(11))).toBe(-1);
    expect(findFirstWhitespace(String.fromCharCode(12))).toBe(-1);
    expect(findFirstWhitespace(String.fromCharCode(13))).toBe(0);
    expect(findFirstWhitespace(String.fromCharCode(14))).toBe(-1);
  });

  test('boundary: charCode 31 (US) and 33 (!) are not whitespace; 32 (space) is', () => {
    expect(findFirstWhitespace(String.fromCharCode(31))).toBe(-1);
    expect(findFirstWhitespace(String.fromCharCode(32))).toBe(0);
    expect(findFirstWhitespace(String.fromCharCode(33))).toBe(-1);
  });
});

describe('findFirstNonIdentChar', () => {
  test('returns -1 for an empty string', () => {
    expect(findFirstNonIdentChar('')).toBe(-1);
  });

  test('returns -1 when every char is in the ident set', () => {
    // Cover one char from each accepted range / singleton.
    expect(findFirstNonIdentChar('Az09_-=@:')).toBe(-1);
    expect(findFirstNonIdentChar('aA0_-=@:')).toBe(-1);
    expect(findFirstNonIdentChar('foo-bar')).toBe(-1);
    expect(findFirstNonIdentChar('data-test=value')).toBe(-1);
    expect(findFirstNonIdentChar('@modifier')).toBe(-1);
    expect(findFirstNonIdentChar('xmlns:xlink')).toBe(-1);
  });

  describe('A-Z range (65–90)', () => {
    test('charCode 64 (@) is included as a singleton', () => {
      expect(findFirstNonIdentChar('@')).toBe(-1);
    });

    test('charCode 65 (A) lower bound is included', () => {
      expect(findFirstNonIdentChar('A')).toBe(-1);
    });

    test('charCode 90 (Z) upper bound is included', () => {
      expect(findFirstNonIdentChar('Z')).toBe(-1);
    });

    test('charCode 91 ([) is NOT in the ident set', () => {
      // 91 is the first char above 'Z'. A range bug like `c < 90` would
      // wrongly reject 'Z', and `c <= 91` would wrongly accept '['.
      expect(findFirstNonIdentChar('[')).toBe(0);
      expect(findFirstNonIdentChar('Z[')).toBe(1);
    });
  });

  describe('a-z range (97–122)', () => {
    test('charCode 96 (`) is NOT in the ident set', () => {
      expect(findFirstNonIdentChar('`')).toBe(0);
      expect(findFirstNonIdentChar('a`')).toBe(1);
    });

    test('charCode 97 (a) lower bound is included', () => {
      expect(findFirstNonIdentChar('a')).toBe(-1);
    });

    test('charCode 122 (z) upper bound is included', () => {
      expect(findFirstNonIdentChar('z')).toBe(-1);
    });

    test('charCode 123 ({) is NOT in the ident set', () => {
      expect(findFirstNonIdentChar('{')).toBe(0);
      expect(findFirstNonIdentChar('z{')).toBe(1);
    });
  });

  describe('0-9 range (48–57)', () => {
    test('charCode 47 (/) is NOT in the ident set', () => {
      expect(findFirstNonIdentChar('/')).toBe(0);
      expect(findFirstNonIdentChar('0/')).toBe(1);
    });

    test('charCode 48 (0) lower bound is included', () => {
      expect(findFirstNonIdentChar('0')).toBe(-1);
    });

    test('charCode 57 (9) upper bound is included', () => {
      expect(findFirstNonIdentChar('9')).toBe(-1);
    });

    test('charCode 58 (:) is included as a singleton, not a range artifact', () => {
      // 58 sits right above '9'. The implementation lists it as a
      // singleton; if the range were `<= 58` we'd accidentally accept
      // ';' (59) too, so this also pins that.
      expect(findFirstNonIdentChar(':')).toBe(-1);
      expect(findFirstNonIdentChar(';')).toBe(0);
    });
  });

  describe('singleton members', () => {
    test('underscore (95)', () => {
      expect(findFirstNonIdentChar('_')).toBe(-1);
      expect(findFirstNonIdentChar(String.fromCharCode(94))).toBe(0); // ^
      expect(findFirstNonIdentChar(String.fromCharCode(96))).toBe(0); // `
    });

    test('hyphen (45)', () => {
      expect(findFirstNonIdentChar('-')).toBe(-1);
      expect(findFirstNonIdentChar(String.fromCharCode(44))).toBe(0); // ,
      expect(findFirstNonIdentChar(String.fromCharCode(46))).toBe(0); // .
    });

    test('equals (61)', () => {
      expect(findFirstNonIdentChar('=')).toBe(-1);
      expect(findFirstNonIdentChar(String.fromCharCode(60))).toBe(0); // <
      expect(findFirstNonIdentChar(String.fromCharCode(62))).toBe(0); // >
    });

    test('at (64)', () => {
      expect(findFirstNonIdentChar('@')).toBe(-1);
      expect(findFirstNonIdentChar(String.fromCharCode(63))).toBe(0); // ?
    });

    test('colon (58)', () => {
      expect(findFirstNonIdentChar(':')).toBe(-1);
      expect(findFirstNonIdentChar(String.fromCharCode(59))).toBe(0); // ;
    });
  });

  describe('common rejected characters', () => {
    test.each([
      ['space', ' '],
      ['tab', '\t'],
      ['newline', '\n'],
      ['carriage return', '\r'],
      ['dot', '.'],
      ['comma', ','],
      ['slash', '/'],
      ['backslash', '\\'],
      ['quote', '"'],
      ['apostrophe', "'"],
      ['paren-open', '('],
      ['paren-close', ')'],
      ['bracket-open', '{'],
      ['bracket-close', '}'],
      ['hash', '#'],
      ['question', '?'],
      ['exclamation', '!'],
    ])('rejects %s', (_label, ch) => {
      expect(findFirstNonIdentChar(ch)).toBe(0);
      expect(findFirstNonIdentChar('abc' + ch)).toBe(3);
    });
  });

  test('returns the FIRST non-ident index when several are present', () => {
    expect(findFirstNonIdentChar('foo bar/baz')).toBe(3);
    expect(findFirstNonIdentChar('xy?z!w')).toBe(2);
  });

  test('non-ASCII characters are treated as non-ident', () => {
    // The helper is ASCII-only by design (host attr/tag names in HTML5
    // accept some unicode but the tokenizer error spans never include
    // them). Pin the contract.
    expect(findFirstNonIdentChar('café')).toBe(3); // é
    expect(findFirstNonIdentChar('é')).toBe(0); // é alone
    expect(findFirstNonIdentChar('日本語')).toBe(0);
  });
});
