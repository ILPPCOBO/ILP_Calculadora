/**
 * caseEstimator — estima horas y honorarios a partir de una DESCRIPCIÓN en
 * lenguaje natural del caso/propuesta. El usuario NO introduce horas: la
 * herramienta las estima del alcance descrito y de los trabajos históricos
 * aprobados similares.
 *
 * Flujo: descripción → detectar servicio → identificar tareas → buscar trabajos
 * históricos aprobados → estimar horas (mín/rec/máx) → aplicar tarifa base 250 €/h
 * (o personalizada) y factores de complejidad/urgencia/descuento → honorarios.
 *
 * Reglas: honorarios SUGERIDOS (R1); tarifa base 250 (R2); sólo registros
 * approved como comparables, NUNCA inventa (R3/R12); si la descripción es vaga
 * pide más info; si no hay histórico usa fórmula base con confianza baja/media
 * y warning; guarda en historial (R17).
 */

import { loadConfig, BASE_HOURLY_RATE, discountFactor } from '../backend/config/factors.ts';
import { getAreaBaseline } from '../backend/config/areaBaselines.ts';
import { recordsRepo, calculationsRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import { classify } from './serviceClassifier.ts';
import { getValuationCriteria } from './valuationCriteria.ts';
import type { MatterValuationCriteria } from './valuationCriteria.ts';
import type {
  UrgencyLevel, ComplexityLevel, ConfidenceLevel, FeeCalculation,
} from '../backend/models/index.ts';

export interface CaseInput {
  description: string;
  area?: string | null;
  urgency?: UrgencyLevel;
  complexity?: ComplexityLevel;
  hourly_rate?: number | null;
  discount_percentage?: number | null;
  created_by?: string;
}

export interface CaseEstimate {
  needs_more_info: boolean;
  service_detected: string;
  service_subcategory: string | null;
  classification_confidence: ConfidenceLevel;
  scope_summary: string;
  tasks: string[];
  hours_min: number | null;
  hours_recommended: number | null;
  hours_max: number | null;
  fee_min: number | null;
  fee_recommended: number | null;
  fee_max: number | null;
  currency: string;
  rate_used: number;
  used_base_rate: boolean;
  complexity_level: ComplexityLevel;
  urgency_level: UrgencyLevel;
  complexity_factor: number;
  urgency_factor: number;
  discount_factor: number;
  comparable_records: string[];
  missing_info: string[];
  confidence_level: ConfidenceLevel;
  explanation: string;
  warnings: string[];
  /** Criterios de valoración de la materia (fases, fijos por actuación, éxito…), o null. */
  valuation_criteria: MatterValuationCriteria | null;
  calculation_id?: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Verbos de acción habituales en encargos legales (raíz, sin conjugar del todo). */
const ACTION_VERBS = [
  'revis', 'redact', 'prepar', 'analiz', 'particip', 'negoci', 'asist', 'present',
  'elabor', 'entreg', 'comparec', 'recurr', 'contest', 'registr', 'constitu', 'tramit',
  'gestion', 'asesor', 'audit', 'evalu', 'impugn', 'demand', 'defend', 'coordin',
  'dictamin', 'inscrib', 'formaliz', 'estructur', 'due diligence', 'revisión', 'informe',
];

/** Normaliza (minúsculas, sin acentos) para comparar. */
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Identifica las tareas principales partiendo la descripción por conectores y
 * detectando fragmentos con verbos de acción. Si no detecta ninguno, devuelve la
 * descripción recortada como única tarea. No inventa.
 */
export function identifyTasks(description: string): string[] {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const fragments = text
    .split(/[,;.]| y | e | además | así como | luego /i)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  const tasks: string[] = [];
  for (const f of fragments) {
    const nf = norm(f);
    if (ACTION_VERBS.some((v) => nf.includes(v))) {
      const clean = f.replace(/^(y|e|además|también|que|para|de)\s+/i, '').trim();
      if (clean.length >= 3 && !tasks.some((t) => norm(t) === norm(clean))) {
        tasks.push(clean.charAt(0).toUpperCase() + clean.slice(1));
      }
    }
    if (tasks.length >= 8) break;
  }
  if (tasks.length === 0) {
    return [text.length > 140 ? `${text.slice(0, 140)}…` : text];
  }
  return tasks;
}

/** ¿La descripción es demasiado vaga para estimar? (R: pedir más info) */
function isTooVague(description: string): boolean {
  const t = (description ?? '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  return t.length < 25 || words.length < 6;
}

/**
 * Estima horas y honorarios a partir de la descripción. Función PURA (no persiste).
 */
export function estimateCase(input: CaseInput): CaseEstimate {
  const cfg = loadConfig();
  const currency = cfg.currency;
  const complexity: ComplexityLevel = input.complexity ?? 'unknown';
  const urgency: UrgencyLevel = input.urgency ?? 'unknown';
  const cf = cfg.complexity_factor[complexity];
  const uf = cfg.urgency_factor[urgency];
  const df = discountFactor(input.discount_percentage);
  const usedBaseRate = !(typeof input.hourly_rate === 'number' && input.hourly_rate > 0);
  const rateUsed = usedBaseRate ? (cfg.base_hourly_rate ?? BASE_HOURLY_RATE) : (input.hourly_rate as number);

  const baseFields = {
    currency,
    rate_used: rateUsed,
    used_base_rate: usedBaseRate,
    complexity_level: complexity,
    urgency_level: urgency,
    complexity_factor: cf,
    urgency_factor: uf,
    discount_factor: df,
  };

  // ----- Vaguedad: pedir más información antes de calcular -----
  if (isTooVague(input.description)) {
    return {
      needs_more_info: true,
      service_detected: 'unknown',
      service_subcategory: null,
      classification_confidence: 'low',
      scope_summary: '',
      tasks: [],
      hours_min: null, hours_recommended: null, hours_max: null,
      fee_min: null, fee_recommended: null, fee_max: null,
      ...baseFields,
      comparable_records: [],
      missing_info: ['Describe con más detalle el trabajo: tareas concretas, alcance y documentos implicados.'],
      confidence_level: 'low',
      explanation: 'La descripción es demasiado breve para estimar. Añade qué hay que hacer, sobre qué documentos y con qué objetivo.',
      warnings: [],
      valuation_criteria: null,
    };
  }

  // ----- Clasificación del servicio -----
  const manualArea = input.area && input.area !== 'No estoy seguro' && input.area !== 'unknown'
    ? input.area : null;
  const cls = classify({
    service_description: input.description,
    document_text: input.description,
    manual_category: manualArea,
  });
  const serviceDetected = cls.service_category || 'unknown';
  const subcategory = cls.service_subcategory ?? null;

  // ----- Criterios de valoración de la materia (fases, fijos por actuación,
  //       comisión de éxito, provisión…). No alteran el rango numérico por horas:
  //       lo encuadran y justifican (Reglas 1, 9, 10, 18). -----
  const valuationCriteria = getValuationCriteria(serviceDetected, subcategory, input.description);

  // ----- Tareas -----
  const tasks = identifyTasks(input.description);

  // ----- Horas: histórico aprobado del área, o heurística por tareas -----
  const approved = recordsRepo.find(
    (r) => r.review_status === 'approved' && r.service_category === serviceDetected,
  );
  const withHours = approved.filter((r) => typeof r.hours_worked === 'number' && (r.hours_worked as number) > 0);
  const withFee = approved.filter((r) => typeof r.total_fee === 'number' && (r.total_fee as number) > 0);
  const comparable = approved; // comparables del área (aprobados)

  // Prioridad de estimación de horas: (1) horas históricas reales; (2) horas
  // IMPLÍCITAS del precio histórico (sus documentos indican importe, no horas);
  // (3) baseline orientativo del área. NUNCA un fijo de 4 h.
  let hoursMin: number; let hoursRec: number; let hoursMax: number;
  let hoursSource: 'historical_hours' | 'historical_price' | 'baseline';
  if (withHours.length >= 3) {
    const hrs = withHours.map((r) => r.hours_worked as number).sort((a, b) => a - b);
    hoursMin = round1(percentile(hrs, 0.25));
    hoursRec = round1(percentile(hrs, 0.5));
    hoursMax = round1(percentile(hrs, 0.75));
    hoursSource = 'historical_hours';
  } else if (withFee.length >= 3) {
    // El honorario queda anclado al PRECIO histórico del área: horas = precio / tarifa.
    const fees = withFee.map((r) => r.total_fee as number).sort((a, b) => a - b);
    hoursMin = round1(percentile(fees, 0.25) / rateUsed);
    hoursRec = round1(percentile(fees, 0.5) / rateUsed);
    hoursMax = round1(percentile(fees, 0.75) / rateUsed);
    hoursSource = 'historical_price';
  } else {
    const b = getAreaBaseline(serviceDetected);
    hoursMin = b.min; hoursRec = b.rec; hoursMax = b.max;
    hoursSource = 'baseline';
  }
  const usedHistorical = hoursSource === 'historical_hours' || hoursSource === 'historical_price';

  // ----- Honorarios = horas × tarifa × factores -----
  const factor = cf * uf * df;
  const feeRec = round2(hoursRec * rateUsed * factor);
  const feeMin = round2(hoursMin * rateUsed * factor);
  const feeMax = round2(hoursMax * rateUsed * factor);

  // ----- Información faltante (informativa, no inventa) -----
  const missing: string[] = [];
  if (serviceDetected === 'unknown') missing.push('No se identificó el área de servicio con seguridad; revísala manualmente.');
  if (hoursSource === 'baseline') missing.push('Sin trabajos históricos aprobados en esta área: horas estimadas con un supuesto orientativo (ajustable). Aprueba registros del área para afinar.');
  else if (hoursSource === 'historical_price') missing.push('Tus documentos del área registran el precio (cantidad fija), no las horas: la estimación se ancla al precio histórico.');
  if (usedBaseRate) missing.push(`Se usó la tarifa base de ${rateUsed} €/h (no se indicó tarifa personalizada).`);
  if (complexity === 'unknown') missing.push('Complejidad no indicada (se asume media).');
  if (urgency === 'unknown') missing.push('Urgencia no indicada (se asume normal).');

  // ----- Confianza -----
  let confidence: ConfidenceLevel;
  if (hoursSource === 'historical_hours' && cls.confidence_level === 'high') confidence = 'high';
  else if (usedHistorical) confidence = 'medium';
  else confidence = 'low';

  // ----- Warnings -----
  const warnings: string[] = ['Honorario sugerido y revisable, no es un precio final obligatorio (Regla 1).'];
  if (hoursSource === 'baseline') {
    warnings.push('Horas estimadas con un supuesto típico del área (no hay trabajos históricos aprobados). Revisa/ajusta las horas o aprueba registros del área para afinar.');
  } else if (hoursSource === 'historical_price') {
    warnings.push('Honorario anclado al precio histórico de trabajos similares; las "horas" son implícitas (precio ÷ tarifa).');
  }
  if (valuationCriteria) {
    warnings.push(
      `Esta materia ("${valuationCriteria.title}") suele estructurarse por criterios propios `
      + '(fases, fijos por actuación, comisión de éxito, provisión a cuenta), no solo por horas: '
      + 'consulta el cuadro de criterios y honorarios de referencia junto a esta estimación.',
    );
    missing.push('Confirma el alcance real (nº de demandas/querellas, fase contratada) para aplicar el cuadro de honorarios de la materia.');
  }

  // ----- Resumen + explicación -----
  const scopeSummary = `Encargo de ${serviceDetected}${subcategory ? ` / ${subcategory}` : ''}`
    + ` con ${tasks.length} tarea(s) principal(es) identificada(s).`;

  const explanation = [
    `Servicio detectado: ${serviceDetected}${subcategory ? ` / ${subcategory}` : ''} (confianza de clasificación ${cls.confidence_level}).`,
    hoursSource === 'historical_hours'
      ? `Horas a partir de ${withHours.length} trabajo(s) histórico(s) aprobado(s) del área: ${hoursMin}–${hoursMax} h (recomendado ${hoursRec} h).`
      : hoursSource === 'historical_price'
        ? `Honorario anclado al precio histórico de ${withFee.length} trabajo(s) aprobado(s) del área; horas implícitas (precio÷tarifa): ${hoursMin}–${hoursMax} h.`
        : `Horas estimadas con el supuesto típico del área "${serviceDetected}": ${hoursMin}–${hoursMax} h (recomendado ${hoursRec} h), ajustable.`,
    `Tarifa aplicada: ${rateUsed} €/h${usedBaseRate ? ' (tarifa base, Regla 2)' : ' (personalizada)'}.`,
    `Factores: complejidad ${complexity} (×${cf}), urgencia ${urgency} (×${uf})${df !== 1 ? `, descuento (×${round2(df)})` : ''}.`,
    `Honorario recomendado = ${hoursRec} h × ${rateUsed} €/h × ${round2(factor)} = ${feeRec} ${currency}.`,
  ].join(' ');

  return {
    needs_more_info: false,
    service_detected: serviceDetected,
    service_subcategory: subcategory,
    classification_confidence: cls.confidence_level,
    scope_summary: scopeSummary,
    tasks,
    hours_min: hoursMin,
    hours_recommended: hoursRec,
    hours_max: hoursMax,
    fee_min: feeMin,
    fee_recommended: feeRec,
    fee_max: feeMax,
    ...baseFields,
    comparable_records: comparable.map((r) => r.id),
    missing_info: missing,
    confidence_level: confidence,
    explanation,
    warnings,
    valuation_criteria: valuationCriteria,
  };
}

/**
 * Estima y PERSISTE el cálculo en el historial (R17). Si la descripción es vaga,
 * NO guarda (devuelve sin calculation_id).
 */
export function estimateAndSaveCase(input: CaseInput, createdBy: string): CaseEstimate {
  const est = estimateCase(input);
  if (est.needs_more_info) return est;

  const record: FeeCalculation = {
    id: newId('calc'),
    service_category: est.service_detected,
    service_subcategory: est.service_subcategory,
    estimated_hours: est.hours_recommended,
    professional_role: null,
    hourly_rate: est.used_base_rate ? null : est.rate_used,
    base_hourly_rate: BASE_HOURLY_RATE,
    complexity_level: est.complexity_level,
    urgency_level: est.urgency_level,
    fee_type: 'hourly',
    discount_percentage: input.discount_percentage ?? null,
    selected_formula_id: null,
    calculated_min: est.fee_min,
    calculated_recommended: est.fee_recommended,
    calculated_max: est.fee_max,
    currency: est.currency,
    confidence_level: est.confidence_level,
    explanation: `[Describir caso] ${est.scope_summary} ${est.explanation}`,
    comparable_record_ids: est.comparable_records,
    warnings: est.warnings,
    created_at: nowIso(),
    created_by: createdBy,
  };
  calculationsRepo.save(record);
  return { ...est, calculation_id: record.id };
}
