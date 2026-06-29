/**
 * referencePricing — biblioteca de REFERENCIAS de precios por área/subárea.
 *
 * Analiza los acuerdos históricos (ExtractedWorkRecord) ya APROBADOS y produce un
 * "benchmark" por servicio: tamaño de muestra, rango (mín/P25/mediana/P75/máx),
 * media, tarifa/hora típica, distribución de tipo de fee y trazabilidad a los
 * registros que lo sustentan.
 *
 * Reglas aplicadas:
 *  - R3: SÓLO usa registros con review_status "approved" (los pendientes/rechazados
 *    no cuentan). Así la referencia procede únicamente de datos validados por humano.
 *  - R12: NO inventa. Si no hay acuerdos suficientes, devuelve una referencia vacía
 *    con note "información insuficiente" y confidence "low".
 *  - R13/R14: expone rango y nivel de confianza (según tamaño de muestra).
 *  - R18: `based_on_record_ids` da trazabilidad completa.
 *
 * Es la fuente que la calculadora (services/feeCalculator.ts) adjunta a cada
 * cálculo como contexto histórico, y que alimenta la pantalla "Referencias".
 *
 * Función pura sobre el repositorio: no persiste nada.
 */

import { loadConfig } from '../backend/config/factors.ts';
import { recordsRepo } from '../backend/storage/index.ts';
import type { ConfidenceLevel, ExtractedWorkRecord, FeeType } from '../backend/models/index.ts';

export interface PriceReference {
  service_category: string;
  service_subcategory: string | null;
  currency: string;
  /** Nº de acuerdos aprobados CON importe usados para el rango de honorarios. */
  sample_size: number;
  /** Nº total de acuerdos aprobados del área (con o sin importe). */
  records_considered: number;
  fee_min: number | null;
  fee_p25: number | null;
  fee_median: number | null;
  fee_p75: number | null;
  fee_max: number | null;
  fee_average: number | null;
  /** Nº de acuerdos aprobados con tarifa/hora explícita. */
  hourly_sample_size: number;
  hourly_rate_median: number | null;
  hourly_rate_average: number | null;
  /** Distribución de tipo de fee entre los acuerdos aprobados del área. */
  fee_type_distribution: Partial<Record<FeeType, number>>;
  /** Modelo de honorario PREDOMINANTE del área (mensual/fijo/hora…), o null. */
  predominant_fee_type: FeeType | null;
  based_on_record_ids: string[];
  date_from: string | null;
  date_to: string | null;
  confidence_level: ConfidenceLevel;
  note: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/** Acuerdos aprobados del área. Si hay coincidencia de subcategoría, se acota a ella. */
export function approvedRecordsFor(
  category: string,
  subcategory?: string | null,
): ExtractedWorkRecord[] {
  const inCategory = recordsRepo.find(
    (r) => r.review_status === 'approved' && r.service_category === category,
  );
  if (subcategory) {
    const inSub = inCategory.filter((r) => r.service_subcategory === subcategory);
    if (inSub.length > 0) return inSub;
  }
  return inCategory;
}

function confidenceForSample(n: number): ConfidenceLevel {
  if (n >= 5) return 'high';
  if (n >= 2) return 'medium';
  return 'low';
}

/**
 * Construye la referencia de precios para una categoría (y opcionalmente subcategoría).
 * Si no hay datos aprobados, devuelve una referencia vacía marcada como insuficiente.
 */
export function buildReference(
  category: string,
  subcategory: string | null = null,
): PriceReference {
  const cfg = loadConfig();
  const recs = approvedRecordsFor(category, subcategory);

  const dist: Partial<Record<FeeType, number>> = {};
  for (const r of recs) dist[r.fee_type] = (dist[r.fee_type] ?? 0) + 1;

  // Modelo de honorario predominante (modo), ignorando 'unknown'.
  let predominant: FeeType | null = null;
  let bestCount = 0;
  for (const [ft, n] of Object.entries(dist)) {
    if (ft === 'unknown') continue;
    if ((n as number) > bestCount) { bestCount = n as number; predominant = ft as FeeType; }
  }

  // El rango de honorarios se calcula SOBRE el tipo predominante (no mezcla, p.ej.,
  // igualas mensuales de 750 con precios fijos de 9.000). Si no hay predominante, usa todos.
  const relevant = predominant ? recs.filter((r) => r.fee_type === predominant) : recs;
  const withFee = relevant.filter((r) => typeof r.total_fee === 'number' && (r.total_fee as number) > 0);
  const fees = withFee.map((r) => r.total_fee as number).sort((a, b) => a - b);

  const withRate = recs.filter((r) => typeof r.hourly_rate === 'number' && (r.hourly_rate as number) > 0);
  const rates = withRate.map((r) => r.hourly_rate as number).sort((a, b) => a - b);

  const dates = recs.map((r) => r.date).filter((d): d is string => typeof d === 'string' && d !== '').sort();

  const sample = fees.length;
  const confidence = confidenceForSample(sample);

  const MODEL_LABEL: Partial<Record<FeeType, string>> = {
    monthly: 'iguala mensual', fixed: 'precio fijo', hourly: 'por horas',
    success_fee: 'cuota de éxito', blended: 'mixto',
  };
  const modelTxt = predominant ? (MODEL_LABEL[predominant] ?? predominant) : null;

  let note: string;
  if (recs.length === 0) {
    note = 'Información insuficiente: no hay acuerdos históricos aprobados para esta área.';
  } else if (sample === 0) {
    note = `Hay ${recs.length} acuerdo(s) aprobado(s) del área pero ninguno con importe registrado; no se puede construir un rango de honorarios.`;
  } else {
    const unidad = predominant === 'monthly' ? `${cfg.currency}/mes` : cfg.currency;
    note = `Esta área se factura normalmente por ${modelTxt} (${bestCount} de ${recs.length} acuerdos). `
      + `Referencia de ${sample} acuerdo(s) aprobado(s): P25–P75 `
      + `${round2(percentile(fees, 0.25))}–${round2(percentile(fees, 0.75))} ${unidad}, `
      + `mediana ${round2(percentile(fees, 0.5))} ${unidad}.`;
  }

  return {
    predominant_fee_type: predominant,
    service_category: category,
    service_subcategory: subcategory,
    currency: cfg.currency,
    sample_size: sample,
    records_considered: recs.length,
    fee_min: sample > 0 ? round2(fees[0]) : null,
    fee_p25: sample > 0 ? round2(percentile(fees, 0.25)) : null,
    fee_median: sample > 0 ? round2(percentile(fees, 0.5)) : null,
    fee_p75: sample > 0 ? round2(percentile(fees, 0.75)) : null,
    fee_max: sample > 0 ? round2(fees[fees.length - 1]) : null,
    fee_average: average(fees),
    hourly_sample_size: rates.length,
    hourly_rate_median: rates.length > 0 ? round2(percentile(rates, 0.5)) : null,
    hourly_rate_average: average(rates),
    fee_type_distribution: dist,
    based_on_record_ids: recs.map((r) => r.id),
    date_from: dates.length > 0 ? dates[0] : null,
    date_to: dates.length > 0 ? dates[dates.length - 1] : null,
    confidence_level: confidence,
    note,
  };
}

/**
 * Lista la biblioteca de referencias: una por cada par (categoría, subcategoría)
 * con acuerdos aprobados, más una agregada a nivel de categoría (subcategoría null).
 * Ordenada por categoría y, dentro, por tamaño de muestra descendente.
 */
export function listReferences(): PriceReference[] {
  const approved = recordsRepo.find((r) => r.review_status === 'approved');

  const categories = new Set<string>();
  const pairs = new Set<string>(); // "categoría|||subcategoría"
  for (const r of approved) {
    categories.add(r.service_category);
    if (r.service_subcategory) pairs.add(`${r.service_category}|||${r.service_subcategory}`);
  }

  const refs: PriceReference[] = [];
  for (const cat of categories) refs.push(buildReference(cat, null)); // nivel categoría
  for (const pair of pairs) {
    const [cat, sub] = pair.split('|||');
    refs.push(buildReference(cat, sub));
  }

  return refs.sort((a, b) => {
    if (a.service_category !== b.service_category) {
      return a.service_category.localeCompare(b.service_category);
    }
    // nivel categoría (subcategoría null) primero, luego por muestra desc.
    if (a.service_subcategory === null) return -1;
    if (b.service_subcategory === null) return 1;
    return b.sample_size - a.sample_size;
  });
}
