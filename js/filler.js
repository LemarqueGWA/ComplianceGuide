import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { isEsignField } from './field-resolver.js';

const TYPE_BY_CTOR = {
  PDFTextField: 'Tx',
  PDFCheckBox: 'Btn',
  PDFRadioGroup: 'Btn',
  PDFButton: 'Btn',
  PDFSignature: 'Sig',
  PDFDropdown: 'Ch',
  PDFOptionList: 'Ch',
};

function normaliseType(ctorName) {
  return TYPE_BY_CTOR[ctorName] || 'unknown';
}

/** listFields(bytes) → [{ name, type }] where type is 'Tx' | 'Btn' | 'Sig' | 'Ch' | 'unknown' */
export async function listFields(bytes) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  return form.getFields().map((f) => ({
    name: f.getName(),
    type: normaliseType(f.constructor.name),
  }));
}

/**
 * fillTemplate(bytes, values): fills text/checkbox/choice fields from `values`.
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
    const type = normaliseType(ctor);
    if (isEsignField(name, type)) continue;
    if (!(name in values)) continue;
    const value = values[name];
    if (value == null || value === '') continue;

    if (ctor === 'PDFTextField') {
      field.setText(String(value));
    } else if (ctor === 'PDFCheckBox') {
      if (value === 'Yes' || value === true) field.check();
    } else if (ctor === 'PDFDropdown' || ctor === 'PDFOptionList') {
      try { field.select(String(value)); } catch { /* value not a valid option — leave for manual entry */ }
    }
    // RadioGroup intentionally left for a later phase
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
    page.drawText('Reviewed by: ____________________    Date: ______________', {
      x: 36, y: 28, size: 8, font, color: rgb(0.47, 0.52, 0.58),
    });
  }
}
