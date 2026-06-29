/**
 * plannedActionsBreakdown — "Desglose de actuaciones previstas".
 *
 * Interpreta un mandato (desde "Describir caso" o desde la "Calculadora") y lo
 * descompone en ACTUACIONES JURÍDICAS concretas, valorando cada una por su
 * APORTACIÓN DE VALOR (alta/media/baja) según su naturaleza, no sólo por el
 * tiempo. Sirve para justificar el honorario sugerido.
 *
 * Reglas del módulo (del encargo):
 *  1. No inventar actuaciones desconectadas del mandato.
 *  2. Si la descripción es vaga → desglose PRELIMINAR, confianza baja + pedir info.
 *  3. Las actuaciones se conectan al servicio/subservicio/tareas detectadas.
 *  4. Distinguir tareas jurídicas sustantivas de administrativas.
 *  5. La valoración alta/media/baja se EXPLICA siempre.
 *  6. No clasificar como "alta" todo lo que haga un abogado (default = media).
 *  7. El desglose ayuda a justificar el honorario.
 *  8. Las horas por actuación suman de forma coherente con el total.
 *  9. Si las horas no cuadran → warning.
 *
 * 100% local, sin dependencias. La verdad de horas/honorarios viene del
 * caseEstimator/feeCalculator; aquí sólo se REPARTE y se EXPLICA.
 */

import { breakdownsRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import { BASE_HOURLY_RATE } from '../backend/config/factors.ts';
import { VALUE_LABELS } from '../backend/models/index.ts';
import type {
  PlannedAction, PlannedActionBreakdown, ValueLevel, ValueDistribution,
  ResponsibleProfile, BreakdownSourceType, ComplexityLevel, UrgencyLevel, ConfidenceLevel,
} from '../backend/models/index.ts';

// ---------------------------------------------------------------------------
// Entrada del generador
// ---------------------------------------------------------------------------

export interface BreakdownInput {
  case_or_calculation_id?: string | null;
  source_type: BreakdownSourceType;
  description?: string | null;
  service_category: string;
  service_subcategory?: string | null;
  tasks?: string[] | null;
  estimated_total_hours?: number | null;
  estimated_total_fee?: number | null;
  currency?: string | null;
  rate_used?: number | null;
  complexity_level?: ComplexityLevel | null;
  urgency_level?: UrgencyLevel | null;
  comparable_records?: string[] | null;
}

// ---------------------------------------------------------------------------
// Utilidades numéricas y de texto
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
/** Redondea a 0,5 h. */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function capitalize(s: string): string {
  const t = (s || '').trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Reglas de clasificación por APORTACIÓN DE VALOR (ordenadas: lo más
// específico/alto primero). Cada regla aporta nivel + concepto + motivo +
// entregable + perfil sugerido. Si nada casa → DEFAULT (media).
// ---------------------------------------------------------------------------

interface ConceptRule {
  level: ValueLevel;
  concept: string;
  patterns: string[];           // ya normalizados (sin acentos, minúsculas)
  reason: string;
  deliverable: string;
  profile: ResponsibleProfile;
}

const CONCEPT_RULES: ConceptRule[] = [
  // --- ALTA aportación ---
  {
    level: 'high', concept: 'estrategia',
    patterns: ['estrategia', 'estrategic', 'diseno de estrategia'],
    reason: 'Diseño de la estrategia jurídica: define el rumbo del mandato y condiciona el resultado.',
    deliverable: 'Nota de estrategia jurídica', profile: 'socio',
  },
  {
    level: 'high', concept: 'negociacion',
    patterns: ['negociac', 'negociar', 'reunion de negociacion'],
    reason: 'Negociación de cláusulas o condiciones críticas frente a la contraparte.',
    deliverable: 'Acuerdo / acta de negociación', profile: 'socio',
  },
  {
    level: 'high', concept: 'riesgos',
    patterns: ['analisis de riesgo', 'riesgos relevantes', 'riesgo', 'contingencia', 'contingencias'],
    reason: 'Análisis de riesgos y contingencias materiales del mandato.',
    deliverable: 'Informe de riesgos', profile: 'asociado senior',
  },
  {
    level: 'high', concept: 'regulatorio',
    patterns: ['impacto regulatorio', 'regulatori', 'cumplimiento normativo'],
    reason: 'Revisión del impacto regulatorio aplicable.',
    deliverable: 'Memorando regulatorio', profile: 'asociado senior',
  },
  {
    level: 'high', concept: 'due_diligence',
    patterns: ['due diligence', 'auditoria legal', 'revision legal de la sociedad'],
    reason: 'Due diligence: análisis sustantivo de contingencias.',
    deliverable: 'Informe de due diligence', profile: 'asociado senior',
  },
  {
    level: 'high', concept: 'redaccion',
    patterns: ['redacc', 'redactar', 'minuta', 'elaboracion del contrato', 'term sheet', 'pacto de socios'],
    reason: 'Redacción de los documentos jurídicos principales del mandato.',
    deliverable: 'Documento jurídico redactado', profile: 'asociado senior',
  },
  {
    level: 'high', concept: 'dictamen',
    patterns: ['dictamen', 'informe juridico', 'opinion legal', 'memorandum', 'informe'],
    reason: 'Preparación de un informe / dictamen jurídico sustantivo.',
    deliverable: 'Dictamen jurídico', profile: 'asociado senior',
  },
  {
    level: 'high', concept: 'defensa',
    patterns: ['demanda', 'contestacion', 'recurso', 'querella', 'defensa', 'juicio', 'vista', 'audiencia', 'alegaciones', 'medidas cautelares'],
    reason: 'Defensa y posicionamiento procesal frente a la contraparte.',
    deliverable: 'Escrito procesal', profile: 'socio',
  },
  {
    level: 'high', concept: 'decision',
    patterns: ['toma de decision', 'decision juridica', 'estructuracion', 'estructura de la operacion'],
    reason: 'Toma de decisiones jurídicas complejas / estructuración.',
    deliverable: 'Recomendación estructurada', profile: 'socio',
  },
  // --- MEDIA aportación ---
  {
    level: 'medium', concept: 'revision',
    patterns: ['revision documental', 'revision de documento', 'revisar documenta', 'revision de contrato', 'revisar el contrato', 'revision de borrador', 'revision'],
    reason: 'Revisión documental estándar.',
    deliverable: 'Documento revisado con comentarios', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'comentarios',
    patterns: ['comentarios', 'comentar', 'marcar cambios'],
    reason: 'Comentarios sobre borradores.',
    deliverable: 'Borrador comentado', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'checklist',
    patterns: ['checklist', 'lista de comprobacion'],
    reason: 'Preparación de checklist.',
    deliverable: 'Checklist', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'coordinacion',
    patterns: ['coordinacion', 'coordinar', 'interlocucion', 'reunion con el cliente', 'reunion', 'llamada con el cliente'],
    reason: 'Coordinación e interlocución con el cliente.',
    deliverable: 'Seguimiento de coordinación', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'recopilacion',
    patterns: ['recopilacion', 'recopilar', 'organizar informacion', 'organizacion de informacion', 'solicitud de informacion'],
    reason: 'Recopilación y organización de información.',
    deliverable: 'Información organizada', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'antecedentes',
    patterns: ['antecedentes', 'analisis preliminar', 'revision preliminar'],
    reason: 'Análisis preliminar de antecedentes.',
    deliverable: 'Nota de antecedentes', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'cronograma',
    patterns: ['cronograma', 'calendario de trabajo', 'plan de trabajo', 'planificacion'],
    reason: 'Preparación de cronograma de trabajo.',
    deliverable: 'Cronograma', profile: 'asociado',
  },
  {
    level: 'medium', concept: 'seguimiento',
    patterns: ['seguimiento de cambios', 'control de cambios', 'version revisada', 'entregar version', 'seguimiento procesal', 'seguimiento'],
    reason: 'Seguimiento de cambios y del estado del trabajo.',
    deliverable: 'Estado actualizado', profile: 'asociado',
  },
  // --- BAJA aportación ---
  {
    level: 'low', concept: 'administrativo',
    patterns: ['administrativ', 'gestion administrativa', 'tramite', 'gestiones'],
    reason: 'Tarea administrativa, sin contenido jurídico sustantivo.',
    deliverable: 'Gestión interna', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'formateo',
    patterns: ['formateo', 'formatear', 'formato del documento', 'maquetacion'],
    reason: 'Formateo / maquetación de documentos.',
    deliverable: 'Documento formateado', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'comunicaciones',
    patterns: ['envio de comunicaciones', 'enviar correo', 'envio de email', 'comunicacion simple', 'remitir'],
    reason: 'Envío de comunicaciones simples.',
    deliverable: 'Comunicación enviada', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'anexos',
    patterns: ['anexos', 'adjuntar anexos', 'organizacion de anexos'],
    reason: 'Organización de anexos.',
    deliverable: 'Anexos organizados', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'carga',
    patterns: ['carga de documentos', 'subir documentos', 'cargar archivos', 'escaneo', 'escanear'],
    reason: 'Carga / escaneo de documentos.',
    deliverable: 'Documentos cargados', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'revision_formal',
    patterns: ['revision formal', 'revision no sustantiva', 'comprobacion formal'],
    reason: 'Revisión formal no sustantiva.',
    deliverable: 'Verificación formal', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'archivo',
    patterns: ['archivo documental', 'archivar', 'archivo de actas', 'archivo'],
    reason: 'Archivo documental.',
    deliverable: 'Expediente archivado', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'tablas',
    patterns: ['tabla interna', 'actualizacion de tablas', 'actualizar tabla'],
    reason: 'Actualización de tablas internas.',
    deliverable: 'Tabla interna actualizada', profile: 'paralegal',
  },
  {
    level: 'low', concept: 'versiones',
    patterns: ['control de versiones'],
    reason: 'Control de versiones no estratégico.',
    deliverable: 'Versionado', profile: 'paralegal',
  },
];

const DEFAULT_RULE: ConceptRule = {
  level: 'medium', concept: 'generico',
  patterns: [],
  reason: 'Actuación jurídica de apoyo; valoración media por defecto (revisable por el equipo).',
  deliverable: 'Entregable interno',
  profile: 'asociado',
};

function classifyAction(text: string): ConceptRule {
  const n = norm(text);
  for (const rule of CONCEPT_RULES) {
    if (rule.patterns.some((p) => n.includes(p))) return rule;
  }
  return DEFAULT_RULE;
}

// ---------------------------------------------------------------------------
// Plantillas por área (actuaciones típicas) — usadas cuando el mandato es vago
// o las tareas detectadas son insuficientes (regla 2). NO son invenciones
// desconectadas: son las fases habituales del área, marcadas como preliminares.
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, string[]> = {
  concursal: [
    'Análisis de la insolvencia y diseño de la estrategia concursal',
    'Redacción de la solicitud de concurso y documentación asociada',
    'Análisis de riesgos y contingencias del concurso',
    'Comunicación y coordinación con la administración concursal',
    'Recopilación y organización de la documentación contable',
    'Gestión administrativa y archivo del expediente',
  ],
  ma: [
    'Diseño de la estructura de la operación y estrategia',
    'Due diligence legal de la sociedad objetivo',
    'Negociación y redacción del SPA y contratos accesorios',
    'Revisión documental del data room',
    'Coordinación con el cliente y otros asesores',
    'Organización del data room y anexos',
  ],
  laboral: [
    'Análisis del caso y estrategia procesal laboral',
    'Redacción de la demanda o carta de despido',
    'Preparación y defensa en el juicio',
    'Recopilación de la documentación laboral',
    'Coordinación con el cliente',
    'Gestión administrativa del expediente',
  ],
  procesal_civil: [
    'Análisis del asunto y estrategia procesal',
    'Redacción de demanda, contestación y escritos',
    'Preparación de la defensa y la vista',
    'Revisión de documentación y antecedentes',
    'Seguimiento procesal y de plazos',
    'Gestión administrativa del expediente',
  ],
  procesal_penal: [
    'Diseño de la estrategia de defensa penal',
    'Redacción de escritos de defensa o querella',
    'Defensa en diligencias y juicio',
    'Análisis de antecedentes e instrucción',
    'Coordinación con el cliente',
    'Gestión administrativa del expediente',
  ],
  contratos: [
    'Análisis del encargo y estrategia contractual',
    'Redacción del contrato principal',
    'Negociación de las cláusulas críticas',
    'Revisión de borradores y comentarios',
    'Coordinación con el cliente',
    'Formateo y control de versiones del documento',
  ],
  compliance: [
    'Análisis de riesgos y diseño del programa de compliance',
    'Redacción de políticas y procedimientos',
    'Revisión del marco regulatorio aplicable',
    'Preparación de checklist de cumplimiento',
    'Coordinación con el cliente',
    'Gestión administrativa y archivo documental',
  ],
  datos: [
    'Análisis de cumplimiento RGPD y estrategia',
    'Redacción de cláusulas, contratos de encargo y políticas',
    'Evaluación de impacto y análisis de riesgos (EIPD)',
    'Revisión documental y checklist de privacidad',
    'Coordinación con el cliente',
    'Gestión administrativa del expediente',
  ],
  regulatorio: [
    'Análisis regulatorio y estrategia',
    'Redacción de solicitudes de autorización y memorandos',
    'Revisión de impacto regulatorio',
    'Recopilación de información y documentación',
    'Coordinación con el supervisor y el cliente',
    'Gestión administrativa del expediente',
  ],
  reestructuraciones: [
    'Análisis financiero-jurídico y estrategia de reestructuración',
    'Negociación con acreedores y diseño del plan',
    'Redacción del plan o acuerdo de refinanciación',
    'Revisión documental de la deuda',
    'Coordinación con asesores y cliente',
    'Gestión administrativa del expediente',
  ],
  startups: [
    'Asesoramiento en la estructura y estrategia de la ronda',
    'Redacción del term sheet y el pacto de socios',
    'Negociación con inversores',
    'Revisión documental y checklist',
    'Coordinación con los fundadores',
    'Gestión administrativa y constitución',
  ],
  energias: [
    'Análisis del proyecto y estrategia',
    'Redacción y negociación del PPA y contratos',
    'Revisión de permisos y autorizaciones',
    'Due diligence del proyecto',
    'Coordinación con el cliente',
    'Gestión administrativa del expediente',
  ],
  secretarias: [
    'Asesoramiento al consejo y estrategia de gobierno',
    'Redacción de actas y acuerdos',
    'Revisión de la documentación del consejo',
    'Coordinación con los consejeros',
    'Gestión administrativa y archivo de actas',
  ],
  default: [
    'Análisis del asunto y definición de la estrategia',
    'Redacción y revisión de los documentos principales',
    'Coordinación e interlocución con el cliente',
    'Recopilación y organización de la información',
    'Gestión administrativa del expediente',
  ],
};

function pickTemplate(category: string): { key: string; titles: string[] } {
  const c = norm(category);
  const map: [string, string][] = [
    ['concursal', 'concursal'],
    ['m&a', 'ma'], ['fusion', 'ma'], ['adquisic', 'ma'], ['due diligence', 'ma'],
    ['laboral', 'laboral'],
    ['penal', 'procesal_penal'],
    ['civil', 'procesal_civil'], ['litig', 'procesal_civil'], ['procesal', 'procesal_civil'], ['arbitraje', 'procesal_civil'],
    ['contrato', 'contratos'], ['mercantil', 'contratos'], ['corporativ', 'contratos'], ['societ', 'contratos'],
    ['compliance', 'compliance'], ['penal economic', 'compliance'],
    ['dato', 'datos'], ['rgpd', 'datos'], ['privacidad', 'datos'],
    ['regulatori', 'regulatorio'], ['financ', 'regulatorio'], ['mica', 'regulatorio'], ['mifid', 'regulatorio'],
    ['reestructur', 'reestructuraciones'], ['refinanc', 'reestructuraciones'],
    ['startup', 'startups'], ['ronda', 'startups'], ['inversion', 'startups'],
    ['energi', 'energias'], ['renovable', 'energias'], ['ppa', 'energias'],
    ['consejo', 'secretarias'], ['secretari', 'secretarias'], ['gobierno corporativo', 'secretarias'],
  ];
  for (const [needle, key] of map) {
    if (c.includes(needle)) return { key, titles: TEMPLATES[key] };
  }
  return { key: 'default', titles: TEMPLATES.default };
}

// ---------------------------------------------------------------------------
// Construcción de actuaciones
// ---------------------------------------------------------------------------

interface DraftAction {
  title: string;
  description: string;
  rule: ConceptRule;
  source: 'task' | 'template' | 'crosscut';
}

function phaseRank(level: ValueLevel, concept: string): number {
  if (level === 'low') return 4;
  if (level === 'medium') return 3;
  // alta: el análisis/estrategia va primero; ejecución después
  if (['estrategia', 'riesgos', 'due_diligence', 'regulatorio', 'antecedentes', 'decision'].includes(concept)) return 1;
  return 2;
}

function actionConfidence(d: DraftAction): ConfidenceLevel {
  if (d.source === 'task') {
    if (d.rule === DEFAULT_RULE) return 'low';
    return d.rule.level === 'high' ? 'high' : 'medium';
  }
  if (d.source === 'crosscut') return 'medium';
  return 'low'; // template (preliminar)
}

/** Quita duplicados de tareas por texto normalizado. */
function dedupeTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const k = norm(t).replace(/\s+/g, ' ').trim();
    if (k.length < 3 || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generador principal (puro, no persiste)
// ---------------------------------------------------------------------------

export function generateBreakdown(input: BreakdownInput): PlannedActionBreakdown {
  const id = newId('brk');
  const currency = input.currency || 'EUR';
  const complexity: ComplexityLevel = input.complexity_level || 'unknown';
  const urgency: UrgencyLevel = input.urgency_level || 'unknown';
  const description = (input.description || '').trim() || null;

  const assumptions: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  // 1) Tareas detectadas -> actuaciones (conectadas al mandato; reglas 1, 3).
  const tasks = dedupeTexts(input.tasks || []);
  const drafts: DraftAction[] = tasks.map((t) => ({
    title: capitalize(t),
    description: t,
    rule: classifyAction(t),
    source: 'task',
  }));

  // ¿Mandato vago? (regla 2)
  const meaningful = (description || '').replace(/\s+/g, ' ').trim();
  const vague = drafts.length < 2 || meaningful.length < 40;

  const { key: templateKey, titles: templateTitles } = pickTemplate(input.service_category);
  let usedTemplate = false;

  if (drafts.length < 2) {
    // Insuficiente: desglose PRELIMINAR con la plantilla del área.
    usedTemplate = true;
    const present = new Set(drafts.map((d) => norm(d.title)));
    for (const title of templateTitles) {
      if (present.has(norm(title))) continue;
      drafts.push({ title, description: title, rule: classifyAction(title), source: 'template' });
    }
    assumptions.push('Desglose PRELIMINAR basado en las actuaciones típicas del área; la descripción no aportaba suficiente detalle para personalizarlo.');
    missing.push('La descripción del mandato es breve: conviene detallar el alcance real para afinar las actuaciones.');
  } else {
    // Suficiente: garantizamos cobertura realista (una media y una baja).
    const hasMedium = drafts.some((d) => d.rule.level === 'medium');
    const hasLow = drafts.some((d) => d.rule.level === 'low');
    if (!hasMedium) {
      drafts.push({
        title: 'Coordinación e interlocución con el cliente',
        description: 'Coordinación e interlocución con el cliente a lo largo del mandato.',
        rule: classifyAction('coordinacion'), source: 'crosscut',
      });
    }
    if (!hasLow) {
      drafts.push({
        title: 'Gestión administrativa del expediente',
        description: 'Gestión administrativa y documental del expediente.',
        rule: classifyAction('gestion administrativa'), source: 'crosscut',
      });
    }
    if (!hasMedium || !hasLow) {
      assumptions.push('Se han añadido actuaciones transversales habituales (coordinación con el cliente y/o gestión administrativa) para reflejar el reparto real de valor.');
    }
  }

  // 2) Ordenar por fase (estrategia/análisis → ejecución → media → baja).
  drafts.sort((a, b) => {
    const ra = phaseRank(a.rule.level, a.rule.concept);
    const rb = phaseRank(b.rule.level, b.rule.concept);
    return ra - rb;
  });

  // 3) Reparto de horas por aportación de valor (peso alta=3, media=2, baja=1).
  const VALUE_WEIGHT: Record<ValueLevel, number> = { high: 3, medium: 2, low: 1 };
  let totalHours = input.estimated_total_hours ?? null;
  const rate = input.rate_used && input.rate_used > 0 ? input.rate_used : BASE_HOURLY_RATE;
  if ((totalHours === null || totalHours <= 0) && input.estimated_total_fee && input.estimated_total_fee > 0) {
    totalHours = roundHalf(input.estimated_total_fee / rate);
  }
  const totalFee = input.estimated_total_fee ?? null;

  const weights = drafts.map((d) => VALUE_WEIGHT[d.rule.level]);
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;

  let recHours: (number | null)[] = drafts.map(() => null);
  if (totalHours !== null && totalHours > 0) {
    recHours = drafts.map((_, i) => Math.max(0.5, roundHalf((totalHours as number) * weights[i] / sumW)));
    // Ajuste de redondeo sobre la actuación de mayor peso para cuadrar el total.
    const diff = round2((totalHours as number) - recHours.reduce((a, b) => a + (b || 0), 0));
    if (Math.abs(diff) >= 0.5) {
      let idxMax = 0;
      for (let i = 1; i < recHours.length; i += 1) if ((recHours[i] || 0) > (recHours[idxMax] || 0)) idxMax = i;
      recHours[idxMax] = Math.max(0.5, roundHalf((recHours[idxMax] || 0) + diff));
    }
  } else {
    missing.push('No hay horas totales estimadas: no se pueden distribuir horas por actuación.');
  }

  // 4) Reparto de honorario proporcional a las horas (o al peso si no hay horas).
  const sumRec = recHours.reduce((a, b) => a + (b || 0), 0);
  let feePortions: (number | null)[] = drafts.map(() => null);
  if (totalFee !== null && totalFee > 0) {
    if (sumRec > 0) {
      feePortions = recHours.map((h) => round2((totalFee as number) * (h || 0) / sumRec));
    } else {
      feePortions = weights.map((w) => round2((totalFee as number) * w / sumW));
    }
    const diffFee = round2((totalFee as number) - feePortions.reduce((a, b) => a + (b || 0), 0));
    if (Math.abs(diffFee) >= 0.01) {
      let idxMax = 0;
      for (let i = 1; i < feePortions.length; i += 1) if ((feePortions[i] || 0) > (feePortions[idxMax] || 0)) idxMax = i;
      feePortions[idxMax] = round2((feePortions[idxMax] || 0) + diffFee);
    }
  } else {
    missing.push('No hay honorario total estimado: no se puede imputar honorario por actuación.');
  }

  // 5) Materializar las PlannedAction.
  const actions: PlannedAction[] = drafts.map((d, i) => {
    const rec = recHours[i];
    const min = rec !== null ? Math.max(0.5, roundHalf(rec * 0.8)) : null;
    const max = rec !== null ? roundHalf(rec * 1.3) : null;
    const low = d.rule.level === 'low';
    return {
      id: newId('pa'),
      breakdown_id: id,
      action_title: d.title,
      action_description: d.description,
      value_level: d.rule.level,
      value_label: VALUE_LABELS[d.rule.level],
      reason_for_value_level: d.rule.reason,
      estimated_hours_min: min,
      estimated_hours_recommended: rec,
      estimated_hours_max: max,
      related_fee_portion: feePortions[i],
      sequence_order: i + 1,
      depends_on: [],
      deliverable: d.rule.deliverable,
      responsible_profile: d.rule.profile,
      client_visible: !low,
      internal_only: low,
      confidence_level: actionConfidence(d),
    };
  });

  // 6) Coherencia de horas/honorario (reglas 8, 9).
  if (totalHours !== null && totalHours > 0) {
    const sumH = round2(actions.reduce((a, x) => a + (x.estimated_hours_recommended || 0), 0));
    if (Math.abs(sumH - totalHours) > Math.max(0.5, totalHours * 0.02)) {
      warnings.push(`Las horas por actuación (${sumH} h) no cuadran con las horas totales estimadas (${totalHours} h). Revisa el reparto.`);
    }
  }
  if (totalFee !== null && totalFee > 0) {
    const sumF = round2(actions.reduce((a, x) => a + (x.related_fee_portion || 0), 0));
    if (Math.abs(sumF - totalFee) > Math.max(1, totalFee * 0.02)) {
      warnings.push(`El honorario imputado por actuación (${sumF}) no cuadra con el honorario total (${totalFee}). Revisa el reparto.`);
    }
  }
  if (usedTemplate) {
    warnings.push('Desglose preliminar (confianza baja): revísalo y complétalo con el equipo antes de usarlo.');
  }
  if (norm(input.service_category).includes('otros') || !input.service_category) {
    missing.push('El servicio no se ha podido clasificar con certeza: confirma el área para afinar las actuaciones.');
  }

  // Supuestos generales siempre presentes (transparencia).
  assumptions.push('Las horas se han repartido entre las actuaciones de forma proporcional a su aportación de valor; ajústalas al caso real.');
  assumptions.push('Los perfiles responsables son una sugerencia orientativa y deben confirmarse.');

  const value_distribution = countDistribution(actions);
  const subcat = input.service_subcategory || null;
  const mandate_summary = buildMandateSummary(input.service_category, subcat, description, input.source_type);

  return {
    id,
    case_or_calculation_id: input.case_or_calculation_id || null,
    source_type: input.source_type,
    service_category: input.service_category,
    service_subcategory: subcat,
    mandate_summary,
    description,
    planned_actions: actions,
    value_distribution,
    estimated_total_hours: totalHours,
    estimated_total_fee: totalFee,
    currency,
    rate_used: rate,
    complexity_level: complexity,
    urgency_level: urgency,
    assumptions,
    missing_information: missing,
    warnings,
    created_at: nowIso(),
    created_by: 'usuario_interno',
    updated_at: nowIso(),
  };
}

function countDistribution(actions: PlannedAction[]): ValueDistribution {
  return {
    high_value_count: actions.filter((a) => a.value_level === 'high').length,
    medium_value_count: actions.filter((a) => a.value_level === 'medium').length,
    low_value_count: actions.filter((a) => a.value_level === 'low').length,
  };
}

function buildMandateSummary(
  category: string, subcat: string | null, description: string | null, source: BreakdownSourceType,
): string {
  const head = `${category}${subcat ? ' – ' + subcat : ''}`;
  if (description) {
    const short = description.length > 220 ? description.slice(0, 217).trimEnd() + '…' : description;
    return `${head}: ${short}`;
  }
  return source === 'manual_calculation'
    ? `${head}: cálculo manual de honorarios (sin descripción de caso).`
    : `${head}: mandato sin descripción detallada.`;
}

// ---------------------------------------------------------------------------
// Persistencia y CRUD
// ---------------------------------------------------------------------------

export function createBreakdown(input: BreakdownInput, createdBy: string): PlannedActionBreakdown {
  const brk = generateBreakdown(input);
  brk.created_by = createdBy || 'usuario_interno';
  return breakdownsRepo.save(brk);
}

export function getBreakdown(id: string): PlannedActionBreakdown | null {
  return breakdownsRepo.get(id);
}

export function listBreakdowns(): PlannedActionBreakdown[] {
  return breakdownsRepo.list().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function findBreakdownsByCalculation(calcId: string): PlannedActionBreakdown[] {
  return breakdownsRepo.find((b) => b.case_or_calculation_id === calcId);
}

export function deleteBreakdown(id: string): boolean {
  return breakdownsRepo.delete(id);
}

/**
 * Edición por el usuario interno: permite cambiar actuaciones (añadir, eliminar,
 * reordenar, cambiar valoración/horas/perfil), el resumen y los totales objetivo.
 * Recalcula la distribución de valor, el orden y los avisos de coherencia.
 */
export function updateBreakdown(
  id: string,
  patch: Partial<PlannedActionBreakdown>,
): PlannedActionBreakdown | null {
  const current = breakdownsRepo.get(id);
  if (!current) return null;

  const next: PlannedActionBreakdown = { ...current };

  // Campos editables simples.
  if (typeof patch.mandate_summary === 'string') next.mandate_summary = patch.mandate_summary;
  if (typeof patch.service_category === 'string') next.service_category = patch.service_category;
  if (patch.service_subcategory !== undefined) next.service_subcategory = patch.service_subcategory;
  if (patch.estimated_total_hours !== undefined) next.estimated_total_hours = patch.estimated_total_hours;
  if (patch.estimated_total_fee !== undefined) next.estimated_total_fee = patch.estimated_total_fee;
  if (Array.isArray(patch.assumptions)) next.assumptions = patch.assumptions;
  if (Array.isArray(patch.missing_information)) next.missing_information = patch.missing_information;

  // Actuaciones: normaliza, reasigna orden por la posición en el array recibido.
  if (Array.isArray(patch.planned_actions)) {
    next.planned_actions = patch.planned_actions.map((a, i) => normalizeAction(a as Partial<PlannedAction>, id, i + 1));
  }

  // El honorario por actuación es DERIVADO de las horas (la tabla no lo edita):
  // se reparte proporcionalmente para que siga cuadrando con el total.
  redistributeFees(next);

  next.value_distribution = countDistribution(next.planned_actions);
  next.warnings = recomputeWarnings(next);
  next.updated_at = nowIso();
  return breakdownsRepo.save(next);
}

/** Reparte el honorario total entre las actuaciones según sus horas recomendadas. */
function redistributeFees(b: PlannedActionBreakdown): void {
  const totalFee = b.estimated_total_fee;
  if (totalFee === null || totalFee <= 0 || !b.planned_actions.length) {
    b.planned_actions.forEach((a) => { a.related_fee_portion = totalFee === null ? null : a.related_fee_portion; });
    return;
  }
  const sumRec = b.planned_actions.reduce((acc, x) => acc + (x.estimated_hours_recommended || 0), 0);
  if (sumRec <= 0) return;
  b.planned_actions.forEach((a) => {
    a.related_fee_portion = round2(totalFee * (a.estimated_hours_recommended || 0) / sumRec);
  });
  // Ajuste de redondeo sobre la actuación de mayor honorario.
  const diff = round2(totalFee - b.planned_actions.reduce((acc, x) => acc + (x.related_fee_portion || 0), 0));
  if (Math.abs(diff) >= 0.01) {
    let idx = 0;
    for (let i = 1; i < b.planned_actions.length; i += 1) {
      if ((b.planned_actions[i].related_fee_portion || 0) > (b.planned_actions[idx].related_fee_portion || 0)) idx = i;
    }
    b.planned_actions[idx].related_fee_portion = round2((b.planned_actions[idx].related_fee_portion || 0) + diff);
  }
}

/** Saneo de una actuación entrante (añadida o editada por el usuario). */
function normalizeAction(a: Partial<PlannedAction>, breakdownId: string, order: number): PlannedAction {
  const level: ValueLevel = a.value_level === 'high' || a.value_level === 'low' ? a.value_level : (a.value_level === 'medium' ? 'medium' : 'medium');
  const profileOk: ResponsibleProfile = ([
    'socio', 'asociado senior', 'asociado', 'junior', 'paralegal', 'equipo mixto', 'no determinado',
  ] as ResponsibleProfile[]).includes(a.responsible_profile as ResponsibleProfile)
    ? (a.responsible_profile as ResponsibleProfile) : 'no determinado';
  const rec = numOrNull(a.estimated_hours_recommended);
  const min = numOrNull(a.estimated_hours_min);
  const max = numOrNull(a.estimated_hours_max);
  const hasId = typeof a.id === 'string' && a.id.startsWith('pa_');
  const low = level === 'low';
  return {
    id: hasId ? (a.id as string) : newId('pa'),
    breakdown_id: breakdownId,
    action_title: (a.action_title || 'Actuación').toString(),
    action_description: (a.action_description || '').toString(),
    value_level: level,
    value_label: VALUE_LABELS[level],
    reason_for_value_level: (a.reason_for_value_level || '').toString(),
    estimated_hours_min: min,
    estimated_hours_recommended: rec,
    estimated_hours_max: max,
    related_fee_portion: numOrNull(a.related_fee_portion),
    sequence_order: order,
    depends_on: Array.isArray(a.depends_on) ? a.depends_on.filter((x) => typeof x === 'string') : [],
    deliverable: (a.deliverable || '').toString(),
    responsible_profile: profileOk,
    client_visible: typeof a.client_visible === 'boolean' ? a.client_visible : !low,
    internal_only: typeof a.internal_only === 'boolean' ? a.internal_only : low,
    confidence_level: a.confidence_level === 'high' || a.confidence_level === 'low' ? a.confidence_level : 'medium',
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Recalcula sólo los avisos de coherencia tras una edición (regla 9). */
function recomputeWarnings(b: PlannedActionBreakdown): string[] {
  const kept = (b.warnings || []).filter((w) => !w.startsWith('Las horas por actuación') && !w.startsWith('El honorario imputado'));
  const out = [...kept];
  if (b.estimated_total_hours !== null && b.estimated_total_hours > 0) {
    const sumH = round2(b.planned_actions.reduce((a, x) => a + (x.estimated_hours_recommended || 0), 0));
    if (Math.abs(sumH - b.estimated_total_hours) > Math.max(0.5, b.estimated_total_hours * 0.02)) {
      out.push(`Las horas por actuación (${sumH} h) no cuadran con las horas totales estimadas (${b.estimated_total_hours} h). Revisa el reparto.`);
    }
  }
  if (b.estimated_total_fee !== null && b.estimated_total_fee > 0) {
    const sumF = round2(b.planned_actions.reduce((a, x) => a + (x.related_fee_portion || 0), 0));
    if (Math.abs(sumF - b.estimated_total_fee) > Math.max(1, b.estimated_total_fee * 0.02)) {
      out.push(`El honorario imputado por actuación (${sumF}) no cuadra con el honorario total (${b.estimated_total_fee}). Revisa el reparto.`);
    }
  }
  return out;
}
