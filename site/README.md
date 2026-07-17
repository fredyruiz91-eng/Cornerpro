# Data.Predict — estructura del proyecto

Antes todo vivía en un solo `index.html` gigante. Ahora está separado así:

```
index.html                 ← solo estructura HTML, sin lógica
css/
  styles.css                ← todos los estilos
js/
  config/
    leagues.js               ← LIGAS, TEAM_STRENGTH_DB, HOME_ADVANTAGE,
                               DIXON_COLES_RHO, PLATT_PARAMS, WC26_STATE
  models/
    stats.js                 ⭐ FÓRMULAS: Poisson, binomial negativa (corners),
                               Dixon-Coles, calibración Platt, BTTS, 1X2
  api/
    bzzoiro.js               ← todo lo que habla con la API de Bzzoiro
  betting/
    tracker.js                ← apuestas guardadas, ROI, punto de equilibrio
  ui/
    render.js                 ← ligas/equipos/toggles en pantalla
  utils/
    diag.js                   ← panel de diagnóstico
  state.js                    ← estado compartido (liga elegida, si la API
                               está online, etc.)
  main.js                     ← conecta todo: botón "calcular" + arranque
```

## ¿Dónde toco qué?

| Quiero...                                              | Archivo                     |
|---------------------------------------------------------|------------------------------|
| Mejorar la fórmula de goles, corners, BTTS o 1X2          | `js/models/stats.js`          |
| Agregar/quitar una liga o un equipo                       | `js/config/leagues.js`        |
| Cambiar cómo se conecta a la API de Bzzoiro                | `js/api/bzzoiro.js`           |
| Cambiar el tracker de apuestas / cálculo de ROI            | `js/betting/tracker.js`       |
| Cambiar cómo se ven los selectores de liga/equipo          | `js/ui/render.js`             |
| Cambiar colores, tamaños, diseño                           | `css/styles.css`              |
| Cambiar el flujo general (qué pasa al tocar "Calcular")    | `js/main.js`                  |

`js/models/stats.js` **no sabe nada de ligas, HTML ni API** — solo recibe
números y devuelve probabilidades. Eso significa que puedes cambiar una
fórmula ahí sin arriesgarte a romper el resto de la app.

## ⚠️ Importante: cómo probarlo

Esto usa módulos de JavaScript (`import`/`export`), lo cual **requiere que el
archivo se sirva por http(s)**, no que lo abras haciendo doble clic
(`file://`). El navegador bloquea los módulos por seguridad en ese caso y la
página se verá rota (sin estilos, sin funcionar).

- **GitHub Pages**: funciona perfecto, no necesitas hacer nada especial.
- **Probarlo en tu computadora antes de subir**: corre un servidor local en la
  carpeta del proyecto, por ejemplo:
  ```
  npx serve .
  ```
  o con Python:
  ```
  python3 -m http.server
  ```
  y abre la URL que te dé (típicamente `http://localhost:3000` o `:8000`).

## Actualizar ratings de una liga con datos reales de la API

`scripts/build-team-ratings.mjs` calcula ratings de ataque/defensa reales (no
estimados a mano) para cualquier liga de Bzzoiro, usando los partidos
finalizados de los últimos N días. Requiere Node.js 18+ (usa `fetch` nativo).

```
node scripts/build-team-ratings.mjs <TU_API_KEY> <league_id> <CLAVE_EN_TU_APP> [dias=200]
```

Si no sabes el `league_id` interno de Bzzoiro para una liga:
```
node scripts/build-team-ratings.mjs <TU_API_KEY> --buscar-liga "nombre de la liga"
```

El script imprime en la terminal el bloque de JS listo para pegar en
`TEAM_STRENGTH_DB` dentro de `js/config/leagues.js`. No modifica ningún
archivo automáticamente — tú decides si pegas el resultado o no. Ver los
comentarios dentro del archivo para más detalle (incluida la limitación de
que usa goles reales, no el xG interno del modelo de Bzzoiro, para evitar
calibrar el modelo contra sí mismo).



Algunos botones (💾 Guardar, ✅❌⏳🗑️✏️, "Reintentar" de la API) se generan
como HTML dinámico con `onclick="nombreFuncion(...)"`. Esos `onclick=""`
buscan la función en `window` (el scope global), no dentro del módulo — por
eso, al final de `api/bzzoiro.js` y `betting/tracker.js` verás líneas como
`window.guardarApuesta = guardarApuesta;`. Es intencional: si algún día
agregas un botón nuevo que llame a una función por nombre en un
`onclick=""`, tienes que exponerla así también, o el navegador dirá
"function is not defined".
