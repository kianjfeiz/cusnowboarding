/** A form field as a trimmed string; a missing field reads as empty. */
export function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
