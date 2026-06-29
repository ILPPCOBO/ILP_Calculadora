# CONTRACTS.md — Contratos de módulos (backbone de coordinación)

Este documento fija las **firmas exactas** de cada módulo para que todos encajen.
Los cimientos (`models`, `config`, `storage`, `utils`, `feeCalculator`) YA existen y
están verificados. Los demás módulos se implementan contra estas firmas.

## ⚠️ Restricciones DURAS de TypeScript nativo (Node 24 strip-only)

Node ejecuta `.ts` **eliminando tipos** (no transpila). Por tanto está PROHIBIDO:

- ❌ `enum` → usar union types `'a' | 'b'` (+ arrays `*_VALUES` ya definidos en models).
- ❌ **Parameter properties**: `constructor(private x: T)` → declarar el campo aparte.
- ❌ `namespace` con código, decoradores, `import =`.
- ✅ Imports locales SIEMPRE con extensión `.ts`: `import { x } from '../backend/models/index.ts'`.
- ✅ `import type { ... }` para tipos (recomendado, `verbatimModuleSyntax` activo).
- ✅ ESM puro (`package.json` tiene `"type": "module"`). Nada de `require()` salvo
  `import` dinámico para dependencias opcionales.

## Rutas de import desde cada carpeta

- Desde `services/*.ts`:  `../backend/models/index.ts`, `../backend/config/factors.ts`, `../backend/storage/index.ts`, `../backend/utils/id.ts`
- Desde `backend/routes/*.ts`: `../models/index.ts`, `../../services/<x>.ts`, etc.
- Desde `tests/*.ts`: `../services/<x>.ts`, `../backend/...`

## Cimientos ya disponibles (NO reimplementar)

```ts
// backend/config/factors.ts
export const BASE_HOURLY_RATE = 250;
export const DEFAULT_CURRENCY = 'EUR';
export function loadConfig(): PricingConfig;   // {base_hourly_rate, currency, complexity_factor, urgency_factor, range_spread_no_history}
export function discountFactor(pct: number|null|undefined): number;

// backend/utils/id.ts
export function newId(prefix: string): string;   // p.ej. newId('rec') => "rec_ab12cd34ef56"
export function nowIso(): string;

// backend/storage/index.ts  (repos tipados — Repository<T>)
export const documentsRepo, recordsRepo, categoriesRepo, formulasRepo, approvedFormulasRepo, calculationsRepo;
export const repos = { documents, records, categories, formulas, approvedFormulas, calculations };
// Repository<T>: list(): T[]; get(id): T|null; save(e): T; delete(id): boolean; clear(): void; find(pred): T[]

// services/feeCalculator.ts  (YA HECHO)
export function calculateFee(input: CalcInput): CalcOutput;            // función pura
export function saveCalculation(input: CalcInput, createdBy: string): { output: CalcOutput; record: FeeCalculation };
export function findApprovedFormula(cat, sub?, forcedId?): PricingFormula | null;
export function comparableRecords(cat, sub?): ExtractedWorkRecord[];
// CalcInput: { service_category, service_subcategory?, estimated_hours, professional_role?, hourly_rate?, base_hourly_rate?, complexity_level?, urgency_level?, fee_type?, discount_percentage?, selected_formula_id? }
// CalcOutput: { calculated_min, calculated_recommended, calculated_max, currency, confidence_level, formula_used, selected_formula_id, explanation, comparable_records, warnings, needs_input, breakdown }
```

## Firmas a implementar

### services/documentTextExtractor.ts
```ts
export interface ExtractionResult {
  text: string | null;
  tables: ExtractedTable[];
  method: ExtractionMethod;       // native_text | ocr | spreadsheet_parser | manual_review_needed
  status: ExtractionStatus;       // completed | failed
  warnings: string[];
  source_locations: SourceLocation[];
  confidence_level: ConfidenceLevel;
}
// Detecta el tipo por extensión. Dependencias opcionales vía import() dinámico con try/catch.
// PDF: pdf-parse (texto nativo); si vacío -> intenta OCR; si no hay OCR -> warning + manual_review_needed (NUNCA inventa).
// DOCX: mammoth. XLSX: xlsx. CSV/TXT: parser propio (sin dependencias).
// Imágenes (png/jpg/jpeg): OCR si disponible; si no -> manual_review_needed + warning.
export async function extractFromFile(filePath: string, fileType: string): Promise<ExtractionResult>;
export async function extractFromBuffer(buf: Buffer, fileType: string, filename?: string): Promise<ExtractionResult>;
export function parseCsv(content: string): ExtractedTable;            // sin dependencias
export function detectFinancialColumns(headers: string[]): Record<string, number>; // cliente, servicio, horas, importe, fecha, tarifa, moneda, fee_type
export function isOcrAvailable(): Promise<boolean>;
```

### services/documentUploadService.ts
```ts
// Guarda el binario bajo data/uploaded_documents/<id>.<ext>, lanza la extracción y crea el UploadedDocument.
export interface UploadInput { filename: string; fileType: string; documentType: DocumentType; uploadedBy: string; content: Buffer; }
export async function uploadDocument(input: UploadInput): Promise<UploadedDocument>;   // persiste vía documentsRepo
export function listDocuments(): UploadedDocument[];
export function getDocument(id: string): UploadedDocument | null;
```

### services/serviceClassifier.ts
```ts
export interface ClassificationResult { service_category: string; service_subcategory: string | null; confidence_level: ConfidenceLevel; reason: string; }
export interface ClassifierInput { service_description?: string|null; document_text?: string|null; extracted_data?: Partial<ExtractedWorkRecord>; manual_category?: string|null; manual_subcategory?: string|null; }
// Heurística por palabras clave contra las categorías sembradas. Si manual_category está, lo respeta (confidence high).
// Si no está seguro -> service_category 'unknown' + confidence low + reason (R12: no inventa).
export function classify(input: ClassifierInput): ClassificationResult;
```

### services/workRecordExtractor.ts
```ts
// Toma un UploadedDocument ya extraído y produce 1..N ExtractedWorkRecord en pending_review.
// R12: campos ausentes -> null / 'unknown'. Cada dato con source_location si es posible. confidence low si ambiguo.
export function extractRecords(doc: UploadedDocument): ExtractedWorkRecord[];
export function extractAndSaveRecords(doc: UploadedDocument): ExtractedWorkRecord[];   // persiste vía recordsRepo
```

### services/recordReview.ts
```ts
export function listPending(): ExtractedWorkRecord[];
export function listByStatus(status: ReviewStatus): ExtractedWorkRecord[];
export function updateRecord(id: string, patch: Partial<ExtractedWorkRecord>): ExtractedWorkRecord | null; // editar campos
export function approveRecord(id: string, approvedBy: string): ExtractedWorkRecord | null;  // review_status=approved + approved_by/at
export function rejectRecord(id: string, rejectedReason: string, by: string): ExtractedWorkRecord | null;
// Sólo registros 'approved' pueden usarse para generar fórmulas.
```

### services/formulaGenerator.ts
```ts
// Analiza ExtractedWorkRecord 'approved' de una categoría/subcategoría y sugiere una PricingFormula en pending_review.
// R3/R12: sólo approved; nunca inventa horas/precios. Si hay pocos datos -> usa BASE_HOURLY_RATE y confidence low/medium.
// Debe rellenar variables, assumptions, based_on_record_ids, recommended_min/base/max (percentiles si hay datos).
export interface GenerateInput { service_category: string; service_subcategory?: string|null; formula_type?: FormulaType; created_by?: string; }
export function generateFormula(input: GenerateInput): PricingFormula;        // review_status SIEMPRE 'pending_review'
export function generateAndSaveFormula(input: GenerateInput): PricingFormula; // persiste vía formulasRepo
```

### services/formulaReview.ts
```ts
export function listPending(): PricingFormula[];
export function updateFormula(id: string, patch: Partial<PricingFormula>): PricingFormula | null;
// R13(fórmulas): no aprobar si faltan service_category, formula_expression, variables, assumptions,
// y (based_on_record_ids no vacío O una assumption que justifique uso de tarifa base).
export function canApprove(f: PricingFormula): { ok: boolean; missing: string[] };
export function approveFormula(id: string, approvedBy: string): { ok: boolean; formula?: PricingFormula; missing?: string[] }; // copia a approvedFormulasRepo
export function rejectFormula(id: string, rejectedReason: string, by: string): PricingFormula | null;
```

### backend/server.ts + backend/routes/*.ts
```ts
// Servidor HTTP sin dependencias (node:http). Sirve /frontend estático y expone API JSON bajo /api.
// Importa servicios y repos. NO reimplementa lógica.
export function createServer(): http.Server;   // backend/server.ts
export function startServer(port?: number): http.Server;
```
Endpoints mínimos (todos JSON salvo estáticos):
- `GET  /api/health`
- `GET  /api/config` · `PUT /api/config` (R16: editar tarifa base y factores)
- `GET  /api/dashboard` (conteos + tarifa base actual)
- `POST /api/documents` (multipart o JSON base64) · `GET /api/documents` · `GET /api/documents/:id`
- `POST /api/documents/:id/extract-records` (genera ExtractedWorkRecord)
- `GET  /api/records?status=` · `PUT /api/records/:id` · `POST /api/records/:id/approve` · `POST /api/records/:id/reject`
- `GET  /api/categories` · `POST /api/categories` · `PUT /api/categories/:id`
- `POST /api/formulas/generate` · `GET /api/formulas?status=` · `PUT /api/formulas/:id` · `POST /api/formulas/:id/approve` · `POST /api/formulas/:id/reject`
- `GET  /api/approved-formulas`
- `POST /api/calculate` (devuelve CalcOutput, persiste en historial) · `GET /api/calculations`

### frontend/ (HTML + CSS + JS vanilla, identidad ILP: navy/gold/cream, fuentes Cormorant + Inter)
8 pantallas en una SPA ligera con hash-routing o páginas: Dashboard, Subir documentos (drag&drop),
Revisar registros, Categorías, Generar fórmulas, Revisar fórmulas, Calculadora, Historial.
Consume la API con `fetch`. Debe mostrar SIEMPRE "Tarifa base: 250 €/hora" en el dashboard y marcar
claramente cuándo la calculadora usa la tarifa base.

### admin/seed.ts + admin/reset.ts
Datos mock: 12 registros (varios estados), 6 categorías, 4 fórmulas aprobadas, 3 pendientes, 4 documentos,
varios cálculos. Incluir casos: tarifa explícita; sin tarifa (usa 250); precio fijo; descuento; urgencia;
complejidad alta; información insuficiente.
