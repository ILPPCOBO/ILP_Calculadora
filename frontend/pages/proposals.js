/* Pantalla — Propuesta de honorarios.
   Genera una PROPUESTA profesional (sencilla o elaborada) a partir de un
   cálculo/estimación (o llega con ?id= desde "Describir caso"/"Calculadora"),
   permite completar los datos del cliente y editar cada sección, y la exporta a
   Word. Las cifras vienen de la estimación (nunca se inventan): lo ausente se
   marca con "[●]". Honorarios sugeridos y revisables (Regla 1). */

import {
  api, esc, money, confidenceBadge, warningsBlock, errorState,
  emptyState, loadingState, toast, fmtDate,
} from '/app.js';

const KIND_OPTS = [['simple', 'Sencilla (carta, 2–4 pp)'], ['elaborate', 'Elaborada (dossier, 10+ pp)']];

/* Marcadores nominales -> campo de detalle. Debe coincidir con DM en
   services/proposalGenerator.ts. Se sustituyen en vivo al editar los detalles. */
const DETAIL_MARKERS = [
  ['[cliente]', 'client.name'],
  ['[CIF/NIF del cliente]', 'client.tax_id'],
  ['[representante del cliente]', 'client.representative'],
  ['[firmante de la Firma]', 'firm.representative'],
  ['[referencia interna]', 'reference'],
  ['[validez en días]', 'validity_days'],
];

let state = { proposal: null, calcs: [] };

function hashQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

function isEstimate(c) { return /\[Describir caso\]/.test(c.explanation || ''); }

/** Mapea un cálculo/estimación guardado a la entrada del generador de propuestas. */
function inputFromCalc(c, kind) {
  return {
    kind,
    case_or_calculation_id: c.id,
    service_category: c.service_category,
    service_subcategory: c.service_subcategory || null,
    description: null,
    tasks: [],
    currency: c.currency || 'EUR',
    rate_used: c.hourly_rate != null ? c.hourly_rate : (c.base_hourly_rate || 250),
    hours_recommended: c.estimated_hours ?? null,
    fee_min: c.calculated_min ?? null,
    fee_recommended: c.calculated_recommended ?? null,
    fee_max: c.calculated_max ?? null,
    confidence_level: c.confidence_level || 'low',
    created_by: 'usuario_interno',
  };
}

export async function render(view) {
  state = { proposal: null, calcs: [] };
  view.innerHTML = `
    <style>
      .pr-sec { border:1px solid var(--border,#e4ddcb); border-radius:8px; padding:12px 14px; margin-bottom:10px; background:#fff; }
      .pr-sec input.sec-head { width:100%; font-weight:600; font-size:14px; border:none; border-bottom:1px solid var(--border,#e4ddcb);
        padding:4px 2px; margin-bottom:8px; color:var(--navy,#102542); font-family:inherit; background:transparent; }
      .pr-sec textarea.sec-body { width:100%; min-height:80px; font-family:inherit; font-size:13px; line-height:1.5;
        border:1px solid var(--border,#e4ddcb); border-radius:6px; padding:8px 10px; resize:vertical; color:var(--ink,#1a1f2b); }
      .pr-sec .sec-meta { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
      .pr-meta-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
      .pr-meta-grid .field label { font-size:12px; }
      .pr-meta-grid input { width:100%; font-family:inherit; padding:6px 8px; border:1px solid var(--border,#e4ddcb); border-radius:6px; }
      .pr-hint { color:#a8842f; font-weight:600; }
    </style>

    <div class="page-head">
      <p>Convierte una estimación en una <strong>propuesta de honorarios</strong> profesional lista para revisar y enviar. Las cifras proceden de la calculadora (no se inventan); los datos que falten se marcan con <span class="pr-hint">[●]</span>. Honorarios <strong>sugeridos</strong> y revisables (Regla 1).</p>
    </div>

    <div class="card" id="picker-card">
      <h2 class="card-title">Generar propuesta desde un cálculo o estimación</h2>
      <div class="form-grid">
        <div class="field" style="grid-column:1 / -1;">
          <label for="pick-calc">Cálculo / estimación guardado (Historial)</label>
          <select id="pick-calc"><option value="">Cargando…</option></select>
        </div>
        <div class="field">
          <label for="pick-kind">Formato de la propuesta</label>
          <select id="pick-kind">${KIND_OPTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="btn-row mt-8">
        <button class="btn btn-primary" id="btn-gen">Generar propuesta</button>
      </div>
      <div id="prop-list" class="mt-16"></div>
    </div>

    <div id="editor" class="mt-16"></div>
  `;

  await loadPicker(view);

  const id = hashQuery().get('id');
  if (id) await openProposal(view, id);

  view.querySelector('#btn-gen').addEventListener('click', () => generateFromPicker(view));
}

async function loadPicker(view) {
  const sel = view.querySelector('#pick-calc');
  const list = view.querySelector('#prop-list');
  try {
    const [calcs, props] = await Promise.all([api.listCalculations(), api.listProposals()]);
    state.calcs = calcs || [];
    if (!state.calcs.length) {
      sel.innerHTML = '<option value="">(no hay cálculos guardados todavía)</option>';
    } else {
      sel.innerHTML = '<option value="">— Elige un cálculo o estimación —</option>' + state.calcs.map((c) => {
        const tag = isEstimate(c) ? 'Estimación' : 'Cálculo';
        const fee = c.calculated_recommended != null ? `${c.calculated_recommended} ${c.currency || 'EUR'}` : 's/ honorario';
        return `<option value="${esc(c.id)}">${esc(fmtDate(c.created_at, false))} · ${tag} · ${esc(c.service_category || '—')} · ${esc(fee)}</option>`;
      }).join('');
    }
    renderProposalList(view, props || []);
  } catch (err) {
    sel.innerHTML = '<option value="">(error al cargar)</option>';
    list.innerHTML = errorState(err);
  }
}

function renderProposalList(view, props) {
  const list = view.querySelector('#prop-list');
  if (!props.length) { list.innerHTML = '<p class="small muted">Aún no hay propuestas guardadas.</p>'; return; }
  const rows = props.slice(0, 30).map((p) => `<tr data-open="${esc(p.id)}" style="cursor:pointer;">
      <td class="nowrap small">${fmtDate(p.created_at, false)}</td>
      <td>${esc(p.service_category || '—')}</td>
      <td class="small">${p.kind === 'elaborate' ? 'Elaborada' : 'Sencilla'}</td>
      <td>${esc(p.client && p.client.name ? p.client.name : '—')}</td>
      <td class="num">${p.fee_recommended != null ? money(p.fee_recommended, p.currency) : '<span class="muted">—</span>'}</td>
      <td><button class="btn btn-sm" data-open="${esc(p.id)}">Abrir</button></td>
    </tr>`).join('');
  list.innerHTML = `<h3 class="mt-8">Propuestas guardadas</h3>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Fecha</th><th>Servicio</th><th>Formato</th><th>Cliente</th><th class="num">Honorario</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  list.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openProposal(view, el.getAttribute('data-open'));
  }));
}

async function generateFromPicker(view) {
  const calcId = view.querySelector('#pick-calc').value;
  if (!calcId) { toast('Elige primero un cálculo o estimación.', 'warn'); return; }
  const c = state.calcs.find((x) => x.id === calcId);
  if (!c) { toast('Cálculo no encontrado.', 'error'); return; }
  const kind = view.querySelector('#pick-kind').value || 'simple';
  const btn = view.querySelector('#btn-gen'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    const prop = await api.createProposal(inputFromCalc(c, kind));
    await loadPicker(view);
    await openProposal(view, prop.id);
    toast('Propuesta generada.', 'ok');
  } catch (err) {
    toast(err.message, 'error', 'Error');
  } finally { btn.textContent = t; btn.disabled = false; }
}

async function openProposal(view, id) {
  const editor = view.querySelector('#editor');
  editor.innerHTML = loadingState('Cargando propuesta…');
  try {
    state.proposal = await api.getProposal(id);
    renderEditor(view);
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    editor.innerHTML = errorState(err);
  }
}

function renderEditor(view) {
  const p = state.proposal;
  const editor = view.querySelector('#editor');
  if (!p) { editor.innerHTML = ''; return; }
  const cl = p.client || {};
  const fm = p.firm || {};
  const kindLabel = p.kind === 'elaborate' ? 'Elaborada' : 'Sencilla';

  editor.innerHTML = `
    <div class="card">
      <div class="flex between center mb-8">
        <h2 class="card-title mb-0">Propuesta · ${esc(p.service_category || '—')}</h2>
        <span class="small mono muted">${esc(p.id)} · ${esc(kindLabel)}</span>
      </div>

      <dl class="kv mb-8">
        <dt>Honorario sugerido</dt><dd>${p.fee_recommended != null ? money(p.fee_recommended, p.currency) : '<span class="muted">[●]</span>'} ${p.fee_min != null ? `<span class="muted">(${money(p.fee_min, p.currency)} – ${money(p.fee_max, p.currency)})</span>` : ''}</dd>
        <dt>Confianza</dt><dd>${confidenceBadge(p.confidence_level)}</dd>
      </dl>

      ${warningsBlock(p.warnings)}

      <h3 class="mt-8">Datos de la propuesta</h3>
      <div class="pr-meta-grid mb-8">
        <div class="field"><label>Cliente (nombre)</label><input data-m="client.name" value="${esc(cl.name || '')}" placeholder="[●]"></div>
        <div class="field"><label>CIF/NIF del cliente</label><input data-m="client.tax_id" value="${esc(cl.tax_id || '')}" placeholder="[●]"></div>
        <div class="field"><label>Representante del cliente</label><input data-m="client.representative" value="${esc(cl.representative || '')}" placeholder="[●]"></div>
        <div class="field"><label>Firmante por la Firma</label><input data-m="firm.representative" value="${esc(fm.representative || '')}" placeholder="[●]"></div>
        <div class="field"><label>Referencia interna</label><input data-m="reference" value="${esc(p.reference || '')}" placeholder="[●]"></div>
        <div class="field"><label>Validez (días)</label><input data-m="validity_days" type="number" min="0" value="${p.validity_days ?? ''}" placeholder="[●]"></div>
      </div>

      <h3 class="mt-8">Secciones de la propuesta</h3>
      <p class="small muted">Edita libremente cada sección. Sustituye los marcadores <span class="pr-hint">[●]</span> por los datos reales antes de enviarla.</p>
      <div id="prop-sections"></div>

      <div class="btn-row mt-8">
        <button class="btn btn-primary" id="btn-save">Guardar versión</button>
        <button class="btn" id="btn-export">Exportar a Word</button>
        <button class="btn btn-ghost btn-sm" id="btn-del">Eliminar propuesta</button>
      </div>

      ${(p.missing_information && p.missing_information.length) ? `<h3 class="mt-16">Datos pendientes de confirmar</h3><ul class="small muted">${p.missing_information.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      ${(p.assumptions && p.assumptions.length) ? `<h3 class="mt-16">Premisas</h3><ul class="small muted">${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </div>
  `;

  renderSections(view, p.sections || []);
  editor.querySelector('#btn-save').addEventListener('click', () => saveProposal(view, false));
  editor.querySelector('#btn-export').addEventListener('click', () => exportWord(view));
  editor.querySelector('#btn-del').addEventListener('click', () => deleteProposal(view));
  // Al rellenar un dato de la propuesta, sustituye su marcador en las secciones.
  editor.querySelectorAll('[data-m]').forEach((inp) => inp.addEventListener('change', () => fillMarkersInDom(view)));
}

/** Sustituye en vivo los marcadores nominales por los datos introducidos. */
function fillMarkersInDom(view) {
  const val = (m) => { const el = view.querySelector(`[data-m="${m}"]`); return el ? el.value.trim() : ''; };
  let replaced = 0;
  view.querySelectorAll('#prop-sections .sec-body').forEach((ta) => {
    let body = ta.value;
    for (const [marker, field] of DETAIL_MARKERS) {
      const v = val(field);
      if (v && body.includes(marker)) { body = body.split(marker).join(v); replaced += 1; }
    }
    ta.value = body;
  });
  if (replaced) toast('Marcadores actualizados con los datos introducidos.', 'ok');
}

function renderSections(view, sections) {
  const box = view.querySelector('#prop-sections');
  if (!sections.length) { box.innerHTML = emptyState('Sin secciones.', '✦'); return; }
  box.innerHTML = sections.map((s) => `
    <div class="pr-sec" data-id="${esc(s.id || '')}" data-key="${esc(s.key || '')}">
      <input class="sec-head" data-f="heading" value="${esc(s.heading || '')}">
      <textarea class="sec-body" data-f="body">${esc(s.body || '')}</textarea>
      <div class="sec-meta">
        <label class="small muted"><input type="checkbox" data-f="cv" ${s.client_visible !== false ? 'checked' : ''}> Visible para el cliente</label>
      </div>
    </div>`).join('');
}

function readMeta(view) {
  const g = (m) => view.querySelector(`[data-m="${m}"]`);
  const val = (m) => { const el = g(m); return el ? el.value.trim() : ''; };
  const vd = val('validity_days');
  return {
    reference: val('reference') || null,
    validity_days: vd === '' ? null : Number(vd),
    client: {
      name: val('client.name') || null,
      tax_id: val('client.tax_id') || null,
      representative: val('client.representative') || null,
    },
    firm: {
      representative: val('firm.representative') || null,
    },
  };
}

function readSections(view) {
  return [...view.querySelectorAll('#prop-sections .pr-sec')].map((el) => ({
    id: el.dataset.id || undefined,
    key: el.dataset.key || undefined,
    heading: el.querySelector('[data-f="heading"]').value,
    body: el.querySelector('[data-f="body"]').value,
    client_visible: el.querySelector('[data-f="cv"]').checked,
  }));
}

async function saveProposal(view, silent) {
  const p = state.proposal;
  if (!p) return;
  const patch = { ...readMeta(view), sections: readSections(view) };
  try {
    const updated = await api.updateProposal(p.id, patch);
    state.proposal = updated;
    renderEditor(view);
    if (!silent) toast('Propuesta guardada.', 'ok');
    return updated;
  } catch (err) {
    toast(err.message, 'error', 'Error');
    throw err;
  }
}

async function exportWord(view) {
  const p = state.proposal;
  if (!p) return;
  const btn = view.querySelector('#btn-export'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    const saved = await saveProposal(view, true);
    const r = await api.exportProposalWord((saved || p).id, { firm_name: 'ILP Abogados' });
    downloadBase64(r.file_base64, r.file_name, r.mime);
    toast('Documento Word generado.', 'ok');
  } catch (err) {
    toast(err.message, 'error', 'Error');
  } finally {
    const e = view.querySelector('#btn-export'); if (e) { e.textContent = t; e.disabled = false; }
  }
}

async function deleteProposal(view) {
  const p = state.proposal;
  if (!p) return;
  if (!confirm('¿Eliminar esta propuesta? No afecta al cálculo ni al historial de honorarios.')) return;
  try {
    await api.deleteProposal(p.id);
    state.proposal = null;
    view.querySelector('#editor').innerHTML = '';
    await loadPicker(view);
    toast('Propuesta eliminada.', 'ok');
  } catch (err) {
    toast(err.message, 'error', 'Error');
  }
}

function downloadBase64(b64, name, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'propuesta.docx';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
}
