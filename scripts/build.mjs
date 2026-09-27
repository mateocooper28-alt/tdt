// Genera la lista pública (public/lista.m3u, listas por grupo y página web) a partir de config.json.
// Sin dependencias: Node.js 18 o superior.  Uso:  node scripts/build.mjs
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');
const USER_AGENT = 'ListaPublicaTDT/1.0';

// ------------------------------------------------------------------ utilidades

/** "Castilla-La Mancha" -> "castillalamancha" (para comparar nombres). */
const norm = (s = '') =>
  s.normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Int. América" -> "int-america" (para nombres de archivo). */
const slug = (s = '') =>
  s.normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'otros';

const attr = (s = '') => s.replace(/"/g, "'").replace(/[\r\n]+/g, ' ');

const html = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ lectura

async function leerFuente(fuente) {
  if (fuente.archivo) return readFile(path.join(ROOT, fuente.archivo), 'utf8');
  const res = await fetch(fuente.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Lector M3U extendido: #EXTINF con tvg-*, #EXTGRP, #EXTVLCOPT y cabeceras estilo Kodi (url|User-Agent=…). */
export function parseM3u(texto) {
  const entradas = [];
  let info = null;
  let grupoExt = null;
  let ua = null;
  let ref = null;
  const atributos = (linea) =>
    Object.fromEntries([...linea.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
  const nombreDe = (linea) => {
    let comillas = false;
    for (let i = 0; i < linea.length; i++) {
      if (linea[i] === '"') comillas = !comillas;
      else if (linea[i] === ',' && !comillas) return linea.slice(i + 1).trim();
    }
    return '';
  };

  for (const bruta of texto.split(/\r?\n/)) {
    const linea = bruta.trim().replace(/^﻿/, '');
    if (!linea) continue;
    if (/^#EXTINF/i.test(linea)) {
      info = linea;
      grupoExt = ua = ref = null;
    } else if (/^#EXTGRP:/i.test(linea)) {
      grupoExt = linea.slice(linea.indexOf(':') + 1).trim();
    } else if (/^#EXTVLCOPT:/i.test(linea)) {
      const [clave, ...resto] = linea.slice(linea.indexOf(':') + 1).split('=');
      const valor = resto.join('=').trim();
      if (/^http-user-agent$/i.test(clave.trim())) ua = valor;
      if (/^http-referr?er$/i.test(clave.trim())) ref = valor;
    } else if (!linea.startsWith('#')) {
      const [url, cabeceras = ''] = linea.split('|');
      const extra = Object.fromEntries(
        cabeceras.split('&').filter(Boolean).map((p) => {
          const [k, ...v] = p.split('=');
          const valor = v.join('=').trim();
          let decodificado = valor;
          try { decodificado = decodeURIComponent(valor); } catch { /* se deja tal cual */ }
          return [k.trim().toLowerCase(), decodificado];
        }),
      );
      const a = info ? atributos(info) : {};
      entradas.push({
        nombre: (info && nombreDe(info)) || a['tvg-name'] || url.split('?')[0].split('/').pop(),
        url: url.trim(),
        tvgId: a['tvg-id']?.trim() || null,
        tvgName: a['tvg-name']?.trim() || null,
        logo: a['tvg-logo']?.trim() || null,
        grupo: a['group-title']?.trim() || grupoExt || 'Otros',
        userAgent: ua || extra['user-agent'] || null,
        referrer: ref || extra['referer'] || extra['referrer'] || null,
      });
      info = grupoExt = ua = ref = null;
    }
  }
  return entradas;
}

// ------------------------------------------------------------------ proceso

/** URLs con marcadores sin rellenar ([IP], [UA]…) suelen fallar fuera de su app: se prefieren las demás. */
const tieneMacros = (url) => /\[[A-Z_]+\]/.test(url);

export function procesar(entradas, config) {
  const soloGrupos = new Set((config.soloGrupos ?? []).map(norm));
  const excluirGrupos = new Set((config.excluirGrupos ?? []).map(norm));
  const excluirCanales = new Set((config.excluirCanales ?? []).map(norm));

  const urlsVistas = new Set();
  const porCanal = new Map(); // grupo|canal -> [entradas]
  for (const e of entradas) {
    if (!/^https?:\/\//i.test(e.url)) continue;
    if (soloGrupos.size && !soloGrupos.has(norm(e.grupo))) continue;
    if (excluirGrupos.has(norm(e.grupo))) continue;
    if (excluirCanales.has(norm(e.nombre))) continue;
    if (urlsVistas.has(e.url)) continue;
    urlsVistas.add(e.url);
    const clave = `${norm(e.grupo)}|${norm(e.tvgId || e.nombre)}|${norm(e.nombre)}`;
    if (!porCanal.has(clave)) porCanal.set(clave, []);
    porCanal.get(clave).push(e);
  }

  const canales = [];
  for (const opciones of porCanal.values()) {
    const ordenadas = [...opciones].sort((a, b) => tieneMacros(a.url) - tieneMacros(b.url));
    if (config.mantenerAlternativas) {
      ordenadas.forEach((e, i) => canales.push(i === 0 ? e : { ...e, nombre: `${e.nombre} (alt ${i + 1})` }));
    } else {
      canales.push(ordenadas[0]);
    }
  }

  const orden = (config.ordenGrupos ?? []).map(norm);
  const posicion = (g) => {
    const i = orden.indexOf(norm(g));
    return i === -1 ? orden.length : i;
  };
  // sort es estable: dentro de cada grupo se respeta el orden original de la fuente.
  return canales.sort(
    (a, b) => posicion(a.grupo) - posicion(b.grupo) || a.grupo.localeCompare(b.grupo, 'es'),
  );
}

// ------------------------------------------------------------------ escritura

export function escribirM3u(canales, epg) {
  const cabecera = epg.length ? ` url-tvg="${attr(epg.join(','))}" x-tvg-url="${attr(epg.join(','))}"` : '';
  const lineas = [`#EXTM3U${cabecera}`];
  for (const c of canales) {
    let extinf = '#EXTINF:-1';
    if (c.tvgId) extinf += ` tvg-id="${attr(c.tvgId)}"`;
    extinf += ` tvg-name="${attr(c.tvgName || c.nombre)}"`;
    if (c.logo) extinf += ` tvg-logo="${attr(c.logo)}"`;
    extinf += ` group-title="${attr(c.grupo)}",${c.nombre.replace(/[\r\n]+/g, ' ')}`;
    lineas.push(extinf);
    if (c.userAgent) lineas.push(`#EXTVLCOPT:http-user-agent=${c.userAgent}`);
    if (c.referrer) lineas.push(`#EXTVLCOPT:http-referrer=${c.referrer}`);
    lineas.push(c.url);
  }
  return lineas.join('\n') + '\n';
}

function paginaWeb(config, canales, grupos, fecha) {
  const filasGrupos = grupos
    .map(
      ([nombre, n]) =>
        `<li><a href="grupos/${slug(nombre)}.m3u" data-copy>${html(nombre)}</a><span>${n}</span></li>`,
    )
    .join('\n');
  const epg = config.epg?.[0] ?? '';
  const tarjetas = (tipo) =>
    (config.plataformas ?? [])
      .filter((p) => p.tipo === tipo)
      .map((p) => {
        const nombre = p.web
          ? `<a href="${html(p.web)}" rel="noopener" target="_blank">${html(p.nombre)}</a>`
          : html(p.nombre);
        return `<li><strong>${nombre}</strong><span>${html(p.descripcion)}</span></li>`;
      })
      .join('\n');
  const seccionPlataformas = (config.plataformas ?? []).length
    ? `
<h2>Plataformas: dónde verlas de forma legal</h2>
<p class="muted">Las plataformas de pago y los canales de Atresmedia y Mediaset no se pueden incluir en una lista IPTV:
se ven en su app oficial, que se instala desde la tienda de aplicaciones del propio TV (Samsung, LG, Android TV).</p>
<h3>Gratis</h3>
<ul class="plataformas">
${tarjetas('Gratis')}
</ul>
<h3>De pago (con tu suscripción)</h3>
<ul class="plataformas">
${tarjetas('Pago')}
</ul>`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(config.titulo)}</title>
<meta name="description" content="${html(config.descripcion)}">
<style>
:root{--bg:#f6f7f9;--card:#fff;--line:#e3e6ea;--text:#16191d;--muted:#5f6873;--accent:#2f6fec;--accent-ink:#fff;--ok:#1f8a4c}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#161b22;--line:#2a313c;--text:#e6edf3;--muted:#9da7b3;--accent:#4f8cff;--ok:#3fb950}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.15;margin:0 0 8px}
h2{font-size:20px;margin:40px 0 12px}
p{margin:0 0 12px}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.url{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.url code{flex:1 1 320px;min-width:0;overflow-wrap:anywhere;font:15px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
button{border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:600;padding:10px 18px;cursor:pointer}
button.done{background:var(--ok)}
.stats{display:flex;gap:24px;flex-wrap:wrap;margin-top:16px}
.stats b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
ol{padding-left:22px;margin:0}ol li{margin:8px 0}
ul.grupos{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
ul.grupos li{display:flex;justify-content:space-between;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px}
ul.grupos span{color:var(--muted);font-variant-numeric:tabular-nums}
a{color:var(--accent)}
h3{font-size:16px;margin:20px 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
ul.plataformas{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
ul.plataformas li{display:flex;flex-direction:column;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
ul.plataformas span{color:var(--muted);font-size:14px}
footer{margin-top:48px;font-size:14px;color:var(--muted)}
</style>
</head>
<body>
<main>
<h1>${html(config.titulo)}</h1>
<p class="muted">${html(config.descripcion)}</p>

<div class="card">
  <p><strong>URL de la lista</strong> (pégala en Hot IPTV u otro reproductor):</p>
  <div class="url"><code id="lista">lista.m3u</code><button data-target="lista">Copiar</button></div>
  ${epg ? `<p style="margin-top:14px"><strong>Guía EPG</strong> (si tu app la pide aparte):</p>
  <div class="url"><code id="epg">${html(epg)}</code><button data-target="epg">Copiar</button></div>` : ''}
  <div class="stats">
    <div><b>${canales.length}</b><span class="muted">canales</span></div>
    <div><b>${grupos.length}</b><span class="muted">categorías</span></div>
    <div><b>${html(fecha)}</b><span class="muted">última actualización</span></div>
  </div>
</div>

<h2>Cómo añadirla en Hot IPTV</h2>
<div class="card">
<ol>
  <li>Abre <strong>Hot IPTV</strong> en tu Smart TV y apunta la <strong>dirección MAC</strong> y la web de subida que aparecen en pantalla.</li>
  <li>Desde el móvil o el ordenador, entra en esa web, escribe la MAC y pega la <strong>URL de la lista</strong> de arriba.</li>
  <li>En el TV, pulsa <strong>Recargar</strong> o cierra y vuelve a abrir la app.</li>
</ol>
<p class="muted" style="margin-top:12px">La lista se actualiza sola cada día: no hace falta volver a subirla.
También funciona en TiviMate, IPTV Smarters, OTT Navigator, VLC y Kodi.</p>
</div>

<h2>Listas por categoría</h2>
<p class="muted">Si solo quieres una parte de los canales, usa la URL de la categoría (clic para copiarla).</p>
<ul class="grupos">
${filasGrupos}
</ul>
${seccionPlataformas}

<footer>
  <p>Solo incluye emisiones gratuitas y en abierto publicadas por las propias cadenas. Esta página no aloja ningún vídeo: enlaza a las emisiones oficiales.</p>
  <p>Canales de TDT recopilados por <a href="https://github.com/LaQuay/TDTChannels">TDTChannels</a>.
  Algunas cadenas limitan sus emisiones a España (GEO).</p>
</footer>
</main>
<script>
  const abs = (rel) => new URL(rel, location.href).href;
  document.getElementById('lista').textContent = abs('lista.m3u');
  const copiar = async (texto, boton, original) => {
    try { await navigator.clipboard.writeText(texto); } catch { prompt('Copia la URL:', texto); return; }
    if (boton) { boton.textContent = 'Copiado'; boton.classList.add('done'); setTimeout(() => { boton.textContent = original; boton.classList.remove('done'); }, 1500); }
  };
  document.querySelectorAll('button[data-target]').forEach((b) =>
    b.addEventListener('click', () => copiar(document.getElementById(b.dataset.target).textContent, b, b.textContent)));
  document.querySelectorAll('a[data-copy]').forEach((a) =>
    a.addEventListener('click', (ev) => { ev.preventDefault(); copiar(abs(a.getAttribute('href')), null); a.title = 'URL copiada'; }));
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ principal

async function main() {
  const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
  const todas = [];
  for (const fuente of config.fuentes) {
    try {
      const entradas = parseM3u(await leerFuente(fuente));
      console.log(`✓ ${fuente.nombre}: ${entradas.length} entradas`);
      todas.push(...entradas);
    } catch (e) {
      console.error(`✗ ${fuente.nombre}: ${e.message}`);
    }
  }

  const canales = procesar(todas, config);
  const minimo = config.minimoCanales ?? 1;
  if (canales.length < minimo) {
    // Se aborta para que GitHub Pages siga sirviendo la última lista buena en vez de una vacía.
    throw new Error(`Solo ${canales.length} canales (mínimo ${minimo}). No se publica.`);
  }

  const epg = config.epg ?? [];
  const porGrupo = new Map();
  for (const c of canales) {
    if (!porGrupo.has(c.grupo)) porGrupo.set(c.grupo, []);
    porGrupo.get(c.grupo).push(c);
  }
  const grupos = [...porGrupo.entries()].map(([g, lista]) => [g, lista.length]);
  const fecha = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'Europe/Madrid' }).format(new Date());

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'grupos'), { recursive: true });
  await writeFile(path.join(OUT, 'lista.m3u'), escribirM3u(canales, epg));
  if (config.listasPorGrupo) {
    for (const [g, lista] of porGrupo) {
      await writeFile(path.join(OUT, 'grupos', `${slug(g)}.m3u`), escribirM3u(lista, epg));
    }
  }
  await writeFile(
    path.join(OUT, 'canales.json'),
    JSON.stringify({ actualizado: new Date().toISOString(), total: canales.length, grupos: Object.fromEntries(grupos) }, null, 2),
  );
  await writeFile(path.join(OUT, 'index.html'), paginaWeb(config, canales, grupos, fecha));
  await writeFile(path.join(OUT, '.nojekyll'), '');

  console.log(`\n${canales.length} canales en ${grupos.length} categorías → public/lista.m3u`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nERROR: ${e.message}`);
    process.exit(1);
  });
}
