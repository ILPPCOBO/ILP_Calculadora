/* Pantalla 2 — Subir documentos.
   Zona DRAG & DROP + input file. Selector de tipo de documento. Al subir
   (POST /api/documents con el archivo en base64 JSON) muestra estado de
   extracción, texto extraído, tablas y warnings. Botón "Extraer registros"
   (POST /api/documents/:id/extract-records). Regla 8: trazabilidad. */

import {
  api, ApiError, esc, dash, fmtDate, confidenceBadge, warningsBlock, errorState,
  emptyState, loadingState, toast, navigate,
} from '/app.js';

const DOC_TYPES = [
  ['invoice', 'Factura'],
  ['proposal', 'Propuesta'],
  ['engagement_letter', 'Carta de encargo'],
  ['timesheet', 'Hoja de horas'],
  ['contract', 'Contrato'],
  ['email', 'Email'],
  ['spreadsheet', 'Excel / CSV'],
  ['other', 'Otro'],
];

const EXTRACTION_METHOD_LABELS = {
  native_text: 'Texto nativo', ocr: 'OCR',
  spreadsheet_parser: 'Lector de hojas de cálculo', manual_review_needed: 'Requiere revisión manual',
};

let selectedFile = null;

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Sube documentos históricos (facturas, propuestas, cartas de encargo, hojas de horas, contratos, emails, Excel/CSV). El sistema extrae texto y tablas. Nada se inventa: los datos ausentes quedan vacíos (Regla 12).</p>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2 class="card-title">Nuevo documento</h2>
        <div class="field">
          <label for="doc-type">Tipo de documento</label>
          <select id="doc-type">
            ${DOC_TYPES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
          </select>
        </div>

        <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Zona para arrastrar y soltar archivos">
          <span class="dz-ico" aria-hidden="true">⇪</span>
          <div><strong>Arrastra un archivo aquí</strong> o haz clic para seleccionar.</div>
          <div class="small muted mt-8">PDF, DOCX, XLSX, CSV, TXT, PNG, JPG</div>
          <input type="file" id="file-input" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg" />
        </div>

        <div id="file-chosen" class="small mt-8"></div>

        <div class="btn-row mt-16">
          <button class="btn btn-primary" id="btn-upload" disabled>Subir y extraer</button>
          <button class="btn btn-ghost" id="btn-clear" disabled>Quitar archivo</button>
        </div>
      </div>

      <div class="card">
        <div class="flex between center mb-8">
          <h2 class="card-title mb-0">Documentos subidos</h2>
          <button class="btn btn-sm" id="btn-refresh">Actualizar</button>
        </div>
        <div id="doc-list">${loadingState()}</div>
      </div>
    </div>

    <div class="card mt-16">
      <h2 class="card-title">Importación masiva de acuerdos antiguos</h2>
      <p class="small">Carga muchos documentos a la vez. Procesamiento <strong>100% local</strong>: nada sale de tu equipo. Cada documento genera registros en estado “pendiente de revisión”.</p>
      <div class="field">
        <label for="doc-type-bulk">Tipo de documento del lote</label>
        <select id="doc-type-bulk">
          <option value="auto" selected>Detectar por nombre de archivo</option>
          ${DOC_TYPES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
      </div>
      <div class="dropzone" id="bulk-dropzone" tabindex="0" role="button" aria-label="Zona para soltar varios archivos">
        <span class="dz-ico" aria-hidden="true">❖</span>
        <div><strong>Arrastra varios archivos aquí</strong> o haz clic para seleccionarlos.</div>
        <div class="small muted mt-8">Recomendado hasta ~100 por tanda desde el navegador.</div>
        <input type="file" id="bulk-input" multiple accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg" />
      </div>
      <div id="bulk-chosen" class="small mt-8"></div>
      <div class="btn-row mt-8"><button class="btn btn-primary" id="btn-bulk" disabled>Subir lote y extraer</button></div>
      <div id="bulk-progress" class="small mt-8"></div>
      <div class="alert alert-info mt-16"><span>❖</span><div>
        <strong>¿Tienes 500+ documentos?</strong> Es más rápido por carpeta: suelta los archivos en
        <span class="mono">data/inbox/</span> y ejecuta en el terminal
        <span class="mono">npm run import</span>
        (o <span class="mono">node admin/import.ts /ruta/a/tu/carpeta "tu_nombre"</span>).
        Da progreso por archivo y marca los escaneados que necesitan OCR.
      </div></div>
    </div>

    <div class="card mt-16" id="result-card" style="display:none;">
      <h2 class="card-title">Resultado de extracción</h2>
      <div id="extract-result"></div>
    </div>
  `;

  const dz = view.querySelector('#dropzone');
  const input = view.querySelector('#file-input');
  const chosen = view.querySelector('#file-chosen');
  const btnUpload = view.querySelector('#btn-upload');
  const btnClear = view.querySelector('#btn-clear');

  function setFile(file) {
    selectedFile = file || null;
    if (file) {
      chosen.innerHTML = `Seleccionado: <strong>${esc(file.name)}</strong> (${(file.size / 1024).toFixed(1)} KB)`;
      btnUpload.disabled = false; btnClear.disabled = false;
    } else {
      chosen.innerHTML = ''; btnUpload.disabled = true; btnClear.disabled = true; input.value = '';
    }
  }

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => setFile(input.files[0]));

  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  btnClear.addEventListener('click', () => setFile(null));
  view.querySelector('#btn-refresh').addEventListener('click', () => loadDocuments(view));

  btnUpload.addEventListener('click', async () => {
    if (!selectedFile) return;
    btnUpload.disabled = true;
    const original = btnUpload.textContent;
    btnUpload.textContent = 'Subiendo…';
    try {
      const base64 = await fileToBase64(selectedFile);
      const payload = {
        filename: selectedFile.name,
        fileType: detectType(selectedFile.name),
        documentType: view.querySelector('#doc-type').value,
        uploadedBy: 'usuario_interno',
        content_base64: base64,
      };
      const doc = await api.uploadDocument(payload);
      toast('Documento subido. Extracción realizada.', 'ok', 'Subida correcta');
      setFile(null);
      renderResult(view, doc);
      loadDocuments(view);
    } catch (err) {
      toast(err.message || 'Error al subir el documento.', 'error', 'Error de subida');
    } finally {
      btnUpload.textContent = original;
      btnUpload.disabled = !selectedFile;
    }
  });

  // ---- Importación masiva (multi-archivo) ----
  const bulkDz = view.querySelector('#bulk-dropzone');
  const bulkInput = view.querySelector('#bulk-input');
  const bulkChosen = view.querySelector('#bulk-chosen');
  const btnBulk = view.querySelector('#btn-bulk');
  let bulkFiles = [];

  function setBulkFiles(list) {
    bulkFiles = Array.from(list || []);
    if (bulkFiles.length) {
      bulkChosen.innerHTML = `Seleccionados: <strong>${bulkFiles.length}</strong> archivo(s).`;
      btnBulk.disabled = false;
    } else {
      bulkChosen.innerHTML = ''; btnBulk.disabled = true; bulkInput.value = '';
    }
  }

  bulkDz.addEventListener('click', () => bulkInput.click());
  bulkDz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bulkInput.click(); } });
  bulkInput.addEventListener('change', () => setBulkFiles(bulkInput.files));
  ['dragenter', 'dragover'].forEach((ev) => bulkDz.addEventListener(ev, (e) => { e.preventDefault(); bulkDz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => bulkDz.addEventListener(ev, (e) => { e.preventDefault(); bulkDz.classList.remove('dragover'); }));
  bulkDz.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) setBulkFiles(e.dataTransfer.files); });
  btnBulk.addEventListener('click', () => bulkUpload(view, bulkFiles, view.querySelector('#doc-type-bulk').value, () => setBulkFiles([])));

  loadDocuments(view);
}

/** Sube secuencialmente un lote de archivos y extrae sus registros (pending_review). */
async function bulkUpload(view, files, docType, onDone) {
  if (!files || files.length === 0) return;
  const prog = view.querySelector('#bulk-progress');
  const btn = view.querySelector('#btn-bulk');
  btn.disabled = true;
  let okC = 0; let recC = 0; let failC = 0; let reviewC = 0;

  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    prog.innerHTML = `<span class="spinner"></span> Procesando ${i + 1}/${files.length}: ${esc(f.name)}…`;
    try {
      const base64 = await fileToBase64(f);
      const doc = await api.uploadDocument({
        filename: f.name,
        fileType: detectType(f.name),
        documentType: docType === 'auto' ? guessType(f.name) : docType,
        uploadedBy: 'usuario_interno',
        content_base64: base64,
      });
      okC += 1;
      if (doc.extraction_method === 'manual_review_needed' || doc.extraction_status === 'failed') {
        reviewC += 1;
      } else if (doc.extraction_status === 'completed') {
        const r = await api.extractRecords(doc.id);
        const recs = Array.isArray(r) ? r : (r.records || []);
        recC += recs.length;
      }
    } catch (err) {
      failC += 1;
    }
  }

  prog.innerHTML = `<div class="alert alert-ok"><span>✓</span><div>
    Lote completado: <strong>${okC}</strong> subidos · <strong>${recC}</strong> registro(s) pendientes ·
    <strong>${reviewC}</strong> requieren revisión/OCR · <strong>${failC}</strong> fallidos.
    <a href="#/records">Ir a revisar registros →</a></div></div>`;
  btn.disabled = false;
  if (onDone) onDone();
  loadDocuments(view);
}

/** Heurística cliente para el tipo de documento por nombre (espejo de batchImport). */
function guessType(filename) {
  const n = filename.toLowerCase();
  const ext = (n.split('.').pop() || '');
  if (/(factura|invoice)/.test(n)) return 'invoice';
  if (/(presupuesto|propuesta|proposal|oferta|quote)/.test(n)) return 'proposal';
  if (/(encargo|engagement)/.test(n)) return 'engagement_letter';
  if (/(timesheet|horas|imputacion|dedicacion)/.test(n)) return 'timesheet';
  if (/(contrato|acuerdo|agreement|contract|convenio)/.test(n)) return 'contract';
  if (/(email|correo|mail)/.test(n)) return 'email';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'spreadsheet';
  return 'other';
}

async function loadDocuments(view) {
  const box = view.querySelector('#doc-list');
  if (!box) return;
  box.innerHTML = loadingState();
  let docs;
  try { docs = await api.listDocuments(); }
  catch (err) { box.innerHTML = errorState(err); return; }

  if (!docs || docs.length === 0) {
    box.innerHTML = emptyState('Todavía no hay documentos subidos.', '⇪');
    return;
  }

  box.innerHTML = `<div class="table-wrap"><table class="data">
    <thead><tr><th>Archivo</th><th>Tipo</th><th>Extracción</th><th>Subido</th><th></th></tr></thead>
    <tbody>${docs.map(docRow).join('')}</tbody>
  </table></div>`;

  box.querySelectorAll('[data-view-doc]').forEach((b) =>
    b.addEventListener('click', async () => {
      try { renderResult(view, await api.getDocument(b.dataset.viewDoc)); }
      catch (err) { toast(err.message, 'error', 'Error'); }
    }));

  box.querySelectorAll('[data-del-doc]').forEach((b) =>
    b.addEventListener('click', () => deleteDoc(view, b.dataset.delDoc, b.dataset.delName)));
}

/** Elimina un documento subido (con cascada de registros). Confirma antes;
    si hay registros aprobados, la API responde 409 y se pide confirmación reforzada. */
async function deleteDoc(view, id, name) {
  if (!window.confirm(
    `¿Eliminar el documento “${name}”?\n\n`
    + 'Se borrarán también los registros extraídos de él (pendientes o rechazados) y el archivo original. '
    + 'Esta acción no se puede deshacer.',
  )) return;

  try {
    const res = await api.deleteDocument(id, false);
    toast(`Documento eliminado · ${res.records_deleted} registro(s) borrados.`, 'ok', 'Eliminado');
    loadDocuments(view);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.body) {
      const info = err.body;
      const force = window.confirm(
        `⚠ ${info.reason || 'Este documento tiene registros aprobados.'}\n\n`
        + `Eliminar IGUALMENTE el documento y sus ${info.records_total} registro(s) `
        + `(incluidos ${info.records_approved} APROBADO(S) que respaldan referencias y fórmulas).\n\n`
        + '¿Continuar?',
      );
      if (!force) return;
      try {
        const res2 = await api.deleteDocument(id, true);
        toast(`Documento y ${res2.records_deleted} registro(s) eliminados.`, 'ok', 'Eliminado');
        loadDocuments(view);
      } catch (e2) {
        toast(e2.message || 'Error al eliminar.', 'error', 'Error');
      }
    } else {
      toast(err.message || 'Error al eliminar el documento.', 'error', 'Error');
    }
  }
}

function docRow(d) {
  const statusPills = {
    completed: '<span class="pill pill-approved">Completada</span>',
    failed: '<span class="pill pill-rejected">Fallida</span>',
    pending: '<span class="pill pill-pending">Pendiente</span>',
  };
  return `<tr>
    <td>${esc(d.original_filename || d.filename || '—')}</td>
    <td><span class="pill pill-muted">${esc(docTypeLabel(d.document_type))}</span></td>
    <td>${statusPills[d.extraction_status] || dash(d.extraction_status)}</td>
    <td class="nowrap small">${fmtDate(d.uploaded_at)}</td>
    <td class="text-right nowrap">
      <button class="btn btn-sm" data-view-doc="${esc(d.id)}">Ver</button>
      <button class="btn btn-sm btn-danger" data-del-doc="${esc(d.id)}" data-del-name="${esc(d.original_filename || d.filename || d.id)}">Eliminar</button>
    </td>
  </tr>`;
}

function renderResult(view, doc) {
  const card = view.querySelector('#result-card');
  const box = view.querySelector('#extract-result');
  card.style.display = '';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const tables = doc.extracted_tables || [];
  const tablesHtml = tables.length
    ? tables.map(renderTable).join('')
    : `<p class="muted small">No se detectaron tablas.</p>`;

  box.innerHTML = `
    <dl class="kv mb-16">
      <dt>Archivo</dt><dd>${dash(doc.original_filename || doc.filename)}</dd>
      <dt>Tipo</dt><dd>${esc(docTypeLabel(doc.document_type))}</dd>
      <dt>Estado</dt><dd>${esc(doc.extraction_status || '—')}</dd>
      <dt>Método</dt><dd>${esc(EXTRACTION_METHOD_LABELS[doc.extraction_method] || doc.extraction_method || '—')}</dd>
      <dt>Confianza</dt><dd>${confidenceBadge(doc.confidence_level)}</dd>
      <dt>Trazabilidad</dt><dd class="small muted">${(doc.source_locations || []).length} localización(es) de origen registradas</dd>
    </dl>

    ${warningsBlock(doc.warnings)}

    <h3>Texto extraído</h3>
    ${doc.extracted_text
      ? `<div class="extract-preview">${esc(doc.extracted_text)}</div>`
      : `<div class="alert alert-warn"><span>⚠</span><div>No se extrajo texto. Puede requerir revisión manual (Regla 12: no se inventa contenido).</div></div>`}

    <h3 class="mt-16">Tablas extraídas</h3>
    ${tablesHtml}

    <div class="btn-row mt-16">
      <button class="btn btn-primary" id="btn-extract-records" ${doc.extraction_status === 'completed' ? '' : 'disabled'}>
        Extraer registros
      </button>
      <span class="small muted">Los registros nacen en estado “pendiente de revisión” (Reglas 5, 12).</span>
    </div>
    <div id="extract-records-out" class="mt-16"></div>
  `;

  const btn = box.querySelector('#btn-extract-records');
  btn?.addEventListener('click', async () => {
    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Extrayendo…';
    const out = box.querySelector('#extract-records-out');
    try {
      const res = await api.extractRecords(doc.id);
      const records = Array.isArray(res) ? res : (res.records || []);
      out.innerHTML = `<div class="alert alert-ok"><span>✓</span><div>
        Se generaron <strong>${records.length}</strong> registro(s) en estado pendiente de revisión.
        <a href="#/records">Ir a revisar registros →</a></div></div>`;
      toast(`${records.length} registro(s) extraídos.`, 'ok', 'Extracción');
    } catch (err) {
      out.innerHTML = `<div class="alert alert-danger"><span>✕</span><div>${esc(err.message)}</div></div>`;
      toast(err.message, 'error', 'Error');
    } finally { btn.textContent = t; btn.disabled = false; }
  });
}

function renderTable(t) {
  const name = t.name ? `<div class="small muted mb-8">${esc(t.name)}</div>` : '';
  const headers = (t.headers || []).map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = (t.rows || []).slice(0, 25).map((r) =>
    `<tr>${r.map((c) => `<td>${c === null || c === undefined ? '<span class="muted">—</span>' : esc(c)}</td>`).join('')}</tr>`
  ).join('');
  return `${name}<div class="table-wrap mb-16"><table class="data">
    <thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- utilidades ----
function docTypeLabel(t) { return (DOC_TYPES.find(([v]) => v === t) || [, t || '—'])[1]; }

function detectType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'xls') return 'xlsx';
  if (ext === 'jpeg') return 'jpg';
  return ext;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result); // sin el prefijo data:...
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}
