/**
 * admin/seed.ts — Poblado de datos MOCK coherentes (Tarea B2).
 *
 * Crea datos FICTICIOS de demostración a través de los repositorios tipados y,
 * donde aporta, a través de los servicios ya existentes. Respeta al 100% las
 * reglas maestras:
 *
 *  - R2: la tarifa base es 250 €/h (se importa BASE_HOURLY_RATE; nunca se hardcodea
 *    en otro sitio). Las categorías nacen con default_hourly_rate = 250.
 *  - R5/R6: todo registro y toda fórmula nacen en "pending_review". El cambio de
 *    estado SÓLO se hace vía los módulos de revisión (recordReview / formulaReview),
 *    que son el único punto legítimo de aprobación/rechazo (R4/R7).
 *  - R12: NADA se inventa como real. Todos los datos son claramente ficticios
 *    (clientes tipo "Acme SL", "Beta SA"...) y se marcan con
 *    notes: "dato ficticio de demostracion". Los campos ausentes son null/"unknown".
 *  - R3: las fórmulas aprobadas pertenecen a categorías que SÍ tienen registros
 *    aprobados, para que el generador y la calculadora tengan base real.
 *  - R17: se guarda historial de cálculos vía feeCalculator.saveCalculation.
 *
 * Uso:  export PATH="$HOME/.local/node/bin:$PATH"; node admin/seed.ts
 */

import { BASE_HOURLY_RATE, DEFAULT_CURRENCY } from '../backend/config/factors.ts';
import {
  documentsRepo, recordsRepo, categoriesRepo,
  formulasRepo, approvedFormulasRepo, calculationsRepo,
} from '../backend/storage/index.ts';
import { newId, nowIso } from '../backend/utils/id.ts';
import { approveRecord, rejectRecord } from '../services/recordReview.ts';
import { generateAndSaveFormula } from '../services/formulaGenerator.ts';
import { approveFormula } from '../services/formulaReview.ts';
import { saveCalculation } from '../services/feeCalculator.ts';
import type {
  ServiceCategory, UploadedDocument, ExtractedWorkRecord,
  PricingMethod, DocumentType, ExtractionMethod, ExtractionStatus,
  ConfidenceLevel, FeeType, ComplexityLevel, UrgencyLevel, SourceLocation,
} from '../backend/models/index.ts';

const DEMO_NOTE = 'dato ficticio de demostracion';
const SEEDER = 'seed_script';
const APPROVER = 'admin_demo';

// ---------------------------------------------------------------------------
// Pequeño contador de entidades creadas, para el resumen final.
// ---------------------------------------------------------------------------
const counts = {
  categories: 0,
  documents: 0,
  records_total: 0,
  records_approved: 0,
  records_pending: 0,
  records_rejected: 0,
  formulas_pending: 0,
  formulas_approved: 0,
  approved_formulas_copy: 0,
  calculations: 0,
};

// ---------------------------------------------------------------------------
// 0. Estado limpio: el seed es idempotente (vacía antes de poblar).
// ---------------------------------------------------------------------------
function clearAll(): void {
  documentsRepo.clear();
  recordsRepo.clear();
  categoriesRepo.clear();
  formulasRepo.clear();
  approvedFormulasRepo.clear();
  calculationsRepo.clear();
}

// ---------------------------------------------------------------------------
// 1. Categorías de servicio (12 áreas reales de ILP). Todas con
//    default_hourly_rate = 250 (R2).
// ---------------------------------------------------------------------------
interface CatSeed {
  name: string;
  description: string;
  subcategories: string[];
  default_pricing_method: PricingMethod;
  default_complexity_factor: number;
}

// Las 12 áreas de práctica reales de ILP Abogados (ilpabogados.com/#areas).
// Todas nacen con default_hourly_rate = 250 (R2). Las subcategorías coinciden con
// el catálogo del clasificador (services/serviceClassifier.ts) para mantener coherencia.
const CATEGORY_SEEDS: CatSeed[] = [
  {
    name: 'Regulatorio financiero',
    description: 'DORA, MiCA, MiFID II y supervisión: autorizaciones, criptoactivos y relación con reguladores.',
    subcategories: ['MiFID II', 'MiCA y criptoactivos', 'DORA y resiliencia operativa', 'Supervisión y autorizaciones', 'Folletos y emisiones'],
    default_pricing_method: 'hourly',
    default_complexity_factor: 1.2,
  },
  {
    name: 'M&A',
    description: 'Fusiones, adquisiciones y joint ventures: SPA, due diligence y acuerdos de inversión.',
    subcategories: ['Adquisiciones', 'Fusiones', 'Joint ventures', 'Due diligence en M&A', 'Acuerdos de inversión'],
    default_pricing_method: 'blended',
    default_complexity_factor: 1.2,
  },
  {
    name: 'Asesoramiento corporativo',
    description: 'Gobierno corporativo y societario: operaciones societarias, juntas, consejos y pactos de socios.',
    subcategories: ['Gobierno corporativo', 'Operaciones societarias', 'Secretaría societaria', 'Juntas y consejos', 'Pactos de socios'],
    default_pricing_method: 'hourly',
    default_complexity_factor: 1.0,
  },
  {
    name: 'Compliance',
    description: 'Cumplimiento normativo y supervisión: prevención penal, AML, canal de denuncias y matriz de riesgos.',
    subcategories: ['Prevención penal', 'Prevención de blanqueo (AML)', 'Canal de denuncias', 'Código ético y conducta', 'Matriz de riesgos'],
    default_pricing_method: 'monthly',
    default_complexity_factor: 1.0,
  },
  {
    name: 'Concursal',
    description: 'Concurso y pre-concurso: administración concursal, calificación y acciones de reintegración.',
    subcategories: ['Pre-concurso', 'Concurso de acreedores', 'Calificación concursal', 'Acciones de reintegración'],
    default_pricing_method: 'hourly',
    default_complexity_factor: 1.15,
  },
  {
    name: 'Reestructuraciones',
    description: 'Reestructuración financiera y operativa: refinanciación, planes y homologación de deuda.',
    subcategories: ['Reestructuración financiera', 'Planes de reestructuración', 'Refinanciación de deuda', 'Reestructuración operativa'],
    default_pricing_method: 'blended',
    default_complexity_factor: 1.2,
  },
  {
    name: 'Startups',
    description: 'Rondas y pactos de socios: financiación, term sheets, ESOP y constitución.',
    subcategories: ['Rondas de financiación', 'Pactos de socios', 'Stock options / ESOP', 'Constitución de startup', 'Term sheets'],
    default_pricing_method: 'hourly',
    default_complexity_factor: 1.0,
  },
  {
    name: 'Energías renovables',
    description: 'Renovables y PPA: desarrollo de proyectos, permitting y M&A de activos renovables.',
    subcategories: ['PPA', 'Desarrollo de proyectos', 'Permitting y autorizaciones', 'M&A renovables'],
    default_pricing_method: 'blended',
    default_complexity_factor: 1.15,
  },
  {
    name: 'Procesal civil',
    description: 'Litigación y arbitraje: reclamaciones, medidas cautelares y ejecuciones.',
    subcategories: ['Litigación civil', 'Arbitraje', 'Reclamación de cantidad', 'Medidas cautelares', 'Ejecuciones'],
    default_pricing_method: 'blended',
    default_complexity_factor: 1.2,
  },
  {
    name: 'Procesal penal',
    description: 'Defensa penal económica: delitos societarios, investigaciones internas y diligencias.',
    subcategories: ['Defensa penal económica', 'Delitos societarios', 'Investigaciones internas', 'Diligencias previas'],
    default_pricing_method: 'hourly',
    default_complexity_factor: 1.25,
  },
  {
    name: 'Protección de datos',
    description: 'RGPD y LOPDGDD: adaptación, EIPD, DPO externo y brechas de seguridad.',
    subcategories: ['RGPD y LOPDGDD', 'Evaluaciones de impacto (EIPD)', 'Delegado de protección de datos (DPO)', 'Brechas de seguridad', 'Auditoría de privacidad'],
    default_pricing_method: 'fixed',
    default_complexity_factor: 1.0,
  },
  {
    name: 'Secretarías de consejo',
    description: 'Asesoría a consejos de administración: secretaría, actas y gobierno del consejo.',
    subcategories: ['Secretaría del consejo', 'Actas y acuerdos', 'Asesoramiento a consejeros', 'Gobierno del consejo'],
    default_pricing_method: 'monthly',
    default_complexity_factor: 1.0,
  },
];

function seedCategories(): ServiceCategory[] {
  const created: ServiceCategory[] = [];
  for (const c of CATEGORY_SEEDS) {
    const cat: ServiceCategory = {
      id: newId('cat'),
      name: c.name,
      description: c.description,
      subcategories: c.subcategories,
      default_pricing_method: c.default_pricing_method,
      default_hourly_rate: BASE_HOURLY_RATE, // R2: 250 inicial.
      default_complexity_factor: c.default_complexity_factor,
      active: true,
    };
    categoriesRepo.save(cat);
    created.push(cat);
    counts.categories += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// 2. Documentos mock (4) con trazabilidad (R8): texto/tablas + source_locations.
// ---------------------------------------------------------------------------
interface DocSeed {
  original_filename: string;
  file_type: string;
  document_type: DocumentType;
  extraction_method: ExtractionMethod;
  extraction_status: ExtractionStatus;
  confidence_level: ConfidenceLevel;
  extracted_text: string | null;
  extracted_tables: UploadedDocument['extracted_tables'];
  warnings: string[];
  source_locations: SourceLocation[];
}

function seedDocuments(): UploadedDocument[] {
  const docSeeds: DocSeed[] = [
    {
      original_filename: 'factura_acme_2025_MA_adquisicion.pdf',
      file_type: 'pdf',
      document_type: 'invoice',
      extraction_method: 'native_text',
      extraction_status: 'completed',
      confidence_level: 'high',
      extracted_text:
        'FACTURA (FICTICIA DE DEMOSTRACION)\nCliente: Acme Capital SL\nAsunto: Adquisición de Beta Tech (SPA)\n'
        + 'Horas: 150  Tarifa: 300 EUR/h  Total: 45000 EUR\nMoneda: EUR  Tipo: hourly',
      extracted_tables: [],
      warnings: [],
      source_locations: [
        { field: 'total_fee', page: 1, snippet: 'Total: 45000 EUR' },
        { field: 'hours_worked', page: 1, snippet: 'Horas: 150' },
        { field: 'hourly_rate', page: 1, snippet: 'Tarifa: 300 EUR/h' },
      ],
    },
    {
      original_filename: 'timesheet_startups_q1.xlsx',
      file_type: 'xlsx',
      document_type: 'timesheet',
      extraction_method: 'spreadsheet_parser',
      extraction_status: 'completed',
      confidence_level: 'high',
      extracted_text: null,
      extracted_tables: [
        {
          name: 'Hoja1',
          headers: ['Cliente', 'Servicio', 'Horas', 'Tarifa', 'Importe', 'Moneda'],
          rows: [
            ['Orion Startup SL', 'Ronda seed', 24, 250, 6000, 'EUR'],
            ['Lyra Tech SL', 'Ronda serie A', 36, 250, 9000, 'EUR'],
            ['Nadir SL', 'Pacto de socios', 18, 250, 4500, 'EUR'],
          ],
          detected_columns: {
            client: 0, service: 1, hours: 2, rate: 3, amount: 4, currency: 5,
          },
        },
      ],
      warnings: [],
      source_locations: [
        { field: 'table', sheet: 'Hoja1', snippet: 'Cliente/Servicio/Horas/Tarifa/Importe' },
      ],
    },
    {
      original_filename: 'propuesta_proteccion_datos_RGPD.docx',
      file_type: 'docx',
      document_type: 'proposal',
      extraction_method: 'native_text',
      extraction_status: 'completed',
      confidence_level: 'medium',
      extracted_text:
        'PROPUESTA (FICTICIA DE DEMOSTRACION)\nCliente: Helios SL\nServicio: Adaptación RGPD / LOPDGDD\n'
        + 'Honorario fijo: 3500 EUR. Incluye auditoría, registro de actividades y políticas.',
      extracted_tables: [],
      warnings: ['Documento de propuesta: importe es estimación, no factura final.'],
      source_locations: [
        { field: 'total_fee', snippet: 'Honorario fijo: 3500 EUR' },
        { field: 'fee_type', snippet: 'Honorario fijo' },
      ],
    },
    {
      original_filename: 'email_consulta_compliance.txt',
      file_type: 'txt',
      document_type: 'email',
      extraction_method: 'native_text',
      extraction_status: 'completed',
      confidence_level: 'low',
      extracted_text:
        'CORREO (FICTICIO DE DEMOSTRACION)\nDe: cliente@zeta.example\n'
        + 'Consulta general sobre compliance penal. No se mencionan horas ni importe concreto.',
      extracted_tables: [],
      warnings: ['Información insuficiente: el correo no especifica horas ni importe.'],
      source_locations: [
        { field: 'service_description', snippet: 'Consulta general sobre compliance penal' },
      ],
    },
  ];

  const created: UploadedDocument[] = [];
  for (const d of docSeeds) {
    const doc: UploadedDocument = {
      id: newId('doc'),
      original_filename: d.original_filename,
      file_type: d.file_type,
      uploaded_at: nowIso(),
      uploaded_by: SEEDER,
      document_type: d.document_type,
      extraction_status: d.extraction_status,
      extraction_method: d.extraction_method,
      extracted_text: d.extracted_text,
      extracted_tables: d.extracted_tables,
      warnings: d.warnings,
      source_locations: d.source_locations,
      confidence_level: d.confidence_level,
      stored_path: null, // sin binario real: son documentos de demostración.
    };
    documentsRepo.save(doc);
    created.push(doc);
    counts.documents += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// 3. Registros extraídos (12). Nacen TODOS en pending_review (R5); el estado
//    final se aplica luego SÓLO vía recordReview (approve/reject).
// ---------------------------------------------------------------------------
type FinalStatus = 'approved' | 'pending_review' | 'rejected';

interface RecordSeed {
  document_id: string;
  client_name: string | null;
  matter_name: string | null;
  service_category: string;
  service_subcategory: string | null;
  service_description: string | null;
  date: string | null;
  total_fee: number | null;
  currency: string | null;
  fee_type: FeeType;
  hours_worked: number | null;
  hourly_rate: number | null;
  professional_role: string | null;
  number_of_professionals: number | null;
  complexity_level: ComplexityLevel;
  urgency_level: UrgencyLevel;
  discounts: number | null;
  payment_terms: string | null;
  extracted_from: string | null;
  source_location: SourceLocation[];
  confidence_level: ConfidenceLevel;
  /** Estado deseado tras la revisión simulada. */
  final_status: FinalStatus;
  reject_reason?: string;
}

function buildRecordSeeds(docs: UploadedDocument[]): RecordSeed[] {
  const [docMA, docTimesheet, docPropuesta, docEmail] = docs;

  return [
    // --- M&A / Adquisiciones (3 approved con importe => fórmula fixed_range) ---
    {
      document_id: docMA.id,
      client_name: 'Acme Capital SL',
      matter_name: 'Adquisición de Beta Tech (SPA)',
      service_category: 'M&A',
      service_subcategory: 'Adquisiciones',
      service_description: 'Compraventa de participaciones de Beta Tech: SPA, due diligence y cierre.',
      date: '2025-02-10',
      total_fee: 45000,
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 150,
      hourly_rate: 300, // tarifa/hora EXPLÍCITA
      professional_role: 'Socio',
      number_of_professionals: 3,
      complexity_level: 'high',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: '30 días',
      extracted_from: 'Factura PDF Acme Capital',
      source_location: [{ field: 'total_fee', page: 1, snippet: 'Total: 45000 EUR' }],
      confidence_level: 'high',
      final_status: 'approved',
    },
    {
      document_id: docMA.id,
      client_name: 'Vega Holding SA',
      matter_name: 'Compra de participaciones Delta',
      service_category: 'M&A',
      service_subcategory: 'Adquisiciones',
      service_description: 'Adquisición del 100% de Delta SL con manifestaciones y garantías.',
      date: '2025-03-05',
      total_fee: 60000,
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 200,
      hourly_rate: 300,
      professional_role: 'Socio',
      number_of_professionals: 3,
      complexity_level: 'high',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: '30 días',
      extracted_from: 'Factura PDF Vega',
      source_location: [{ field: 'total_fee', snippet: '60000 EUR' }],
      confidence_level: 'high',
      final_status: 'approved',
    },
    {
      document_id: docMA.id,
      client_name: 'Sirius SL',
      matter_name: 'Adquisición exprés Nova',
      service_category: 'M&A',
      service_subcategory: 'Adquisiciones',
      service_description: 'Adquisición de activos de Nova, operación estándar.',
      date: '2025-01-20',
      total_fee: 36000,
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 144,
      hourly_rate: null, // SIN tarifa/hora => aguas abajo se usa 250
      professional_role: 'Asociado senior',
      number_of_professionals: 2,
      complexity_level: 'medium',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: 'Contado',
      extracted_from: 'Factura PDF Sirius',
      source_location: [{ field: 'total_fee', snippet: '36000 EUR' }],
      confidence_level: 'medium',
      final_status: 'approved',
    },

    // --- Startups / Rondas de financiación (3 approved con horas+tarifa) ---
    {
      document_id: docTimesheet.id,
      client_name: 'Orion Startup SL',
      matter_name: 'Ronda seed Orion',
      service_category: 'Startups',
      service_subcategory: 'Rondas de financiación',
      service_description: 'Asesoramiento legal en ronda seed (term sheet y SAFE).',
      date: '2025-02-15',
      total_fee: 6000,
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 24,
      hourly_rate: 250,
      professional_role: 'Asociado',
      number_of_professionals: 1,
      complexity_level: 'medium',
      urgency_level: 'urgent', // caso con URGENCIA
      discounts: null,
      payment_terms: '15 días',
      extracted_from: 'Timesheet XLSX fila 1',
      source_location: [{ field: 'table', sheet: 'Hoja1', cell: 'A2:F2' }],
      confidence_level: 'high',
      final_status: 'approved',
    },
    {
      document_id: docTimesheet.id,
      client_name: 'Lyra Tech SL',
      matter_name: 'Ronda serie A Lyra',
      service_category: 'Startups',
      service_subcategory: 'Rondas de financiación',
      service_description: 'Ronda serie A: pacto de socios y entrada de inversor.',
      date: '2025-03-01',
      total_fee: 9000,
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 36,
      hourly_rate: 250,
      professional_role: 'Asociado senior',
      number_of_professionals: 1,
      complexity_level: 'medium',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: '30 días',
      extracted_from: 'Timesheet XLSX fila 2',
      source_location: [{ field: 'table', sheet: 'Hoja1', cell: 'A3:F3' }],
      confidence_level: 'high',
      final_status: 'approved',
    },
    {
      document_id: docTimesheet.id,
      client_name: 'Nadir SL',
      matter_name: 'Pacto de socios Nadir',
      service_category: 'Startups',
      service_subcategory: 'Rondas de financiación',
      service_description: 'Negociación de pacto de socios para ampliación.',
      date: '2025-03-10',
      total_fee: 4050, // 4500 con 10% de descuento aplicado
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 18,
      hourly_rate: 250,
      professional_role: 'Asociado',
      number_of_professionals: 1,
      complexity_level: 'low',
      urgency_level: 'normal',
      discounts: 10, // caso con DESCUENTO
      payment_terms: '30 días',
      extracted_from: 'Timesheet XLSX fila 3',
      source_location: [{ field: 'table', sheet: 'Hoja1', cell: 'A4:F4' }],
      confidence_level: 'medium',
      final_status: 'approved',
    },

    // --- Protección de datos / RGPD (precio FIJO; 1 approved + 1 pending) ---
    {
      document_id: docPropuesta.id,
      client_name: 'Helios SL',
      matter_name: 'Adaptación RGPD Helios',
      service_category: 'Protección de datos',
      service_subcategory: 'RGPD y LOPDGDD',
      service_description: 'Adaptación integral a RGPD/LOPDGDD: auditoría, RAT y políticas.',
      date: '2025-04-01',
      total_fee: 3500,
      currency: 'EUR',
      fee_type: 'fixed', // PRECIO FIJO
      hours_worked: null,
      hourly_rate: null,
      professional_role: 'Asociado',
      number_of_professionals: 1,
      complexity_level: 'low',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: 'Anticipo 50%',
      extracted_from: 'Propuesta DOCX Helios',
      source_location: [{ field: 'total_fee', snippet: 'Honorario fijo: 3500 EUR' }],
      confidence_level: 'medium',
      final_status: 'approved',
    },
    {
      document_id: docPropuesta.id,
      client_name: 'Rhea SA',
      matter_name: 'DPO externo Rhea',
      service_category: 'Protección de datos',
      service_subcategory: 'Delegado de protección de datos (DPO)',
      service_description: 'Servicio de DPO externo anual.',
      date: '2025-04-12',
      total_fee: 4200,
      currency: 'EUR',
      fee_type: 'fixed',
      hours_worked: null,
      hourly_rate: null,
      professional_role: 'Asociado',
      number_of_professionals: 1,
      complexity_level: 'medium',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: 'Cuota anual',
      extracted_from: 'Propuesta DOCX Rhea',
      source_location: [{ field: 'total_fee', snippet: '4200 EUR' }],
      confidence_level: 'medium',
      final_status: 'pending_review', // queda pendiente de revisión humana
    },

    // --- Regulatorio financiero / MiCA (complejidad ALTA; 1 approved con horas+tarifa) ---
    {
      document_id: docMA.id,
      client_name: 'Crypto Nova SL',
      matter_name: 'Autorización MiCA Nova',
      service_category: 'Regulatorio financiero',
      service_subcategory: 'MiCA y criptoactivos',
      service_description: 'Solicitud de autorización como proveedor de servicios de criptoactivos (MiCA).',
      date: '2025-05-02',
      total_fee: 24000,
      currency: 'EUR',
      fee_type: 'hourly',
      hours_worked: 60,
      hourly_rate: 400,
      professional_role: 'Socio',
      number_of_professionals: 2,
      complexity_level: 'high', // COMPLEJIDAD ALTA
      urgency_level: 'very_urgent',
      discounts: null,
      payment_terms: '30 días',
      extracted_from: 'Factura PDF Crypto Nova',
      source_location: [{ field: 'total_fee', snippet: '24000 EUR' }],
      confidence_level: 'high',
      final_status: 'approved',
    },

    // --- Procesal civil / Reclamación (pending; mezcla de estados) ---
    {
      document_id: docTimesheet.id,
      client_name: 'Atlas SL',
      matter_name: 'Reclamación de cantidad Atlas',
      service_category: 'Procesal civil',
      service_subcategory: 'Reclamación de cantidad',
      service_description: 'Reclamación de cantidad por impago de facturas.',
      date: '2025-05-20',
      total_fee: 4800,
      currency: 'EUR',
      fee_type: 'blended',
      hours_worked: 16,
      hourly_rate: 250,
      professional_role: 'Asociado senior',
      number_of_professionals: 1,
      complexity_level: 'medium',
      urgency_level: 'normal',
      discounts: null,
      payment_terms: '30 días',
      extracted_from: 'Timesheet XLSX (anexo)',
      source_location: [{ field: 'total_fee', snippet: '4800 EUR' }],
      confidence_level: 'medium',
      final_status: 'pending_review',
    },

    // --- Compliance (INFORMACIÓN INSUFICIENTE; pending; categoría unknown) ---
    {
      document_id: docEmail.id,
      client_name: null, // dato ausente => null (R12)
      matter_name: null,
      service_category: 'unknown', // no se pudo clasificar con seguridad (R11/R12)
      service_subcategory: null,
      service_description: 'Consulta genérica sobre compliance penal (sin detalle).',
      date: null,
      total_fee: null, // sin importe (R12)
      currency: null,
      fee_type: 'unknown',
      hours_worked: null,
      hourly_rate: null,
      professional_role: null,
      number_of_professionals: null,
      complexity_level: 'unknown',
      urgency_level: 'unknown',
      discounts: null,
      payment_terms: null,
      extracted_from: 'Correo TXT (sin datos económicos)',
      source_location: [{ field: 'service_description', snippet: 'Consulta general sobre compliance penal' }],
      confidence_level: 'low', // INFORMACIÓN INSUFICIENTE => confidence low
      final_status: 'pending_review',
    },

    // --- Registro RECHAZADO (1): duplicado/erróneo => rejected vía recordReview ---
    {
      document_id: docPropuesta.id,
      client_name: 'Acme Capital SL',
      matter_name: 'Borrador duplicado Acme',
      service_category: 'Concursal',
      service_subcategory: 'Concurso de acreedores',
      service_description: 'Borrador duplicado por error de extracción.',
      date: '2025-02-10',
      total_fee: 9999,
      currency: 'EUR',
      fee_type: 'unknown',
      hours_worked: null,
      hourly_rate: null,
      professional_role: null,
      number_of_professionals: null,
      complexity_level: 'unknown',
      urgency_level: 'unknown',
      discounts: null,
      payment_terms: null,
      extracted_from: 'Extracción duplicada (error)',
      source_location: [{ field: 'total_fee', snippet: '9999 EUR (sospechoso)' }],
      confidence_level: 'low',
      final_status: 'rejected',
      reject_reason: 'Registro duplicado / importe no fiable; descartado en revisión.',
    },
  ];
}

function seedRecords(docs: UploadedDocument[]): ExtractedWorkRecord[] {
  const seeds = buildRecordSeeds(docs);
  const created: ExtractedWorkRecord[] = [];

  for (const s of seeds) {
    // R5: SIEMPRE nace en pending_review, sin approved_by/at.
    const rec: ExtractedWorkRecord = {
      id: newId('rec'),
      document_id: s.document_id,
      client_name: s.client_name,
      matter_name: s.matter_name,
      service_category: s.service_category,
      service_subcategory: s.service_subcategory,
      service_description: s.service_description,
      date: s.date,
      total_fee: s.total_fee,
      currency: s.currency,
      fee_type: s.fee_type,
      hours_worked: s.hours_worked,
      hourly_rate: s.hourly_rate,
      professional_role: s.professional_role,
      number_of_professionals: s.number_of_professionals,
      complexity_level: s.complexity_level,
      urgency_level: s.urgency_level,
      discounts: s.discounts,
      payment_terms: s.payment_terms,
      extracted_from: s.extracted_from,
      source_location: s.source_location,
      confidence_level: s.confidence_level,
      review_status: 'pending_review', // R5
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
      created_at: nowIso(),
      notes: DEMO_NOTE,
    };
    recordsRepo.save(rec);
    counts.records_total += 1;

    // Transición de estado SÓLO vía el módulo de revisión (R4/R7).
    if (s.final_status === 'approved') {
      approveRecord(rec.id, APPROVER);
      counts.records_approved += 1;
      created.push(recordsRepo.get(rec.id) as ExtractedWorkRecord);
    } else if (s.final_status === 'rejected') {
      rejectRecord(rec.id, s.reject_reason ?? 'Rechazado en demostración', APPROVER);
      counts.records_rejected += 1;
      created.push(recordsRepo.get(rec.id) as ExtractedWorkRecord);
    } else {
      counts.records_pending += 1;
      created.push(rec);
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// 4. Fórmulas: 3 pending + 4 approved. Las aprobadas pertenecen a categorías con
//    registros aprobados (R3). Se generan vía formulaGenerator (nacen pending,
//    R6) y se aprueban vía formulaReview (que copia a approvedFormulasRepo).
// ---------------------------------------------------------------------------
function seedFormulas(): void {
  // --- 4 fórmulas a APROBAR (categorías con registros approved) ---
  const toApprove: { service_category: string; service_subcategory?: string | null }[] = [
    { service_category: 'M&A', service_subcategory: 'Adquisiciones' },                       // 3 approved con importe
    { service_category: 'Startups', service_subcategory: 'Rondas de financiación' },         // 3 approved con horas+tarifa
    { service_category: 'Protección de datos', service_subcategory: 'RGPD y LOPDGDD' },      // 1 approved fijo
    { service_category: 'Regulatorio financiero', service_subcategory: 'MiCA y criptoactivos' }, // 1 approved con horas+tarifa
  ];

  for (const t of toApprove) {
    const f = generateAndSaveFormula({
      service_category: t.service_category,
      service_subcategory: t.service_subcategory ?? null,
      created_by: SEEDER,
    });
    const res = approveFormula(f.id, APPROVER);
    if (!res.ok) {
      throw new Error(
        `No se pudo aprobar la fórmula de ${t.service_category}/${t.service_subcategory}: faltan ${JSON.stringify(res.missing)}`,
      );
    }
    counts.formulas_approved += 1;
  }

  // --- 3 fórmulas que quedan en PENDING (sin aprobar) ---
  const toPend: { service_category: string; service_subcategory?: string | null }[] = [
    { service_category: 'Procesal civil', service_subcategory: 'Reclamación de cantidad' },          // sin approved -> base rate
    { service_category: 'Compliance', service_subcategory: 'Prevención penal' },                     // sin approved -> base rate
    { service_category: 'Asesoramiento corporativo', service_subcategory: 'Operaciones societarias' }, // sin approved -> base rate
  ];

  for (const t of toPend) {
    generateAndSaveFormula({
      service_category: t.service_category,
      service_subcategory: t.service_subcategory ?? null,
      created_by: SEEDER,
    });
    counts.formulas_pending += 1;
  }

  // Recuento real de la copia de aprobadas (debe ser solo approved).
  counts.approved_formulas_copy = approvedFormulasRepo.list().length;
}

// ---------------------------------------------------------------------------
// 5. Historial de cálculos (R17). Incluye uno que usa TARIFA BASE con warning.
// ---------------------------------------------------------------------------
function seedCalculations(): void {
  // 5.1 Cálculo con fórmula aprobada (M&A/Adquisiciones) + tarifa explícita.
  saveCalculation(
    {
      service_category: 'M&A',
      service_subcategory: 'Adquisiciones',
      estimated_hours: 120,
      professional_role: 'Socio',
      hourly_rate: 300,
      complexity_level: 'high',
      urgency_level: 'normal',
      fee_type: 'hourly',
      discount_percentage: null,
    },
    SEEDER,
  );
  counts.calculations += 1;

  // 5.2 Cálculo Startups/Rondas con urgencia y descuento (fórmula aprobada).
  saveCalculation(
    {
      service_category: 'Startups',
      service_subcategory: 'Rondas de financiación',
      estimated_hours: 30,
      professional_role: 'Asociado senior',
      hourly_rate: 250,
      complexity_level: 'medium',
      urgency_level: 'urgent',
      fee_type: 'hourly',
      discount_percentage: 10,
    },
    SEEDER,
  );
  counts.calculations += 1;

  // 5.3 Cálculo SIN tarifa (usa tarifa base 250) y SIN fórmula aprobada =>
  //     genera warning de "tarifa base" / "información insuficiente". (R2/R11)
  saveCalculation(
    {
      service_category: 'Compliance',
      service_subcategory: 'Prevención penal',
      estimated_hours: 8,
      professional_role: 'Asociado',
      hourly_rate: null, // sin tarifa => se usa la base 250
      complexity_level: 'medium',
      urgency_level: 'normal',
      fee_type: 'hourly',
      discount_percentage: null,
    },
    SEEDER,
  );
  counts.calculations += 1;

  // 5.4 Cálculo Protección de datos/RGPD (fórmula fija aprobada).
  saveCalculation(
    {
      service_category: 'Protección de datos',
      service_subcategory: 'RGPD y LOPDGDD',
      estimated_hours: 5,
      professional_role: 'Asociado',
      hourly_rate: null,
      complexity_level: 'low',
      urgency_level: 'normal',
      fee_type: 'fixed',
      discount_percentage: null,
    },
    SEEDER,
  );
  counts.calculations += 1;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------
function main(): void {
  clearAll();

  seedCategories();
  const docs = seedDocuments();
  seedRecords(docs);
  seedFormulas();
  seedCalculations();

  const baseRateCalc = calculationsRepo
    .list()
    .find((c) => c.warnings.some((w) => w.toLowerCase().includes('tarifa base')));

  console.log('====================================================');
  console.log(' SEED COMPLETADO — datos FICTICIOS de demostración');
  console.log(` Tarifa base usada: ${BASE_HOURLY_RATE} ${DEFAULT_CURRENCY}/h`);
  console.log('----------------------------------------------------');
  console.log(` Categorías de servicio .......... ${counts.categories}`);
  console.log(` Documentos subidos .............. ${counts.documents}`);
  console.log(` Registros extraídos (total) ..... ${counts.records_total}`);
  console.log(`   - approved .................... ${counts.records_approved}`);
  console.log(`   - pending_review ............. ${counts.records_pending}`);
  console.log(`   - rejected ................... ${counts.records_rejected}`);
  console.log(` Fórmulas pending_review ......... ${counts.formulas_pending}`);
  console.log(` Fórmulas approved ............... ${counts.formulas_approved}`);
  console.log(`   - copia en approvedFormulasRepo  ${counts.approved_formulas_copy}`);
  console.log(` Cálculos en historial ........... ${counts.calculations}`);
  console.log(`   - usando tarifa base + warning   ${baseRateCalc ? 'sí (' + baseRateCalc.id + ')' : 'no'}`);
  console.log('====================================================');
}

main();
