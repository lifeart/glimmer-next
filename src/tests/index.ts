import 'decorator-transforms/globals';
import 'qunit/qunit/qunit.css';
import 'qunit-theme-ember/qunit.css';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';
import { cleanupRender, getDocument} from '@/tests/utils';
import { DEBUG_MERGED_CELLS, DEBUG_CELLS } from '@/utils/reactive';

// Expose QUnit to window for Playwright test hooks
(window as any).QUnit = QUnit;

setup(QUnit.assert, {
  getRootElement() {
    return getDocument().getElementById('ember-testing')!;
  },
});

QUnit.hooks.afterEach(async function () {
  await cleanupRender();
  DEBUG_CELLS.clear();
  DEBUG_MERGED_CELLS.forEach((cell) => {
    cell.destroy();
  });
  DEBUG_MERGED_CELLS.clear();
});

// Set up QUnit callbacks for Playwright
QUnit.done(function (results: { passed: number; failed: number; total: number; runtime: number }) {
  if (typeof (window as any).onQunitDone === 'function') {
    (window as any).onQunitDone(results);
  }
});

QUnit.testDone(function (details: any) {
  if (typeof (window as any).onQunitTestDone === 'function') {
    (window as any).onQunitTestDone(details);
  }
});

import.meta.glob('./unit/**/*-test.{gts,ts,js,gjs}', { eager: true });
import.meta.glob('./integration/**/*-test.{gts,ts,js,gjs}', {
  eager: true,
});
