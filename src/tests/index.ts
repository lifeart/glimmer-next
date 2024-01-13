import 'qunit/qunit/qunit.css';
import 'qunit-theme-ember/qunit.css';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';
import { getDocument } from '@/utils/dom-api';
import { cleanupRender } from '@/tests/utils';
import { DEBUG_MERGED_CELLS, DEBUG_CELLS } from '@/utils/reactive';

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

import.meta.glob('./unit/**/*-test.{gts,ts,js,gjs}', { eager: true });
import.meta.glob('./integration/**/*-test.{gts,ts,js,gjs}', {
  eager: true,
});
