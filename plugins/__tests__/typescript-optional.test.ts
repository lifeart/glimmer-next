/**
 * `typescript` is an OPTIONAL peer dependency of @lifeart/gxt: the published
 * compiler entry (`@lifeart/gxt/compiler` = plugins/compiler.ts) must load and
 * compile templates in a project that has no `typescript` installed. Only the
 * opt-in WITH_TYPE_CHECKER_HINTS flag needs it, and then it fails with an
 * error that names the missing package.
 *
 * The test makes `typescript` unresolvable on both paths a module could reach
 * it by:
 *   - ESM: `vi.mock('typescript')` with a factory that throws, so any static
 *     or dynamic `import 'typescript'` in the compiler's module graph fails
 *     (and records the attempt);
 *   - CommonJS: `node:module`'s `createRequire` is wrapped so that resolving
 *     `typescript` throws Node's own MODULE_NOT_FOUND shape.
 * The modules under test are imported only after the mocks are installed.
 */
import { describe, test, expect, vi } from 'vitest';

const typescriptImport = vi.hoisted(() => ({ attempted: 0 }));

vi.mock('typescript', () => {
  typescriptImport.attempted++;
  throw new Error("Cannot find package 'typescript' (simulated: typescript is not installed)");
});

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  const notFound = (id: string, from: string | URL) =>
    Object.assign(new Error(`Cannot find module '${id}'\nRequire stack:\n- ${String(from)}`), {
      code: 'MODULE_NOT_FOUND',
    });
  const createRequire = ((from: string | URL) => {
    const real = actual.createRequire(from);
    const blocked = ((id: string) => {
      if (id === 'typescript') throw notFound(id, from);
      return real(id);
    }) as NodeJS.Require;
    blocked.resolve = Object.assign(
      (id: string, options?: { paths?: string[] }) => {
        if (id === 'typescript') throw notFound(id, from);
        return real.resolve(id, options);
      },
      { paths: real.resolve.paths },
    );
    blocked.cache = real.cache;
    blocked.extensions = real.extensions;
    blocked.main = real.main;
    return blocked;
  }) as typeof actual.createRequire;
  return { ...actual, createRequire, default: { ...actual, createRequire } };
});

const GTS = `
import Component from '@glimmer/component';

export default class Hello extends Component {
  greeting = 'hi';
  <template><p class="hello">{{this.greeting}}, {{@name}}</p></template>
}
`;

describe('@lifeart/gxt/compiler without typescript installed', () => {
  test('the compiler entry module loads without importing typescript', async () => {
    const mod = await import('../compiler');
    expect(typeof mod.compiler).toBe('function');
    expect(typescriptImport.attempted).toBe(0);
  });

  test('the vite plugin compiles a .gts template with the default flags', async () => {
    const { compiler } = await import('../compiler');
    const plugin = compiler('production') as any;
    plugin.config({}, { mode: 'production', command: 'build' });
    const result = await plugin.transform(GTS, '/app/components/hello.gts');
    expect(result?.code).toContain('hello');
    expect(result?.code).not.toContain('<template>');
    expect(typescriptImport.attempted).toBe(0);
  });

  test('transform() compiles a .gts template on the sync path', async () => {
    const { transform } = await import('../test');
    const { defaultFlags } = await import('../flags');
    const result = transform(GTS, 'hello.gts', 'production', false, {
      ...defaultFlags(),
      ASYNC_COMPILE_TRANSFORMS: false,
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as { code: string }).code).toContain('hello');
    expect(typescriptImport.attempted).toBe(0);
  });

  test('WITH_TYPE_CHECKER_HINTS names the missing typescript package', async () => {
    const { transform } = await import('../test');
    const { defaultFlags } = await import('../flags');
    let thrown: any;
    try {
      transform(GTS, 'hello.gts', 'production', false, {
        ...defaultFlags(),
        ASYNC_COMPILE_TRANSFORMS: false,
        WITH_TYPE_CHECKER_HINTS: true,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain('WITH_TYPE_CHECKER_HINTS');
    expect(thrown.message).toContain('"typescript" package');
    expect(thrown.code).toBe('GXT_TYPESCRIPT_MISSING');
    expect(thrown.cause?.code).toBe('MODULE_NOT_FOUND');
  });

  test('the simulation is effective: typescript resolves on neither path', async () => {
    const { createRequire } = await import('node:module');
    expect(() => createRequire(import.meta.url)('typescript')).toThrow(
      expect.objectContaining({ code: 'MODULE_NOT_FOUND' }),
    );
    await expect(import('typescript')).rejects.toThrow();
    expect(typescriptImport.attempted).toBeGreaterThan(0);
  });
});
