/** the text typed in a number field, with a decimal comma ("0,5", common in European locales) read as a dot;
 * anything else (expressions such as "min(1,2)") is kept as typed */
export function parseFloatInput(text: string): string {
  const t = text.trim();
  return /^[-+]?\d+,\d+$/.test(t) ? t.replace(",", ".") : t;
}
