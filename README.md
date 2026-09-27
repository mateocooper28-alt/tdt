# Lista pública TDT para Hot IPTV

Genera **una única URL pública** con la TDT española en abierto y otros canales gratuitos oficiales. Sirve para **cualquier TV con Hot IPTV** (Samsung, LG, Android) y también para TiviMate, IPTV Smarters, OTT Navigator, VLC o Kodi.

- Se aloja gratis en **GitHub Pages**, sin servidor propio.
- Se **actualiza sola cada día**: los TVs solo tienen que recargar la lista.
- Genera la lista completa, una lista por categoría y una página web con las instrucciones y un botón «Copiar».

## Publicarla (una sola vez, unos 10 minutos)

1. Crea una cuenta gratuita en [github.com](https://github.com).
2. Instala [GitHub Desktop](https://desktop.github.com/), que es la forma más fácil de subir archivos sin usar comandos, e inicia sesión.
3. En GitHub Desktop:
   1. *File → Add local repository* → elige esta carpeta `lista-publica`.
   2. Cuando diga que no es un repositorio, pulsa *create a repository*.
   3. Ponle un nombre, por ejemplo `tdt`, y pulsa *Create repository*.
   4. Pulsa *Publish repository* y **desmarca «Keep this code private»**. GitHub Pages gratis necesita que el repositorio sea público.
4. En la web de GitHub, abre tu repositorio → **Settings → Pages**. En *Source* elige **GitHub Actions**.
5. Ve a la pestaña **Actions** → «Publicar lista» → **Run workflow**. Tarda un minuto aproximadamente.
6. Tu lista quedará en:

   ```
   https://TU-USUARIO.github.io/tdt/lista.m3u
   ```

   Y la página con las instrucciones para compartir, en `https://TU-USUARIO.github.io/tdt/`.

## Añadirla a cada TV con Hot IPTV

1. Abre Hot IPTV en el TV y apunta la **MAC** y la web de subida que aparecen en pantalla.
2. En esa web, escribe la MAC y pega `https://TU-USUARIO.github.io/tdt/lista.m3u`.
3. En el TV, pulsa **Recargar**.

Cada TV tiene su propia MAC, así que el paso 2 se hace una vez por TV. La URL es siempre la misma. Hot IPTV tiene 7 días de prueba y después cada TV necesita su propia activación de pago en la web de Hot IPTV.

## Personalizar (`config.json`)

| Campo | Para qué sirve |
| --- | --- |
| `titulo`, `descripcion` | Textos de la página web. |
| `excluirGrupos` | Categorías que no quieres. Ejemplo: `["Eventuales", "Religiosos", "Int. Asia"]`. |
| `soloGrupos` | Si lo rellenas, **solo** se incluyen esas categorías. Ejemplo: `["Generalistas", "Informativos", "Andalucía"]`. |
| `excluirCanales` | Canales concretos que quieres quitar, por su nombre. |
| `ordenGrupos` | Categorías que aparecen primero en la lista. |
| `mantenerAlternativas` | `true` añade las URLs de respaldo como «Canal (alt 2)». |
| `minimoCanales` | Si una actualización trae menos canales, no se publica y se mantiene la lista anterior. |

Para añadir canales gratuitos oficiales a mano, edita **`canales-extra.m3u`**, que incluye un ejemplo.

Cuando cambies algo, en GitHub Desktop escribe un resumen del cambio, pulsa *Commit to main* y después *Push origin*. La lista se regenera sola en un minuto.

## Probar en el PC (opcional)

Con [Node.js](https://nodejs.org) 18 o superior:

```
node scripts/build.mjs
```

El resultado queda en `public/`. Abre `public/index.html` para ver la página.

## Qué canales incluye y cuáles no

- **Incluye:** RTVE (La 1, La 2, 24h, Clan, Teledeporte), TRECE, El Toro TV, autonómicas y locales de toda España, informativos, musicales, infantiles e internacionales en abierto.
- **No incluye Antena 3, Cuatro, Telecinco ni laSexta.** Esas cadenas no publican una emisión abierta por internet que se pueda usar fuera de sus propias apps (Atresplayer, Mediaset Infinity).
- **Canales «GEO»:** solo funcionan con conexión desde España.
- **Canales caídos:** las cadenas cambian sus URLs a veces. La actualización diaria recoge los cambios que publica TDTChannels.

## Avisos

- **Solo emisiones gratuitas y en abierto** publicadas por las propias cadenas. No añadas canales de pago ni listas de terceros. Redistribuirlos es ilegal y puede suponer el cierre de tu cuenta de GitHub.
- **Mantenimiento:** GitHub desactiva las tareas programadas de un repositorio que pasa 60 días sin cambios. Si deja de actualizarse, entra en *Actions* y pulsa *Enable workflow*, o haz cualquier pequeño cambio.
- **Origen de los datos:** los canales de TDT proceden de [TDTChannels](https://github.com/LaQuay/TDTChannels).
