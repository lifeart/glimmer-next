import { describe, test, expect, beforeEach } from 'vitest';
import { Preprocessor } from 'content-tag';
import {
  clearTypeHintCache,
  mergeTypeHints,
  resolveTemplateTypeHintsWithChecker,
} from '../type-checker-hints';

function resolveFromGts(source: string, fileName = '/virtual/test.gts') {
  const p = new Preprocessor();
  const intermediate = p.process(source, { filename: fileName }).code;
  const replacedFileName = fileName
    .replace('.gts', '.ts')
    .replace('.gjs', '.js');
  return resolveTemplateTypeHintsWithChecker(intermediate, replacedFileName);
}

describe('type-checker-hints', () => {
  beforeEach(() => {
    clearTypeHintCache();
  });

  test('extracts args hints from local glint signature alias', () => {
    const hints = resolveFromGts(`
      type Sig = {
        Args: {
          label: string;
          count: number;
          onClick: () => void;
        };
      };

      export default class Demo extends Component<Sig> {
        <template>{{@label}} {{@count}} {{@onClick}}</template>
      }
    `);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.args?.label).toEqual({ kind: 'primitive' });
    expect(hints[0]?.args?.count).toEqual({ kind: 'primitive' });
    expect(hints[0]?.args?.onClick).toEqual({ kind: 'function' });
  });

  test('extracts typed properties from checker (including Cell)', () => {
    const hints = resolveFromGts(`
      import type { Cell } from '@lifeart/gxt';
      type Sig = { Args: {} };

      export default class Demo extends Component<Sig> {
        title: string;
        state: Cell<number>;
        data: { ok: boolean };
        handle: () => void;

        <template>{{this.title}} {{this.state}} {{this.data}} {{this.handle}}</template>
      }
    `);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.properties?.['this.title']).toEqual({ kind: 'primitive' });
    expect(hints[0]?.properties?.['this.state']).toEqual({ kind: 'cell' });
    expect(hints[0]?.properties?.['this.data']).toEqual({ kind: 'object' });
    expect(hints[0]?.properties?.['this.handle']).toEqual({ kind: 'function' });
  });

  test('extracts readonly literal metadata for properties', () => {
    const hints = resolveFromGts(`
      type Sig = { Args: {} };

      export default class Demo extends Component<Sig> {
        readonly VERSION = "1.2.3";
        <template>{{this.VERSION}}</template>
      }
    `);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.properties?.['this.VERSION']).toEqual({
      kind: 'primitive',
      isReadonly: true,
      literalValue: '1.2.3',
    });
  });

  test('mergeTypeHints combines records and gives precedence to next', () => {
    const merged = mergeTypeHints(
      {
        properties: { 'this.title': { kind: 'primitive' } },
        args: { count: { kind: 'primitive' } },
      },
      {
        properties: { 'this.title': { kind: 'primitive', isReadonly: true } },
        args: { onClick: { kind: 'function' } },
      }
    );

    expect(merged?.properties?.['this.title']).toEqual({ kind: 'primitive', isReadonly: true });
    expect(merged?.args?.count).toEqual({ kind: 'primitive' });
    expect(merged?.args?.onClick).toEqual({ kind: 'function' });
  });

  test('mergeTypeHints preserves checker metadata when next hint is partial', () => {
    const merged = mergeTypeHints(
      {
        properties: {
          'this.VERSION': { kind: 'primitive', isReadonly: true, literalValue: '1.2.3' },
        },
      },
      {
        properties: {
          'this.VERSION': { kind: 'primitive' },
        },
      }
    );

    expect(merged?.properties?.['this.VERSION']).toEqual({
      kind: 'primitive',
      isReadonly: true,
      literalValue: '1.2.3',
    });
  });
});
