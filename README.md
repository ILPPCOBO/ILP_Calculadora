# Calculadora Inteligente de Honorarios

Plataforma interna que **aprende de documentos históricos** (facturas, presupuestos, cartas
de encargo, hojas de horas, contratos…) para **sugerir honorarios revisables** en trabajos
nuevos. No impone precios: genera **rangos sugeridos, explicaciones y trazabilidad**, todo
sujeto a revisión humana.

> **Tarifa base por defecto: 250 €/hora.** Modificable en la calculadora y en configuración;
> si no se introduce otra tarifa, se usa 250 €/hora (Regla 2).

Las 18 reglas maestras viven en [`PROJECT_RULES.md`](PROJECT_RULES.md) y mandan sobre cualquier decisión de implementación.

---

## 1. Stack y arquitectura

| Capa | Elección | Por qué |
|------|----------|---------|
| Lenguaje | **TypeScript** ejecutado nativamente por **Node 24** (type-stripping, sin paso de compilación) | Cero fricción: `node archivo.ts` |
| Backend | Servidor **HTTP sin dependencias** (`node:http`) + rutas modulares | Robusto, portable |
| Almacenamiento | **JSON por archivo** bajo `/data/*`, detrás de una interfaz `Repository<T>` | Prototipo legible; migrable a SQLite/Postgres sin tocar la lógica |
| Frontend | **HTML + CSS + JS vanilla** (SPA con hash-routing), identidad visual ILP | "Frontend básico" sin build pesado |
| Extracción | `pdf-parse`, `mammoth`, `xlsx` como **dependencias opcionales** con degradación elegante | Nunca falla en silencio; marca *warnings* |
| Tests | Runner integrado **`node:test`** (29 tests) | Sin dependencias de testing |

Para migrar a una base de datos real basta con implementar `Repository<T>`
(`backend/storage/repository.ts`) con otro backend y cambiar las instancias en
`backend/storage/index.ts`. Ningún servicio lee/escribe archivos directamente.

Detalle: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md) · [`docs/DATA_MODELS.md`](docs/DATA_MODELS.md) · contratos en [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

---

## 2. Estructura del proyecto

```
calculadora-honorarios/
├── PROJECT_RULES.md          # Las 18 reglas maestras (la "constitución")
├── README.md                 # Este archivo
├── package.json              # scripts: start, seed, reset, test
├── backend/
│   ├── models/index.ts       # Los 5 modelos de datos + tipos
│   ├── config/factors.ts     # BASE_HOURLY_RATE=250 + factores (editables)
│   ├── storage/              # repository.ts (genérico) + index.ts (repos tipados)
│   ├── utils/id.ts           # ids y fechas
│   ├── server.ts             # servidor HTTP (sirve frontend + API)
│   └── routes/               # handlers por dominio
├── services/                 # LÓGICA DE NEGOCIO
│   ├── documentTextExtractor.ts
│   ├── documentUploadService.ts
│   ├── serviceClassifier.ts
│   ├── workRecordExtractor.ts
│   ├── recordReview.ts
│   ├── formulaGenerator.ts
│   ├── formulaReview.ts
│   ├── feeCalculator.ts      # motor de cálculo final (adjunta la referencia histórica)
│   ├── referencePricing.ts   # benchmarks de precios por área (acuerdos aprobados)
│   └── batchImport.ts        # importación masiva de documentos desde carpeta
├── frontend/                 # SPA: 10 pantallas (incl. Referencias y Organizar por área) + subida multi-archivo
├── admin/                    # seed.ts (datos mock) · reset.ts · import.ts (importación masiva)
├── data/                     # almacenamiento JSON (uploaded_documents, extracted_records,
│                             #   service_categories, pricing_formulas, approved_formulas,
│                             #   calculation_history, inbox/ para importación)
├── tests/                    # 35 tests + fixtures/ (PDF nativo, PDF escaneado, imagen)
└── docs/                     # ARCHITECTURE, DATA_FLOW, DATA_MODELS, CONTRACTS
```

---

## 3. Puesta en marcha

> Node está en `~/.local/node/bin`. Si `node` no aparece, ejecuta antes:
> `export PATH="$HOME/.local/node/bin:$PATH"`

```bash
cd ~/calculadora-honorarios
npm install        # opcional: instala extractores PDF/DOCX/XLSX (degradan si faltan)
npm run seed       # carga datos mock de demostración
npm start          # arranca en http://localhost:3000
```

Otros comandos:

```bash
npm test           # ejecuta los 29 tests (node:test)
npm run reset      # vacía todos los repos
npm run dev        # arranca con --watch (recarga al guardar)
```

---

## 4. Flujo del sistema

```
Documento subido
  → extracción de texto y tablas (PDF/DOCX/XLSX/CSV/TXT/imagen)
  → clasificación por servicio
  → ExtractedWorkRecord en estado pending_review
  → revisión humana → registro approved
  → generación de fórmula sugerida (pending_review)
  → revisión humana de la fórmula → fórmula approved (copiada a /data/approved_formulas)
  → calculadora de honorarios
  → honorario sugerido con mínimo/recomendado/máximo + explicación + trazabilidad
```

En cada paso automático la herramienta **nunca inventa**: lo que no encuentra queda `null` o
`"unknown"` y se marca para revisión (Regla 12). Nada se aprueba solo (Reglas 4–7).

---

## 5. Guía de uso

### 5.1 Cómo subir documentos históricos
1. Abre **Subir documentos** en el menú.
2. Elige el **tipo de documento** (factura, propuesta, carta de encargo, hoja de horas,
   contrato, email, Excel/CSV, otro).
3. **Arrastra y suelta** el archivo (o púlsalo para elegirlo). Formatos: PDF, PDF escaneado,
   DOCX, XLSX, CSV, TXT, PNG, JPG, JPEG.
4. Verás el **estado de extracción**, el **texto extraído**, las **tablas detectadas** y los
   **warnings** (p.ej. "PDF parece escaneado: se requiere OCR").
5. Pulsa **Extraer registros** para generar los `ExtractedWorkRecord` (nacen en
   `pending_review`). El binario original se conserva en `data/uploaded_documents/` para
   trazabilidad.
6. **Eliminar un documento**: en la lista *Documentos subidos*, botón **Eliminar**. Borra
   el archivo, sus metadatos y, en cascada, los registros extraídos de él. Si alguno de
   esos registros está **aprobado** (alimenta referencias/fórmulas), pide una
   confirmación reforzada antes de borrarlo. Acción irreversible.

> Si subes un PDF escaneado o una imagen y no hay OCR instalado, la herramienta **no inventa**
> el contenido: lo marca como `manual_review_needed` con un warning claro. Para activar OCR:
> `npm install tesseract.js` (el extractor lo detecta automáticamente).

### 5.2 Cómo aprobar registros
1. Abre **Revisar registros**. Verás los registros en `pending_review`.
2. Pulsa uno para ver el documento fuente y **editar** cualquier campo (cliente, asunto,
   servicio, importe, horas, tarifa, complejidad, urgencia, moneda…).
3. **Aprobar** → el registro pasa a `approved` (con `approved_by` y `approved_at`).
   **Rechazar** → pasa a `rejected` con un motivo.
4. **Solo los registros `approved`** alimentan la generación de fórmulas (Regla 3).

### 5.3 Cómo generar y aprobar fórmulas
**Generar:**
1. Abre **Generar fórmulas**, elige **categoría** y, opcionalmente, **subcategoría**.
2. Verás los registros históricos *aprobados* disponibles. Pulsa **Generar fórmula**.
3. El generador propone una fórmula con `recommended_min/base/max` (percentiles si hay ≥3
   registros), variables, supuestos y `based_on_record_ids`. Si hay pocos datos usa la tarifa
   base de 250 € como referencia y baja la confianza. La fórmula nace en `pending_review`.

**Aprobar:**
1. Abre **Revisar fórmulas**. Edita expresión, variables, factores y supuestos.
2. **Aprobar** copia la fórmula a `data/approved_formulas/` y la habilita para la calculadora.
   No se puede aprobar si faltan `service_category`, `formula_expression`, `variables`,
   `assumptions` ni justificación de los datos/base (la UI te muestra qué falta).
3. **Solo fórmulas `approved`** se usan en la calculadora (Regla 3).

### 5.4 Cómo usar la calculadora
1. Abre **Calculadora**. Rellena: categoría, subcategoría, **horas estimadas**, perfil,
   **tarifa/hora** (déjala vacía para usar 250 €), complejidad, urgencia, tipo de fee y
   descuento.
2. Pulsa **Calcular honorario**. Obtendrás:
   - **mínimo · recomendado · máximo** (Regla 13),
   - **fórmula usada** y **explicación** trazable (Reglas 9, 18),
   - **registros históricos comparables** (Regla 10),
   - **nivel de confianza** y **warnings** (Reglas 11, 14).
3. La calculadora **indica claramente cuándo ha usado la tarifa base**. Si no hay fórmula
   aprobada ni histórico suficiente, avisa con confianza baja ("información insuficiente").
4. Cada cálculo se guarda en **Historial** (Regla 17).

**Ejemplo:** categoría sin fórmula aprobada, 10 horas, tarifa vacía, complejidad media,
urgencia normal, sin descuento → recomendado **2.500 €** (10 × 250), rango **2.125 € – 2.875 €**
(±15%), confianza baja, con el aviso "Cálculo basado en tarifa base".

### 5.5 Cómo cambiar la tarifa base de 250 €/hora
Tres niveles, de lo puntual a lo permanente:

1. **Solo para un cálculo:** escribe otra cifra en **Tarifa/hora** en la calculadora.
   Si la dejas vacía, vuelve a 250 €.
2. **Por categoría:** en **Categorías**, edita `default_hourly_rate` (valor inicial 250).
3. **Global (tarifa base y factores):** en la pantalla de configuración / endpoint
   `PUT /api/config`, que escribe `data/service_categories/_config.json`. Ejemplo:
   ```json
   { "base_hourly_rate": 300,
     "complexity_factor": { "low": 0.85, "medium": 1.0, "high": 1.3 },
     "urgency_factor": { "normal": 1.0, "urgent": 1.2, "very_urgent": 1.4 } }
   ```
   El valor por defecto del código vive en `backend/config/factors.ts`
   (`BASE_HOURLY_RATE = 250`); si no hay override en disco, se usa 250.

### 5.6 Cómo cargar muchos acuerdos antiguos (importación masiva)
Para incorporar cientos de documentos históricos como base de precios. **Todo es local; nada sale de tu equipo.**

**Vía recomendada para lotes grandes (500+): por carpeta.**
1. Copia tus documentos a `data/inbox/` (admite subcarpetas), o usa cualquier ruta.
2. Ejecuta:
   ```bash
   npm run import                       # procesa data/inbox/
   # o una carpeta concreta:
   node admin/import.ts /ruta/a/tus/acuerdos "tu_nombre"
   ```
3. El importador sube cada PDF/DOCX/XLSX/CSV/TXT/imagen, extrae texto y registros
   (en estado `pending_review`) y muestra progreso por archivo. Los **escaneados/imagen**
   sin OCR se marcan `manual_review_needed` (no se inventa contenido).
4. Revisa y **aprueba** los registros en *Revisar registros*. Sólo los aprobados
   alimentan las referencias y las fórmulas.

**Vía navegador (lotes moderados, ~100):** en *Subir documentos* → tarjeta
*Importación masiva*, arrastra varios archivos y pulsa *Subir lote y extraer*.

> **OCR para escaneados/imágenes (ACTIVADO)**: `tesseract.js` (OCR español+inglés) y
> `pdf-to-img` (rasterización de PDFs) ya están instalados. Los PDF escaneados se
> convierten a imagen y se OCR-ean automáticamente; las imágenes (PNG/JPG) también.
> Todo el OCR corre **en local** (sólo el modelo de idioma se descarga una vez de un
> CDN; tus documentos nunca salen del equipo). El texto OCR se marca con confianza
> baja y aviso de "revisión recomendada". Si un archivo no es una imagen válida o un
> PDF ilegible, se marca para revisión manual (no se inventa contenido, Regla 12).

### 5.7 Referencias de precios (acuerdos antiguos como base del cálculo)
La pantalla **Referencias de precios** construye, por cada área/subárea, un *benchmark*
a partir de los **acuerdos históricos aprobados**: tamaño de muestra, rango
**P25 · mediana · P75**, mín/media/máx, **tarifa/hora típica**, distribución de tipo de
fee, periodo y la **lista de acuerdos que lo respaldan** (trazabilidad, Regla 18).
- Sólo cuentan registros `approved` (Regla 3); lo no validado no aparece.
- Nada se inventa: un área sin datos muestra *"información insuficiente"* (Reglas 11–12).
- La **calculadora adjunta esta referencia a cada cálculo**, junto a la fórmula usada,
  como contexto histórico que respalda el importe sugerido.

### 5.8 Organizar por área y reclasificar
La pantalla **Organizar por área** acomoda todo lo analizado **por área de servicio**:
para cada área muestra cuántos registros (y de cuántos documentos) hay, su desglose por
estado (aprobados/pendientes/rechazados) y el **rango de costos** de sus acuerdos aprobados
(mín · mediana · máx · tarifa/hora típica). Las áreas sin datos se listan aparte.

Desde ahí puedes **mover/reclasificar** un registro mal clasificado a otra área (revisión
humana, R15): el selector "Mover a otra área" actualiza el registro vía `PUT /api/records/:id`
y vuelve a agrupar. Al moverlo se limpia la subárea para que la afines en *Revisar registros*.
La clasificación inicial por área es automática (al extraer), pero **siempre es revisable**.

---

## 6. API (resumen)

`GET /api/health` · `GET|PUT /api/config` · `GET /api/dashboard` ·
`POST|GET /api/documents` · `GET /api/documents/:id` · `DELETE /api/documents/:id[?force=true]` · `POST /api/documents/:id/extract-records` ·
`GET /api/records?status=` · `PUT /api/records/:id` · `POST /api/records/:id/{approve,reject}` ·
`GET|POST /api/categories` · `PUT /api/categories/:id` ·
`POST /api/formulas/generate` · `GET /api/formulas?status=` · `PUT /api/formulas/:id` ·
`POST /api/formulas/:id/{approve,reject}` · `GET /api/approved-formulas` ·
`POST /api/calculate` · `GET /api/calculations` ·
`GET /api/references[?category=&subcategory=]` · `POST /api/import` (importación masiva por carpeta)

---

## 7. Tests (29/29 ✓)

`npm test` ejecuta los tests obligatorios agrupados en:
`documents.test.ts` (1–5), `records.test.ts` (6–10), `formulas.test.ts` (11–14),
`calculator.test.ts` (15–26), `interface.test.ts` (27–29). Cubren extracción y degradación,
estados de revisión, no-invención de datos, trazabilidad, generación/aprobación de fórmulas,
aritmética del motor (10 h → 2.500 €; alta → ×1,30; urgente → ×1,20; descuento; rangos),
uso de la tarifa base, y persistencia del historial.
