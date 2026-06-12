import { prettyLabel } from './field-resolver.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * buildChecklist(scenario, templates) → [{ doc, title, status, type, action, note }]
 * Pure data builder; rendering to PDF is a separate concern.
 */
export function buildChecklist(scenario, templates) {
  return scenario.documents.map((d) => {
    const title = prettyLabel(d.doc);
    let action;
    if (d.type === 'collect') action = 'Obtain & attach';
    else action = d.status === 'conditional' ? 'Auto-generated (conditional)' : 'Auto-generated';
    return {
      doc: d.doc,
      title,
      status: d.status,
      type: d.type,
      action,
      note: d.note || '',
    };
  });
}

const PRIMARY = rgb(0, 74/255, 151/255);   // #004A97
const STEEL   = rgb(120/255, 134/255, 147/255);

/** renderChecklistPdf(rows, meta) → Uint8Array. meta = {scenarioName, clientName, date}. */
export async function renderChecklistPdf(rows, meta) {
  const doc = await PDFDocument.create();
  let page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const line = (t, f = font, size = 10, color = rgb(0,0,0)) => {
    if (y < 40) { page = doc.addPage([595, 842]); y = 800; }
    page.drawText(t, { x: 40, y, size, font: f, color }); y -= size + 6;
  };
  line('Compliance Checklist', bold, 18, PRIMARY);
  line(`Scenario: ${meta.scenarioName}`, font, 11, STEEL);
  line(`Client: ${meta.clientName}    Date: ${meta.date}`, font, 10, STEEL);
  y -= 8;
  for (const r of rows) {
    const status = r.status === 'conditional' ? '[ conditional ]' : '[ required ]';
    line(`${status}  ${r.title} — ${r.action}`, font, 10, rgb(0.03,0.04,0.16));
    if (r.note) line(`        Note: ${r.note}`, font, 8, STEEL);
  }
  y -= 10;
  line('DRAFT — REQUIRES COMPLIANCE REVIEW BEFORE USE', bold, 9, STEEL);
  line('Global Wealth Advisory (Pty) Ltd | FSP 49263', font, 8, STEEL);
  return doc.save();
}
