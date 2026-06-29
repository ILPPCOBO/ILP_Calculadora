/* Pantalla — Organizar por área.
   Agrupa los registros (documentos analizados) por área de servicio, con sus
   conteos por estado, el rango de COSTOS de los acuerdos aprobados (referencia)
   y la lista de registros. Permite MOVER/reclasificar un registro a otra área
   (revisión humana, R15): usa PUT /api/records/:id (updateRecord).

   Sólo orquesta la API. No inventa datos (R12). */

import {
  api, esc, dash, money, statusPill, confidenceBadge, errorState,
  emptyState, loadingState, toast,
} from '/app.js';

let categories = [];
let areaNames = [];

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Documentos y registros <strong>acomodados por área</strong>, con el rango de costos de los acuerdos aprobados de cada una. Puedes <strong>mover</strong> un registro mal clasificado a otra área (revisión humana). Sólo los registros <em>aprobados</em> cuentan para los costos de referencia.</p>
    </div>
    <div class="flex between center mb-8">
      <span class="small muted" id="area-summary"></span>
      <button class="btn btn-sm" id="btn-refresh">Actualizar</button>
    </div>
    <div id="areas-box">${loadingState()}</div>
  `;
  view.querySelector('#btn-refresh').addEventListener('click', () => load(view));
  await load(view);
}

async function load(view) {
  const box = view.querySelector('#areas-box');
  box.innerHTML = loadingState();
  let records; let refs; let docs;
  try {
    [categories, records, refs, docs] = await Promise.all([
      api.listCategories(), api.listRecords(), api.listReferences(), api.listDocuments(),
    ]);
  } catch (err) {
    box.innerHTML = errorState(err);
    return;
  }

  areaNames = categories.map((c) => c.name);

  // Referencia de costos a nivel de área (subcategoría null).
  const refByArea = {};
  (refs || []).forEach((r) => { if (r.service_subcategory === null) refByArea[r.service_category] = r; });

  // Agrupar registros por área (service_category).
  const groups = new Map();
  for (const rec of (records || [])) {
    const area = rec.service_category || 'unknown';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(rec);
  }

  // Orden: áreas con registros primero (por nº desc), luego las vacías.
  const withRecords = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);
  const emptyAreas = areaNames.filter((n) => !groups.has(n));

  view.querySelector('#area-summary').textContent =
    `${(records || []).length} registro(s) en ${withRecords.length} área(s) con datos · ${(docs || []).length} documento(s) · ${emptyAreas.length} área(s) sin registros`;

  if (withRecords.length === 0) {
    box.innerHTML = emptyState('Aún no hay registros. Sube o importa documentos para organizarlos por área.', '⊞');
    return;
  }

  const cards = withRecords.map((area) => areaCard(area, groups.get(area), refByArea[area])).join('');
  const emptyNote = emptyAreas.length
    ? `<div class="card mt-16"><h3 class="mb-8">Áreas sin registros todavía</h3>
        <div class="tag-list">${emptyAreas.map((n) => `<span class="pill pill-muted">${esc(n)}</span>`).join('')}</div></div>`
    : '';
  box.innerHTML = cards + emptyNote;

  // Cablear los selectores "mover a otra área".
  box.querySelectorAll('select[data-move-rec]').forEach((sel) =>
    sel.addEventListener('change', () => moveRecord(view, sel.dataset.moveRec, sel.value, sel)));

  // Cablear "Aprobar N pendientes" por área.
  box.querySelectorAll('[data-approve-area]').forEach((btn) =>
    btn.addEventListener('click', () => approveArea(view, btn.dataset.approveArea, Number(btn.dataset.approveN))));
}

/** Aprueba en lote los registros pendientes de un área (tras revisión humana). */
async function approveArea(view, area, n) {
  if (!window.confirm(
    `¿Aprobar los ${n} registro(s) pendientes de "${area}"?\n\n`
    + 'Revisa antes que los importes extraídos sean correctos: los aprobados alimentan '
    + 'las referencias de precios y las estimaciones. Podrás rechazar o editar después.',
  )) return;
  try {
    const res = await api.approveBatch(area, 'usuario_interno');
    toast(`${res.approved} registro(s) aprobados en "${area}".`, 'ok', 'Aprobados');
    await load(view);
  } catch (err) {
    toast(err.message || 'No se pudieron aprobar.', 'error', 'Error');
  }
}

function areaCard(area, recs, ref) {
  const approved = recs.filter((r) => r.review_status === 'approved').length;
  const pending = recs.filter((r) => r.review_status === 'pending_review').length;
  const rejected = recs.filter((r) => r.review_status === 'rejected').length;
  const docCount = new Set(recs.map((r) => r.document_id)).size;

  const cost = (ref && ref.sample_size > 0)
    ? `<div class="cost-line">
         <span class="muted small">Costos (acuerdos aprobados):</span>
         <strong>${money(ref.fee_min, ref.currency)}</strong> ·
         <strong>${money(ref.fee_median, ref.currency)}</strong> (mediana) ·
         <strong>${money(ref.fee_max, ref.currency)}</strong>
         ${ref.hourly_rate_median != null ? ` · tarifa/h típ. ${money(ref.hourly_rate_median, ref.currency)}` : ''}
         · ${confidenceBadge(ref.confidence_level)}
       </div>`
    : `<div class="cost-line muted small">Sin costos de referencia: faltan acuerdos aprobados en esta área.</div>`;

  const open = recs.length <= 6 ? 'open' : '';
  const rows = recs.map((r) => recordRow(r, area)).join('');

  return `
    <div class="card mt-16">
      <div class="flex between center">
        <h2 class="card-title mb-0">${esc(area)}</h2>
        <span class="small muted">${recs.length} registro(s) · ${docCount} documento(s)</span>
      </div>
      <div class="pill-row mt-8">
        <span class="pill pill-approved">${approved} aprobados</span>
        <span class="pill pill-pending">${pending} pendientes</span>
        ${rejected ? `<span class="pill pill-rejected">${rejected} rechazados</span>` : ''}
        ${pending > 0 ? `<button class="btn btn-sm btn-primary" data-approve-area="${esc(area)}" data-approve-n="${pending}">✓ Aprobar ${pending} pendiente(s)</button>` : ''}
      </div>
      ${cost}
      <details ${open} class="mt-8">
        <summary class="area-summary-toggle">Ver registros (${recs.length})</summary>
        <div class="table-wrap mt-8"><table class="data">
          <thead><tr><th>Cliente</th><th>Subárea</th><th class="num">Importe</th><th>Estado</th><th>Mover a otra área</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </details>
    </div>`;
}

function recordRow(r, area) {
  const opts = ['<option value="">— mover a… —</option>']
    .concat(areaNames.filter((n) => n !== area).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`))
    .join('');
  return `<tr>
    <td>${dash(r.client_name)}</td>
    <td>${dash(r.service_subcategory)}</td>
    <td class="num">${money(r.total_fee, r.currency || 'EUR')}</td>
    <td>${statusPill(r.review_status)}</td>
    <td><select class="mini-select" data-move-rec="${esc(r.id)}">${opts}</select></td>
  </tr>`;
}

async function moveRecord(view, id, newArea, sel) {
  if (!newArea) return;
  sel.disabled = true;
  try {
    // Al mover de área, la subárea anterior deja de aplicar: se limpia para revisión.
    await api.updateRecord(id, { service_category: newArea, service_subcategory: null });
    toast(`Registro movido a “${newArea}”. Revisa la subárea en Revisar registros.`, 'ok', 'Reclasificado');
    await load(view);
  } catch (err) {
    toast(err.message || 'No se pudo mover el registro.', 'error', 'Error');
    sel.disabled = false;
  }
}
