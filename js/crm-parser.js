import { LABELS, SECTIONS } from './crm-labels.js';

// Build a quick lookup: for a given section, is this string a known label?
function lookupToken(section, text) {
  const map = LABELS[section];
  return map ? map[text] : undefined;
}

// Any-section label? (used to detect when a "value" is actually the next label)
function isAnyLabel(text) {
  return Object.values(LABELS).some((m) => Object.prototype.hasOwnProperty.call(m, text));
}

/**
 * parseClientInfo(items): pure parser.
 * items = reading-order array of trimmed, non-empty text fragments.
 * Returns a flat object of CRM tokens → values.
 */
export function parseClientInfo(items) {
  const out = {};
  let section = null;
  for (let i = 0; i < items.length; i++) {
    const text = items[i].trim();
    if (text === '') continue;
    if (SECTIONS[text]) { section = SECTIONS[text]; continue; }
    if (!section) continue;

    const token = lookupToken(section, text);
    if (!token) continue;

    // Accumulate consecutive value fragments until the next label / section /
    // blank / end. Handles both single-value fields and multi-line values such
    // as a residential address that the CRM emits as several fragments.
    const parts = [];
    while (i + 1 < items.length) {
      const next = items[i + 1].trim();
      if (next === '' || SECTIONS[next] || isAnyLabel(next)) break;
      parts.push(next);
      i++; // consume this value fragment
    }
    out[token] = parts.join(', ');
  }
  return out;
}

const MONTHS = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

export function formatDate(v) {
  if (!v) return '';
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return v; // leave ISO or unknown formats untouched
  const [, d, mo, y] = m;
  return `${d} ${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
}

function ageFromDob(dobRaw, today) {
  const m = (dobRaw || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const [, d, mo, y] = m;
  const dob = new Date(`${y}-${mo}-${d}`);
  let age = today.getFullYear() - dob.getFullYear();
  const had = today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!had) age--;
  return String(age);
}

/**
 * computeFields(parsed, opts): returns a NEW object with computed/meta fields
 * added and all *_dob / *_date fields normalised to GWA long form.
 * opts = { today: Date, adviser: string }
 */
export function computeFields(parsed, opts = {}) {
  const today = opts.today || new Date();
  const r = { ...parsed };

  // normalise all date-ish fields in place
  for (const k of Object.keys(r)) {
    if (k.endsWith('_dob') || k.endsWith('_date')) r[k] = formatDate(r[k]);
  }

  const ageSrc = parsed.client_dob; // raw dd/mm/yyyy before normalisation
  r.client_full_name = [parsed.client_first_names, parsed.client_surname]
    .filter(Boolean).join(' ');
  r.client_display_name = [parsed.client_initials, parsed.client_surname]
    .filter(Boolean).join(' ');
  r.client_age = ageFromDob(ageSrc, today);

  r.meta_practice_name = 'Global Wealth Advisory (Pty) Ltd';
  r.meta_fsp_number = '49263';
  r.meta_adviser_name = opts.adviser || '';
  r.adviser_name = opts.adviser || '';
  r.meta_date_generated = formatDate(
    `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`
  );
  return r;
}
