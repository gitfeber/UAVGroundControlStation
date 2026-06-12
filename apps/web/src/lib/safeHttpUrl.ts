/** Allow only http(s) media/map URLs — reject javascript:, data:, and credential URLs. */
export function sanitizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    if (url.username || url.password) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

/** Validate raster tile template URLs without encoding `{z}/{x}/{y}` placeholders. */
export function sanitizeTileTemplateUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return "";
  }
  if (/^(javascript|data|file):/i.test(trimmed)) {
    return "";
  }
  if (/^https?:\/\/[^/]+:[^/]+@/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}
