import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

test('pdf-lib loads', async () => {
  const doc = await PDFDocument.create();
  assert.ok(doc);
});
