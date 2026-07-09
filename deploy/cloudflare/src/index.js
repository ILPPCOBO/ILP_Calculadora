// Worker de Cloudflare — Calculadora de Honorarios (HTML embebido). npx wrangler deploy
const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Calculadora de Honorarios — Offline (ILP)</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root{--navy:#102542;--navy-700:#0b1a30;--gold:#c8a24c;--gold-soft:#d8bd7e;--gold-deep:#a8842f;--cream:#faf6ee;--surface:#fff;--surface-alt:#fbfaf6;--border:#e4ddcb;--ink:#1a1f2b;--ink-soft:#4a5260;--ink-faint:#767e8c;--ok:#2f7a4f;--warn:#9a6b13;--danger:#9b2c2c;--info:#1f4677;--font-title:"Cormorant Garamond",Georgia,serif;--font-body:"Inter",system-ui,sans-serif;--radius:10px}
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:var(--font-body);color:var(--ink);background:var(--cream);font-size:15px;line-height:1.55}
  h1,h2,h3,h4{font-family:var(--font-title);color:var(--navy);margin:0 0 .4em;line-height:1.15}
  header.top{background:linear-gradient(180deg,var(--navy),var(--navy-700));color:var(--cream);padding:16px 26px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .brand-mark{width:42px;height:42px;display:grid;place-items:center;border:1.5px solid var(--gold);color:var(--gold);font-family:var(--font-title);font-weight:700;font-size:18px;border-radius:8px}
  .brand-t{font-family:var(--font-title);font-size:21px}
  .brand-s{font-size:11px;color:var(--gold-soft);text-transform:uppercase;letter-spacing:.5px}
  .base-badge{margin-left:auto;border:1px solid var(--gold);border-radius:8px;padding:6px 12px;text-align:right}
  .base-badge .l{font-size:10px;color:var(--gold-soft);text-transform:uppercase;letter-spacing:.6px}
  .base-badge .v{font-family:var(--font-title);font-size:18px;color:#fff;font-weight:600}
  nav.tabs{display:flex;gap:4px;padding:10px 22px 0;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5;flex-wrap:wrap}
  nav.tabs button{font-family:inherit;font-size:14px;font-weight:600;color:var(--ink-soft);background:none;border:none;border-bottom:3px solid transparent;padding:10px 14px;cursor:pointer}
  nav.tabs button.active{color:var(--navy);border-bottom-color:var(--gold)}
  main{max-width:1100px;margin:0 auto;padding:24px 22px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:820px){.grid2{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 1px 2px rgba(16,37,66,.08);padding:20px 22px}
  .card h2{font-size:21px;margin-bottom:12px}
  .lead{color:var(--ink-soft);max-width:72ch;margin:0 0 18px}
  label{display:block;font-weight:600;font-size:13.5px;margin:12px 0 5px}
  .muted{color:var(--ink-faint);font-weight:400}
  textarea,select,input{width:100%;font-family:inherit;font-size:14px;padding:9px 11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink)}
  textarea:focus,select:focus,input:focus{outline:none;border-color:var(--gold)}
  textarea{resize:vertical;min-height:120px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
  @media(max-width:520px){.row{grid-template-columns:1fr}}
  .hint{font-size:12px;color:var(--ink-faint)}
  .btn{font-family:inherit;font-size:14px;font-weight:600;border-radius:8px;padding:10px 18px;cursor:pointer;border:1px solid var(--gold-deep);background:var(--gold);color:var(--navy-700)}
  .btn:hover{background:var(--gold-soft)}
  .alert{display:flex;gap:10px;border-radius:8px;padding:11px 13px;font-size:13.5px;margin:10px 0}
  .alert .i{font-weight:700}
  .a-info{background:#e7eef7;color:var(--info)} .a-warn{background:#fbf1d8;color:var(--warn)} .a-gold{background:rgba(200,162,76,.14);color:var(--gold-deep);border:1px solid var(--gold)}
  .ranges{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0}
  .rc{border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;background:var(--surface-alt)}
  .rc.rec{border-color:var(--gold);background:rgba(200,162,76,.08)}
  .rc .l{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-faint)}
  .rc .v{font-family:var(--font-title);font-size:26px;color:var(--navy);font-weight:600}
  .rc.rec .v{color:var(--gold-deep)}
  dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:13.5px;margin:14px 0}
  dl.kv dt{color:var(--ink-faint)} dl.kv dd{margin:0}
  ul.tasks{margin:6px 0 0;padding-left:20px} ul.tasks li{margin:3px 0}
  .pill{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:999px}
  .p-gold{background:rgba(200,162,76,.16);color:var(--gold-deep)} .p-muted{background:#eee;color:#555}
  .conf{font-size:11.5px;font-weight:600} .c-low{color:var(--danger)} .c-med{color:var(--warn)} .c-high{color:var(--ok)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:var(--navy);color:var(--cream);text-align:left;padding:9px 11px;font-weight:600;font-size:12px}
  td{padding:8px 11px;border-bottom:1px solid var(--border)}
  tr:nth-child(even) td{background:var(--surface-alt)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  footer{text-align:center;color:var(--ink-faint);font-size:12px;padding:18px}
  .hide{display:none}
  .bk-table{overflow-x:auto}
  .bk-table table{min-width:1120px}
  .bk-table input,.bk-table select,.bk-table textarea{width:100%;font-family:inherit;font-size:12.5px;padding:5px 6px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--ink)}
  .bk-table textarea{resize:vertical;min-height:34px}
  .bk-table td{vertical-align:top}
  .bk-num input{text-align:right}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
  .chip{font:inherit;font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--ink-soft)}
  .chip.active{background:var(--navy);color:#fff;border-color:var(--navy)}
  .dist{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}
  .dist .d{border:1px solid var(--border);border-radius:8px;padding:8px 14px;text-align:center;min-width:96px}
  .dist .d .n{font-family:var(--font-title);font-size:22px;font-weight:700}
  .dist .d.high .n{color:var(--navy)} .dist .d.medium .n{color:var(--gold-deep)} .dist .d.low .n{color:var(--ink-faint)}
  .rowact button{border:1px solid var(--border);background:#fff;border-radius:5px;cursor:pointer;padding:3px 7px;font-size:13px;margin:0 1px}
  .btn-sm{padding:6px 12px;font-size:13px}
  .btn-ghost{background:#fff;color:var(--navy);border-color:var(--border)}
  .dropzone{margin-top:12px;border:2px dashed var(--gold-soft);border-radius:10px;background:var(--surface-alt);padding:22px;text-align:center;cursor:pointer;transition:.15s}
  .dropzone:hover,.dropzone.dragover{border-color:var(--gold);background:rgba(200,162,76,.10)}
  .dz-ico{font-size:26px;color:var(--gold-deep)}
  #pr-list table{min-width:680px}
  #pr-list input,#pr-list select{width:100%;font-family:inherit;font-size:12.5px;padding:5px 6px;border:1px solid var(--border);border-radius:5px;background:#fff;color:var(--ink)}
  #pr-list .num input{text-align:right}
  /* Pantalla de acceso (candado por código) */
  body.locked > header.top, body.locked > nav.tabs, body.locked > main, body.locked > footer{display:none !important}
  #gate{position:fixed;inset:0;background:linear-gradient(180deg,var(--navy),var(--navy-700));display:none;align-items:center;justify-content:center;padding:20px;z-index:1000}
  body.locked #gate{display:flex}
  .gate-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;max-width:380px;width:100%;padding:30px 28px;text-align:center;box-shadow:0 12px 44px rgba(0,0,0,.35)}
  .gate-card h2{font-size:22px}
</style>
</head>
<body class="locked">
<div id="gate"><form class="gate-card" id="gate-form">
  <div class="brand-mark" style="margin:0 auto 14px">ILP</div>
  <h2 style="margin:0 0 4px">Acceso restringido</h2>
  <p class="muted" style="font-size:13px;margin:0 0 18px">Calculadora de Honorarios · herramienta interna de ILP Abogados</p>
  <input type="password" id="gate-input" placeholder="Código de acceso" autocomplete="current-password" style="width:100%;font-family:inherit;font-size:15px;padding:11px 13px;border:1px solid var(--border);border-radius:8px;text-align:center">
  <button class="btn" type="submit" style="width:100%;margin-top:12px">Entrar</button>
  <div id="gate-err" style="color:var(--danger);font-size:13px;margin-top:10px;min-height:18px"></div>
  <div class="muted" style="font-size:11px;margin-top:14px">Honorarios sugeridos · uso interno</div>
</form></div>
<script>
(function(){
  var H="ef781b49fdbcbaab77daa38dbf1873014915536bb98123475783d55bd047bb07";
  function unlock(){document.body.classList.remove("locked");}
  async function chk(code){try{if(window.crypto&&crypto.subtle){var b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code));return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,"0");}).join("")===H;}}catch(e){}return code===atob("Q2FsY3VsYWRvcklMUEAyMDI2IQ==");}
  var f=document.getElementById("gate-form");
  f.addEventListener("submit",async function(ev){ev.preventDefault();var v=document.getElementById("gate-input").value;var ok=await chk(v);if(ok){unlock();}else{document.getElementById("gate-err").textContent="Código incorrecto. Inténtalo de nuevo.";var i=document.getElementById("gate-input");i.value="";i.focus();}});
  var inp=document.getElementById("gate-input");if(inp)inp.focus();
})();
</script>
<header class="top">
  <div class="brand-mark">ILP</div>
  <div><div class="brand-t">Calculadora de Honorarios</div><div class="brand-s">Versión offline · misma lógica que la app</div></div>
  <div class="base-badge"><div class="l">Tarifa base</div><div class="v" id="baseRate">250 €/h</div></div>
</header>
<nav class="tabs">
  <button class="active" data-view="describe">Describir caso</button>
  <button data-view="breakdown">Desglose de actuaciones</button>
  <button data-view="refs">Referencias por área</button>
  <button data-view="props">Propuestas</button>
</nav>
<main>
  <section id="view-describe">
    <p class="lead">Describe el trabajo. Detecta el servicio, estima las horas y calcula un honorario <strong>sugerido</strong> usando tus acuerdos históricos por área (horas reales si las hay; si no, precio histórico; si no, una estimación orientativa). Misma lógica que la app, en tu navegador y sin conexión.</p>
    <div class="grid2">
      <div class="card">
        <h2>Describe el caso o propuesta</h2>
        <label>Descripción del trabajo</label>
        <textarea id="desc" placeholder="Ejemplo: El cliente necesita revisar un contrato de distribución internacional, preparar comentarios, participar en una reunión de negociación y entregar una versión revisada del documento."></textarea>
        <div class="row">
          <div><label>Área de servicio <span class="muted">(opcional)</span></label><select id="area"></select></div>
          <div><label>Tarifa/hora personalizada <span class="muted">(opcional)</span></label><input id="rate" type="number" min="0" placeholder="Vacío = 250 € base"></div>
        </div>
        <div class="row">
          <div><label>Urgencia</label><select id="urg"><option value="normal">Normal</option><option value="urgent">Urgente</option><option value="very_urgent">Muy urgente</option><option value="unknown">No estoy seguro</option></select></div>
          <div><label>Complejidad</label><select id="cplx"><option value="low">Baja</option><option value="medium" selected>Media</option><option value="high">Alta</option><option value="unknown">No estoy seguro</option></select></div>
        </div>
        <div style="margin-top:14px"><button class="btn" id="go">Estimar horas y honorarios</button></div>
      </div>
      <div class="card"><h2>Estimación</h2><div id="result"><p class="muted">Describe el caso y pulsa “Estimar horas y honorarios”.</p></div></div>
    </div>
  </section>
  <section id="view-breakdown" class="hide">
    <p class="lead">Descompone el mandato en <strong>actuaciones jurídicas</strong> y valora cada una por su <strong>aportación de valor</strong> (alta / media / baja), no sólo por el tiempo. Sirve para <strong>justificar el honorario</strong>. Genéralo desde una descripción, edítalo, <strong>guárdalo</strong> en este navegador y expórtalo a <strong>Word</strong>. Todo offline.</p>
    <div class="card">
      <h2>Generar desde una descripción</h2>
      <label>Descripción del trabajo</label>
      <textarea id="bk-desc" placeholder="Ejemplo: Concurso de acreedores de una sociedad: preparación de la solicitud, informe de la administración concursal, negociación con los acreedores y fase común."></textarea>
      <div class="row">
        <div><label>Área de servicio <span class="muted">(opcional)</span></label><select id="bk-area"></select></div>
        <div><label>Tarifa/hora <span class="muted">(opcional)</span></label><input id="bk-rate" type="number" min="0" placeholder="Vacío = 250 € base"></div>
      </div>
      <div class="row">
        <div><label>Urgencia</label><select id="bk-urg"><option value="normal">Normal</option><option value="urgent">Urgente</option><option value="very_urgent">Muy urgente</option><option value="unknown">No estoy seguro</option></select></div>
        <div><label>Complejidad</label><select id="bk-cplx"><option value="low">Baja</option><option value="medium" selected>Media</option><option value="high">Alta</option><option value="unknown">No estoy seguro</option></select></div>
      </div>
      <div style="margin-top:14px"><button class="btn" id="bk-gen">Generar desglose de actuaciones</button></div>
      <div id="bk-saved" style="margin-top:18px"></div>
    </div>
    <div id="bk-editor" style="margin-top:16px"></div>
  </section>
  <section id="view-refs" class="hide">
    <p class="lead">Tus acuerdos históricos <strong>aprobados</strong> por área (mismas referencias que la pantalla “Por área y precios” de la app). Honorario típico = mediana; rango = P25–P75.</p>
    <div class="card"><h2>Histórico aprobado</h2><div id="refsTable"></div></div>
    <div class="card" style="margin-top:14px"><h2>Tus propuestas por área</h2>
      <p class="hint" style="margin-top:-4px">Se crean a partir de lo que añades en “Propuestas”. Las áreas que no existían en el histórico aparecen marcadas como <strong>nuevas</strong>.</p>
      <div id="propRefsTable"></div></div>
  </section>
  <section id="view-props" class="hide">
    <p class="lead">Suelta aquí <strong>propuestas o acuerdos nuevos</strong> e indica su área, horas y honorario. Se <strong>guardan en este navegador</strong> y <strong>afinan las estimaciones</strong> de esa área (más datos = más precisión). Puedes <strong>eliminar</strong> cualquiera si te equivocas. Nada se sube a ningún servidor.</p>
    <div class="card">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600"><input type="checkbox" id="pr-use" style="width:auto" checked> Usar estas propuestas para afinar las estimaciones</label>
      <div class="dropzone" id="pr-drop" tabindex="0" role="button">
        <div class="dz-ico">⤓</div>
        <div><strong>Arrastra propuestas aquí</strong> o haz clic para seleccionarlas.</div>
        <div class="hint" style="margin-top:6px">Detecta <strong>área, horas y honorario</strong> automáticamente. Lee Word (.docx), Excel (.xlsx) y texto (.txt/.csv) <strong>dentro de tu navegador</strong>. Los PDF se analizan si hay conexión (se carga la librería una vez; el documento <strong>no sale</strong> de tu equipo). Imágenes y .doc antiguos: rellena tú las cifras.</div>
        <input type="file" id="pr-file" multiple style="display:none" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.eml,.msg,.png,.jpg,.jpeg">
      </div>
      <div id="pr-status" class="hint" style="margin-top:8px;color:var(--gold-deep);font-weight:600"></div>
      <div id="pr-list" style="margin-top:14px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn" id="pr-add">+ Añadir fila vacía</button>
        <button class="btn btn-ghost btn-sm" id="pr-clear">Vaciar todo</button>
      </div>
    </div>
  </section>
</main>
<footer>Honorarios <strong>sugeridos</strong>, no obligatorios · Versión offline · lógica idéntica a la app</footer>
<script>
const DATA = {"baseRate":250,"currency":"EUR","complexity_factor":{"low":0.85,"medium":1,"high":1.3,"unknown":1},"urgency_factor":{"normal":1,"urgent":1.2,"very_urgent":1.4,"unknown":1},"baselines":{"Marcas":{"min":4,"rec":8,"max":16},"Propiedad intelectual":{"min":8,"rec":16,"max":30},"Contratos mercantiles":{"min":8,"rec":16,"max":35},"Constitución de sociedades":{"min":6,"rec":12,"max":25},"Compliance":{"min":20,"rec":40,"max":80},"Protección de datos":{"min":10,"rec":25,"max":50},"Litigios":{"min":30,"rec":60,"max":120},"Due diligence":{"min":25,"rec":50,"max":100},"Consultoría regulatoria":{"min":15,"rec":35,"max":70},"Laboral":{"min":8,"rec":20,"max":45},"Fiscal":{"min":8,"rec":20,"max":45},"Revisión documental":{"min":4,"rec":10,"max":20},"Redacción de informes":{"min":4,"rec":10,"max":20},"Otros":{"min":6,"rec":14,"max":30},"M&A":{"min":60,"rec":120,"max":250},"Concursal":{"min":40,"rec":70,"max":130},"Reestructuraciones":{"min":40,"rec":80,"max":150},"Startups":{"min":10,"rec":25,"max":50},"Energías renovables":{"min":30,"rec":60,"max":120},"Procesal civil":{"min":30,"rec":60,"max":120},"Procesal penal":{"min":40,"rec":80,"max":150},"Asesoramiento corporativo":{"min":8,"rec":16,"max":35},"Regulatorio financiero":{"min":20,"rec":45,"max":90},"Secretarías de consejo":{"min":6,"rec":14,"max":30}},"defaultBaseline":{"min":6,"rec":14,"max":30},"est":{"Asesoramiento corporativo":{"nHours":16,"hP25":17.5,"hMed":25,"hP75":42.5,"nFee":33,"fP25":1080,"fMed":3300,"fP75":7200},"Laboral":{"nHours":14,"hP25":9.9375,"hMed":20,"hP75":40,"nFee":68,"fP25":937.5,"fMed":2500,"fP75":6000},"M&A":{"nHours":26,"hP25":40,"hMed":55,"hP75":78.75,"nFee":71,"fP25":5125,"fMed":9000,"fP75":15000},"Procesal civil":{"nHours":4,"hP25":7.75,"hMed":16.5,"hP75":25,"nFee":51,"fP25":1270,"fMed":2500,"fP75":11857.3},"Regulatorio financiero":{"nHours":6,"hP25":13.25,"hMed":17,"hP75":19.25,"nFee":15,"fP25":3000,"fMed":4500,"fP75":15100},"Secretarías de consejo":{"nHours":4,"hP25":4.5,"hMed":6,"hP75":10.25,"nFee":12,"fP25":925,"fMed":1165,"fP75":2000},"Startups":{"nHours":8,"hP25":12.5,"hMed":30,"hP75":62.5,"nFee":11,"fP25":800,"fMed":1200,"fP75":3625},"unknown":{"nHours":4,"hP25":17.5,"hMed":22.5,"hP75":25.75,"nFee":20,"fP25":1875,"fMed":4187.5,"fP75":8152.775},"Compliance":{"nHours":2,"hP25":37.5,"hMed":45,"hP75":52.5,"nFee":11,"fP25":4700,"fMed":9000,"fP75":15500},"Reestructuraciones":{"nHours":0,"hP25":0,"hMed":0,"hP75":0,"nFee":4,"fP25":8746.5,"fMed":13800,"fP75":21950},"Concursal":{"nHours":2,"hP25":16.25,"hMed":17.5,"hP75":18.75,"nFee":15,"fP25":3250,"fMed":10000,"fP75":17250},"Procesal penal":{"nHours":0,"hP25":0,"hMed":0,"hP75":0,"nFee":1,"fP25":45000,"fMed":45000,"fP75":45000},"Protección de datos":{"nHours":5,"hP25":15,"hMed":20,"hP75":25,"nFee":10,"fP25":2152.5,"fMed":3200,"fP75":3500}},"refs":[{"area":"Asesoramiento corporativo","model":"fixed","n":33,"p25":1080,"median":3300,"p75":7200,"hourly":null},{"area":"Compliance","model":"fixed","n":11,"p25":4700,"median":9000,"p75":15500,"hourly":null},{"area":"Concursal","model":"fixed","n":15,"p25":3250,"median":10000,"p75":17250,"hourly":200},{"area":"Laboral","model":"fixed","n":60,"p25":1185,"median":2750,"p75":8525,"hourly":175},{"area":"M&A","model":"fixed","n":66,"p25":6000,"median":9800,"p75":15225,"hourly":1600},{"area":"Procesal civil","model":"fixed","n":50,"p25":1185,"median":2500,"p75":11928.65,"hourly":215},{"area":"Procesal penal","model":"fixed","n":1,"p25":45000,"median":45000,"p75":45000,"hourly":null},{"area":"Protección de datos","model":"fixed","n":10,"p25":2152.5,"median":3200,"p75":3500,"hourly":180},{"area":"Reestructuraciones","model":"fixed","n":4,"p25":8746.5,"median":13800,"p75":21950,"hourly":null},{"area":"Regulatorio financiero","model":"fixed","n":15,"p25":3000,"median":4500,"p75":15100,"hourly":null},{"area":"Secretarías de consejo","model":"monthly","n":10,"p25":1000,"median":1165,"p75":1875,"hourly":null},{"area":"Startups","model":"fixed","n":11,"p25":800,"median":1200,"p75":3625,"hourly":155},{"area":"unknown","model":"fixed","n":20,"p25":1875,"median":4187.5,"p75":8152.78,"hourly":800}],"classifier":[{"category":"Regulatorio financiero","keywords":["regulatorio financiero","regulacion financiera","dora","mica","mifid","mifid ii","mifid 2","criptoactivos","criptoactivo","cripto","esma","eba","cnmv","banco de espana","supervision bancaria","entidad de pago","entidad de dinero electronico","psd2","sandbox","folleto","emision","prospecto","tokenizacion","token","resiliencia operativa","servicios de inversion"],"subs":[{"name":"MiFID II","keywords":["mifid","mifid ii","mifid 2","servicios de inversion","empresa de servicios de inversion"]},{"name":"MiCA y criptoactivos","keywords":["mica","criptoactivos","criptoactivo","cripto","token","stablecoin","tokenizacion"]},{"name":"DORA y resiliencia operativa","keywords":["dora","resiliencia operativa","riesgo tecnologico","ciberresiliencia"]},{"name":"Supervisión y autorizaciones","keywords":["autorizacion","supervision","licencia financiera","entidad de pago","sandbox","psd2"]},{"name":"Folletos y emisiones","keywords":["folleto","emision","prospecto"]}]},{"category":"M&A","keywords":["m&a","fusiones y adquisiciones","fusion","adquisicion","compraventa de empresa","compra de empresa","joint venture","jv","spa","share purchase","sale and purchase","compra de participaciones","compra de acciones","data room","due diligence","carve-out","vendor due diligence","integracion post-fusion"],"subs":[{"name":"Adquisiciones","keywords":["adquisicion","compra de empresa","compraventa de empresa","spa","share purchase","compra de participaciones","compra de acciones"]},{"name":"Fusiones","keywords":["fusion","fusion por absorcion","fusion por creacion"]},{"name":"Joint ventures","keywords":["joint venture","jv","sociedad conjunta"]},{"name":"Due diligence en M&A","keywords":["due diligence","data room","diligencia debida","vendor due diligence"]},{"name":"Acuerdos de inversión","keywords":["acuerdo de inversion","inversion estrategica","entrada de inversor"]}]},{"category":"Asesoramiento corporativo","keywords":["asesoramiento corporativo","corporativo","societario","gobierno corporativo","mercantil","constitucion de sociedad","estatutos","estatutos sociales","junta general","junta de socios","ampliacion de capital","reduccion de capital","operacion societaria","secretaria societaria","objeto social","organo de administracion","socios minoritarios","socio minoritario","conflicto societario","conflictos societarios","abuso de la mayoria","abuso de mayoria","impugnacion de acuerdos","acuerdos sociales","retribucion del administrador","doctrina del vinculo","348 bis","acuerdo de gobernanza","reparto de dividendos","dotacion de reservas","quorum","accion de responsabilidad"],"subs":[{"name":"Gobierno corporativo","keywords":["gobierno corporativo","buen gobierno","politica societaria"]},{"name":"Operaciones societarias","keywords":["constitucion de sociedad","ampliacion de capital","reduccion de capital","escision","transformacion","operacion societaria"]},{"name":"Secretaría societaria","keywords":["secretaria societaria","libro de actas","certificaciones societarias"]},{"name":"Juntas y consejos","keywords":["junta general","junta de socios","consejo de administracion"]},{"name":"Pactos de socios","keywords":["pacto de socios","acuerdo de socios","shareholders agreement"]},{"name":"Conflictos Societarios","keywords":["conflicto societario","conflictos societarios","socios minoritarios","socio minoritario","defensa de la minoria","proteccion de la minoria","abuso de la mayoria","abuso de mayoria","socio mayoritario","administrador unico","retribucion del administrador","doctrina del vinculo","348 bis","articulo 348 bis","impugnacion de acuerdos","impugnacion de acuerdos sociales","acuerdo de gobernanza","protocolo de gobernanza","reparto de dividendos","dotacion de reservas","accion social de responsabilidad","accion de responsabilidad","derecho de separacion","convocatoria de junta","quorum"]}]},{"category":"Compliance","keywords":["compliance","cumplimiento normativo","programa de cumplimiento","codigo de conducta","codigo etico","canal de denuncias","whistleblowing","prevencion de delitos","prevencion penal","compliance penal","modelo de prevencion","anticorrupcion","blanqueo de capitales","prevencion de blanqueo","aml","matriz de riesgos"],"subs":[{"name":"Prevención penal","keywords":["prevencion penal","compliance penal","prevencion de delitos","modelo de prevencion"]},{"name":"Prevención de blanqueo (AML)","keywords":["blanqueo de capitales","prevencion de blanqueo","aml","sepblac"]},{"name":"Canal de denuncias","keywords":["canal de denuncias","whistleblowing","denunciante"]},{"name":"Código ético y conducta","keywords":["codigo de conducta","codigo etico"]},{"name":"Matriz de riesgos","keywords":["matriz de riesgos","mapa de riesgos","evaluacion de riesgos penales"]}]},{"category":"Concursal","keywords":["concursal","concurso","concurso de acreedores","preconcurso","pre-concurso","insolvencia","administracion concursal","calificacion concursal","reintegracion","masa activa","masa pasiva","convenio concursal","liquidacion concursal","comunicacion 5 bis"],"subs":[{"name":"Pre-concurso","keywords":["preconcurso","pre-concurso","comunicacion 5 bis"]},{"name":"Concurso de acreedores","keywords":["concurso de acreedores","concurso","administracion concursal"]},{"name":"Calificación concursal","keywords":["calificacion concursal","concurso culpable"]},{"name":"Acciones de reintegración","keywords":["reintegracion","accion rescisoria"]}]},{"category":"Reestructuraciones","keywords":["reestructuracion","reestructuraciones","refinanciacion","plan de reestructuracion","restructuring","quita","espera","homologacion","reestructuracion de deuda","reestructuracion financiera","reestructuracion operativa","workout"],"subs":[{"name":"Reestructuración financiera","keywords":["reestructuracion financiera","refinanciacion"]},{"name":"Planes de reestructuración","keywords":["plan de reestructuracion","homologacion"]},{"name":"Refinanciación de deuda","keywords":["refinanciacion de deuda","reestructuracion de deuda","quita","espera"]},{"name":"Reestructuración operativa","keywords":["reestructuracion operativa","workout"]}]},{"category":"Startups","keywords":["startup","startups","ronda","ronda de financiacion","seed","serie a","serie b","pacto de socios","term sheet","hoja de terminos","stock options","esop","phantom","venture","venture capital","vesting","nota convertible","safe","cap table","scaleup"],"subs":[{"name":"Rondas de financiación","keywords":["ronda","ronda de financiacion","seed","serie a","serie b","nota convertible","safe"]},{"name":"Pactos de socios","keywords":["pacto de socios","acuerdo de socios","shareholders agreement"]},{"name":"Stock options / ESOP","keywords":["stock options","esop","phantom","vesting"]},{"name":"Constitución de startup","keywords":["constitucion de startup","incorporacion de startup"]},{"name":"Term sheets","keywords":["term sheet","hoja de terminos"]}]},{"category":"Energías renovables","keywords":["energia renovable","energias renovables","renovables","ppa","power purchase","fotovoltaica","eolica","planta solar","parque eolico","autoconsumo","permitting","hibridacion","almacenamiento","punto de conexion","biogas","hidrogeno verde"],"subs":[{"name":"PPA","keywords":["ppa","power purchase","compraventa de energia"]},{"name":"Desarrollo de proyectos","keywords":["desarrollo de proyecto","planta solar","parque eolico","fotovoltaica","eolica","autoconsumo"]},{"name":"Permitting y autorizaciones","keywords":["permitting","autorizacion administrativa","punto de conexion","declaracion de impacto ambiental"]},{"name":"M&A renovables","keywords":["adquisicion de planta","compraventa de proyecto renovable"]}]},{"category":"Procesal civil","keywords":["procesal civil","litigio civil","litigacion","demanda","demandar","contencioso","pleito","juicio","reclamacion de cantidad","reclamacion judicial","recurso","apelacion","casacion","arbitraje","mediacion","medidas cautelares","ejecucion","monitorio","responsabilidad civil","incumplimiento contractual","tribunal","juzgado","laudo"],"subs":[{"name":"Litigación civil","keywords":["litigio civil","demanda civil","responsabilidad civil","incumplimiento contractual"]},{"name":"Arbitraje","keywords":["arbitraje","laudo","corte de arbitraje"]},{"name":"Reclamación de cantidad","keywords":["reclamacion de cantidad","impago","reclamacion de deuda"]},{"name":"Medidas cautelares","keywords":["medidas cautelares","embargo preventivo"]},{"name":"Ejecuciones","keywords":["ejecucion","ejecucion de sentencia","monitorio"]}]},{"category":"Procesal penal","keywords":["procesal penal","penal economico","defensa penal","delito societario","querella","diligencias previas","investigacion interna","delito fiscal","administracion desleal","apropiacion indebida","estafa","corrupcion","forensic","imputado","investigado"],"subs":[{"name":"Defensa penal económica","keywords":["defensa penal","penal economico","delito economico"]},{"name":"Delitos societarios","keywords":["delito societario","administracion desleal","apropiacion indebida"]},{"name":"Investigaciones internas","keywords":["investigacion interna","forensic"]},{"name":"Diligencias previas","keywords":["diligencias previas","querella","denuncia penal"]}]},{"category":"Protección de datos","keywords":["proteccion de datos","datos personales","rgpd","gdpr","lopd","lopdgdd","privacidad","tratamiento de datos","responsable del tratamiento","encargado del tratamiento","aepd","brecha de seguridad","brecha de datos","derechos arco","consentimiento","politica de privacidad","dpo","delegado de proteccion de datos","eipd","dpia"],"subs":[{"name":"RGPD y LOPDGDD","keywords":["rgpd","gdpr","lopd","lopdgdd","adaptacion a normativa","adaptacion rgpd"]},{"name":"Evaluaciones de impacto (EIPD)","keywords":["eipd","evaluacion de impacto","dpia"]},{"name":"Delegado de protección de datos (DPO)","keywords":["dpo","delegado de proteccion de datos"]},{"name":"Brechas de seguridad","keywords":["brecha de seguridad","brecha de datos","notificacion de brecha"]},{"name":"Auditoría de privacidad","keywords":["auditoria de privacidad","auditoria rgpd"]}]},{"category":"Secretarías de consejo","keywords":["secretaria del consejo","secretarias de consejo","secretario del consejo","vicesecretario","consejo de administracion","actas del consejo","acuerdos del consejo","gobierno del consejo","asesoramiento al consejo","libro de actas","comision de auditoria","comision de nombramientos"],"subs":[{"name":"Secretaría del consejo","keywords":["secretaria del consejo","secretario del consejo","vicesecretario"]},{"name":"Actas y acuerdos","keywords":["actas del consejo","acuerdos del consejo","libro de actas"]},{"name":"Asesoramiento a consejeros","keywords":["asesoramiento al consejo","deberes del consejero","responsabilidad del consejero"]},{"name":"Gobierno del consejo","keywords":["gobierno del consejo","comision de auditoria","comision de nombramientos"]}]},{"category":"Laboral","keywords":["laboral","derecho del trabajo","despido","despido objetivo","despido disciplinario","finiquito","erte","ere","expediente de regulacion","contrato de trabajo","seguridad social","convenio colectivo","procedimiento laboral","conflicto colectivo","reclamacion de salarios","pago de salarios","nomina","iguala laboral","recurrentes laboral","extincion de contrato","indemnizacion por despido","juzgado de lo social"],"subs":[{"name":"Iguala laboral (recurrente)","keywords":["iguala laboral","honorarios recurrentes","asesoramiento laboral recurrente","recurrentes"]},{"name":"Despidos","keywords":["despido","despido objetivo","despido disciplinario","finiquito","extincion de contrato"]},{"name":"ERTE / ERE","keywords":["erte","ere","expediente de regulacion"]},{"name":"Procedimiento laboral","keywords":["procedimiento laboral","juzgado de lo social","demanda laboral"]},{"name":"Reclamación de salarios","keywords":["reclamacion de salarios","pago de salarios","salarios impagados"]}]},{"category":"Otros","keywords":["asesoramiento general","consulta general","asesoria juridica general","otros servicios","gestion administrativa"],"subs":[]}],"categories":[{"name":"Regulatorio financiero","subs":["MiFID II","MiCA y criptoactivos","DORA y resiliencia operativa","Supervisión y autorizaciones","Folletos y emisiones"]},{"name":"Procesal civil","subs":["Litigación civil","Arbitraje","Reclamación de cantidad","Medidas cautelares","Ejecuciones"]},{"name":"Secretarías de consejo","subs":["Secretaría del consejo","Actas y acuerdos","Asesoramiento a consejeros","Gobierno del consejo"]},{"name":"Compliance","subs":["Prevención penal","Prevención de blanqueo (AML)","Canal de denuncias","Código ético y conducta","Matriz de riesgos"]},{"name":"Energías renovables","subs":["PPA","Desarrollo de proyectos","Permitting y autorizaciones","M&A renovables"]},{"name":"Startups","subs":["Rondas de financiación","Pactos de socios","Stock options / ESOP","Constitución de startup","Term sheets"]},{"name":"Protección de datos","subs":["RGPD y LOPDGDD","Evaluaciones de impacto (EIPD)","Delegado de protección de datos (DPO)","Brechas de seguridad","Auditoría de privacidad"]},{"name":"Reestructuraciones","subs":["Reestructuración financiera","Planes de reestructuración","Refinanciación de deuda","Reestructuración operativa"]},{"name":"Procesal penal","subs":["Defensa penal económica","Delitos societarios","Investigaciones internas","Diligencias previas"]},{"name":"Asesoramiento corporativo","subs":["Gobierno corporativo","Operaciones societarias","Secretaría societaria","Juntas y consejos","Pactos de socios","Conflictos Societarios"]},{"name":"Concursal","subs":["Pre-concurso","Concurso de acreedores","Calificación concursal","Acciones de reintegración"]},{"name":"M&A","subs":["Adquisiciones","Fusiones","Joint ventures","Due diligence en M&A","Acuerdos de inversión"]}]};
const r1 = n => Math.round(n*10)/10;
const r2 = n => Math.round((n+Number.EPSILON)*100)/100;
const money = (n,c) => (n==null||isNaN(n))?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:c||DATA.currency||'EUR',maximumFractionDigits:0}).format(n);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const MODEL_LABEL={monthly:'iguala mensual',fixed:'precio fijo',hourly:'por horas',success_fee:'cuota de éxito',blended:'mixto'};
function stripAccents(s){return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');}
function normalize(text){return ' '+stripAccents(text).replace(/\\s+/g,' ')+' ';}
function normKw(kw){return stripAccents(kw).replace(/\\s+/g,' ').trim();}
function escRe(s){return s.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');}
// Coincidencia por LÍMITE DE PALABRA: evita falsos positivos de claves cortas
// (p.ej. "ere" dentro de "derecho", "spa" dentro de "espacio", "mica" en "química").
function countOcc(h,n){if(!n)return 0;const re=new RegExp('(^|[^a-z0-9])'+escRe(n)+'([^a-z0-9]|$)','g');let c=0,m;while((m=re.exec(h))){c++;re.lastIndex=m.index+m[1].length+n.length;}return c;}

/* ===== Criterios de valoración por materia (espejo de services/valuationCriteria.ts) =====
   Encuadran y justifican el honorario cuando la materia NO se reduce a horas×tarifa
   (fases, fijos por actuación, comisión de éxito no dineraria, provisión a cuenta…).
   Importes de referencia de propuestas reales anonimizadas: orientativos (no obligatorios). */
const VALUATION_CRITERIA=[{
  service_category:'Asesoramiento corporativo', service_subcategory:'Conflictos Societarios',
  title:'Conflictos societarios — defensa de la minoría',
  summary:'Defensa de socios minoritarios frente a la gestión del socio mayoritario y administrador único: análisis y opinión legal (retribución del administrador; convocatoria y quórum; dividendos/reservas y abuso de la mayoría) y actuación negociadora extrajudicial (MASC) y judicial para un acuerdo de gobernanza.',
  source:'docs/propuestas/conflictos-societarios.md',
  criteria:[
    {label:'Encargo por fases con honorario autónomo',detail:'Dos fases con tratamiento económico independiente: análisis y opinión legal (fase 1) y negociación extrajudicial + judicial (fase 2). Aceptar la fase 1 no obliga a continuar con la fase 2.'},
    {label:'Fijo por actuación procesal (escala con el nº de acciones)',detail:'La fase 2 retribuye con importes fijos por hito: inicio del MASC y una cantidad fija por cada demanda o querella interpuesta (previa autorización expresa del cliente).'},
    {label:'Ponderación por naturaleza de la acción (penal > civil/mercantil)',detail:'La vía penal se valora por encima de la civil/mercantil por su mayor responsabilidad (15.000 € por querella frente a 7.000 € por demanda civil/mercantil).'},
    {label:'Comisión de éxito de importe fijo (resultado no dinerario)',detail:'El resultado perseguido es la firma de un acuerdo de gobernanza, no una cantidad de dinero; la comisión de éxito es una cantidad fija que se devenga con la firma, no un porcentaje.'},
    {label:'Provisión de fondos / cantidades a cuenta (60%)',detail:'A la firma del mandato se percibe el 60% de las cantidades de análisis y de negociación, imputable a cada fase conforme se devengue.'},
    {label:'Devengo en caso de desistimiento',detail:'Si el cliente desiste una vez iniciado, únicamente no se devenga la comisión de éxito; el resto se considera devengado.'}
  ],
  reference_fees:[
    {phase:'Fase 1 — Análisis y opinión legal',concept:'Revisión documental, análisis de los tres bloques y opinión legal escrita',unit:'€',amount:10000,vat:true},
    {phase:'Fase 2 — Negociación (parte fija)',concept:'Inicio de la vía extrajudicial (MASC)',unit:'€',amount:2000,vat:true},
    {phase:'Fase 2 — Negociación (parte fija)',concept:'Por cada demanda civil o mercantil',unit:'€/actuación',amount:7000,vat:true,note:'Requiere autorización expresa del cliente.'},
    {phase:'Fase 2 — Negociación (parte fija)',concept:'Por cada querella o acción penal',unit:'€/actuación',amount:15000,vat:true,note:'Requiere autorización expresa del cliente.'},
    {phase:'Fase 2 — Comisión de éxito',concept:'Firma del acuerdo de gobernanza (resultado no dinerario)',unit:'€',amount:10000,vat:true,note:'Cantidad fija, no porcentual.'},
    {phase:'A la firma del mandato',concept:'Cantidades a cuenta (imputables a cada fase)',unit:'%',pct:60,vat:false,note:'60% de las cantidades de análisis y de negociación.'}
  ],
  legal_basis:[
    'Retribución del administrador: arts. 217 y 249 LSC; reserva estatutaria y doctrina del vínculo; STS 26/02/2018.',
    'Convocatoria y quórum de Juntas Ordinarias y Extraordinarias (doble régimen estatutario de quórum).',
    'Dividendos, reservas y abuso de la mayoría: art. 348 bis LSC (separación) y art. 204 LSC (impugnación de acuerdos lesivos).'
  ],
  notes:[
    'Gastos y suplidos (aranceles, tasas, peritos, costes del MASC, desplazamientos) e impuestos se repercuten aparte.',
    'Responsabilidad limitada a los importes efectivamente percibidos.',
    'Importes de referencia de una propuesta real anonimizada: orientativos y revisables.'
  ],
  match_keywords:['socios minoritarios','socio minoritario','conflicto societario','conflictos societarios','socio mayoritario','administrador unico','abuso de la mayoria','abuso de mayoria','retribucion del administrador','doctrina del vinculo','348 bis','impugnacion de acuerdos','acuerdos sociales','acuerdo de gobernanza','pacto de socios','reparto de dividendos','dotacion de reservas','quorum','accion de responsabilidad','derecho de separacion','masc']
}];
/* Devuelve los criterios de la materia por (categoría+subcategoría) o por señal de la descripción (>=2 keywords). */
function criteriaFor(area, sub, desc){
  const cat=(area||'').trim(), sc=(sub||'').trim();
  const exact=VALUATION_CRITERIA.find(m=>m.service_category===cat&&m.service_subcategory===sc);
  if(exact) return exact;
  const d=stripAccents(desc||'');
  let best=null,bh=0;
  for(const m of VALUATION_CRITERIA){
    if(cat&&cat!=='unknown'&&m.service_category!==cat) continue;
    let hits=0; for(const kw of m.match_keywords){ if(d.includes(stripAccents(kw))) hits++; }
    if(hits>=2&&hits>bh){best=m;bh=hits;}
  }
  return best;
}
function classify(desc, manual){
  if(manual && manual.trim()) return {category:manual.trim(), sub:null, conf:'high'};
  if(!desc.trim()) return {category:'unknown',sub:null,conf:'low'};
  const signal=normalize([desc,desc,desc].join(' . '));
  const scores=[];
  for(const def of DATA.classifier){ if(def.category==='Otros')continue;
    let score=0; for(const kw of def.keywords){const occ=countOcc(signal,normKw(kw)); if(occ>0) score+=occ*kw.trim().split(' ').length;}
    if(score>0) scores.push({category:def.category,score});
  }
  if(!scores.length) return {category:'unknown',sub:null,conf:'low'};
  scores.sort((a,b)=>b.score-a.score);
  const top=scores[0], runner=scores[1];
  const def=DATA.classifier.find(c=>c.category===top.category);
  let sub=null,sc=0; for(const s of (def.subs||[])){let v=0;for(const kw of s.keywords){const o=countOcc(signal,normKw(kw)); if(o>0)v+=o*kw.trim().split(' ').length;} if(v>sc){sc=v;sub=s.name;}}
  let conf; const margin=runner?top.score-runner.score:top.score;
  if(top.score>=3&&margin>=2)conf='high'; else if(top.score>=2||(top.score>=1&&!runner))conf='medium'; else conf='low';
  return {category:top.category, sub, conf};
}
const ACTION=['revis','redact','prepar','analiz','particip','negoci','asist','present','elabor','entreg','comparec','recurr','contest','registr','constitu','tramit','gestion','asesor','audit','evalu','impugn','demand','defend','coordin','dictamin','inscrib','formaliz','due diligence','revision','informe'];
function identifyTasks(description){
  const text=(description||'').replace(/\\s+/g,' ').trim(); if(!text)return[];
  const frags=text.split(/[,;.]| y | e | adem[aá]s | as[ií] como | luego /i).map(f=>f.trim()).filter(Boolean);
  const tasks=[];
  for(const f of frags){const nf=stripAccents(f); if(ACTION.some(v=>nf.includes(v))){const c=f.replace(/^(y|e|adem[aá]s|tambi[eé]n|que|para|de)\\s+/i,'').trim(); if(c.length>=3 && !tasks.some(t=>stripAccents(t)===stripAccents(c))) tasks.push(c.charAt(0).toUpperCase()+c.slice(1));} if(tasks.length>=8)break;}
  return tasks.length?tasks:[text.length>140?text.slice(0,140)+'…':text];
}
// Áreas candidatas más probables (para la comparativa por área).
function classifyTop(desc,n){
  if(!desc.trim())return [];
  const signal=normalize([desc,desc,desc].join(' . '));
  const scores=[];
  for(const def of DATA.classifier){ if(def.category==='Otros')continue;
    let score=0; for(const kw of def.keywords){const occ=countOcc(signal,normKw(kw)); if(occ>0) score+=occ*kw.trim().split(' ').length;}
    if(score>0) scores.push({category:def.category,score});
  }
  scores.sort((a,b)=>b.score-a.score);
  return scores.slice(0,n).map(s=>s.category);
}
// Estima horas+honorario para UN área concreta (reutilizado por estimate y por la comparativa).
function estimateArea(area,rate,cf,uf){
  const e=effAggregate(area);
  const minN=(e&&e._local)?1:3;   // tus propuestas cuentan aunque sean pocas
  let hMin,hRec,hMax,source,sample=0;
  if(e && e.nHours>=minN){ hMin=r1(e.hP25);hRec=r1(e.hMed);hMax=r1(e.hP75);source='hours';sample=e.nHours; }
  else if(e && e.nFee>=minN){ hMin=r1(e.fP25/rate);hRec=r1(e.fMed/rate);hMax=r1(e.fP75/rate);source='price';sample=e.nFee; }
  else { const b=DATA.baselines[area]||DATA.defaultBaseline; hMin=b.min;hRec=b.rec;hMax=b.max;source='baseline'; }
  const f=cf*uf;
  return {area,hMin,hRec,hMax,feeMin:r2(hMin*rate*f),feeRec:r2(hRec*rate*f),feeMax:r2(hMax*rate*f),source,sample,local:(e&&e._local)||0};
}
// Etiqueta de respaldo (en qué se basa el importe de un área).
function backLabel(r){ if(r.local) return 'afinado con '+r.local+' propuesta(s) tuya(s)'; if(r.source==='hours') return r.sample+' acuerdo(s) con horas'; if(r.source==='price') return r.sample+' acuerdo(s) con importe'; return 'sin acuerdos (orientativo)'; }

function estimate(inp){
  const desc=(inp.desc||'').trim(), words=desc.split(/\\s+/).filter(Boolean);
  if(desc.length<25||words.length<6) return {needs:true, missing:['Describe con más detalle: tareas concretas, alcance y documentos implicados.']};
  const manual=(inp.area && inp.area!=='No estoy seguro' && inp.area!=='unknown')?inp.area:null;
  const cls=classify(desc, manual);
  const area=cls.category||'unknown';
  const crit=criteriaFor(area, cls.sub, desc);
  const subLabel=crit?crit.service_subcategory:cls.sub;
  const tasks=identifyTasks(desc);
  const cf=(DATA.complexity_factor[inp.cplx] ?? DATA.complexity_factor['unknown'] ?? 1);
  const uf=(DATA.urgency_factor[inp.urg] ?? DATA.urgency_factor['unknown'] ?? 1);
  const usedBase=!(inp.rate>0); const rate=usedBase?DATA.baseRate:inp.rate;
  const p=estimateArea(area,rate,cf,uf);
  const source=p.source, usedHist=source!=='baseline';
  let conf; if(source==='hours'&&cls.conf==='high')conf='high'; else if(usedHist)conf='medium'; else conf='low';
  // Comparativa: el área elegida + las áreas más probables detectadas (hasta 3).
  const cmp=[],seen={};
  function addCmp(a){ if(!a||a==='unknown'||seen[a])return; seen[a]=1; const r=estimateArea(a,rate,cf,uf); r.conf=(r.source==='baseline'?'low':'medium'); r.isChosen=(a===area); cmp.push(r); }
  addCmp(area); classifyTop(desc,4).forEach(addCmp);
  const comparison=cmp.slice(0,3);
  const missing=[];
  if(area==='unknown') missing.push('No se identificó el área con seguridad; indícala manualmente.');
  if(source==='baseline') missing.push('Sin acuerdos históricos de esta área: horas estimadas con un supuesto orientativo (ajustable).');
  if(source==='price') missing.push('Honorario anclado al precio histórico del área (horas implícitas = precio ÷ tarifa).');
  if(usedBase) missing.push('Se usó la tarifa base de '+rate+' €/h (no se indicó tarifa personalizada).');
  if(p.local) missing.push('Estimación AFINADA con '+p.local+' propuesta(s) tuya(s) de esta área (pestaña “Propuestas”).');
  if(crit){ missing.push('Confirma el alcance real (nº de demandas/querellas, fase contratada) para aplicar el cuadro de honorarios de la materia.'); }
  return {needs:false,area,sub:subLabel,clsConf:cls.conf,manualArea:!!manual,tasks,
    hMin:p.hMin,hRec:p.hRec,hMax:p.hMax,feeMin:p.feeMin,feeRec:p.feeRec,feeMax:p.feeMax,
    rate,usedBase,cf,uf,source,conf,comparison,missing,sample:p.sample,criteria:crit||null};
}
function confSpan(c){const m={low:['c-low','Confianza baja'],medium:['c-med','Confianza media'],high:['c-high','Confianza alta']}[c]||['c-low','Confianza baja'];return '<span class="conf '+m[0]+'">'+m[1]+'</span>';}
function critFeeAmount(f,cur){ if(f.pct!=null) return f.pct+'%'; if(f.amount==null) return '—'; return money(f.amount,cur)+(f.vat?' <span class="hint">+ IVA</span>':''); }
function criteriaBlockHTML(e){
  const c=e.criteria; if(!c) return '';
  const cur=DATA.currency||'EUR';
  const rows=c.reference_fees.map(f=>'<tr><td>'+esc(f.phase)+'</td><td>'+esc(f.concept)+(f.note?'<br><span class="hint">'+esc(f.note)+'</span>':'')+'</td><td>'+esc(f.unit)+'</td><td class="num"><strong>'+critFeeAmount(f,cur)+'</strong></td></tr>').join('');
  const crit=c.criteria.map(k=>'<li><strong>'+esc(k.label)+'.</strong> <span class="hint">'+esc(k.detail)+'</span></li>').join('');
  const legal=c.legal_basis.map(l=>'<li>'+esc(l)+'</li>').join('');
  const notes=c.notes.map(n=>'<li>'+esc(n)+'</li>').join('');
  return '<div style="margin-top:16px;border-left:3px solid #c8a24c;padding:2px 0 2px 14px">'+
    '<h3 style="margin-top:6px">Criterios de valoración de la materia</h3>'+
    '<p class="hint">'+esc(c.title)+' — '+esc(c.summary)+'</p>'+
    '<p class="hint">Esta materia se estructura por criterios propios (no solo por horas). El rango por horas de arriba es orientativo; el cuadro siguiente es la <strong>referencia de honorarios</strong> de una propuesta real anonimizada (revisable).</p>'+
    '<h3 style="margin-top:10px">Criterios que aplica</h3><ul class="tasks">'+crit+'</ul>'+
    '<h3 style="margin-top:10px">Cuadro de honorarios de referencia</h3>'+
    '<table><thead><tr><th>Fase</th><th>Concepto</th><th>Unidad</th><th class="num">Referencia</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<h3 style="margin-top:10px">Base jurídica</h3><ul class="tasks hint">'+legal+'</ul>'+
    '<ul class="tasks hint">'+notes+'</ul>'+
    '<p class="hint">Fuente: '+esc(c.source)+'</p></div>';
}
function renderResult(e){
  const box=document.getElementById('result');
  if(e.needs){box.innerHTML='<div class="alert a-warn"><span class="i">⚠</span><div><strong>Necesito más detalle.</strong><ul class="tasks">'+e.missing.map(m=>'<li>'+esc(m)+'</li>').join('')+'</ul></div></div>';return;}
  window.LAST_EST=e;
  const cur=DATA.currency||'EUR';
  const src=e.source==='hours'?('Horas a partir de '+e.sample+' trabajo(s) histórico(s) aprobado(s) del área.')
    :e.source==='price'?('Honorario anclado al precio histórico de '+e.sample+' acuerdo(s) aprobado(s) del área; horas implícitas = precio ÷ tarifa.')
    :('Horas estimadas con un supuesto típico del área (sin acuerdos históricos). Ajustable.');
  const comp=(e.comparison&&e.comparison.length>1)?
    '<h3 style="margin-top:14px">Comparativa por área</h3>'+
    '<p class="hint">El mismo asunto puede encajar en varias áreas y el honorario cambia según los datos de cada una. Prioriza las <strong>respaldadas por acuerdos reales</strong> (mayor fiabilidad); las marcadas como “sin acuerdos” son orientativas.</p>'+
    '<table><thead><tr><th>Área</th><th class="num">Honorario rec.</th><th>Respaldo</th><th>Fiabilidad</th></tr></thead><tbody>'+
    e.comparison.map(r=>'<tr'+(r.isChosen?' style="background:rgba(200,162,76,.12)"':'')+'><td>'+esc(r.area)+(r.isChosen?' <span class="pill p-gold">elegida</span>':'')+'</td><td class="num"><strong>'+money(r.feeRec,cur)+'</strong></td><td class="hint">'+backLabel(r)+'</td><td>'+confSpan(r.conf)+'</td></tr>').join('')+
    '</tbody></table>':'';
  box.innerHTML=
    '<div class="alert a-info"><span class="i">ℹ</span><div>Honorario <strong>sugerido</strong>, no obligatorio.</div></div>'+
    (e.source==='baseline'?'<div class="alert a-warn"><span class="i">⚠</span><div><strong>Estimación orientativa.</strong> Esta área no tiene acuerdos históricos en la herramienta: el importe es un supuesto de partida. Ajústalo con criterio y, si el asunto encaja en otra área con datos reales, usa la comparativa de abajo.</div></div>':'')+
    (e.usedBase?'<div class="alert a-gold"><span class="i">★</span><div>Tarifa base de '+DATA.baseRate+' €/hora (no se introdujo tarifa personalizada).</div></div>':'')+
    '<dl class="kv"><dt>Servicio detectado</dt><dd>'+esc(e.area)+(e.sub?' <span class="muted">/ '+esc(e.sub)+'</span>':'')+' '+(e.manualArea?'<span class="pill p-muted">elegido manualmente</span>':'<span class="hint">clasificación </span>'+confSpan(e.clsConf))+'</dd></dl>'+
    '<h3 style="margin-top:6px">Tareas identificadas</h3><ul class="tasks">'+e.tasks.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>'+
    '<h3 style="margin-top:14px">Horas estimadas</h3><div class="ranges">'+
      '<div class="rc"><div class="l">Mínimo</div><div class="v">'+e.hMin+' h</div></div>'+
      '<div class="rc rec"><div class="l">Recomendado</div><div class="v">'+e.hRec+' h</div></div>'+
      '<div class="rc"><div class="l">Máximo</div><div class="v">'+e.hMax+' h</div></div></div>'+
    '<h3>Honorarios sugeridos</h3><div class="ranges">'+
      '<div class="rc"><div class="l">Mínimo</div><div class="v">'+money(e.feeMin,cur)+'</div></div>'+
      '<div class="rc rec"><div class="l">Recomendado</div><div class="v">'+money(e.feeRec,cur)+'</div></div>'+
      '<div class="rc"><div class="l">Máximo</div><div class="v">'+money(e.feeMax,cur)+'</div></div></div>'+
    comp+
    criteriaBlockHTML(e)+
    '<dl class="kv" style="margin-top:14px"><dt>Tarifa usada</dt><dd>'+e.rate+' €/hora '+(e.usedBase?'<span class="pill p-gold">tarifa base</span>':'<span class="pill p-muted">personalizada</span>')+'</dd>'+
      '<dt>Factores</dt><dd>complejidad ×'+e.cf+' · urgencia ×'+e.uf+'</dd>'+
      '<dt>Fiabilidad del importe</dt><dd>'+confSpan(e.conf)+' <span class="hint">('+(e.source==='hours'?'horas de acuerdos reales':e.source==='price'?'precio histórico del área':'supuesto sin histórico')+')</span></dd></dl>'+
    '<h3 style="margin-top:10px">Explicación</h3><p class="hint">'+esc(src)+'</p>'+
    (e.missing.length?'<ul class="tasks hint">'+e.missing.map(m=>'<li>'+esc(m)+'</li>').join('')+'</ul>':'')+
    '<div style="margin-top:14px"><button class="btn" id="bk-from-est">Generar desglose de actuaciones previstas</button></div>';
  const bb=document.getElementById('bk-from-est');
  if(bb) bb.addEventListener('click',breakdownFromEstimate);
}
function renderRefs(){
  const rows=DATA.refs.filter(r=>r.n>0).sort((a,b)=>b.n-a.n).map(r=>
    '<tr><td>'+esc(r.area)+'</td><td><span class="pill p-gold">'+(MODEL_LABEL[r.model]||r.model||'—')+'</span></td><td class="num">'+r.n+'</td>'+
    '<td class="num">'+money(r.p25,DATA.currency)+'</td><td class="num"><strong>'+money(r.median,DATA.currency)+'</strong></td>'+
    '<td class="num">'+money(r.p75,DATA.currency)+'</td><td class="num">'+(r.hourly!=null?money(r.hourly,DATA.currency)+'/h':'—')+'</td></tr>').join('');
  document.getElementById('refsTable').innerHTML='<table><thead><tr><th>Área</th><th>Modelo</th><th class="num">Acuerdos</th><th class="num">P25</th><th class="num">Típico</th><th class="num">P75</th><th class="num">Tarifa/h</th></tr></thead><tbody>'+rows+'</tbody></table>';
  renderPropRefs();
}
/* Tabla "Tus propuestas por área": una fila por área (incluidas las nuevas que no estaban en el histórico). */
function renderPropRefs(){
  const box=document.getElementById('propRefsTable'); if(!box) return;
  const lp=prLoad();
  const areas=[...new Set(lp.map(p=>p.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  if(!areas.length){ box.innerHTML='<p class="hint">Aún no hay propuestas. Cuando añadas alguna en la pestaña “Propuestas”, su área aparecerá aquí — y si es un área nueva, se creará automáticamente.</p>'; return; }
  const known=new Set([...Object.keys(DATA.est||{}).filter(a=>a!=='unknown'), ...DATA.refs.filter(r=>r.n>0).map(r=>r.area)]);
  const rows=areas.map(area=>{
    const items=lp.filter(p=>p.area===area);
    const lh=items.map(p=>parseFloat(p.hours)).filter(h=>h>0), lf=items.map(p=>parseFloat(p.fee)).filter(f=>f>0);
    const mh=prMedian(lh), mf=prMedian(lf);
    const badge=known.has(area)?'<span class="pill p-muted">afina histórico</span>':'<span class="pill p-gold">nueva área</span>';
    return '<tr><td>'+esc(area)+' '+badge+'</td><td class="num">'+items.length+'</td><td class="num">'+(mh!=null?r1(mh)+' h':'—')+'</td><td class="num">'+(mf!=null?'<strong>'+money(mf,DATA.currency)+'</strong>':'—')+'</td><td class="rowact"><button data-delarea="'+esc(area)+'" title="Borrar todas las propuestas de esta área">✕ Borrar área</button></td></tr>';
  }).join('');
  box.innerHTML='<table><thead><tr><th>Área</th><th class="num">Propuestas</th><th class="num">Horas típicas</th><th class="num">Honorario típico</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
  box.querySelectorAll('[data-delarea]').forEach(btn=>btn.addEventListener('click',()=>{
    const area=btn.getAttribute('data-delarea');
    const n=prLoad().filter(p=>p.area===area).length;
    if(confirm('¿Borrar las '+n+' propuesta(s) del área “'+area+'”? No afecta al histórico.')){ prSaveAll(prLoad().filter(p=>p.area!==area)); refreshAreaSelects(); renderRefs(); }
  }));
}
document.getElementById('baseRate').textContent=DATA.baseRate+' €/h';
(function(){const areas=['No estoy seguro','Marcas','Propiedad intelectual','Contratos mercantiles','Constitución de sociedades','Compliance','Protección de datos','Litigios','Due diligence','Consultoría regulatoria','Laboral','Fiscal','Revisión documental','Redacción de informes','Otros'];
  Object.keys(DATA.est||{}).forEach(a=>{if(!areas.includes(a)&&a!=='unknown')areas.push(a);});
  document.getElementById('area').innerHTML=areas.map(a=>'<option>'+esc(a)+'</option>').join('');})();
document.getElementById('go').addEventListener('click',()=>renderResult(estimate({
  desc:document.getElementById('desc').value, area:document.getElementById('area').value,
  urg:document.getElementById('urg').value, cplx:document.getElementById('cplx').value,
  rate:parseFloat(document.getElementById('rate').value)||0})));
document.querySelectorAll('nav.tabs button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  document.getElementById('view-describe').classList.toggle('hide',b.dataset.view!=='describe');
  document.getElementById('view-breakdown').classList.toggle('hide',b.dataset.view!=='breakdown');
  document.getElementById('view-refs').classList.toggle('hide',b.dataset.view!=='refs');
  document.getElementById('view-props').classList.toggle('hide',b.dataset.view!=='props');
  if(b.dataset.view==='refs') renderRefs();
  if(b.dataset.view==='breakdown') bkRenderSaved();
  if(b.dataset.view==='props') prRenderList();
  if(b.dataset.view==='describe'||b.dataset.view==='breakdown') refreshAreaSelects();}));

/* =================== Desglose de actuaciones (offline) =================== */
const BK_VALUE_LABELS={high:'Aportación Alta de Valor',medium:'Aportación Media de Valor',low:'Aportación Baja de Valor'};
const BK_PROFILES=['socio','asociado senior','asociado','junior','paralegal','equipo mixto','no determinado'];
const BK_VALUE_OPTS=[['high','Alta'],['medium','Media'],['low','Baja']];
const BK_FILTERS=[['all','Ver todas'],['high','Alta aportación'],['medium','Media aportación'],['low','Baja aportación'],['client','Cliente visible'],['internal','Interno']];
const bkNorm=s=>stripAccents(s||'').replace(/\\s+/g,' ');
const bkHalf=n=>Math.round(n*2)/2;
const bkUid=p=>p+'_'+Math.random().toString(36).slice(2,11);

const BK_RULES=[
 {level:'high',concept:'estrategia',patterns:['estrategia','estrategic','diseno de estrategia'],reason:'Diseño de la estrategia jurídica: define el rumbo del mandato y condiciona el resultado.',deliverable:'Nota de estrategia jurídica',profile:'socio'},
 {level:'high',concept:'negociacion',patterns:['negociac','negociar','reunion de negociacion'],reason:'Negociación de cláusulas o condiciones críticas frente a la contraparte.',deliverable:'Acuerdo / acta de negociación',profile:'socio'},
 {level:'high',concept:'riesgos',patterns:['analisis de riesgo','riesgos relevantes','riesgo','contingencia','contingencias'],reason:'Análisis de riesgos y contingencias materiales del mandato.',deliverable:'Informe de riesgos',profile:'asociado senior'},
 {level:'high',concept:'regulatorio',patterns:['impacto regulatorio','regulatori','cumplimiento normativo'],reason:'Revisión del impacto regulatorio aplicable.',deliverable:'Memorando regulatorio',profile:'asociado senior'},
 {level:'high',concept:'due_diligence',patterns:['due diligence','auditoria legal','revision legal de la sociedad'],reason:'Due diligence: análisis sustantivo de contingencias.',deliverable:'Informe de due diligence',profile:'asociado senior'},
 {level:'high',concept:'redaccion',patterns:['redacc','redactar','minuta','elaboracion del contrato','term sheet','pacto de socios'],reason:'Redacción de los documentos jurídicos principales del mandato.',deliverable:'Documento jurídico redactado',profile:'asociado senior'},
 {level:'high',concept:'dictamen',patterns:['dictamen','informe juridico','opinion legal','memorandum','informe'],reason:'Preparación de un informe / dictamen jurídico sustantivo.',deliverable:'Dictamen jurídico',profile:'asociado senior'},
 {level:'high',concept:'defensa',patterns:['demanda','contestacion','recurso','querella','defensa','juicio','vista','audiencia','alegaciones','medidas cautelares'],reason:'Defensa y posicionamiento procesal frente a la contraparte.',deliverable:'Escrito procesal',profile:'socio'},
 {level:'high',concept:'decision',patterns:['toma de decision','decision juridica','estructuracion','estructura de la operacion'],reason:'Toma de decisiones jurídicas complejas / estructuración.',deliverable:'Recomendación estructurada',profile:'socio'},
 {level:'medium',concept:'revision',patterns:['revision documental','revision de documento','revisar documenta','revision de contrato','revisar el contrato','revision de borrador','revision'],reason:'Revisión documental estándar.',deliverable:'Documento revisado con comentarios',profile:'asociado'},
 {level:'medium',concept:'comentarios',patterns:['comentarios','comentar','marcar cambios'],reason:'Comentarios sobre borradores.',deliverable:'Borrador comentado',profile:'asociado'},
 {level:'medium',concept:'checklist',patterns:['checklist','lista de comprobacion'],reason:'Preparación de checklist.',deliverable:'Checklist',profile:'asociado'},
 {level:'medium',concept:'coordinacion',patterns:['coordinacion','coordinar','interlocucion','reunion con el cliente','reunion','llamada con el cliente'],reason:'Coordinación e interlocución con el cliente.',deliverable:'Seguimiento de coordinación',profile:'asociado'},
 {level:'medium',concept:'recopilacion',patterns:['recopilacion','recopilar','organizar informacion','organizacion de informacion','solicitud de informacion'],reason:'Recopilación y organización de información.',deliverable:'Información organizada',profile:'asociado'},
 {level:'medium',concept:'antecedentes',patterns:['antecedentes','analisis preliminar','revision preliminar'],reason:'Análisis preliminar de antecedentes.',deliverable:'Nota de antecedentes',profile:'asociado'},
 {level:'medium',concept:'cronograma',patterns:['cronograma','calendario de trabajo','plan de trabajo','planificacion'],reason:'Preparación de cronograma de trabajo.',deliverable:'Cronograma',profile:'asociado'},
 {level:'medium',concept:'seguimiento',patterns:['seguimiento de cambios','control de cambios','version revisada','entregar version','seguimiento procesal','seguimiento'],reason:'Seguimiento de cambios y del estado del trabajo.',deliverable:'Estado actualizado',profile:'asociado'},
 {level:'low',concept:'administrativo',patterns:['administrativ','gestion administrativa','tramite','gestiones'],reason:'Tarea administrativa, sin contenido jurídico sustantivo.',deliverable:'Gestión interna',profile:'paralegal'},
 {level:'low',concept:'formateo',patterns:['formateo','formatear','formato del documento','maquetacion'],reason:'Formateo / maquetación de documentos.',deliverable:'Documento formateado',profile:'paralegal'},
 {level:'low',concept:'comunicaciones',patterns:['envio de comunicaciones','enviar correo','envio de email','comunicacion simple','remitir'],reason:'Envío de comunicaciones simples.',deliverable:'Comunicación enviada',profile:'paralegal'},
 {level:'low',concept:'anexos',patterns:['anexos','adjuntar anexos','organizacion de anexos'],reason:'Organización de anexos.',deliverable:'Anexos organizados',profile:'paralegal'},
 {level:'low',concept:'carga',patterns:['carga de documentos','subir documentos','cargar archivos','escaneo','escanear'],reason:'Carga / escaneo de documentos.',deliverable:'Documentos cargados',profile:'paralegal'},
 {level:'low',concept:'revision_formal',patterns:['revision formal','revision no sustantiva','comprobacion formal'],reason:'Revisión formal no sustantiva.',deliverable:'Verificación formal',profile:'paralegal'},
 {level:'low',concept:'archivo',patterns:['archivo documental','archivar','archivo de actas','archivo'],reason:'Archivo documental.',deliverable:'Expediente archivado',profile:'paralegal'},
 {level:'low',concept:'tablas',patterns:['tabla interna','actualizacion de tablas','actualizar tabla'],reason:'Actualización de tablas internas.',deliverable:'Tabla interna actualizada',profile:'paralegal'},
 {level:'low',concept:'versiones',patterns:['control de versiones'],reason:'Control de versiones no estratégico.',deliverable:'Versionado',profile:'paralegal'}
];
const BK_DEFAULT={level:'medium',concept:'generico',patterns:[],reason:'Actuación jurídica de apoyo; valoración media por defecto (revisable por el equipo).',deliverable:'Entregable interno',profile:'asociado'};
function bkClassify(text){const n=bkNorm(text);for(const r of BK_RULES){if(r.patterns.some(p=>n.includes(p)))return r;}return BK_DEFAULT;}
const BK_TEMPLATES={
 concursal:['Análisis de la insolvencia y diseño de la estrategia concursal','Redacción de la solicitud de concurso y documentación asociada','Análisis de riesgos y contingencias del concurso','Comunicación y coordinación con la administración concursal','Recopilación y organización de la documentación contable','Gestión administrativa y archivo del expediente'],
 ma:['Diseño de la estructura de la operación y estrategia','Due diligence legal de la sociedad objetivo','Negociación y redacción del SPA y contratos accesorios','Revisión documental del data room','Coordinación con el cliente y otros asesores','Organización del data room y anexos'],
 laboral:['Análisis del caso y estrategia procesal laboral','Redacción de la demanda o carta de despido','Preparación y defensa en el juicio','Recopilación de la documentación laboral','Coordinación con el cliente','Gestión administrativa del expediente'],
 procesal_civil:['Análisis del asunto y estrategia procesal','Redacción de demanda, contestación y escritos','Preparación de la defensa y la vista','Revisión de documentación y antecedentes','Seguimiento procesal y de plazos','Gestión administrativa del expediente'],
 procesal_penal:['Diseño de la estrategia de defensa penal','Redacción de escritos de defensa o querella','Defensa en diligencias y juicio','Análisis de antecedentes e instrucción','Coordinación con el cliente','Gestión administrativa del expediente'],
 contratos:['Análisis del encargo y estrategia contractual','Redacción del contrato principal','Negociación de las cláusulas críticas','Revisión de borradores y comentarios','Coordinación con el cliente','Formateo y control de versiones del documento'],
 compliance:['Análisis de riesgos y diseño del programa de compliance','Redacción de políticas y procedimientos','Revisión del marco regulatorio aplicable','Preparación de checklist de cumplimiento','Coordinación con el cliente','Gestión administrativa y archivo documental'],
 datos:['Análisis de cumplimiento RGPD y estrategia','Redacción de cláusulas, contratos de encargo y políticas','Evaluación de impacto y análisis de riesgos (EIPD)','Revisión documental y checklist de privacidad','Coordinación con el cliente','Gestión administrativa del expediente'],
 regulatorio:['Análisis regulatorio y estrategia','Redacción de solicitudes de autorización y memorandos','Revisión de impacto regulatorio','Recopilación de información y documentación','Coordinación con el supervisor y el cliente','Gestión administrativa del expediente'],
 reestructuraciones:['Análisis financiero-jurídico y estrategia de reestructuración','Negociación con acreedores y diseño del plan','Redacción del plan o acuerdo de refinanciación','Revisión documental de la deuda','Coordinación con asesores y cliente','Gestión administrativa del expediente'],
 startups:['Asesoramiento en la estructura y estrategia de la ronda','Redacción del term sheet y el pacto de socios','Negociación con inversores','Revisión documental y checklist','Coordinación con los fundadores','Gestión administrativa y constitución'],
 energias:['Análisis del proyecto y estrategia','Redacción y negociación del PPA y contratos','Revisión de permisos y autorizaciones','Due diligence del proyecto','Coordinación con el cliente','Gestión administrativa del expediente'],
 secretarias:['Asesoramiento al consejo y estrategia de gobierno','Redacción de actas y acuerdos','Revisión de la documentación del consejo','Coordinación con los consejeros','Gestión administrativa y archivo de actas'],
 default:['Análisis del asunto y definición de la estrategia','Redacción y revisión de los documentos principales','Coordinación e interlocución con el cliente','Recopilación y organización de la información','Gestión administrativa del expediente']
};
function bkPickTemplate(cat){const c=bkNorm(cat);const map=[['concursal','concursal'],['m&a','ma'],['fusion','ma'],['adquisic','ma'],['due diligence','ma'],['laboral','laboral'],['penal','procesal_penal'],['civil','procesal_civil'],['litig','procesal_civil'],['procesal','procesal_civil'],['arbitraje','procesal_civil'],['contrato','contratos'],['mercantil','contratos'],['corporativ','contratos'],['societ','contratos'],['compliance','compliance'],['dato','datos'],['rgpd','datos'],['privacidad','datos'],['regulatori','regulatorio'],['financ','regulatorio'],['mica','regulatorio'],['mifid','regulatorio'],['reestructur','reestructuraciones'],['refinanc','reestructuraciones'],['startup','startups'],['ronda','startups'],['inversion','startups'],['energi','energias'],['renovable','energias'],['ppa','energias'],['consejo','secretarias'],['secretari','secretarias']];for(const[n,k]of map){if(c.includes(n))return BK_TEMPLATES[k];}return BK_TEMPLATES.default;}
function bkPhaseRank(level,concept){if(level==='low')return 4;if(level==='medium')return 3;if(['estrategia','riesgos','due_diligence','regulatorio','antecedentes','decision'].includes(concept))return 1;return 2;}
function bkActionConf(d){if(d.source==='task')return d.rule===BK_DEFAULT?'low':(d.rule.level==='high'?'high':'medium');if(d.source==='crosscut')return 'medium';return 'low';}
function bkDedupe(texts){const seen=new Set(),out=[];for(const t of texts){const k=bkNorm(t).trim();if(k.length<3||seen.has(k))continue;seen.add(k);out.push(t.trim());}return out;}
function bkCap(s){const t=(s||'').trim();return t?t.charAt(0).toUpperCase()+t.slice(1):t;}

function bkGenerate(input){
  const id=bkUid('brk'),cur=input.currency||'EUR';
  const assumptions=[],missing=[],warnings=[];
  const tasks=bkDedupe(input.tasks||[]);
  const drafts=tasks.map(t=>({title:bkCap(t),description:t,rule:bkClassify(t),source:'task'}));
  const usedTemplate=drafts.length<2;
  if(usedTemplate){
    const present=new Set(drafts.map(d=>bkNorm(d.title)));
    for(const title of bkPickTemplate(input.service_category)){if(present.has(bkNorm(title)))continue;drafts.push({title,description:title,rule:bkClassify(title),source:'template'});}
    assumptions.push('Desglose PRELIMINAR basado en las actuaciones típicas del área; la descripción no aportaba suficiente detalle para personalizarlo.');
    missing.push('La descripción del mandato es breve: conviene detallar el alcance real para afinar las actuaciones.');
  }else{
    const hasM=drafts.some(d=>d.rule.level==='medium'),hasL=drafts.some(d=>d.rule.level==='low');
    if(!hasM)drafts.push({title:'Coordinación e interlocución con el cliente',description:'Coordinación e interlocución con el cliente a lo largo del mandato.',rule:bkClassify('coordinacion'),source:'crosscut'});
    if(!hasL)drafts.push({title:'Gestión administrativa del expediente',description:'Gestión administrativa y documental del expediente.',rule:bkClassify('gestion administrativa'),source:'crosscut'});
    if(!hasM||!hasL)assumptions.push('Se han añadido actuaciones transversales habituales (coordinación con el cliente y/o gestión administrativa) para reflejar el reparto real de valor.');
  }
  drafts.sort((a,b)=>bkPhaseRank(a.rule.level,a.rule.concept)-bkPhaseRank(b.rule.level,b.rule.concept));
  const W={high:3,medium:2,low:1};
  let totalHours=(input.estimated_total_hours!=null&&input.estimated_total_hours>0)?input.estimated_total_hours:null;
  const rate=(input.rate_used&&input.rate_used>0)?input.rate_used:DATA.baseRate;
  if(totalHours==null&&input.estimated_total_fee>0)totalHours=bkHalf(input.estimated_total_fee/rate);
  const totalFee=(input.estimated_total_fee!=null&&input.estimated_total_fee>0)?input.estimated_total_fee:null;
  const weights=drafts.map(d=>W[d.rule.level]),sumW=weights.reduce((a,b)=>a+b,0)||1;
  let rec=drafts.map(()=>null);
  if(totalHours!=null){
    rec=drafts.map((_,i)=>Math.max(0.5,bkHalf(totalHours*weights[i]/sumW)));
    const diff=r2(totalHours-rec.reduce((a,b)=>a+b,0));
    if(Math.abs(diff)>=0.5){let m=0;for(let i=1;i<rec.length;i++)if(rec[i]>rec[m])m=i;rec[m]=Math.max(0.5,bkHalf(rec[m]+diff));}
  }else missing.push('No hay horas totales estimadas: no se pueden distribuir horas por actuación.');
  const sumRec=rec.reduce((a,b)=>a+(b||0),0);
  let fee=drafts.map(()=>null);
  if(totalFee!=null){
    fee=sumRec>0?rec.map(h=>r2(totalFee*(h||0)/sumRec)):weights.map(w=>r2(totalFee*w/sumW));
    const df=r2(totalFee-fee.reduce((a,b)=>a+(b||0),0));
    if(Math.abs(df)>=0.01){let m=0;for(let i=1;i<fee.length;i++)if(fee[i]>fee[m])m=i;fee[m]=r2(fee[m]+df);}
  }else missing.push('No hay honorario total estimado: no se puede imputar honorario por actuación.');
  const actions=drafts.map((d,i)=>{const rc=rec[i],low=d.rule.level==='low';return{
    id:bkUid('pa'),breakdown_id:id,action_title:d.title,action_description:d.description,value_level:d.rule.level,value_label:BK_VALUE_LABELS[d.rule.level],
    reason_for_value_level:d.rule.reason,estimated_hours_min:rc!=null?Math.max(0.5,bkHalf(rc*0.8)):null,estimated_hours_recommended:rc,estimated_hours_max:rc!=null?bkHalf(rc*1.3):null,
    related_fee_portion:fee[i],sequence_order:i+1,depends_on:[],deliverable:d.rule.deliverable,responsible_profile:d.rule.profile,client_visible:!low,internal_only:low,confidence_level:bkActionConf(d)};});
  if(totalHours!=null){const s=r2(actions.reduce((a,x)=>a+(x.estimated_hours_recommended||0),0));if(Math.abs(s-totalHours)>Math.max(0.5,totalHours*0.02))warnings.push('Las horas por actuación ('+s+' h) no cuadran con las horas totales estimadas ('+totalHours+' h). Revisa el reparto.');}
  if(usedTemplate)warnings.push('Desglose preliminar (confianza baja): revísalo y complétalo con el equipo antes de usarlo.');
  if(bkNorm(input.service_category).includes('otros')||!input.service_category)missing.push('El servicio no se ha podido clasificar con certeza: confirma el área para afinar las actuaciones.');
  assumptions.push('Las horas se han repartido entre las actuaciones de forma proporcional a su aportación de valor; ajústalas al caso real.');
  assumptions.push('Los perfiles responsables son una sugerencia orientativa y deben confirmarse.');
  const desc=(input.description||'').trim()||null;
  const head=input.service_category+(input.service_subcategory?' – '+input.service_subcategory:'');
  const summary=desc?(head+': '+(desc.length>220?desc.slice(0,217)+'…':desc)):(head+': '+(input.source_type==='manual_calculation'?'cálculo manual de honorarios (sin descripción de caso).':'mandato sin descripción detallada.'));
  const now=new Date().toISOString();
  return{id,case_or_calculation_id:input.case_or_calculation_id||null,source_type:input.source_type||'automatic_estimate',service_category:input.service_category,service_subcategory:input.service_subcategory||null,
    mandate_summary:summary,description:desc,planned_actions:actions,value_distribution:bkDist(actions),estimated_total_hours:totalHours,estimated_total_fee:totalFee,currency:cur,rate_used:rate,
    complexity_level:input.complexity_level||'unknown',urgency_level:input.urgency_level||'unknown',assumptions,missing_information:missing,warnings,created_at:now,created_by:'usuario_interno',updated_at:now};
}
function bkDist(a){return{high_value_count:a.filter(x=>x.value_level==='high').length,medium_value_count:a.filter(x=>x.value_level==='medium').length,low_value_count:a.filter(x=>x.value_level==='low').length};}
function bkRedistributeFees(b){const tf=b.estimated_total_fee;if(tf==null||tf<=0||!b.planned_actions.length)return;const s=b.planned_actions.reduce((a,x)=>a+(x.estimated_hours_recommended||0),0);if(s<=0)return;b.planned_actions.forEach(a=>{a.related_fee_portion=r2(tf*(a.estimated_hours_recommended||0)/s);});const d=r2(tf-b.planned_actions.reduce((a,x)=>a+(x.related_fee_portion||0),0));if(Math.abs(d)>=0.01){let m=0;for(let i=1;i<b.planned_actions.length;i++)if((b.planned_actions[i].related_fee_portion||0)>(b.planned_actions[m].related_fee_portion||0))m=i;b.planned_actions[m].related_fee_portion=r2((b.planned_actions[m].related_fee_portion||0)+d);}}
function bkRecomputeWarnings(b){const kept=(b.warnings||[]).filter(w=>!w.startsWith('Las horas por actuación')&&!w.startsWith('El honorario imputado'));const out=kept.slice();if(b.estimated_total_hours!=null&&b.estimated_total_hours>0){const s=r2(b.planned_actions.reduce((a,x)=>a+(x.estimated_hours_recommended||0),0));if(Math.abs(s-b.estimated_total_hours)>Math.max(0.5,b.estimated_total_hours*0.02))out.push('Las horas por actuación ('+s+' h) no cuadran con las horas totales estimadas ('+b.estimated_total_hours+' h). Revisa el reparto.');}return out;}

/* ---- persistencia en localStorage ---- */
const BK_LS='ilp_breakdowns_v1';
function bkLoadAll(){try{return JSON.parse(localStorage.getItem(BK_LS)||'[]');}catch(e){return[];}}
function bkSaveAll(a){try{localStorage.setItem(BK_LS,JSON.stringify(a));}catch(e){alert('No se pudo guardar (almacenamiento del navegador lleno o bloqueado).');}}
function bkSave(b){const a=bkLoadAll();const i=a.findIndex(x=>x.id===b.id);if(i>=0)a[i]=b;else a.unshift(b);bkSaveAll(a);return b;}
function bkGet(id){return bkLoadAll().find(x=>x.id===id)||null;}
function bkDelete(id){bkSaveAll(bkLoadAll().filter(x=>x.id!==id));}

/* ---- estado UI ---- */
let BK_CUR=null,BK_FILTER='all';
function bkOverallConf(b){if((b.assumptions||[]).some(a=>/PRELIMINAR/i.test(a)))return 'low';const s={low:0,medium:0,high:0};(b.planned_actions||[]).forEach(a=>s[a.confidence_level]++);if(s.high>=s.medium&&s.high>=s.low)return 'high';if(s.low>s.medium&&s.low>s.high)return 'low';return 'medium';}

function breakdownFromEstimate(){
  const e=window.LAST_EST;if(!e){alert('Primero genera una estimación.');return;}
  const b=bkGenerate({source_type:'automatic_estimate',service_category:e.area,service_subcategory:e.sub||null,
    description:document.getElementById('desc').value.trim()||null,tasks:e.tasks||[],estimated_total_hours:e.hRec,estimated_total_fee:e.feeRec,currency:DATA.currency,rate_used:e.rate,
    complexity_level:document.getElementById('cplx').value,urgency_level:document.getElementById('urg').value});
  bkSave(b);BK_CUR=b.id;
  document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view==='breakdown'));
  document.getElementById('view-describe').classList.add('hide');document.getElementById('view-refs').classList.add('hide');document.getElementById('view-breakdown').classList.remove('hide');
  bkRenderSaved();bkRenderEditor();document.getElementById('bk-editor').scrollIntoView({behavior:'smooth',block:'start'});
}
function bkGenerateFromForm(){
  const desc=document.getElementById('bk-desc').value.trim();
  if(!desc){alert('Describe el trabajo para generar el desglose.');return;}
  const est=estimate({desc,area:document.getElementById('bk-area').value,urg:document.getElementById('bk-urg').value,cplx:document.getElementById('bk-cplx').value,rate:parseFloat(document.getElementById('bk-rate').value)||0});
  if(est.needs){alert('La descripción es demasiado breve: añade tareas concretas, alcance y documentos.');return;}
  const b=bkGenerate({source_type:'automatic_estimate',service_category:est.area,service_subcategory:est.sub||null,description:desc,tasks:est.tasks,estimated_total_hours:est.hRec,estimated_total_fee:est.feeRec,currency:DATA.currency,rate_used:est.rate,complexity_level:document.getElementById('bk-cplx').value,urgency_level:document.getElementById('bk-urg').value});
  bkSave(b);BK_CUR=b.id;bkRenderSaved();bkRenderEditor();document.getElementById('bk-editor').scrollIntoView({behavior:'smooth',block:'start'});
}
function bkRenderSaved(){
  const box=document.getElementById('bk-saved');if(!box)return;const all=bkLoadAll();
  if(!all.length){box.innerHTML='<p class="hint">Aún no hay desgloses guardados en este navegador.</p>';return;}
  box.innerHTML='<h3>Desgloses guardados</h3><table><thead><tr><th>Fecha</th><th>Servicio</th><th class="num">Actuac.</th><th>A/M/B</th><th class="num">Honorario</th><th></th></tr></thead><tbody>'+
    all.map(b=>{const d=b.value_distribution||{};return '<tr><td class="hint">'+new Date(b.created_at).toLocaleDateString('es-ES')+'</td><td>'+esc(b.service_category||'—')+(b.service_subcategory?' <span class="muted">/ '+esc(b.service_subcategory)+'</span>':'')+'</td><td class="num">'+(b.planned_actions||[]).length+'</td><td>A'+(d.high_value_count||0)+' · M'+(d.medium_value_count||0)+' · B'+(d.low_value_count||0)+'</td><td class="num">'+(b.estimated_total_fee!=null?money(b.estimated_total_fee,b.currency):'—')+'</td><td><button class="btn btn-sm" data-open="'+esc(b.id)+'">Abrir</button> <button class="btn btn-sm btn-ghost" data-del="'+esc(b.id)+'">✕</button></td></tr>';}).join('')+'</tbody></table>';
  box.querySelectorAll('[data-open]').forEach(el=>el.addEventListener('click',()=>{BK_CUR=el.getAttribute('data-open');BK_FILTER='all';bkRenderEditor();document.getElementById('bk-editor').scrollIntoView({behavior:'smooth',block:'start'});}));
  box.querySelectorAll('[data-del]').forEach(el=>el.addEventListener('click',()=>{if(confirm('¿Eliminar este desglose guardado?')){bkDelete(el.getAttribute('data-del'));if(BK_CUR===el.getAttribute('data-del')){BK_CUR=null;document.getElementById('bk-editor').innerHTML='';}bkRenderSaved();}}));
}
function bkRenderEditor(){
  const ed=document.getElementById('bk-editor');const b=BK_CUR?bkGet(BK_CUR):null;
  if(!b){ed.innerHTML='';return;}
  const d=b.value_distribution||{},conf=bkOverallConf(b);
  ed.innerHTML='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">Desglose · '+esc(b.service_category||'—')+'</h2><span class="hint mono">'+esc(b.id)+'</span></div>'+
    '<dl class="kv"><dt>Servicio</dt><dd>'+esc(b.service_category||'—')+(b.service_subcategory?' <span class="muted">/ '+esc(b.service_subcategory)+'</span>':'')+'</dd>'+
    '<dt>Mandato</dt><dd>'+esc(b.mandate_summary||'—')+'</dd>'+
    '<dt>Horas totales</dt><dd>'+(b.estimated_total_hours!=null?b.estimated_total_hours+' h':'—')+'</dd>'+
    '<dt>Honorario sugerido</dt><dd>'+(b.estimated_total_fee!=null?money(b.estimated_total_fee,b.currency):'—')+'</dd>'+
    '<dt>Nivel de confianza</dt><dd>'+confSpan(conf)+'</dd></dl>'+
    '<div class="dist"><div class="d high"><div class="n">'+(d.high_value_count||0)+'</div><div class="hint">Alta aportación</div></div><div class="d medium"><div class="n">'+(d.medium_value_count||0)+'</div><div class="hint">Media aportación</div></div><div class="d low"><div class="n">'+(d.low_value_count||0)+'</div><div class="hint">Baja aportación</div></div></div>'+
    (b.warnings&&b.warnings.length?'<div class="alert a-warn"><span class="i">⚠</span><div><strong>Avisos</strong><ul class="tasks">'+b.warnings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul></div></div>':'')+
    '<div class="chips">'+BK_FILTERS.map(f=>'<button class="chip'+(f[0]===BK_FILTER?' active':'')+'" data-filter="'+f[0]+'">'+f[1]+'</button>').join('')+'</div>'+
    '<div class="bk-table" id="bk-actions"></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn btn-sm" id="bk-add">+ Añadir actuación</button><button class="btn" id="bk-save">Guardar versión</button><button class="btn" id="bk-word">Exportar a Word</button><button class="btn btn-sm btn-ghost" id="bk-delete">Eliminar desglose</button></div>'+
    (b.assumptions&&b.assumptions.length?'<h3 style="margin-top:14px">Supuestos utilizados</h3><ul class="tasks hint">'+b.assumptions.map(a=>'<li>'+esc(a)+'</li>').join('')+'</ul>':'')+
    (b.missing_information&&b.missing_information.length?'<h3 style="margin-top:12px">Información pendiente o no confirmada</h3><ul class="tasks hint">'+b.missing_information.map(m=>'<li>'+esc(m)+'</li>').join('')+'</ul>':'')+
    '</div>';
  bkRenderActions(b.planned_actions||[]);
  ed.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>{BK_FILTER=ch.getAttribute('data-filter');ed.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active',x===ch));bkApplyFilter();}));
  ed.querySelector('#bk-add').addEventListener('click',bkAddAction);
  ed.querySelector('#bk-save').addEventListener('click',()=>bkSaveCurrent(false));
  ed.querySelector('#bk-word').addEventListener('click',bkExportWord);
  ed.querySelector('#bk-delete').addEventListener('click',()=>{if(confirm('¿Eliminar este desglose?')){bkDelete(b.id);BK_CUR=null;ed.innerHTML='';bkRenderSaved();}});
}
function bkRow(a,i){const vs=BK_VALUE_OPTS.map(o=>'<option value="'+o[0]+'"'+(a.value_level===o[0]?' selected':'')+'>'+o[1]+'</option>').join('');const ps=BK_PROFILES.map(p=>'<option'+(a.responsible_profile===p?' selected':'')+'>'+esc(p)+'</option>').join('');
  return '<tr data-row data-id="'+esc(a.id||'')+'" data-conf="'+esc(a.confidence_level||'medium')+'">'+
   '<td class="num seq">'+(i+1)+'</td>'+
   '<td><input data-f="title" value="'+esc(a.action_title||'')+'"></td>'+
   '<td><textarea data-f="desc">'+esc(a.action_description||'')+'</textarea></td>'+
   '<td><select data-f="value">'+vs+'</select></td>'+
   '<td><input data-f="reason" value="'+esc(a.reason_for_value_level||'')+'"></td>'+
   '<td class="num bk-num"><input type="number" step="0.5" min="0" data-f="hours" value="'+(a.estimated_hours_recommended!=null?a.estimated_hours_recommended:'')+'"></td>'+
   '<td><select data-f="profile">'+ps+'</select></td>'+
   '<td><input data-f="deliv" value="'+esc(a.deliverable||'')+'"></td>'+
   '<td style="text-align:center"><input type="checkbox" data-f="cv"'+(a.client_visible?' checked':'')+'></td>'+
   '<td class="rowact" style="white-space:nowrap"><button data-act="up" title="Subir">↑</button><button data-act="down" title="Bajar">↓</button><button data-act="del" title="Eliminar">✕</button></td></tr>';}
function bkRenderActions(actions){
  const box=document.getElementById('bk-actions');
  if(!actions.length){box.innerHTML='<p class="hint">No hay actuaciones. Pulsa “Añadir actuación”.</p>';return;}
  box.innerHTML='<table><thead><tr><th class="num">Nº</th><th>Actuación prevista</th><th>Descripción</th><th>Aportación de valor</th><th>Motivo de la valoración</th><th class="num">Horas</th><th>Perfil responsable</th><th>Entregable</th><th>Visible</th><th>Acciones</th></tr></thead><tbody>'+actions.map((a,i)=>bkRow(a,i)).join('')+'</tbody></table>';
  box.querySelectorAll('tr[data-row]').forEach(tr=>{
    tr.querySelector('[data-act="up"]').addEventListener('click',()=>bkMove(tr,-1));
    tr.querySelector('[data-act="down"]').addEventListener('click',()=>bkMove(tr,1));
    tr.querySelector('[data-act="del"]').addEventListener('click',()=>{const a=bkReadActions();const idx=[...box.querySelectorAll('tr[data-row]')].indexOf(tr);a.splice(idx,1);bkRenderActions(a);bkApplyFilter();});
    tr.querySelector('[data-f="value"]').addEventListener('change',bkApplyFilter);
    tr.querySelector('[data-f="cv"]').addEventListener('change',bkApplyFilter);
  });
  bkApplyFilter();
}
function bkMove(tr,dir){const box=document.getElementById('bk-actions');const a=bkReadActions();const idx=[...box.querySelectorAll('tr[data-row]')].indexOf(tr);const j=idx+dir;if(j<0||j>=a.length)return;const t=a[idx];a[idx]=a[j];a[j]=t;bkRenderActions(a);}
function bkReadActions(){return [...document.querySelectorAll('#bk-actions tr[data-row]')].map((tr,i)=>{const g=f=>tr.querySelector('[data-f="'+f+'"]');const hv=g('hours').value.trim();const h=hv===''?null:Number(hv);const cv=g('cv').checked;return{id:tr.dataset.id||undefined,action_title:g('title').value,action_description:g('desc').value,value_level:g('value').value,reason_for_value_level:g('reason').value,estimated_hours_recommended:h,estimated_hours_min:h!=null?Math.max(0.5,bkHalf(h*0.8)):null,estimated_hours_max:h!=null?bkHalf(h*1.3):null,deliverable:g('deliv').value,responsible_profile:g('profile').value,client_visible:cv,internal_only:!cv,confidence_level:tr.dataset.conf||'medium',sequence_order:i+1};});}
function bkAddAction(){const a=bkReadActions();a.push({id:undefined,action_title:'Nueva actuación',action_description:'',value_level:'medium',reason_for_value_level:'',estimated_hours_recommended:null,deliverable:'',responsible_profile:'no determinado',client_visible:true,internal_only:false,confidence_level:'medium'});bkRenderActions(a);}
function bkApplyFilter(){const box=document.getElementById('bk-actions');if(!box)return;box.querySelectorAll('tr[data-row]').forEach(tr=>{const v=tr.querySelector('[data-f="value"]').value,cv=tr.querySelector('[data-f="cv"]').checked;let show=true;if(['high','medium','low'].includes(BK_FILTER))show=v===BK_FILTER;else if(BK_FILTER==='client')show=cv;else if(BK_FILTER==='internal')show=!cv;tr.style.display=show?'':'none';});let n=0;box.querySelectorAll('tr[data-row]').forEach(tr=>{if(tr.style.display!=='none'){n++;const s=tr.querySelector('.seq');if(s)s.textContent=n;}});}
function bkSaveCurrent(silent){const b=bkGet(BK_CUR);if(!b)return null;b.planned_actions=bkReadActions().map((a,i)=>{a.value_label=BK_VALUE_LABELS[a.value_level]||BK_VALUE_LABELS.medium;if(!a.id||String(a.id).indexOf('pa_')!==0)a.id=bkUid('pa');a.breakdown_id=b.id;a.depends_on=a.depends_on||[];a.sequence_order=i+1;return a;});bkRedistributeFees(b);b.value_distribution=bkDist(b.planned_actions);b.warnings=bkRecomputeWarnings(b);b.updated_at=new Date().toISOString();bkSave(b);if(!silent){bkRenderSaved();bkRenderEditor();}return b;}
function bkExportWord(){const b=bkSaveCurrent(true);if(!b)return;bkRenderSaved();bkRenderEditor();const{fileName,bytes}=bkBuildDocx(b);const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},600);}

/* ---- Word (.docx) generado en el navegador ---- */
const BK_NAVY='102542',BK_GOLD='A8842F',BK_GRAY='767E8C',BK_INK='1A1F2B';
const BK_CPLX={low:'Baja',medium:'Media',high:'Alta',unknown:'No determinada'},BK_URG={normal:'Normal',urgent:'Urgente',very_urgent:'Muy urgente',unknown:'No determinada'};
function xesc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function wRun(t,o){o=o||{};let r='';if(o.bold)r+='<w:b/>';if(o.italic)r+='<w:i/>';if(o.color)r+='<w:color w:val="'+o.color+'"/>';if(o.size)r+='<w:sz w:val="'+(o.size*2)+'"/><w:szCs w:val="'+(o.size*2)+'"/>';return '<w:r>'+(r?'<w:rPr>'+r+'</w:rPr>':'')+'<w:t xml:space="preserve">'+xesc(t)+'</w:t></w:r>';}
function wPara(runs,o){o=o||{};let p='';if(o.align)p+='<w:jc w:val="'+o.align+'"/>';if(o.before!=null||o.after!=null)p+='<w:spacing'+(o.before!=null?' w:before="'+o.before+'"':'')+(o.after!=null?' w:after="'+o.after+'"':'')+'/>';return '<w:p>'+(p?'<w:pPr>'+p+'</w:pPr>':'')+runs+'</w:p>';}
function wH(t){return wPara(wRun(t,{bold:true,color:BK_NAVY,size:15}),{before:240,after:100});}
function wBullet(t){return wPara(wRun('•  ',{color:BK_GOLD,bold:true})+wRun(t,{color:BK_INK,size:10}),{after:40});}
function wCell(runs,w,o){o=o||{};const shd=o.fill?'<w:shd w:val="clear" w:color="auto" w:fill="'+o.fill+'"/>':'';const pj=o.align?'<w:pPr><w:jc w:val="'+o.align+'"/></w:pPr>':'';return '<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/>'+shd+'<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tcMar></w:tcPr><w:p>'+pj+runs+'</w:p></w:tc>';}
const BK_COLS=[520,2500,3200,1500,3000,1100,1480,1900];
function bkVColor(l){return l==='high'?BK_NAVY:l==='medium'?BK_GOLD:BK_GRAY;}
function bkHoursText(a){if(a.estimated_hours_recommended==null)return '—';const mn=a.estimated_hours_min!=null?a.estimated_hours_min:a.estimated_hours_recommended,mx=a.estimated_hours_max!=null?a.estimated_hours_max:a.estimated_hours_recommended;return a.estimated_hours_recommended+' h ('+mn+'–'+mx+')';}
function bkDocXml(b){
  const cur=b.currency||'EUR',d=b.value_distribution||{};const body=[];
  body.push(wPara(wRun('Desglose de actuaciones previstas',{bold:true,color:BK_NAVY,size:22}),{align:'center',after:60}));
  body.push(wPara(wRun('Mandato: '+(b.mandate_summary||''),{italic:true,color:BK_GRAY,size:11}),{align:'center',after:40}));
  body.push(wPara(wRun('ILP Abogados',{color:BK_GOLD,bold:true,size:10})+wRun('   ·   Generado el '+new Date(b.created_at).toLocaleDateString('es-ES'),{color:BK_GRAY,size:10}),{align:'center',after:120}));
  body.push(wH('1. Resumen del mandato'));
  const fm=n=>n==null?'—':(function(){try{return new Intl.NumberFormat('es-ES',{style:'currency',currency:cur,maximumFractionDigits:0}).format(n);}catch(e){return n+' '+cur;}})();
  [['Servicio',b.service_category||'—'],['Subservicio',b.service_subcategory||'—'],['Descripción',b.description||'(sin descripción detallada)'],['Complejidad',BK_CPLX[b.complexity_level]||b.complexity_level],['Urgencia',BK_URG[b.urgency_level]||b.urgency_level],['Tarifa usada',b.rate_used?b.rate_used+' €/hora':'—'],['Honorario estimado',b.estimated_total_fee!=null?fm(b.estimated_total_fee):'—'],['Horas estimadas',b.estimated_total_hours!=null?b.estimated_total_hours+' h':'—']].forEach(kv=>body.push(wPara(wRun(kv[0]+': ',{bold:true,color:BK_NAVY,size:10})+wRun(kv[1],{color:BK_INK,size:10}),{after:30})));
  body.push(wH('2. Actuaciones previstas'));
  if(b.planned_actions.length){
    const hd=['Nº','Actuación prevista','Descripción','Aportación de valor','Motivo','Horas estimadas','Perfil responsable','Entregable'].map((t,i)=>wCell(wRun(t,{bold:true,color:'FFFFFF',size:9}),BK_COLS[i],{fill:BK_NAVY,align:i===0||i===5?'center':null})).join('');
    const rows=b.planned_actions.map((a,i)=>{const fill=i%2===1?'FBFAF6':null;return '<w:tr>'+[wCell(wRun(String(a.sequence_order||i+1),{size:9}),BK_COLS[0],{fill,align:'center'}),wCell(wRun(a.action_title,{bold:true,color:BK_INK,size:9}),BK_COLS[1],{fill}),wCell(wRun(a.action_description||'—',{size:9,color:BK_INK}),BK_COLS[2],{fill}),wCell(wRun(a.value_label,{bold:true,color:bkVColor(a.value_level),size:9}),BK_COLS[3],{fill}),wCell(wRun(a.reason_for_value_level||'—',{size:8,color:BK_GRAY}),BK_COLS[4],{fill}),wCell(wRun(bkHoursText(a),{size:9}),BK_COLS[5],{fill,align:'center'}),wCell(wRun(a.responsible_profile||'—',{size:9}),BK_COLS[6],{fill}),wCell(wRun(a.deliverable||'—',{size:9}),BK_COLS[7],{fill})].join('')+'</w:tr>';}).join('');
    const grid=BK_COLS.map(w=>'<w:gridCol w:w="'+w+'"/>').join('');const bd=['top','left','bottom','right','insideH','insideV'].map(s=>'<w:'+s+' w:val="single" w:sz="4" w:space="0" w:color="E4DDCB"/>').join('');
    body.push('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+bd+'</w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>'+grid+'</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>'+hd+'</w:tr>'+rows+'</w:tbl>');
  }else body.push(wPara(wRun('No se identificaron actuaciones.',{italic:true,color:BK_GRAY,size:10})));
  body.push(wH('3. Distribución de aportación de valor'));
  [['Aportación alta de valor','high',d.high_value_count||0],['Aportación media de valor','medium',d.medium_value_count||0],['Aportación baja de valor','low',d.low_value_count||0]].forEach(bl=>{body.push(wPara(wRun(bl[0]+': '+bl[2],{bold:true,color:bkVColor(bl[1]),size:11}),{before:80,after:30}));b.planned_actions.filter(a=>a.value_level===bl[1]).forEach(a=>body.push(wBullet(a.action_title)));});
  body.push(wH('4. Supuestos utilizados'));(b.assumptions.length?b.assumptions:['Sin supuestos registrados.']).forEach(a=>body.push(wBullet(a)));
  body.push(wH('5. Información pendiente o no confirmada'));(b.missing_information.length?b.missing_information:['No hay información pendiente registrada.']).forEach(m=>body.push(wBullet(m)));
  if(b.warnings.length){body.push(wH('Avisos'));b.warnings.forEach(w=>body.push(wBullet(w)));}
  body.push(wH('6. Nota final'));
  body.push(wPara(wRun('Este documento es un desglose preliminar de actuaciones previstas generado para fines internos de estimación de honorarios. Debe ser revisado por el equipo jurídico antes de ser enviado al cliente o utilizado como base definitiva de una propuesta.',{italic:true,color:BK_INK,size:10}),{before:60}));
  const sect='<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body.join('')+sect+'</w:body></w:document>';
}
const BK_STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="'+BK_INK+'"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
const BK_CT='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
const BK_RELS='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const BK_DRELS='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
function bkSlug(s){return (s||'mandato').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'mandato';}
function bkBuildDocx(b){const bytes=zipStore([{name:'[Content_Types].xml',data:BK_CT},{name:'_rels/.rels',data:BK_RELS},{name:'word/document.xml',data:bkDocXml(b)},{name:'word/styles.xml',data:BK_STYLES},{name:'word/_rels/document.xml.rels',data:BK_DRELS}]);return{fileName:'Desglose-actuaciones-'+bkSlug(b.service_category)+'-'+b.id.replace(/^brk_/,'')+'.docx',bytes};}

/* ---- ZIP (método STORE) en el navegador ---- */
const BK_CRC=(function(){const t=new Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(buf){let c=0xffffffff;for(let i=0;i<buf.length;i++)c=BK_CRC[(c^buf[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function u16(n){return new Uint8Array([n&0xff,(n>>8)&0xff]);}
function u32(n){return new Uint8Array([n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>>24)&0xff]);}
function cat(arr){let len=0;for(const a of arr)len+=a.length;const o=new Uint8Array(len);let p=0;for(const a of arr){o.set(a,p);p+=a.length;}return o;}
function zipStore(entries){const enc=new TextEncoder();const local=[],central=[];let offset=0;for(const e of entries){const name=enc.encode(e.name);const data=typeof e.data==='string'?enc.encode(e.data):e.data;const crc=crc32(data),size=data.length;const lh=cat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0x21),u32(crc),u32(size),u32(size),u16(name.length),u16(0),name,data]);local.push(lh);central.push(cat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0x21),u32(crc),u32(size),u32(size),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=lh.length;}const lb=cat(local),cb=cat(central);const eocd=cat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cb.length),u32(lb.length),u16(0)]);return cat([lb,cb,eocd]);}

/* ---- inicialización de la pestaña ---- */
(function(){const areas=['No estoy seguro'];Object.keys(DATA.est||{}).forEach(a=>{if(a!=='unknown')areas.push(a);});['Marcas','Contratos mercantiles','Litigios','Due diligence','Otros'].forEach(a=>{if(!areas.includes(a))areas.push(a);});
  const sel=document.getElementById('bk-area');if(sel)sel.innerHTML=areas.map(a=>'<option>'+esc(a)+'</option>').join('');})();
document.getElementById('bk-gen').addEventListener('click',bkGenerateFromForm);

/* =================== Propuestas (afinan la precisión, offline) =================== */
const PR_LS='ilp_proposals_v1', PR_USE_LS='ilp_proposals_use_v1';
const PR_AREAS=(function(){const s=[];DATA.classifier.forEach(c=>{if(!s.includes(c.category))s.push(c.category);});['Marcas','Propiedad intelectual','Contratos mercantiles','Constitución de sociedades','Protección de datos','Litigios','Due diligence','Consultoría regulatoria','Laboral','Fiscal','Revisión documental','Redacción de informes','Otros'].forEach(a=>{if(!s.includes(a))s.push(a);});return s.sort((a,b)=>a.localeCompare(b,'es'));})();
const PR_TEXT_EXT=['txt','csv','md','json','eml','html','htm'];
function prUid(){return 'pr_'+Math.random().toString(36).slice(2,10);}
function prLoad(){try{return JSON.parse(localStorage.getItem(PR_LS)||'[]');}catch(e){return[];}}
function prSaveAll(a){try{localStorage.setItem(PR_LS,JSON.stringify(a));}catch(e){alert('No se pudo guardar (almacenamiento del navegador lleno o bloqueado).');}}
function prUseEnabled(){return localStorage.getItem(PR_USE_LS)!=='0';}
function prSetUse(on){localStorage.setItem(PR_USE_LS,on?'1':'0');}
function prForArea(area){return prLoad().filter(p=>p.area===area);}
function prMedian(arr){if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function prPctl(arr,p){if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b),idx=(s.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);return lo===hi?s[lo]:s[lo]+(s[hi]-s[lo])*(idx-lo);}
/* Mezcla los datos del área con tus propuestas locales (más muestra = más precisión). */
function effAggregate(area){
  const base=DATA.est[area];
  if(!prUseEnabled())return base;
  const lp=prForArea(area);if(!lp.length)return base;
  const lh=lp.map(p=>parseFloat(p.hours)).filter(h=>h>0), lf=lp.map(p=>parseFloat(p.fee)).filter(f=>f>0);
  if(!lh.length&&!lf.length)return base;
  const out=base?Object.assign({},base):{nHours:0,hP25:null,hMed:null,hP75:null,nFee:0,fP25:null,fMed:null,fP75:null};
  if(lh.length){const lm=prMedian(lh),has=base&&base.nHours>0&&base.hMed>0,nH=has?base.nHours:0;
    out.hMed=r1(has?(nH*base.hMed+lh.length*lm)/(nH+lh.length):lm);const ratio=has?out.hMed/base.hMed:1;
    out.hP25=r1(has?base.hP25*ratio:prPctl(lh,0.25));out.hP75=r1(has?base.hP75*ratio:prPctl(lh,0.75));out.nHours=nH+lh.length;}
  if(lf.length){const lm=prMedian(lf),has=base&&base.nFee>0&&base.fMed>0,nF=has?base.nFee:0;
    out.fMed=r2(has?(nF*base.fMed+lf.length*lm)/(nF+lf.length):lm);const ratio=has?out.fMed/base.fMed:1;
    out.fP25=r2(has?base.fP25*ratio:prPctl(lf,0.25));out.fP75=r2(has?base.fP75*ratio:prPctl(lf,0.75));out.nFee=nF+lf.length;}
  out._local=lp.length;
  return out;
}
/* ---- Análisis automático del contenido de cada propuesta ---- */
const PR_DEFLATE_OK=(typeof DecompressionStream!=='undefined');
const PR_FEE_KW=/honorari|presupuesto|minuta|provisi[oó]n de fondos|base imponible|total a pagar|total\\b|importe|suma|coste|precio|iguala/i;
const PR_FEE_EXCLUDE=/(reclamaci|reclamad|cuant[ií]a|deuda|principal|importe de la operaci|valor de|capital social|indemnizaci|sanci[oó]n|multa|impagad|nominal|litig)/i;
const PR_FEE_CEILING=600000;
function prParseAmount(raw){let s=String(raw).replace(/\\s/g,'');
  if(/,\\d{2}$/.test(s))s=s.replace(/\\./g,'').replace(',','.');      // 12.500,50 -> 12500.50
  else if(/\\.\\d{2}$/.test(s)&&/,/.test(s))s=s.replace(/,/g,'');      // 12,500.50 -> 12500.50
  else s=s.replace(/[.,]/g,'');                                     // sin decimales
  const n=parseFloat(s);return isFinite(n)?n:null;}
function extractFee(text){
  const t=text.replace(/ /g,' ');
  const re=/(?:€|eur(?:os)?\\b\\.?\\s*)\\s*([\\d][\\d.,\\s]{1,13}\\d|\\d)|([\\d][\\d.,\\s]{1,13}\\d|\\d)\\s*(?:€|eur(?:os)?\\b)/gi;
  let m,best=null,bestScore=-1;
  while((m=re.exec(t))){const n=prParseAmount(m[1]||m[2]||'');if(n==null||n<100||n>PR_FEE_CEILING)continue;
    const ctx=t.slice(Math.max(0,m.index-45),m.index+(m[0].length)+15);
    if(PR_FEE_EXCLUDE.test(ctx))continue;
    let score=PR_FEE_KW.test(ctx)?10:0;score+=Math.min(n/10000,5);
    if(score>bestScore){bestScore=score;best=n;}}
  return best!=null?String(Math.round(best)):'';}
function extractHours(text){
  const t=text.replace(/ /g,' ');
  const re=/(\\d{1,4}(?:[.,]\\d{1,2})?)\\s*(?:horas\\b|hrs\\b|\\bh\\b)/gi;
  let m,best=null,bestScore=-1;
  while((m=re.exec(t))){const n=parseFloat(m[1].replace(',','.'));if(!isFinite(n)||n<=0||n>5000)continue;
    const ctx=t.slice(Math.max(0,m.index-40),m.index+20);
    let score=/dedicaci|estimad|previst|total|jornad|imputaci/i.test(ctx)?10:0;score+=Math.min(n/40,4);
    if(score>bestScore){bestScore=score;best=n;}}
  return best!=null?String(best):'';}
function guessNewAreaName(text,filename){
  const sub=text.match(/(?:asunto|materia|expediente|referencia|objeto|caso)\\s*[:\\-]\\s*([^\\n.;]{4,42})/i);
  let name=sub?sub[1]:(filename||'').replace(/\\.[a-z0-9]+$/i,'').replace(/[_\\-]+/g,' ').replace(/\\b\\d{1,4}\\b/g,' ').replace(/\\s+/g,' ').trim();
  name=name.replace(/^(propuesta|presupuesto|encargo|minuta|contrato|acuerdo|hoja de encargo)\\s+(de\\s+|para\\s+|del\\s+)?/i,'').trim();
  if(name.length<3)return '';
  name=name.slice(0,38).trim();
  return name.charAt(0).toUpperCase()+name.slice(1);}
function prAnalyzeText(text,filename){
  const cls=classify(text||'',null);
  const area=(cls.category&&cls.category!=='unknown')?cls.category:(guessNewAreaName(text,filename)||'');
  return {area,fee:extractFee(text||''),hours:extractHours(text||''),detectedArea:cls.category!=='unknown'};}
/* Lectura de texto por tipo (DOCX/XLSX nativos vía DecompressionStream; PDF vía pdf.js). */
async function prInflateRaw(bytes){const ds=new DecompressionStream('deflate-raw');const ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();return new Uint8Array(ab);}
async function prZipEntry(buf,nameRe){
  const dv=new DataView(buf),u8=new Uint8Array(buf);
  let eo=-1;for(let i=u8.length-22;i>=0;i--){if(dv.getUint32(i,true)===0x06054b50){eo=i;break;}}
  if(eo<0)return '';
  let cnt=dv.getUint16(eo+10,true),p=dv.getUint32(eo+16,true),target=null;
  for(let k=0;k<cnt;k++){if(dv.getUint32(p,true)!==0x02014b50)break;
    const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),nameLen=dv.getUint16(p+28,true),extraLen=dv.getUint16(p+30,true),commLen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nameLen));
    if(nameRe.test(name)){target={method,compSize,lho};break;}
    p+=46+nameLen+extraLen+commLen;}
  if(!target)return '';
  const ln=dv.getUint16(target.lho+26,true),le=dv.getUint16(target.lho+28,true),ds=target.lho+30+ln+le;
  const comp=u8.subarray(ds,ds+target.compSize);
  const raw=target.method===0?comp:await prInflateRaw(comp);
  return new TextDecoder().decode(raw);}
function prXmlText(xml){return xml.replace(/<\\/w:p>|<\\/a:p>|<br\\/?>/gi,'\\n').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#\\d+;/g,' ').replace(/[ \\t]+/g,' ');}
async function prReadDocx(file){return prXmlText(await prZipEntry(await file.arrayBuffer(),/word\\/document\\.xml$/));}
async function prReadXlsx(file){const buf=await file.arrayBuffer();
  const ss=await prZipEntry(buf,/xl\\/sharedStrings\\.xml$/);
  const strings=(ss.match(/<t[^>]*>([\\s\\S]*?)<\\/t>/g)||[]).map(prXmlText).join(' ');
  let nums='';for(let i=1;i<=3;i++){const sh=await prZipEntry(buf,new RegExp('xl/worksheets/sheet'+i+'\\\\.xml$'));if(sh)nums+=' '+(sh.match(/<v>([\\d.]+)<\\/v>/g)||[]).map(v=>v.replace(/<\\/?v>/g,'')).join(' ');}
  return strings+' '+nums;}
let PR_PDFJS=null;
async function prLoadPdfJs(){
  if(window.pdfjsLib){PR_PDFJS=window.pdfjsLib;}else{
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';s.onload=res;s.onerror=()=>rej(new Error('sin conexión'));document.head.appendChild(s);});
    if(!window.pdfjsLib)throw new Error('pdf.js no disponible');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    PR_PDFJS=window.pdfjsLib;}
  return PR_PDFJS;}
async function prReadPdf(file){const lib=await prLoadPdfJs();const pdf=await lib.getDocument({data:await file.arrayBuffer()}).promise;
  let text='';const N=Math.min(pdf.numPages,12);for(let i=1;i<=N;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();text+=c.items.map(it=>it.str).join(' ')+'\\n';}return text;}
async function prExtractText(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  try{let t='';
    if(PR_TEXT_EXT.includes(ext))t=await file.text();
    else if(ext==='docx'&&PR_DEFLATE_OK)t=await prReadDocx(file);
    else if(ext==='xlsx'&&PR_DEFLATE_OK)t=await prReadXlsx(file);
    else if(ext==='pdf')t=await prReadPdf(file);
    return (t||'').slice(0,80000);
  }catch(e){return '';}}
async function prAddFiles(list){
  const files=[...list];if(!files.length)return;
  const status=document.getElementById('pr-status');
  for(let i=0;i<files.length;i++){const f=files[i];
    if(status)status.textContent='Analizando '+(i+1)+'/'+files.length+': '+f.name+'…';
    const text=await prExtractText(f);
    const g=prAnalyzeText(text||f.name,f.name);
    const a=prLoad();a.unshift({id:prUid(),name:f.name,area:g.area,hours:g.hours,fee:g.fee});prSaveAll(a);
    prRenderList();refreshAreaSelects();}
  if(status)status.textContent='';}
function prReadEdits(){return [...document.querySelectorAll('#pr-list tr[data-id]')].map(tr=>{const g=f=>tr.querySelector('[data-f="'+f+'"]');return {id:tr.dataset.id,name:g('name').value,area:g('area').value,hours:g('hours').value,fee:g('fee').value};});}
function prSummary(all){const areas=new Set(all.map(p=>p.area).filter(Boolean));const wH=all.filter(p=>parseFloat(p.hours)>0).length,wF=all.filter(p=>parseFloat(p.fee)>0).length;return all.length+' propuesta(s) · '+areas.size+' área(s) · '+wH+' con horas · '+wF+' con honorario. '+(prUseEnabled()?'Afinando estimaciones.':'(Afinado desactivado).');}
function prRenderList(){
  const box=document.getElementById('pr-list');if(!box)return;const all=prLoad();
  if(!all.length){box.innerHTML='<p class="hint">Aún no hay propuestas. Suelta archivos arriba o añade una fila vacía.</p>';return;}
  box.innerHTML='<datalist id="pr-areas-dl">'+PR_AREAS.map(a=>'<option value="'+esc(a)+'"></option>').join('')+'</datalist><div class="bk-table"><table><thead><tr><th>Propuesta / archivo</th><th>Área <span class="hint">(elige o escribe una nueva)</span></th><th class="num">Horas</th><th class="num">Honorario €</th><th></th></tr></thead><tbody>'+
    all.map(p=>'<tr data-id="'+esc(p.id)+'"><td><input data-f="name" value="'+esc(p.name||'')+'"></td><td><input data-f="area" list="pr-areas-dl" value="'+esc(p.area||'')+'" placeholder="Área…"></td><td class="num"><input data-f="hours" type="number" min="0" step="0.5" value="'+esc(p.hours)+'"></td><td class="num"><input data-f="fee" type="number" min="0" step="1" value="'+esc(p.fee)+'"></td><td class="rowact"><button data-del="'+esc(p.id)+'" title="Eliminar">✕</button></td></tr>').join('')+
    '</tbody></table></div><p class="hint" style="margin-top:8px">'+prSummary(all)+'</p>';
  box.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',()=>{prSaveAll(prReadEdits());refreshAreaSelects();prRenderList();}));
  box.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click',()=>{prSaveAll(prReadEdits().filter(p=>p.id!==btn.getAttribute('data-del')));prRenderList();}));
}
function prInit(){
  const use=document.getElementById('pr-use');use.checked=prUseEnabled();use.addEventListener('change',()=>{prSetUse(use.checked);prRenderList();});
  const drop=document.getElementById('pr-drop'),file=document.getElementById('pr-file');
  drop.addEventListener('click',()=>file.click());
  drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}});
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('dragover');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('dragover');}));
  drop.addEventListener('drop',e=>{if(e.dataTransfer&&e.dataTransfer.files)prAddFiles(e.dataTransfer.files);});
  file.addEventListener('change',()=>{prAddFiles(file.files);file.value='';});
  document.getElementById('pr-add').addEventListener('click',()=>{const a=prLoad();a.unshift({id:prUid(),name:'(propuesta manual)',area:'',hours:'',fee:''});prSaveAll(a);prRenderList();});
  document.getElementById('pr-clear').addEventListener('click',()=>{if(confirm('¿Vaciar TODAS las propuestas guardadas?')){prSaveAll([]);prRenderList();}});
  prRenderList();
}
/* Inyecta en los desplegables de área (Describir caso / Desglose) las áreas
   creadas desde Propuestas, sin perder la selección actual. */
function refreshAreaSelects(){
  const ca=[...new Set(prLoad().map(p=>p.area).filter(Boolean))];
  ['area','bk-area'].forEach(id=>{const sel=document.getElementById(id);if(!sel)return;
    // Quita las áreas que inyectamos antes y que ya no tienen propuestas.
    [...sel.options].forEach(o=>{if(o.dataset.prop==='1' && !ca.includes(o.value)) o.remove();});
    // Añade las nuevas (marcadas para poder limpiarlas luego).
    ca.forEach(a=>{if(![...sel.options].some(o=>o.value===a||o.text===a)){const o=new Option(a,a);o.dataset.prop='1';sel.add(o);}});
  });
}
prInit();
refreshAreaSelects();
</script>
</body>
</html>
`;
export default { async fetch(){ return new Response(HTML,{headers:{"content-type":"text/html; charset=UTF-8","cache-control":"public, max-age=60"}}); } };
