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


`onclick=""`, tienes que exponerla así también, o el navegador dirá
"function is not defined".
