/**
 * buildWebBundle — regenera los datos embebidos (const DATA = …) de la versión
 * web en un solo archivo (Calculadora-Honorarios-OFFLINE.html) a partir de la
 * base de datos actual, y propaga el resultado a las copias de despliegue
 * (deploy/web/index.html y deploy/cloudflare/src/index.js).
 *
 * Uso:  node admin/buildWebBundle.ts
 *
 * Así, cada vez que se aprueban nuevos acuerdos/propuestas, la versión web
 * (Vercel/Cloudflare) puede actualizarse con un solo comando + git push.
 * Sólo se embeben AGREGADOS por área (percentiles, medianas, conteos): nunca
 * documentos ni nombres de clientes (confidencialidad).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordsRepo, categoriesRepo } from '../backend/storage/index.ts';
import { listReferences } from '../services/referencePricing.ts';
import { CATEGORY_KEYWORDS } from '../services/serviceClassifier.ts';
import { BASE_HOURLY_RATE, DEFAULT_CONFIG } from '../backend/config/factors.ts';
import { AREA_BASELINES, DEFAULT_BASELINE } from '../backend/config/areaBaselines.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Percentil con interpolación lineal — idéntico a services/caseEstimator.ts. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---- est: agregados por área de los registros APROBADOS (misma lógica que caseEstimator)
const approved = recordsRepo.find((r) => r.review_status === 'approved');
const byArea = new Map<string, typeof approved>();
for (const r of approved) {
  const key = r.service_category || 'unknown';
  if (!byArea.has(key)) byArea.set(key, []);
  (byArea.get(key) as typeof approved).push(r);
}
const est: Record<string, unknown> = {};
for (const [area, recs] of byArea) {
  const hrs = recs.filter((r) => typeof r.hours_worked === 'number' && (r.hours_worked as number) > 0)
    .map((r) => r.hours_worked as number).sort((a, b) => a - b);
  const fees = recs.filter((r) => typeof r.total_fee === 'number' && (r.total_fee as number) > 0)
    .map((r) => r.total_fee as number).sort((a, b) => a - b);
  est[area] = {
    nHours: hrs.length,
    hP25: percentile(hrs, 0.25), hMed: percentile(hrs, 0.5), hP75: percentile(hrs, 0.75),
    nFee: fees.length,
    fP25: percentile(fees, 0.25), fMed: percentile(fees, 0.5), fP75: percentile(fees, 0.75),
  };
}

// ---- refs: referencias por área (acuerdos aprobados; SOLO nivel categoría,
//      porque la tabla de la web muestra una fila por área)
const refs = listReferences().filter((r) => r.service_subcategory === null).map((r) => ({
  area: r.service_category,
  model: r.predominant_fee_type,
  n: r.sample_size,
  p25: r.fee_p25, median: r.fee_median, p75: r.fee_p75,
  hourly: r.hourly_rate_median,
})).filter((r) => r.n > 0).sort((a, b) => a.area.localeCompare(b.area, 'es'));

// ---- classifier + categories
const classifier = CATEGORY_KEYWORDS.map((c) => ({
  category: c.category,
  keywords: c.keywords,
  subs: (c.subcategories || []).map((s) => ({ name: s.name, keywords: s.keywords })),
}));
const categories = categoriesRepo.list().filter((c) => c.active !== false)
  .map((c) => ({ name: c.name, subs: c.subcategories }));

const DATA = {
  baseRate: BASE_HOURLY_RATE,
  currency: DEFAULT_CONFIG.currency,
  complexity_factor: DEFAULT_CONFIG.complexity_factor,
  urgency_factor: DEFAULT_CONFIG.urgency_factor,
  baselines: AREA_BASELINES,
  defaultBaseline: DEFAULT_BASELINE,
  est,
  refs,
  classifier,
  categories,
};

// ---- inyección en el HTML fuente + copias de despliegue
const htmlPath = join(ROOT, 'Calculadora-Honorarios-OFFLINE.html');
let html = readFileSync(htmlPath, 'utf8');
const line = `const DATA = ${JSON.stringify(DATA)};`;
const re = /^const DATA = .*;$/m;
if (!re.test(html)) throw new Error('No se encontró la línea "const DATA = …;" en el HTML.');
html = html.replace(re, line);
writeFileSync(htmlPath, html);
writeFileSync(join(ROOT, 'deploy', 'web', 'index.html'), html);

const esc = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const worker = '// Worker de Cloudflare — Calculadora de Honorarios (HTML embebido). npx wrangler deploy\n'
  + 'const HTML = `' + esc + '`;\n'
  + 'export default { async fetch(){ return new Response(HTML,{headers:{"content-type":"text/html; charset=UTF-8","cache-control":"public, max-age=60"}}); } };\n';
writeFileSync(join(ROOT, 'deploy', 'cloudflare', 'src', 'index.js'), worker);

console.log('Bundle regenerado.');
console.log('  Áreas con datos (est):', Object.keys(est).length, '| refs:', refs.length, '| aprobados:', approved.length);
console.log('  Actualizados: Calculadora-Honorarios-OFFLINE.html, deploy/web/index.html, deploy/cloudflare/src/index.js');
