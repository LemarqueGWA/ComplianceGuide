import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, SECTIONS } from '../js/crm-labels.js';
import { parseClientInfo } from '../js/crm-parser.js';
import { computeFields, formatDate } from '../js/crm-parser.js';
import { sampleItems } from './fixtures/sample-items.js';

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

test('parses client personal fields', () => {
  const r = parseClientInfo(sampleItems);
  assert.equal(r.client_surname, 'Sample');
  assert.equal(r.client_first_names, 'Alan Brian');
  assert.equal(r.client_id_number, '0000000000000');
  assert.equal(r.client_title, 'Mr');
});

test('parses spouse, contact, fica, will, review', () => {
  const r = parseClientInfo(sampleItems);
  assert.equal(r.spouse_first_names, 'Carol Dawn');
  assert.equal(r.contact_email, 'sample@example.com (preferred)');
  assert.equal(r.fica_risk_rating, 'High');
  assert.equal(r.will_has_local, 'No');
  assert.equal(r.review_frequency, 'Annually');
});

test('blank value does not swallow the next label', () => {
  const r = parseClientInfo(sampleItems);
  // Risk profile is blank in the fixture; mandate must still parse
  assert.equal(r.fais_mandate, 'Full discretion');
});

test('accumulates a multi-fragment residential address', () => {
  const r = parseClientInfo(sampleItems);
  assert.equal(r.contact_address, '1 Test Street, Testville, 0001');
});

test('formatDate converts dd/mm/yyyy to GWA long form', () => {
  assert.equal(formatDate('01/01/1980'), '01 January 1980');
});

test('computeFields adds full name, display name, age', () => {
  const base = parseClientInfo(sampleItems);
  const r = computeFields(base, { today: new Date('2026-06-12'), adviser: 'Lemarque Sadler' });
  assert.equal(r.client_full_name, 'Alan Brian Sample');       // first names + surname
  assert.equal(r.client_display_name, 'AB Sample');            // initials + surname
  assert.equal(r.client_age, '46');
  assert.equal(r.meta_practice_name, 'Global Wealth Advisory (Pty) Ltd');
  assert.equal(r.meta_fsp_number, '49263');
  assert.equal(r.meta_adviser_name, 'Lemarque Sadler');
  assert.equal(r.adviser_name, 'Lemarque Sadler');             // alias for template field
  assert.equal(r.client_dob, '01 January 1980');               // normalised in place
});
