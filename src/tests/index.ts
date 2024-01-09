import 'qunit/qunit/qunit.css';
import 'qunit-theme-ember/qunit.css';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

setup(QUnit.assert);

import.meta.glob('./unit/**/*-test.{gts,ts,js,gjs}', { eager: true });
import.meta.glob('./integration/**/*-test.{gts,ts,js,gjs}', {
  eager: true,
});
