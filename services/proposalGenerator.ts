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
    + 'actuación no prevista expresamente será objeto de presupuesto separado.';
}

/** Cuerpo de "Objeto y descripción del servicio". */
function buildObjeto(c: Ctx): string {
  const parts: string[] = [];
  parts.push(`Los servicios a desarrollar por ${firmName(c)} comprenderán las tareas y trabajos relativos a la materia `
    + `de ${c.serviceLabel.toLowerCase()} objeto del presente encargo.`);
  if (c.description) parts.push(c.description);
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

/** Cuerpo de "Devengo de los honorarios y provisión de fondos" (hitos + provisión). */
function buildDevengo(c: Ctx): string {
  const scope = [...c.included, ...c.tasks];
  const hitos = scope.length
    ? 'Los honorarios fijos se devengarán conforme a los siguientes hitos, sin perjuicio de su ajuste de común '
      + 'acuerdo con el Cliente:\n' + scope.map((t) => `- ${t}: [importe]`).join('\n')
    : 'Los honorarios fijos se devengarán conforme a los siguientes hitos, sin perjuicio de su ajuste de común '
      + `acuerdo con el Cliente: ${FB.hitos}.`;
  return hitos + '\n\n'
    + `A la aceptación de esta Propuesta, el Cliente abonará una provisión de fondos de ${FB.provision}, imputable `
    + 'a los honorarios conforme se vayan devengando.\n\n'
    + 'Le agradeceríamos que, al efectuar el pago, su nombre (o el de su empresa) y el número de la presente '
    + 'Propuesta queden claramente recogidos en el concepto, a fin de garantizar un correcto seguimiento.';
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

/** Secciones comunes al estilo carta de las propuestas reales (ILP / {m}). */
function letterSections(c: Ctx): RawSection[] {
  const clientName = c.client.name || DM.client;
  const clientRep = c.client.representative || DM.clientRep;
  const s: RawSection[] = [];

  // Destinatario (N/ref., A la atención de, Asunto).
  s.push({
    key: 'destinatario', numbered: false, heading: 'Destinatario',
    body: [`N/ref.: ${DM.reference}`, `A la atención de: ${clientName}`,
      `Asunto: ${c.asunto.charAt(0).toUpperCase()}${c.asunto.slice(1)}`].join('\n'),
  });

  // Apertura con términos definidos en negrita.
  s.push({
    key: 'apertura', numbered: false, heading: 'Apertura',
    body: `Estimado/a ${clientRep}:\n\n`
      + `Atendiendo a su solicitud, ${firmName(c)} (en adelante, «ILP» o el **«Despacho»**) se complace en remitirle la `
      + `presente propuesta de honorarios profesionales (en adelante, la **«Propuesta»**), elaborada exclusivamente `
      + `para ${clientName} (en adelante, el **«Cliente»**) y de carácter confidencial.`,
  });

  s.push({ key: 'objeto', heading: 'Objeto y descripción del servicio', body: buildObjeto(c) });

  s.push({
    key: 'equipo', heading: 'Equipo de trabajo',
    body: `Los servicios descritos serán dirigidos por ${c.firm.representative || DM.firmRep}, ${FB.socio}, y serán `
      + `prestados por un equipo multidisciplinar adaptado a las necesidades del asunto, con las incorporaciones que en `
      + 'cada momento se requieran.',
  });

  s.push({ key: 'honorarios', heading: 'Honorarios profesionales', body: feeSentence(c) });

  s.push({ key: 'devengo', heading: 'Devengo de los honorarios y provisión de fondos', body: buildDevengo(c) });

  s.push({
    key: 'gastos', heading: 'Gastos, suplidos e impuestos',
    body: 'Los honorarios anteriores no comprenden los gastos y suplidos que la actuación genere (entre otros, '
      + 'aranceles registrales y notariales, tasas, honorarios de peritos o auditores y gastos de desplazamiento), que '
      + 'se repercutirán de forma independiente y previa justificación. A todas las cantidades se añadirán los '
      + 'impuestos que legalmente resulten aplicables. Quedan excluidas de esta Propuesta las actuaciones ajenas al '
      + 'objeto descrito, así como la eventual ejecución de resoluciones o la interposición de recursos '
      + 'extraordinarios, que serán objeto de presupuesto separado.',
  });

  s.push({
    key: 'condiciones', heading: 'Condiciones particulares',
    body: `La presente Propuesta tiene una validez de ${c.validityDays != null ? c.validityDays : DM.validity} días `
      + 'naturales desde su fecha. Los términos de la prestación no contemplados expresamente en esta Propuesta se '
      + 'regirán por las Condiciones Generales de Contratación adjuntas, cuya lectura recomendamos. El tratamiento de '
      + 'datos personales se realizará conforme al RGPD y a la LO 3/2018 (LOPDGDD). La aceptación de la presente '
      + 'Propuesta mediante intercambio de firmas en formato PDF o firma electrónica tendrá la misma fuerza legal y '
      + 'efecto que el intercambio de firmas manuscritas.',
  });

  return s;
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

function assembleSimple(c: Ctx): RawSection[] {
  return [...letterSections(c), ...closingSections(c)];
}

function assembleElaborate(c: Ctx): RawSection[] {
  const L = letterSections(c);
  const E = elaborateSections(c);
  const byKey = (k: string) => L.find((s) => s.key === k)!;
  // Orden dossier: destinatario/apertura → presentación → objeto → metodología → equipo → credenciales →
  // premisas → cronograma → honorarios → devengo → anexo económico → gastos → condiciones → cierre/aceptación.
  return [
    byKey('destinatario'), byKey('apertura'),
    E.presentacion,
    byKey('objeto'),
    E.metodologia,
    byKey('equipo'),
    E.credenciales,
    E.premisas,
    E.cronograma,
    byKey('honorarios'), byKey('devengo'),
    E.anexo,
    byKey('gastos'), byKey('condiciones'),
    ...closingSections(c),
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
  missing.push('Definir, en su caso, comisión de éxito, provisión de fondos e hitos de devengo (huecos "[...]" del texto).');

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
