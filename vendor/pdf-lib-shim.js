// Re-export the pdf-lib UMD global (loaded via classic <script>) as ES module bindings,
// so logic modules that `import { ... } from 'pdf-lib'` work unchanged in the browser.
const L = globalThis.PDFLib;
export const PDFDocument = L.PDFDocument;
export const StandardFonts = L.StandardFonts;
export const rgb = L.rgb;
export const degrees = L.degrees;
export default L;
