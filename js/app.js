import { parseClientInfo, computeFields } from './crm-parser.js';
import { classifyFields, gateRevealedValues } from './field-resolver.js';
import { listFields, fillTemplate } from './filler.js';
import { buildChecklist, renderChecklistPdf } from './checklist.js';
import { gwaFilename, buildBundle } from './bundler.js';
import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const state = { values: {}, config: null, templateBytes: {}, conditional: {} };
let renderToken = 0;

async function loadConfigBrowser() {
  const [templates, scenarios] = await Promise.all([
    fetch('config/templates.json').then((r) => r.json()),
    fetch('config/scenarios.investment.json').then((r) => r.json()),
  ]);
  return { templates, scenarios };
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

async function init() {
  try {
    state.config = await loadConfigBrowser();
    const sel = document.getElementById('scenario');
    for (const sc of state.config.scenarios.scenarios) {
      const opt = document.createElement('option');
      opt.value = sc.id; opt.textContent = sc.name; sel.appendChild(opt);
    }
    document.getElementById('crmFile').addEventListener('change', onUpload);
    sel.addEventListener('change', renderScenario);
    document.getElementById('generate').addEventListener('click', onGenerate);
    // Render checklist immediately so advisers can see the scenario without uploading first
    await renderScenario();
  } catch (err) {
    document.getElementById('parseStatus').textContent =
      'Could not load dashboard config. Ensure you are running it via a local web server (not opening the file directly).';
    console.error(err);
  }
}

async function onUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    const items = await extractItems(buf);
    const ai = items.indexOf('Advisor:');
    const adviser = ai >= 0 ? (items[ai + 1] || '') : '';
    const parsed = parseClientInfo(items);
    state.values = computeFields(parsed, { today: new Date(), adviser });
    document.getElementById('parseStatus').textContent =
      `Parsed: ${state.values.client_display_name || '(name not found)'}`;
    await renderScenario();
  } catch (err) {
    console.error(err);
    document.getElementById('parseStatus').textContent =
      'Could not read this PDF. Is it a Client Information Summary export?';
  }
}

async function renderScenario() {
  const sel = document.getElementById('scenario');
  const sc = state.config.scenarios.scenarios.find((s) => s.id === sel.value);
  if (!sc) return;

  ++renderToken;

  const rows = buildChecklist(sc, state.config.templates);
  const cl = document.getElementById('checklist');
  cl.innerHTML = '';
  for (const r of rows) {
    if (r.type === 'generate' && r.status === 'conditional') {
      const wrapper = document.createElement('div');
      wrapper.className = 'conditional';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.conditional[r.doc] || false;
      cb.addEventListener('change', () => {
        state.conditional[r.doc] = cb.checked;
        renderForms();
      });
      wrapper.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = ` • ${r.title} — ${r.action}${r.note ? ' (' + r.note + ')' : ''}`;
      wrapper.appendChild(span);
      cl.appendChild(wrapper);
    } else {
      const div = document.createElement('div');
      div.className = r.type === 'collect' ? 'collect' : '';
      div.textContent = `• ${r.title} — ${r.action}${r.note ? ' (' + r.note + ')' : ''}`;
      cl.appendChild(div);
    }
  }
  document.getElementById('checklistPanel').hidden = false;

  await renderForms();
}

// Build one labelled input row for a classified field. Checkboxes store 'Yes'
// when ticked / '' when not; text inputs store their raw value. Returns the row
// element and the input so callers can wire reveal behaviour.
function buildFieldRow(f) {
  const row = document.createElement('div'); row.className = 'row';
  const lab = document.createElement('label'); lab.textContent = f.label || f.name; row.appendChild(lab);
  const inp = document.createElement('input');
  inp.dataset.field = f.name;
  if (f.inputType === 'checkbox') {
    inp.type = 'checkbox';
    const v = state.values[f.name];
    inp.checked = v === 'Yes' || v === true;
    row.classList.add('check');
    inp.addEventListener('change', () => {
      state.values[f.name] = inp.checked ? 'Yes' : '';
      document.getElementById('generate').disabled = Object.keys(state.values).length === 0;
    });
  } else {
    inp.type = f.inputType || 'text';
    inp.value = state.values[f.name] || '';
    inp.addEventListener('input', () => {
      state.values[f.name] = inp.value;
      document.getElementById('generate').disabled = Object.keys(state.values).length === 0;
    });
  }
  row.appendChild(inp);
  return { row, inp };
}

async function renderForms() {
  const sel = document.getElementById('scenario');
  const sc = state.config.scenarios.scenarios.find((s) => s.id === sel.value);
  if (!sc) return;

  const myToken = renderToken;

  const forms = document.getElementById('forms');
  forms.innerHTML = '';
  const known = new Set(Object.keys(state.values));
  for (const d of sc.documents) {
    if (d.type !== 'generate') continue;
    if (d.status === 'conditional' && !state.conditional[d.doc]) continue;
    const tpl = state.config.templates[d.doc];
    if (!tpl) continue; // collect-only doc key not in templates.json
    if (!state.templateBytes[d.doc]) {
      try {
        state.templateBytes[d.doc] = new Uint8Array(
          await fetch(tpl.file).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${tpl.file}`);
            return r.arrayBuffer();
          })
        );
      } catch (err) {
        console.warn('Could not load template:', tpl.file, err);
        continue;
      }
    }
    if (myToken !== renderToken) return;
    const fields = await listFields(state.templateBytes[d.doc]);
    if (myToken !== renderToken) return;
    const { auto, manual } = classifyFields(fields, known);
    const h = document.createElement('h3'); h.textContent = tpl.docType; forms.appendChild(h);
    const reveals = tpl.reveals || {};
    const controlled = new Set(Object.values(reveals)); // text fields gated by a checkbox
    const autoNames = new Set(auto.map((f) => f.name));  // filled from the CRM summary
    const all = [...auto, ...manual];
    const byName = new Map(all.map((f) => [f.name, f]));
    for (const f of all) {
      if (controlled.has(f.name)) continue; // rendered by its controlling checkbox instead
      const { row, inp } = buildFieldRow(f);
      if (autoNames.has(f.name)) row.classList.add('auto');
      forms.appendChild(row);
      // A checkbox that controls a detail field: render that field directly
      // after it, hidden until the box is ticked. Value is kept on un-tick (it
      // simply hides) but gateRevealedValues stops it reaching the output PDF.
      const pairedName = reveals[f.name];
      if (pairedName && byName.has(pairedName)) {
        const { row: prow } = buildFieldRow(byName.get(pairedName));
        prow.classList.add('revealed');
        prow.hidden = !inp.checked;
        forms.appendChild(prow);
        inp.addEventListener('change', () => { prow.hidden = !inp.checked; });
      }
    }
  }
  document.getElementById('formsPanel').hidden = false;
  document.getElementById('generate').disabled = Object.keys(state.values).length === 0;
}

async function onGenerate() {
  const btn = document.getElementById('generate');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const sel = document.getElementById('scenario');
    const sc = state.config.scenarios.scenarios.find((s) => s.id === sel.value);
    const ref = (state.values.client_display_name || 'UNREF').replace(/\s+/g, '');
    const date = new Date();
    const files = [];
    const skipped = [];

    state.values.meta_scenario = sc.name;

    for (const d of sc.documents) {
      if (d.type !== 'generate') continue;
      if (d.status === 'conditional' && !state.conditional[d.doc]) continue;
      const tpl = state.config.templates[d.doc];
      if (!tpl || !state.templateBytes[d.doc]) {
        skipped.push(d.doc);
        continue;
      }
      const vals = gateRevealedValues(state.values, tpl.reveals);
      const filled = await fillTemplate(state.templateBytes[d.doc], vals);
      files.push({ name: gwaFilename(tpl.docType, ref, date), bytes: filled });
    }
    const rows = buildChecklist(sc, state.config.templates);
    const checklist = await renderChecklistPdf(rows, {
      scenarioName: sc.name,
      clientName: state.values.client_full_name || '',
      date: state.values.meta_date_generated || '',
    });
    files.push({ name: gwaFilename('Checklist', ref, date), bytes: checklist });

    const zipBytes = await buildBundle(files);
    download(zipBytes, `GWA_Bundle_${ref}_${date.getFullYear()}.zip`);

    if (skipped.length) {
      document.getElementById('parseStatus').textContent =
        `Bundle downloaded (incomplete) — templates not loaded for: ${skipped.join(', ')}`;
    }
  } catch (err) {
    console.error(err);
    document.getElementById('parseStatus').textContent =
      'Generation failed — see console. Nothing was downloaded.';
  } finally {
    btn.disabled = Object.keys(state.values).length === 0;
    btn.textContent = 'Generate & download bundle';
  }
}

function download(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

init().catch((e) => console.error(e));
