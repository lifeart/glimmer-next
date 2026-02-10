import * as ts from 'typescript';
import type { PropertyTypeHint, TypeHints } from './compiler/types';

type MaybeTypeHints = TypeHints | undefined;
type HintKind = PropertyTypeHint['kind'];

const HINT_CACHE = new Map<string, readonly MaybeTypeHints[]>();
let cachedCompilerOptions: ts.CompilerOptions | undefined;

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

function getCompilerOptions(): ts.CompilerOptions {
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

function resolveSymbolName(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): string | undefined {
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
  expression: ts.Expression,
  checker: ts.TypeChecker
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

function hasTrackedDecorator(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!ts.canHaveDecorators(node)) {
    return false;
  }
  const decorators = ts.getDecorators(node);
  if (!decorators || decorators.length === 0) {
    return false;
  }
  return decorators.some((decorator) => isTrackedDecoratorExpression(decorator.expression, checker));
}

function isReadonlyNode(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false);
}

function getLiteralValue(type: ts.Type): string | number | boolean | undefined {
  if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return (type as ts.StringLiteralType).value;
  }
  if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return (type as ts.NumberLiteralType).value;
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

function isCellLikeType(type: ts.Type, checker: ts.TypeChecker): boolean {
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

function classifyType(type: ts.Type, checker: ts.TypeChecker): { kind: HintKind; literalValue?: string | number | boolean } {
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

function getMemberName(name: ts.PropertyName | ts.PrivateIdentifier | undefined): string | undefined {
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
  classNode: ts.ClassLikeDeclaration,
  checker: ts.TypeChecker
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
  classNode: ts.ClassLikeDeclaration,
  checker: ts.TypeChecker
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

function isTemplateFunctionCall(node: ts.CallExpression, templateFunctionNames: ReadonlySet<string>): boolean {
  return ts.isIdentifier(node.expression) && templateFunctionNames.has(node.expression.text);
}

function collectTemplateFunctionNames(sourceFile: ts.SourceFile): Set<string> {
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

function findEnclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function buildClassTypeHints(classNode: ts.ClassLikeDeclaration, checker: ts.TypeChecker): TypeHints | undefined {
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

function createProgramForVirtualFile(source: string, fileName: string): ts.Program {
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
    const classHintsCache = new Map<ts.ClassLikeDeclaration, MaybeTypeHints>();

    const visit = (node: ts.Node) => {
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

function mergeHintRecords<T extends PropertyTypeHint>(
  base: Readonly<Record<string, T>> | undefined,
  next: Readonly<Record<string, T>> | undefined
): Readonly<Record<string, T>> | undefined {
  if (!base && !next) return undefined;
  if (!base) return next;
  if (!next) return base;
  return { ...base, ...next };
}

export function mergeTypeHints(
  base: TypeHints | undefined,
  next: TypeHints | undefined
): TypeHints | undefined {
  const properties = mergeHintRecords(
    base?.properties as Readonly<Record<string, PropertyTypeHint>> | undefined,
    next?.properties as Readonly<Record<string, PropertyTypeHint>> | undefined
  );
  const args = mergeHintRecords(
    base?.args as Readonly<Record<string, PropertyTypeHint>> | undefined,
    next?.args as Readonly<Record<string, PropertyTypeHint>> | undefined
  );
  const helperReturns = mergeHintRecords(
    base?.helperReturns as Readonly<Record<string, PropertyTypeHint>> | undefined,
    next?.helperReturns as Readonly<Record<string, PropertyTypeHint>> | undefined
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
