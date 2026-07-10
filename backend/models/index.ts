/**
 * Modelos de datos principales de la Calculadora Inteligente de Honorarios.
 *
 * Usamos *union types* en vez de `enum` porque el type-stripping nativo de Node
 * no soporta enums (son construcciones con runtime). Las opciones válidas se
 * exponen además como arrays `*_VALUES` para validación en runtime.
 *
 * Regla 12: ante un dato ausente se usa `null` o `"unknown"`. NUNCA se inventa.
 */

// ----------------------------------------------------------------------------
// Enumeraciones (union types + arrays de valores para validación)
// ----------------------------------------------------------------------------

export type DocumentType =
  | 'invoice'
  | 'proposal'
  | 'engagement_letter'
  | 'timesheet'
  | 'contract'
  | 'email'
  | 'spreadsheet'
  | 'other';
export const DOCUMENT_TYPE_VALUES: DocumentType[] = [
  'invoice', 'proposal', 'engagement_letter', 'timesheet',
  'contract', 'email', 'spreadsheet', 'other',
];

export type ExtractionStatus = 'pending' | 'completed' | 'failed';
export const EXTRACTION_STATUS_VALUES: ExtractionStatus[] = ['pending', 'completed', 'failed'];

export type ExtractionMethod =
  | 'native_text'
  | 'ocr'
  | 'spreadsheet_parser'
  | 'manual_review_needed';
export const EXTRACTION_METHOD_VALUES: ExtractionMethod[] = [
  'native_text', 'ocr', 'spreadsheet_parser', 'manual_review_needed',
];

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export const CONFIDENCE_LEVEL_VALUES: ConfidenceLevel[] = ['low', 'medium', 'high'];

export type FeeType = 'hourly' | 'fixed' | 'monthly' | 'success_fee' | 'blended' | 'unknown';
export const FEE_TYPE_VALUES: FeeType[] = ['hourly', 'fixed', 'monthly', 'success_fee', 'blended', 'unknown'];

export type ComplexityLevel = 'low' | 'medium' | 'high' | 'unknown';
export const COMPLEXITY_LEVEL_VALUES: ComplexityLevel[] = ['low', 'medium', 'high', 'unknown'];

export type UrgencyLevel = 'normal' | 'urgent' | 'very_urgent' | 'unknown';
export const URGENCY_LEVEL_VALUES: UrgencyLevel[] = ['normal', 'urgent', 'very_urgent', 'unknown'];

export type ReviewStatus = 'pending_review' | 'approved' | 'rejected';
export const REVIEW_STATUS_VALUES: ReviewStatus[] = ['pending_review', 'approved', 'rejected'];

export type PricingMethod = 'hourly' | 'fixed' | 'blended' | 'monthly' | 'custom';
export const PRICING_METHOD_VALUES: PricingMethod[] = ['hourly', 'fixed', 'blended', 'monthly', 'custom'];

export type FormulaType = 'hourly' | 'fixed_range' | 'blended' | 'monthly' | 'custom';
export const FORMULA_TYPE_VALUES: FormulaType[] = ['hourly', 'fixed_range', 'blended', 'monthly', 'custom'];

/**
 * Localización dentro del documento fuente. Sostiene la regla 8 (trazabilidad).
 * `field` indica a qué dato se refiere (p.ej. "total_fee"); `page`/`cell`/`snippet`
 * apuntan al lugar exacto del que se extrajo.
 */
export interface SourceLocation {
  field?: string;
  page?: number | null;
  sheet?: string | null;
  cell?: string | null;
  line?: number | null;
  snippet?: string | null;
}

// ----------------------------------------------------------------------------
// 1. UploadedDocument — documento histórico subido a la plataforma
// ----------------------------------------------------------------------------

export interface ExtractedTable {
  name?: string | null;        // nombre de hoja o título de tabla, si se conoce
  headers: string[];
  rows: (string | number | null)[][];
  /** Columnas financieras detectadas (cliente, servicio, horas, importe, fecha, tarifa, moneda, tipo de fee). */
  detected_columns?: Record<string, number>; // nombre lógico -> índice de columna
}

export interface UploadedDocument {
  id: string;
  original_filename: string;
  file_type: string;            // extensión / mimetype normalizado: pdf, docx, xlsx, csv, txt, png, jpg, jpeg
  uploaded_at: string;          // ISO 8601
  uploaded_by: string;
  document_type: DocumentType;
  extraction_status: ExtractionStatus;
  extraction_method: ExtractionMethod | null;
  extracted_text: string | null;
  extracted_tables: ExtractedTable[];
  warnings: string[];
  source_locations: SourceLocation[];
  confidence_level: ConfidenceLevel;
  /** Ruta relativa al archivo binario conservado bajo data/uploaded_documents. */
  stored_path?: string | null;
}

// ----------------------------------------------------------------------------
// 2. ExtractedWorkRecord — trabajo histórico extraído de un documento
// ----------------------------------------------------------------------------

export interface ExtractedWorkRecord {
  id: string;
  document_id: string;
  client_name: string | null;
  matter_name: string | null;
  service_category: string;            // categoría o "unknown"
  service_subcategory: string | null;
  service_description: string | null;
  date: string | null;                 // ISO 8601 o null
  total_fee: number | null;
  currency: string | null;             // p.ej. "EUR"
  fee_type: FeeType;
  hours_worked: number | null;
  hourly_rate: number | null;
  professional_role: string | null;
  number_of_professionals: number | null;
  complexity_level: ComplexityLevel;
  urgency_level: UrgencyLevel;
  discounts: number | null;            // porcentaje 0-100, o null
  payment_terms: string | null;
  extracted_from: string | null;       // descripción libre de la fuente
  source_location: SourceLocation[];   // trazabilidad por campo
  confidence_level: ConfidenceLevel;
  review_status: ReviewStatus;         // SIEMPRE "pending_review" al crear (reglas 5, 12)
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// 3. ServiceCategory — categoría de servicio
// ----------------------------------------------------------------------------

export interface ServiceCategory {
  id: string;
  name: string;
  description: string;
  subcategories: string[];
  default_pricing_method: PricingMethod;
  default_hourly_rate: number;         // valor inicial 250 (regla 2)
  default_complexity_factor: number;
  active: boolean;
}

// ----------------------------------------------------------------------------
// 4. PricingFormula — fórmula de honorarios
// ----------------------------------------------------------------------------

export interface FormulaVariable {
  name: string;
  description: string;
  default?: number | string | null;
}

export interface PricingFormula {
  id: string;
  service_category: string;
  service_subcategory: string | null;
  formula_name: string;
  formula_type: FormulaType;
  /** Expresión legible/evaluable, p.ej. "estimated_hours * hourly_rate * complexity_factor * urgency_factor * discount_factor". */
  formula_expression: string;
  variables: FormulaVariable[];
  assumptions: string[];
  based_on_record_ids: string[];
  recommended_min: number | null;
  recommended_base: number | null;
  recommended_max: number | null;
  currency: string;
  confidence_level: ConfidenceLevel;
  review_status: ReviewStatus;         // SIEMPRE "pending_review" al generar (regla 6)
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  rejected_reason?: string | null;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// 5. FeeCalculation — cálculo nuevo hecho por el usuario
// ----------------------------------------------------------------------------

export interface FeeCalculation {
  id: string;
  service_category: string;
  service_subcategory: string | null;
  estimated_hours: number | null;
  professional_role: string | null;
  hourly_rate: number | null;          // si null/empty -> se usa base_hourly_rate
  base_hourly_rate: number;            // 250 por defecto (regla 2)
  complexity_level: ComplexityLevel;
  urgency_level: UrgencyLevel;
  fee_type: FeeType;
  discount_percentage: number | null;  // 0-100
  selected_formula_id: string | null;  // null => se usó tarifa base
  calculated_min: number | null;
  calculated_recommended: number | null;
  calculated_max: number | null;
  currency: string;
  confidence_level: ConfidenceLevel;
  explanation: string;
  comparable_record_ids: string[];
  warnings: string[];
  created_at: string;
  created_by: string;
}

// ----------------------------------------------------------------------------
// 6. Desglose de actuaciones previstas (PlannedActionBreakdown / PlannedAction)
//
// Descompone un mandato en actuaciones jurídicas concretas y valora cada una
// según su APORTACIÓN DE VALOR (alta/media/baja), no sólo por el tiempo. Sirve
// para justificar el honorario sugerido. Reglas del módulo: no inventar
// actuaciones desconectadas del mandato, explicar cada valoración, distinguir
// tareas sustantivas de administrativas y mantener coherencia de horas.
// ----------------------------------------------------------------------------

/** Nivel de aportación de valor de una actuación. */
export type ValueLevel = 'high' | 'medium' | 'low';
export const VALUE_LEVEL_VALUES: ValueLevel[] = ['high', 'medium', 'low'];

/** Etiqueta en español mostrada al usuario para cada nivel de valor. */
export const VALUE_LABELS: Record<ValueLevel, string> = {
  high: 'Aportación Alta de Valor',
  medium: 'Aportación Media de Valor',
  low: 'Aportación Baja de Valor',
};

/** Origen del desglose: estimación automática ("Describir caso") o cálculo manual ("Calculadora"). */
export type BreakdownSourceType = 'automatic_estimate' | 'manual_calculation';
export const BREAKDOWN_SOURCE_TYPE_VALUES: BreakdownSourceType[] = [
  'automatic_estimate', 'manual_calculation',
];

/** Perfil profesional responsable sugerido para una actuación. */
export type ResponsibleProfile =
  | 'socio'
  | 'asociado senior'
  | 'asociado'
  | 'junior'
  | 'paralegal'
  | 'equipo mixto'
  | 'no determinado';
export const RESPONSIBLE_PROFILE_VALUES: ResponsibleProfile[] = [
  'socio', 'asociado senior', 'asociado', 'junior', 'paralegal', 'equipo mixto', 'no determinado',
];

/** Distribución agregada de actuaciones por aportación de valor. */
export interface ValueDistribution {
  high_value_count: number;
  medium_value_count: number;
  low_value_count: number;
}

/** Una actuación jurídica concreta dentro del mandato. */
export interface PlannedAction {
  id: string;
  breakdown_id: string;
  action_title: string;
  action_description: string;
  value_level: ValueLevel;                 // high | medium | low
  value_label: string;                     // "Aportación Alta/Media/Baja de Valor"
  reason_for_value_level: string;          // explicación de la valoración (regla 5)
  estimated_hours_min: number | null;
  estimated_hours_recommended: number | null;
  estimated_hours_max: number | null;
  related_fee_portion: number | null;      // parte del honorario imputable a la actuación
  sequence_order: number;
  depends_on: string[];                    // ids de actuaciones previas, si aplica
  deliverable: string;
  responsible_profile: ResponsibleProfile;
  client_visible: boolean;
  internal_only: boolean;
  confidence_level: ConfidenceLevel;
}

/** Desglose completo de actuaciones previstas, vinculado a una estimación o cálculo. */
export interface PlannedActionBreakdown {
  id: string;
  case_or_calculation_id: string | null;   // id del FeeCalculation que originó el desglose
  source_type: BreakdownSourceType;
  service_category: string;
  service_subcategory: string | null;
  mandate_summary: string;
  description: string | null;              // descripción original del mandato, si existe
  planned_actions: PlannedAction[];
  value_distribution: ValueDistribution;
  estimated_total_hours: number | null;
  estimated_total_fee: number | null;
  currency: string;
  rate_used: number | null;
  complexity_level: ComplexityLevel;
  urgency_level: UrgencyLevel;
  assumptions: string[];
  missing_information: string[];
  warnings: string[];
  created_at: string;
  created_by: string;
  updated_at: string;
}

/** Registro de un documento .docx generado a partir de un desglose. */
export interface ExportedBreakdownDocument {
  id: string;
  breakdown_id: string;
  file_name: string;
  file_type: 'docx';
  generated_at: string;
  generated_by: string;
  file_path: string;                       // ruta relativa bajo data/exports
}

// ----------------------------------------------------------------------------
// Propuesta de honorarios ("Generar propuesta")
// ----------------------------------------------------------------------------
// Ensambla una PROPUESTA profesional a partir de una estimación/cálculo (sus
// cifras vienen del caseEstimator/feeCalculator; aquí NO se inventan importes) y,
// opcionalmente, de un desglose de actuaciones. Dos formatos: sencilla (carta,
// 2–4 pp) y elaborada (dossier, 10+ pp). Los datos ausentes se marcan con "[●]".

/** Formato de la propuesta. */
export type ProposalKind = 'simple' | 'elaborate';
export const PROPOSAL_KIND_VALUES: ProposalKind[] = ['simple', 'elaborate'];

/** Etiqueta en español de cada formato. */
export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  simple: 'Propuesta sencilla',
  elaborate: 'Propuesta elaborada',
};

/** Parte interviniente (firma o cliente). Datos ausentes = null (regla 12). */
export interface ProposalParty {
  role: 'firm' | 'client';
  name: string | null;
  legal_form: string | null;               // S.L., S.A., particular…
  tax_id: string | null;                   // CIF/NIF
  address: string | null;
  representative: string | null;
}

/** Sección redactada de la propuesta (encabezado + cuerpo, editables). */
export interface ProposalSection {
  id: string;
  key: string;                             // clave estable: 'objeto', 'alcance', 'honorarios'…
  heading: string;                         // título mostrado ("4. Objeto del encargo")
  body: string;                            // texto; líneas "- " => viñetas; "[●]" = dato ausente
  client_visible: boolean;                 // false => nota interna, no se envía al cliente
}

/** Propuesta de honorarios completa, vinculada a una estimación/cálculo. */
export interface FeeProposal {
  id: string;
  kind: ProposalKind;                      // simple | elaborate
  case_or_calculation_id: string | null;
  breakdown_id: string | null;             // desglose de actuaciones vinculado, si lo hay
  service_category: string;
  service_subcategory: string | null;
  title: string;
  reference: string | null;                // referencia interna
  date: string;                            // ISO de la fecha de la propuesta
  confidential: boolean;
  firm: ProposalParty;
  client: ProposalParty;
  // Economía (cifras heredadas de la estimación; NUNCA inventadas, regla 12).
  currency: string;
  rate_used: number | null;
  hours_min: number | null;
  hours_recommended: number | null;
  hours_max: number | null;
  fee_min: number | null;
  fee_recommended: number | null;
  fee_max: number | null;
  vat_included: boolean;                   // por defecto false (IVA no incluido, regla 9)
  expenses_included: boolean;              // por defecto false (suplidos aparte)
  validity_days: number | null;
  // Alcance.
  included_elements: string[];
  excluded_services: string[];
  billing_terms: string | null;
  // Contenido redactado.
  sections: ProposalSection[];
  // Procedencia y cautelas.
  confidence_level: ConfidenceLevel;       // heredada de la estimación (baja en baseline)
  assumptions: string[];
  missing_information: string[];           // marcadores [●] usados / datos por confirmar
  warnings: string[];
  created_at: string;
  created_by: string;
  updated_at: string;
}

/** Registro de un .docx generado a partir de una propuesta. */
export interface ExportedProposalDocument {
  id: string;
  proposal_id: string;
  file_name: string;
  file_type: 'docx';
  generated_at: string;
  generated_by: string;
  file_path: string;                       // ruta relativa bajo data/exports
}
