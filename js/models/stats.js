// ============================================================================
// MODELO ESTADÍSTICO (Poisson, binomial negativa, Dixon-Coles, calibración Platt)
// ----------------------------------------------------------------------------
// AQUÍ es donde se toca si quieres mejorar la fórmula de goles, corners, BTTS
// o resultado 1X2. Este archivo no sabe nada de ligas, equipos, API ni HTML —
// solo recibe números (lambda, promedios, etc.) y devuelve probabilidades.
//
// Funciones:
//   plattCalibrate()     -> recalibra una probabilidad cruda con los parámetros
//                           de PLATT_PARAMS (config/leagues.js). 3er parámetro
//                           opcional para calibración por liga (ver la función).
//   poissonExact/Prob()  -> distribución de Poisson (goles, HT). poissonProb()
//                           es en realidad una CDF (P(X<=k)); alias más claro:
//                           poissonCDF() al final del archivo.
//   poissonOver()        -> P(Over X.5) usando Poisson.
//   negBinExact/Over()   -> binomial negativa (usada para CÓRNERES: tienen más
//                           varianza que los goles, por eso no se usa Poisson ahí).
//   dixonColesTau()      -> corrección de Dixon-Coles para marcadores bajos (0-0,
//                           1-0, 0-1, 1-1), donde el supuesto de independencia
//                           de Poisson falla un poco. Con piso en 0.
//   calcBTTS()           -> probabilidad de "ambos marcan".
//   calcResultProbs()    -> probabilidad de 1X2 (local/empate/visitante).
//   colorFor/cardClassFor() -> solo puramente visual (umbrales de color).
//   normalizeCornersAvg()   -> valida que un promedio de corners de la API sea
//                              un número usable.
//   splitCornerLambda()  -> reparte el corner total esperado entre local y
//                           visitante, con factores multiplicativos (ver nota
//                           junto a la función).
// ============================================================================

import { PLATT_PARAMS, DIXON_COLES_RHO } from '../config/leagues.js';

// ========== FUNCIONES MATEMÁTICAS ==========

// leagueOverride (opcional): objeto { A, B } para calibración específica de una
// liga; si no se pasa, cae en PLATT_PARAMS[type] como hasta ahora. Con poco
// histórico por liga es más seguro no usarlo — calibrar con pocos datos suele
// overfittear y empeorar en vez de mejorar.
export function plattCalibrate(raw, type, leagueOverride = null) {
    const p = Math.max(0.001, Math.min(0.999, raw / 100));
    const logit = Math.log(p / (1 - p));
    const params = leagueOverride || PLATT_PARAMS[type] || { A: 0.93, B: -0.04 };
    const calibrated = 1 / (1 + Math.exp(-(params.A * logit + params.B)));
    return Math.min(98, Math.max(2, calibrated * 100));
}

export function poissonExact(lambda, k) { 
    if (k < 0) return 0;
    if (k === 0) return Math.exp(-lambda);
    let t = Math.exp(-lambda); 
    for (let i = 0; i < k; i++) t *= lambda / (i + 1); 
    return t; 
}

// P(X <= k) para X ~ Poisson(lambda): es una CDF, no la probabilidad puntual de
// un valor (el nombre es engañoso). Se deja poissonProb() intacto para no
// romper imports existentes — usa el alias poissonCDF() (al final del archivo)
// en código nuevo.
export function poissonProb(lambda, k) { 
    let p = Math.exp(-lambda), t = p; 
    for (let i = 1; i <= k; i++) { t *= lambda / i; p += t; } 
    return p; 
}

export function poissonOver(lambda, th) { 
    return Math.min(98, Math.max(2, (1 - poissonProb(lambda, Math.floor(th))) * 100)); 
}

// r = sobre-dispersión (a menor r, más varianza sobre la media mu). Para que
// esto sea preciso, estímalo por liga con datos reales de corners:
//   r = mu² / (varianza − mu)
// Si varianza <= mu no hay sobre-dispersión real y Poisson es más apropiado
// que binomial negativa. Un r fijo/inventado para todas las ligas no rompe la
// fórmula, pero sí limita cuánto puede acertar.
export function negBinExact(mu, r, k) {
    if (k < 0) return 0;
    if (k === 0) return Math.pow(r / (r + mu), r);
    const p = r / (r + mu);
    let logComb = 0;
    for (let i = 1; i <= k; i++) {
        logComb += Math.log(r + i - 1) - Math.log(i);
    }
    const logP = logComb + r * Math.log(p) + k * Math.log(1 - p);
    return Math.exp(logP);
}

export function negBinOver(mu, th, r) { 
    const k = Math.floor(th); 
    let cdf = 0; 
    for (let i = 0; i <= k; i++) cdf += negBinExact(mu, r, i); 
    return Math.min(98, Math.max(2, (1 - cdf) * 100)); 
}

// Piso en 0 en las 4 ramas: con los rho actuales (negativos, |rho| < 0.13) y
// lambdas de gol normales esto nunca se activa — es blindaje para si algún rho
// llega mal cargado (p. ej. positivo) o si esta función se reutiliza con
// lambdas más grandes (p. ej. de corners).
export function dixonColesTau(x, y, lH, lA, rho) { 
    if (x === 0 && y === 0) return Math.max(0, 1 - (lH * lA * rho));
    if (x === 0 && y === 1) return Math.max(0, 1 + (lH * rho));
    if (x === 1 && y === 0) return Math.max(0, 1 + (lA * rho));
    if (x === 1 && y === 1) return Math.max(0, 1 - rho);
    return 1; 
}

export function calcBTTS(lH, lA, leagueKey) { 
    const rho = DIXON_COLES_RHO[leagueKey] || DIXON_COLES_RHO.default; 
    const p00 = poissonExact(lH, 0) * poissonExact(lA, 0) * dixonColesTau(0, 0, lH, lA, rho);
    const pHome0 = poissonExact(lH, 0);
    const pAway0 = poissonExact(lA, 0);
    const btts = 1 - pHome0 - pAway0 + p00;
    return Math.min(98, Math.max(2, btts * 100)); 
}

export function calcResultProbs(lH, lA, leagueKey) { 
    const rho = DIXON_COLES_RHO[leagueKey] || DIXON_COLES_RHO.default; 
    let pH = 0, pD = 0, pA = 0; 
    for (let h = 0; h <= 10; h++) { 
        for (let a = 0; a <= 10; a++) { 
            let p = poissonExact(lH, h) * poissonExact(lA, a); 
            if (h <= 1 && a <= 1) p *= dixonColesTau(h, a, lH, lA, rho); 
            if (h > a) pH += p; 
            else if (h === a) pD += p; 
            else pA += p; 
        } 
    }
    const sum = (pH + pD + pA) || 1;
    return { home: +((pH / sum) * 100).toFixed(1), draw: +((pD / sum) * 100).toFixed(1), away: +((pA / sum) * 100).toFixed(1) }; 
}

export function colorFor(p) { return p >= 65 ? 'var(--green)' : p >= 42 ? 'var(--yellow)' : 'var(--accent)'; }
export function cardClassFor(p) { return p >= 65 ? 'high' : p >= 42 ? 'mid' : 'low'; }

export function normalizeCornersAvg(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

// Reparte el total de corners esperados de un partido (lCorn) entre local y
// visitante, según qué tan "generador de corners" es cada lado (su ataque
// contra la defensa rival) y un sesgo de localía configurable (CORNER_HOME_BIAS
// en config/leagues.js).
//
// homeFactor/awayFactor ahora son multiplicativos (atk × def), igual que el
// modelo de goles. Antes eran un promedio (atk + def) / 2, que amortigua de
// más un desnivel grande entre ataque y defensa: con un equipo que domina
// claramente, el promedio lo trataba casi como un partido parejo. Este cambio
// SÍ altera los números que devuelve la función — antes de confiar en el
// reparto local/visitante, compáralo contra corners reales de tu liga.
export function splitCornerLambda(totalCorners, homeAtk, homeDef, awayAtk, awayDef, homeBias) {
    const homeFactor = homeAtk * awayDef; // ataque local vs. defensa visitante
    const awayFactor = awayAtk * homeDef; // ataque visitante vs. defensa local
    const rawHome = homeFactor * homeBias;
    const rawAway = awayFactor;
    const homeShare = (rawHome + rawAway) > 0 ? rawHome / (rawHome + rawAway) : 0.5;
    const home = +(totalCorners * homeShare).toFixed(2);
    const away = +(totalCorners - home).toFixed(2);
    return { home, away };
}

// Alias con nombre más claro (ver nota junto a poissonProb): misma función,
// mismo comportamiento, no rompe nada existente.
export const poissonCDF = poissonProb;
