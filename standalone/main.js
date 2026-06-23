// Standalone (single-file, offline) entry point. Supplies window-global config +
// preloaded template bytes + a blob-worker pdf.js to the shared UI controller
// (js/ui.js). All DOM/UX logic lives in ui.js.
//   - config comes from window.GWA_CONFIG (no fetch)
//   - templates come from window.GWA_TEMPLATES_B64 (base64, decoded once up front)
//   - the pdf.js worker is a blob worker (workers can't load from file:// directly)
import { initDashboard } from '../js/ui.js';
import * as pdfjs from 'pdfjs-dist';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// pdf.js worker as a blob module worker (file:// safe)
const workerBytes = b64ToBytes(window.GWA_PDF_WORKER_B64);
const workerUrl = URL.createObjectURL(new Blob([workerBytes], { type: 'text/javascript' }));
pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });

// decode all embedded templates once
const templateBytes = {};
for (const [id, b64] of Object.entries(window.GWA_TEMPLATES_B64 || {})) {
  templateBytes[id] = b64ToBytes(b64);
}

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

initDashboard({
  loadConfig: async () => window.GWA_CONFIG,
  getTemplateBytes: async (id) => templateBytes[id] || null,
  listFields: async (id) => (window.GWA_TEMPLATE_FIELDS || {})[id] || null,
  getDisclosureBytes: async (advisorName) => {
    const b64 = (window.GWA_DISCLOSURES_B64 || {})[advisorName];
    return b64 ? b64ToBytes(b64) : null;
  },
  extractItems,
});
