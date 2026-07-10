/* =========================================================================
   app.js — Núcleo de la SPA (router con hash-routing + capa fetch + helpers).
   Frontend vanilla, sin framework ni build. ES modules.

   Consume la API JSON descrita en docs/CONTRACTS.md. Programa CONTRA EL
   CONTRATO: la API puede no existir todavía; todos los fetch manejan errores
   con mensajes claros (no rompen la UI).

   Regla 1: honorarios SUGERIDOS. Regla 2: tarifa base 250 €/hora (se muestra
   siempre en el dashboard y se marca cuando la calculadora la usa).
   ========================================================================= */

// -------------------------------------------------------------------------
// Constantes de negocio (espejo del contrato; la verdad vive en el backend).
// -------------------------------------------------------------------------
export const BASE_HOURLY_RATE = 250;
export const DEFAULT_CURRENCY = 'EUR';
const API_PREFIX = '/api';

// Definición de rutas -> { título, módulo de página }.
const ROUTES = {
  'describe-case': { title: 'Describir caso', loader: () => import('/pages/describeCase.js') },
  upload: { title: 'Subir documentos', loader: () => import('/pages/upload.js') },
  records: { title: 'Revisar registros', loader: () => import('/pages/records.js') },
  categories: { title: 'Categorías', loader: () => import('/pages/categories.js') },
  'formulas-generate': { title: 'Generar fórmulas', loader: () => import('/pages/formulasGenerate.js') },
  'formulas-review': { title: 'Revisar fórmulas', loader: () => import('/pages/formulasReview.js') },
  references: { title: 'Referencias de precios', loader: () => import('/pages/references.js') },
  areas: { title: 'Organizar por área', loader: () => import('/pages/byArea.js') },
  calculator: { title: 'Calculadora', loader: () => import('/pages/calculator.js') },
  'planned-actions': { title: 'Desglose de actuaciones', loader: () => import('/pages/plannedActions.js') },
  proposals: { title: 'Propuesta de honorarios', loader: () => import('/pages/proposals.js') },
  history: { title: 'Historial', loader: () => import('/pages/history.js') },
};
const DEFAULT_ROUTE = 'describe-case';

// =========================================================================
// 1. Capa de acceso a la API (fetch con manejo de errores claro)
// =========================================================================

/** Error de API con información legible para mostrar al usuario. */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Realiza una petición a la API y devuelve el JSON parseado.
 * Lanza ApiError con mensaje claro ante fallo de red, estado != 2xx o JSON inválido.
 */
async function request(path, { method = 'GET', body, query } = {}) {
  let url = path.startsWith('http') ? path : `${API_PREFIX}${path}`;
  if (query && typeof query === 'object') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch (netErr) {
    markApiStatus(false);
    throw new ApiError(
      `No se pudo conectar con la API (${method} ${url}). ¿Está el servidor en marcha? Detalle: ${netErr.message}`,
      0,
      null,
    );
  }

  markApiStatus(true);

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch {
      if (!res.ok) {
        throw new ApiError(`La API respondió ${res.status} con contenido no-JSON.`, res.status, text);
      }
      data = text; // respuesta no-JSON pero OK (raro): se devuelve tal cual
    }
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Error ${res.status} en ${method} ${url}.`;
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

/** Cliente API tipado por endpoint (espejo de docs/CONTRACTS.md). */
export const api = {
  health: () => request('/health'),
  getConfig: () => request('/config'),
  updateConfig: (patch) => request('/config', { method: 'PUT', body: patch }),

  listDocuments: () => request('/documents'),
  getDocument: (id) => request(`/documents/${encodeURIComponent(id)}`),
  // El binario viaja en base64 dentro del JSON (POST /api/documents).
  uploadDocument: (payload) => request('/documents', { method: 'POST', body: payload }),
  extractRecords: (id) => request(`/documents/${encodeURIComponent(id)}/extract-records`, { method: 'POST' }),
  deleteDocument: (id, force = false) => request(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE', query: force ? { force: 'true' } : undefined }),

  listRecords: (status) => request('/records', { query: { status } }),
  updateRecord: (id, patch) => request(`/records/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
  approveRecord: (id, approved_by) => request(`/records/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { approved_by } }),
  approveBatch: (service_category, by) => request('/records/approve-batch', { method: 'POST', body: { service_category, by } }),
  rejectRecord: (id, rejected_reason, by) => request(`/records/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { rejected_reason, by } }),

  listCategories: () => request('/categories'),
  createCategory: (cat) => request('/categories', { method: 'POST', body: cat }),
  updateCategory: (id, patch) => request(`/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),

  generateFormula: (input) => request('/formulas/generate', { method: 'POST', body: input }),
  listFormulas: (status) => request('/formulas', { query: { status } }),
  updateFormula: (id, patch) => request(`/formulas/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
  approveFormula: (id, approved_by) => request(`/formulas/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { approved_by } }),
  rejectFormula: (id, rejected_reason, by) => request(`/formulas/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { rejected_reason, by } }),
  listApprovedFormulas: () => request('/approved-formulas'),

  calculate: (input) => request('/calculate', { method: 'POST', body: input }),
  listCalculations: () => request('/calculations'),

  listReferences: () => request('/references'),
  getReference: (category, subcategory) => request('/references', { query: { category, subcategory } }),
  importDirectory: (payload) => request('/import', { method: 'POST', body: payload }),

  estimateCase: (payload) => request('/estimate-case', { method: 'POST', body: payload }),

  // Desglose de actuaciones previstas.
  createBreakdown: (input) => request('/breakdowns', { method: 'POST', body: input }),
  listBreakdowns: () => request('/breakdowns'),
  getBreakdown: (id) => request(`/breakdowns/${encodeURIComponent(id)}`),
  getBreakdownsByCalculation: (calcId) => request('/breakdowns', { query: { calculation_id: calcId } }),
  updateBreakdown: (id, patch) => request(`/breakdowns/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
  deleteBreakdown: (id) => request(`/breakdowns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportBreakdownWord: (id, payload = {}) => request(`/breakdowns/${encodeURIComponent(id)}/export-word`, { method: 'POST', body: payload }),

  // Propuesta de honorarios.
  createProposal: (input) => request('/proposals', { method: 'POST', body: input }),
  listProposals: () => request('/proposals'),
  getProposal: (id) => request(`/proposals/${encodeURIComponent(id)}`),
  updateProposal: (id, patch) => request(`/proposals/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
  deleteProposal: (id) => request(`/proposals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportProposalWord: (id, payload = {}) => request(`/proposals/${encodeURIComponent(id)}/export-word`, { method: 'POST', body: payload }),
};

// =========================================================================
// 2. Helpers de render compartidos (exportados a las páginas)
// =========================================================================

/** Escapa texto para insertarlo seguro en HTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Devuelve el valor o un guion para datos ausentes (Regla 12: nada inventado). */
export function dash(value) {
  if (value === null || value === undefined || value === '' || value === 'unknown') {
    return '<span class="muted">—</span>';
  }
  return esc(value);
}

/** Formatea un importe en moneda. null/undefined -> "—". */
export function money(amount, currency = DEFAULT_CURRENCY) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return '<span class="muted">—</span>';
  }
  const n = Number(amount);
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${esc(currency)}`;
  }
}

/** Formato de fecha ISO -> dd/mm/aaaa hh:mm (es-ES). */
export function fmtDate(iso, withTime = true) {
  if (!iso) return '<span class="muted">—</span>';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const opts = withTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleString('es-ES', opts);
}

/** Píldora de estado de revisión. */
export function statusPill(status) {
  const map = {
    pending_review: ['pill-pending', 'Pendiente de revisión'],
    approved: ['pill-approved', 'Aprobado'],
    rejected: ['pill-rejected', 'Rechazado'],
  };
  const [cls, label] = map[status] || ['pill-muted', status || '—'];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

/** Indicador de nivel de confianza (Regla 14). */
export function confidenceBadge(level) {
  const map = { low: 'Confianza baja', medium: 'Confianza media', high: 'Confianza alta' };
  const cls = level === 'high' ? 'conf-high' : level === 'medium' ? 'conf-medium' : 'conf-low';
  return `<span class="conf ${cls}">${esc(map[level] || 'Confianza baja')}</span>`;
}

/** Lista de warnings como alerta (Regla 11/18). Devuelve '' si no hay. */
export function warningsBlock(warnings) {
  if (!warnings || warnings.length === 0) return '';
  const items = warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  return `<div class="alert alert-warn"><span>⚠</span><div><strong>Avisos</strong><ul>${items}</ul></div></div>`;
}

/** Bloque de error reutilizable. */
export function errorState(err) {
  const msg = err instanceof ApiError ? err.message : (err && err.message) || String(err);
  return `<div class="error-state"><strong>No se pudieron cargar los datos.</strong><br>${esc(msg)}</div>`;
}

/** Estado de carga. */
export function loadingState(label = 'Cargando…') {
  return `<div class="loading-state"><span class="spinner"></span><div>${esc(label)}</div></div>`;
}

/** Estado vacío. */
export function emptyState(label = 'No hay datos para mostrar.', icon = '∅') {
  return `<div class="empty-state"><span class="es-ico">${esc(icon)}</span>${esc(label)}</div>`;
}

/** Notificación tipo toast. type: ok | error | warn | info */
export function toast(message, type = 'info', title) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'info' ? '' : type}`.trim();
  el.innerHTML = (title ? `<span class="toast-title">${esc(title)}</span>` : '') + esc(message);
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 4200);
}

/** Helper: crea un elemento desde HTML y devuelve el primer nodo. */
export function fromHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Cambia de ruta programáticamente. */
export function navigate(route) {
  window.location.hash = `#/${route}`;
}

/** Marca visualmente el estado de la API en la barra superior. */
let _apiStatusKnown = false;
export function markApiStatus(ok) {
  _apiStatusKnown = true;
  const el = document.getElementById('api-status');
  if (!el) return;
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('down', !ok);
  el.title = ok ? 'API conectada' : 'API no disponible';
}

// =========================================================================
// 3. Router (hash-routing)
// =========================================================================

const viewEl = () => document.getElementById('view');

function parseHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  const [route] = raw.split('?');
  return route || DEFAULT_ROUTE;
}

function setActiveNav(route) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-route') === route);
  });
}

async function renderRoute() {
  const route = parseHash();
  const def = ROUTES[route];
  const view = viewEl();

  // Cierra el menú móvil al navegar.
  document.getElementById('app-shell')?.classList.remove('nav-open');

  if (!def) {
    document.getElementById('page-title').textContent = 'No encontrado';
    view.innerHTML = `<div class="card"><h2 class="card-title">Pantalla no encontrada</h2>
      <p>La ruta <span class="mono">#/${esc(route)}</span> no existe.
      <a href="#/${DEFAULT_ROUTE}">Volver al panel</a>.</p></div>`;
    return;
  }

  document.getElementById('page-title').textContent = def.title;
  setActiveNav(route);
  view.innerHTML = loadingState();

  try {
    const mod = await def.loader();
    if (parseHash() !== route) return; // navegó a otra ruta mientras cargaba
    if (typeof mod.render !== 'function') {
      throw new Error(`El módulo de la pantalla "${route}" no exporta render().`);
    }
    await mod.render(view);
  } catch (err) {
    console.error(`[router] Error al renderizar "${route}":`, err);
    view.innerHTML = `<div class="card">${errorState(err)}</div>`;
    toast(err.message || 'Error al cargar la pantalla.', 'error', 'Error');
  }
}

// =========================================================================
// 4. Arranque
// =========================================================================

function boot() {
  // Toggle de navegación en móvil.
  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    document.getElementById('app-shell')?.classList.toggle('nav-open');
  });

  // Mantén el badge de tarifa base con el valor por defecto (el dashboard lo
  // actualiza con el valor real de /api/config si difiere).
  const brl = document.querySelector('#sidebar-base-rate .brl-value');
  if (brl) brl.textContent = `${BASE_HOURLY_RATE} €/hora`;

  window.addEventListener('hashchange', renderRoute);

  if (!window.location.hash) {
    window.location.replace(`#/${DEFAULT_ROUTE}`);
  } else {
    renderRoute();
  }

  // Sondeo inicial de salud de la API (no bloquea la UI).
  api.health().catch(() => { /* markApiStatus ya lo gestiona */ });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
