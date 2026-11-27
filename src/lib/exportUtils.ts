/**
 * Shared null-safe text, formatting, and export utilities for EcoIntelligence.
 * Enforces safe string transformations so undefined/null fields never trigger .replace() errors.
 */

/**
 * Returns String(value ?? "") to guarantee any subsequent string methods (.replace, .trim, .toLowerCase, .split)
 * are invoked safely on a string primitive.
 */
export function safeText(value: unknown): string {
  return String(value ?? '');
}

/**
 * Returns the trimmed string or defaultValue if value is null, undefined, or empty string.
 */
export function safeDefault(value: unknown, defaultValue = 'N/A'): string {
  const str = safeText(value).trim();
  return str.length > 0 ? str : defaultValue;
}

/**
 * Creates a sanitized, safe filename slug from any string, city name, or location.
 * Eliminates invalid filename characters and trims redundant underscores.
 */
export function safeFilename(value: unknown, fallback = 'Delhi'): string {
  const text = safeText(value).trim() || fallback;
  return safeText(text)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

/**
 * Properly escapes a CSV field conforming to RFC 4180.
 * Wraps fields in double quotes if they contain quotes, commas, or line breaks, and escapes internal quotes.
 */
export function escapeCsvField(value: unknown): string {
  const str = safeText(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${safeText(str).replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Triggers a client-side file download from a Blob safely.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const safeName = safeFilename(filename, 'export.csv');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
