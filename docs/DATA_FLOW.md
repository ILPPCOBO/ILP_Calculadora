# DATA_FLOW.md — Flujo de datos extremo a extremo

> Describe el recorrido completo de un dato: desde que se sube un documento hasta
> que la calculadora produce un honorario sugerido con rango, explicación y
> trazabilidad. Cada etapa está anclada a las reglas de `PROJECT_RULES.md` y a las
> firmas de `docs/CONTRACTS.md`. No se inventan endpoints fuera de CONTRACTS.md.

---

## 1. Resumen del flujo

```
Documento subido
   └─► Extracción de texto/tablas
        └─► Clasificación de servicio
             └─► Registro ExtractedWorkRecord (pending_review)
                  └─► Revisión humana (aprobar / editar / rechazar)
                       └─► Registro approved
                            └─► Generación de fórmula (PricingFormula pending_review)
                                 └─► Revisión humana de fórmula
                                      └─► Fórmula approved (copia a approved_formulas)
                                           └─► Calculadora
                                                └─► Honorario con rango + explicación + trazabilidad
```

La cadena tiene **dos puertas de revisión humana obligatorias** (registros y
fórmulas). Nada cruza una puerta sin la acción de un usuario interno (Reglas 4-7).
Sólo lo que está `approved` alimenta la siguiente etapa.

---

## 2. Diagrama (Mermaid)

```mermaid
flowchart TD
    U[Usuario interno] -->|POST /api/documents| UP[documentUploadService.uploadDocument]
    UP -->|guarda binario en data/uploaded_documents| BIN[(stored_path)]
    UP -->|llama| EX[documentTextExtractor.extractFromFile]

    EX -->|native_text / ocr / spreadsheet_parser| OK[texto + tablas + source_locations]
    EX -->|dependencia ausente o ilegible| MRN[manual_review_needed + warning]
    OK --> DOC[(UploadedDocument\nextraction_status=completed)]
    MRN --> DOC

    DOC -->|POST /api/documents/:id/extract-records| WRX[workRecordExtractor.extractAndSaveRecords]
    WRX -->|clasifica| CLS[serviceClassifier.classify]
    CLS --> WRX
    WRX -->|datos ausentes -> null/'unknown' (R12)| REC[(ExtractedWorkRecord\nreview_status = pending_review)]

    REC -->|GET /api/records?status=pending_review| REV1{Revisión humana\nde registros}
    REV1 -->|PUT /api/records/:id| REC
    REV1 -->|POST /api/records/:id/approve| RECA[(ExtractedWorkRecord\nreview_status = approved\napproved_by/at)]
    REV1 -->|POST /api/records/:id/reject| RECR[(rejected\nrejected_reason)]

    RECA -->|POST /api/formulas/generate| GEN[formulaGenerator.generateAndSaveFormula]
    GEN -->|sólo registros approved (R3/R12)| FOR[(PricingFormula\nreview_status = pending_review)]

    FOR -->|GET /api/formulas?status=pending_review| REV2{Revisión humana\nde fórmulas}
    REV2 -->|PUT /api/formulas/:id| FOR
    REV2 -->|canApprove ok + POST /api/formulas/:id/approve| FORA[(PricingFormula approved\ncopia a approved_formulas)]
    REV2 -->|POST /api/formulas/:id/reject| FORR[(rejected)]

    FORA -->|GET /api/approved-formulas| CALC[feeCalculator.calculateFee]
    RECA -->|comparableRecords (approved)| CALC
    CALC -->|POST /api/calculate| OUT[CalcOutput\nmin / recomendado / max\nexplanation + comparables + warnings]
    OUT -->|saveCalculation (R17)| HIST[(FeeCalculation\ncalculation_history)]
```

---

## 3. Etapas en detalle

### Etapa 1 — Subida del documento
- **Endpoint:** `POST /api/documents` (multipart o JSON base64).
- **Servicio:** `documentUploadService.uploadDocument(input)`.
- Guarda el binario bajo `data/uploaded_documents/<id>.<ext>` (campo `stored_path`),
  lanza la extracción y crea el `UploadedDocument` vía `documentsRepo`.
- **Trazabilidad (Regla 8):** el `UploadedDocument` conserva `original_filename`,
  `uploaded_by`, `uploaded_at`, `document_type` y `stored_path`.

### Etapa 2 — Extracción de texto/tablas
- **Servicio:** `documentTextExtractor.extractFromFile(filePath, fileType)`.
- Detecta el tipo por extensión y elige método: `native_text`, `ocr`,
  `spreadsheet_parser` o `manual_review_needed`.
- **Degradación (Regla 12):** si la dependencia opcional (`pdf-parse`, `mammoth`,
  `xlsx`, OCR) no está disponible o el contenido es ilegible, **no inventa texto**:
  marca `manual_review_needed` y añade un `warning`. Nunca rellena datos.
- Resultado escrito en el `UploadedDocument`: `extracted_text`, `extracted_tables`,
  `extraction_method`, `extraction_status` (`completed`/`failed`), `warnings`,
  `source_locations`, `confidence_level`.

### Etapa 3 — Clasificación de servicio
- **Servicio:** `serviceClassifier.classify(input)`.
- Heurística por palabras clave contra las categorías sembradas. Si llega una
  `manual_category`, la respeta (confianza alta).
- **Regla 12:** si no hay certeza, devuelve `service_category: "unknown"` con
  confianza baja y un `reason` que explica por qué; no adivina una categoría.

### Etapa 4 — Creación del registro (pending_review)
- **Endpoint:** `POST /api/documents/:id/extract-records`.
- **Servicio:** `workRecordExtractor.extractAndSaveRecords(doc)` → 1..N
  `ExtractedWorkRecord` persistidos vía `recordsRepo`.
- **Reglas 5 y 12:** cada registro nace con `review_status: "pending_review"`;
  los campos ausentes quedan en `null` o `"unknown"`; cada dato lleva
  `source_location` cuando es posible (trazabilidad, Regla 8). `confidence_level`
  baja si el dato es ambiguo.

### Etapa 5 — Revisión humana de registros
- **Endpoints:** `GET /api/records?status=`, `PUT /api/records/:id`,
  `POST /api/records/:id/approve`, `POST /api/records/:id/reject`.
- **Servicio:** `recordReview.*`.
- El usuario interno (Regla 7) puede **editar** (`updateRecord`), **aprobar**
  (`approveRecord` → fija `review_status: "approved"`, `approved_by`, `approved_at`)
  o **rechazar** (`rejectRecord` → `rejected_reason`).
- **Sólo los registros `approved`** pasan a la generación de fórmulas.

### Etapa 6 — Generación de fórmula (pending_review)
- **Endpoint:** `POST /api/formulas/generate`.
- **Servicio:** `formulaGenerator.generateAndSaveFormula(input)` vía `formulasRepo`.
- Analiza los `ExtractedWorkRecord` **approved** de la categoría/subcategoría.
- **Reglas 3, 6, 12:** consume sólo registros `approved`; **nunca inventa**
  horas/precios; si hay pocos datos usa `BASE_HOURLY_RATE` (250 €/h) con confianza
  baja/media y lo deja registrado como `assumption`. Rellena `variables`,
  `assumptions`, `based_on_record_ids` y `recommended_min/base/max` (por
  percentiles cuando hay datos). La fórmula nace **siempre** en `pending_review`.

### Etapa 7 — Revisión humana de fórmulas
- **Endpoints:** `GET /api/formulas?status=`, `PUT /api/formulas/:id`,
  `POST /api/formulas/:id/approve`, `POST /api/formulas/:id/reject`.
- **Servicio:** `formulaReview.*`.
- `canApprove(f)` valida que no falten `service_category`, `formula_expression`,
  `variables`, `assumptions` y que haya `based_on_record_ids` no vacío **o** una
  assumption que justifique el uso de la tarifa base.
- `approveFormula` fija `review_status: "approved"` (+ `approved_by/at`) y **copia**
  la fórmula a `approvedFormulasRepo` (`data/approved_formulas/`), que es la única
  fuente que la calculadora consulta.

### Etapa 8 — Cálculo del honorario
- **Endpoint:** `POST /api/calculate` (persiste en historial); `GET /api/calculations`.
- **Servicio:** `feeCalculator.saveCalculation(input, createdBy)` →
  `calculateFee` (función pura) + persistencia vía `calculationsRepo`.
- Selección de fórmula: `findApprovedFormula(cat, sub?, forcedId?)` busca en
  `approved_formulas` (subcategoría exacta primero, luego categoría).
- Histórico comparable: `comparableRecords(cat, sub?)` usa registros `approved`
  con `total_fee` > 0.
- **Tarifa base (Reglas 2, 15):** si `hourly_rate` viene vacío se usa
  `BASE_HOURLY_RATE` (250 €/h) y la salida lo marca explícitamente
  (`breakdown.used_base_rate`).
- **Reglas 11, 13, 14, 18 — la salida (`CalcOutput`) siempre incluye:**
  - `calculated_min`, `calculated_recommended`, `calculated_max` (rango; con ≥3
    comparables se ajusta por percentiles p25/mediana/p75).
  - `confidence_level` (`low`/`medium`/`high`).
  - `formula_used` y `selected_formula_id` (qué fórmula se aplicó, o "tarifa base").
  - `explanation` (texto trazable de cómo se llegó al número).
  - `comparable_records` (ids de los registros que respaldan el cálculo).
  - `warnings` (incl. "información insuficiente" cuando no hay fórmula aprobada ni
    histórico).
  - `needs_input` (`true` si faltan horas y la fórmula las necesita: no se calcula).

### Etapa 9 — Historial
- **Regla 17:** cada cálculo se guarda como `FeeCalculation` en
  `data/calculation_history/`, conservando entradas, resultado, fórmula usada,
  comparables, explicación y warnings para auditoría posterior.

---

## 4. Invariantes del flujo (resumen de garantías)

| Invariante | Etapa(s) | Reglas |
|------------|----------|--------|
| Todo registro/fórmula auto-generado nace `pending_review` | 4, 6 | 5, 6 |
| Sólo un usuario interno cambia el estado a `approved` | 5, 7 | 7 |
| Sólo entidades `approved` alimentan la etapa siguiente | 6, 8 | 3, 4 |
| Dato ausente → `null`/`"unknown"`, nunca inventado | 2, 3, 4, 6 | 12 |
| Cada dato extraído conserva su `source_location` | 1, 4 | 8 |
| El cálculo declara fórmula, comparables y explicación | 8 | 9, 10, 18 |
| Siempre min/recomendado/max + nivel de confianza | 8 | 13, 14 |
| "Información insuficiente" cuando no hay evidencia | 8 | 11 |
| Tarifa base 250 €/h marcada explícitamente cuando se usa | 8 | 2, 15 |
| Todo cálculo se guarda en el historial | 9 | 17 |
