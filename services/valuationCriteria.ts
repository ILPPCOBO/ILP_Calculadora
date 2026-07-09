/**
 * valuationCriteria — catálogo de CRITERIOS DE VALORACIÓN por materia.
 *
 * Captura, en forma estructurada y reutilizable, los criterios de honorarios que
 * describen las propuestas del despacho cuando NO se reducen a "horas × tarifa"
 * (encargos por fases, fijos por actuación, comisiones de éxito no dinerarias,
 * provisiones de fondos, ponderaciones por naturaleza de la acción, etc.).
 *
 * La herramienta los ADJUNTA y MUESTRA en la estimación de la materia detectada;
 * NO reescriben el motor de cálculo por horas (que sigue produciendo el rango
 * numérico). Sirven para justificar y encuadrar el honorario (Reglas 1, 9, 10, 18).
 *
 * Fuente canónica de cada entrada: un documento versionado en docs/propuestas/.
 * Regla 12: los importes son REFERENCIAS de propuestas reales anonimizadas, no
 * precios obligatorios; nunca se inventan.
 *
 * Función pura: no persiste nada.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Modelo económico de un concepto de honorario. */
export type FeeModel = 'fijo' | 'fijo_por_actuacion' | 'exito' | 'porcentaje' | 'iguala' | 'a_cuenta';

/** Un concepto del cuadro de honorarios de referencia de la materia. */
export interface ReferenceFeeItem {
  /** Fase o bloque al que pertenece (para agrupar). */
  phase: string;
  /** Descripción del concepto retribuido. */
  concept: string;
  /** Modelo económico del concepto. */
  model: FeeModel;
  /** Importe de referencia en la moneda del sistema, o null si es porcentaje/variable. */
  amount: number | null;
  /** Porcentaje de referencia (p. ej. 60 para "60% a cuenta"), o null. */
  percentage?: number | null;
  /** Unidad legible del importe: "€", "€/actuación", "%"… */
  unit: string;
  /** true si el importe se expresa "más IVA". */
  vat_excluded: boolean;
  /** Aclaración adicional del concepto (devengo, condiciones…). */
  note?: string;
}

/** Un criterio cualitativo de valoración de la materia. */
export interface ValuationCriterion {
  key: string;
  label: string;
  detail: string;
}

/** Criterios de valoración de una materia (categoría + subcategoría). */
export interface MatterValuationCriteria {
  service_category: string;
  service_subcategory: string;
  title: string;
  summary: string;
  /** Ruta del documento de referencia versionado. */
  source: string;
  /** Criterios cualitativos que introduce la materia. */
  criteria: ValuationCriterion[];
  /** Cuadro de honorarios de referencia (Regla 12: orientativo). */
  reference_fees: ReferenceFeeItem[];
  /** Base jurídica del asunto (para contexto y trazabilidad). */
  legal_basis: string[];
  /** Notas de aplicación (gastos, impuestos, responsabilidad…). */
  notes: string[];
  /** Palabras clave (normalizadas) que disparan la materia desde una descripción. */
  match_keywords: string[];
}

// ---------------------------------------------------------------------------
// Utilidad de normalización (misma que el resto de módulos)
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------------------
// Catálogo de criterios por materia
// ---------------------------------------------------------------------------

export const MATTER_CRITERIA: MatterValuationCriteria[] = [
  {
    service_category: 'Asesoramiento corporativo',
    service_subcategory: 'Conflictos Societarios',
    title: 'Conflictos societarios — defensa de la minoría',
    summary:
      'Defensa de socios minoritarios frente a la gestión del socio mayoritario y administrador '
      + 'único: (1) análisis y opinión legal sobre retribución del administrador, convocatoria y '
      + 'quórum de juntas, y dividendos/reservas y abuso de la mayoría; y (2) actuación negociadora '
      + 'extrajudicial (MASC) y judicial para alcanzar un acuerdo estable de gobernanza.',
    source: 'docs/propuestas/conflictos-societarios.md',
    criteria: [
      {
        key: 'encargo_por_fases',
        label: 'Encargo por fases con honorario autónomo',
        detail:
          'Se estructura en dos fases con tratamiento económico independiente: análisis y opinión '
          + 'legal (fase 1) y negociación extrajudicial + judicial (fase 2). La aceptación de la '
          + 'fase 1 no obliga a continuar con la fase 2.',
      },
      {
        key: 'fijo_por_actuacion',
        label: 'Fijo por actuación procesal (escala con el número de acciones)',
        detail:
          'La fase 2 retribuye con importes fijos por hito: inicio del MASC, y una cantidad fija '
          + 'por cada demanda o por cada querella efectivamente interpuesta (previa autorización '
          + 'expresa del cliente).',
      },
      {
        key: 'ponderacion_penal',
        label: 'Ponderación por naturaleza de la acción (penal > civil/mercantil)',
        detail:
          'La vía penal se valora por encima de la civil/mercantil por su mayor responsabilidad y '
          + 'exposición (referencia: 15.000 € por querella frente a 7.000 € por demanda civil/mercantil).',
      },
      {
        key: 'exito_no_dinerario',
        label: 'Comisión de éxito de importe fijo (resultado no dinerario)',
        detail:
          'El resultado perseguido no es una cantidad de dinero sino la firma de un acuerdo de '
          + 'gobernanza; por eso la comisión de éxito no se calcula como porcentaje sobre importe '
          + 'alguno, sino como una cantidad fija que se devenga con la firma del acuerdo, cualquiera '
          + 'que sea su modalidad.',
      },
      {
        key: 'provision_a_cuenta',
        label: 'Provisión de fondos / cantidades a cuenta (60%)',
        detail:
          'A la firma del mandato se percibe el 60% de las cantidades de análisis y de negociación, '
          + 'imputable a cada fase conforme se devengue.',
      },
      {
        key: 'devengo_desistimiento',
        label: 'Devengo en caso de desistimiento',
        detail:
          'Si el cliente desiste una vez iniciado el mandato, únicamente no se devenga la comisión '
          + 'de éxito; el resto de cantidades se consideran devengadas al momento del desistimiento.',
      },
    ],
    reference_fees: [
      { phase: 'Fase 1 — Análisis y opinión legal', concept: 'Revisión documental, análisis jurídico de los tres bloques y opinión legal escrita', model: 'fijo', amount: 10000, unit: '€', vat_excluded: true },
      { phase: 'Fase 2 — Negociación (parte fija)', concept: 'Inicio de la vía extrajudicial (MASC)', model: 'fijo', amount: 2000, unit: '€', vat_excluded: true },
      { phase: 'Fase 2 — Negociación (parte fija)', concept: 'Por cada demanda civil o mercantil', model: 'fijo_por_actuacion', amount: 7000, unit: '€/actuación', vat_excluded: true, note: 'Requiere autorización expresa del cliente.' },
      { phase: 'Fase 2 — Negociación (parte fija)', concept: 'Por cada querella o acción penal', model: 'fijo_por_actuacion', amount: 15000, unit: '€/actuación', vat_excluded: true, note: 'Requiere autorización expresa del cliente.' },
      { phase: 'Fase 2 — Comisión de éxito', concept: 'Firma del acuerdo de gobernanza (resultado no dinerario)', model: 'exito', amount: 10000, unit: '€', vat_excluded: true, note: 'Cantidad fija, no porcentual.' },
      { phase: 'A la firma del mandato', concept: 'Cantidades a cuenta (imputables a cada fase)', model: 'a_cuenta', amount: null, percentage: 60, unit: '%', vat_excluded: false, note: '60% de las cantidades de análisis y de negociación.' },
    ],
    legal_basis: [
      'Retribución del administrador: arts. 217 y 249 LSC; reserva estatutaria y doctrina del vínculo; STS 26/02/2018.',
      'Convocatoria y quórum de Juntas Ordinarias y Extraordinarias (doble régimen estatutario de quórum).',
      'Dividendos, reservas y abuso de la mayoría: art. 348 bis LSC (derecho de separación) y art. 204 LSC (impugnación de acuerdos lesivos).',
    ],
    notes: [
      'Gastos y suplidos (aranceles, tasas, peritos, costes del MASC, desplazamientos) e impuestos se repercuten aparte.',
      'Responsabilidad limitada a los importes efectivamente percibidos.',
      'Importes de referencia de una propuesta real anonimizada: orientativos y revisables (Regla 1).',
    ],
    match_keywords: [
      'socios minoritarios', 'socio minoritario', 'minoria', 'conflicto societario', 'conflictos societarios',
      'socio mayoritario', 'administrador unico', 'abuso de la mayoria', 'abuso de mayoria',
      'retribucion del administrador', 'doctrina del vinculo', '348 bis', 'art 348 bis', 'articulo 348 bis',
      'impugnacion de acuerdos', 'impugnacion de acuerdos sociales', 'acuerdos sociales', 'acuerdo de gobernanza',
      'pacto de socios', 'protocolo de gobernanza', 'reparto de dividendos', 'dotacion de reservas',
      'convocatoria de junta', 'quorum', 'accion social de responsabilidad', 'accion de responsabilidad',
      'junta general', 'proteccion de la minoria', 'derecho de separacion', 'masc',
    ],
  },
];

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

/** ¿Cuántas keywords de la materia aparecen en el texto normalizado? */
function keywordHits(text: string, keywords: string[]): number {
  const n = norm(text);
  let hits = 0;
  for (const kw of keywords) {
    if (n.includes(norm(kw))) hits += 1;
  }
  return hits;
}

/**
 * Devuelve los criterios de valoración aplicables a una materia. Casa por
 * (categoría + subcategoría) exacta, o por señal de la descripción (>= 2 keywords
 * distintas de la materia) cuando la subcategoría aún no se ha fijado. Devuelve
 * null si nada casa (Regla 12: no se fuerza una materia).
 */
export function getValuationCriteria(
  category: string | null | undefined,
  subcategory: string | null | undefined,
  description?: string | null,
): MatterValuationCriteria | null {
  const cat = (category || '').trim();
  const sub = (subcategory || '').trim();

  // 1) Coincidencia exacta categoría + subcategoría.
  const exact = MATTER_CRITERIA.find(
    (m) => m.service_category === cat && m.service_subcategory === sub,
  );
  if (exact) return exact;

  // 2) Señal por descripción (para materias detectadas sin subcategoría fijada).
  const desc = (description || '').trim();
  if (desc) {
    let best: MatterValuationCriteria | null = null;
    let bestHits = 0;
    for (const m of MATTER_CRITERIA) {
      // Si la categoría se conoce y no coincide, no forzamos el salto de área.
      if (cat && cat !== 'unknown' && m.service_category !== cat) continue;
      const hits = keywordHits(desc, m.match_keywords);
      if (hits >= 2 && hits > bestHits) { best = m; bestHits = hits; }
    }
    if (best) return best;
  }

  return null;
}

/** Lista todas las materias con criterios capturados (para UI/documentación). */
export function listMatterCriteria(): MatterValuationCriteria[] {
  return MATTER_CRITERIA;
}
