'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../plugin/src/settings.js');

test('sanitize fills defaults and drops junk', () => {
  const s = S.sanitize({ handleBefore: -3, handleAfter: 1.5, markers: 'yes', companyTemplates: { ' ACME ': { template: 'TPL_A' }, bad: 3 } });
  assert.equal(s.handleBefore, 0);
  assert.equal(s.handleAfter, 1.5);
  assert.equal(s.markers, true);
  assert.deepEqual(Object.keys(s.companyTemplates), ['acme']);
  assert.equal(s.pattern, S.DEFAULTS.pattern);
});

test('templateFor: company mapping, case/space-insensitive, then default', () => {
  const s = S.sanitize({ defaultTemplate: 'TPL_Default' });
  S.setCompanyTemplate(s, 'Acme  Corp', 'TPL_Acme');
  const avail = ['TPL_Acme', 'TPL_Default'];
  assert.equal(S.templateFor(s, 'acme corp', avail), 'TPL_Acme');
  assert.equal(S.templateFor(s, 'Beta', avail), 'TPL_Default');
  assert.equal(S.templateFor(s, '', avail), 'TPL_Default');
});

test('templateFor ignores templates that no longer exist', () => {
  const s = S.sanitize({ defaultTemplate: 'TPL_Gone' });
  S.setCompanyTemplate(s, 'Acme', 'TPL_Gone2');
  assert.equal(S.templateFor(s, 'Acme', ['TPL_X']), '');
});

test('setCompanyTemplate with empty template removes the mapping', () => {
  const s = S.sanitize(null);
  S.setCompanyTemplate(s, 'Acme', 'TPL_A');
  S.setCompanyTemplate(s, 'ACME', '');
  assert.deepEqual(s.companyTemplates, {});
});

test('isTemplateName', () => {
  assert.equal(S.isTemplateName('TPL_Acme'), true);
  assert.equal(S.isTemplateName('tpl_acme'), false);
  assert.equal(S.isTemplateName('My TPL_'), false);
});
