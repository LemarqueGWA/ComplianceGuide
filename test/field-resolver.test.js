import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFields, isEsignField, prettyLabel, gateRevealedValues, isSnakeName } from '../js/field-resolver.js';

test('isSnakeName accepts snake_case only', () => {
  assert.equal(isSnakeName('client_full_name'), true);
  assert.equal(isSnakeName('pep_client_yes'), true);
  assert.equal(isSnakeName('investment_goal_other_detail'), true);
  assert.equal(isSnakeName('Check Box14'), false);
  assert.equal(isSnakeName('Text1'), false);
  assert.equal(isSnakeName('Checkbox - None'), false);
  assert.equal(isSnakeName('12'), false);
});

test('non-snake (generic Adobe) fields are hidden via skip', () => {
  const fields = [
    { name: 'client_full_name', type: 'Tx' },
    { name: 'Check Box14', type: 'checkbox' },
    { name: 'Text1', type: 'Tx' },
    { name: '12', type: 'checkbox' },
    { name: 'investment_goal_other', type: 'checkbox' },
  ];
  const r = classifyFields(fields, new Set(['client_full_name']));
  assert.deepEqual(r.auto.map(f => f.name), ['client_full_name']);
  assert.deepEqual(r.manual.map(f => f.name).sort(), ['investment_goal_other']);
  assert.deepEqual(r.skip.map(f => f.name).sort(), ['12', 'Check Box14', 'Text1']);
});

const REVEALS = { select_inheritance: 'inheritance', select_other: 'other_source_of_fund_details' };

test('gateRevealedValues drops a paired text field when its checkbox is not ticked', () => {
  const v = { client_full_name: 'Y', inheritance: 'R 50 000', select_inheritance: '' };
  const r = gateRevealedValues(v, REVEALS);
  assert.equal('inheritance' in r, false);   // hidden value not written to PDF
  assert.equal(r.client_full_name, 'Y');      // unrelated field untouched
});

test('gateRevealedValues keeps a paired text field when its checkbox is ticked', () => {
  const v = { inheritance: 'R 50 000', select_inheritance: 'Yes' };
  const r = gateRevealedValues(v, REVEALS);
  assert.equal(r.inheritance, 'R 50 000');
});

test('gateRevealedValues does not mutate input and tolerates no reveals', () => {
  const v = { inheritance: 'x', select_inheritance: '' };
  const r = gateRevealedValues(v, undefined);
  assert.equal(r.inheritance, 'x');           // no reveals map → unchanged copy
  assert.equal(v.inheritance, 'x');           // original untouched
  assert.notEqual(r, v);                       // returns a new object
});

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

test('checkbox fields get a checkbox input type', () => {
  const r = classifyFields([{ name: 'risk_profile_balanced', type: 'checkbox' }], known);
  assert.equal(r.manual[0].inputType, 'checkbox');
  assert.equal(r.manual[0].label, 'Risk Profile Balanced');
});

test('bare Date signing field is skipped', () => {
  assert.equal(isEsignField('Date', 'Tx'), true);
  assert.equal(isEsignField('screening_date', 'Tx'), false); // a real manual date field is NOT skipped
});
