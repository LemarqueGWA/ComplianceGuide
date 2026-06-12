import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFields, isEsignField, prettyLabel } from '../js/field-resolver.js';

const known = new Set(['client_full_name', 'client_id_number', 'contact_email']);

test('e-sign and signature fields are skipped', () => {
  assert.equal(isEsignField('Date_es_:signer2', 'Tx'), true);
  assert.equal(isEsignField('Signature2', 'Sig'), true);
  assert.equal(isEsignField('Signature Block2_es_:signer1', 'Tx'), true);
  assert.equal(isEsignField('client_full_name', 'Tx'), false);
});

test('classifyFields splits auto/manual/skip', () => {
  const fields = [
    { name: 'client_full_name', type: 'Tx' },
    { name: 'contact_email', type: 'Tx' },
    { name: 'product_provider', type: 'Tx' },
    { name: 'screening_date', type: 'Tx' },
    { name: 'Date_es_:signer2', type: 'Tx' },
    { name: 'Signature2', type: 'Sig' },
  ];
  const r = classifyFields(fields, known);
  assert.deepEqual(r.auto.map(f => f.name).sort(), ['client_full_name', 'contact_email']);
  assert.deepEqual(r.manual.map(f => f.name).sort(), ['product_provider', 'screening_date']);
  assert.deepEqual(r.skip.map(f => f.name).sort(), ['Date_es_:signer2', 'Signature2']);
});

test('manual fields get input type + pretty label', () => {
  const r = classifyFields([{ name: 'screening_date', type: 'Tx' }], known);
  assert.equal(r.manual[0].inputType, 'date');
  assert.equal(r.manual[0].label, 'Screening Date');
  assert.equal(prettyLabel('product_provider'), 'Product Provider');
});

test('bare Date signing field is skipped', () => {
  assert.equal(isEsignField('Date', 'Tx'), true);
  assert.equal(isEsignField('screening_date', 'Tx'), false); // a real manual date field is NOT skipped
});
