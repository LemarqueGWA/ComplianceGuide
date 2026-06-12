// In the browser these are fetched; in Node tests they are read from disk.
// Using fs keeps the loader testable without a server.
import { readFile } from 'node:fs/promises';

const TEMPLATES = new URL('../config/templates.json', import.meta.url);
const SCENARIOS = new URL('../config/scenarios.investment.json', import.meta.url);

export async function loadConfig() {
  const [templates, scenarios] = await Promise.all([
    readFile(TEMPLATES, 'utf8').then(JSON.parse),
    readFile(SCENARIOS, 'utf8').then(JSON.parse),
  ]);
  return { templates, scenarios };
}
