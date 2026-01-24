# Testing Guide

This document describes the testing patterns and utilities used in GXT (Glimmer-Next).

## Test Architecture

GXT uses a two-tier testing approach:

### 1. Unit Tests (Vitest)
- **Location**: `src/**/*.test.ts`, `plugins/**/*.test.ts`
- **Purpose**: Test pure functions, utilities, and compiler output
- **Environment**: Node.js with optional happy-dom for DOM testing

### 2. Integration Tests (QUnit)
- **Location**: `src/tests/**/*.gts`
- **Purpose**: Test full rendering pipeline in real browser
- **Environment**: Browser with real DOM

## Core Principles

### Minimize Mocking

We prefer real implementations over mocks whenever possible:

```typescript
// ✅ GOOD: Use real Cell
import { cell } from '@/utils/reactive';
const myCell = cell(42);

// ❌ AVOID: Mock Cell behavior
const mockCell = { value: 42, update: vi.fn() };
```

### Use Call Tracking Instead of Spies

When you need to verify function calls, use our test utilities:

```typescript
// ✅ GOOD: Use createCallTracker
import { createCallTracker } from '@/utils/__test-utils__';

const { fn, getCallCount } = createCallTracker(() => 42);
fn();
expect(getCallCount()).toBe(1);

// ❌ AVOID: vi.fn() when not necessary
const mockFn = vi.fn(() => 42);
mockFn();
expect(mockFn).toHaveBeenCalledTimes(1);
```

### Test Behavior, Not Implementation

```typescript
// ✅ GOOD: Test what happens
const result = compile('<div>{{this.name}}</div>');
expect(result.code).toContain('this.name');

// ❌ AVOID: Test internal calls
expect(mockVisitor).toHaveBeenCalledWith(expect.objectContaining({...}));
```

## Test Utilities

### Location
`src/utils/__test-utils__/index.ts`

### Available Utilities

#### `createCallTracker<T>(fn: () => T)`
Creates a function that tracks how many times it was called.

```typescript
const { fn, getCallCount, getLastArgs, getAllCalls, reset } = createCallTracker(
  (a: number, b: string) => `${a}-${b}`
);

fn(1, 'a');
fn(2, 'b');

expect(getCallCount()).toBe(2);
expect(getLastArgs()).toEqual([2, 'b']);
expect(getAllCalls()).toEqual([[1, 'a'], [2, 'b']]);

reset();
expect(getCallCount()).toBe(0);
```

#### `createTrackedGetter<T>(getValue: () => T)`
Creates a getter function that tracks accesses. Returns an arrow function (no prototype) to simulate compiler-generated getters.

```typescript
let value = 'initial';
const { getter, getAccessCount } = createTrackedGetter(() => value);

expect(getter()).toBe('initial');
expect(getAccessCount()).toBe(1);

value = 'updated';
expect(getter()).toBe('updated');
expect(getAccessCount()).toBe(2);
```

#### `createTrackedCell<T>(initial: T)`
Creates a real Cell with update tracking.

```typescript
const { testCell, getUpdateCount, reset } = createTrackedCell(0);

testCell.update(1);
expect(testCell.value).toBe(1);
expect(getUpdateCount()).toBe(1);
```

#### `createRegularFunction<T>(fn: () => T)`
Creates a function with a prototype (unlike arrow functions). Use this to create callbacks that should NOT be treated as getters.

```typescript
const callback = createRegularFunction(() => 'result');
expect(callback.prototype).toBeDefined();

// This will NOT be called by unwrap() or similar getter-unwrapping code
const result = unwrap(callback);
expect(result).toBe(callback); // Returns the function, doesn't call it
```

#### `createDeferred<T>()`
Creates a controllable promise for testing async scenarios.

```typescript
const { promise, resolve, reject } = createDeferred<string>();

// Later...
resolve('done');
const result = await promise; // 'done'
```

#### `waitFor(condition: () => boolean, timeout?: number)`
Waits for a condition to be true, with timeout.

```typescript
let ready = false;
setTimeout(() => { ready = true; }, 50);

await waitFor(() => ready);
expect(ready).toBe(true);
```

#### `flushMicrotasks()` and `flushAll()`
Flush pending microtasks and timers.

```typescript
queueMicrotask(() => { executed = true; });
await flushMicrotasks();
expect(executed).toBe(true);
```

## Testing Patterns

### Testing Compiler Output

```typescript
import { compile } from '../../plugins/compiler/compile';

test('compiles element helper', () => {
  const result = compile(`
    {{#let (element 'div') as |Tag|}}
      <Tag>content</Tag>
    {{/let}}
  `);

  expect(result.code).toContain('$_tag');
  expect(result.code).toContain('"div"');
});
```

### Testing Runtime Behavior with happy-dom

```typescript
import { Window } from 'happy-dom';

let window: Window;
let document: Document;

beforeEach(() => {
  window = new Window();
  document = window.document;
});

afterEach(() => {
  window.close();
});

test('creates element in DOM', () => {
  const element = document.createElement('div');
  element.textContent = 'Hello';
  document.body.appendChild(element);

  expect(document.querySelector('div')?.textContent).toBe('Hello');
});
```

### Testing Reactive Cells

```typescript
import { cell } from '@/utils/reactive';

test('cell updates value', () => {
  const myCell = cell(0);
  expect(myCell.value).toBe(0);

  myCell.update(42);
  expect(myCell.value).toBe(42);
});
```

### Testing Getter Unwrapping

```typescript
import { unwrap } from '@/utils/helpers/-private';
import { createCallTracker, createRegularFunction } from '@/utils/__test-utils__';

test('unwraps getter but not user callback', () => {
  // Create a callback that tracks if it's called
  const { fn: callback, getCallCount } = createCallTracker(() => 'result');

  // Wrap it to have a prototype (simulates user callback)
  const userCallback = createRegularFunction(() => callback());

  // Getter returns the user callback
  const getter = () => userCallback;

  // unwrap should call the getter but NOT the callback
  const result = unwrap(getter);

  expect(result).toBe(userCallback);
  expect(getCallCount()).toBe(0); // Callback was NOT called
});
```

## QUnit Integration Tests

QUnit tests run in a real browser environment with full DOM support.

### Test Utilities

```typescript
import { render, rerender, click, find, findAll } from '@lifeart/gxt/test-utils';

test('renders component', async function(assert) {
  await render(<template><MyComponent /></template>);

  assert.dom('[data-test]').exists();
  assert.dom('[data-test]').hasText('expected');
});

test('handles user interaction', async function(assert) {
  await render(<template><Counter /></template>);

  await click('[data-test-increment]');
  await rerender();

  assert.dom('[data-test-count]').hasText('1');
});
```

## Best Practices

1. **Prefer real implementations** - Use actual Cells, compile actual templates
2. **Use call tracking** - Use `createCallTracker` instead of `vi.fn()` when possible
3. **Test public API** - Test what users/consumers see, not internals
4. **Isolate tests** - Clear state between tests, use `beforeEach`/`afterEach`
5. **Descriptive names** - Test names should describe the behavior being tested
6. **One assertion concept per test** - Each test should verify one thing

## Running Tests

```bash
# Run all vitest tests
npm test

# Run specific test file
npm test -- --run src/utils/helpers/helpers.test.ts

# Run tests in watch mode
npm test -- --watch

# Run QUnit tests (requires browser)
npm run test:qunit
```
