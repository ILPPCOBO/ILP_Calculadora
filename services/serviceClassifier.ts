/**
 * serviceClassifier — clasificador heurístico de servicios legales.
 *
 * Asigna a un servicio una `service_category` (y, si es posible, una
 * `service_subcategory`) a partir de palabras clave en español encontradas en:
 *   - service_description (señal principal)
 *   - document_text (texto del documento extraído)
 *   - extracted_data (campos ya extraídos: descripción, categoría, asunto…)
 *
 * Reglas aplicadas:
 *  - R12: NO inventa. Si no hay señal suficiente devuelve service_category
 *    'unknown', subcategory null, confidence 'low' y una razón explicativa.
 *  - R14: confidence_level low | medium | high según la fuerza de la señal.
 *  - R15 / R16: si llega `manual_category` (revisión/ajuste humano) se respeta
 *    con confidence 'high' y se indica en `reason`.
 *  - R18: `reason` explica de forma clara y trazable por qué se clasificó así.
 *
 * NO persiste nada: es una función pura sobre su entrada.
 */

import type { ConfidenceLevel, ExtractedWorkRecord } from '../backend/models/index.ts';

export interface ClassificationResult {
  service_category: string;
  service_subcategory: string | null;
  confidence_level: ConfidenceLevel;
  reason: string;
}

export interface ClassifierInput {
  service_description?: string | null;
  document_text?: string | null;
  extracted_data?: Partial<ExtractedWorkRecord>;
  manual_category?: string | null;
  manual_subcategory?: string | null;
}

// ----------------------------------------------------------------------------
// Catálogo de categorías -> subcategorías (con sus palabras clave en español).
// Reutilizable por otros módulos (semilla de categorías, UI, etc.).
// ----------------------------------------------------------------------------

export interface CategoryDefinition {
  /** Nombre canónico de la categoría. */
  category: string;
  /** Palabras clave a nivel de categoría (señal general). */
  keywords: string[];
  /** Subcategorías sugeridas con sus palabras clave específicas. */
  subcategories: { name: string; keywords: string[] }[];
}

/**
 * Catálogo maestro: categorías del proyecto, sus subcategorías sugeridas y las
 * palabras clave (en minúsculas, sin acentos tras normalizar) que las disparan.
 * Es la fuente de verdad de la heurística y se exporta para reutilización.
 */
export const CATEGORY_KEYWORDS: CategoryDefinition[] = [
  {
    // ILP — DORA, MiCA, MiFID II y supervisión
    category: 'Regulatorio financiero',
    keywords: [
      'regulatorio financiero', 'regulacion financiera', 'dora', 'mica', 'mifid', 'mifid ii',
      'mifid 2', 'criptoactivos', 'criptoactivo', 'cripto', 'esma', 'eba', 'cnmv',
      'banco de espana', 'supervision bancaria', 'entidad de pago', 'entidad de dinero electronico',
      'psd2', 'sandbox', 'folleto', 'emision', 'prospecto', 'tokenizacion', 'token',
      'resiliencia operativa', 'servicios de inversion',
    ],
    subcategories: [
      { name: 'MiFID II', keywords: ['mifid', 'mifid ii', 'mifid 2', 'servicios de inversion', 'empresa de servicios de inversion'] },
      { name: 'MiCA y criptoactivos', keywords: ['mica', 'criptoactivos', 'criptoactivo', 'cripto', 'token', 'stablecoin', 'tokenizacion'] },
      { name: 'DORA y resiliencia operativa', keywords: ['dora', 'resiliencia operativa', 'riesgo tecnologico', 'ciberresiliencia'] },
      { name: 'Supervisión y autorizaciones', keywords: ['autorizacion', 'supervision', 'licencia financiera', 'entidad de pago', 'sandbox', 'psd2'] },
      { name: 'Folletos y emisiones', keywords: ['folleto', 'emision', 'prospecto'] },
    ],
  },
  {
    // ILP — Fusiones, adquisiciones y joint ventures
    category: 'M&A',
    keywords: [
      'm&a', 'fusiones y adquisiciones', 'fusion', 'adquisicion', 'compraventa de empresa',
      'compra de empresa', 'joint venture', 'jv', 'spa', 'share purchase', 'sale and purchase',
      'compra de participaciones', 'compra de acciones', 'data room', 'due diligence', 'carve-out',
      'vendor due diligence', 'integracion post-fusion',
    ],
    subcategories: [
      { name: 'Adquisiciones', keywords: ['adquisicion', 'compra de empresa', 'compraventa de empresa', 'spa', 'share purchase', 'compra de participaciones', 'compra de acciones'] },
      { name: 'Fusiones', keywords: ['fusion', 'fusion por absorcion', 'fusion por creacion'] },
      { name: 'Joint ventures', keywords: ['joint venture', 'jv', 'sociedad conjunta'] },
      { name: 'Due diligence en M&A', keywords: ['due diligence', 'data room', 'diligencia debida', 'vendor due diligence'] },
      { name: 'Acuerdos de inversión', keywords: ['acuerdo de inversion', 'inversion estrategica', 'entrada de inversor'] },
    ],
  },
  {
    // ILP — Gobierno y societario
    category: 'Asesoramiento corporativo',
    keywords: [
      'asesoramiento corporativo', 'corporativo', 'societario', 'gobierno corporativo',
      'mercantil', 'constitucion de sociedad', 'estatutos', 'estatutos sociales',
      'junta general', 'junta de socios', 'ampliacion de capital', 'reduccion de capital',
      'operacion societaria', 'secretaria societaria', 'objeto social', 'organo de administracion',
    ],
    subcategories: [
      { name: 'Gobierno corporativo', keywords: ['gobierno corporativo', 'buen gobierno', 'politica societaria'] },
      { name: 'Operaciones societarias', keywords: ['constitucion de sociedad', 'ampliacion de capital', 'reduccion de capital', 'escision', 'transformacion', 'operacion societaria'] },
      { name: 'Secretaría societaria', keywords: ['secretaria societaria', 'libro de actas', 'certificaciones societarias'] },
      { name: 'Juntas y consejos', keywords: ['junta general', 'junta de socios', 'consejo de administracion'] },
      { name: 'Pactos de socios', keywords: ['pacto de socios', 'acuerdo de socios', 'shareholders agreement'] },
    ],
  },
  {
    // ILP — Cumplimiento normativo y supervisión
    category: 'Compliance',
    keywords: [
      'compliance', 'cumplimiento normativo', 'programa de cumplimiento',
      'codigo de conducta', 'codigo etico', 'canal de denuncias', 'whistleblowing',
      'prevencion de delitos', 'prevencion penal', 'compliance penal', 'modelo de prevencion',
      'anticorrupcion', 'blanqueo de capitales', 'prevencion de blanqueo', 'aml', 'matriz de riesgos',
    ],
    subcategories: [
      { name: 'Prevención penal', keywords: ['prevencion penal', 'compliance penal', 'prevencion de delitos', 'modelo de prevencion'] },
      { name: 'Prevención de blanqueo (AML)', keywords: ['blanqueo de capitales', 'prevencion de blanqueo', 'aml', 'sepblac'] },
      { name: 'Canal de denuncias', keywords: ['canal de denuncias', 'whistleblowing', 'denunciante'] },
      { name: 'Código ético y conducta', keywords: ['codigo de conducta', 'codigo etico'] },
      { name: 'Matriz de riesgos', keywords: ['matriz de riesgos', 'mapa de riesgos', 'evaluacion de riesgos penales'] },
    ],
  },
  {
    // ILP — Concurso y pre-concurso
    category: 'Concursal',
    keywords: [
      'concursal', 'concurso', 'concurso de acreedores', 'preconcurso', 'pre-concurso',
      'insolvencia', 'administracion concursal', 'calificacion concursal', 'reintegracion',
      'masa activa', 'masa pasiva', 'convenio concursal', 'liquidacion concursal', 'comunicacion 5 bis',
    ],
    subcategories: [
      { name: 'Pre-concurso', keywords: ['preconcurso', 'pre-concurso', 'comunicacion 5 bis'] },
      { name: 'Concurso de acreedores', keywords: ['concurso de acreedores', 'concurso', 'administracion concursal'] },
      { name: 'Calificación concursal', keywords: ['calificacion concursal', 'concurso culpable'] },
      { name: 'Acciones de reintegración', keywords: ['reintegracion', 'accion rescisoria'] },
    ],
  },
  {
    // ILP — Financiera y operativa
    category: 'Reestructuraciones',
    keywords: [
      'reestructuracion', 'reestructuraciones', 'refinanciacion', 'plan de reestructuracion',
      'restructuring', 'quita', 'espera', 'homologacion', 'reestructuracion de deuda',
      'reestructuracion financiera', 'reestructuracion operativa', 'workout',
    ],
    subcategories: [
      { name: 'Reestructuración financiera', keywords: ['reestructuracion financiera', 'refinanciacion'] },
      { name: 'Planes de reestructuración', keywords: ['plan de reestructuracion', 'homologacion'] },
      { name: 'Refinanciación de deuda', keywords: ['refinanciacion de deuda', 'reestructuracion de deuda', 'quita', 'espera'] },
      { name: 'Reestructuración operativa', keywords: ['reestructuracion operativa', 'workout'] },
    ],
  },
  {
    // ILP — Rondas y pactos de socios
    category: 'Startups',
    keywords: [
      'startup', 'startups', 'ronda', 'ronda de financiacion', 'seed', 'serie a', 'serie b',
      'pacto de socios', 'term sheet', 'hoja de terminos', 'stock options', 'esop', 'phantom',
      'venture', 'venture capital', 'vesting', 'nota convertible', 'safe', 'cap table', 'scaleup',
    ],
    subcategories: [
      { name: 'Rondas de financiación', keywords: ['ronda', 'ronda de financiacion', 'seed', 'serie a', 'serie b', 'nota convertible', 'safe'] },
      { name: 'Pactos de socios', keywords: ['pacto de socios', 'acuerdo de socios', 'shareholders agreement'] },
      { name: 'Stock options / ESOP', keywords: ['stock options', 'esop', 'phantom', 'vesting'] },
      { name: 'Constitución de startup', keywords: ['constitucion de startup', 'incorporacion de startup'] },
      { name: 'Term sheets', keywords: ['term sheet', 'hoja de terminos'] },
    ],
  },
  {
    // ILP — Renovables y PPA
    category: 'Energías renovables',
    keywords: [
      'energia renovable', 'energias renovables', 'renovables', 'ppa', 'power purchase',
      'fotovoltaica', 'eolica', 'planta solar', 'parque eolico', 'autoconsumo', 'permitting',
      'hibridacion', 'almacenamiento', 'punto de conexion', 'biogas', 'hidrogeno verde',
    ],
    subcategories: [
      { name: 'PPA', keywords: ['ppa', 'power purchase', 'compraventa de energia'] },
      { name: 'Desarrollo de proyectos', keywords: ['desarrollo de proyecto', 'planta solar', 'parque eolico', 'fotovoltaica', 'eolica', 'autoconsumo'] },
      { name: 'Permitting y autorizaciones', keywords: ['permitting', 'autorizacion administrativa', 'punto de conexion', 'declaracion de impacto ambiental'] },
      { name: 'M&A renovables', keywords: ['adquisicion de planta', 'compraventa de proyecto renovable'] },
    ],
  },
  {
    // ILP — Litigación y arbitraje
    category: 'Procesal civil',
    keywords: [
      'procesal civil', 'litigio civil', 'litigacion', 'demanda', 'demandar', 'contencioso',
      'pleito', 'juicio', 'reclamacion de cantidad', 'reclamacion judicial', 'recurso', 'apelacion',
      'casacion', 'arbitraje', 'mediacion', 'medidas cautelares', 'ejecucion', 'monitorio',
      'responsabilidad civil', 'incumplimiento contractual', 'tribunal', 'juzgado', 'laudo',
    ],
    subcategories: [
      { name: 'Litigación civil', keywords: ['litigio civil', 'demanda civil', 'responsabilidad civil', 'incumplimiento contractual'] },
      { name: 'Arbitraje', keywords: ['arbitraje', 'laudo', 'corte de arbitraje'] },
      { name: 'Reclamación de cantidad', keywords: ['reclamacion de cantidad', 'impago', 'reclamacion de deuda'] },
      { name: 'Medidas cautelares', keywords: ['medidas cautelares', 'embargo preventivo'] },
      { name: 'Ejecuciones', keywords: ['ejecucion', 'ejecucion de sentencia', 'monitorio'] },
    ],
  },
  {
    // ILP — Defensa penal económica
    category: 'Procesal penal',
    keywords: [
      'procesal penal', 'penal economico', 'defensa penal', 'delito societario', 'querella',
      'diligencias previas', 'investigacion interna', 'delito fiscal', 'administracion desleal',
      'apropiacion indebida', 'estafa', 'corrupcion', 'forensic', 'imputado', 'investigado',
    ],
    subcategories: [
      { name: 'Defensa penal económica', keywords: ['defensa penal', 'penal economico', 'delito economico'] },
      { name: 'Delitos societarios', keywords: ['delito societario', 'administracion desleal', 'apropiacion indebida'] },
      { name: 'Investigaciones internas', keywords: ['investigacion interna', 'forensic'] },
      { name: 'Diligencias previas', keywords: ['diligencias previas', 'querella', 'denuncia penal'] },
    ],
  },
  {
    // ILP — RGPD y LOPDGDD
    category: 'Protección de datos',
    keywords: [
      'proteccion de datos', 'datos personales', 'rgpd', 'gdpr', 'lopd', 'lopdgdd',
      'privacidad', 'tratamiento de datos', 'responsable del tratamiento', 'encargado del tratamiento',
      'aepd', 'brecha de seguridad', 'brecha de datos', 'derechos arco', 'consentimiento',
      'politica de privacidad', 'dpo', 'delegado de proteccion de datos', 'eipd', 'dpia',
    ],
    subcategories: [
      { name: 'RGPD y LOPDGDD', keywords: ['rgpd', 'gdpr', 'lopd', 'lopdgdd', 'adaptacion a normativa', 'adaptacion rgpd'] },
      { name: 'Evaluaciones de impacto (EIPD)', keywords: ['eipd', 'evaluacion de impacto', 'dpia'] },
      { name: 'Delegado de protección de datos (DPO)', keywords: ['dpo', 'delegado de proteccion de datos'] },
      { name: 'Brechas de seguridad', keywords: ['brecha de seguridad', 'brecha de datos', 'notificacion de brecha'] },
      { name: 'Auditoría de privacidad', keywords: ['auditoria de privacidad', 'auditoria rgpd'] },
    ],
  },
  {
    // ILP — Asesoría a consejos de administración
    category: 'Secretarías de consejo',
    keywords: [
      'secretaria del consejo', 'secretarias de consejo', 'secretario del consejo', 'vicesecretario',
      'consejo de administracion', 'actas del consejo', 'acuerdos del consejo', 'gobierno del consejo',
      'asesoramiento al consejo', 'libro de actas', 'comision de auditoria', 'comision de nombramientos',
    ],
    subcategories: [
      { name: 'Secretaría del consejo', keywords: ['secretaria del consejo', 'secretario del consejo', 'vicesecretario'] },
      { name: 'Actas y acuerdos', keywords: ['actas del consejo', 'acuerdos del consejo', 'libro de actas'] },
      { name: 'Asesoramiento a consejeros', keywords: ['asesoramiento al consejo', 'deberes del consejero', 'responsabilidad del consejero'] },
      { name: 'Gobierno del consejo', keywords: ['gobierno del consejo', 'comision de auditoria', 'comision de nombramientos'] },
    ],
  },
  {
    // Detectado en los documentos reales del despacho (igualas y procedimientos laborales).
    category: 'Laboral',
    keywords: [
      'laboral', 'derecho del trabajo', 'despido', 'despido objetivo', 'despido disciplinario',
      'finiquito', 'erte', 'ere', 'expediente de regulacion', 'contrato de trabajo',
      'seguridad social', 'convenio colectivo', 'procedimiento laboral', 'conflicto colectivo',
      'reclamacion de salarios', 'pago de salarios', 'nomina', 'iguala laboral', 'recurrentes laboral',
      'extincion de contrato', 'indemnizacion por despido', 'juzgado de lo social',
    ],
    subcategories: [
      { name: 'Iguala laboral (recurrente)', keywords: ['iguala laboral', 'honorarios recurrentes', 'asesoramiento laboral recurrente', 'recurrentes'] },
      { name: 'Despidos', keywords: ['despido', 'despido objetivo', 'despido disciplinario', 'finiquito', 'extincion de contrato'] },
      { name: 'ERTE / ERE', keywords: ['erte', 'ere', 'expediente de regulacion'] },
      { name: 'Procedimiento laboral', keywords: ['procedimiento laboral', 'juzgado de lo social', 'demanda laboral'] },
      { name: 'Reclamación de salarios', keywords: ['reclamacion de salarios', 'pago de salarios', 'salarios impagados'] },
    ],
  },
  {
    category: 'Otros',
    keywords: [
      'asesoramiento general', 'consulta general', 'asesoria juridica general',
      'otros servicios', 'gestion administrativa',
    ],
    subcategories: [],
  },
];

/**
 * Mapa simple categoría -> subcategorías sugeridas. Útil para sembrar
 * `ServiceCategory.subcategories` y poblar selectores en la UI.
 */
export const SUGGESTED_CATEGORIES: Record<string, string[]> = Object.fromEntries(
  CATEGORY_KEYWORDS.map((c) => [c.category, c.subcategories.map((s) => s.name)]),
);

// ----------------------------------------------------------------------------
// Heurística
// ----------------------------------------------------------------------------

/** Normaliza: minúsculas, sin acentos/diacríticos, con padding de espacios. */
function normalize(text: string): string {
  const lowered = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // elimina diacríticos
    .replace(/\s+/g, ' ');
  // Padding para poder buscar tokens delimitados (' sl ', ' sa ').
  return ` ${lowered} `;
}

/** Escapa los metacaracteres de expresión regular en `s`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cuenta cuántas veces aparece `needle` (ya normalizado) en `haystack` exigiendo
 * LÍMITE DE PALABRA a ambos lados: la keyword sólo cuenta si va precedida por el
 * inicio de la cadena o un carácter no alfanumérico, y seguida por el fin de la
 * cadena o un carácter no alfanumérico. Evita los falsos positivos por subcadena
 * (p.ej. la clave "ere" dentro de "derecho", "mica" dentro de "quimica" o "spa"
 * dentro de "espacio"). Réplica exacta de la versión web (función countOcc) para
 * mantener la paridad app↔web.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, 'g');
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    count += 1;
    // No consumimos el límite posterior: puede servir de límite previo del siguiente.
    re.lastIndex = m.index + m[1].length + needle.length;
  }
  return count;
}

interface CategoryScore {
  category: string;
  score: number;
  matched: string[];
}

/**
 * Construye el texto-señal combinado a partir de description + document_text +
 * campos relevantes de extracted_data (descripción, asunto, categoría previa…).
 * La descripción del servicio pesa más (se duplica) por ser la señal directa.
 */
function buildSignalText(input: ClassifierInput): { weighted: string; hadAnySignal: boolean } {
  const parts: string[] = [];
  let hadAnySignal = false;

  const desc = (input.service_description ?? '').trim();
  if (desc) {
    // La descripción del servicio es la señal más fiable: peso doble.
    parts.push(desc, desc);
    hadAnySignal = true;
  }

  const docText = (input.document_text ?? '').trim();
  if (docText) {
    parts.push(docText);
    hadAnySignal = true;
  }

  const ed = input.extracted_data;
  if (ed) {
    const edFields = [
      ed.service_description,
      ed.matter_name,
      ed.service_subcategory,
      // service_category previa sólo aporta señal si no es 'unknown'.
      ed.service_category && ed.service_category !== 'unknown' ? ed.service_category : null,
      ed.notes,
      ed.extracted_from,
    ];
    for (const f of edFields) {
      if (typeof f === 'string' && f.trim()) {
        parts.push(f.trim());
        hadAnySignal = true;
      }
    }
  }

  return { weighted: normalize(parts.join(' . ')), hadAnySignal };
}

/** Resuelve la mejor subcategoría dentro de una categoría dada. */
function pickSubcategory(def: CategoryDefinition, signal: string): { name: string | null; matched: string[] } {
  let best: { name: string; score: number } | null = null;
  const matched: string[] = [];
  for (const sub of def.subcategories) {
    let score = 0;
    for (const kw of sub.keywords) {
      const occ = countOccurrences(signal, normalizeKeyword(kw));
      if (occ > 0) {
        // peso por longitud: frases largas son más específicas.
        const weight = kw.trim().split(' ').length;
        score += occ * weight;
        matched.push(kw);
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { name: sub.name, score };
    }
  }
  return { name: best ? best.name : null, matched };
}

/** Normaliza una keyword para búsqueda por subcadena (sin padding de bordes salvo tokens cortos). */
function normalizeKeyword(kw: string): string {
  const n = kw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Keywords con espacios internos ya delimitan; para tokens cortos como "sl"/"sa"
  // la keyword se define con espacios (" sl ") y aquí se preserva el borde.
  if (/^\s|\s$/.test(kw)) return ` ${n} `;
  return n;
}

/**
 * Clasifica el servicio combinando todas las señales disponibles.
 */
export function classify(input: ClassifierInput): ClassificationResult {
  // ----- R15/R16: categoría manual tiene prioridad absoluta -----
  const manual = (input.manual_category ?? '').trim();
  if (manual) {
    const sub = (input.manual_subcategory ?? '').trim();
    return {
      service_category: manual,
      service_subcategory: sub ? sub : null,
      confidence_level: 'high',
      reason: sub
        ? `Categoría y subcategoría asignadas manualmente por un usuario interno (revisión humana): "${manual}" / "${sub}".`
        : `Categoría asignada manualmente por un usuario interno (revisión humana): "${manual}".`,
    };
  }

  const { weighted: signal, hadAnySignal } = buildSignalText(input);

  // ----- R11/R12: sin ninguna señal textual -> no inventamos -----
  if (!hadAnySignal || signal.trim() === '') {
    return {
      service_category: 'unknown',
      service_subcategory: null,
      confidence_level: 'low',
      reason: 'No se proporcionó descripción del servicio ni texto del documento; sin señal suficiente para clasificar (no se inventa categoría, regla 12).',
    };
  }

  // ----- Puntuación por categoría -----
  const scores: CategoryScore[] = [];
  for (const def of CATEGORY_KEYWORDS) {
    if (def.category === 'Otros') continue; // 'Otros' no se infiere por keywords genéricas aquí
    let score = 0;
    const matched: string[] = [];
    for (const kw of def.keywords) {
      const occ = countOccurrences(signal, normalizeKeyword(kw));
      if (occ > 0) {
        const weight = kw.trim().split(' ').length; // frases más largas = más peso
        score += occ * weight;
        matched.push(kw);
      }
    }
    if (score > 0) scores.push({ category: def.category, score, matched });
  }

  // ----- R11/R12: ninguna palabra clave coincide -> unknown -----
  if (scores.length === 0) {
    return {
      service_category: 'unknown',
      service_subcategory: null,
      confidence_level: 'low',
      reason: 'El texto analizado no coincide con palabras clave de ninguna categoría conocida; se marca como "unknown" para revisión humana (no se inventa categoría, regla 12).',
    };
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const runnerUp = scores[1];

  const def = CATEGORY_KEYWORDS.find((c) => c.category === top.category)!;
  const subResult = pickSubcategory(def, signal);

  // ----- R14: nivel de confianza según fuerza y separación de la señal -----
  let confidence: ConfidenceLevel;
  const margin = runnerUp ? top.score - runnerUp.score : top.score;
  if (top.score >= 3 && margin >= 2) {
    confidence = 'high';
  } else if (top.score >= 2 || (top.score >= 1 && !runnerUp)) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // ----- R18: razón clara y trazable -----
  const matchedKw = top.matched.slice(0, 5).map((k) => `"${k.trim()}"`).join(', ');
  const reasonParts: string[] = [];
  reasonParts.push(
    `Clasificado como "${top.category}" por coincidencia de palabras clave (${matchedKw}) en la descripción/documento.`,
  );
  if (subResult.name) {
    reasonParts.push(`Subcategoría sugerida "${subResult.name}".`);
  } else {
    reasonParts.push('No se detectó subcategoría específica; queda como null para revisión humana.');
  }
  if (runnerUp) {
    const runnerDef = CATEGORY_KEYWORDS.find((c) => c.category === runnerUp.category);
    reasonParts.push(
      `Otra categoría candidata fue "${runnerUp.category}" (puntuación ${runnerUp.score} frente a ${top.score})${runnerDef ? '' : ''}.`,
    );
  }
  if (confidence === 'low') {
    reasonParts.push('Señal débil: se recomienda revisión humana de la categoría.');
  }

  return {
    service_category: top.category,
    service_subcategory: subResult.name,
    confidence_level: confidence,
    reason: reasonParts.join(' '),
  };
}
