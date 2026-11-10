'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, checkForUpdate } = require('../plugin/src/updater.js');

test('compareVersions', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
});

test('checkForUpdate: disabled when no URL, newer/older/offline handled', async () => {
  assert.equal(await checkForUpdate('1.0.0', ''), null);
  const orig = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ version: '1.2.0', url: 'u', notes: 'n' }) });
    assert.deepEqual(await checkForUpdate('1.0.0', 'http://x/v.json'), { version: '1.2.0', url: 'u', notes: 'n' });
    assert.equal(await checkForUpdate('1.2.0', 'http://x/v.json'), null);
    global.fetch = async () => { throw new Error('offline'); };
    assert.equal(await checkForUpdate('1.0.0', 'http://x/v.json'), null);
  } finally { global.fetch = orig; }
});
