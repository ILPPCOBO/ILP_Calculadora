/**
 * proposalGenerator — "Generar propuesta de honorarios".
 *
 * Ensambla una PROPUESTA profesional en español jurídico a partir de una
 * estimación/cálculo (sus cifras vienen del caseEstimator/feeCalculator) y,
 * opcionalmente, de un desglose de actuaciones. Dos formatos: sencilla (carta,
 * 2–4 pp) y elaborada (dossier, 10+ pp).
 *
 * Reglas del módulo:
 *  - No inventa importes, nombres, plazos ni condiciones (regla 12): lo ausente
 *    se marca con el marcador "[●]" y se lista en `missing_information`.
 *  - Los honorarios son SUGERIDOS y revisables (regla 1); nunca incluyen IVA ni
 *    suplidos salvo indicación expresa (regla 9).
 *  - Diferencia honorarios, gastos, suplidos e impuestos, e incluye servicios
 *    excluidos de forma expresa y un bloque de aceptación y firma.
 *
 * 100% local, sin dependencias. No reimplementa el cálculo: sólo REDACTA.
 */

import { proposalsRepo } from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import type {
  FeeProposal, ProposalKind, ProposalParty, ProposalSection, ConfidenceLevel, ScopePlan,
} from '../backend/models/index.ts';

/** Marcador de dato ausente (regla 12: no se inventa). */
const PH = '[●]';

/**
 * Marcadores NOMINALES de los datos de la propuesta: se sustituyen
 * automáticamente por los valores introducidos en los detalles (cliente,
 * referencia, validez…). Al ser nominales, la sustitución es inequívoca y lo que
 * queda sin rellenar se sigue viendo como pendiente.
 */
const DM = {
  client: '[cliente]',
  cif: '[CIF/NIF del cliente]',
  clientRep: '[representante del cliente]',
  firmRep: '[firmante de la Firma]',
  reference: '[referencia interna]',
  validity: '[validez en días]',
};

/**
 * Huecos ("blanks") case-specific que el abogado completa a mano: modalidad de
 * éxito, provisión de fondos e hitos de devengo. No se rellenan solos porque
 * dependen del criterio profesional; quedan como marcadores visibles.
 */
const FB = {
  exito: '[importe de la comisión de éxito]',
  exitoHecho: '[hecho que devenga la comisión de éxito]',
  provision: '[importe de la provisión de fondos]',
  hitos: '[hitos de devengo]',
  socio: '[cargo del firmante, p. ej. socio/a]',
};

/** Nombre de la firma (identidad de la casa). */
const FIRM = 'ILP Abogados';

/** Normaliza (minúsculas, sin acentos) para casar plantillas de servicio. */
function normText(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** ¿Aparece `needle` como palabra completa en `hay`? (evita falsos positivos por subcadena). */
function hasWord(hay: string, needle: string): boolean {
  const n = normText(needle);
  if (!n) return false;
  const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  return re.test(hay);
}

/**
 * Plantillas de HITOS/ACTUACIONES por tipo de servicio. Cuando el abogado
 * describe el trabajo (p. ej. "licencia CASP para una startup") y no aporta
 * tareas propias, la propuesta genera automáticamente el desglose típico del
 * trámite. Es un borrador orientativo y editable (no sustituye el criterio).
 */
const SERVICE_MILESTONES: { match: string[]; label: string; milestones: string[] }[] = [
  {
    match: ['casp', 'criptoactivos', 'criptoactivo', 'cripto', 'mica'],
    label: 'la autorización como proveedor de servicios de criptoactivos (CASP, MiCA)',
    milestones: [
      'Análisis de encaje regulatorio y definición del perímetro de servicios de criptoactivos (Reglamento (UE) 2023/1114, MiCA)',
      'Elaboración del programa de actividades y del plan de negocio a tres años',
      'Redacción de las políticas y procedimientos internos: gobernanza, gestión de riesgos, continuidad de negocio y resiliencia operativa digital (DORA) y conflictos de interés',
      'Elaboración de la política de prevención del blanqueo de capitales y de la financiación del terrorismo (KYC/AML)',
      'Documentación de los mecanismos de custodia y salvaguarda de los fondos y criptoactivos de clientes',
      'Evaluación de idoneidad (fit & proper) de los administradores y de los socios con participación significativa',
      'Preparación y presentación de la solicitud de autorización ante la CNMV',
      'Atención a los requerimientos de subsanación y seguimiento del expediente hasta la obtención de la autorización',
      'En su caso, notificación para el pasaporte europeo y prestación de servicios en otros Estados miembros',
    ],
  },
  {
    match: ['dora', 'resiliencia operativa'],
    label: 'la adaptación a DORA (resiliencia operativa digital)',
    milestones: [
      'Análisis de aplicabilidad y diagnóstico de brechas (gap analysis) frente al Reglamento (UE) 2022/2554 (DORA)',
      'Marco de gestión del riesgo de las TIC y políticas asociadas',
      'Registro de acuerdos con proveedores terceros de servicios TIC y revisión contractual',
      'Procedimiento de gestión, clasificación y notificación de incidentes graves relacionados con las TIC',
      'Programa de pruebas de resiliencia operativa digital',
      'Preparación de la información a remitir a la autoridad competente',
    ],
  },
  {
    match: ['marca', 'marcas', 'signo distintivo', 'nombre comercial'],
    label: 'el registro de marca',
    milestones: [
      'Búsqueda de anterioridades y análisis de disponibilidad y riesgo del signo',
      'Definición de la estrategia de protección (clases de Niza y ámbito territorial)',
      'Preparación y presentación de la solicitud de registro ante la OEPM/EUIPO',
      'Seguimiento del expediente y respuesta a suspensiones u oposiciones',
      'Obtención del título de registro y calendario de renovaciones',
    ],
  },
];

/** Deriva los hitos típicos del servicio descrito (o [] si no hay plantilla que case). */
function deriveMilestones(description: string | null, serviceLabel: string): { label: string; milestones: string[] } | null {
  const hay = ` ${normText(`${description || ''} ${serviceLabel || ''}`)} `;
  for (const t of SERVICE_MILESTONES) {
    if (t.match.some((m) => hasWord(hay, m))) return { label: t.label, milestones: t.milestones };
  }
  return null;
}

export interface ProposalPartyInput {
  name?: string | null;
  legal_form?: string | null;
  tax_id?: string | null;
  address?: string | null;
  representative?: string | null;
}

export interface ProposalInput {
  kind?: ProposalKind;                     // 'simple' (por defecto) | 'elaborate'
  case_or_calculation_id?: string | null;
  breakdown_id?: string | null;
  service_category: string;
  service_subcategory?: string | null;
  title?: string | null;
  reference?: string | null;
  date?: string | null;                    // ISO; por defecto hoy
  confidential?: boolean;
  firm?: ProposalPartyInput | null;
  client?: ProposalPartyInput | null;
  // Economía heredada de la estimación (nunca inventada).
  currency?: string | null;
  rate_used?: number | null;
  hours_min?: number | null;
  hours_recommended?: number | null;
  hours_max?: number | null;
  fee_min?: number | null;
  fee_recommended?: number | null;
  fee_max?: number | null;
  confidence_level?: ConfidenceLevel | null;
  vat_included?: boolean;
  expenses_included?: boolean;
  validity_days?: number | null;
  // Alcance.
  description?: string | null;             // descripción/antecedentes del encargo
  tasks?: string[] | null;                 // tareas detectadas (alimentan el alcance)
  included_elements?: string[] | null;     // elementos a incluir (Paso 3/6)
  excluded_services?: string[] | null;     // servicios excluidos
  billing_terms?: string | null;
}

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

/**
 * Formato de importe estilo es-ES ("4.000 €"), INDEPENDIENTE del ICU disponible
 * (algunos builds de Node no traen datos de agrupación y Intl omite el separador
 * de miles). Redondea a euros enteros.
 */
function money(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return PH;
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${neg ? '-' : ''}${grouped} ${symbol}`;
}

function dateEs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return PH;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function cleanArray(a: string[] | null | undefined): string[] {
  if (!Array.isArray(a)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of a) {
    if (typeof raw !== 'string') continue;
    const t = raw.replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function party(role: 'firm' | 'client', input: ProposalPartyInput | null | undefined, defaults: Partial<ProposalParty> = {}): ProposalParty {
  const i = input || {};
  const pick = (v: string | null | undefined, d: string | null): string | null => {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    return d;
  };
  return {
    role,
    name: pick(i.name, defaults.name ?? null),
    legal_form: pick(i.legal_form, defaults.legal_form ?? null),
    tax_id: pick(i.tax_id, defaults.tax_id ?? null),
    address: pick(i.address, defaults.address ?? null),
    representative: pick(i.representative, defaults.representative ?? null),
  };
}

function nameOr(p: ProposalParty, fallback: string): string {
  return p.name ?? fallback;
}

/** Une líneas de viñeta ("- ...") o párrafos en un cuerpo de sección. */
function bullets(items: string[], emptyLine: string): string {
  if (!items.length) return `- ${emptyLine}`;
  return items.map((t) => `- ${t}`).join('\n');
}

interface DetailValues {
  clientName: string | null;
  clientTaxId: string | null;
  clientRep: string | null;
  firmRep: string | null;
  reference: string | null;
  validity: number | null;
}

/**
 * Sustituye en cada sección los marcadores nominales por los valores presentes
 * en los detalles de la propuesta. Los datos ausentes conservan su marcador
 * (así se siguen viendo como pendientes). No toca texto editado a mano.
 */
function fillDetailMarkers(sections: ProposalSection[], f: DetailValues): ProposalSection[] {
  const pairs: [string, string | null][] = [
    [DM.client, f.clientName],
    [DM.cif, f.clientTaxId],
    [DM.clientRep, f.clientRep],
    [DM.firmRep, f.firmRep],
    [DM.reference, f.reference],
    [DM.validity, f.validity != null ? String(f.validity) : null],
  ];
  return sections.map((s) => {
    let body = s.body;
    for (const [marker, val] of pairs) {
      if (val) body = body.split(marker).join(val);
    }
    return { ...s, body };
  });
}

interface MissingFields {
  client: ProposalParty;
  firm: ProposalParty;
  fee_recommended: number | null;
  reference: string | null;
  validity_days: number | null;
  billing_terms: string | null;
}

/** Datos por confirmar (marcadores aún pendientes) según el estado actual. */
function computeMissing(f: MissingFields): string[] {
  const m: string[] = [];
  if (!f.client.name) m.push('Identificación del Cliente (nombre, CIF/NIF y domicilio).');
  else if (!f.client.tax_id) m.push('CIF/NIF del Cliente.');
  if (f.fee_recommended === null) m.push('Importe de los honorarios.');
  if (!f.reference) m.push('Referencia interna (N/ref.) de la propuesta.');
  if (f.validity_days === null) m.push('Validez temporal de la propuesta (días).');
  if (!f.firm.representative) m.push('Firmante responsable por la Firma.');
  return m;
}

// ---------------------------------------------------------------------------
// Construcción de secciones
// ---------------------------------------------------------------------------

interface RawSection { key: string; heading: string; body: string; client_visible?: boolean; numbered?: boolean; }

interface Ctx {
  kind: ProposalKind;
  serviceLabel: string;
  asunto: string;
  currency: string;
  rate: number | null;
  hoursRec: number | null; hoursMin: number | null; hoursMax: number | null;
  feeRec: number | null; feeMin: number | null; feeMax: number | null;
  lowConfidence: boolean;
  firm: ProposalParty; client: ProposalParty;
  reference: string | null;
  dateIso: string;
  description: string | null;
  tasks: string[]; included: string[]; excluded: string[];
  validityDays: number | null;
  billingTerms: string | null;
  plan: ScopePlan | null;                 // plan de trabajo estructurado (IA), si lo hay
}

function firmName(c: Ctx): string {
  return c.firm && c.firm.name ? c.firm.name : FIRM;
}

/** Párrafo de honorarios al estilo de las propuestas reales (fijo + variable de éxito). */
function feeSentence(c: Ctx): string {
  const fijo = c.feeRec != null ? money(c.feeRec, c.currency) : PH;
  let s = `Por los servicios descritos en el apartado anterior, ${firmName(c)} facturará unos honorarios profesionales `
    + `de ${fijo} fijos (IVA y gastos no incluidos)`;
  if (c.lowConfidence && c.feeRec != null) {
    s += `. La cifra anterior es orientativa y revisable, dentro de un rango estimado de entre `
      + `${money(c.feeMin, c.currency)} y ${money(c.feeMax, c.currency)}`;
  }
  s += `. Podrá pactarse, además, un variable de éxito de ${FB.exito}, que se devengará ${FB.exitoHecho}.`;
  return s + '\n\n'
    + 'Los honorarios comprenden la totalidad de las actuaciones descritas en el apartado de objeto; cualquier '
    + 'actuación no prevista expresamente será objeto de presupuesto separado.\n\n'
    + `Si durante la ejecución del encargo ${firmName(c)} apreciara desviaciones superiores al 15% entre el alcance o `
    + 'la dedicación estimados y la realidad, o circunstancias sobrevenidas que alteren el encargo, lo pondrá de '
    + 'inmediato en conocimiento del Cliente y remitirá una propuesta complementaria. En la facturación por tiempo, la '
    + 'fracción mínima computable será de 15 minutos.';
}

/** Cuerpo de "Objeto y descripción del servicio". */
function buildObjeto(c: Ctx): string {
  const parts: string[] = [];
  parts.push(`Los servicios a desarrollar por ${firmName(c)} comprenderán las tareas y trabajos relativos a la materia `
    + `de ${c.serviceLabel.toLowerCase()} objeto del presente encargo.`);
  if (c.description) parts.push(c.description);
  // Con plan de trabajo (IA), el objeto es una introducción breve: el detalle
  // (premisas, marco jurídico y fases) se desarrolla en los apartados siguientes.
  if (c.plan) {
    parts.push('El presente encargo se estructura y ejecutará conforme a las premisas, el marco jurídico aplicable y '
      + 'el plan de trabajo por fases que se detallan en los apartados siguientes.');
    return parts.join('\n\n');
  }
  const scope = [...c.included, ...c.tasks];
  parts.push(scope.length
    ? 'En particular, el encargo comprende las siguientes actuaciones:\n' + bullets(scope, '')
    : 'En particular, el encargo comprende: [detallar el alcance de los servicios].');
  if (c.excluded.length) {
    parts.push('Quedan expresamente excluidas del presente encargo, salvo pacto adicional por escrito: '
      + c.excluded.join('; ') + '.');
  }
  return parts.join('\n\n');
}

/** "Premisas y alcance del encargo" a partir del plan de trabajo (IA). */
function buildPremisasPlan(c: Ctx): string {
  const p = c.plan;
  if (!p) return '';
  const parts: string[] = [];
  if (p.assumptions_included.length) {
    parts.push('**Se incluye en el presente encargo:**\n' + bullets(p.assumptions_included, ''));
  }
  const excluded = cleanArray([...(p.assumptions_excluded || []), ...c.excluded]);
  if (excluded.length) {
    parts.push('**Queda excluido, salvo pacto adicional por escrito:**\n' + bullets(excluded, ''));
  }
  if (p.assumptions_client.length) {
    parts.push('**A cargo del Cliente (colaboración e insumos):**\n' + bullets(p.assumptions_client, ''));
  }
  if (!parts.length) return 'El alcance del encargo se corresponde con el plan de trabajo detallado a continuación.';
  return parts.join('\n\n');
}

/** "Marco jurídico aplicable" a partir del plan (relación orientativa, a verificar). */
function buildMarcoJuridico(c: Ctx): string {
  const lf = c.plan ? c.plan.legal_framework : null;
  if (!lf) return '';
  const parts: string[] = [
    'El asesoramiento se prestará con arreglo, entre otras, a la siguiente normativa, estándares y buenas prácticas '
    + 'aplicables. Se trata de una relación orientativa que se concretará y verificará en función del asunto:',
  ];
  if (lf.laws.length) parts.push('**Leyes y normas con rango de ley:**\n' + bullets(lf.laws, ''));
  if (lf.regulations.length) parts.push('**Reglamentos:**\n' + bullets(lf.regulations, ''));
  if (lf.standards.length) parts.push('**Estándares y normas técnicas:**\n' + bullets(lf.standards, ''));
  if (lf.best_practices.length) parts.push('**Buenas prácticas y guías:**\n' + bullets(lf.best_practices, ''));
  if (parts.length === 1) return '';
  return parts.join('\n\n');
}

/** "Plan de trabajo y fases" a partir del plan (objetivo/actuaciones/documentos/horas/entregables). */
function buildPlanFases(c: Ctx): string {
  const p = c.plan;
  if (!p || !p.phases.length) return '';
  const blocks: string[] = [];
  p.phases.forEach((ph, i) => {
    const horas = ph.estimated_hours != null ? ` (${ph.estimated_hours} h estimadas)` : '';
    const nombre = ph.name && ph.name.trim() ? ph.name.trim() : ph.objective;
    const lines: string[] = [`**Fase ${i + 1}. ${nombre}**${horas}`];
    lines.push(`Objetivo: ${ph.objective}`);
    if (ph.tasks.length) lines.push('Actuaciones:\n' + bullets(ph.tasks, ''));
    if (ph.documents_reviewed.length) lines.push('Documentos que se revisarán: ' + ph.documents_reviewed.join('; ') + '.');
    if (ph.documents_produced.length) lines.push('Documentos que se elaborarán: ' + ph.documents_produced.join('; ') + '.');
    if (ph.deliverables.length) lines.push('Entregables de la fase: ' + ph.deliverables.join('; ') + '.');
    blocks.push(lines.join('\n'));
  });
  const total = p.total_hours != null ? p.total_hours : c.hoursRec;
  if (total != null) {
    blocks.push(`La dedicación indicada por fases es una estimación orientativa; la dedicación total estimada del `
      + `encargo es de ${total} horas.`);
  }
  if (p.deliverables.length) {
    blocks.push('**Entregables del encargo (resumen):**\n' + bullets(p.deliverables, ''));
  }
  if (p.team.length) {
    blocks.push('**Equipo asignado:** ' + p.team.join('; ') + '.');
  }
  return blocks.join('\n\n');
}

/** Cuerpo de "Devengo de los honorarios y provisión de fondos" (hitos + provisión). */
function buildDevengo(c: Ctx): string {
  const scope = [...c.included, ...c.tasks];
  const hitos = scope.length
    ? 'Los honorarios fijos se devengarán conforme a los siguientes hitos, sin perjuicio de su ajuste de común '
      + 'acuerdo con el Cliente:\n' + scope.map((t) => `- ${t}: [importe]`).join('\n')
    : 'Los honorarios fijos se devengarán conforme a los siguientes hitos, sin perjuicio de su ajuste de común '
      + `acuerdo con el Cliente: ${FB.hitos}.`;
  return hitos + '\n\n'
    + 'A la aceptación de esta Propuesta, y con carácter previo al inicio de los servicios, el Cliente abonará una '
    + `provisión de fondos de ${FB.provision} (con carácter general, no inferior al 30% de los honorarios `
    + 'presupuestados), que se imputará a los honorarios conforme se vayan devengando. La aceptación de la Propuesta '
    + 'podrá ser expresa o tácita, entendiéndose aceptada si el Cliente recaba o recibe los servicios sin oposición.\n\n'
    + 'Las minutas se remitirán preferentemente por correo electrónico y serán pagaderas mediante transferencia en el '
    + 'plazo de quince (15) días desde su recepción. Transcurrido dicho plazo sin oposición motivada, la minuta se '
    + 'entenderá aceptada, sin perjuicio del derecho del Cliente a solicitar su revisión de conformidad con la '
    + 'normativa del Colegio de Abogados correspondiente. El impago devengará los intereses de demora legalmente '
    + 'aplicables y facultará al Despacho para suspender o interrumpir la prestación de los servicios.\n\n'
    + 'Le agradeceríamos que, al efectuar el pago, su nombre (o el de su empresa) y el número de la presente Propuesta '
    + 'queden claramente recogidos en el concepto, a fin de garantizar un correcto seguimiento.';
}

/** Anexo económico (formato elaborado): resume las cifras de la calculadora. */
function buildAnexo(c: Ctx): string {
  return `- Honorarios fijos: ${c.feeRec != null ? money(c.feeRec, c.currency) : PH} (IVA y gastos no incluidos).\n`
    + `- Rango orientativo: ${c.feeMin != null ? money(c.feeMin, c.currency) : PH} – ${c.feeMax != null ? money(c.feeMax, c.currency) : PH}.\n`
    + `- Tarifa horaria de referencia: ${c.rate != null ? `${c.rate} €/hora` : PH}.\n`
    + `- Dedicación estimada: ${c.hoursRec != null ? `${c.hoursRec} horas` : PH}.\n`
    + `- Variable de éxito: ${FB.exito} (${FB.exitoHecho}).\n`
    + `- Provisión de fondos a la firma: ${FB.provision}.`;
}

type Tier = ProposalKind;
const ALL: Tier[] = ['reduced', 'intermediate', 'extended'];
const IE: Tier[] = ['intermediate', 'extended'];
const EXT: Tier[] = ['extended'];
const RED: Tier[] = ['reduced'];

interface Clause { key: string; heading: string; tiers: Tier[]; body: string; }

/** Encabezado de la carta (destinatario + apertura), sin numerar. */
function structuralOpen(c: Ctx): RawSection[] {
  const clientName = c.client.name || DM.client;
  const clientRep = c.client.representative || DM.clientRep;
  return [
    {
      key: 'destinatario', numbered: false, heading: 'Destinatario',
      body: [
        `N/ref.: ${DM.reference}`,
        `A la atención de: ${clientName}`,
        `${DM.cif}   ·   Domicilio: [domicilio del Cliente]`,
        `Asunto: ${c.asunto.charAt(0).toUpperCase()}${c.asunto.slice(1)}`,
      ].join('\n'),
    },
    {
      key: 'apertura', numbered: false, heading: 'Apertura',
      body: `Estimado/a ${clientRep}:\n\n`
        + `Atendiendo a su solicitud, ${firmName(c)} (en adelante, «ILP» o el **«Despacho»**) se complace en remitirle `
        + 'la presente propuesta de honorarios profesionales, que tiene la naturaleza de hoja de encargo profesional '
        + `(en adelante, la **«Propuesta»**), elaborada exclusivamente para ${clientName} (en adelante, el `
        + '**«Cliente»**) y de carácter confidencial.',
    },
  ];
}

/** Cuerpo de "Gastos, suplidos e impuestos". */
function gastosBody(): string {
  return 'Salvo indicación en contrario, los honorarios se entienden sin incluir el IVA aplicable en cada momento, que '
    + 'se añadirá a todas las cantidades.\n\n'
    + 'Los honorarios no comprenden los honorarios de terceros (procuradores, notarios, registradores, peritos, '
    + 'traductores, entre otros), ni los impuestos, tributos, tasas y aranceles vinculados a la operación, pleito o '
    + 'mandato, ni los gastos de desplazamiento, que se repercutirán al Cliente de forma independiente y previa '
    + 'justificación. Se repercutirán, asimismo, los gastos generales del Despacho (fotocopias, comunicaciones y '
    + 'gastos asimilables) a razón de un porcentaje del 2% de los honorarios profesionales, sin necesidad de '
    + 'justificación documental.';
}

/**
 * Cláusulas jurídicas necesarias en una propuesta/hoja de encargo española.
 * La LIMITACIÓN DE RESPONSABILIDAD es obligatoria en TODOS los formatos y limita
 * la responsabilidad de la Firma al total de honorarios efectivamente percibidos.
 */
function clauseSections(c: Ctx): Record<string, RawSection> {
  const validez = c.validityDays != null ? c.validityDays : DM.validity;
  const F = firmName(c);
  return {
    sobre_despacho: {
      key: 'sobre_despacho', heading: 'Sobre el Despacho',
      body: `${F} presta servicios profesionales de abogacía con sujeción al Estatuto General de la Abogacía Española `
        + '(Real Decreto 135/2021), al Código Deontológico y a las normas del Ilustre Colegio de Abogados de '
        + '[Colegio de Abogados] al que pertenecen sus letrados, quienes están sujetos al secreto profesional y al '
        + 'deber de confidencialidad. Datos identificativos del Despacho: NIF [NIF del Despacho] · domicilio '
        + 'profesional [domicilio del Despacho] · nº de colegiación [nº de colegiación].',
    },
    limitacion: {
      key: 'limitacion', heading: 'Limitación de responsabilidad',
      body: `La responsabilidad total de ${F} frente al Cliente por cualquier reclamación derivada de la prestación `
        + 'de los servicios objeto de la presente Propuesta quedará limitada, en su conjunto, al importe total de los '
        + `honorarios efectivamente percibidos por ${F} en relación con el presente encargo. Quedan excluidos, en todo `
        + 'caso, el lucro cesante, los daños indirectos o consecuenciales, la pérdida de beneficios y el coste de '
        + 'oportunidad. La presente limitación no será de aplicación respecto de la responsabilidad que no resulte '
        + `legalmente limitable, en particular la derivada de dolo o negligencia grave. ${F} mantiene en vigor un `
        + 'seguro de responsabilidad civil profesional, cuyo certificado podrá facilitar a solicitud del Cliente.',
    },
    costas: {
      key: 'costas', heading: 'Costas procesales',
      body: 'El Cliente queda informado de las consecuencias que una eventual condena en costas puede comportar y de '
        + 'su importe aproximado ([estimación de costas], a concretar según la cuantía y la instancia). En caso de '
        + `condena en costas a favor del Cliente y de que su tasación resultara superior a los honorarios de la `
        + `Propuesta, ${F} se reserva el derecho a facturar la diferencia, quedando autorizado a cobrarla con cargo a `
        + 'los fondos que se obtengan de la parte condenada en costas.',
    },
    confidencialidad: {
      key: 'confidencialidad', heading: 'Confidencialidad y protección de datos',
      body: `${F} prestará sus servicios con sujeción al secreto profesional y al deber de confidencialidad propios de `
        + 'la abogacía, y no revelará información del Cliente, de su grupo ni del objeto del encargo, sin perjuicio de '
        + 'poder dar publicidad genérica a su intervención sin revelar la identidad de las partes.\n\n'
        + `En materia de protección de datos, ${F} es responsable del tratamiento de los datos personales del Cliente `
        + 'con la finalidad de gestionar la relación contractual y prestar los servicios (base jurídica: la ejecución '
        + 'del contrato). Los datos no se cederán a terceros salvo obligación legal. El Cliente podrá ejercer sus '
        + 'derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad conforme al Reglamento '
        + '(UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD), dirigiéndose a [correo de protección de datos].',
    },
    blanqueo: {
      key: 'blanqueo', heading: 'Prevención del blanqueo de capitales',
      body: 'De conformidad con la Ley 10/2010, de 28 de abril, de prevención del blanqueo de capitales y de la '
        + `financiación del terrorismo, ${F} aplicará las medidas de diligencia debida que resulten preceptivas, `
        + 'incluida la identificación del Cliente y de su titular real. El Cliente se compromete a facilitar con '
        + 'veracidad la documentación e información necesarias y declara la licitud del origen de los fondos empleados '
        + 'en el pago de los honorarios.',
    },
    propiedad_intelectual: {
      key: 'propiedad_intelectual', heading: 'Propiedad intelectual',
      body: `Los informes, documentos y demás materiales elaborados por ${F} en el marco del encargo se entregan al `
        + 'Cliente para el uso propio del asunto para el que se emiten. Los derechos de propiedad intelectual sobre '
        + `las metodologías, plantillas y conocimientos preexistentes de ${F} permanecen en su exclusiva titularidad.`,
    },
    custodia: {
      key: 'custodia', heading: 'Custodia y devolución de la documentación',
      body: `${F} custodiará con la debida diligencia la documentación original y las copias entregadas por el `
        + 'Cliente, que devolverá a su requerimiento y, en todo caso, a la finalización del encargo. Transcurrido el '
        + `plazo de cinco (5) años desde la finalización del encargo, ${F} podrá destruir la documentación que obre en `
        + 'su poder, salvo aquella que deba conservar por imperativo legal.',
    },
    terminacion: {
      key: 'terminacion', heading: 'Duración, desistimiento y terminación',
      body: 'El encargo permanecerá vigente hasta la conclusión de las actuaciones descritas. Dada su naturaleza '
        + 'intuitu personae, el Cliente podrá desistir del encargo en cualquier momento y sin necesidad de causa, '
        + 'mediante comunicación escrita, abonando los honorarios correspondientes a los trabajos efectivamente '
        + `realizados y los gastos y suplidos incurridos hasta esa fecha. ${F} podrá igualmente renunciar al encargo `
        + 'con un preaviso mínimo de quince (15) días, durante el cual llevará a cabo las actuaciones necesarias para '
        + 'preservar los derechos e intereses del Cliente.',
    },
    deontologia: {
      key: 'deontologia', heading: 'Normas deontológicas y revisión de honorarios',
      body: 'La prestación de los servicios se sujeta al Estatuto General de la Abogacía Española y al Código '
        + 'Deontológico. En caso de controversia sobre los honorarios, éstos se someterán a las normas deontológicas '
        + 'y, en su caso, a los criterios orientativos del Colegio de Abogados correspondiente, pudiendo el Cliente '
        + 'solicitar la revisión o impugnación de la minuta ante dicho Colegio conforme a la normativa aplicable.',
    },
    jurisdiccion: {
      key: 'jurisdiccion', heading: 'Ley aplicable y jurisdicción',
      body: 'La presente Propuesta y la relación contractual se rigen por el Derecho común español. Con renuncia a '
        + 'cualquier otro fuero que pudiera corresponderles, las partes se someten a los Juzgados y Tribunales de '
        + '[sede del Despacho] para la resolución de cualquier controversia derivada de su interpretación o '
        + 'cumplimiento.',
    },
    validez: {
      key: 'condiciones', heading: 'Validez y aceptación',
      body: `La presente Propuesta tiene una validez de ${validez} días naturales desde su fecha. Los términos de la `
        + 'prestación no contemplados expresamente en esta Propuesta se regirán por las Condiciones Generales de '
        + 'Contratación adjuntas, cuya lectura recomendamos. La aceptación mediante intercambio de firmas en formato '
        + 'PDF o firma electrónica tendrá la misma fuerza legal y efecto que el intercambio de firmas manuscritas.',
    },
    // Formato reducido: una sola cláusula que condensa validez + datos + desistimiento + firma.
    condicionesReducida: {
      key: 'condiciones', heading: 'Condiciones',
      body: `La presente Propuesta tiene una validez de ${validez} días naturales desde su fecha. El Cliente podrá `
        + 'desistir del encargo en cualquier momento abonando lo efectivamente devengado. El tratamiento de datos '
        + 'personales se realizará conforme al RGPD y a la LO 3/2018 (LOPDGDD); las partes guardarán confidencialidad. '
        + 'Los términos no contemplados expresamente se regirán por las Condiciones Generales de Contratación '
        + 'adjuntas. La aceptación mediante firma electrónica o intercambio de firmas en PDF tendrá la misma fuerza '
        + 'legal que la firma manuscrita.',
    },
  };
}

function closingSections(c: Ctx): RawSection[] {
  const clientName = c.client.name || DM.client;
  return [
    {
      key: 'cierre', numbered: false, heading: 'Cierre',
      body: 'Para cualquier duda o aclaración quedamos a su entera disposición.\n\nUn cordial saludo,\n\n'
        + `${firmName(c)}\n${c.firm.representative || DM.firmRep}`,
    },
    {
      key: 'aceptacion', numbered: false, heading: 'Aceptación de la propuesta',
      body: `Fecha y firma del Cliente (${clientName}) en aceptación de la Propuesta y de las Condiciones Generales `
        + 'de Contratación adjuntas:\n\n_________________________________________',
    },
  ];
}

/** Secciones adicionales del formato elaborado (dossier), en la voz de la casa. */
function elaborateSections(c: Ctx): Record<string, RawSection> {
  return {
    presentacion: {
      key: 'presentacion', heading: 'Presentación del Despacho',
      body: `${firmName(c)} es un despacho de abogados especializado en ${c.serviceLabel}, que ofrece a sus clientes un `
        + 'asesoramiento riguroso, práctico y orientado a resultados. [Completar con la presentación y los valores '
        + 'diferenciales de la Firma.]',
    },
    metodologia: {
      key: 'metodologia', heading: 'Metodología de trabajo',
      body: 'Nuestra metodología combina un análisis jurídico riguroso con una gestión de proyecto orientada a '
        + 'resultados: (i) análisis del asunto y definición de la estrategia; (ii) ejecución de las actuaciones; y '
        + '(iii) seguimiento e interlocución continua con el Cliente.',
    },
    credenciales: {
      key: 'credenciales', heading: 'Credenciales y experiencia relevante',
      body: `${firmName(c)} cuenta con experiencia relevante en asuntos de ${c.serviceLabel}. [Aportar credenciales, `
        + 'precedentes o reconocimientos, si el Cliente los solicita.]',
    },
    premisas: {
      key: 'premisas', heading: 'Premisas y asunciones',
      body: 'La presente propuesta se ha elaborado bajo las siguientes premisas; de modificarse, los honorarios y '
        + 'plazos podrían revisarse:\n'
        + bullets([
          'El alcance se limita a las actuaciones descritas en el apartado de objeto.',
          `La dedicación estimada es de ${c.hoursRec != null ? c.hoursRec : PH} horas.`,
          'El Cliente facilitará en tiempo la información y documentación necesarias.',
        ], ''),
    },
    cronograma: {
      key: 'cronograma', heading: 'Cronograma',
      body: 'Se propone el siguiente calendario orientativo, a ajustar con el Cliente: [indicar hitos y plazos].',
    },
    anexo: { key: 'anexo_economico', heading: 'Anexo económico', body: buildAnexo(c) },
  };
}

/**
 * REGISTRO DE CLÁUSULAS en orden de documento. Cada cláusula declara los formatos
 * en los que aparece (`tiers`): las NECESARIAS van en todos los formatos aplicables;
 * las OPCIONALES se escalonan — reducida pocas, intermedia más, extendida el máximo.
 * Reutiliza los cuerpos ya redactados (clauseSections / elaborateSections) y añade
 * las cláusulas restantes de forma concisa. Los datos específicos quedan como [...].
 */
function clauseRegistry(c: Ctx): Clause[] {
  const CL = clauseSections(c);
  const E = elaborateSections(c);
  const F = firmName(c);
  const cl = (key: string, heading: string, tiers: Tier[], body: string): Clause => ({ key, heading, tiers, body });
  return [
    // — Identificación y preliminares —
    cl('identificacion', 'Identificación de las partes', IE,
      `El Despacho: ${F}, [forma jurídica del Despacho], NIF [NIF del Despacho], domicilio profesional en `
      + `[domicilio del Despacho]. Letrado responsable: ${c.firm.representative || DM.firmRep}, del Ilustre Colegio `
      + 'de Abogados de [Colegio de Abogados], nº de colegiación [nº de colegiación].\n\n'
      + `El Cliente: ${c.client.name || DM.client}, ${DM.cif}, con domicilio en [domicilio del Cliente] `
      + '([forma jurídica y datos registrales, si procede]), representado por '
      + `${c.client.representative || DM.clientRep}, con poder bastante para obligarle en el presente encargo.`),
    cl('definiciones', 'Definiciones', EXT,
      'A los efectos de este documento: la **«Propuesta»** es la presente y sus anexos; el **«Cliente»** es su '
      + 'destinatario; el **«Despacho»** es la firma que presta los servicios; el **«Encargo»** es el objeto descrito; '
      + 'y las **«CGC»** son las Condiciones Generales de Contratación adjuntas.'),
    cl('interpretacion', 'Interpretación', EXT,
      'Los títulos de los apartados son indicativos y no afectan a su interpretación. Las referencias a normas se '
      + 'entienden hechas a su redacción vigente en cada momento.'),
    cl('prelacion', 'Orden de prelación', EXT,
      'En caso de contradicción prevalecerá, por este orden: (i) la Propuesta; (ii) las CGC; y (iii) los demás anexos.'),
    cl('sobre_despacho', CL.sobre_despacho.heading, EXT, CL.sobre_despacho.body),
    cl('presentacion', E.presentacion.heading, EXT, E.presentacion.body),
    // — Antecedentes y objeto —
    cl('antecedentes', 'Antecedentes', IE,
      c.description ? c.description
        : 'El Cliente ha solicitado al Despacho asesoramiento en relación con el asunto de referencia. [Completar los '
          + 'antecedentes que motivan el encargo.]'),
    cl('objeto', 'Objeto y descripción del servicio', ALL, buildObjeto(c)),
    cl('metodologia', E.metodologia.heading, EXT, E.metodologia.body),
    cl('servicios_excluidos', 'Servicios excluidos', IE,
      'Salvo pacto expreso, quedan excluidos del Encargo, entre otros: la segunda instancia y los recursos '
      + 'extraordinarios; la ejecución de resoluciones; el asesoramiento fiscal, contable o de Derecho extranjero; y '
      + 'las actuaciones notariales, registrales y de traducción, que serán objeto de presupuesto separado.'
      + (c.excluded.length ? `\n\nExclusiones específicas de este encargo: ${c.excluded.join('; ')}.` : '')),
    cl('entregables', 'Entregables', IE,
      'Los entregables consistirán, según proceda, en informes o dictámenes, contratos y escritos, presentaciones '
      + 'ante organismos y el soporte de negociación asociado, conforme al apartado de objeto.'),
    cl('no_garantia', 'Obligación de medios', ALL,
      'El Despacho asume una obligación de medios y no de resultado: prestará sus servicios con la diligencia y '
      + 'competencia profesional exigibles, sin garantizar un resultado concreto, que depende de factores ajenos a su '
      + 'control (criterio de terceros y de los órganos administrativos o judiciales).'),
    cl('riesgo', 'Advertencia de viabilidad jurídica', IE,
      'El asesoramiento se emite en función de los hechos y la documentación facilitados por el Cliente y de la '
      + 'legislación y jurisprudencia vigentes en la fecha del Encargo; su variación podría alterar las conclusiones.'),
    // — Equipo, conflictos, colaboración, planificación —
    cl('equipo', 'Equipo de trabajo', IE,
      `Los servicios serán dirigidos por ${c.firm.representative || DM.firmRep}, ${FB.socio}, y prestados por un equipo `
      + 'adaptado a las necesidades del asunto, con las incorporaciones que en cada momento se requieran.'),
    cl('credenciales', E.credenciales.heading, EXT, E.credenciales.body),
    cl('conflicto', 'Conflictos de interés', IE,
      'El Despacho ha realizado la comprobación de conflictos de interés conforme a la información disponible; el '
      + 'Cliente se compromete a identificar a las partes contrarias e interesadas. De surgir un conflicto sobrevenido '
      + 'que impida la actuación, el Despacho podrá renunciar al Encargo preservando la confidencialidad.'),
    cl('cooperacion', 'Deberes de colaboración del Cliente', IE,
      'El Cliente se obliga a facilitar de forma veraz, completa y en plazo la información y documentación necesarias y '
      + 'a comunicar cualquier hecho relevante. El Despacho no responderá de las consecuencias derivadas de información '
      + 'inexacta, incompleta o extemporánea.'),
    cl('premisas', E.premisas.heading, IE, E.premisas.body),
    cl('cronograma', E.cronograma.heading, EXT, E.cronograma.body),
    cl('plazos', 'Plazos y dependencias', IE,
      'Los plazos de entrega son estimativos y quedan condicionados a la colaboración del Cliente y a la actuación de '
      + 'terceros (organismos, contrapartes, órganos judiciales), cuyos tiempos no son imputables al Despacho.'),
    // — Honorarios y economía —
    cl('honorarios', 'Honorarios profesionales', ALL, feeSentence(c)),
    cl('change_control', 'Control de cambios de alcance', IE,
      'Cualquier ampliación o modificación del alcance se documentará por escrito mediante propuesta complementaria, '
      + 'con su ajuste de honorarios y plazos, antes de su ejecución.'),
    cl('cap_fee', 'Presupuesto máximo', EXT,
      'En la facturación por tiempo podrá pactarse un presupuesto máximo (cap) de [importe del cap máximo]; alcanzado '
      + 'dicho límite, el Despacho lo comunicará al Cliente antes de continuar.'),
    cl('tarifas', 'Tarifas por categoría profesional', EXT,
      'Para los trabajos facturables por tiempo se aplicarán las siguientes tarifas/hora (IVA no incluido): socio '
      + '[● €/h] · asociado senior [● €/h] · asociado [● €/h] · junior [● €/h].'),
    cl('recargo_urgencia', 'Recargo por urgencia', EXT,
      'Los trabajos que, a solicitud del Cliente, deban realizarse con urgencia o fuera del horario laboral ordinario '
      + 'podrán devengar un recargo de [porcentaje de recargo] sobre los honorarios correspondientes.'),
    cl('revisiones', 'Rondas de revisión incluidas', EXT,
      'Los honorarios comprenden hasta [número] rondas de revisión de los documentos o entregables; las adicionales se '
      + 'facturarán por tiempo conforme a las tarifas aplicables.'),
    cl('devengo', 'Devengo, facturación y provisión de fondos', IE, buildDevengo(c)),
    cl('aceptacion_entregable', 'Aceptación de entregables', EXT,
      'Se entenderán aceptados los entregables si el Cliente no formula observaciones por escrito en el plazo de '
      + '[número] días naturales desde su remisión.'),
    cl('anexo_economico', E.anexo.heading, EXT, E.anexo.body),
    cl('gastos', 'Gastos, suplidos e impuestos', ALL, gastosBody()),
    cl('costas', CL.costas.heading, IE, CL.costas.body),
    // — Responsabilidad —
    cl('limitacion', CL.limitacion.heading, ALL, CL.limitacion.body),
    cl('no_third_party', 'No dependencia de terceros', IE,
      'El asesoramiento se emite en exclusivo beneficio del Cliente y para el asunto descrito; no podrá ser invocado '
      + 'ni utilizado por terceros, ni para una finalidad distinta, sin el consentimiento escrito del Despacho.'),
    // — Confidencialidad, datos, IP, AML, tecnología —
    cl('confidencialidad', CL.confidencialidad.heading, IE, CL.confidencialidad.body),
    cl('blanqueo', CL.blanqueo.heading, IE, CL.blanqueo.body),
    cl('uso_ia', 'Uso de herramientas tecnológicas', IE,
      `Para la prestación eficiente de los servicios, ${F} podrá emplear herramientas tecnológicas y de inteligencia `
      + 'artificial de apoyo, bajo supervisión profesional y con las debidas garantías de confidencialidad y '
      + 'seguridad, sin que ello altere la responsabilidad profesional del letrado.'),
    cl('ciberseguridad', 'Ciberseguridad y prevención del fraude', IE,
      'El Despacho no comunicará cambios de sus datos bancarios por correo electrónico. Ante cualquier mensaje que '
      + 'anuncie un cambio de cuenta, el Cliente deberá verificarlo por teléfono con su interlocutor habitual antes de '
      + 'pagar. El Despacho no responderá de los pagos realizados a cuentas no verificadas.'),
    cl('propiedad_intelectual', CL.propiedad_intelectual.heading, IE, CL.propiedad_intelectual.body),
    cl('custodia', CL.custodia.heading, IE, CL.custodia.body),
    cl('colaboradores', 'Colaboradores externos y subcontratación', EXT,
      'El Despacho podrá servirse de procuradores, abogados de otras jurisdicciones, peritos, traductores u otros '
      + 'colaboradores externos cuando resulte necesario, informando al Cliente; sus honorarios tendrán la '
      + 'consideración de suplidos.'),
    // — Comunicación, terminación, misceláneas —
    cl('comunicacion', 'Protocolo de comunicación', IE,
      'Las comunicaciones se dirigirán preferentemente por correo electrónico a los interlocutores designados por cada '
      + 'parte [interlocutores y datos de contacto]. El idioma de trabajo será el español, salvo pacto en contrario.'),
    cl('terminacion', CL.terminacion.heading, ALL, CL.terminacion.body),
    cl('quejas', 'Reclamaciones', IE,
      'El Cliente podrá dirigir cualquier reclamación al Despacho a través de [canal de quejas del Despacho] y, en su '
      + 'caso, al Colegio de Abogados correspondiente.'),
    cl('publicidad', 'Publicidad y referencias', EXT,
      'El Despacho podrá referirse a su intervención con fines promocionales de forma genérica; el uso del nombre o '
      + 'del logotipo del Cliente requerirá su consentimiento expreso.'),
    cl('no_captacion', 'No captación de personal', EXT,
      'Durante la vigencia del Encargo y los doce (12) meses siguientes, las partes se abstendrán de captar al personal '
      + 'de la otra que hubiera intervenido en el Encargo, salvo acuerdo escrito.'),
    cl('fuerza_mayor', 'Fuerza mayor', EXT,
      'Ninguna parte responderá del incumplimiento debido a fuerza mayor o caso fortuito, que suspenderá los plazos '
      + 'mientras persista la causa.'),
    cl('cesion', 'Cesión', EXT,
      'El Encargo se celebra intuitu personae; ninguna parte podrá ceder su posición contractual sin el consentimiento '
      + 'escrito de la otra.'),
    cl('deontologia', CL.deontologia.heading, IE, CL.deontologia.body),
    // — Ley, jurisdicción, boilerplate, anexos, aceptación —
    cl('jurisdiccion', CL.jurisdiccion.heading, ALL, CL.jurisdiccion.body),
    cl('mediacion', 'Mediación y arbitraje', EXT,
      'Con carácter previo a la vía judicial, las partes procurarán resolver sus controversias mediante negociación o '
      + 'mediación. [Opcional: sumisión a arbitraje ante [institución arbitral].]'),
    cl('boilerplate', 'Nulidad parcial, no renuncia y acuerdo íntegro', IE,
      'La nulidad de cualquier cláusula no afectará a la validez de las restantes. La falta de ejercicio de un derecho '
      + 'no implica su renuncia. La Propuesta y las CGC constituyen el acuerdo íntegro entre las partes sobre su objeto.'),
    cl('idioma', 'Prevalencia del idioma', EXT,
      'En caso de versión bilingüe, prevalecerá la versión en español a efectos de interpretación.'),
    cl('anexos', 'Anexos', IE,
      '- Anexo I. Condiciones Generales de Contratación.\n- Anexo II. Anexo económico / tabla de honorarios.\n'
      + '- Anexo III. Información de protección de datos.\n- Anexo IV. [documentación KYC/AML, si procede].'),
    cl('condiciones', CL.validez.heading, IE, CL.validez.body),
    cl('condiciones', CL.condicionesReducida.heading, RED, CL.condicionesReducida.body),
  ];
}

/** Ensambla la propuesta filtrando el registro por formato (staggering de cláusulas). */
function assembleByKind(c: Ctx): RawSection[] {
  let clauses: RawSection[] = clauseRegistry(c)
    .filter((cl) => cl.tiers.includes(c.kind))
    .map((cl) => ({ key: cl.key, heading: cl.heading, body: cl.body }));
  // Con plan de trabajo (IA): tras el Objeto se insertan, en TODOS los formatos,
  // las Premisas, el Marco jurídico y el Plan por fases redactados a partir del plan.
  if (c.plan) {
    const planSecs: RawSection[] = [];
    const premisas = buildPremisasPlan(c);
    if (premisas) planSecs.push({ key: 'premisas_alcance', heading: 'Premisas y alcance del encargo', body: premisas });
    const marco = buildMarcoJuridico(c);
    if (marco) planSecs.push({ key: 'marco_juridico', heading: 'Marco jurídico aplicable', body: marco });
    const fases = buildPlanFases(c);
    if (fases) planSecs.push({ key: 'plan_trabajo', heading: 'Plan de trabajo y fases', body: fases });
    const idx = clauses.findIndex((s) => s.key === 'objeto');
    clauses = idx >= 0
      ? [...clauses.slice(0, idx + 1), ...planSecs, ...clauses.slice(idx + 1)]
      : [...planSecs, ...clauses];
  }
  return [...structuralOpen(c), ...clauses, ...closingSections(c)];
}

function numberSections(raw: RawSection[]): ProposalSection[] {
  let n = 0;
  return raw.map((r) => {
    const numbered = r.numbered !== false;
    if (numbered) n += 1;
    return {
      id: newId('ps'),
      key: r.key,
      heading: numbered ? `${n}. ${r.heading}` : r.heading,
      body: r.body,
      client_visible: r.client_visible !== false,
    };
  });
}

// ---------------------------------------------------------------------------
// Generador principal (puro, no persiste)
// ---------------------------------------------------------------------------

/** Normaliza el formato a los tres niveles (con compatibilidad hacia atrás). */
function normalizeKind(k: unknown): ProposalKind {
  if (k === 'reduced' || k === 'intermediate' || k === 'extended') return k;
  if (k === 'elaborate') return 'extended';
  if (k === 'simple') return 'intermediate';
  return 'intermediate';
}

export function generateProposal(input: ProposalInput, plan: ScopePlan | null = null): FeeProposal {
  const id = newId('prop');
  const kind: ProposalKind = normalizeKind(input.kind);
  const currency = (input.currency || 'EUR').trim() || 'EUR';
  const subcat = input.service_subcategory && input.service_subcategory.trim() ? input.service_subcategory.trim() : null;
  const serviceCat = (input.service_category || '').trim() || PH;
  const serviceLabel = `${serviceCat}${subcat ? ` / ${subcat}` : ''}`;
  const dateIso = (input.date && input.date.trim()) ? input.date.trim() : nowIso();
  const confidence: ConfidenceLevel = input.confidence_level === 'high' || input.confidence_level === 'medium'
    ? input.confidence_level : 'low';

  const firm = party('firm', input.firm, { name: 'ILP Abogados' });
  const client = party('client', input.client);

  const description = (input.description || '').replace(/\s+/g, ' ').trim() || null;
  const tasks = cleanArray(input.tasks);
  let included = cleanArray(input.included_elements);
  let excluded = cleanArray(input.excluded_services);
  // Si el abogado no aporta actuaciones propias, genera automáticamente los hitos
  // típicos del servicio descrito (p. ej. "licencia CASP" -> trámite MiCA ante CNMV).
  let autoMilestones: string | null = null;
  if (plan) {
    // El plan de trabajo (IA) sustituye a los hitos automáticos por plantilla:
    // el devengo por hitos sigue las fases del plan.
    const phaseNames = plan.phases.map((ph, i) => (ph.name && ph.name.trim()) ? ph.name.trim() : `Fase ${i + 1}`);
    if (phaseNames.length) included = phaseNames;
    excluded = cleanArray([...excluded, ...plan.assumptions_excluded]);
  } else if (included.length + tasks.length < 2) {
    const dm = deriveMilestones(description, serviceLabel);
    if (dm) { included = dm.milestones; autoMilestones = dm.label; }
  }
  // Asunto del encabezado: resumen del encargo (de la descripción) o, si no la hay, el área.
  const asunto = description
    ? (description.length > 160 ? `${description.slice(0, 157).trimEnd()}…` : description)
    : serviceLabel;

  const ctx: Ctx = {
    kind, serviceLabel, asunto, currency,
    rate: input.rate_used ?? null,
    hoursRec: input.hours_recommended ?? null, hoursMin: input.hours_min ?? null, hoursMax: input.hours_max ?? null,
    feeRec: input.fee_recommended ?? null, feeMin: input.fee_min ?? null, feeMax: input.fee_max ?? null,
    lowConfidence: confidence === 'low',
    firm, client,
    reference: (input.reference || '').trim() || null,
    dateIso,
    description, tasks, included, excluded,
    validityDays: input.validity_days ?? null,
    billingTerms: (input.billing_terms || '').trim() || null,
    plan,
  };

  const rawSections = numberSections(assembleByKind(ctx));
  // Rellena automáticamente los marcadores con los datos ya disponibles.
  const sections = fillDetailMarkers(rawSections, {
    clientName: client.name, clientTaxId: client.tax_id, clientRep: client.representative,
    firmRep: firm.representative, reference: ctx.reference, validity: ctx.validityDays,
  });

  // Cautelas y datos por confirmar (marcadores aún pendientes).
  const missing = computeMissing({
    client, firm, fee_recommended: ctx.feeRec, reference: ctx.reference,
    validity_days: ctx.validityDays, billing_terms: ctx.billingTerms,
  });
  if (!description) missing.push('Antecedentes/descripción del encargo.');
  if (!included.length && !tasks.length) missing.push('Detalle del alcance de los servicios.');
  missing.push('Definir, en su caso, comisión de éxito, provisión de fondos e hitos de devengo (huecos "[...]" del texto).');

  const assumptions: string[] = [
    'Los honorarios se han calculado con la tarifa base de 250 €/hora salvo indicación de una tarifa específica (Regla 2).',
    'Salvo indicación expresa, los honorarios no incluyen IVA ni gastos/suplidos (Regla 9).',
  ];
  if (autoMilestones) {
    assumptions.push(`Las actuaciones e hitos para ${autoMilestones} se han generado automáticamente a partir de una `
      + 'plantilla del trámite; revíselos y ajústelos al caso concreto.');
  }
  if (plan) {
    assumptions.push('El alcance (premisas, marco jurídico y plan de trabajo por fases) se ha redactado automáticamente '
      + `con IA (${plan.generated_by}) a partir del resumen del encargo; las horas por fases distribuyen la dedicación `
      + 'estimada por la calculadora (regla 12: no se inventan importes). Es un borrador: revíselo con criterio profesional.');
  }

  const warnings: string[] = [
    'Propuesta generada automáticamente a partir de una estimación: es un borrador interno; revísela y ajústela '
    + 'antes de enviarla al Cliente (Regla 1).',
  ];
  if (ctx.lowConfidence) {
    warnings.push('Las cifras económicas son orientativas (confianza baja): confírmelas con criterio profesional '
      + 'antes de proponerlas al Cliente.');
  }
  if (plan) {
    warnings.push('Marco jurídico generado por IA: verifique las referencias normativas (leyes, reglamentos y, en su '
      + 'caso, artículos) antes de enviar la propuesta al Cliente.');
  }

  return {
    id,
    kind,
    case_or_calculation_id: input.case_or_calculation_id || null,
    breakdown_id: input.breakdown_id || null,
    service_category: serviceCat,
    service_subcategory: subcat,
    title: (input.title || '').trim() || 'Propuesta de honorarios profesionales',
    reference: ctx.reference,
    date: dateIso,
    confidential: input.confidential !== false,
    firm,
    client,
    currency,
    rate_used: ctx.rate,
    hours_min: ctx.hoursMin, hours_recommended: ctx.hoursRec, hours_max: ctx.hoursMax,
    fee_min: ctx.feeMin, fee_recommended: ctx.feeRec, fee_max: ctx.feeMax,
    vat_included: input.vat_included === true,
    expenses_included: input.expenses_included === true,
    validity_days: ctx.validityDays,
    included_elements: included,
    excluded_services: excluded,
    billing_terms: ctx.billingTerms,
    sections,
    scope_plan: plan,
    confidence_level: confidence,
    assumptions,
    missing_information: missing,
    warnings,
    created_at: nowIso(),
    created_by: 'usuario_interno',
    updated_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Persistencia y CRUD
// ---------------------------------------------------------------------------

export function createProposal(input: ProposalInput, createdBy: string, plan: ScopePlan | null = null): FeeProposal {
  const prop = generateProposal(input, plan);
  prop.created_by = createdBy || 'usuario_interno';
  return proposalsRepo.save(prop);
}

export function getProposal(id: string): FeeProposal | null {
  return proposalsRepo.get(id);
}

export function listProposals(): FeeProposal[] {
  return proposalsRepo.list().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function findProposalsByCalculation(calcId: string): FeeProposal[] {
  return proposalsRepo.find((p) => p.case_or_calculation_id === calcId);
}

export function deleteProposal(id: string): boolean {
  return proposalsRepo.delete(id);
}

/** Saneo de una parte (firma/cliente) entrante en una edición. */
function sanitizeParty(role: 'firm' | 'client', a: unknown, current: ProposalParty): ProposalParty {
  if (!a || typeof a !== 'object') return current;
  const o = a as Record<string, unknown>;
  const s = (v: unknown, d: string | null): string | null => (typeof v === 'string' ? (v.trim() || null) : d);
  return {
    role,
    name: s(o.name, current.name),
    legal_form: s(o.legal_form, current.legal_form),
    tax_id: s(o.tax_id, current.tax_id),
    address: s(o.address, current.address),
    representative: s(o.representative, current.representative),
  };
}

/** Saneo de una sección editada por el usuario interno. */
function sanitizeSection(a: unknown, order: number): ProposalSection {
  const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const hasId = typeof o.id === 'string' && (o.id as string).startsWith('ps_');
  return {
    id: hasId ? (o.id as string) : newId('ps'),
    key: typeof o.key === 'string' && o.key.trim() ? (o.key as string).trim() : `seccion_${order}`,
    heading: typeof o.heading === 'string' ? (o.heading as string) : `${order}.`,
    body: typeof o.body === 'string' ? (o.body as string) : '',
    client_visible: typeof o.client_visible === 'boolean' ? (o.client_visible as boolean) : true,
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Edición por el usuario interno: permite ajustar secciones, partes, cifras,
 * alcance/exclusiones, validez y facturación. No recalcula cifras (son heredadas
 * de la estimación y editables a mano); sólo persiste lo recibido.
 */
export function updateProposal(id: string, patch: Partial<FeeProposal> | Record<string, unknown>): FeeProposal | null {
  const current = proposalsRepo.get(id);
  if (!current) return null;
  const p = patch as Record<string, unknown>;
  const next: FeeProposal = { ...current };

  if (typeof p.title === 'string') next.title = p.title;
  if (typeof p.reference === 'string') next.reference = p.reference.trim() || null;
  if (typeof p.confidential === 'boolean') next.confidential = p.confidential;
  if (typeof p.vat_included === 'boolean') next.vat_included = p.vat_included;
  if (typeof p.expenses_included === 'boolean') next.expenses_included = p.expenses_included;
  if (p.validity_days !== undefined) next.validity_days = numOrNull(p.validity_days);
  if (typeof p.billing_terms === 'string') next.billing_terms = p.billing_terms.trim() || null;
  if (p.rate_used !== undefined) next.rate_used = numOrNull(p.rate_used);
  if (p.fee_min !== undefined) next.fee_min = numOrNull(p.fee_min);
  if (p.fee_recommended !== undefined) next.fee_recommended = numOrNull(p.fee_recommended);
  if (p.fee_max !== undefined) next.fee_max = numOrNull(p.fee_max);
  if (Array.isArray(p.included_elements)) next.included_elements = cleanArray(p.included_elements as string[]);
  if (Array.isArray(p.excluded_services)) next.excluded_services = cleanArray(p.excluded_services as string[]);
  if (p.firm) next.firm = sanitizeParty('firm', p.firm, current.firm);
  if (p.client) next.client = sanitizeParty('client', p.client, current.client);
  if (Array.isArray(p.sections)) {
    next.sections = (p.sections as unknown[]).map((s, i) => sanitizeSection(s, i + 1));
  }

  // Rellena automáticamente los marcadores nominales con los datos actuales y
  // recalcula qué queda pendiente de confirmar.
  next.sections = fillDetailMarkers(next.sections, {
    clientName: next.client.name, clientTaxId: next.client.tax_id, clientRep: next.client.representative,
    firmRep: next.firm.representative, reference: next.reference, validity: next.validity_days,
  });
  next.missing_information = computeMissing({
    client: next.client, firm: next.firm, fee_recommended: next.fee_recommended,
    reference: next.reference, validity_days: next.validity_days, billing_terms: next.billing_terms,
  });

  next.updated_at = nowIso();
  return proposalsRepo.save(next);
}
