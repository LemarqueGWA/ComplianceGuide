import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { listFields, fillTemplate } from '../js/filler.js';

const MANDATE = new URL('../templates/Global_Wealth_Advisory_Mandate_2026.pdf', import.meta.url);
const CDD = new URL('../templates/CLIENT DUE DILIGENCE FORM GWA.pdf', import.meta.url);

test('listFields returns named fields with types', async () => {
  const bytes = await readFile(MANDATE);
  const fields = await listFields(bytes);
  const names = fields.map(f => f.name);
  assert.ok(names.includes('client_full_name'));
  assert.ok(names.includes('client_id_number'));
});

test('listFields tags checkbox fields as checkbox (not the catch-all Btn)', async () => {
  const bytes = await readFile(MANDATE);
  const fields = await listFields(bytes);
  const f = fields.find(x => x.name === 'risk_profile_balanced');
  assert.ok(f, 'risk_profile_balanced field should exist in the mandate template');
  assert.equal(f.type, 'checkbox');
});

test('fillTemplate checks a checkbox when the value is "Yes"', async () => {
  const bytes = await readFile(MANDATE);
  const filled = await fillTemplate(bytes, { risk_profile_balanced: 'Yes' });
  const form = (await PDFDocument.load(filled)).getForm();
  assert.equal(form.getCheckBox('risk_profile_balanced').isChecked(), true);
});

test('fillTemplate leaves a checkbox unchecked when value is blank', async () => {
  const bytes = await readFile(MANDATE);
  const filled = await fillTemplate(bytes, { risk_profile_balanced: '' });
  const form = (await PDFDocument.load(filled)).getForm();
  assert.equal(form.getCheckBox('risk_profile_balanced').isChecked(), false);
});

test('fillTemplate writes text fields and leaves a valid PDF', async () => {
  const bytes = await readFile(MANDATE);
  const filled = await fillTemplate(bytes, {
    client_full_name: 'Alan Brian Sample',
    client_id_number: '0000000000000',
    contact_email: 'sample@example.com',
  });
  const doc = await PDFDocument.load(filled);
  const field = doc.getForm().getTextField('client_full_name');
  assert.equal(field.getText(), 'Alan Brian Sample');
});

test('fillTemplate ignores unknown keys without throwing', async () => {
  const bytes = await readFile(MANDATE);
  await assert.doesNotReject(
    fillTemplate(bytes, { nonexistent_field: 'x', client_full_name: 'Y' })
  );
});

test('fillTemplate does not write to e-sign fields', async () => {
  const bytes = await readFile(CDD);
  const filled = await fillTemplate(bytes, {
    'Signature1_es_:signer1:signatureblock': 'SHOULD NOT APPEAR',
    client_full_name: 'Alan Brian Sample',
  });
  const form = (await PDFDocument.load(filled)).getForm();
  // e-sign field must remain empty
  assert.equal(form.getTextField('Signature1_es_:signer1:signatureblock').getText() ?? '', '');
  // sanity: a normal field WAS written
  assert.equal(form.getTextField('client_full_name').getText(), 'Alan Brian Sample');
});
