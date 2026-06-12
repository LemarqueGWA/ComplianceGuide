// Build a single self-contained, offline, double-click GWA_Dashboard.html.
// Inlines: the esbuild IIFE bundle (logic + pdf-lib + jszip + pdf.js), the scenario/template
// config, the 5 blank templates (base64), and the pdf.js worker (base64).
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const readText = (p) => read(p).toString('utf8');
const b64 = (p) => read(p).toString('base64');

// 1. Bundle the standalone entry to a single IIFE.
const result = await esbuild.build({
  entryPoints: ['standalone/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  write: false,
});
const bundleJs = result.outputFiles[0].text;

// 2. Gather embedded data.
const templatesCfg = JSON.parse(readText('config/templates.json'));
const scenariosCfg = JSON.parse(readText('config/scenarios.investment.json'));
const config = { templates: templatesCfg, scenarios: scenariosCfg };

const templatesB64 = {};
for (const [id, t] of Object.entries(templatesCfg)) {
  templatesB64[id] = b64(t.file);
}

const workerB64 = b64('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const css = readText('css/brand.css');

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
<header>
  <strong>Global Wealth Advisory</strong> — Document Pre-population
  <div><small>DRAFT — advisers only · client data stays on this device · works offline</small></div>
</header>
<main>
  <section class="panel">
    <h2>1. Upload Client Information Summary</h2>
    <input type="file" id="crmFile" accept="application/pdf">
    <div id="parseStatus" class="draft"></div>
  </section>
  <section class="panel">
    <h2>2. Scenario</h2>
    <select id="scenario"></select>
  </section>
  <section class="panel" id="checklistPanel" hidden>
    <h2>3. Compliance checklist</h2>
    <div id="checklist" class="checklist"></div>
  </section>
  <section class="panel" id="formsPanel" hidden>
    <h2>4. Form fields</h2>
    <div id="forms"></div>
  </section>
  <button id="generate" disabled>Generate &amp; download bundle</button>
  <p class="draft">All outputs are DRAFTS requiring compliance review. Not for adviser use until AI Committee ratification (CLAUDE.md §10).</p>
</main>
<script>
window.GWA_CONFIG = ${JSON.stringify(config)};
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
