import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChecklist } from '../js/checklist.js';

const scenario = {
  id: 'x', name: 'X',
  documents: [
    { doc: 'gwa_mandate', status: 'required', type: 'generate' },
    { doc: 'easefica_risk_rating', status: 'required', type: 'collect' },
    { doc: 'replacement_asisa', status: 'conditional', type: 'generate', note: 'If applicable' },
  ],
};
const templates = {
  gwa_mandate: { docType: 'Mandate' },
  replacement_asisa: { docType: 'Replacement' },
};

test('buildChecklist labels each row by status and type', () => {
  const rows = buildChecklist(scenario, templates);
  const mandate = rows.find(r => r.doc === 'gwa_mandate');
  assert.equal(mandate.action, 'Auto-generated');
  const ease = rows.find(r => r.doc === 'easefica_risk_rating');
  assert.equal(ease.action, 'Obtain & attach');
  const repl = rows.find(r => r.doc === 'replacement_asisa');
  assert.equal(repl.action, 'Auto-generated (conditional)');
  assert.equal(repl.note, 'If applicable');
});

test('collect docs without a template still get a readable title', () => {
  const rows = buildChecklist(scenario, templates);
  const ease = rows.find(r => r.doc === 'easefica_risk_rating');
  assert.equal(ease.title, 'Easefica Risk Rating');
});
