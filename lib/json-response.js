export function extractJson(text) {
  let t = String(text || '').replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('No JSON in response');
  let body = t.slice(start, end + 1);

  try { return JSON.parse(body); } catch {}

  let repaired = body
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,(\s*[\]}])/g, '$1');
  try { return JSON.parse(repaired); } catch {}

  repaired = repaired.replace(/"((?:[^"\\]|\\.)*?)"/gs, (m, inner) => {
    return '"' + inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  });
  return JSON.parse(repaired);
}
