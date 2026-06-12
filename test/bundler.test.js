import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { gwaFilename, buildBundle } from '../js/bundler.js';

test('gwaFilename follows CLAUDE.md section 8 convention', () => {
  // GWA_[DocType]_[ClientRef]_v1.0_[YYYYMMDD].pdf
  assert.equal(
    gwaFilename('Mandate', 'REF001', new Date('2026-06-12')),
    'GWA_Mandate_REF001_v1.0_20260612.pdf'
  );
});

test('gwaFilename falls back to UNREF when clientRef is empty', () => {
  assert.equal(
    gwaFilename('Mandate', '', new Date('2026-06-12')),
    'GWA_Mandate_UNREF_v1.0_20260612.pdf'
  );
});

test('buildBundle produces a zip containing all files', async () => {
  const files = [
    { name: 'GWA_Mandate_REF001_v1.0_20260612.pdf', bytes: new Uint8Array([1,2,3]) },
    { name: 'GWA_Checklist_REF001_v1.0_20260612.pdf', bytes: new Uint8Array([4,5,6]) },
  ];
  const blob = await buildBundle(files);
  const zip = await JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, [
    'GWA_Checklist_REF001_v1.0_20260612.pdf',
    'GWA_Mandate_REF001_v1.0_20260612.pdf',
  ]);
});
