# ARCHITECTURE.md — Arquitectura de la Calculadora Inteligente de Honorarios

> Documento de referencia técnica. Describe el stack, la estructura de carpetas,
> las decisiones de diseño y cómo migrar el almacenamiento de JSON a SQLite/Postgres.
> Toda decisión aquí descrita está subordinada a `PROJECT_RULES.md` (la constitución)
> y a las firmas de `docs/CONTRACTS.md`.

---

## 1. Visión general

La herramienta es una aplicación interna de un despacho legal que **sugiere
honorarios** (no precios obligatorios, Regla 1) a partir de:

- **Documentos históricos** subidos por usuarios internos.
- **Registros de trabajo aprobados** extraídos de esos documentos.
- **Fórmulas de honorarios aprobadas** generadas a partir de los registros.

El principio rector es la **revisión humana**: la IA extrae datos y sugiere
fórmulas, pero **nada se aprueba automáticamente** (Reglas 4-7). Cada entidad
generada automáticamente nace en `review_status: "pending_review"` y sólo un
usuario interno puede pasarla a `approved`. Únicamente las entidades `approved`
se usan aguas abajo (en el generador de fórmulas y en la calculadora final).

Otro principio transversal: **nunca inventar datos** (Regla 12). Ante un dato
ausente se usa `null` o `"unknown"`; ante falta de evidencia, la salida declara
"información insuficiente" con confianza baja (Regla 11).

---

## 2. Stack tecnológico

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Runtime | **Node 24** | Instalado en `~/.local/node/bin`. |
| Lenguaje | **TypeScript nativo (strip-only)** | Node 24 ejecuta `.ts` **eliminando los tipos**, sin transpilar (`node archivo.ts`). No hay paso de compilación. |
| Módulos | **ESM puro** | `package.json` tiene `"type": "module"`. Sin `require()` salvo `import()` dinámico para dependencias opcionales. |
| Almacenamiento | **JSON por repositorios** | Una carpeta por colección bajo `data/`, un archivo `<id>.json` por entidad. |
| Backend | **`node:http` sin framework** | Servidor HTTP propio; sirve estáticos de `frontend/` y expone la API JSON bajo `/api`. |
| Frontend | **HTML + CSS + JS vanilla** | SPA ligera, sin build. Identidad ILP (navy/gold/cream, fuentes Cormorant + Inter). Consume la API con `fetch`. |
| Extracción | **Dependencias opcionales** | `pdf-parse`, `mammoth`, `xlsx`, OCR. Se cargan con `import()` dinámico dentro de `try/catch`: si faltan, el sistema **degrada** a `manual_review_needed` en lugar de fallar. |

### 2.1 Por qué TypeScript "strip-only" condiciona el código

Como Node sólo elimina anotaciones de tipo (no genera runtime), están **prohibidas**
las construcciones de TS que requieren código emitido:

- `enum` → se usan **union types** (`'a' | 'b'`) más arrays `*_VALUES` para
  validación en runtime (ver `backend/models/index.ts`).
- **Parameter properties** (`constructor(private x: T)`) → el campo se declara aparte
  (ver `JsonRepository` en `backend/storage/repository.ts`).
- `namespace` con código, decoradores, `import =` → prohibidos.

Convenciones obligatorias:

- Imports locales **siempre con extensión `.ts`**: `import { x } from '../backend/models/index.ts'`.
- `import type { ... }` para importar sólo tipos (`verbatimModuleSyntax` activo).
- Dependencias opcionales mediante `import()` dinámico envuelto en `try/catch`.

---

## 3. Estructura de carpetas

```
/Users/williamhuang/calculadora-honorarios
├── PROJECT_RULES.md        # Las 18 reglas maestras (constitución)
├── package.json            # type:module, dependencias opcionales de extracción
├── tsconfig.json           # strict + verbatimModuleSyntax (no se usa para compilar)
│
├── docs/                   # Documentación
│   ├── CONTRACTS.md        # Firmas EXACTAS de cada módulo
│   ├── ARCHITECTURE.md     # (este archivo)
│   ├── DATA_FLOW.md        # Flujo extremo a extremo
│   └── DATA_MODELS.md      # Resumen de los 5 modelos
│
├── backend/
│   ├── models/index.ts     # CIMIENTO: los 5 modelos + union types + *_VALUES
│   ├── config/factors.ts   # CIMIENTO: BASE_HOURLY_RATE=250, factores, loadConfig()
│   ├── storage/
│   │   ├── repository.ts   # CIMIENTO: interfaz Repository<T> + JsonRepository<T>
│   │   └── index.ts        # CIMIENTO: instancias de repos (uno por colección)
│   ├── utils/id.ts         # CIMIENTO: newId(prefix), nowIso()
│   ├── routes/             # Handlers de la API (un archivo por área)
│   └── server.ts           # createServer()/startServer() con node:http
│
├── services/               # Lógica de negocio (funciones puras + persistencia)
│   ├── feeCalculator.ts        # CIMIENTO YA HECHO: motor de cálculo final
│   ├── documentTextExtractor.ts # Extracción de texto/tablas (deps opcionales)
│   ├── documentUploadService.ts # Guarda binario + lanza extracción + crea doc
│   ├── serviceClassifier.ts     # Clasifica categoría/subcategoría (heurística)
│   ├── workRecordExtractor.ts   # Documento -> ExtractedWorkRecord (pending_review)
│   ├── recordReview.ts          # Aprobar/rechazar/editar registros
│   ├── formulaGenerator.ts      # Registros approved -> PricingFormula (pending_review)
│   └── formulaReview.ts         # Aprobar/rechazar/editar fórmulas
│
├── frontend/
│   ├── pages/              # 8 pantallas de la SPA
│   └── assets/             # CSS, fuentes, JS, imágenes
│
├── admin/                  # seed.ts (datos mock) + reset.ts
│
└── data/                   # Almacenamiento JSON (una carpeta por colección)
    ├── uploaded_documents/     # UploadedDocument (metadatos + texto/tablas)
    ├── extracted_records/      # ExtractedWorkRecord
    ├── service_categories/     # ServiceCategory + _config.json (overrides)
    ├── pricing_formulas/       # PricingFormula pendientes/rechazadas
    ├── approved_formulas/      # PricingFormula approved (usables por la calculadora)
    └── calculation_history/    # FeeCalculation (historial, Regla 17)
```

> Los **cimientos** (`backend/models`, `backend/config`, `backend/storage`,
> `backend/utils`, `services/feeCalculator.ts`) y `package.json`/`tsconfig.json`
> **NO se modifican**: sólo se importan.

### 3.1 Capas y dirección de dependencias

```
frontend (fetch)
      │
      ▼
backend/routes  ──►  backend/server (node:http)
      │
      ▼
services/*            (lógica de negocio; NO leen/escriben archivos a mano)
      │
      ▼
backend/storage  (Repository<T>)   backend/config   backend/utils
      │
      ▼
data/  (JSON en disco)
```

Reglas de dependencia:

- Los **servicios** son el único lugar con lógica de negocio. Las **rutas** no
  reimplementan lógica: parsean la petición, llaman a un servicio/repo y serializan.
- Ningún servicio lee o escribe archivos a mano: todo acceso a datos pasa por un
  `Repository<T>`. Esto es lo que hace barata la migración de almacenamiento.
- `backend/config/factors.ts` es el **único punto de verdad** de la tarifa base
  (`BASE_HOURLY_RATE = 250`, Regla 2) y de los factores de complejidad/urgencia.

---

## 4. Almacenamiento: repositorios JSON

El contrato de acceso a datos es la interfaz `Repository<T extends Entity>`
(en `backend/storage/repository.ts`):

```ts
export interface Entity { id: string; }

export interface Repository<T extends Entity> {
  list(): T[];
  get(id: string): T | null;
  save(entity: T): T;          // create or replace (upsert)
  delete(id: string): boolean;
  clear(): void;
  find(predicate: (e: T) => boolean): T[];
}
```

La implementación actual, `JsonRepository<T>`, guarda **una entidad por archivo**
(`data/<colección>/<id>.json`), lo que da diffs legibles y trazabilidad por archivo
en el prototipo. Detalles relevantes:

- Sanea el `id` antes de construir la ruta del archivo (no path traversal).
- Ignora archivos que empiezan por `_` o `.` al listar/limpiar; por eso
  `data/service_categories/_config.json` (overrides de configuración, Regla 16)
  convive con las categorías sin contar como una entidad más.
- Tolera archivos corruptos: un JSON que no parsea se omite en `list()`/`get()`
  en lugar de tumbar el proceso.

Las instancias concretas viven en `backend/storage/index.ts`: `documentsRepo`,
`recordsRepo`, `categoriesRepo`, `formulasRepo`, `approvedFormulasRepo`,
`calculationsRepo` (y el objeto agregador `repos`).

---

## 5. Extractores opcionales con degradación

El módulo `services/documentTextExtractor.ts` detecta el tipo de archivo por
extensión y delega en un extractor:

| Tipo | Extractor | Si la dependencia falta |
|------|-----------|-------------------------|
| PDF | `pdf-parse` (texto nativo); si vacío, OCR | warning + `manual_review_needed` |
| DOCX | `mammoth` | warning + `manual_review_needed` |
| XLSX | `xlsx` | warning + `manual_review_needed` |
| CSV / TXT | parser propio (`parseCsv`, sin dependencias) | siempre disponible |
| PNG/JPG/JPEG | OCR si está disponible | `manual_review_needed` + warning |

Las dependencias se cargan con `import()` dinámico dentro de `try/catch`. Si una
no está instalada, **el sistema no falla**: devuelve `status: "failed"` o
`method: "manual_review_needed"` con un warning, respetando la Regla 12 (nunca
inventar texto). `isOcrAvailable()` permite a la UI anticipar la degradación.

---

## 6. Cómo migrar el almacenamiento a SQLite/Postgres

La clave del diseño es que **toda la aplicación habla con la interfaz
`Repository<T>`, nunca con el sistema de archivos directamente**. Migrar de JSON a
una base de datos real se reduce a aportar otra implementación de esa interfaz y
cambiar el punto de cableado (`backend/storage/index.ts`). Los servicios, rutas y
frontend **no cambian**.

### Paso 1 — Implementar `Repository<T>` para el nuevo motor

Crear, p. ej., `backend/storage/sqliteRepository.ts` con una clase
`SqliteRepository<T extends Entity>` que implemente los seis métodos. Cada
colección puede ser una tabla con dos columnas: `id TEXT PRIMARY KEY` y
`data TEXT/JSONB` (el documento completo serializado), de modo que el modelo de
datos no cambie. Esquema mental:

```ts
// backend/storage/sqliteRepository.ts  (boceto)
import type { Entity, Repository } from './repository.ts';

export class SqliteRepository<T extends Entity> implements Repository<T> {
  private readonly table: string;
  private readonly db: /* handle del driver */ unknown;

  constructor(db: unknown, table: string) {   // sin parameter properties (strip-only)
    this.db = db;
    this.table = table;
    // CREATE TABLE IF NOT EXISTS <table> (id TEXT PRIMARY KEY, data TEXT NOT NULL)
  }

  list(): T[]              { /* SELECT data FROM <table> -> JSON.parse */ return []; }
  get(id: string): T | null { /* SELECT data WHERE id = ? */ return null; }
  save(e: T): T            { /* INSERT ... ON CONFLICT(id) DO UPDATE (upsert) */ return e; }
  delete(id: string): boolean { /* DELETE WHERE id = ? -> changes > 0 */ return false; }
  clear(): void            { /* DELETE FROM <table> */ }
  find(p: (e: T) => boolean): T[] { return this.list().filter(p); }
}
```

Notas de implementación bajo Node 24 strip-only:

- Driver SQLite recomendado: **`node:sqlite`** (módulo nativo de Node 24, sin
  dependencias). Para Postgres, `pg` cargado con `import()` dinámico.
- **No usar parameter properties**: declarar los campos (`db`, `table`) aparte,
  como ya hace `JsonRepository`.
- `save` debe ser un **upsert** (`INSERT ... ON CONFLICT(id) DO UPDATE`) para
  respetar el contrato "create or replace".

### Paso 2 — Cambiar el cableado en `backend/storage/index.ts`

Sustituir las instancias de `JsonRepository` por las nuevas, manteniendo los
**mismos nombres exportados** (`documentsRepo`, `recordsRepo`, ...). Como la firma
exportada no cambia, ningún servicio se entera:

```ts
// antes
export const recordsRepo = new JsonRepository<ExtractedWorkRecord>(dataDir('extracted_records'));
// después
export const recordsRepo = new SqliteRepository<ExtractedWorkRecord>(db, 'extracted_records');
```

### Paso 3 — Migrar los datos existentes

Script único que recorre cada carpeta de `data/`, lee los JSON y llama a
`save()` del nuevo repositorio. Como ambos lados comparten la interfaz, el
migrador es trivial (leer del `JsonRepository`, escribir en el `SqliteRepository`).

### Paso 4 (opcional) — Optimizar consultas

Mientras los volúmenes sean pequeños, `find(predicate)` sobre `list()` basta. Si
crece el histórico, se pueden añadir columnas indexadas (p. ej.
`service_category`, `review_status`) y sobrescribir métodos de consulta concretos
en la implementación SQL **sin** ampliar la interfaz pública `Repository<T>`
(o ampliándola de forma aditiva y opcional).

### Qué NO cambia con la migración

- Los **modelos** (`backend/models/index.ts`).
- La **lógica de negocio** (`services/*`), incluido `feeCalculator.ts`.
- Las **rutas** y el **frontend**.
- Las **reglas** de `review_status` y trazabilidad: son responsabilidad de los
  servicios, no del almacenamiento.
