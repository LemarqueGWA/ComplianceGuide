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
