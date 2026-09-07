/**
 * CSV parser
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((f) => f.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (r[idx] || "").trim()));
    return obj;
  });
}

/**
 * Reshapes one raw CSV row-object into the normalized person record the UI renders.
 */
export function normalizeRecord(raw) {
  const nwRaw = raw["net worth"] ?? raw[" net worth "] ?? "";
  const netWorth =
    raw.networth !== undefined
      ? Number(raw.networth)
      : parseFloat(String(nwRaw).replace(/[^0-9.-]/g, "")) || 0;
  return {
    name: raw.name || "",
    photo: raw.photo || "",
    age: raw.age || "",
    country: raw.country || "",
    interest: raw.interest || "",
    netWorth,
    netWorthDisplay: raw.networthdisplay || nwRaw || `$${netWorth.toLocaleString()}`,
  };
}

/**
 * Tile background color per the assignment spec:
 * Red < $100K, Orange $100K–$200K, Green > $200K.
 */
export function colorForNetWorth(v) {
  if (v < 100000) return "#e53935"; // red
  if (v < 200000) return "#fb8c00"; // orange
  return "#43a047"; // green
}
