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
  FeeProposal, ProposalKind, ProposalParty, ProposalSection, ConfidenceLevel,
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
  if (!f.reference) m.push('Referencia interna de la propuesta.');
  if (f.validity_days === null) m.push('Validez temporal de la propuesta (días).');
  if (!f.billing_terms) m.push('Calendario de facturación y cuenta bancaria.');
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
}

function feeParagraph(c: Ctx): string {
  const base = c.feeRec === null
    ? `Los honorarios profesionales por el presente encargo se cifran en ${PH} (a concretar).`
    : `Los honorarios profesionales por el presente encargo se estiman en ${money(c.feeRec, c.currency)}`
      + `, con un rango orientativo entre ${money(c.feeMin, c.currency)} y ${money(c.feeMax, c.currency)}`
      + `, sobre la base de una dedicación estimada de ${c.hoursRec ?? PH} horas y una tarifa de ${c.rate ?? PH} €/hora.`;
  const lines = [base];
  lines.push(
    'Los honorarios indicados no incluyen el Impuesto sobre el Valor Añadido (IVA), que se repercutirá al '
    + 'tipo legal vigente, ni los gastos y suplidos, que se facturarán por separado.',
  );
  if (c.lowConfidence) {
    lines.push(
      'La presente cifra es orientativa y revisable: se ha calculado a partir de parámetros de referencia y '
      + 'quedará sujeta a confirmación una vez definido el alcance definitivo del encargo (honorarios sugeridos, '
      + 'no vinculantes).',
    );
  }
  return lines.join('\n\n');
}

function commonSections(c: Ctx): RawSection[] {
  const s: RawSection[] = [];
  const clientName = c.client.name || DM.client;
  const firmName = nameOr(c.firm, 'la Firma');

  s.push({
    key: 'encabezado', numbered: false,
    heading: 'Encabezado',
    body: [
      dateEs(c.dateIso),
      `A la atención de: ${clientName}`,
      `Representante: ${DM.clientRep}   ·   CIF/NIF: ${DM.cif}`,
      `Referencia: ${DM.reference}`,
      `Asunto: Propuesta de honorarios profesionales — ${c.serviceLabel}`,
    ].join('\n'),
  });

  s.push({
    key: 'confidencial', numbered: false,
    heading: 'Carácter confidencial',
    body: 'Documento confidencial. La presente propuesta se dirige exclusivamente a su destinatario y no podrá '
      + 'ser divulgada a terceros sin el consentimiento previo de la Firma.',
  });

  s.push({
    key: 'antecedentes',
    heading: 'Antecedentes',
    body: c.description
      ? c.description
      : `El Cliente ha solicitado a la Firma asesoramiento en relación con ${PH} (concretar los antecedentes del encargo).`,
  });

  s.push({
    key: 'objeto',
    heading: 'Objeto del encargo',
    body: `El objeto de la presente propuesta (la **"Propuesta"**) es la prestación por ${firmName} (la **"Firma"**) `
      + `a favor de ${clientName} (el **"Cliente"**) de los servicios jurídicos de ${c.serviceLabel} que se describen a continuación.`,
  });

  s.push({
    key: 'alcance',
    heading: 'Alcance de los servicios',
    body: 'El alcance de los servicios comprende, con carácter enunciativo:\n'
      + bullets([...c.included, ...c.tasks], `${PH} (concretar el alcance de los servicios)`),
  });

  s.push({
    key: 'exclusiones',
    heading: 'Servicios excluidos',
    body: 'Quedan expresamente excluidos de la presente Propuesta, salvo pacto adicional por escrito:\n'
      + bullets(
        c.excluded.length ? c.excluded : [
          'Cualquier servicio no descrito expresamente en el apartado de alcance.',
          'Segunda instancia, recursos extraordinarios y ejecución, salvo pacto expreso.',
          'Tributos, tasas y aranceles oficiales, así como honorarios de terceros (procurador, notario, peritos).',
        ],
        `${PH} (concretar exclusiones)`,
      ),
  });

  s.push({
    key: 'equipo',
    heading: 'Equipo de trabajo',
    body: `El encargo será atendido por el equipo de ${firmName}, bajo la dirección de ${c.firm.representative || DM.firmRep}, `
      + 'con la participación de los perfiles profesionales adecuados a cada actuación (socio, asociado y personal de apoyo).',
  });

  s.push({ key: 'honorarios', heading: 'Honorarios profesionales', body: feeParagraph(c) });

  s.push({
    key: 'gastos',
    heading: 'Gastos, suplidos e impuestos',
    body: 'Los honorarios no comprenden los gastos y suplidos necesarios para la prestación del servicio (entre '
      + 'otros, tasas judiciales, aranceles notariales y registrales, honorarios de procurador y peritos, y '
      + 'desplazamientos), que se facturarán por separado previa justificación.\n\n'
      + 'Todas las cantidades se entienden sin IVA, que se añadirá al tipo legalmente aplicable en cada factura.',
  });

  s.push({
    key: 'facturacion',
    heading: 'Facturación y forma de pago',
    body: c.billingTerms
      ? c.billingTerms
      : `La facturación se realizará conforme al calendario que se acuerde entre las partes (por hitos o períodos). `
        + `El pago se efectuará mediante transferencia a la cuenta ${PH} en el plazo de ${PH} días desde la fecha de factura.`,
  });

  s.push({
    key: 'validez',
    heading: 'Validez de la propuesta',
    body: `La presente propuesta tiene una validez de ${c.validityDays != null ? c.validityDays : DM.validity} días naturales desde su fecha de emisión. `
      + 'Transcurrido dicho plazo sin aceptación, quedará sin efecto y podrá ser objeto de revisión.',
  });

  s.push({
    key: 'confidencialidad_datos',
    heading: 'Confidencialidad y protección de datos',
    body: 'Las partes se obligan a mantener la confidencialidad de cuanta información intercambien con ocasión del '
      + 'presente encargo.\n\nEl tratamiento de datos personales se realizará conforme al Reglamento (UE) 2016/679 '
      + '(RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD), con la única finalidad de la prestación de los servicios descritos.',
  });

  return s;
}

function acceptanceSections(c: Ctx): RawSection[] {
  const firmName = nameOr(c.firm, 'la Firma');
  const clientName = c.client.name || DM.client;
  return [
    {
      key: 'aceptacion',
      heading: 'Aceptación de la propuesta',
      body: 'La aceptación de la presente propuesta implica la conformidad con su contenido y con las Condiciones '
        + 'Generales de Contratación que, en su caso, se adjuntan como anexo. Para su aceptación bastará la firma del '
        + 'presente documento y su devolución a la Firma. La firma electrónica tendrá el mismo valor que la manuscrita.',
    },
    {
      key: 'firma',
      heading: 'Firma',
      body: 'En prueba de conformidad, firman las partes en el lugar y fecha indicados.\n\n'
        + `Por la Firma: ${firmName} — ${c.firm.representative || DM.firmRep}\n`
        + `Por el Cliente: ${clientName} — ${c.client.representative || DM.clientRep}`,
    },
  ];
}

/** Secciones adicionales exclusivas del formato elaborado (dossier). */
function elaborateExtras(c: Ctx): { front: RawSection[]; mid: RawSection[]; back: RawSection[] } {
  const firmName = nameOr(c.firm, 'la Firma');
  const front: RawSection[] = [
    {
      key: 'portada', numbered: false, heading: 'Portada',
      body: `PROPUESTA DE HONORARIOS PROFESIONALES\n${c.serviceLabel}\n\n${firmName}\n${dateEs(c.dateIso)}`,
    },
    {
      key: 'indice', numbered: false, heading: 'Índice',
      body: 'El presente documento se estructura en los apartados que se relacionan a continuación (índice '
        + 'generado automáticamente en la versión final).',
    },
    {
      key: 'carta_presentacion', numbered: false, heading: 'Carta de presentación',
      body: `Estimado/a ${c.client.representative || DM.clientRep}:\n\nNos complace remitirle la presente propuesta para la `
        + `prestación de servicios de ${c.serviceLabel}. Quedamos a su disposición para aclarar cualquier extremo.`,
    },
    {
      key: 'presentacion_firma', heading: 'Presentación de la Firma',
      body: `${firmName} es un despacho de abogados especializado en ${c.serviceLabel}. `
        + `Nuestros valores diferenciales y credenciales se detallan más adelante (${PH} a completar con datos de la Firma).`,
    },
    {
      key: 'comprension_encargo', heading: 'Comprensión del encargo',
      body: c.description
        ? `Según entendemos el encargo: ${c.description}`
        : `Nuestra comprensión del encargo es la siguiente: ${PH} (a concretar con el Cliente).`,
    },
  ];
  const mid: RawSection[] = [
    {
      key: 'metodologia', heading: 'Metodología de trabajo',
      body: 'Nuestra metodología combina un análisis jurídico riguroso con una gestión de proyecto orientada a '
        + 'resultados: (i) análisis y estrategia; (ii) ejecución; (iii) seguimiento e interlocución continua con el Cliente.',
    },
    {
      key: 'fases', heading: 'Fases del proyecto',
      body: 'El encargo se desarrollará en las siguientes fases:\n'
        + bullets(c.included.length ? c.included : c.tasks, `${PH} (concretar las fases del proyecto)`),
    },
    {
      key: 'cronograma', heading: 'Cronograma',
      body: `Se propone el siguiente calendario orientativo, a ajustar con el Cliente: ${PH} (indicar hitos y plazos).`,
    },
    {
      key: 'premisas', heading: 'Premisas y asunciones',
      body: 'La presente propuesta se ha elaborado bajo las siguientes premisas. Si cambiaran, los honorarios y '
        + 'plazos podrían revisarse:\n'
        + bullets([
          `Alcance limitado a lo descrito en el apartado correspondiente.`,
          `Dedicación estimada de ${c.hoursRec ?? PH} horas.`,
          `Disponibilidad de la información y documentación necesarias por parte del Cliente.`,
        ], `${PH}`),
    },
    {
      key: 'credenciales', heading: 'Credenciales y experiencia relevante',
      body: `Experiencia de la Firma en asuntos similares de ${c.serviceLabel}: ${PH} (aportar credenciales, `
        + 'precedentes o reconocimientos, si el Cliente los solicita).',
    },
  ];
  const back: RawSection[] = [
    {
      key: 'condiciones_juridicas', heading: 'Condiciones jurídicas',
      body: 'Las presentes condiciones se completan con las Condiciones Generales de Contratación de la Firma, que '
        + 'se adjuntan como anexo y que incluyen, entre otras, cláusulas de limitación de responsabilidad, '
        + 'confidencialidad, protección de datos y prevención del blanqueo de capitales.',
    },
    {
      key: 'anexos', numbered: false, heading: 'Anexos',
      body: `- Anexo I. Condiciones Generales de Contratación.\n- Anexo II. ${PH} (anexo económico o credenciales, si procede).`,
    },
  ];
  return { front, mid, back };
}

function assembleSimple(c: Ctx): RawSection[] {
  return [...commonSections(c), ...acceptanceSections(c)];
}

function assembleElaborate(c: Ctx): RawSection[] {
  const { front, mid, back } = elaborateExtras(c);
  const common = commonSections(c);
  const byKey = (k: string) => common.find((s) => s.key === k)!;
  // Orden dossier: portada/índice/carta/presentación/comprensión → antecedentes/objeto/alcance/exclusiones
  // → metodología/fases/cronograma → equipo/credenciales/premisas → honorarios/gastos/facturación
  // → condiciones jurídicas/validez → aceptación/firma → anexos.
  return [
    ...front,
    byKey('antecedentes'), byKey('objeto'), byKey('alcance'), byKey('exclusiones'),
    mid[0], mid[1], mid[2], // metodología, fases, cronograma
    byKey('equipo'), mid[4], mid[3], // credenciales, premisas
    byKey('honorarios'), byKey('gastos'), byKey('facturacion'),
    back[0], byKey('validez'), // condiciones jurídicas, validez
    ...acceptanceSections(c),
    back[1], // anexos
  ];
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

export function generateProposal(input: ProposalInput): FeeProposal {
  const id = newId('prop');
  const kind: ProposalKind = input.kind === 'elaborate' ? 'elaborate' : 'simple';
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
  const included = cleanArray(input.included_elements);
  const excluded = cleanArray(input.excluded_services);

  const ctx: Ctx = {
    kind, serviceLabel, currency,
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
  };

  const rawSections = numberSections(kind === 'elaborate' ? assembleElaborate(ctx) : assembleSimple(ctx));
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

  const assumptions: string[] = [
    'Los honorarios se han calculado con la tarifa base de 250 €/hora salvo indicación de una tarifa específica (Regla 2).',
    'Salvo indicación expresa, los honorarios no incluyen IVA ni gastos/suplidos (Regla 9).',
  ];

  const warnings: string[] = [
    'Propuesta generada automáticamente a partir de una estimación: es un borrador interno; revísela y ajústela '
    + 'antes de enviarla al Cliente (Regla 1).',
  ];
  if (ctx.lowConfidence) {
    warnings.push('Las cifras económicas son orientativas (confianza baja): confírmelas con criterio profesional '
      + 'antes de proponerlas al Cliente.');
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

export function createProposal(input: ProposalInput, createdBy: string): FeeProposal {
  const prop = generateProposal(input);
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
