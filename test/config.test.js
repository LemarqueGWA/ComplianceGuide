import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../js/config.js';

test('loads 5 scenarios for the Investment line', async () => {
  const cfg = await loadConfig();
  assert.equal(cfg.scenarios.line, 'Investment');
  assert.equal(cfg.scenarios.scenarios.length, 5);
});

test('every generate-type doc maps to a known template', async () => {
  const cfg = await loadConfig();
  for (const sc of cfg.scenarios.scenarios) {
    for (const d of sc.documents) {
      if (d.type === 'generate') {
        assert.ok(cfg.templates[d.doc], `missing template for ${d.doc}`);
      }
    }
  }
});

test('collect-type docs have no template (checklist only)', async () => {
  const cfg = await loadConfig();
  const collectIds = new Set();
  for (const sc of cfg.scenarios.scenarios)
    for (const d of sc.documents) if (d.type === 'collect') collectIds.add(d.doc);
  for (const id of collectIds) assert.equal(cfg.templates[id], undefined);
});
