// Re-export the pdf-lib UMD global (loaded via classic <script>) as ES module bindings,
// so logic modules that `import { ... } from 'pdf-lib'` work unchanged in the browser.
const L = globalThis.PDFLib;
export const PDFDocument = L.PDFDocument;
export const StandardFonts = L.StandardFonts;
export const rgb = L.rgb;
export const degrees = L.degrees;
// Field-type classes + low-level objects used by filler.js (instanceof checks +
// AcroForm tweaks). Must mirror every named import from 'pdf-lib' across js/.
export const PDFName = L.PDFName;
export const PDFBool = L.PDFBool;
export const PDFString = L.PDFString;
export const PDFTextField = L.PDFTextField;
export const PDFCheckBox = L.PDFCheckBox;
export const PDFRadioGroup = L.PDFRadioGroup;
export const PDFSignature = L.PDFSignature;
export const PDFDropdown = L.PDFDropdown;
export const PDFOptionList = L.PDFOptionList;
export default L;
