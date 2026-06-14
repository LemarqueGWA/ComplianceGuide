// Shared dashboard UI controller. Both entry points (js/app.js for the dev
// server, standalone/main.js for the offline single-file) call initDashboard()
// with a small env-specific loader bundle; ALL DOM/UX logic lives here so the
// redesign is written once.
//
// opts = {
//   loadConfig:       () => Promise<{templates, scenarios}>
//   getTemplateBytes: (docId, tpl) => Promise<Uint8Array|null>
//   extractItems:     (ArrayBuffer) => Promise<string[]>   // pdf.js text extraction
// }
import { parseClientInfo, computeFields } from './crm-parser.js';
import { classifyFields, gateRevealedValues, prettyLabel } from './field-resolver.js';
import { listFields, fillTemplate } from './filler.js';
import { buildChecklist, renderChecklistPdf } from './checklist.js';
import { DOC_LABELS } from './doc-labels.js';
import { gwaFilename, buildBundle } from './bundler.js';

const $ = (id) => document.getElementById(id);

// ---- field → section grouping (accordion) ----
const SECTIONS = [
  ['Client', (n) => /^(client_|first_|last_|maiden_|marital_|title_|gender|age|dob|place_|nationality)/.test(n)],
  ['Spouse', (n) => /^spouse_/.test(n)],
  ['Contact', (n) => /^(contact_|home_|corr_|ext_|postal_|physical_|email|cell|tel|phone)/.test(n)],
  ['FICA', (n) => /^(fica_|id_|tax_|source_|pep_|kyc_)/.test(n)],
  ['FAIS', (n) => /^(fais_|risk_|invest|objective|term_|horizon)/.test(n)],
  ['Will / Estate', (n) => /^(will_|estate_|exec)/.test(n)],
  ['Review', (n) => /^(review_|meta_|date_)/.test(n)],
];
const SECTION_ORDER = ['Client', 'Spouse', 'Contact', 'FICA', 'FAIS', 'Will / Estate', 'Review', 'Other'];
function sectionFor(name) {
  for (const [title, test] of SECTIONS) if (test(name)) return title;
  return 'Other';
}
function inputTypeFor(name, type) {
  if (type === 'checkbox') return 'checkbox';
  if (name.endsWith('_date')) return 'date';
  if (name.endsWith('_amount')) return 'number';
  return 'text';
}
// returns '' if ok, else an error message. Only FORMAT is validated (emptiness
// is tracked for progress, not flagged red — avoids a wall of red on load).
function formatError(name, type, value) {
  const v = (value || '').trim();
  if (!v || type === 'checkbox') return '';
  if (name.endsWith('_date') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Use YYYY-MM-DD';
  if (/(^|_)id$/.test(name)) {
    const digits = v.replace(/\D/g, '');
    if (digits.length && digits.length !== 13) return 'SA ID = 13 digits';
  }
  return '';
}

export function initDashboard(opts) {
  const state = {
    config: null, values: {}, conditional: {},
    templateBytes: {}, fields: new Map(), reveals: {},
    scenario: null, lastZip: null, lastZipName: '',
  };
  let renderToken = 0;

  // ---------- tabs ----------
  function setTab(p) {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.p === p)));
    document.querySelectorAll('.panel').forEach((pl) => pl.classList.toggle('active', pl.id === 'p-' + p));
  }
  function enableTab(id, on = true) { const t = $(id); if (t) t.disabled = !on; }
  function wireTabs() {
    const tabs = [...document.querySelectorAll('.tab')];
    tabs.forEach((t) => t.addEventListener('click', () => { if (!t.disabled) setTab(t.dataset.p); }));
    const wrap = document.querySelector('.tabwrap');
    if (wrap) wrap.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      let j = i + step;
      while (tabs[j] && tabs[j].disabled) j += step;
      if (tabs[j]) tabs[j].focus();
    });
  }

  // ---------- upload ----------
  async function onUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const items = await opts.extractItems(await file.arrayBuffer());
      const ai = items.indexOf('Advisor:');
      const adviser = ai >= 0 ? (items[ai + 1] || '') : '';
      const parsed = parseClientInfo(items);
      state.values = computeFields(parsed, { today: new Date(), adviser });
      const p = $('parseStatus');
      if (p) {
        p.classList.add('show');
        p.textContent = `✓ Parsed: ${state.values.client_display_name || '(name not found)'} — ${Object.keys(state.values).length} fields. Choose a scenario.`;
      }
      if (state.scenario) await renderScenario();
    } catch (err) {
      console.error(err);
      const p = $('parseStatus');
      if (p) { p.classList.add('show'); p.textContent = 'Could not read this PDF. Is it a Client Information Summary export?'; }
    }
  }

  // ---------- scenario change ----------
  async function onScenarioChange() {
    const id = $('scenario').value;
    state.scenario = state.config.scenarios.scenarios.find((s) => s.id === id) || null;
    state.conditional = {};
    if (!state.scenario) {
      enableTab('tab-checklist', false); enableTab('tab-forms', false);
      $('summaryStrip').classList.remove('show');
      return;
    }
    enableTab('tab-checklist', true); enableTab('tab-forms', true);
    await renderScenario();
    setTab('checklist');
  }

  async function renderScenario() {
    if (!state.scenario) return;
    ++renderToken;
    buildChecklistDOM();
    await buildForms();
    renderFormsDOM();
    refresh();
  }

  // ---------- checklist + conditional Yes/No ----------
  function buildChecklistDOM() {
    const sc = state.scenario;
    const wrap = $('checklist'); wrap.innerHTML = '';
    for (const d of sc.documents) {
      const title = DOC_LABELS[d.doc] || prettyLabel(d.doc);
      const div = document.createElement('div');
      if (d.status === 'conditional') {
        div.className = 'doc cond';
        div.innerHTML =
          `<span class="ic">❓</span><span><b>${title}</b><span class="note">${d.note || ''}</span></span>` +
          `<span class="yn"><button type="button" data-v="yes">Yes</button><button type="button" data-v="no">No</button></span>`;
        const set = (yes) => {
          state.conditional[d.doc] = yes;
          div.querySelectorAll('.yn button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'yes') === yes));
          div.classList.toggle('excluded', !yes);
          renderScenario();
        };
        div.querySelector('[data-v="yes"]').addEventListener('click', () => set(true));
        div.querySelector('[data-v="no"]').addEventListener('click', () => set(false));
        if (state.conditional[d.doc] !== undefined) {
          const yes = state.conditional[d.doc];
          div.querySelectorAll('.yn button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'yes') === yes));
          div.classList.toggle('excluded', !yes);
        }
      } else {
        const collect = d.type === 'collect';
        div.className = 'doc' + (collect ? ' collect' : '');
        div.innerHTML = `<span class="ic">${collect ? '📎' : '✓'}</span><span><b>${title}</b>` +
          `<span class="note">${collect ? 'Attach manually' : 'Auto-generated by this tool'}</span></span>`;
      }
      wrap.appendChild(div);
    }
    buildPrintChecklist();
  }

  // ---------- forms: gather fields across active generate docs, dedup by name ----------
  async function buildForms() {
    const sc = state.scenario;
    const myToken = renderToken;
    const known = new Set(Object.keys(state.values));
    state.fields = new Map();
    state.reveals = {};
    for (const d of sc.documents) {
      if (d.type !== 'generate') continue;
      if (d.status === 'conditional' && !state.conditional[d.doc]) continue;
      const tpl = state.config.templates[d.doc];
      if (!tpl) continue;
      if (!state.templateBytes[d.doc]) {
        const bytes = await opts.getTemplateBytes(d.doc, tpl);
        if (myToken !== renderToken) return;
        if (!bytes) continue;
        state.templateBytes[d.doc] = bytes;
      }
      const list = await listFields(state.templateBytes[d.doc]);
      if (myToken !== renderToken) return;
      const { auto, manual } = classifyFields(list, known);
      Object.assign(state.reveals, tpl.reveals || {});
      for (const f of auto) {
        if (!state.fields.has(f.name)) {
          state.fields.set(f.name, { name: f.name, type: f.type, inputType: inputTypeFor(f.name, f.type), label: prettyLabel(f.name), auto: true });
        }
      }
      for (const f of manual) {
        if (!state.fields.has(f.name)) state.fields.set(f.name, { ...f, auto: false });
      }
    }
  }

  function fieldRow(f) {
    const row = document.createElement('div');
    row.className = 'row' + (f.auto ? ' auto' : '');
    const lab = document.createElement('label');
    lab.className = 'fld'; lab.setAttribute('for', 'f_' + f.name);
    lab.innerHTML = (f.label || f.name) + (!f.auto && f.inputType !== 'checkbox' ? '<span class="req" title="to complete">*</span>' : '') +
      (f.auto ? '<span class="chip chip-crm">CRM</span>' : '');
    row.appendChild(lab);
    const err = document.createElement('div'); err.className = 'err';
    let inp;
    if (f.inputType === 'checkbox') {
      inp = document.createElement('input'); inp.type = 'checkbox';
      inp.id = 'f_' + f.name;
      inp.checked = state.values[f.name] === 'Yes' || state.values[f.name] === true;
      row.classList.add('check');
      inp.addEventListener('change', () => { state.values[f.name] = inp.checked ? 'Yes' : ''; refresh(); });
    } else {
      inp = document.createElement('input'); inp.type = 'text'; inp.id = 'f_' + f.name;
      inp.value = state.values[f.name] || '';
      if (f.inputType === 'date') inp.placeholder = 'YYYY-MM-DD';
      inp.addEventListener('input', () => {
        state.values[f.name] = inp.value;
        const msg = formatError(f.name, f.type, inp.value);
        err.textContent = msg; row.classList.toggle('invalid', !!msg);
        refresh();
      });
    }
    row.appendChild(inp); row.appendChild(err);
    return { row, inp };
  }

  function renderFormsDOM() {
    const acc = $('acc'); acc.innerHTML = '';
    const controlled = new Set(Object.values(state.reveals)); // detail fields shown under their checkbox
    const groups = new Map();
    for (const f of state.fields.values()) {
      if (controlled.has(f.name)) continue;
      const sec = sectionFor(f.name);
      if (!groups.has(sec)) groups.set(sec, { manual: [], auto: [] });
      groups.get(sec)[f.auto ? 'auto' : 'manual'].push(f);
    }
    const entries = [...groups.entries()].sort(
      (a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]));
    entries.forEach(([sec, g], idx) => {
      const box = document.createElement('div'); box.className = 'acc' + (idx === 0 ? ' open' : '');
      const head = document.createElement('button'); head.type = 'button';
      head.innerHTML = `<span class="chev">▸</span>${sec}<span class="cnt">${g.manual.length} to fill · ${g.auto.length} auto</span>`;
      head.addEventListener('click', () => {
        const wasOpen = box.classList.contains('open');
        document.querySelectorAll('#acc .acc').forEach((a) => a.classList.remove('open'));
        if (!wasOpen) box.classList.add('open');
      });
      const body = document.createElement('div'); body.className = 'body';
      const addWithReveal = (f) => {
        const { row, inp } = fieldRow(f);
        body.appendChild(row);
        const pairedName = state.reveals[f.name];
        if (pairedName && state.fields.has(pairedName)) {
          const { row: prow } = fieldRow(state.fields.get(pairedName));
          prow.classList.add('revealed'); prow.hidden = !inp.checked;
          body.appendChild(prow);
          inp.addEventListener('change', () => { prow.hidden = !inp.checked; });
        }
      };
      g.manual.forEach(addWithReveal);
      if (g.auto.length) {
        const fold = document.createElement('div'); fold.className = 'autofold';
        const fb = document.createElement('button'); fb.type = 'button';
        fb.textContent = `▸ ${g.auto.length} auto-filled field${g.auto.length > 1 ? 's' : ''} from CRM — show`;
        fb.addEventListener('click', () => fold.classList.toggle('open'));
        const inner = document.createElement('div'); inner.className = 'auto';
        g.auto.forEach((f) => { const { row } = fieldRow(f); inner.appendChild(row); });
        fold.append(fb, inner); body.appendChild(fold);
      }
      box.append(head, body); acc.appendChild(box);
    });
  }

  // ---------- readiness / summary / gating ----------
  function manualStats() {
    let total = 0, done = 0;
    const controlled = new Set(Object.values(state.reveals));
    for (const f of state.fields.values()) {
      if (f.auto || controlled.has(f.name) || f.inputType === 'checkbox') continue;
      total++;
      if ((state.values[f.name] || '').trim()) done++;
    }
    return { total, done };
  }
  function condStats() {
    const c = state.scenario.documents.filter((d) => d.status === 'conditional');
    const answered = c.filter((d) => state.conditional[d.doc] !== undefined).length;
    return { total: c.length, answered };
  }
  function hasFormatErrors() {
    for (const f of state.fields.values()) if (formatError(f.name, f.type, state.values[f.name])) return true;
    return false;
  }
  function activeDocs() {
    return state.scenario.documents.filter((d) => d.status !== 'conditional' || state.conditional[d.doc]);
  }
  function ready() {
    const m = manualStats(), c = condStats();
    return m.done === m.total && c.answered === c.total && !hasFormatErrors();
  }
  function refresh() {
    if (!state.scenario) return;
    const m = manualStats(), c = condStats();
    if ($('progTxt')) $('progTxt').textContent = `${m.done} of ${m.total} fields complete`;
    if ($('progBar')) $('progBar').style.width = (m.total ? Math.round(m.done / m.total * 100) : 100) + '%';
    const docs = activeDocs();
    const gen = docs.filter((d) => d.type === 'generate').length;
    const col = docs.filter((d) => d.type === 'collect').length;
    const ss = $('summaryStrip');
    ss.classList.add('show');
    ss.innerHTML =
      `<span class="pill">✓ <b>${gen}</b> auto-generated</span>` +
      `<span class="pill">📎 <b>${col}</b> attach manually</span>` +
      `<span class="pill">❓ <b>${c.total - c.answered}</b> conditionals unanswered</span>` +
      `<span class="pill"><b>${m.total - m.done}</b> fields outstanding</span>`;
    const ok = ready();
    const gen2 = $('generate'), force = $('forceBtn');
    gen2.disabled = !ok;
    const miss = [];
    if (m.done < m.total) miss.push(`${m.total - m.done} field(s)`);
    if (c.answered < c.total) miss.push(`${c.total - c.answered} conditional(s)`);
    if (hasFormatErrors()) miss.push('format errors');
    gen2.title = ok ? 'Generate draft pack' : 'Missing: ' + miss.join(', ');
    if (force) force.style.display = ok ? 'none' : 'inline-block';
    if ($('status')) $('status').textContent = ok ? 'Ready to generate.' : 'Outstanding: ' + miss.join(', ');
  }

  // ---------- generate ----------
  async function onGenerate() {
    const btn = $('generate'); const force = $('forceBtn');
    btn.disabled = true; if (force) force.disabled = true;
    const oldTxt = btn.textContent; btn.textContent = 'Generating…';
    try {
      const sc = state.scenario;
      const ref = (state.values.client_display_name || 'UNREF').replace(/\s+/g, '');
      const date = new Date();
      const files = []; const skipped = [];
      state.values.meta_scenario = sc.name;
      for (const d of sc.documents) {
        if (d.type !== 'generate') continue;
        if (d.status === 'conditional' && !state.conditional[d.doc]) continue;
        const tpl = state.config.templates[d.doc];
        if (!tpl || !state.templateBytes[d.doc]) { skipped.push(d.doc); continue; }
        const vals = gateRevealedValues(state.values, tpl.reveals);
        const filled = await fillTemplate(state.templateBytes[d.doc], vals);
        files.push({ name: gwaFilename(tpl.docType, ref, date), bytes: filled });
      }
      const rows = buildChecklist(sc, state.config.templates);
      const checklist = await renderChecklistPdf(rows, {
        scenarioName: sc.name, clientName: state.values.client_full_name || '',
        date: state.values.meta_date_generated || '',
      });
      files.push({ name: gwaFilename('Checklist', ref, date), bytes: checklist });
      const zipBytes = await buildBundle(files);
      state.lastZip = zipBytes;
      state.lastZipName = `GWA_Bundle_${ref}_${date.getFullYear()}.zip`;
      download(zipBytes, state.lastZipName);
      showSuccess(skipped);
    } catch (err) {
      console.error(err);
      if ($('status')) $('status').textContent = 'Generation failed — see console. Nothing was downloaded.';
    } finally {
      if (force) force.disabled = false;
      refresh(); btn.textContent = oldTxt;
    }
  }

  function showSuccess(skipped) {
    const docs = activeDocs();
    $('okScenario').innerHTML = `<b>${state.scenario.name}</b>` +
      (skipped && skipped.length ? ` · <span style="color:#b46a00">skipped (no template): ${skipped.join(', ')}</span>` : '');
    $('okGen').innerHTML = docs.filter((d) => d.type === 'generate')
      .map((d) => `<li>${DOC_LABELS[d.doc] || prettyLabel(d.doc)}</li>`).join('') || '<li>—</li>';
    $('okCollect').innerHTML = docs.filter((d) => d.type === 'collect')
      .map((d) => `<li>${DOC_LABELS[d.doc] || prettyLabel(d.doc)}${d.note ? ` <i style="color:#788693">(${d.note})</i>` : ''}</li>`).join('') || '<li>—</li>';
    $('overlay').classList.add('show');
  }

  // ---------- save / load / reset ----------
  function saveProgress() {
    const data = { scenario: state.scenario ? state.scenario.id : null, values: state.values, conditional: state.conditional, _meta: { draft: true } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    download(blob, 'GWA_Dashboard_progress_DRAFT_CONFIDENTIAL.json');
    if ($('status')) $('status').textContent = 'Progress saved to JSON — store in your access-controlled system (POPIA).';
  }
  async function loadProgress(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      state.values = data.values || {}; state.conditional = data.conditional || {};
      if (data.scenario) { $('scenario').value = data.scenario; }
      state.scenario = state.config.scenarios.scenarios.find((s) => s.id === ($('scenario').value)) || null;
      if (state.scenario) { enableTab('tab-checklist', true); enableTab('tab-forms', true); await renderScenario(); setTab('forms'); }
    } catch (err) { console.error(err); alert('Could not read that progress file.'); }
    finally { e.target.value = ''; }
  }
  function resetAll() {
    state.values = {}; state.conditional = {}; state.scenario = null; state.fields = new Map(); state.reveals = {};
    state.lastZip = null;
    $('scenario').value = '';
    const p = $('parseStatus'); if (p) { p.textContent = ''; p.classList.remove('show'); }
    $('checklist').innerHTML = ''; $('acc').innerHTML = ''; $('summaryStrip').classList.remove('show');
    enableTab('tab-checklist', false); enableTab('tab-forms', false);
    $('generate').disabled = true; if ($('forceBtn')) $('forceBtn').style.display = 'none';
    if ($('status')) $('status').textContent = 'Upload a CRM PDF or choose a scenario to begin.';
    setTab('upload');
  }

  function buildPrintChecklist() {
    const pc = $('printChecklist'); if (!pc) return;
    pc.innerHTML = `<h2>Compliance checklist — ${state.scenario.name}</h2>` +
      state.scenario.documents.map((d) => {
        const t = DOC_LABELS[d.doc] || prettyLabel(d.doc);
        const tag = d.type === 'generate' ? '[ generate ]' : '[ attach ]';
        const cond = d.status === 'conditional' ? ` (conditional: ${d.note || ''})` : '';
        return `<div>&#9744; ${tag} ${t}${cond}</div>`;
      }).join('') +
      `<p style="font-size:10px;color:#788693">DRAFT — compliance review required. Global Wealth Advisory (Pty) Ltd · FSP 49263.</p>`;
  }

  function download(bytesOrBlob, filename) {
    const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- init ----------
  async function init() {
    try {
      state.config = await opts.loadConfig();
      const sel = $('scenario');
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— choose —'; sel.appendChild(ph);
      for (const sc of state.config.scenarios.scenarios) {
        const opt = document.createElement('option'); opt.value = sc.id; opt.textContent = sc.name; sel.appendChild(opt);
      }
      wireTabs();
      $('crmFile').addEventListener('change', onUpload);
      sel.addEventListener('change', onScenarioChange);
      $('generate').addEventListener('click', onGenerate);
      if ($('forceBtn')) $('forceBtn').addEventListener('click', () => {
        if (confirm('Generate the pack with information still outstanding? Draft fields may be blank.')) onGenerate();
      });
      if ($('saveBtn')) $('saveBtn').addEventListener('click', saveProgress);
      if ($('loadFile')) $('loadFile').addEventListener('change', loadProgress);
      if ($('newBtn')) $('newBtn').addEventListener('click', () => { if (confirm('Clear all data and start a new client?')) resetAll(); });
      if ($('okReDl')) $('okReDl').addEventListener('click', () => { if (state.lastZip) download(state.lastZip, state.lastZipName); $('overlay').classList.remove('show'); });
      if ($('okNew')) $('okNew').addEventListener('click', () => { $('overlay').classList.remove('show'); resetAll(); });
      $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') $('overlay').classList.remove('show'); });
      setTab('upload');
    } catch (err) {
      console.error(err);
      const p = $('parseStatus');
      if (p) { p.classList.add('show'); p.textContent = 'Could not load dashboard config.'; }
    }
  }

  return init();
}
