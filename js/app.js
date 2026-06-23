// Dev-server entry point. Supplies fetch-based loaders + pdf.js to the shared
// UI controller (js/ui.js). All DOM/UX logic lives in ui.js.
import { initDashboard } from './ui.js';
import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

async function extractItems(arrayBuffer) {
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const items = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      const s = (it.str || '').trim();
      if (s) items.push(s);
    }
  }
  return items;
}

let TEMPLATE_FIELDS = {};
let ADVISORS = [];

initDashboard({
  loadConfig: async () => {
    const [templates, linesReg, fields, verifications, advisorsCfg] = await Promise.all([
      fetch('config/templates.json').then((r) => r.json()),
      fetch('config/lines.json').then((r) => r.json()),
      // pre-extracted at build time; optional in dev (falls back to in-browser parse)
      fetch('config/template-fields.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('config/verifications.json').then((r) => (r.ok ? r.json() : [])).catch(() => ([])),
      fetch('config/advisors.json').then((r) => (r.ok ? r.json() : { advisors: [] })).catch(() => ({ advisors: [] })),
    ]);
    const lines = await Promise.all(linesReg.map(async (l) => ({
      id: l.id, name: l.name, scenarios: (await fetch(l.file).then((r) => r.json())).scenarios,
    })));
    TEMPLATE_FIELDS = fields || {};
    ADVISORS = advisorsCfg.advisors || [];
    return { templates, lines, verifications, advisors: ADVISORS };
  },
  listFields: async (id) => TEMPLATE_FIELDS[id] || null,
  // disclosure PDFs are git-ignored (PII); present when running locally, absent on
  // the public Pages site — returns null there and the disclosure is skipped.
  getDisclosureBytes: async (advisorName) => {
    const a = ADVISORS.find((x) => x.name === advisorName);
    if (!a) return null;
    try {
      const r = await fetch('templates/disclosures/' + a.disclosure_file);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch { return null; }
  },
  getTemplateBytes: async (_id, tpl) => {
    try {
      const r = await fetch(tpl.file);
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${tpl.file}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (err) {
      console.warn('Could not load template:', tpl.file, err);
      return null;
    }
  },
  extractItems,
}).catch((e) => console.error(e));
