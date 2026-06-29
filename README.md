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
| Tests | Runner integrado **`node:test`** (80 tests) | Sin dependencias de testing |

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
├── package.json              # scripts: start, seed, reset, import, test
├── Calculadora-Honorarios-OFFLINE.html  # versión WEB en un solo archivo (sin backend; para Cloudflare)
├── backend/
│   ├── models/index.ts       # modelos de datos + tipos (incl. desglose de actuaciones)
│   ├── config/factors.ts     # BASE_HOURLY_RATE=250 + factores (editables)
│   ├── storage/              # repository.ts (genérico) + index.ts (repos tipados)
│   ├── utils/                # id.ts (ids y fechas) · zip.ts (.docx sin dependencias)
│   ├── server.ts             # servidor HTTP (sirve frontend + API)
│   └── routes/               # handlers por dominio
├── services/                 # LÓGICA DE NEGOCIO
│   ├── documentTextExtractor.ts
│   ├── documentUploadService.ts
│   ├── serviceClassifier.ts
│   ├── workRecordExtractor.ts
│   ├── recordReview.ts
│   ├── formulaGenerator.ts / formulaReview.ts
│   ├── feeCalculator.ts      # motor de cálculo final (adjunta la referencia histórica)
│   ├── caseEstimator.ts      # estima horas+honorarios desde una descripción
│   ├── referencePricing.ts   # benchmarks de precios por área (acuerdos aprobados)
│   ├── batchImport.ts        # importación masiva de documentos desde carpeta
│   ├── plannedActionsBreakdown.ts  # desglose de actuaciones (valor alta/media/baja)
│   └── wordBreakdownExporter.ts    # exporta el desglose a .docx (ZIP/OOXML sin deps)
├── frontend/                 # SPA: 7 secciones + subida multi-archivo + desglose editable
├── admin/                    # seed.ts (datos mock) · reset.ts · import.ts (importación masiva)
├── data/                     # almacenamiento JSON (NO versionado salvo service_categories)
├── tests/                    # 80 tests + fixtures/ (PDF nativo, PDF escaneado, imagen)
└── docs/                     # ARCHITECTURE, DATA_FLOW, DATA_MODELS, CONTRACTS
```

> **Confidencialidad:** `.gitignore` excluye todo `data/*` salvo el catálogo de categorías
> (`data/service_categories`). Los documentos subidos, registros extraídos, fórmulas,
> historial y exportaciones **nunca** se suben al repositorio.

---

## 3. Puesta en marcha

> Si `node` no aparece en tu PATH, ejecútalo desde donde lo tengas instalado
> (en este equipo: `export PATH="$HOME/.local/node/bin:$PATH"`). Requiere **Node ≥ 22.6**.

```bash
cd ~/calculadora-honorarios
npm install        # opcional: instala extractores PDF/DOCX/XLSX/OCR (degradan si faltan)
npm run seed       # carga datos mock de demostración
npm start          # arranca en http://localhost:3000
```

Otros comandos:

```bash
npm test           # ejecuta los 80 tests (node:test)
npm run reset      # vacía todos los repos
npm run dev        # arranca con --watch (recarga al guardar)
npm run import     # importación masiva desde data/inbox/
```

El menú lateral tiene **7 secciones**: Describir caso · Subir documentos · Revisar registros ·
Por área y precios · Calculadora · **Desglose de actuaciones** · Historial.

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
  → calculadora de honorarios / describir caso
  → honorario sugerido con mínimo/recomendado/máximo + explicación + trazabilidad
  → (opcional) desglose de actuaciones previstas → exportable a Word
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

### 5.3 Describir caso (estimación en lenguaje natural)
En **Describir caso** (pantalla inicial) describes el trabajo en lenguaje natural y la
herramienta detecta el **servicio**, identifica **tareas**, estima **horas** (mín/rec/máx con
percentiles de acuerdos históricos aprobados) y calcula un **honorario sugerido** con la
tarifa base de 250 € (o personalizada) × complejidad × urgencia. Si la descripción es vaga,
pide más detalle. Cada estimación se guarda en el historial.

### 5.4 Cómo usar la calculadora
1. Abre **Calculadora**. Rellena: categoría, subcategoría, **horas estimadas**, perfil,
   **tarifa/hora** (déjala vacía para usar 250 €), complejidad, urgencia, tipo de fee y
   descuento.
2. Pulsa **Calcular honorario**. Obtendrás **mínimo · recomendado · máximo**, **fórmula
   usada** y **explicación** trazable, **registros comparables**, **nivel de confianza** y
   **warnings**. Indica claramente cuándo ha usado la tarifa base. Cada cálculo se guarda en
   **Historial**.

### 5.5 Cómo cambiar la tarifa base de 250 €/hora
1. **Solo para un cálculo:** escribe otra cifra en **Tarifa/hora** (vacía = 250 €).
2. **Por categoría:** en **Categorías**, edita `default_hourly_rate`.
3. **Global:** `PUT /api/config` (escribe `data/service_categories/_config.json`). El valor
   por defecto del código vive en `backend/config/factors.ts` (`BASE_HOURLY_RATE = 250`).

### 5.6 Importación masiva de acuerdos antiguos
**Todo es local; nada sale de tu equipo.** Para lotes grandes (500+), por carpeta:
```bash
npm run import                       # procesa data/inbox/
node admin/import.ts /ruta/a/tus/acuerdos "tu_nombre"   # o una carpeta concreta
```
Sube cada PDF/DOCX/XLSX/CSV/TXT/imagen, extrae registros (`pending_review`) y da progreso por
archivo. Los escaneados/imagen sin OCR se marcan `manual_review_needed`. Vía navegador
(lotes ~100): *Subir documentos → Importación masiva*.

### 5.7 Referencias y organización por área
**Referencias de precios** construye, por área/subárea, un *benchmark* de los acuerdos
**aprobados**: muestra, P25 · mediana · P75, tarifa/hora típica, distribución de fee y los
acuerdos que lo respaldan. **Organizar por área** agrupa lo analizado por área (con conteos y
rango de costos) y permite **mover/reclasificar** registros mal clasificados (`PUT /api/records/:id`).

### 5.8 Desglose de actuaciones previstas
Descompone un mandato en **actuaciones jurídicas concretas** y valora cada una por su
**aportación de valor** (alta / media / baja), no sólo por el tiempo, para **justificar el
honorario sugerido**. Se genera con el botón *"Generar desglose de actuaciones previstas"* en
los resultados de **Describir caso** y **Calculadora**, o eligiendo un cálculo del historial en
la sección **Desglose de actuaciones**.
- Cada actuación lleva: título, descripción, **nivel de valor + motivo**, horas (mín/rec/máx),
  porción de honorario, perfil responsable, entregable y visibilidad al cliente.
- Las horas por actuación **suman de forma coherente** con el total (aviso si no cuadran).
- **Editable**: añadir, eliminar, reordenar, cambiar valoración/horas/perfil; se guarda en historial.
- **Exporta a Word (.docx)** con formato profesional (resumen, tabla, distribución de valor,
  supuestos, información pendiente y nota de revisión interna). El `.docx` se construye sin
  dependencias (`backend/utils/zip.ts` + OOXML).
- Módulos: `services/plannedActionsBreakdown.ts`, `services/wordBreakdownExporter.ts`;
  rutas `GET|POST /api/breakdowns`, `GET|PUT|DELETE /api/breakdowns/:id`, `POST /api/breakdowns/:id/export-word`.

---

## 6. API (resumen)

`GET /api/health` · `GET|PUT /api/config` · `GET /api/dashboard` ·
`POST|GET /api/documents` · `GET /api/documents/:id` · `DELETE /api/documents/:id[?force=true]` · `POST /api/documents/:id/extract-records` ·
`GET /api/records?status=` · `PUT /api/records/:id` · `POST /api/records/:id/{approve,reject}` ·
`GET|POST /api/categories` · `PUT /api/categories/:id` ·
`POST /api/formulas/generate` · `GET /api/formulas?status=` · `PUT /api/formulas/:id` ·
`POST /api/formulas/:id/{approve,reject}` · `GET /api/approved-formulas` ·
`POST /api/calculate` · `GET /api/calculations` · `POST /api/estimate-case` ·
`GET /api/references[?category=&subcategory=]` · `POST /api/import` ·
`GET|POST /api/breakdowns` · `GET|PUT|DELETE /api/breakdowns/:id` · `POST /api/breakdowns/:id/export-word`

---

## 7. Tests (80/80 ✓)

`npm test` ejecuta los 80 tests con `node:test`. Cubren: extracción y degradación elegante,
estados de revisión, no-invención de datos, trazabilidad, generación/aprobación de fórmulas,
aritmética del motor (10 h → 2.500 €; alta → ×1,30; urgente → ×1,20; descuentos; rangos),
uso de la tarifa base, persistencia del historial, estimación desde descripción
(`case-estimator`), referencias por área, importación, navegación, y el **desglose de
actuaciones** (`planned-actions.test.ts`) con su **exportación a Word** (`word-breakdown.test.ts`).

---

## 8. Versión web en un solo archivo (offline / Cloudflare)

`Calculadora-Honorarios-OFFLINE.html` es la app **completa en un único archivo HTML**, sin
backend ni dependencias: funciona con doble clic o servida como estático. Tiene 4 pestañas:
**Describir caso**, **Desglose de actuaciones** (con exportación a Word y guardado en el
navegador vía `localStorage`), **Referencias por área** y **Propuestas**.

- **Propuestas**: arrastra documentos (Word `.docx`, Excel `.xlsx`, texto; PDF si hay conexión)
  y la herramienta **analiza el contenido en el navegador** para deducir **área, horas y
  honorario**; si el área no existe, **crea una nueva**. Se guardan en `localStorage` y
  **afinan las estimaciones**. Word/Excel se leen con APIs nativas del navegador
  (`DecompressionStream`); el documento **no se sube** a ningún servidor.
- Lleva una *foto fija* de los agregados por área (medianas/percentiles), sin documentos ni
  nombres de clientes.

### Desplegar en Cloudflare
- **Pages (sin código):** sube una carpeta que contenga **sólo `index.html`** (una copia del
  HTML) → *Workers & Pages → Create → Pages → Upload assets*.
- **Worker (código):** un proyecto con `wrangler.toml` + `src/index.js` (que sirve el HTML
  embebido) → `npx wrangler deploy`.

> El "guardado" de Propuestas/desgloses es local del navegador (no se comparte entre equipos).
> Para un repositorio compartido por todo el despacho haría falta un backend.
