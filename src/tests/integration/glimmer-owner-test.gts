import { module, test } from 'qunit';
import { getOwner, setOwner } from '@/utils/glimmer/owner';

module('Integration | Glimmer | Owner', function () {
  test('getOwner retrieves the owner of an object', function (assert) {
    const obj = {};
    const owner = { name: 'owner' };
    setOwner(obj, owner);
    assert.strictEqual(getOwner(obj), owner, 'Owner is correctly retrieved');
  });

  test('setOwner sets the owner of an object', function (assert) {
    const obj = {};
    const owner = { name: 'owner' };
    setOwner(obj, owner);
    assert.strictEqual(getOwner(obj), owner, 'Owner is correctly set');
  });
});
