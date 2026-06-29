# DATA_MODELS.md — Resumen de los modelos de datos

> Tabla de referencia de los 5 modelos principales definidos en
> `backend/models/index.ts`. Para cada uno se listan sus campos, su tipo y las
> reglas asociadas (qué se pone `null`/`"unknown"`, estados de revisión, etc.).
> **Importa los tipos desde `backend/models/index.ts`; no los redefinas.**
> Todo está subordinado a `PROJECT_RULES.md`.

---

## 0. Tipos compartidos (union types, no `enum`)

Definidos en `backend/models/index.ts`; cada uno expone además un array
`*_VALUES` para validación en runtime.

| Tipo | Valores |
|------|---------|
| `DocumentType` | `invoice` · `proposal` · `engagement_letter` · `timesheet` · `contract` · `email` · `spreadsheet` · `other` |
| `ExtractionStatus` | `pending` · `completed` · `failed` |
| `ExtractionMethod` | `native_text` · `ocr` · `spreadsheet_parser` · `manual_review_needed` |
| `ConfidenceLevel` | `low` · `medium` · `high` |
| `FeeType` | `hourly` · `fixed` · `monthly` · `success_fee` · `blended` · `unknown` |
| `ComplexityLevel` | `low` · `medium` · `high` · `unknown` |
| `UrgencyLevel` | `normal` · `urgent` · `very_urgent` · `unknown` |
| `ReviewStatus` | `pending_review` · `approved` · `rejected` |
| `PricingMethod` | `hourly` · `fixed` · `blended` · `monthly` · `custom` |
| `FormulaType` | `hourly` · `fixed_range` · `blended` · `monthly` · `custom` |

**`SourceLocation`** (sostén de la trazabilidad, Regla 8): `field?`, `page?`,
`sheet?`, `cell?`, `line?`, `snippet?` — apuntan al lugar exacto del que se
extrajo un dato.

---

## 1. UploadedDocument
Documento histórico subido a la plataforma. Colección: `data/uploaded_documents/`.

| Campo | Tipo | Regla / nota |
|-------|------|--------------|
| `id` | `string` | `newId('doc')`. |
| `original_filename` | `string` | Trazabilidad (R8). |
| `file_type` | `string` | Extensión/mimetype normalizado: pdf, docx, xlsx, csv, txt, png, jpg, jpeg. |
| `uploaded_at` | `string` (ISO 8601) | `nowIso()`. |
| `uploaded_by` | `string` | Usuario interno (R8). |
| `document_type` | `DocumentType` | Tipo del documento. |
| `extraction_status` | `ExtractionStatus` | `pending`/`completed`/`failed`. |
| `extraction_method` | `ExtractionMethod \| null` | `null` si aún no se extrajo. |
| `extracted_text` | `string \| null` | `null` si no hubo texto (R12: no se inventa). |
| `extracted_tables` | `ExtractedTable[]` | `[]` si no hay tablas. |
| `warnings` | `string[]` | Incluye avisos de degradación (p.ej. `manual_review_needed`). |
| `source_locations` | `SourceLocation[]` | Trazabilidad (R8). |
| `confidence_level` | `ConfidenceLevel` | Confianza de la extracción (R14). |
| `stored_path` | `string \| null` | Ruta al binario bajo `data/uploaded_documents`. |

**`ExtractedTable`**: `name?`, `headers: string[]`, `rows: (string\|number\|null)[][]`,
`detected_columns?: Record<string, number>` (cliente, servicio, horas, importe,
fecha, tarifa, moneda, tipo de fee → índice de columna).

**Estados / null:** sin extracción → `extraction_method=null`, `extracted_text=null`,
`extracted_tables=[]`. Si falta la dependencia o el archivo es ilegible →
`extraction_method="manual_review_needed"` + warning, **nunca** texto inventado (R12).

---

## 2. ExtractedWorkRecord
Trabajo histórico extraído de un documento. Colección: `data/extracted_records/`.

| Campo | Tipo | Regla / nota |
|-------|------|--------------|
| `id` | `string` | `newId('rec')`. |
| `document_id` | `string` | Enlaza al `UploadedDocument` fuente (R8). |
| `client_name` | `string \| null` | `null` si ausente (R12). |
| `matter_name` | `string \| null` | `null` si ausente (R12). |
| `service_category` | `string` | Categoría o `"unknown"` (R12). |
| `service_subcategory` | `string \| null` | `null` si no aplica. |
| `service_description` | `string \| null` | `null` si ausente. |
| `date` | `string \| null` | ISO 8601 o `null`. |
| `total_fee` | `number \| null` | `null` si ausente (R12). |
| `currency` | `string \| null` | p.ej. `"EUR"`; `null` si se desconoce. |
| `fee_type` | `FeeType` | `"unknown"` si no se determina. |
| `hours_worked` | `number \| null` | `null` si ausente (R12). |
| `hourly_rate` | `number \| null` | `null` si ausente (R12). |
| `professional_role` | `string \| null` | `null` si ausente. |
| `number_of_professionals` | `number \| null` | `null` si ausente. |
| `complexity_level` | `ComplexityLevel` | `"unknown"` si no se infiere. |
| `urgency_level` | `UrgencyLevel` | `"unknown"` si no se infiere. |
| `discounts` | `number \| null` | Porcentaje 0-100 o `null`. |
| `payment_terms` | `string \| null` | `null` si ausente. |
| `extracted_from` | `string \| null` | Descripción libre de la fuente. |
| `source_location` | `SourceLocation[]` | Trazabilidad por campo (R8). |
| `confidence_level` | `ConfidenceLevel` | `low` si ambiguo (R14). |
| `review_status` | `ReviewStatus` | **SIEMPRE `pending_review` al crear** (R5, R12). |
| `approved_by` | `string \| null` | Se rellena al aprobar (R7). |
| `approved_at` | `string \| null` | ISO al aprobar. |
| `rejected_reason` | `string \| null` | Motivo si se rechaza. |
| `created_at` | `string` | `nowIso()`. |
| `notes?` | `string \| null` | Opcional. |

**Estados:** `pending_review` → (`approveRecord`) `approved` con `approved_by/at`
→ o (`rejectRecord`) `rejected` con `rejected_reason`. Sólo `approved` se usa para
generar fórmulas y como histórico comparable.

---

## 3. ServiceCategory
Categoría de servicio. Colección: `data/service_categories/`.
(El archivo `_config.json` de esa carpeta guarda overrides de configuración, R16,
y no es una entidad.)

| Campo | Tipo | Regla / nota |
|-------|------|--------------|
| `id` | `string` | `newId('cat')`. |
| `name` | `string` | Nombre de la categoría. |
| `description` | `string` | Descripción. |
| `subcategories` | `string[]` | Subcategorías. |
| `default_pricing_method` | `PricingMethod` | Método por defecto. |
| `default_hourly_rate` | `number` | Valor inicial **250** (R2). |
| `default_complexity_factor` | `number` | Factor de complejidad por defecto. |
| `active` | `boolean` | Si la categoría está activa. |

**Nota:** no tiene `review_status` (es configuración mantenida por usuarios
internos, no extraída automáticamente). La tarifa base canónica sigue siendo
`BASE_HOURLY_RATE = 250` de `backend/config/factors.ts` (único punto de verdad).

---

## 4. PricingFormula
Fórmula de honorarios. Colecciones: `data/pricing_formulas/` (pendientes/rechazadas)
y `data/approved_formulas/` (copia aprobada, usable por la calculadora).

| Campo | Tipo | Regla / nota |
|-------|------|--------------|
| `id` | `string` | `newId('formula')`. |
| `service_category` | `string` | Categoría a la que aplica. |
| `service_subcategory` | `string \| null` | `null` si aplica a toda la categoría. |
| `formula_name` | `string` | Nombre legible. |
| `formula_type` | `FormulaType` | `hourly`/`fixed_range`/`blended`/`monthly`/`custom`. |
| `formula_expression` | `string` | Expresión legible (no se evalúa como código). |
| `variables` | `FormulaVariable[]` | `{name, description, default?}`. |
| `assumptions` | `string[]` | Supuestos (justifican uso de tarifa base si no hay datos). |
| `based_on_record_ids` | `string[]` | Ids de registros **approved** que la respaldan (R3, R8, R10). |
| `recommended_min` | `number \| null` | `null` si no se puede estimar. |
| `recommended_base` | `number \| null` | `null` si no se puede estimar. |
| `recommended_max` | `number \| null` | `null` si no se puede estimar. |
| `currency` | `string` | p.ej. `"EUR"`. |
| `confidence_level` | `ConfidenceLevel` | `low`/`medium` con pocos datos (R14). |
| `review_status` | `ReviewStatus` | **SIEMPRE `pending_review` al generar** (R6). |
| `approved_by` | `string \| null` | Se rellena al aprobar (R7). |
| `approved_at` | `string \| null` | ISO al aprobar. |
| `created_at` | `string` | `nowIso()`. |
| `updated_at` | `string` | `nowIso()` en cada cambio. |
| `rejected_reason?` | `string \| null` | Motivo si se rechaza. |
| `notes?` | `string \| null` | Opcional. |

**Estados:** `pending_review` → (`approveFormula`, sólo si `canApprove` es ok)
`approved` + copia a `approvedFormulasRepo` → o (`rejectFormula`) `rejected`. La
calculadora **sólo** usa fórmulas `approved` (R12 fórmulas). `canApprove` exige
`service_category`, `formula_expression`, `variables`, `assumptions` y
`based_on_record_ids` no vacío **o** una assumption que justifique la tarifa base.

---

## 5. FeeCalculation
Cálculo realizado por el usuario. Colección: `data/calculation_history/` (R17).

| Campo | Tipo | Regla / nota |
|-------|------|--------------|
| `id` | `string` | `newId('calc')`. |
| `service_category` | `string` | Categoría solicitada. |
| `service_subcategory` | `string \| null` | `null` si no se especifica. |
| `estimated_hours` | `number \| null` | `null` si no se introducen. |
| `professional_role` | `string \| null` | `null` si ausente. |
| `hourly_rate` | `number \| null` | `null`/vacío → se usa `base_hourly_rate` (R2, R15). |
| `base_hourly_rate` | `number` | **250 por defecto** (R2). |
| `complexity_level` | `ComplexityLevel` | Ajustable (R16). |
| `urgency_level` | `UrgencyLevel` | Ajustable (R16). |
| `fee_type` | `FeeType` | Tipo de honorario. |
| `discount_percentage` | `number \| null` | 0-100 o `null`. |
| `selected_formula_id` | `string \| null` | `null` ⇒ se usó la tarifa base (R9). |
| `calculated_min` | `number \| null` | Mínimo del rango (R13); `null` si `needs_input`. |
| `calculated_recommended` | `number \| null` | Recomendado (R13). |
| `calculated_max` | `number \| null` | Máximo (R13). |
| `currency` | `string` | p.ej. `"EUR"`. |
| `confidence_level` | `ConfidenceLevel` | `low`/`medium`/`high` (R14). |
| `explanation` | `string` | Explicación trazable (R10, R18). |
| `comparable_record_ids` | `string[]` | Registros que respaldan el cálculo (R10). |
| `warnings` | `string[]` | Incl. "información insuficiente" (R11). |
| `created_at` | `string` | `nowIso()`. |
| `created_by` | `string` | Usuario que calculó. |

**Estados / null:** no tiene `review_status` (es un resultado, no una entidad a
aprobar). Si faltan horas y la fórmula las necesita, los `calculated_*` van a
`null` y la salida marca `needs_input` con un warning, sin inventar un número (R12).

---

## 6. Mapa rápido modelo ↔ colección ↔ id-prefix ↔ review_status

| Modelo | Carpeta `data/` | Prefijo id | ¿Tiene `review_status`? |
|--------|-----------------|------------|--------------------------|
| `UploadedDocument` | `uploaded_documents/` | `doc_` | No (usa `extraction_status`) |
| `ExtractedWorkRecord` | `extracted_records/` | `rec_` | Sí — nace `pending_review` (R5) |
| `ServiceCategory` | `service_categories/` | `cat_` | No (configuración) |
| `PricingFormula` | `pricing_formulas/` + `approved_formulas/` | `formula_` | Sí — nace `pending_review` (R6) |
| `FeeCalculation` | `calculation_history/` | `calc_` | No (resultado) |
