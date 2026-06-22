// Build a single self-contained, offline, double-click GWA_Dashboard.html.
// Inlines: the esbuild IIFE bundle (logic + pdf-lib + jszip + pdf.js), the scenario/template
// config, the 5 blank templates (base64), and the pdf.js worker (base64).
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listFields } from './js/filler.js';

const root = new URL('./', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const readText = (p) => read(p).toString('utf8');
const b64 = (p) => read(p).toString('base64');

// 1. Bundle the standalone entry to a single IIFE.
// pdf-lib + jszip are aliased to their UMD shims (and the UMD libs are inlined as
// globals below) — esbuild's minifier mangles pdf-lib in a way that hangs on some
// AcroForms (e.g. the CDD form), whereas the official UMD build is fine. pdf.js
// stays bundled.
const result = await esbuild.build({
  entryPoints: ['standalone/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  alias: {
    'pdf-lib': fileURLToPath(new URL('vendor/pdf-lib-shim.js', root)),
    'jszip': fileURLToPath(new URL('vendor/jszip-shim.js', root)),
  },
  write: false,
});
const bundleJs = result.outputFiles[0].text;
const pdfLibUmd = readText('vendor/pdf-lib.min.js');
const jszipUmd = readText('vendor/jszip.min.js');

// 2. Gather embedded data.
const templatesCfg = JSON.parse(readText('config/templates.json'));
const linesCfg = JSON.parse(readText('config/lines.json'));
const lines = linesCfg.map((l) => ({ id: l.id, name: l.name, scenarios: JSON.parse(readText(l.file)).scenarios }));
const config = { templates: templatesCfg, lines };

const templatesB64 = {};
for (const [id, t] of Object.entries(templatesCfg)) {
  templatesB64[id] = b64(t.file);
}

// Pre-extract each template's AcroForm field list now (node pdf-lib is fast).
// Embedded + written to config so neither build of the app has to parse AcroForms
// in the browser just to render the form (browser pdf-lib is pathologically slow
// on some of these PDFs). Fill still happens in-browser at generate time.
const templateFields = {};
for (const [id, t] of Object.entries(templatesCfg)) {
  templateFields[id] = await listFields(new Uint8Array(read(t.file)));
}
writeFileSync(new URL('config/template-fields.json', root), JSON.stringify(templateFields, null, 2));

const workerB64 = b64('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const css = readText('css/brand.css');
const logoB64 = b64('assets/gwa-logo.png');

// 3. Assemble the HTML. Order matters: globals first, then the bundle (which runs init()).
const html = `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GWA Document Pre-population — DRAFT</title>
<style>
${css}
</style>
</head>
<body>
<header class="app-header">
  <div class="headwrap">
    <img class="logo" src="data:image/png;base64,${logoB64}" alt="Global Wealth Advisory (Pty) Ltd">
    <span class="divider"></span>
    <div class="headtext"><div class="sub">Document Pre-population · DRAFT tool</div></div>
  </div>
</header>
<nav class="tabs">
  <div class="tabwrap" role="tablist" aria-label="Workflow steps">
    <button class="tab" role="tab" id="tab-upload"   data-p="upload"   aria-selected="true"><span class="num">1</span>Upload</button>
    <button class="tab" role="tab" id="tab-scenario" data-p="scenario" aria-selected="false"><span class="num">2</span>Scenario</button>
    <button class="tab" role="tab" id="tab-checklist" data-p="checklist" aria-selected="false" disabled><span class="num">3</span>Checklist</button>
    <button class="tab" role="tab" id="tab-forms"     data-p="forms"    aria-selected="false" disabled><span class="num">4</span>Form fields</button>
  </div>
</nav>
<div class="summaryStrip" id="summaryStrip"></div>
<main>
  <section class="panel active" id="p-upload" role="tabpanel" aria-labelledby="tab-upload">
    <div class="card">
      <h2>Upload Client Information Summary</h2>
      <p class="hint">Choose the machine-generated CRM Client Information Summary PDF. All processing stays on this device.</p>
      <label class="filedrop" for="crmFile">
        <span class="filedrop-icon">↑</span>
        <span>Choose the CRM Client Information Summary PDF</span>
        <input type="file" id="crmFile" accept="application/pdf">
      </label>
      <div id="parseStatus"></div>
    </div>
  </section>
  <section class="panel" id="p-scenario" role="tabpanel" aria-labelledby="tab-scenario">
    <div class="card">
      <h2>Scenario</h2>
      <p class="hint">Pick the product line, then the scenario. Determines which documents are required, per the GWA Compliance Guide.</p>
      <label class="fld" for="line">Product line</label>
      <select id="line" style="margin-bottom:14px"></select>
      <label class="fld" for="scenario">Scenario</label>
      <select id="scenario"></select>
    </div>
  </section>
  <section class="panel" id="p-checklist" role="tabpanel" aria-labelledby="tab-checklist">
    <div class="card">
      <h2>Compliance checklist</h2>
      <p class="hint">Auto-generated docs are filled by this tool; attach-manually docs you add to the file. Answer each conditional.</p>
      <div id="checklist" class="checklist"></div>
    </div>
  </section>
  <section class="panel" id="p-forms" role="tabpanel" aria-labelledby="tab-forms">
    <div class="card">
      <h2>Form fields</h2>
      <p class="progress"><span id="progTxt">0 of 0 fields complete</span><span class="bar"><i id="progBar"></i></span></p>
      <div id="acc"></div>
    </div>
  </section>
  <div id="printChecklist"></div>
  <footer class="draft">DRAFT — REQUIRES COMPLIANCE REVIEW BEFORE USE · GWA AI-Assisted Output · Not for adviser deployment until AI Committee ratifies (CLAUDE.md §10)</footer>
</main>
<div class="actionbar">
  <div class="actionwrap">
    <span class="status" id="status">Upload a CRM PDF or choose a scenario to begin.</span>
    <button type="button" class="btn link" id="saveBtn" title="Save progress to a JSON file you can reload later">Save progress</button>
    <label class="btn link" for="loadFile" style="cursor:pointer">Load progress<input type="file" id="loadFile" accept="application/json" hidden></label>
    <button type="button" class="btn ghost" id="newBtn">New client</button>
    <button type="button" class="btn link" id="forceBtn" style="display:none">Generate anyway →</button>
    <button type="button" class="btn primary" id="generate" disabled>Generate &amp; download bundle</button>
  </div>
</div>
<div class="overlay" id="overlay">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="okTitle">
    <h2 id="okTitle">Draft pack generated</h2>
    <p class="hint" id="okScenario"></p>
    <h4>Auto-generated (in the .zip)</h4>
    <ul id="okGen"></ul>
    <h4>📎 Attach manually before the file is complete</h4>
    <ul id="okCollect"></ul>
    <p class="draftnote">Every document is a DRAFT. Compliance review &amp; adviser sign-off required before client release. Store in your access-controlled system (POPIA).</p>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px">
      <button type="button" class="btn ghost" id="okNew">Start new client</button>
      <button type="button" class="btn primary" id="okReDl">Re-download .zip</button>
    </div>
  </div>
</div>
<script>${pdfLibUmd}</script>
<script>${jszipUmd}</script>
<script>
window.GWA_CONFIG = ${JSON.stringify(config)};
window.GWA_TEMPLATE_FIELDS = ${JSON.stringify(templateFields)};
window.GWA_TEMPLATES_B64 = ${JSON.stringify(templatesB64)};
window.GWA_PDF_WORKER_B64 = ${JSON.stringify(workerB64)};
</script>
<script>
${bundleJs}
</script>
</body>
</html>
`;

const outPath = new URL('GWA_Dashboard.html', root);
writeFileSync(outPath, html);
const mb = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(1);
console.log(`Wrote GWA_Dashboard.html (${mb} MB)`);
console.log(`  bundle: ${(bundleJs.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`  templates: ${Object.keys(templatesB64).length}`);
console.log(`  worker: ${(workerB64.length / 1024 / 1024).toFixed(2)} MB (base64)`);
