/* Pantalla 3 — Revisar registros.
   GET /api/records?status=pending_review (filtrable). Formulario editable por
   registro: cliente, asunto, servicio, subservicio, descripción, importe,
   horas, tarifa, tipo de fee, complejidad, urgencia, moneda. Botones Aprobar
   (POST .../approve) y Rechazar (POST .../reject con motivo).
   Solo registros aprobados se usan aguas abajo (Regla 7, 12). */

import {
  api, esc, dash, fmtDate, statusPill, confidenceBadge, errorState,
  emptyState, loadingState, toast,
} from '/app.js';

const FEE_TYPES = [['hourly', 'Por horas'], ['fixed', 'Precio fijo'], ['monthly', 'Mensual'], ['success_fee', 'Cuota de éxito'], ['blended', 'Mixta'], ['unknown', 'Desconocido']];
const COMPLEXITY = [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['unknown', 'Desconocida']];
const URGENCY = [['normal', 'Normal'], ['urgent', 'Urgente'], ['very_urgent', 'Muy urgente'], ['unknown', 'Desconocida']];
const STATUS_FILTERS = [['pending_review', 'Pendientes'], ['approved', 'Aprobados'], ['rejected', 'Rechazados'], ['', 'Todos']];

let currentStatus = 'pending_review';

export async function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <p>Revisa y corrige los registros extraídos antes de aprobarlos. Solo los registros <strong>aprobados</strong> alimentan la generación de fórmulas y la calculadora (Regla 7).</p>
    </div>
    <div class="btn-row mb-16" id="status-filters">
      ${STATUS_FILTERS.map(([v, l]) =>
        `<button class="btn btn-sm ${v === currentStatus ? 'btn-navy' : ''}" data-status="${v}">${esc(l)}</button>`).join('')}
    </div>
    <div id="records-box">${loadingState()}</div>
  `;

  view.querySelectorAll('#status-filters [data-status]').forEach((b) =>
    b.addEventListener('click', () => { currentStatus = b.dataset.status; render(view); }));

  await loadRecords(view);
}

async function loadRecords(view) {
  const box = view.querySelector('#records-box');
  let records;
  try { records = await api.listRecords(currentStatus || undefined); }
  catch (err) { box.innerHTML = errorState(err); return; }

  if (!records || records.length === 0) {
    box.innerHTML = emptyState('No hay registros en este estado.', '▤');
    return;
  }
  box.innerHTML = records.map(recordItem).join('');
  records.forEach((r) => wireRecord(view, r));
}

function opts(list, current) {
  return list.map(([v, l]) => `<option value="${v}" ${v === (current ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function recordItem(r) {
  const editable = r.review_status === 'pending_review';
  const dis = editable ? '' : 'disabled';
  return `<div class="review-item" data-rec="${esc(r.id)}">
    <div class="review-item-head">
      <h3>${esc(r.client_name || 'Cliente desconocido')} ${r.matter_name ? `<span class="muted small">· ${esc(r.matter_name)}</span>` : ''}</h3>
      <div class="flex gap-12 center">${confidenceBadge(r.confidence_level)} ${statusPill(r.review_status)}</div>
    </div>
    <div class="review-item-body">
      <div class="small muted mb-16">
        ID ${esc(r.id)} · Documento ${dash(r.document_id)} · Extraído ${fmtDate(r.created_at)}
        ${r.extracted_from ? `· Fuente: ${esc(r.extracted_from)}` : ''}
      </div>
      ${r.rejected_reason ? `<div class="alert alert-danger"><span>✕</span><div>Motivo de rechazo: ${esc(r.rejected_reason)}</div></div>` : ''}
      ${r.review_status === 'approved' ? `<div class="alert alert-ok"><span>✓</span><div>Aprobado por ${dash(r.approved_by)} el ${fmtDate(r.approved_at)}</div></div>` : ''}

      <div class="form-grid">
        <div class="field"><label>Cliente</label><input data-f="client_name" value="${esc(r.client_name ?? '')}" ${dis} placeholder="—"></div>
        <div class="field"><label>Asunto / Matter</label><input data-f="matter_name" value="${esc(r.matter_name ?? '')}" ${dis} placeholder="—"></div>
        <div class="field"><label>Servicio (categoría)</label><input data-f="service_category" value="${esc(r.service_category ?? '')}" ${dis} placeholder="unknown"></div>
        <div class="field"><label>Subservicio</label><input data-f="service_subcategory" value="${esc(r.service_subcategory ?? '')}" ${dis} placeholder="—"></div>
      </div>
      <div class="field"><label>Descripción del servicio</label><textarea data-f="service_description" ${dis} placeholder="—">${esc(r.service_description ?? '')}</textarea></div>
      <div class="form-grid">
        <div class="field"><label>Importe (total_fee)</label><input type="number" step="0.01" data-f="total_fee" value="${numVal(r.total_fee)}" ${dis} placeholder="—"></div>
        <div class="field"><label>Moneda</label><input data-f="currency" value="${esc(r.currency ?? '')}" ${dis} placeholder="EUR"></div>
        <div class="field"><label>Horas trabajadas</label><input type="number" step="0.1" data-f="hours_worked" value="${numVal(r.hours_worked)}" ${dis} placeholder="—"></div>
        <div class="field"><label>Tarifa / hora</label><input type="number" step="0.01" data-f="hourly_rate" value="${numVal(r.hourly_rate)}" ${dis} placeholder="—"></div>
        <div class="field"><label>Tipo de fee</label><select data-f="fee_type" ${dis}>${opts(FEE_TYPES, r.fee_type)}</select></div>
        <div class="field"><label>Descuento %</label><input type="number" step="0.1" data-f="discounts" value="${numVal(r.discounts)}" ${dis} placeholder="—"></div>
        <div class="field"><label>Complejidad</label><select data-f="complexity_level" ${dis}>${opts(COMPLEXITY, r.complexity_level)}</select></div>
        <div class="field"><label>Urgencia</label><select data-f="urgency_level" ${dis}>${opts(URGENCY, r.urgency_level)}</select></div>
      </div>
    </div>
    ${editable ? `<div class="review-actions">
      <button class="btn btn-primary" data-act="save">Guardar cambios</button>
      <button class="btn btn-ok" data-act="approve">Aprobar</button>
      <button class="btn btn-danger" data-act="reject">Rechazar</button>
    </div>` : ''}
  </div>`;
}

function wireRecord(view, r) {
  const el = view.querySelector(`.review-item[data-rec="${cssEsc(r.id)}"]`);
  if (!el) return;

  function collectPatch() {
    const patch = {};
    el.querySelectorAll('[data-f]').forEach((inp) => {
      const f = inp.dataset.f;
      let v = inp.value;
      if (inp.type === 'number') {
        v = v.trim() === '' ? null : Number(v);
      } else {
        v = v.trim() === '' ? null : v;
        // service_category nunca null: usa 'unknown' (modelo lo exige string).
        if (f === 'service_category' && v === null) v = 'unknown';
      }
      patch[f] = v;
    });
    return patch;
  }

  el.querySelector('[data-act="save"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      await api.updateRecord(r.id, collectPatch());
      toast('Registro actualizado.', 'ok');
    } catch (err) { toast(err.message, 'error', 'Error'); }
    finally { btn.disabled = false; }
  });

  el.querySelector('[data-act="approve"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      // Guarda ediciones pendientes antes de aprobar.
      await api.updateRecord(r.id, collectPatch());
      await api.approveRecord(r.id, 'usuario_interno');
      toast('Registro aprobado.', 'ok', 'Aprobado');
      loadRecords(view);
    } catch (err) { toast(err.message, 'error', 'Error'); btn.disabled = false; }
  });

  el.querySelector('[data-act="reject"]')?.addEventListener('click', async (e) => {
    const reason = window.prompt('Motivo del rechazo (Regla 18 — trazabilidad):', '');
    if (reason === null) return;
    if (!reason.trim()) { toast('El motivo de rechazo es obligatorio.', 'warn'); return; }
    const btn = e.currentTarget; btn.disabled = true;
    try {
      await api.rejectRecord(r.id, reason.trim(), 'usuario_interno');
      toast('Registro rechazado.', 'ok', 'Rechazado');
      loadRecords(view);
    } catch (err) { toast(err.message, 'error', 'Error'); btn.disabled = false; }
  });
}

function numVal(v) { return v === null || v === undefined ? '' : esc(v); }
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
