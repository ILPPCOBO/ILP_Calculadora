# Despliegue de la versión web (un solo archivo)

La app web es **`Calculadora-Honorarios-OFFLINE.html`** (en la raíz del repo). Aquí están las
copias listas para publicar, ambas con el **mismo contenido**:

```
deploy/
├── web/index.html                 # sitio estático (Vercel · Cloudflare Pages · Netlify…)
└── cloudflare/                    # proyecto Worker (código)
    ├── wrangler.toml
    ├── package.json
    └── src/index.js               # el HTML embebido que sirve el Worker
```

> Estas copias se generan desde la raíz. Si cambias `Calculadora-Honorarios-OFFLINE.html`,
> hay que regenerar `deploy/web/index.html` y `deploy/cloudflare/src/index.js`.

---

## Vercel (recomendado para publicar desde GitHub)
1. Entra en https://vercel.com e inicia sesión **con GitHub**.
2. **Add New… → Project** → importa el repo `ILPPCOBO/ILP_Calculadora`
   (si no aparece, pulsa *Adjust GitHub App Permissions* y dale acceso al repo/organización).
3. En la configuración del proyecto:
   - **Root Directory** → `deploy/web`
   - **Framework Preset** → `Other`
   - Build/Install Command → **vacío** (es estático, no hay build).
4. **Deploy**. Te da una URL `https://<proyecto>.vercel.app`.
5. A partir de ahí, **cada push a `main` se publica solo**.

## Cloudflare Pages (arrastrar, sin código)
*Workers & Pages → Create → Pages → Upload assets* → sube **solo** `deploy/web/index.html`.

## Cloudflare Worker (código)
```bash
cd deploy/cloudflare
npx wrangler login
npx wrangler deploy
```

---

**Nota:** el "guardado" de Propuestas y desgloses vive en el navegador (`localStorage`), no se
comparte entre equipos. Los datos embebidos son agregados por área (sin documentos ni nombres
de clientes).
