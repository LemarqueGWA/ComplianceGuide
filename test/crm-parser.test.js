import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, SECTIONS } from '../js/crm-labels.js';

test('label map resolves client + spouse personal fields', () => {
  assert.equal(LABELS.client['Surname'], 'client_surname');
  assert.equal(LABELS.client['ID number'], 'client_id_number');
  assert.equal(LABELS.spouse['Surname'], 'spouse_surname');
  assert.equal(LABELS.contact['Email (Private)'], 'contact_email');
});

test('section headers are recognised', () => {
  assert.equal(SECTIONS['PERSONAL DETAILS: CLIENT'], 'client');
  assert.equal(SECTIONS['PERSONAL DETAILS: SPOUSE'], 'spouse');
  assert.equal(SECTIONS['CONTACT DETAILS'], 'contact');
});
