import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { isEsignField } from './field-resolver.js';

/** listFields(bytes) → [{ name, type }] where type is 'Tx' | 'Btn' | 'Sig' | ... */
export async function listFields(bytes) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  return form.getFields().map((f) => ({
    name: f.getName(),
    type: f.constructor.name
      .replace(/^PDF/, '')
      .replace('TextField', 'Tx')
      .replace('CheckBox', 'Btn')
      .replace('RadioGroup', 'Btn')
      .replace('Signature', 'Sig'),
  }));
}

/**
 * fillTemplate(bytes, values): fills text/checkbox fields from `values`.
 * - Skips e-sign / signature fields.
 * - Unknown keys and missing fields are ignored.
 * - Stamps a DRAFT watermark on every page (CLAUDE.md section 3.4).
 * Returns Uint8Array of the filled PDF.
 */
export async function fillTemplate(bytes, values) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  for (const field of form.getFields()) {
    const name = field.getName();
    const ctor = field.constructor.name;
    if (isEsignField(name, ctor.includes('Signature') ? 'Sig' : 'Tx')) continue;
    if (!(name in values)) continue;
    const value = values[name];
    if (value == null || value === '') continue;

    if (ctor === 'PDFTextField') {
      field.setText(String(value));
    } else if (ctor === 'PDFCheckBox') {
      if (value === 'Yes' || value === true) field.check();
    }
    // RadioGroup / Dropdown intentionally left for a later phase
  }

  await stampDraft(doc);
  return doc.save();
}

async function stampDraft(doc) {
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText('DRAFT — REQUIRES COMPLIANCE REVIEW', {
      x: 36, y: height - 24, size: 8, font, color: rgb(0.47, 0.52, 0.58),
    });
    page.drawText('DRAFT', {
      x: width / 2 - 120, y: height / 2, size: 60, font,
      color: rgb(0.47, 0.52, 0.58), opacity: 0.08, rotate: degrees(45),
    });
  }
}
