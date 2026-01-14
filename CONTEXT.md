# Ember-EUI Branch Context

This document captures the context, goals, and important details for the `ember-eui` branch.

## Branch Goal

Enable **ember-eui** components to run in **glimmer-next (GXT)** by implementing Ember compatibility layers. This allows using the Elastic UI component library (ember-eui) within the GXT framework.

## Key Feature Flags

These flags in `src/utils/flags.ts` enable Ember compatibility:

```typescript
export const WITH_HELPER_MANAGER = true;      // Ember functional helper support
export const WITH_MODIFIER_MANAGER = true;    // Ember modifier support
export const WITH_EMBER_INTEGRATION = true;   // Full Ember compatibility layer
```

## Demo Page

The ember-eui demo is at `/ember` route, implemented in:
- `src/components/pages/Ember.gts`

It showcases: EuiButton, EuiCard, EuiBadge, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiText, EuiTitle, EuiSpacer, EuiPanel

## Architecture

### Ember Compatibility Layer

Located in `src/ember-compat/`, these files map Ember APIs to GXT equivalents:

| Ember Module | GXT Implementation |
|-------------|-------------------|
| `@ember/component/helper` | `ember__component__helper.ts` |
| `@ember/helper` | `ember__helper.ts` |
| `@ember/modifier` | `ember__modifier.ts` |
| `@ember/template-compilation` | `ember__template-compilation.ts` |
| `@glimmer/component` | `glimmer__component.ts` |
| `@glimmer/tracking` | `glimmer__tracking.ts` |

### Runtime Template Compilation

Ember-eui uses `precompileTemplate` at runtime. Key file:
- `src/ember-compat/ember__template-compilation.ts`

This compiles Ember templates to GXT-compatible code using:
- `@glimmer/syntax` for parsing
- `@babel/core` for code generation
- Custom transform in `plugins/compiler.ts`

### Helper Manager

Located in `src/utils/managers/helper.ts`:
- `EmberFunctionalHelpers` - Set of registered Ember helpers
- `helperManager()` - Calls helpers with `(args, hash)` convention
- `$_maybeHelper()` - Routes helper calls through appropriate manager

### Modifier Manager

Located in `src/utils/managers/modifier.ts`:
- Handles Ember functional modifiers
- Manages lifecycle (install, update, destroy)

## Important Gotchas

### 1. Helper Calling Convention

Ember helpers receive `(positionalArgs[], namedArgsHash)`, not spread arguments.

**Wrong:**
```typescript
function myHelper(arg1, arg2) { ... }
```

**Correct:**
```typescript
function myHelper(args, hash) {
  const [arg1, arg2] = args;
  const { namedArg } = hash;
}
```

### 2. Built-in Helpers Must Be Registered

`$__hash`, `$__fn`, `$__array` must be in `EmberFunctionalHelpers` to work with runtime-compiled templates:

```typescript
// In ember__helper.ts
EmberFunctionalHelpers.add($__hash);
EmberFunctionalHelpers.add($__fn);
EmberFunctionalHelpers.add($__array);
```

### 3. Dual Calling Convention

Built-in helpers support both direct calls and helperManager calls:

```typescript
// Direct (from GXT compiler): $__hash({ key: value })
// Via helperManager (from Ember templates): $__hash([], { key: value })

export function $__hash(argsOrObj, hashParams?) {
  if (Array.isArray(argsOrObj)) {
    // helperManager convention
    return hashParams ?? {};
  }
  // direct call convention
  return argsOrObj ?? {};
}
```

### 4. Process Polyfill for Production Builds

`@babel/types` (used in runtime compilation) uses `process.platform`. Production builds need:

```typescript
// In vite.config.mts
define: {
  'process.platform': JSON.stringify('browser'),
  'process.env.NODE_ENV': JSON.stringify(mode),
}
```

Plus a transform plugin that injects process shim into node_modules.

### 5. Vite Optimization Exclusions

ember-eui must be excluded from Vite's pre-bundling:

```typescript
optimizeDeps: {
  exclude: ['@ember-eui/core'],
}
```

### 6. Scope Resolution in Runtime Templates

Runtime-compiled templates store scope in `globalThis.scopes` Map:
- Key: unique template ID
- Value: function returning scope object with helpers/components

### 7. Template-Only Components

`setComponentTemplate` must wrap template-only components:

```typescript
export function setComponentTemplate(template, component) {
  if (!component || component === templateOnlyComponent) {
    // Wrap in a class for GXT compatibility
    class TemplateOnlyWrapper extends Component {
      static template = template;
    }
    return TemplateOnlyWrapper;
  }
  component.template = template;
  return component;
}
```

## File Reference

### Core Implementation Files

- `src/utils/managers/helper.ts` - Helper manager
- `src/utils/managers/modifier.ts` - Modifier manager
- `src/utils/helpers/hash.ts` - Hash helper
- `src/utils/helpers/fn.ts` - Fn helper
- `src/utils/helpers/array.ts` - Array helper
- `src/ember-compat/ember__template-compilation.ts` - Runtime template compiler

### Configuration

- `vite.config.mts` - Vite config with Ember aliases and polyfills
- `src/utils/flags.ts` - Feature flags

## Testing

Run dev server:
```bash
pnpm dev
# Navigate to http://localhost:5173/ember
```

Test production build:
```bash
pnpm build
pnpm preview
# Navigate to http://localhost:4173/ember
```

## Known Issues

1. **Rehydration Warning**: SSR/hydration mismatch on /ember route (unrelated to ember-eui)
2. **Compiler Warnings**: Variables like "title", "text", "time" shadow HTML element names

## Commits on This Branch

1. `feat: add Ember page with ember-eui demos`
2. `fix: ember-eui runtime template compilation support`
3. `fix: register built-in helpers for Ember helper manager compatibility`
4. `fix: add process shim for production build`

## Dependencies

ember-eui requires these Ember packages (mocked/aliased in vite.config.mts):
- `@ember/component`
- `@ember/helper`
- `@ember/modifier`
- `@ember/template-compilation`
- `@glimmer/component`
- `@glimmer/tracking`
- `ember-modifier`
- Various ember-* helper packages
