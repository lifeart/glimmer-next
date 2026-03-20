import type Babel from '@babel/core';
import { MAIN_IMPORT, SYMBOLS } from './symbols';
import type { PropertyTypeHint, TypeHints } from './compiler/types';

export type ResolvedHBS = {
  template: string;
  flags: {
    hasThisAccess: boolean;
  };
  bindings: Set<string>;
  /** CALLBACK to determine if a variable is in the lexical scope */
  lexicalScope?: (name: string) => boolean;
  /** Source location of the template in the original file (for source maps) */
  loc?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  /** Type hints extracted from class analysis (decorators + TS/Glint signatures) */
  typeHints?: TypeHints;
};

function getScopeBindings(path: any, bindings: Set<string> = new Set()) {
  Object.keys(path.scope.bindings).forEach((key) => {
    bindings.add(key);
  });
  if (path.parentPath) {
    getScopeBindings(path.parentPath, bindings);
  }
  return bindings;
}

type ImportHintState = {
  trackedDecoratorNames: Set<string>;
  trackedDecoratorNamespaces: Set<string>;
  reactiveFactoryNames: Set<string>;
  reactiveFactoryNamespaces: Set<string>;
  reactiveCellTypeNames: Set<string>;
  reactiveCellTypeNamespaces: Set<string>;
};

type MutableTypeHints = {
  properties?: Record<string, PropertyTypeHint>;
  args?: Record<string, PropertyTypeHint>;
  helperReturns?: Record<string, PropertyTypeHint>;
};

type ClassHintState = {
  typeHints: MutableTypeHints;
};

type TypeDeclaration =
  | Babel.types.TSTypeAliasDeclaration
  | Babel.types.TSInterfaceDeclaration;

type TypeRegistry = Map<string, TypeDeclaration>;

type InferredHint = {
  kind: PropertyTypeHint['kind'];
  literalValue?: string | number | boolean;
};

type TemplateTransformContext = {
  isInsideClassBody?: boolean;
  isInsideReturnStatement?: boolean;
  tokensForHotReload?: string[];
  classHintStack?: ClassHintState[];
  importHintState?: ImportHintState;
  typeRegistry?: TypeRegistry;
};

const TRACKED_IMPORT_SOURCES = new Set([MAIN_IMPORT, '@glimmer/tracking']);
const REACTIVE_FACTORY_IMPORT_SOURCES = new Set([MAIN_IMPORT]);

function createImportHintState(): ImportHintState {
  // Keep these defaults to preserve existing behavior even when imports are omitted.
  return {
    trackedDecoratorNames: new Set(['tracked']),
    trackedDecoratorNamespaces: new Set(),
    reactiveFactoryNames: new Set(['cell', 'formula']),
    reactiveFactoryNamespaces: new Set(),
    reactiveCellTypeNames: new Set(['Cell', 'MergedCell']),
    reactiveCellTypeNamespaces: new Set(),
  };
}

function getImportHintState(context: TemplateTransformContext): ImportHintState {
  if (!context.importHintState) {
    context.importHintState = createImportHintState();
  }
  return context.importHintState;
}

function getClassHintStack(context: TemplateTransformContext): ClassHintState[] {
  if (!context.classHintStack) {
    context.classHintStack = [];
  }
  return context.classHintStack;
}

function getCurrentClassTypeHints(
  context: TemplateTransformContext
): MutableTypeHints | undefined {
  const stack = context.classHintStack;
  if (!stack || stack.length === 0) {
    return undefined;
  }
  return stack[stack.length - 1].typeHints;
}

function getTypeRegistry(context: TemplateTransformContext): TypeRegistry {
  if (!context.typeRegistry) {
    context.typeRegistry = new Map<string, TypeDeclaration>();
  }
  return context.typeRegistry;
}

function getEntityNameText(entityName: Babel.types.TSEntityName): string {
  if (entityName.type === 'Identifier') {
    return entityName.name;
  }
  return `${getEntityNameText(entityName.left)}.${entityName.right.name}`;
}

function getEntityNameRoot(entityName: Babel.types.TSEntityName): string {
  if (entityName.type === 'Identifier') {
    return entityName.name;
  }
  return getEntityNameRoot(entityName.left);
}

function getEntityNameTail(entityName: Babel.types.TSEntityName): string {
  if (entityName.type === 'Identifier') {
    return entityName.name;
  }
  return entityName.right.name;
}

function getSimpleKeyName(
  key:
    | Babel.types.Expression
    | Babel.types.PrivateName
    | Babel.types.Identifier
    | Babel.types.StringLiteral
    | Babel.types.NumericLiteral
): string | undefined {
  if (key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'StringLiteral') {
    return key.value;
  }
  if (key.type === 'NumericLiteral') {
    return String(key.value);
  }
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? key.quasis[0]?.value.raw;
  }
  return undefined;
}

function extractDeclarationFromStatement(
  statement: Babel.types.Statement | Babel.types.ModuleDeclaration
): Babel.types.Declaration | null | undefined {
  if (statement.type === 'ExportNamedDeclaration') {
    return statement.declaration;
  }
  if (statement.type === 'ExportDefaultDeclaration') {
    return statement.declaration as Babel.types.Declaration;
  }
  return statement as Babel.types.Declaration;
}

function buildTypeRegistry(program: Babel.types.Program): TypeRegistry {
  const registry = new Map<string, TypeDeclaration>();
  for (const statement of program.body) {
    const declaration = extractDeclarationFromStatement(statement);
    if (!declaration) continue;
    if (declaration.type === 'TSTypeAliasDeclaration' || declaration.type === 'TSInterfaceDeclaration') {
      registry.set(declaration.id.name, declaration);
    }
  }
  return registry;
}

function cloneTypeHints(typeHints: MutableTypeHints): TypeHints | undefined {
  const properties = typeHints.properties && Object.keys(typeHints.properties).length > 0
    ? { ...typeHints.properties }
    : undefined;
  const args = typeHints.args && Object.keys(typeHints.args).length > 0
    ? { ...typeHints.args }
    : undefined;
  const helperReturns = typeHints.helperReturns && Object.keys(typeHints.helperReturns).length > 0
    ? { ...typeHints.helperReturns }
    : undefined;

  if (!properties && !args && !helperReturns) {
    return undefined;
  }

  return {
    ...(properties ? { properties } : {}),
    ...(args ? { args } : {}),
    ...(helperReturns ? { helperReturns } : {}),
  };
}

function registerImportHints(
  node: Babel.types.ImportDeclaration,
  state: ImportHintState
) {
  const source = node.source.value;
  const supportsTrackedDecorators = TRACKED_IMPORT_SOURCES.has(source);
  const supportsReactiveFactories = REACTIVE_FACTORY_IMPORT_SOURCES.has(source);
  if (!supportsTrackedDecorators && !supportsReactiveFactories) {
    return;
  }

  for (const specifier of node.specifiers) {
    if (specifier.type === 'ImportSpecifier') {
      const imported = specifier.imported.type === 'Identifier'
        ? specifier.imported.name
        : specifier.imported.value;
      const local = specifier.local.name;
      if (supportsTrackedDecorators && imported === 'tracked') {
        state.trackedDecoratorNames.add(local);
      }
      if (supportsReactiveFactories && (imported === 'cell' || imported === 'formula')) {
        state.reactiveFactoryNames.add(local);
      }
      if (supportsReactiveFactories && (imported === 'Cell' || imported === 'MergedCell')) {
        state.reactiveCellTypeNames.add(local);
      }
      continue;
    }

    if (specifier.type === 'ImportNamespaceSpecifier') {
      const local = specifier.local.name;
      if (supportsTrackedDecorators) {
        state.trackedDecoratorNamespaces.add(local);
      }
      if (supportsReactiveFactories) {
        state.reactiveFactoryNamespaces.add(local);
        state.reactiveCellTypeNamespaces.add(local);
      }
    }
  }
}

function hasTrackedDecorator(
  decorators: readonly Babel.types.Decorator[] | null | undefined,
  state: ImportHintState
): boolean {
  if (!decorators || decorators.length === 0) {
    return false;
  }
  return decorators.some((decorator) =>
    isTrackedDecoratorExpression(decorator.expression, state)
  );
}

function isTrackedDecoratorExpression(
  expression: Babel.types.Expression,
  state: ImportHintState
): boolean {
  if (expression.type === 'Identifier') {
    return state.trackedDecoratorNames.has(expression.name);
  }

  if (expression.type === 'CallExpression') {
    const callee = expression.callee;
    if (callee.type === 'Super' || callee.type === 'V8IntrinsicIdentifier') {
      return false;
    }
    return isTrackedDecoratorExpression(callee, state);
  }

  if (
    expression.type === 'MemberExpression'
    && !expression.computed
    && expression.object.type === 'Identifier'
    && expression.property.type === 'Identifier'
  ) {
    return state.trackedDecoratorNamespaces.has(expression.object.name)
      && expression.property.name === 'tracked';
  }

  return false;
}

function isReactiveFactoryCall(
  expression: Babel.types.Expression,
  state: ImportHintState
): boolean {
  if (expression.type !== 'CallExpression') {
    return false;
  }

  const callee = expression.callee;
  if (callee.type === 'Identifier') {
    return state.reactiveFactoryNames.has(callee.name);
  }

  if (
    callee.type === 'MemberExpression'
    && !callee.computed
    && callee.object.type === 'Identifier'
    && callee.property.type === 'Identifier'
  ) {
    return state.reactiveFactoryNamespaces.has(callee.object.name)
      && (callee.property.name === 'cell' || callee.property.name === 'formula');
  }

  return false;
}

function unwrapTypeScriptExpression(
  expression: Babel.types.Expression
): Babel.types.Expression {
  let current = expression;
  while (
    current.type === 'TSAsExpression'
    || current.type === 'TSTypeAssertion'
    || current.type === 'TSNonNullExpression'
    || current.type === 'ParenthesizedExpression'
  ) {
    current = current.expression;
  }
  return current;
}

function unwrapTSType(typeNode: Babel.types.TSType): Babel.types.TSType {
  let current = typeNode;
  while (current.type === 'TSParenthesizedType') {
    current = current.typeAnnotation;
  }
  return current;
}

function getPrimitiveHint(
  expression: Babel.types.Expression
): InferredHint | undefined {
  if (expression.type === 'StringLiteral') {
    return { kind: 'primitive', literalValue: expression.value };
  }
  if (expression.type === 'NumericLiteral') {
    return { kind: 'primitive', literalValue: expression.value };
  }
  if (expression.type === 'BooleanLiteral') {
    return { kind: 'primitive', literalValue: expression.value };
  }
  if (expression.type === 'NullLiteral') {
    return { kind: 'primitive' };
  }
  if (expression.type === 'Identifier' && expression.name === 'undefined') {
    return { kind: 'primitive' };
  }
  if (
    expression.type === 'UnaryExpression'
    && expression.argument.type === 'NumericLiteral'
    && (expression.operator === '-' || expression.operator === '+')
  ) {
    return {
      kind: 'primitive',
      literalValue: expression.operator === '-'
        ? -expression.argument.value
        : expression.argument.value,
    };
  }
  return undefined;
}

function createInferredHint(
  kind: PropertyTypeHint['kind'],
  literalValue?: string | number | boolean
): InferredHint {
  return {
    kind,
    ...(literalValue !== undefined ? { literalValue } : {}),
  };
}

function createHint(
  inferred: InferredHint,
  isTracked: boolean,
  isReadonly: boolean
): PropertyTypeHint {
  return {
    kind: inferred.kind,
    ...(isTracked ? { isTracked: true } : {}),
    ...(isReadonly ? { isReadonly: true } : {}),
    ...(inferred.literalValue !== undefined ? { literalValue: inferred.literalValue } : {}),
  };
}

function resolveTypeDeclaration(
  typeName: Babel.types.TSEntityName,
  registry: TypeRegistry
): TypeDeclaration | undefined {
  const exact = registry.get(getEntityNameText(typeName));
  if (exact) {
    return exact;
  }
  return registry.get(getEntityNameRoot(typeName));
}

function inferHintFromInterface(
  declaration: Babel.types.TSInterfaceDeclaration
): InferredHint {
  const hasCallSignature = declaration.body.body.some(
    (member) =>
      member.type === 'TSCallSignatureDeclaration'
      || member.type === 'TSConstructSignatureDeclaration'
  );
  if (hasCallSignature) {
    return createInferredHint('function');
  }
  return createInferredHint('object');
}

function mergeUnionKinds(
  types: readonly Babel.types.TSType[],
  state: ImportHintState,
  registry: TypeRegistry,
  seen: Set<string>
): InferredHint {
  const inferred = types.map((typeNode) => inferHintFromTypeNode(typeNode, state, registry, seen));
  const kinds = new Set(inferred.map((hint) => hint.kind));
  if (kinds.size === 1) {
    const kind = inferred[0].kind;
    if (kind !== 'primitive') {
      return createInferredHint(kind);
    }
    const literalCandidates = inferred
      .map((hint) => hint.literalValue)
      .filter((value) => value !== undefined);
    if (literalCandidates.length === 1) {
      return createInferredHint('primitive', literalCandidates[0]);
    }
    return createInferredHint('primitive');
  }
  if ([...kinds].every((kind) => kind === 'primitive')) {
    return createInferredHint('primitive');
  }
  return createInferredHint('unknown');
}

function inferHintFromTypeNode(
  typeNode: Babel.types.TSType,
  state: ImportHintState,
  registry: TypeRegistry,
  seen: Set<string> = new Set()
): InferredHint {
  const type = unwrapTSType(typeNode);

  if (
    type.type === 'TSStringKeyword'
    || type.type === 'TSNumberKeyword'
    || type.type === 'TSBooleanKeyword'
    || type.type === 'TSNullKeyword'
    || type.type === 'TSUndefinedKeyword'
    || type.type === 'TSVoidKeyword'
  ) {
    return createInferredHint('primitive');
  }

  if (type.type === 'TSLiteralType') {
    if (type.literal.type === 'StringLiteral') {
      return createInferredHint('primitive', type.literal.value);
    }
    if (type.literal.type === 'NumericLiteral') {
      return createInferredHint('primitive', type.literal.value);
    }
    if (type.literal.type === 'BooleanLiteral') {
      return createInferredHint('primitive', type.literal.value);
    }
    return createInferredHint('primitive');
  }

  if (
    type.type === 'TSFunctionType'
    || type.type === 'TSConstructorType'
  ) {
    return createInferredHint('function');
  }

  if (
    type.type === 'TSArrayType'
    || type.type === 'TSTupleType'
    || type.type === 'TSTypeLiteral'
    || type.type === 'TSObjectKeyword'
    || type.type === 'TSMappedType'
  ) {
    return createInferredHint('object');
  }

  if (type.type === 'TSUnionType') {
    return mergeUnionKinds(type.types, state, registry, seen);
  }

  if (type.type === 'TSIntersectionType') {
    return createInferredHint('unknown');
  }

  if (type.type === 'TSTypeOperator') {
    if (type.operator === 'readonly') {
      return inferHintFromTypeNode(type.typeAnnotation, state, registry, seen);
    }
    return createInferredHint('unknown');
  }

  if (type.type === 'TSTypeReference') {
    const tailName = getEntityNameTail(type.typeName);
    if (
      (type.typeName.type === 'Identifier'
        && state.reactiveCellTypeNames.has(type.typeName.name))
      || (type.typeName.type === 'TSQualifiedName'
        && state.reactiveCellTypeNamespaces.has(getEntityNameRoot(type.typeName))
        && (tailName === 'Cell' || tailName === 'MergedCell'))
      || tailName === 'Cell'
      || tailName === 'MergedCell'
    ) {
      return createInferredHint('cell');
    }

    const declaration = resolveTypeDeclaration(type.typeName, registry);
    if (declaration) {
      const declarationKey = declaration.type === 'TSTypeAliasDeclaration'
        ? `alias:${declaration.id.name}`
        : `interface:${declaration.id.name}`;
      if (seen.has(declarationKey)) {
        return createInferredHint('unknown');
      }
      seen.add(declarationKey);
      const resolved = declaration.type === 'TSTypeAliasDeclaration'
        ? inferHintFromTypeNode(declaration.typeAnnotation, state, registry, seen)
        : inferHintFromInterface(declaration);
      seen.delete(declarationKey);
      return resolved;
    }

    if (
      tailName === 'Array'
      || tailName === 'ReadonlyArray'
      || tailName === 'Record'
      || tailName === 'Map'
      || tailName === 'Set'
      || tailName === 'Promise'
      || tailName === 'Date'
      || tailName === 'RegExp'
      || tailName.endsWith('Element')
      || tailName.endsWith('Node')
      || tailName.endsWith('Event')
    ) {
      return createInferredHint('object');
    }

    if (tailName === 'Function') {
      return createInferredHint('function');
    }

    if (tailName === 'String' || tailName === 'Number' || tailName === 'Boolean') {
      return createInferredHint('primitive');
    }
  }

  return createInferredHint('unknown');
}

function inferHintFromClassPropertyType(
  property: Babel.types.ClassProperty,
  state: ImportHintState,
  registry: TypeRegistry
): InferredHint | undefined {
  if (!property.typeAnnotation || property.typeAnnotation.type !== 'TSTypeAnnotation') {
    return undefined;
  }
  return inferHintFromTypeNode(property.typeAnnotation.typeAnnotation, state, registry);
}

function inferHintFromInitializer(
  init: Babel.types.Expression,
  state: ImportHintState
): InferredHint | undefined {
  const normalized = unwrapTypeScriptExpression(init);

  if (isReactiveFactoryCall(normalized, state)) {
    return createInferredHint('cell');
  }

  if (normalized.type === 'ArrowFunctionExpression' || normalized.type === 'FunctionExpression') {
    return createInferredHint('function');
  }

  if (normalized.type === 'ObjectExpression' || normalized.type === 'ArrayExpression') {
    return createInferredHint('object');
  }

  if (normalized.type === 'TemplateLiteral' && normalized.expressions.length === 0) {
    const cooked = normalized.quasis[0]?.value.cooked;
    const raw = normalized.quasis[0]?.value.raw;
    return createInferredHint('primitive', cooked ?? raw);
  }

  return getPrimitiveHint(normalized);
}

function getArgsTypeFromMembers(
  members: readonly (
    Babel.types.TSPropertySignature
    | Babel.types.TSMethodSignature
    | Babel.types.TSCallSignatureDeclaration
    | Babel.types.TSConstructSignatureDeclaration
    | Babel.types.TSIndexSignature
  )[]
): Babel.types.TSType | undefined {
  for (const member of members) {
    if (member.type !== 'TSPropertySignature') continue;
    const memberName = getSimpleKeyName(member.key as any);
    if (memberName !== 'Args') continue;
    if (member.typeAnnotation?.type === 'TSTypeAnnotation') {
      return member.typeAnnotation.typeAnnotation;
    }
  }
  return undefined;
}

function resolveArgsTypeFromSignature(
  signatureType: Babel.types.TSType,
  registry: TypeRegistry,
  seen: Set<string> = new Set()
): Babel.types.TSType | undefined {
  const normalized = unwrapTSType(signatureType);

  if (normalized.type === 'TSTypeLiteral') {
    return getArgsTypeFromMembers(normalized.members);
  }

  if (normalized.type === 'TSIntersectionType') {
    for (const part of normalized.types) {
      const resolved = resolveArgsTypeFromSignature(part, registry, seen);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  if (normalized.type === 'TSTypeReference') {
    const declaration = resolveTypeDeclaration(normalized.typeName, registry);
    if (!declaration) {
      return undefined;
    }
    const key = declaration.type === 'TSTypeAliasDeclaration'
      ? `alias:${declaration.id.name}`
      : `interface:${declaration.id.name}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    const resolved = declaration.type === 'TSTypeAliasDeclaration'
      ? resolveArgsTypeFromSignature(declaration.typeAnnotation, registry, seen)
      : resolveArgsTypeFromInterface(declaration, registry, seen);
    seen.delete(key);
    return resolved;
  }

  return undefined;
}

function resolveArgsTypeFromInterface(
  declaration: Babel.types.TSInterfaceDeclaration,
  registry: TypeRegistry,
  seen: Set<string>
): Babel.types.TSType | undefined {
  const directArgs = getArgsTypeFromMembers(declaration.body.body);
  if (directArgs) {
    return directArgs;
  }

  for (const parent of declaration.extends ?? []) {
    if (parent.expression.type !== 'Identifier' && parent.expression.type !== 'TSQualifiedName') {
      continue;
    }
    const parentRef: Babel.types.TSTypeReference = {
      type: 'TSTypeReference',
      typeName: parent.expression,
      typeParameters: parent.typeParameters ?? null,
    };
    const resolved = resolveArgsTypeFromSignature(parentRef, registry, seen);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function extractArgHintsFromArgsType(
  argsType: Babel.types.TSType,
  state: ImportHintState,
  registry: TypeRegistry,
  seen: Set<string> = new Set()
): Record<string, PropertyTypeHint> | undefined {
  const normalized = unwrapTSType(argsType);

  if (normalized.type === 'TSIntersectionType') {
    const merged: Record<string, PropertyTypeHint> = {};
    for (const part of normalized.types) {
      const hints = extractArgHintsFromArgsType(part, state, registry, seen);
      if (hints) {
        Object.assign(merged, hints);
      }
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  if (normalized.type === 'TSTypeReference') {
    const declaration = resolveTypeDeclaration(normalized.typeName, registry);
    if (!declaration) {
      return undefined;
    }
    const key = declaration.type === 'TSTypeAliasDeclaration'
      ? `alias:${declaration.id.name}`
      : `interface:${declaration.id.name}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    const resolved = declaration.type === 'TSTypeAliasDeclaration'
      ? extractArgHintsFromArgsType(declaration.typeAnnotation, state, registry, seen)
      : extractArgHintsFromArgsType(
          {
            type: 'TSTypeLiteral',
            members: declaration.body.body,
          },
          state,
          registry,
          seen
        );
    seen.delete(key);
    return resolved;
  }

  if (normalized.type !== 'TSTypeLiteral') {
    return undefined;
  }

  const hints: Record<string, PropertyTypeHint> = {};
  for (const member of normalized.members) {
    if (member.type !== 'TSPropertySignature') continue;
    const key = getSimpleKeyName(member.key as any);
    if (!key) continue;
    if (!member.typeAnnotation || member.typeAnnotation.type !== 'TSTypeAnnotation') continue;
    const inferred = inferHintFromTypeNode(member.typeAnnotation.typeAnnotation, state, registry);
    hints[key] = createHint(inferred, false, member.readonly === true);
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function resolveArgsHintsForClass(
  classNode: Babel.types.ClassDeclaration | Babel.types.ClassExpression,
  state: ImportHintState,
  registry: TypeRegistry
): Record<string, PropertyTypeHint> | undefined {
  const superTypeParameters = classNode.superTypeParameters;
  if (!superTypeParameters || superTypeParameters.type !== 'TSTypeParameterInstantiation') {
    return undefined;
  }
  const signatureType = superTypeParameters.params[0];
  if (!signatureType) {
    return undefined;
  }
  const argsType = resolveArgsTypeFromSignature(signatureType, registry);
  if (!argsType) {
    return undefined;
  }
  return extractArgHintsFromArgsType(argsType, state, registry);
}

function createClassHintState(
  classNode: Babel.types.ClassDeclaration | Babel.types.ClassExpression,
  context: TemplateTransformContext
): ClassHintState {
  const argsHints = resolveArgsHintsForClass(
    classNode,
    getImportHintState(context),
    getTypeRegistry(context)
  );
  return {
    typeHints: {
      properties: {},
      ...(argsHints ? { args: argsHints } : {}),
    },
  };
}

function inferPropertyHint(
  property: Babel.types.ClassProperty,
  state: ImportHintState,
  registry: TypeRegistry
): PropertyTypeHint | undefined {
  const isTracked = hasTrackedDecorator(property.decorators, state);
  const isReadonly = property.readonly === true;
  const typeHint = inferHintFromClassPropertyType(property, state, registry);
  const initHint = property.value ? inferHintFromInitializer(property.value, state) : undefined;

  if (initHint) {
    return createHint(initHint, isTracked, isReadonly);
  }

  if (typeHint) {
    return createHint(typeHint, isTracked, isReadonly);
  }

  if (isTracked) {
    return createHint(createInferredHint('unknown'), true, isReadonly);
  }

  return undefined;
}

export function processTemplate(
  hbsToProcess: ResolvedHBS[],
  mode: 'development' | 'production',
) {
  return function babelPlugin(babel: { types: typeof Babel.types }) {
    const { types: t } = babel;
    const getTemplateFunctionNames = (path: Babel.NodePath<any>) => {
      const state = (path.state ??= {}) as { templateFunctionNames?: Set<string> };
      if (!state.templateFunctionNames) {
        state.templateFunctionNames = new Set<string>();
      }
      return state.templateFunctionNames;
    };
    return {
      name: 'ast-transform', // not required
      visitor: {
        VariableDeclarator(path: Babel.NodePath<Babel.types.VariableDeclarator>, context: TemplateTransformContext) {
          if (mode !== 'development') {
            return;
          }
          if (!context.tokensForHotReload) {
            return;
          }
          const tokensForHotReload = context.tokensForHotReload as string[];
          if (path.node.id.type === 'Identifier') {
            if (path.node.id.name === 'existingTokensToReload') {
              path.node.init = t.arrayExpression(
                tokensForHotReload.map((token: string) => {
                  return t.stringLiteral(token);
                }),
              );
            }
          }
        },
        ExportNamedDeclaration(path: Babel.NodePath<Babel.types.ExportNamedDeclaration>, context: TemplateTransformContext) {
          if (mode !== 'development') {
            return;
          }
          if (!context.tokensForHotReload) {
            context.tokensForHotReload = [];
          }
          if (path.node.declaration) {
            if (path.node.declaration.type === 'VariableDeclaration') {
              const declarations = path.node.declaration.declarations;
              if (declarations.length === 1) {
                const declaration = declarations[0];
                if (declaration.id.type === 'Identifier') {
                  const existingTokens = context.tokensForHotReload as string[];
                  existingTokens.push(declaration.id.name);
                }
              }
            } else if (path.node.declaration.type === 'ClassDeclaration') {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(declaration.id.name);
              }
            } else if (path.node.declaration.type === 'FunctionDeclaration') {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(declaration.id.name);
              }
            }
          }
        },
        ExportDefaultDeclaration(path: Babel.NodePath<Babel.types.ExportDefaultDeclaration>, context: TemplateTransformContext) {
          if (mode !== 'development') {
            return;
          }
          if (!context.tokensForHotReload) {
            context.tokensForHotReload = [];
          }
          if (path.node.declaration) {
            if (path.node.declaration.type === 'ClassDeclaration' && path.node.declaration.id) {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(`${declaration.id.name}:default`);
              }
            } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(`${declaration.id.name}:default`);
              }
            }
          }
        },
        ClassDeclaration: {
          enter(path: Babel.NodePath<Babel.types.ClassDeclaration>, context: TemplateTransformContext) {
            getClassHintStack(context).push(createClassHintState(path.node, context));
          },
          exit(_: Babel.NodePath<Babel.types.ClassDeclaration>, context: TemplateTransformContext) {
            getClassHintStack(context).pop();
          },
        },
        ClassExpression: {
          enter(path: Babel.NodePath<Babel.types.ClassExpression>, context: TemplateTransformContext) {
            getClassHintStack(context).push(createClassHintState(path.node, context));
          },
          exit(_: Babel.NodePath<Babel.types.ClassExpression>, context: TemplateTransformContext) {
            getClassHintStack(context).pop();
          },
        },
        ClassBody: {
          enter(_: Babel.NodePath<Babel.types.ClassBody>, context: TemplateTransformContext) {
            // here we assume that class is extends from our Component
            // @todo - check if it's really extends from Component
            context.isInsideClassBody = true;
            const hasOnlyStaticMethod = _.node.body.length === 1
              && _.node.body[0].type === 'ClassMethod'
              && _.node.body[0].key.type === 'Identifier'
              && _.node.body[0].key.name === '$static';
            if (hasOnlyStaticMethod) {
              // class body with only $static method
              context.isInsideClassBody = false;
            }
          },
          exit(_: Babel.NodePath<Babel.types.ClassBody>, context: TemplateTransformContext) {
            context.isInsideClassBody = false;
          },
        },
        ClassProperty(path: Babel.NodePath<Babel.types.ClassProperty>, context: TemplateTransformContext) {
          // Static properties are not accessed via this.propName in templates
          if (path.node.static) return;
          const typeHints = getCurrentClassTypeHints(context);
          const properties = typeHints?.properties;
          if (!typeHints || !properties) return;
          const propName = getSimpleKeyName(path.node.key);
          if (propName) {
            const hint = inferPropertyHint(
              path.node,
              getImportHintState(context),
              getTypeRegistry(context)
            );
            if (hint) {
              properties[`this.${propName}`] = hint;
            }
          }
        },
        ClassMethod(path: Babel.NodePath<Babel.types.ClassMethod>) {
          if (path.node.key.type === 'Identifier' && path.node.key.name === '$static') {
            path.replaceWith(
              t.classProperty(
                t.identifier(SYMBOLS.$template),
                // hbs literal
                t.taggedTemplateExpression(
                  t.identifier('hbs'),
                  // @ts-expect-error expression type
                  path.node.body.body[0].expression.arguments[0],
                ),
                null,
                null,
                true,
              ),
            );
          }
        },
        // Handle static block pattern from content-tag preprocessor
        // Converts: static { template(`...`, {...}) }
        // To: [$template] = hbs`...`
        StaticBlock(path: Babel.NodePath<Babel.types.StaticBlock>) {
          // Check if the static block contains a single template() call or hbs``
          const body = path.node.body;
          if (body.length === 1 && body[0].type === 'ExpressionStatement') {
            const expr = body[0].expression;
            // Check for template() call
            if (
              expr.type === 'CallExpression' &&
              expr.callee.type === 'Identifier' &&
              expr.arguments[0]?.type === 'TemplateLiteral'
            ) {
              const templateFnNames = getTemplateFunctionNames(path);
              const isTemplateCall = expr.callee.name === 'template'
                || templateFnNames.has(expr.callee.name);
              if (isTemplateCall) {
                // Convert to [$template] = hbs`...` property
                path.replaceWith(
                  t.classProperty(
                    t.identifier(SYMBOLS.$template),
                    t.taggedTemplateExpression(
                      t.identifier('hbs'),
                      expr.arguments[0] as Babel.types.TemplateLiteral,
                    ),
                    null,
                    null,
                    true,
                  ),
                );
              }
            }
            // Check for hbs`` (already transformed)
            else if (expr.type === 'TaggedTemplateExpression' &&
                     expr.tag.type === 'Identifier' &&
                     expr.tag.name === 'hbs') {
              path.replaceWith(
                t.classProperty(
                  t.memberExpression(t.thisExpression(), t.identifier(SYMBOLS.$template)),
                  expr,
                  null,
                  null,
                  false,
                  true,
                ),
              );
            }
          }
        },
        CallExpression(path: Babel.NodePath<Babel.types.CallExpression>) {
          if (path.node.callee && path.node.callee.type === 'Identifier') {
            if (path.node.callee.name === 'scope') {
              path.remove();
            } else {
              const templateFnNames = getTemplateFunctionNames(path);
              const isTemplateCall = path.node.callee.name === 'template'
                || templateFnNames.has(path.node.callee.name);
              if (isTemplateCall) {
                path.replaceWith(
                  t.taggedTemplateExpression(
                    t.identifier('hbs'),
                    path.node.arguments[0] as Babel.types.TemplateLiteral,
                  ),
                );
              } else if (path.node.callee.name === 'formula') {
                if (mode === 'production') {
                  // remove last argument if two arguments
                  if (path.node.arguments.length === 2) {
                    path.node.arguments.pop();
                  }
                }
              } else if (path.node.callee.name === 'getRenderTargets') {
                if (mode === 'production') {
                  // remove last argument if two arguments
                  if (path.node.arguments.length === 2) {
                    path.node.arguments.pop();
                  }
                }
              }
            }
          }
        },
        ImportDeclaration(path: Babel.NodePath<Babel.types.ImportDeclaration>, context: TemplateTransformContext) {
          registerImportHints(path.node, getImportHintState(context));
          if (path.node.source.value === '@ember/template-compiler') {
            const templateFunctionNames = getTemplateFunctionNames(path);
            templateFunctionNames.add('template');
            path.node.source.value = MAIN_IMPORT;
            path.node.specifiers.forEach((specifier: any) => {
              if (specifier.type === 'ImportSpecifier') {
                const importedName = specifier.imported.type === 'Identifier' ? specifier.imported.name : undefined;
                if (importedName === 'template') {
                  templateFunctionNames.add(specifier.local.name);
                }
                specifier.local.name = 'hbs';
                specifier.imported.name = 'hbs';
              } else {
                specifier.local.name = 'hbs';
              }
            });
          }
        },
        Program(path: Babel.NodePath<Babel.types.Program>, context: TemplateTransformContext) {
          context.importHintState = createImportHintState();
          context.classHintStack = [];
          context.typeRegistry = buildTypeRegistry(path.node);
          const state = (path.state ??= {}) as { templateFunctionNames?: Set<string> };
          state.templateFunctionNames = new Set<string>();
          const PUBLIC_API = Object.values(SYMBOLS);
          const IMPORTS = PUBLIC_API.map((name) => {
            return t.importSpecifier(t.identifier(name), t.identifier(name));
          });
          path.node.body.unshift(
            t.importDeclaration(IMPORTS, t.stringLiteral(MAIN_IMPORT)),
          );
        },
        ReturnStatement: {
          enter(_: Babel.NodePath<Babel.types.ReturnStatement>, context: TemplateTransformContext) {
            context.isInsideReturnStatement = true;
          },
          exit(_: Babel.NodePath<Babel.types.ReturnStatement>, context: TemplateTransformContext) {
            context.isInsideReturnStatement = false;
          },
        },
        TaggedTemplateExpression(path: Babel.NodePath<Babel.types.TaggedTemplateExpression>, context: TemplateTransformContext) {
          if (path.node.tag.type === 'Identifier' && path.node.tag.name === 'hbs') {
            const template = path.node.quasi.quasis[0].value.raw as string;
            const isInsideClassBody = context.isInsideClassBody === true;
            const hasThisInTemplate = template.includes('this');
            let hasThisAccess = isInsideClassBody === true || hasThisInTemplate;
            // looks like it's function based template, we don't need to mess with it's context hell
            if (context.isInsideReturnStatement === true) {
              hasThisAccess = true;
            }
            // Capture template content location for source maps
            // The quasi.quasis[0] contains the actual template string content
            const quasiLoc = path.node.quasi.quasis[0].loc;
            const classTypeHints = getCurrentClassTypeHints(context);
            const typeHints = classTypeHints ? cloneTypeHints(classTypeHints) : undefined;
            hbsToProcess.push({
              template,
              flags: {
                hasThisAccess: hasThisAccess,
              },
              bindings: getScopeBindings(path),
              lexicalScope: (name: string) => path.scope.hasBinding(name),
              loc: quasiLoc ? {
                start: {
                  line: quasiLoc.start.line,
                  column: quasiLoc.start.column,
                  offset: path.node.quasi.quasis[0].start ?? (quasiLoc.start as any).offset,
                },
                end: {
                  line: quasiLoc.end.line,
                  column: quasiLoc.end.column,
                  offset: path.node.quasi.quasis[0].end ?? (quasiLoc.end as any).offset,
                },
              } : undefined,
              typeHints,
            });
            path.replaceWith(t.identifier('$placeholder'));
          }
        },
      },
    };
  };
}

export function stripGXTDebug(babel: { types: typeof Babel.types }) {
  const { types: t } = babel;
  return {
    name: 'string-gxt-debug-info-transform', // not required
    visitor: {
      BinaryExpression(path: any) {
        if (t.isLiteral(path.node.right)) {
          if (path.node.right.value === '/tests.html') {
            path.replaceWith(t.booleanLiteral(false));
          }
        }
      },
      ClassMethod(path: any) {
        if (path.node.kind === 'constructor') {
          if (path.node.params.length === 2) {
            if (path.node.params[1].name === 'debugName') {
              path.node.params.pop();
            }
          }
        }
      },
      ExpressionStatement(path: any) {
        // remove all console.log/warn/error/info
        if (
          path.node.expression &&
          path.node.expression.type === 'CallExpression'
        ) {
          if (path.node.expression.callee.type === 'MemberExpression') {
            if (path.node.expression.callee.object.name === 'console') {
              path.remove();
            }
          }
        }
      },
      ClassProperty(path: any) {
        if (path.node.key.name === '_debugName') {
          path.remove();
        }
      },
      FunctionDeclaration(path: any) {
        const nodeName = path.node.id.name;
        if (nodeName === 'formula' || nodeName === 'cell') {
          path.node.params.pop();
        }
      },
      AssignmentPattern(path: any) {
        if (path.node.left.name === 'debugName') {
          path.remove();
        }
      },
      NewExpression(path: any) {
        if (path.node.callee && path.node.callee.type === 'Identifier') {
          if (
            path.node.callee.name === 'MergedCell' ||
            path.node.callee.name === 'Cell'
          ) {
            path.node.arguments.pop();
          }
        }
      },
      CallExpression(path: any) {
        if (path.node.callee && path.node.callee.type === 'Identifier') {
          const name = path.node.callee.name;
          if (name === 'addToTree' && path.node.arguments.length === 3) {
            path.node.arguments.pop();
          } else if (
            name === 'cell' ||
            name === 'formula' ||
            name === 'resolveRenderable'
          ) {
            if (path.node.arguments.length === 2) {
              path.node.arguments.pop();
            }
          }
        }
      },
    },
  };
}
