import { createRequire } from 'node:module';
import type * as TS from 'typescript';
import type { PropertyTypeHint, TypeHints } from './compiler/types';

// `typescript` is an OPTIONAL peer dependency of @lifeart/gxt. Only the opt-in
// `WITH_TYPE_CHECKER_HINTS` compiler flag (off by default) runs the TypeScript
// checker, and this module is part of the published compiler entry
// (`@lifeart/gxt/compiler`, via plugins/test.ts). A static `import * as ts`
// made loading the compiler — every `.gts`/`.gjs` build — fail with
// ERR_MODULE_NOT_FOUND in any project without `typescript`. So it is loaded on
// first use instead, synchronously: `transform()` has a sync path, which rules
// out a dynamic `import()`. Resolved from gxt's own location
// (`import.meta.url` = plugins/type-checker-hints.ts in-repo,
// dist/gxt.compiler.es.js when published), where a package manager links an
// installed peer.
let ts: typeof TS;

function loadTypeScript(): typeof TS {
  if (ts === undefined) {
    try {
      ts = createRequire(import.meta.url)('typescript') as typeof TS;
    } catch (error) {
      const err = error as { code?: unknown; message?: unknown };
      if (
        err?.code === 'MODULE_NOT_FOUND' &&
        typeof err.message === 'string' &&
        err.message.startsWith("Cannot find module 'typescript'")
      ) {
        throw Object.assign(
          new Error(
            '@lifeart/gxt: the WITH_TYPE_CHECKER_HINTS compiler flag needs the "typescript" package, ' +
              'which is not installed (it is an optional peer dependency of @lifeart/gxt). ' +
              'Install it (e.g. `npm install --save-dev typescript`) or turn WITH_TYPE_CHECKER_HINTS off.',
          ),
          { code: 'GXT_TYPESCRIPT_MISSING', cause: error },
        );
      }
      throw error;
    }
  }
  return ts;
}

type MaybeTypeHints = TypeHints | undefined;
type HintKind = PropertyTypeHint['kind'];

const HINT_CACHE = new Map<string, readonly MaybeTypeHints[]>();
let cachedCompilerOptions: TS.CompilerOptions | undefined;

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

function getCompilerOptions(): TS.CompilerOptions {
  if (cachedCompilerOptions) {
    return cachedCompilerOptions;
  }

  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
      cachedCompilerOptions = {
        ...parsed.options,
        noEmit: true,
      };
      return cachedCompilerOptions;
    }
  }

  cachedCompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    experimentalDecorators: true,
  };
  return cachedCompilerOptions;
}

function resolveSymbolName(symbol: TS.Symbol | undefined, checker: TS.TypeChecker): string | undefined {
  if (!symbol) {
    return undefined;
  }
  let current = symbol;
  if ((current.flags & ts.SymbolFlags.Alias) !== 0) {
    current = checker.getAliasedSymbol(current);
  }
  return current.getName();
}

function isTrackedDecoratorExpression(
  expression: TS.Expression,
  checker: TS.TypeChecker
): boolean {
  if (ts.isIdentifier(expression)) {
    if (expression.text === 'tracked') {
      return true;
    }
    return resolveSymbolName(checker.getSymbolAtLocation(expression), checker) === 'tracked';
  }

  if (ts.isCallExpression(expression)) {
    return isTrackedDecoratorExpression(expression.expression, checker);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    if (expression.name.text === 'tracked') {
      return true;
    }
    const symbol = checker.getSymbolAtLocation(expression.name);
    return resolveSymbolName(symbol, checker) === 'tracked';
  }

  return false;
}

function hasTrackedDecorator(node: TS.Node, checker: TS.TypeChecker): boolean {
  if (!ts.canHaveDecorators(node)) {
    return false;
  }
  const decorators = ts.getDecorators(node);
  if (!decorators || decorators.length === 0) {
    return false;
  }
  return decorators.some((decorator) => isTrackedDecoratorExpression(decorator.expression, checker));
}

function isReadonlyNode(node: TS.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false);
}

function getLiteralValue(type: TS.Type): string | number | boolean | undefined {
  if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return (type as TS.StringLiteralType).value;
  }
  if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return (type as TS.NumberLiteralType).value;
  }
  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return (type as any).intrinsicName === 'true';
  }
  return undefined;
}

function mergeUnionKinds(kinds: HintKind[]): HintKind {
  const uniq = new Set(kinds);
  if (uniq.size === 1) {
    return kinds[0];
  }
  if ([...uniq].every((kind) => kind === 'primitive')) {
    return 'primitive';
  }
  return 'unknown';
}

function isCellLikeType(type: TS.Type, checker: TS.TypeChecker): boolean {
  const symbolName = resolveSymbolName(type.aliasSymbol ?? type.getSymbol(), checker);
  if (symbolName === 'Cell' || symbolName === 'MergedCell') {
    return true;
  }

  if (type.isUnion()) {
    return type.types.some((part) => isCellLikeType(part, checker));
  }

  const text = checker.typeToString(type);
  return text.includes('Cell<') || text.includes('MergedCell<') || text === 'Cell' || text === 'MergedCell';
}

function classifyType(type: TS.Type, checker: TS.TypeChecker): { kind: HintKind; literalValue?: string | number | boolean } {
  if (type.isUnion()) {
    const classified = type.types.map((part) => classifyType(part, checker));
    const kind = mergeUnionKinds(classified.map((c) => c.kind));
    if (kind !== 'primitive') {
      return { kind };
    }
    const literals = classified
      .map((entry) => entry.literalValue)
      .filter((value) => value !== undefined);
    if (literals.length === 1) {
      return { kind, literalValue: literals[0] };
    }
    return { kind };
  }

  if (isCellLikeType(type, checker)) {
    return { kind: 'cell' };
  }

  const primitiveFlags =
    ts.TypeFlags.StringLike |
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void |
    ts.TypeFlags.BigIntLike;

  if ((type.flags & primitiveFlags) !== 0) {
    return { kind: 'primitive', literalValue: getLiteralValue(type) };
  }

  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
    return { kind: 'function' };
  }

  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    return { kind: 'object' };
  }

  return { kind: 'unknown' };
}

function toHint(
  classification: { kind: HintKind; literalValue?: string | number | boolean },
  opts: { isTracked?: boolean; isReadonly?: boolean }
): PropertyTypeHint {
  return {
    kind: classification.kind,
    ...(classification.literalValue !== undefined ? { literalValue: classification.literalValue } : {}),
    ...(opts.isTracked ? { isTracked: true } : {}),
    ...(opts.isReadonly ? { isReadonly: true } : {}),
  };
}

function getMemberName(name: TS.PropertyName | TS.PrivateIdentifier | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function collectPropertyHints(
  classNode: TS.ClassLikeDeclaration,
  checker: TS.TypeChecker
): Record<string, PropertyTypeHint> | undefined {
  const hints: Record<string, PropertyTypeHint> = {};

  for (const member of classNode.members) {
    if (!ts.isPropertyDeclaration(member)) {
      continue;
    }
    if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) {
      continue;
    }

    const name = getMemberName(member.name);
    if (!name || name.startsWith('#')) {
      continue;
    }

    const isTracked = hasTrackedDecorator(member, checker);
    const isReadonly = isReadonlyNode(member);
    const type = member.type
      ? checker.getTypeFromTypeNode(member.type)
      : member.initializer
        ? checker.getTypeAtLocation(member.initializer)
        : checker.getTypeAtLocation(member);

    if (!type) {
      if (isTracked) {
        hints[`this.${name}`] = toHint({ kind: 'unknown' }, { isTracked, isReadonly });
      }
      continue;
    }

    const classification = classifyType(type, checker);
    if (classification.kind === 'unknown' && !isTracked) {
      continue;
    }
    hints[`this.${name}`] = toHint(classification, { isTracked, isReadonly });
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
}

function collectArgsHints(
  classNode: TS.ClassLikeDeclaration,
  checker: TS.TypeChecker
): Record<string, PropertyTypeHint> | undefined {
  const heritage = classNode.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
  );
  const signatureTypeNode = heritage?.types[0]?.typeArguments?.[0];
  if (!signatureTypeNode) {
    return undefined;
  }

  const signatureType = checker.getTypeFromTypeNode(signatureTypeNode);
  const argsSymbol = checker.getPropertyOfType(signatureType, 'Args');
  if (!argsSymbol) {
    return undefined;
  }

  const argsType = checker.getTypeOfSymbolAtLocation(argsSymbol, signatureTypeNode);
  const argsProps = checker.getPropertiesOfType(argsType);
  if (argsProps.length === 0) {
    return undefined;
  }

  const hints: Record<string, PropertyTypeHint> = {};
  for (const prop of argsProps) {
    const name = prop.getName();
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration ?? signatureTypeNode);
    const classification = classifyType(propType, checker);
    if (classification.kind === 'unknown') {
      continue;
    }
    const isReadonly = declaration ? isReadonlyNode(declaration) : false;
    hints[name] = toHint(classification, { isReadonly });
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
}

function isTemplateFunctionCall(node: TS.CallExpression, templateFunctionNames: ReadonlySet<string>): boolean {
  return ts.isIdentifier(node.expression) && templateFunctionNames.has(node.expression.text);
}

function collectTemplateFunctionNames(sourceFile: TS.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== '@ember/template-compiler') {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      if (element.propertyName?.text === 'template' || (!element.propertyName && element.name.text === 'template')) {
        names.add(element.name.text);
      }
    }
  }

  return names;
}

function findEnclosingClass(node: TS.Node): TS.ClassLikeDeclaration | undefined {
  let current: TS.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function buildClassTypeHints(classNode: TS.ClassLikeDeclaration, checker: TS.TypeChecker): TypeHints | undefined {
  const properties = collectPropertyHints(classNode, checker);
  const args = collectArgsHints(classNode, checker);

  if (!properties && !args) {
    return undefined;
  }

  return {
    ...(properties ? { properties } : {}),
    ...(args ? { args } : {}),
  };
}

function createProgramForVirtualFile(source: string, fileName: string): TS.Program {
  const options = getCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const virtualPath = normalizePath(fileName);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);

  host.fileExists = (candidate) => {
    if (normalizePath(candidate) === virtualPath) {
      return true;
    }
    return originalFileExists(candidate);
  };

  host.readFile = (candidate) => {
    if (normalizePath(candidate) === virtualPath) {
      return source;
    }
    return originalReadFile(candidate);
  };

  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (normalizePath(candidate) === virtualPath) {
      return ts.createSourceFile(candidate, source, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile);
  };

  return ts.createProgram({
    rootNames: [fileName],
    options,
    host,
  });
}

function hashKey(fileName: string, source: string): string {
  return `${fileName}::${source}`;
}

export function resolveTemplateTypeHintsWithChecker(
  source: string,
  fileName: string
): readonly MaybeTypeHints[] {
  // Outside the try below: a missing `typescript` must surface, not degrade
  // into "no hints".
  loadTypeScript();
  const cacheKey = hashKey(fileName, source);
  const cached = HINT_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const program = createProgramForVirtualFile(source, fileName);
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) {
      const empty: readonly MaybeTypeHints[] = [];
      HINT_CACHE.set(cacheKey, empty);
      return empty;
    }

    const checker = program.getTypeChecker();
    const templateFunctionNames = collectTemplateFunctionNames(sourceFile);
    if (templateFunctionNames.size === 0) {
      const empty: readonly MaybeTypeHints[] = [];
      HINT_CACHE.set(cacheKey, empty);
      return empty;
    }

    const hints: MaybeTypeHints[] = [];
    const classHintsCache = new Map<TS.ClassLikeDeclaration, MaybeTypeHints>();

    const visit = (node: TS.Node) => {
      if (ts.isCallExpression(node) && isTemplateFunctionCall(node, templateFunctionNames)) {
        const classNode = findEnclosingClass(node);
        if (!classNode) {
          hints.push(undefined);
        } else {
          if (!classHintsCache.has(classNode)) {
            classHintsCache.set(classNode, buildClassTypeHints(classNode, checker));
          }
          hints.push(classHintsCache.get(classNode));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    HINT_CACHE.set(cacheKey, hints);
    return hints;
  } catch {
    const empty: readonly MaybeTypeHints[] = [];
    HINT_CACHE.set(cacheKey, empty);
    return empty;
  }
}

function mergePropertyHint(
  base: PropertyTypeHint,
  next: PropertyTypeHint
): PropertyTypeHint {
  const kind = next.kind === 'unknown' && base.kind !== 'unknown'
    ? base.kind
    : next.kind;

  return {
    kind,
    ...(next.isTracked === true || base.isTracked === true ? { isTracked: true } : {}),
    ...(next.isReadonly === true || base.isReadonly === true ? { isReadonly: true } : {}),
    ...((next.literalValue ?? base.literalValue) !== undefined
      ? { literalValue: next.literalValue ?? base.literalValue }
      : {}),
  };
}

function mergeHintRecords(
  base: Readonly<Record<string, PropertyTypeHint>> | undefined,
  next: Readonly<Record<string, PropertyTypeHint>> | undefined
): Readonly<Record<string, PropertyTypeHint>> | undefined {
  if (!base && !next) return undefined;
  if (!base) return next;
  if (!next) return base;

  const merged: Record<string, PropertyTypeHint> = { ...base };
  for (const [key, hint] of Object.entries(next)) {
    merged[key] = key in merged
      ? mergePropertyHint(merged[key], hint)
      : hint;
  }
  return merged;
}

export function mergeTypeHints(
  base: TypeHints | undefined,
  next: TypeHints | undefined
): TypeHints | undefined {
  const properties = mergeHintRecords(
    base?.properties,
    next?.properties
  );
  const args = mergeHintRecords(
    base?.args,
    next?.args
  );
  const helperReturns = mergeHintRecords(
    base?.helperReturns,
    next?.helperReturns
  );

  if (!properties && !args && !helperReturns) {
    return undefined;
  }

  return {
    ...(properties ? { properties } : {}),
    ...(args ? { args } : {}),
    ...(helperReturns ? { helperReturns } : {}),
  };
}

export function clearTypeHintCache(): void {
  HINT_CACHE.clear();
}
