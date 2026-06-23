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
// ---- named multi-column checkbox sections (override the prefix grouping) ----
// Members are exact AcroForm field names. A group renders only if >=1 member is
// present in the active scenario's templates.
const CHECK_GRID_GROUPS = [
  { title: 'Service Request', cols: 3, members: [
    'service_request_investment_planning', 'service_request_plan_for_retirement',
    'service_request_plan_at_retirement', 'service_request_specific_goal',
    'service_request_cash_management_solution', 'service_request_fin_plan_death',
    'service_request_short_term_insurance', 'service_request_fin_plan_disability',
    'service_request_medical_aid', 'service_request_fin_plan_dread_disease',
    'service_request_gap_cover', 'service_request_business_assurance',
    'service_request_will_testament', 'service_request_estate_planning', 'service_request_other',
  ] },
  { title: 'Source of Funds / Wealth', cols: 3, members: [
    'select_infome_from_salary', 'select_comnpany_profits', 'select_savings_investments',
    'select_gift_donation', 'select_retirement_income', 'select_sale_rental_income',
    'select_sale_of_company', 'select_divorce_settlement', 'select_inheritance', 'select_other',
  ] },
  { title: 'Nature and purpose of business relationship', cols: 2, members: [
    'select_long_term_insurance', 'select_fin_planning', 'select_wealth_management',
    'select_single_transaction', 'select_other_purpose_of_business',
  ] },
  { title: 'Portfolio Objective', cols: 2, members: [
    'portfolio_objective_draw_income', 'portfolio_objective_preserve_capital',
    'portfolio_objective_grow_capital', 'portfolio_objective_combination',
  ] },
  { title: 'Products Considered', cols: 3, members: [
    'products_considered_investment_portfolio', 'products_considered_tfsa',
    'products_considered_local_and_global_share_portfolio', 'products_considered_ccm',
    'products_considered_structured_products', 'products_considered_endowment_sinking_funds',
    'products_considered_ra', 'products_considered_pension_fund', 'products_considered_provident_fund',
    'products_considered_preservation_fund', 'products_considered_living_annuity', 'products_considered_life_annuity',
  ] },
  { title: 'Investment Objective', cols: 2, members: [
    'investment_objective_max_liquidity', 'investment_objective_combination_liquidity_cap_preservation',
    'investment_objective_capital_preservation', 'investment_objective_combination_liquidity_cap_growth',
    'investment_objective_capital_growth',
  ], labels: {
    investment_objective_max_liquidity: 'Max Liquidity',
    investment_objective_combination_liquidity_cap_preservation: 'Combination: Liquidity & Capital Preservation',
    investment_objective_capital_preservation: 'Capital Preservation',
    investment_objective_combination_liquidity_cap_growth: 'Combination: Liquidity & Capital Growth',
    investment_objective_capital_growth: 'Capital Growth',
  } },
  { title: 'Investment Term', cols: 2, members: [
    'term_medium_long', 'term_long', 'term_medium', 'term_short',
  ], labels: {
    term_medium_long: 'Medium–Long',
    term_long: 'Long',
    term_medium: 'Medium',
    term_short: 'Short',
  } },
  { title: 'Risk Profile', cols: 3, members: [
    'risk_profile_stable', 'risk_profile_balanced', 'risk_profile_aggressive',
  ], labels: {
    risk_profile_stable: 'Stable',
    risk_profile_balanced: 'Balanced',
    risk_profile_aggressive: 'Aggressive',
  } },
];
// Investment allocation text fields, each gated behind a master "has portfolio?"
// toggle and a per-type checkbox (both UI-only). uiFlag/prefix key the UI state.
const INVEST_GROUPS = [
  { title: 'Existing Investments', uiFlag: 'hasExisting', prefix: 'ei',
    master: 'Client has an existing investment portfolio?', types: [
      ['existing_investment_income', 'Income'], ['existing_investment_stable', 'Stable'],
      ['existing_investment_balanced', 'Balanced'], ['existing_investment_growth', 'Growth'],
      ['existing_investment_fully_offshore', 'Fully Offshore'],
    ] },
  { title: 'Proposed Investments', uiFlag: 'hasProposed', prefix: 'pi',
    master: 'Propose an investment portfolio?', types: [
      ['proposed_investment_income', 'Income'], ['proposed_investment_stable', 'Stable'],
      ['proposed_investment_balanced', 'Balanced'], ['proposed_investment_growth', 'Growth'],
      ['proposed_investment_fully_offshore', 'Fully Offshore'],
    ] },
];
function claimedNames(fields) {
  const s = new Set();
  for (const g of CHECK_GRID_GROUPS) for (const n of g.members) if (fields.has(n)) s.add(n);
  for (const g of INVEST_GROUPS) for (const [n] of g.types) if (fields.has(n)) s.add(n);
  return s;
}

// returns '' if ok, else an error message. Only FORMAT is validated (emptiness
// is tracked for progress, not flagged red — avoids a wall of red on load).
function formatError(name, type, value) {
  const v = (value || '').trim();
  if (!v || type === 'checkbox') return '';
  // dates now use a native picker — validity is enforced by the input itself
  if (/(^|_)id$/.test(name)) {
    const digits = v.replace(/\D/g, '');
    if (digits.length && digits.length !== 13) return 'SA ID = 13 digits';
  }
  return '';
}

// Live ZAR formatting for money inputs — "R 1 250 000" per CLAUDE.md §3.3.
// Strips to whole-rand digits and regroups with spaces; empty stays empty.
function formatZar(v) {
  const digits = String(v == null ? '' : v).replace(/[^\d]/g, '');
  if (!digits) return '';
  return 'R ' + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Date model bridge: the app stores/outputs dates in GWA long form
// ("23 June 2026"), but a native date input needs ISO "YYYY-MM-DD". Convert
// at the input boundary so prefilled CRM dates show in the picker and the
// value written to the PDF stays in house style.
const _MONTHS_LONG = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
function dateToISO(v) {
  v = String(v == null ? '' : v).trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  let m = v.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);   // 23 June 2026
  if (m) { const mo = _MONTHS_LONG.findIndex((n) => n.toLowerCase() === m[2].toLowerCase());
    if (mo >= 0) return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);               // 23/06/2026
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}
function isoToLong(v) {
  const m = String(v == null ? '' : v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v || '';
  return `${m[3]} ${_MONTHS_LONG[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

// Long free-text fields that should span the full width of the 2-column grid
// rather than sit in a narrow cell.
function isWideField(name) {
  return /(name|surname|address|email|objective|description|reason|note|detail|comment|restriction)/i.test(name);
}

export function initDashboard(opts) {
  const state = {
    config: null, values: {}, conditional: {}, ui: {}, verify: {},
    templateBytes: {}, docs: [], claimedGlobal: new Set(),
    currentLine: null, scenario: null, advisor: '', lastZip: null, lastZipName: '',
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
      else setTab('scenario'); // auto-advance to the next step once parsed
    } catch (err) {
      console.error(err);
      const p = $('parseStatus');
      if (p) { p.classList.add('show'); p.textContent = 'Could not read this PDF. Is it a Client Information Summary export?'; }
    }
  }

  // ---------- product line → scenario ----------
  function populateScenarios(lineId) {
    state.currentLine = state.config.lines.find((l) => l.id === lineId) || state.config.lines[0];
    const sel = $('scenario');
    sel.innerHTML = '';
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— choose —'; sel.appendChild(ph);
    for (const sc of state.currentLine.scenarios) {
      const opt = document.createElement('option'); opt.value = sc.id; opt.textContent = sc.name; sel.appendChild(opt);
    }
    // changing line clears the active scenario + downstream
    state.scenario = null; state.conditional = {}; state.verify = {};
    enableTab('tab-checklist', false); enableTab('tab-forms', false);
    $('summaryStrip').classList.remove('show');
    $('checklist').innerHTML = ''; $('acc').innerHTML = '';
    if ($('generate')) $('generate').disabled = true;
  }

  function onLineChange() { populateScenarios($('line').value); }

  // ---------- scenario change ----------
  async function onScenarioChange() {
    const id = $('scenario').value;
    state.scenario = (state.currentLine ? state.currentLine.scenarios : []).find((s) => s.id === id) || null;
    state.conditional = {}; state.verify = {};
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
    renderVerifications();
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

  // ---------- external verifications (link → upload, gate Generate) ----------
  // A verification applies to the current scenario if any of its docs is an
  // active (required or conditional-Yes) document in that scenario.
  function applicableVerifications() {
    const vs = state.config.verifications || [];
    const active = new Set(activeDocs().map((d) => d.doc));
    return vs.filter((v) => (v.docs || []).some((d) => active.has(d)));
  }
  function verifyOutstanding() {
    return applicableVerifications().filter((v) => { const s = state.verify[v.id]; return !(s && s.clicked && s.bytes); }).length;
  }
  function renderVerifications() {
    const wrap = $('verifyBlock'); if (!wrap) return;
    const list = applicableVerifications();
    wrap.innerHTML = '';
    if (!list.length) return;
    const h = document.createElement('h4'); h.textContent = 'Required verifications'; wrap.appendChild(h);
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Open each site, then upload the result. Generation stays locked until both are done.';
    wrap.appendChild(hint);
    for (const v of list) {
      const st = state.verify[v.id] || (state.verify[v.id] = { clicked: false, name: null, bytes: null });
      const cell = document.createElement('div'); cell.className = 'verify-cell';
      const head = document.createElement('div'); head.className = 'verify-head';
      head.innerHTML = `<b>${v.label}</b> <span class="verify-kind">(${v.kind})</span>`;
      const rowEl = document.createElement('div'); rowEl.className = 'verify-item';
      const file = document.createElement('input'); file.type = 'file'; if (v.accept) file.accept = v.accept;
      file.disabled = !st.clicked;
      const status = document.createElement('span'); status.className = 'verify-status';
      status.textContent = st.bytes ? `✓ ${st.name}` : (st.clicked ? `Upload the ${v.kind}` : 'Click “Open” first');
      const a = document.createElement('a');
      a.href = v.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'btn ghost'; a.textContent = 'Open ↗';
      // Update IN PLACE — do NOT re-render here: rebuilding the block would destroy
      // this anchor mid-click and the just-opened tab ends up blank (file:// esp.).
      a.addEventListener('click', () => {
        st.clicked = true; file.disabled = false;
        if (!st.bytes) status.textContent = `Upload the ${v.kind}`;
        refresh();
      });
      file.addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        st.name = f.name; st.bytes = new Uint8Array(await f.arrayBuffer());
        status.textContent = `✓ ${f.name}`;
        refresh();
      });
      rowEl.append(a, file, status);
      cell.append(head, rowEl); wrap.appendChild(cell);
    }
  }

  // ---------- forms: gather fields PER active generate document ----------
  // Each document keeps its own field set so the UI can show one section per
  // document containing exactly that document's outstanding fields.
  async function buildForms() {
    const sc = state.scenario;
    const myToken = renderToken;
    const known = new Set(Object.keys(state.values));
    const docs = [];
    const claimed = new Set();
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
      // Prefer build-time pre-extracted field lists (browser pdf-lib AcroForm
      // parsing is pathologically slow on some templates). Fall back to parsing.
      let list = opts.listFields ? await opts.listFields(d.doc, state.templateBytes[d.doc]) : null;
      if (!list) list = await listFields(state.templateBytes[d.doc]);
      if (myToken !== renderToken) return;
      const { auto, manual } = classifyFields(list, known);
      const fields = new Map();
      for (const f of auto) fields.set(f.name, { name: f.name, type: f.type, inputType: inputTypeFor(f.name, f.type), label: prettyLabel(f.name), auto: true });
      for (const f of manual) if (!fields.has(f.name)) fields.set(f.name, { ...f, auto: false });
      for (const n of claimedNames(fields)) claimed.add(n);
      docs.push({ docId: d.doc, title: DOC_LABELS[d.doc] || prettyLabel(d.doc), fields, reveals: tpl.reveals || {} });
    }
    state.docs = docs;
    state.claimedGlobal = claimed;
  }

  // Keep every input bound to the same field name in sync (a field can appear in
  // more than one document section). Skip the focused text input so typing isn't
  // disrupted; checkboxes always mirror.
  function syncField(name) {
    const v = state.values[name];
    const sel = 'input[data-field="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]';
    document.querySelectorAll(sel).forEach((i) => {
      if (i.type === 'checkbox') i.checked = v === 'Yes' || v === true;
      else if (document.activeElement !== i) i.value = i.type === 'date' ? dateToISO(v) : (v || '');
    });
  }

  function fieldRow(f) {
    const row = document.createElement('div');
    row.className = 'row' + (f.auto ? ' auto' : '');
    const lab = document.createElement('label'); lab.className = 'fld';
    lab.innerHTML = (f.label || f.name) + (!f.auto && f.inputType !== 'checkbox' ? '<span class="req" title="to complete">*</span>' : '') +
      (f.auto ? '<span class="chip chip-crm">CRM</span>' : '');
    row.appendChild(lab);
    const err = document.createElement('div'); err.className = 'err';
    let inp;
    if (f.inputType === 'checkbox') {
      inp = document.createElement('input'); inp.type = 'checkbox'; inp.dataset.field = f.name;
      inp.checked = state.values[f.name] === 'Yes' || state.values[f.name] === true;
      row.classList.add('check');
      inp.addEventListener('change', () => { state.values[f.name] = inp.checked ? 'Yes' : ''; syncField(f.name); refresh(); });
    } else {
      inp = document.createElement('input'); inp.dataset.field = f.name;
      inp.className = 'inp-' + f.inputType + (isWideField(f.name) ? ' wide' : '');
      if (f.inputType === 'date') {
        inp.type = 'date'; // picker holds ISO; state keeps GWA long form
        inp.value = dateToISO(state.values[f.name]);
        inp.addEventListener('input', () => { state.values[f.name] = isoToLong(inp.value); syncField(f.name); refresh(); });
      } else if (f.inputType === 'number') {
        // money field — live "R 1 250 000" formatting
        inp.type = 'text'; inp.inputMode = 'numeric';
        inp.value = formatZar(state.values[f.name]);
        inp.addEventListener('input', () => {
          inp.value = formatZar(inp.value);
          state.values[f.name] = inp.value; syncField(f.name); refresh();
        });
      } else {
        inp.type = 'text';
        inp.value = state.values[f.name] || '';
        inp.addEventListener('input', () => { state.values[f.name] = inp.value; syncField(f.name); refresh(); });
      }
      // validation surfaces on blur (not while typing) — avoids nagging
      inp.addEventListener('blur', () => {
        const msg = formatError(f.name, f.type, inp.value);
        err.textContent = msg; row.classList.toggle('invalid', !!msg);
      });
    }
    row.appendChild(inp); row.appendChild(err);
    return { row, inp };
  }

  // accordion section shell; one-open-at-a-time
  function makeSection(acc, title, countLabel) {
    const box = document.createElement('div'); box.className = 'acc';
    const head = document.createElement('button'); head.type = 'button';
    head.innerHTML = `<span class="chev">▸</span>${title}` + (countLabel ? `<span class="cnt">${countLabel}</span>` : '');
    head.addEventListener('click', () => {
      const wasOpen = box.classList.contains('open');
      document.querySelectorAll('#acc .acc').forEach((a) => a.classList.remove('open'));
      if (!wasOpen) box.classList.add('open');
    });
    const body = document.createElement('div'); body.className = 'body';
    box.append(head, body); acc.appendChild(box);
    return body;
  }

  // a compact "label  ☐" checkbox cell for grid layouts
  function checkCell(f, labelText) {
    const cell = document.createElement('div'); cell.className = 'checkcell';
    const lab = document.createElement('label'); lab.textContent = labelText || f.label || prettyLabel(f.name);
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.dataset.field = f.name;
    inp.checked = state.values[f.name] === 'Yes' || state.values[f.name] === true;
    inp.addEventListener('change', () => { state.values[f.name] = inp.checked ? 'Yes' : ''; syncField(f.name); refresh(); });
    cell.append(lab, inp);
    return { cell, inp };
  }

  // a named multi-column checkbox sub-block (h4 + grid) inside a document section
  function subGrid(body, doc, grp, present) {
    const h = document.createElement('h4'); h.textContent = grp.title; body.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'grid c' + grp.cols;
    const details = [];
    for (const name of present) {
      const { cell, inp } = checkCell(doc.fields.get(name), grp.labels && grp.labels[name]);
      grid.appendChild(cell);
      const dn = doc.reveals[name];
      if (dn && doc.fields.has(dn)) {
        const { row: drow } = fieldRow(doc.fields.get(dn));
        drow.classList.add('revealed'); drow.hidden = !inp.checked;
        details.push(drow);
        inp.addEventListener('change', () => { drow.hidden = !inp.checked; });
      }
    }
    body.appendChild(grid);
    details.forEach((d) => body.appendChild(d));
  }

  // investment nested sub-block: master toggle → per-type checkbox → amount field
  function subInvest(body, doc, g, present) {
    const h = document.createElement('h4'); h.textContent = g.title; body.appendChild(h);
    const master = document.createElement('div'); master.className = 'checkcell master';
    const mlab = document.createElement('label'); mlab.textContent = g.master;
    const mcb = document.createElement('input'); mcb.type = 'checkbox'; mcb.checked = !!state.ui[g.uiFlag];
    master.append(mlab, mcb);
    const container = document.createElement('div'); container.className = 'nested'; container.hidden = !state.ui[g.uiFlag];
    const grid = document.createElement('div'); grid.className = 'grid c2';
    for (const [name, label] of present) {
      const wrap = document.createElement('div'); wrap.className = 'ei-type';
      const cell = document.createElement('div'); cell.className = 'checkcell';
      const tlab = document.createElement('label'); tlab.textContent = label;
      const tcb = document.createElement('input'); tcb.type = 'checkbox'; tcb.checked = !!state.ui[g.prefix + '_' + name];
      cell.append(tlab, tcb);
      const { row: drow } = fieldRow(doc.fields.get(name));
      drow.classList.add('revealed'); drow.hidden = !tcb.checked;
      tcb.addEventListener('change', () => {
        state.ui[g.prefix + '_' + name] = tcb.checked; drow.hidden = !tcb.checked;
        if (!tcb.checked) { state.values[name] = ''; syncField(name); }
        refresh();
      });
      wrap.append(cell, drow); grid.appendChild(wrap);
    }
    container.appendChild(grid);
    mcb.addEventListener('change', () => {
      state.ui[g.uiFlag] = mcb.checked; container.hidden = !mcb.checked;
      if (!mcb.checked) {
        container.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
        container.querySelectorAll('.row.revealed').forEach((r) => { r.hidden = true; });
        for (const [name] of present) { state.ui[g.prefix + '_' + name] = false; state.values[name] = ''; syncField(name); }
      }
      refresh();
    });
    body.append(master, container);
  }

  // count of outstanding manual fields for one document (for its section header)
  function docManualOutstanding(doc) {
    const controlled = new Set(Object.values(doc.reveals));
    let n = 0;
    for (const f of doc.fields.values()) {
      if (f.auto || f.inputType === 'checkbox' || state.claimedGlobal.has(f.name) || controlled.has(f.name)) continue;
      if (!(state.values[f.name] || '').trim()) n++;
    }
    return n;
  }

  function renderDocBody(body, doc) {
    const controlled = new Set(Object.values(doc.reveals));
    const genericManual = [], genericAuto = [];
    for (const f of doc.fields.values()) {
      if (controlled.has(f.name) || state.claimedGlobal.has(f.name)) continue;
      (f.auto ? genericAuto : genericManual).push(f);
    }
    // Generic manual fields laid out in a 2-column grid. Wide free-text fields
    // (names, addresses, objectives) and any field with a conditional reveal
    // span the full width so their revealed sub-field sits directly beneath.
    if (genericManual.length) {
      const fg = document.createElement('div'); fg.className = 'fieldgrid';
      for (const f of genericManual) {
        const { row, inp } = fieldRow(f);
        const dn = doc.reveals[f.name];
        if (isWideField(f.name) || (dn && doc.fields.has(dn))) row.classList.add('span2');
        fg.appendChild(row);
        if (dn && doc.fields.has(dn)) {
          const { row: prow } = fieldRow(doc.fields.get(dn));
          prow.classList.add('revealed', 'span2'); prow.hidden = !inp.checked;
          fg.appendChild(prow);
          inp.addEventListener('change', () => { prow.hidden = !inp.checked; });
        }
      }
      body.appendChild(fg);
    }
    if (genericAuto.length) {
      const fold = document.createElement('div'); fold.className = 'autofold';
      const fb = document.createElement('button'); fb.type = 'button';
      fb.textContent = `▸ ${genericAuto.length} auto-filled field${genericAuto.length > 1 ? 's' : ''} from CRM — show`;
      fb.addEventListener('click', () => fold.classList.toggle('open'));
      const inner = document.createElement('div'); inner.className = 'auto';
      genericAuto.forEach((f) => { const { row } = fieldRow(f); inner.appendChild(row); });
      fold.append(fb, inner); body.appendChild(fold);
    }
    // named sub-sections that belong to THIS document
    for (const grp of CHECK_GRID_GROUPS) {
      const present = grp.members.filter((n) => doc.fields.has(n));
      if (present.length) subGrid(body, doc, grp, present);
    }
    for (const g of INVEST_GROUPS) {
      const present = g.types.filter(([n]) => doc.fields.has(n));
      if (present.length) subInvest(body, doc, g, present);
    }
  }

  // one top-level section per active generate document
  function renderFormsDOM() {
    const acc = $('acc'); acc.innerHTML = '';
    let firstIncomplete = null, firstBox = null;
    for (const doc of state.docs) {
      const out = docManualOutstanding(doc);
      const body = makeSection(acc, doc.title, out ? `${out} to fill` : 'complete');
      renderDocBody(body, doc);
      const box = body.parentElement;
      if (!firstBox) firstBox = box;
      if (out > 0 && !firstIncomplete) firstIncomplete = box;
    }
    const toOpen = firstIncomplete || firstBox; if (toOpen) toOpen.classList.add('open');
  }

  // ---------- readiness / summary / gating ----------
  function manualStats() {
    // unique manual fields across all documents (a field can appear in several)
    const seen = new Map();
    for (const doc of state.docs) {
      const controlled = new Set(Object.values(doc.reveals));
      for (const f of doc.fields.values()) {
        if (f.auto || f.inputType === 'checkbox' || state.claimedGlobal.has(f.name) || controlled.has(f.name)) continue;
        if (!seen.has(f.name)) seen.set(f.name, f);
      }
    }
    let total = 0, done = 0;
    for (const name of seen.keys()) { total++; if ((state.values[name] || '').trim()) done++; }
    return { total, done };
  }
  function condStats() {
    const c = state.scenario.documents.filter((d) => d.status === 'conditional');
    const answered = c.filter((d) => state.conditional[d.doc] !== undefined).length;
    return { total: c.length, answered };
  }
  function hasFormatErrors() {
    for (const doc of state.docs) for (const f of doc.fields.values()) {
      if (formatError(f.name, f.type, state.values[f.name])) return true;
    }
    return false;
  }
  function activeDocs() {
    return state.scenario.documents.filter((d) => d.status !== 'conditional' || state.conditional[d.doc]);
  }
  function ready() {
    const m = manualStats(), c = condStats();
    return m.done === m.total && c.answered === c.total && !hasFormatErrors() && verifyOutstanding() === 0;
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
    const vOut = verifyOutstanding();
    ss.innerHTML =
      `<span class="pill">✓ <b>${gen}</b> auto-generated</span>` +
      `<span class="pill">📎 <b>${col}</b> attach manually</span>` +
      `<span class="pill">❓ <b>${c.total - c.answered}</b> conditionals unanswered</span>` +
      (applicableVerifications().length ? `<span class="pill">🔗 <b>${vOut}</b> verifications outstanding</span>` : '') +
      `<span class="pill"><b>${m.total - m.done}</b> fields outstanding</span>`;
    const ok = ready();
    const gen2 = $('generate'), force = $('forceBtn');
    gen2.disabled = !ok;
    const miss = [];
    if (m.done < m.total) miss.push(`${m.total - m.done} field(s)`);
    if (c.answered < c.total) miss.push(`${c.total - c.answered} conditional(s)`);
    if (vOut) miss.push(`${vOut} verification(s)`);
    if (hasFormatErrors()) miss.push('format errors');
    gen2.title = ok ? 'Generate draft pack' : 'Missing: ' + miss.join(', ');
    if (force) force.style.display = ok ? 'none' : 'inline-block';
    if ($('status')) $('status').textContent = ok ? 'Ready to generate.' : 'Outstanding: ' + miss.join(', ');
  }

  // ---------- generate ----------
  async function onGenerate() {
    // hard gate: the external verifications cannot be bypassed (even by "Generate anyway")
    if (verifyOutstanding() > 0) {
      if ($('status')) $('status').textContent = 'Open the verification link(s) and upload the required screenshot / PDF before generating.';
      setTab('checklist');
      return;
    }
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
      // selected adviser's Letter of Introduction & Disclosure
      if (state.advisor && opts.getDisclosureBytes) {
        const db = await opts.getDisclosureBytes(state.advisor);
        if (db) files.push({ name: `GWA_Disclosure_${state.advisor.replace(/\s+/g, '')}_${ref}_${date.getFullYear()}.pdf`, bytes: db });
        else skipped.push('disclosure_letter (' + state.advisor + ')');
      }
      // uploaded external verifications (screenshot / PDF report) travel with the pack
      for (const v of applicableVerifications()) {
        const s = state.verify[v.id];
        if (s && s.bytes) {
          const ext = (s.name && s.name.includes('.')) ? s.name.split('.').pop() : (v.accept === 'application/pdf' ? 'pdf' : 'png');
          files.push({ name: `GWA_${v.id}_${ref}_${date.getFullYear()}.${ext}`, bytes: s.bytes });
        }
      }
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

  // Docs that are included in the .zip automatically even though they are "collect"
  // in config: the disclosure is attached per-adviser, and the EaseFICA report +
  // PEP screening come from the required verification uploads. Show them under
  // "Auto-generated" in the success modal.
  const AUTO_INCLUDED = new Set(['disclosure_letter', 'easefica_risk_rating', 'pep_screening']);
  function showSuccess(skipped) {
    const docs = activeDocs();
    const isAuto = (d) => d.type === 'generate' || AUTO_INCLUDED.has(d.doc);
    $('okScenario').innerHTML = `<b>${state.scenario.name}</b>` +
      (skipped && skipped.length ? ` · <span style="color:#b46a00">skipped (no template): ${skipped.join(', ')}</span>` : '');
    $('okGen').innerHTML = docs.filter(isAuto)
      .map((d) => `<li>${DOC_LABELS[d.doc] || prettyLabel(d.doc)}</li>`).join('') || '<li>—</li>';
    $('okCollect').innerHTML = docs.filter((d) => !isAuto(d))
      .map((d) => `<li>${DOC_LABELS[d.doc] || prettyLabel(d.doc)}${d.note ? ` <i style="color:#788693">(${d.note})</i>` : ''}</li>`).join('') || '<li>—</li>';
    $('overlay').classList.add('show');
  }

  // ---------- save / load / reset ----------
  function saveProgress() {
    const data = { line: state.currentLine ? state.currentLine.id : null, scenario: state.scenario ? state.scenario.id : null, values: state.values, conditional: state.conditional, ui: state.ui, _meta: { draft: true } };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    download(blob, 'GWA_Dashboard_progress_DRAFT_CONFIDENTIAL.json');
    if ($('status')) $('status').textContent = 'Progress saved to JSON — store in your access-controlled system (POPIA).';
  }
  async function loadProgress(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      state.values = data.values || {}; state.ui = data.ui || {};
      // resolve the line (saved id, or whichever line owns the scenario)
      let lineId = data.line;
      if (!lineId && data.scenario) { const L = state.config.lines.find((l) => l.scenarios.some((s) => s.id === data.scenario)); lineId = L && L.id; }
      if (lineId) { $('line').value = lineId; populateScenarios(lineId); }
      state.conditional = data.conditional || {};
      if (data.scenario) {
        $('scenario').value = data.scenario;
        state.scenario = state.currentLine.scenarios.find((s) => s.id === data.scenario) || null;
      }
      if (state.scenario) { enableTab('tab-checklist', true); enableTab('tab-forms', true); await renderScenario(); setTab('forms'); }
    } catch (err) { console.error(err); alert('Could not read that progress file.'); }
    finally { e.target.value = ''; }
  }
  function resetAll() {
    state.values = {}; state.conditional = {}; state.ui = {}; state.verify = {}; state.scenario = null;
    state.docs = []; state.claimedGlobal = new Set();
    state.lastZip = null;
    if ($('line') && state.config.lines.length) { $('line').value = state.config.lines[0].id; populateScenarios(state.config.lines[0].id); }
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
      // backward-compat: accept either {lines:[...]} or the old {scenarios:{line,scenarios}}
      if (!state.config.lines) state.config.lines = [{ id: 'investment', name: state.config.scenarios.line || 'Investment', scenarios: state.config.scenarios.scenarios }];
      const lineSel = $('line');
      for (const l of state.config.lines) {
        const opt = document.createElement('option'); opt.value = l.id; opt.textContent = l.name; lineSel.appendChild(opt);
      }
      lineSel.addEventListener('change', onLineChange);
      populateScenarios(state.config.lines[0].id);
      // advisor dropdown (Upload tab) — selected adviser's disclosure goes in the .zip
      const advSel = $('advisor');
      if (advSel && state.config.advisors) {
        const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— select adviser —'; advSel.appendChild(ph);
        for (const a of state.config.advisors) {
          const o = document.createElement('option'); o.value = a.name; o.textContent = a.name; advSel.appendChild(o);
        }
        advSel.addEventListener('change', () => { state.advisor = advSel.value; if (state.scenario) refresh(); });
      }
      wireTabs();
      $('crmFile').addEventListener('change', onUpload);
      $('scenario').addEventListener('change', onScenarioChange);
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
