import JSZip from 'jszip';

export function gwaFilename(docType, clientRef, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const ref = clientRef || 'UNREF';
  return `GWA_${docType}_${ref}_v1.0_${y}${m}${d}.pdf`;
}

/** buildBundle(files) → zip bytes (Uint8Array). files = [{ name, bytes }]. */
export async function buildBundle(files) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return zip.generateAsync({ type: 'uint8array' });
}
