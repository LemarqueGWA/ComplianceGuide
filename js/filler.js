import {
  PDFDocument, rgb, StandardFonts, degrees, PDFName, PDFBool, PDFString,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFSignature, PDFDropdown, PDFOptionList,
} from 'pdf-lib';
import { isEsignField } from './field-resolver.js';

// IMPORTANT: detect field kind with `instanceof`, NOT `field.constructor.name`.
// The standalone build is minified, which renames classes — so constructor.name
// is mangled (e.g. 'e') and string comparisons silently never match, leaving every
// field unfilled. `instanceof` against the imported classes survives minification.
function normaliseType(field) {
  if (field instanceof PDFTextField) return 'Tx';
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) return 'Btn';
  if (field instanceof PDFSignature) return 'Sig';
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return 'Ch';
  return 'unknown';
}

/** listFields(bytes) → [{ name, type }] where type is 'Tx' | 'Btn' | 'Sig' | 'Ch' | 'unknown' */
export async function listFields(bytes) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  return form.getFields().map((f) => ({
    name: f.getName(),
    type: normaliseType(f),
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

  // These GWA templates were authored in Adobe and ship without valid field
  // appearance streams, and their field /DA references fonts not present in the
  // form's resources. pdf-lib's default save produces appearances that some
  // viewers (e.g. Chrome's pdfium) will not render. To make filled values show
  // in EVERY viewer we: (1) embed a standard font and register it in the AcroForm
  // /DR, (2) give each filled field an explicit DA + font size, (3) regenerate
  // appearance streams with that embedded font, and (4) set NeedAppearances so
  // viewers that prefer to regenerate also have the font they need.
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  registerFontInDR(doc, form, helv);

  for (const field of form.getFields()) {
    const name = field.getName();
    const type = normaliseType(field);
    if (isEsignField(name, type)) continue;
    if (!(name in values)) continue;
    const value = values[name];
    if (value == null || value === '') continue;

    if (field instanceof PDFTextField) {
      field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 10 Tf 0 g'));
      field.setText(String(value));
      try { field.setFontSize(10); } catch { /* combed/odd fields: keep DA size */ }
    } else if (field instanceof PDFCheckBox) {
      if (value === 'Yes' || value === true) field.check();
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      try { field.select(String(value)); } catch { /* value not a valid option — leave for manual entry */ }
    }
    // RadioGroup intentionally left for a later phase
  }

  // Regenerate appearance streams with the embedded font (renders in Preview/
  // Acrobat/pdfium), then ask viewers to regenerate too (belt-and-suspenders).
  form.updateFieldAppearances(helv);
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

  await stampDraft(doc);
  // We have already generated appearances above; don't let save() redo it.
  return doc.save({ updateFieldAppearances: false });
}

// Ensure the AcroForm default-resources (/DR) /Font dict contains the embedded
// font under the tag '/Helv', matching the /DA strings we set on each field.
function registerFontInDR(doc, form, font) {
  const acro = form.acroForm.dict;
  let dr = acro.lookup(PDFName.of('DR'));
  if (!dr) { dr = doc.context.obj({}); acro.set(PDFName.of('DR'), dr); }
  let fonts = dr.lookup(PDFName.of('Font'));
  if (!fonts) { fonts = doc.context.obj({}); dr.set(PDFName.of('Font'), fonts); }
  fonts.set(PDFName.of('Helv'), font.ref);
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
