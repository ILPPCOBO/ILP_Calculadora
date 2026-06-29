/* Pantalla 6 — Desglose de actuaciones previstas.
   Selecciona un cálculo/estimación existente (o llega con ?id= desde "Describir
   caso"/"Calculadora"), genera el desglose, lo edita (añadir/eliminar/reordenar
   actuaciones, cambiar valoración/horas/perfil), lo guarda y lo exporta a Word.
   Reglas del módulo: valoración alta/media/baja explicada, horas coherentes,
   honorario justificado. */

import {
  api, esc, money, dash, confidenceBadge, warningsBlock, errorState,
  emptyState, loadingState, toast, fmtDate,
} from '/app.js';

const VALUE_OPTS = [['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']];
const PROFILES = ['socio', 'asociado senior', 'asociado', 'junior', 'paralegal', 'equipo mixto', 'no determinado'];
const FILTERS = [
  ['all', 'Ver todas'], ['high', 'Alta aportación'], ['medium', 'Media aportación'],
  ['low', 'Baja aportación'], ['client', 'Cliente visible'], ['internal', 'Interno'],
];

let state = { breakdown: null, calcs: [], filter: 'all' };

function hashQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

function roundHalf(n) { return Math.round(n * 2) / 2; }

/** Detecta el origen del cálculo por la marca que deja "Describir caso". */
function isEstimate(c) { return /\[Describir caso\]/.test(c.explanation || ''); }

function inputFromCalc(c) {
  return {
    source_type: isEstimate(c) ? 'automatic_estimate' : 'manual_calculation',
    case_or_calculation_id: c.id,
    service_category: c.service_category,
    service_subcategory: c.service_subcategory || null,
    description: null,
    tasks: [],
    estimated_total_hours: c.estimated_hours ?? null,
    estimated_total_fee: c.calculated_recommended ?? null,
    currency: c.currency || 'EUR',
    rate_used: c.hourly_rate != null ? c.hourly_rate : (c.base_hourly_rate || 250),
    complexity_level: c.complexity_level,
    urgency_level: c.urgency_level,
    created_by: 'usuario_interno',
  };
}

function overallConfidence(b) {
  const prelim = (b.assumptions || []).some((a) => /PRELIMINAR/i.test(a));
  if (prelim) return 'low';
  const score = { low: 0, medium: 0, high: 0 };
  (b.planned_actions || []).forEach((a) => { score[a.confidence_level] = (score[a.confidence_level] || 0) + 1; });
  if (score.high >= score.medium && score.high >= score.low) return 'high';
  if (score.low > score.medium && score.low > score.high) return 'low';
  return 'medium';
}

export async function render(view) {
  state = { breakdown: null, calcs: [], filter: 'all' };
  view.innerHTML = `
    <style>
      .pa-table input.cell-in, .pa-table select.cell-in, .pa-table textarea.cell-in {
        width:100%; font-family:inherit; font-size:12.5px; padding:5px 6px; border:1px solid var(--border,#e4ddcb);
        border-radius:5px; background:#fff; color:var(--ink,#1a1f2b);
      }
      .pa-table textarea.cell-in { resize:vertical; min-height:34px; }
      .pa-table input.cell-num { text-align:right; }
      .pa-table td { vertical-align:top; }
      .pa-table table { min-width:1180px; }
      .pa-chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
      .pa-chip { font:inherit; font-size:12.5px; font-weight:600; padding:5px 12px; border-radius:999px; cursor:pointer;
        border:1px solid var(--border,#e4ddcb); background:#fff; color:var(--ink-soft,#4a5260); }
      .pa-chip.active { background:var(--navy,#102542); color:#fff; border-color:var(--navy,#102542); }
      .pa-dist { display:flex; gap:10px; flex-wrap:wrap; }
      .pa-dist .d { border:1px solid var(--border,#e4ddcb); border-radius:8px; padding:8px 14px; text-align:center; min-width:96px; }
      .pa-dist .d .n { font-family:var(--font-title,serif); font-size:22px; font-weight:700; }
      .pa-dist .d.high .n { color:var(--navy,#102542); } .pa-dist .d.medium .n { color:var(--gold-deep,#a8842f); } .pa-dist .d.low .n { color:#767e8c; }
      .pa-rowact button { border:1px solid var(--border,#e4ddcb); background:#fff; border-radius:5px; cursor:pointer; padding:3px 7px; font-size:13px; }
    </style>

    <div class="page-head">
      <p>Descompone el mandato en <strong>actuaciones jurídicas</strong> y valora cada una por su <strong>aportación de valor</strong> (alta / media / baja), no sólo por el tiempo. Sirve para <strong>justificar el honorario sugerido</strong>. Genera desde un cálculo o estimación, edítalo y expórtalo a Word.</p>
    </div>

    <div class="card" id="picker-card">
      <h2 class="card-title">Seleccionar un cálculo o estimación existente</h2>
      <div class="form-grid">
        <div class="field" style="grid-column:1 / -1;">
          <label for="pick-calc">Cálculo / estimación guardado (Historial)</label>
          <select id="pick-calc"><option value="">Cargando…</option></select>
        </div>
      </div>
      <div class="btn-row mt-8">
        <button class="btn btn-primary" id="btn-gen">Generar desglose de actuaciones</button>
      </div>
      <div id="brk-list" class="mt-16"></div>
    </div>

    <div id="editor" class="mt-16"></div>
  `;

  await loadPicker(view);

  const id = hashQuery().get('id');
  if (id) {
    await openBreakdown(view, id);
  }

  view.querySelector('#btn-gen').addEventListener('click', () => generateFromPicker(view));
}

async function loadPicker(view) {
  const sel = view.querySelector('#pick-calc');
  const list = view.querySelector('#brk-list');
  try {
    const [calcs, brks] = await Promise.all([api.listCalculations(), api.listBreakdowns()]);
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
    renderBreakdownList(view, brks || []);
  } catch (err) {
    sel.innerHTML = '<option value="">(error al cargar)</option>';
    list.innerHTML = errorState(err);
  }
}

function renderBreakdownList(view, brks) {
  const list = view.querySelector('#brk-list');
  if (!brks.length) { list.innerHTML = '<p class="small muted">Aún no hay desgloses guardados.</p>'; return; }
  const rows = brks.slice(0, 30).map((b) => {
    const d = b.value_distribution || {};
    return `<tr data-open="${esc(b.id)}" style="cursor:pointer;">
      <td class="nowrap small">${fmtDate(b.created_at, false)}</td>
      <td>${esc(b.service_category || '—')}${b.service_subcategory ? ` <span class="muted">/ ${esc(b.service_subcategory)}</span>` : ''}</td>
      <td class="num">${(b.planned_actions || []).length}</td>
      <td class="small">A${d.high_value_count || 0} · M${d.medium_value_count || 0} · B${d.low_value_count || 0}</td>
      <td class="num">${b.estimated_total_fee != null ? money(b.estimated_total_fee, b.currency) : '<span class="muted">—</span>'}</td>
      <td><button class="btn btn-sm" data-open="${esc(b.id)}">Abrir</button></td>
    </tr>`;
  }).join('');
  list.innerHTML = `<h3 class="mt-8">Desgloses guardados</h3>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Fecha</th><th>Servicio</th><th class="num">Actuac.</th><th>A/M/B</th><th class="num">Honorario</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  list.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openBreakdown(view, el.getAttribute('data-open'));
  }));
}

async function generateFromPicker(view) {
  const calcId = view.querySelector('#pick-calc').value;
  if (!calcId) { toast('Elige primero un cálculo o estimación.', 'warn'); return; }
  const c = state.calcs.find((x) => x.id === calcId);
  if (!c) { toast('Cálculo no encontrado.', 'error'); return; }
  const btn = view.querySelector('#btn-gen'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    const brk = await api.createBreakdown(inputFromCalc(c));
    await loadPicker(view);
    await openBreakdown(view, brk.id);
    toast('Desglose generado.', 'ok');
  } catch (err) {
    toast(err.message, 'error', 'Error');
  } finally { btn.textContent = t; btn.disabled = false; }
}

async function openBreakdown(view, id) {
  const editor = view.querySelector('#editor');
  editor.innerHTML = loadingState('Cargando desglose…');
  try {
    state.breakdown = await api.getBreakdown(id);
    state.filter = 'all';
    renderEditor(view);
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    editor.innerHTML = errorState(err);
  }
}

function renderEditor(view) {
  const b = state.breakdown;
  const editor = view.querySelector('#editor');
  if (!b) { editor.innerHTML = ''; return; }
  const d = b.value_distribution || {};
  const conf = overallConfidence(b);

  editor.innerHTML = `
    <div class="card">
      <div class="flex between center mb-8">
        <h2 class="card-title mb-0">Desglose · ${esc(b.service_category || '—')}</h2>
        <span class="small mono muted">${esc(b.id)}</span>
      </div>

      <dl class="kv mb-8">
        <dt>Servicio</dt><dd>${esc(b.service_category || '—')}${b.service_subcategory ? ` <span class="muted">/ ${esc(b.service_subcategory)}</span>` : ''}</dd>
        <dt>Mandato</dt><dd>${esc(b.mandate_summary || '—')}</dd>
        <dt>Horas totales estimadas</dt><dd>${b.estimated_total_hours != null ? esc(b.estimated_total_hours) + ' h' : '<span class="muted">—</span>'}</dd>
        <dt>Honorario sugerido</dt><dd>${b.estimated_total_fee != null ? money(b.estimated_total_fee, b.currency) : '<span class="muted">—</span>'}</dd>
        <dt>Nivel de confianza</dt><dd>${confidenceBadge(conf)}</dd>
      </dl>

      <div class="pa-dist mb-8">
        <div class="d high"><div class="n">${d.high_value_count || 0}</div><div class="small">Alta aportación</div></div>
        <div class="d medium"><div class="n">${d.medium_value_count || 0}</div><div class="small">Media aportación</div></div>
        <div class="d low"><div class="n">${d.low_value_count || 0}</div><div class="small">Baja aportación</div></div>
      </div>

      ${warningsBlock(b.warnings)}

      <div class="pa-chips">
        ${FILTERS.map(([k, l]) => `<button class="pa-chip ${k === state.filter ? 'active' : ''}" data-filter="${k}">${esc(l)}</button>`).join('')}
      </div>

      <div class="pa-table table-wrap" id="actions-table"></div>

      <div class="btn-row mt-8">
        <button class="btn btn-sm" id="btn-add">+ Añadir actuación</button>
        <button class="btn btn-primary" id="btn-save">Guardar versión</button>
        <button class="btn" id="btn-export">Exportar a Word</button>
        <button class="btn btn-ghost btn-sm" id="btn-del-brk">Eliminar desglose</button>
      </div>

      ${(b.assumptions && b.assumptions.length) ? `<h3 class="mt-16">Supuestos utilizados</h3><ul class="small muted">${b.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${(b.missing_information && b.missing_information.length) ? `<h3 class="mt-16">Información pendiente o no confirmada</h3><ul class="small muted">${b.missing_information.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    </div>
  `;

  renderActionsTable(view, b.planned_actions || []);

  editor.querySelectorAll('.pa-chip').forEach((ch) => ch.addEventListener('click', () => {
    state.filter = ch.getAttribute('data-filter');
    editor.querySelectorAll('.pa-chip').forEach((x) => x.classList.toggle('active', x === ch));
    applyFilter(view);
  }));
  editor.querySelector('#btn-add').addEventListener('click', () => addAction(view));
  editor.querySelector('#btn-save').addEventListener('click', () => saveBreakdown(view, false));
  editor.querySelector('#btn-export').addEventListener('click', () => exportWord(view));
  editor.querySelector('#btn-del-brk').addEventListener('click', () => deleteBreakdown(view));
}

function rowHtml(a, i) {
  const valueSel = VALUE_OPTS.map(([v, l]) => `<option value="${v}" ${a.value_level === v ? 'selected' : ''}>${l}</option>`).join('');
  const profSel = PROFILES.map((p) => `<option value="${p}" ${a.responsible_profile === p ? 'selected' : ''}>${esc(p)}</option>`).join('');
  return `<tr data-row data-id="${esc(a.id || '')}" data-conf="${esc(a.confidence_level || 'medium')}">
    <td class="num seq">${i + 1}</td>
    <td><input class="cell-in" data-f="title" value="${esc(a.action_title || '')}"></td>
    <td><textarea class="cell-in" data-f="desc">${esc(a.action_description || '')}</textarea></td>
    <td><select class="cell-in" data-f="value">${valueSel}</select></td>
    <td><input class="cell-in" data-f="reason" value="${esc(a.reason_for_value_level || '')}"></td>
    <td class="num"><input type="number" step="0.5" min="0" class="cell-in cell-num" data-f="hours" value="${a.estimated_hours_recommended ?? ''}"></td>
    <td><select class="cell-in" data-f="profile">${profSel}</select></td>
    <td><input class="cell-in" data-f="deliv" value="${esc(a.deliverable || '')}"></td>
    <td class="center"><input type="checkbox" data-f="cv" ${a.client_visible ? 'checked' : ''}></td>
    <td class="pa-rowact nowrap">
      <button data-act="up" title="Subir">↑</button>
      <button data-act="down" title="Bajar">↓</button>
      <button data-act="del" title="Eliminar">✕</button>
    </td>
  </tr>`;
}

function renderActionsTable(view, actions) {
  const box = view.querySelector('#actions-table');
  if (!actions.length) {
    box.innerHTML = emptyState('No hay actuaciones. Pulsa “Añadir actuación”.', '❧');
    return;
  }
  box.innerHTML = `<table class="data">
    <thead><tr>
      <th class="num">Nº</th><th>Actuación prevista</th><th>Descripción</th><th>Aportación de valor</th>
      <th>Motivo de la valoración</th><th class="num">Horas estimadas</th><th>Perfil responsable</th>
      <th>Entregable</th><th>Visible cliente</th><th>Acciones</th>
    </tr></thead>
    <tbody>${actions.map((a, i) => rowHtml(a, i)).join('')}</tbody>
  </table>`;

  box.querySelectorAll('tr[data-row]').forEach((tr) => {
    tr.querySelector('[data-act="up"]').addEventListener('click', () => moveRow(view, tr, -1));
    tr.querySelector('[data-act="down"]').addEventListener('click', () => moveRow(view, tr, 1));
    tr.querySelector('[data-act="del"]').addEventListener('click', () => { const a = readActions(view); const idx = [...box.querySelectorAll('tr[data-row]')].indexOf(tr); a.splice(idx, 1); renderActionsTable(view, a); applyFilter(view); });
    tr.querySelector('[data-f="value"]').addEventListener('change', () => applyFilter(view));
    tr.querySelector('[data-f="cv"]').addEventListener('change', () => applyFilter(view));
  });
  applyFilter(view);
}

function moveRow(view, tr, dir) {
  const box = view.querySelector('#actions-table');
  const a = readActions(view);
  const idx = [...box.querySelectorAll('tr[data-row]')].indexOf(tr);
  const j = idx + dir;
  if (j < 0 || j >= a.length) return;
  const tmp = a[idx]; a[idx] = a[j]; a[j] = tmp;
  renderActionsTable(view, a);
}

/** Lee las actuaciones desde los inputs en el orden actual del DOM. */
function readActions(view) {
  const rows = [...view.querySelectorAll('#actions-table tr[data-row]')];
  return rows.map((tr, i) => {
    const get = (f) => tr.querySelector(`[data-f="${f}"]`);
    const hv = get('hours').value.trim();
    const hours = hv === '' ? null : Number(hv);
    const cv = get('cv').checked;
    return {
      id: tr.dataset.id || undefined,
      action_title: get('title').value,
      action_description: get('desc').value,
      value_level: get('value').value,
      reason_for_value_level: get('reason').value,
      estimated_hours_recommended: hours,
      estimated_hours_min: hours !== null ? Math.max(0.5, roundHalf(hours * 0.8)) : null,
      estimated_hours_max: hours !== null ? roundHalf(hours * 1.3) : null,
      deliverable: get('deliv').value,
      responsible_profile: get('profile').value,
      client_visible: cv,
      internal_only: !cv,
      confidence_level: tr.dataset.conf || 'medium',
      sequence_order: i + 1,
    };
  });
}

function addAction(view) {
  const a = readActions(view);
  a.push({
    id: undefined, action_title: 'Nueva actuación', action_description: '', value_level: 'medium',
    reason_for_value_level: '', estimated_hours_recommended: null, deliverable: '',
    responsible_profile: 'no determinado', client_visible: true, internal_only: false, confidence_level: 'medium',
  });
  renderActionsTable(view, a);
}

function applyFilter(view) {
  const box = view.querySelector('#actions-table');
  if (!box) return;
  box.querySelectorAll('tr[data-row]').forEach((tr) => {
    const v = tr.querySelector('[data-f="value"]').value;
    const cv = tr.querySelector('[data-f="cv"]').checked;
    let show = true;
    if (state.filter === 'high' || state.filter === 'medium' || state.filter === 'low') show = v === state.filter;
    else if (state.filter === 'client') show = cv;
    else if (state.filter === 'internal') show = !cv;
    tr.style.display = show ? '' : 'none';
  });
  // Renumera visualmente la columna Nº con las filas visibles.
  let n = 0;
  box.querySelectorAll('tr[data-row]').forEach((tr) => {
    if (tr.style.display !== 'none') { n += 1; const seq = tr.querySelector('.seq'); if (seq) seq.textContent = n; }
  });
}

async function saveBreakdown(view, silent) {
  const b = state.breakdown;
  if (!b) return;
  const actions = readActions(view);
  try {
    const updated = await api.updateBreakdown(b.id, { planned_actions: actions });
    state.breakdown = updated;
    renderEditor(view);
    if (!silent) toast('Desglose guardado (Regla 12).', 'ok');
    return updated;
  } catch (err) {
    toast(err.message, 'error', 'Error');
    throw err;
  }
}

async function exportWord(view) {
  const b = state.breakdown;
  if (!b) return;
  const btn = view.querySelector('#btn-export'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…';
  try {
    // Guarda primero para que el Word refleje lo que hay en pantalla.
    const saved = await saveBreakdown(view, true);
    const r = await api.exportBreakdownWord((saved || b).id, { firm_name: 'ILP Abogados' });
    downloadBase64(r.file_base64, r.file_name, r.mime);
    toast('Documento Word generado.', 'ok');
  } catch (err) {
    toast(err.message, 'error', 'Error');
  } finally {
    const e = view.querySelector('#btn-export'); if (e) { e.textContent = t; e.disabled = false; }
  }
}

async function deleteBreakdown(view) {
  const b = state.breakdown;
  if (!b) return;
  if (!confirm('¿Eliminar este desglose? No afecta al cálculo ni al historial de honorarios.')) return;
  try {
    await api.deleteBreakdown(b.id);
    state.breakdown = null;
    view.querySelector('#editor').innerHTML = '';
    await loadPicker(view);
    toast('Desglose eliminado.', 'ok');
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
  a.href = url; a.download = name || 'desglose.docx';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
}
