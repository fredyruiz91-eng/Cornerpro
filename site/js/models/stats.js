import { PLATT_PARAMS, DIXON_COLES_RHO } from '../config/leagues.js';

const DEFAULT_PLATT = { A: 0.93, B: -0.04 };
const DEFAULT_MAX_GOALS = 10;
const MIN_P = 0.001;
const MAX_P = 0.999;
const MIN_OUT = 2;
const MAX_OUT = 98;

export function plattCalibrate(raw, type) {
    const p = Math.max(MIN_P, Math.min(MAX_P, raw / 100));
    const logit = Math.log(p / (1 - p));
    const params = PLATT_PARAMS[type] || DEFAULT_PLATT;
    const calibrated = 1 / (1 + Math.exp(-(params.A * logit + params.B)));
    return Math.min(MAX_OUT, Math.max(MIN_OUT, calibrated * 100));
}

export function poissonExact(lambda, k) {
    if (!Number.isFinite(lambda) || lambda < 0) return 0;
    if (!Number.isInteger(k) || k < 0) return 0;
    if (k === 0) return Math.exp(-lambda);
    let t = Math.exp(-lambda);
    for (let i = 0; i < k; i++) t *= lambda / (i + 1);
    return t;
}

export function poissonCDF(lambda, k) {
    if (!Number.isFinite(lambda) || lambda < 0) return 0;
    if (!Number.isFinite(k) || k < 0) return 0;
    let p = Math.exp(-lambda), t = p;
    for (let i = 1; i <= k; i++) {
        t *= lambda / i;
        p += t;
    }
    return p;
}

export const poissonProb = poissonCDF;

export function poissonOver(lambda, th) {
    const over = 1 - poissonCDF(lambda, Math.floor(th));
    return Math.min(MAX_OUT, Math.max(MIN_OUT, over * 100));
}

export function negBinExact(mu, r, k) {
    if (!Number.isFinite(mu) || mu < 0 || !Number.isFinite(r) || r <= 0) return 0;
    if (!Number.isInteger(k) || k < 0) return 0;
    if (k === 0) return Math.pow(r / (r + mu), r);
    const p = r / (r + mu);
    let logComb = 0;
    for (let i = 1; i <= k; i++) logComb += Math.log(r + i - 1) - Math.log(i);
    return Math.exp(logComb + r * Math.log(p) + k * Math.log(1 - p));
}

export function negBinOver(mu, th, r) {
    const k = Math.floor(th);
    let cdf = 0;
    for (let i = 0; i <= k; i++) cdf += negBinExact(mu, r, i);
    return Math.min(MAX_OUT, Math.max(MIN_OUT, (1 - cdf) * 100));
}

export function dixonColesTau(x, y, lH, lA, rho) {
    if (x === 0 && y === 0) return Math.max(0, 1 - (lH * lA * rho));
    if (x === 0 && y === 1) return Math.max(0, 1 + (lH * rho));
    if (x === 1 && y === 0) return Math.max(0, 1 + (lA * rho));
    if (x === 1 && y === 1) return Math.max(0, 1 - rho);
    return 1;
}

export function calcBTTS(lH, lA, leagueKey) {
    const rho = DIXON_COLES_RHO[leagueKey] || DIXON_COLES_RHO.default;
    const pHome0 = poissonExact(lH, 0);
    const pAway0 = poissonExact(lA, 0);
    const p00 = pHome0 * pAway0 * dixonColesTau(0, 0, lH, lA, rho);
    const btts = 1 - pHome0 - pAway0 + p00;
    return Math.min(MAX_OUT, Math.max(MIN_OUT, btts * 100));
}

export function calcResultProbs(lH, lA, leagueKey, maxGoals = DEFAULT_MAX_GOALS) {
    const rho = DIXON_COLES_RHO[leagueKey] || DIXON_COLES_RHO.default;
    let pH = 0, pD = 0, pA = 0;

    for (let h = 0; h <= maxGoals; h++) {
        for (let a = 0; a <= maxGoals; a++) {
            let p = poissonExact(lH, h) * poissonExact(lA, a);
            if (h <= 1 && a <= 1) p *= dixonColesTau(h, a, lH, lA, rho);
            if (h > a) pH += p;
            else if (h === a) pD += p;
            else pA += p;
        }
    }

    const sum = pH + pD + pA || 1;
    return {
        home: +((pH / sum) * 100).toFixed(1),
        draw: +((pD / sum) * 100).toFixed(1),
        away: +((pA / sum) * 100).toFixed(1),
    };
}

export function colorFor(p) {
    return p >= 65 ? 'var(--green)' : p >= 42 ? 'var(--yellow)' : 'var(--accent)';
}

export function cardClassFor(p) {
    return p >= 65 ? 'high' : p >= 42 ? 'mid' : 'low';
}

export function normalizeCornersAvg(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

export function splitCornerLambda(totalCorners, homeAtk, homeDef, awayAtk, awayDef, homeBias) {
    const homeFactor = (homeAtk + awayDef) / 2;
    const awayFactor = (awayAtk + homeDef) / 2;
    const rawHome = homeFactor * homeBias;
    const rawAway = awayFactor;
    const homeShare = (rawHome + rawAway) > 0 ? rawHome / (rawHome + rawAway) : 0.5;
    const home = +(totalCorners * homeShare).toFixed(2);
    const away = +(totalCorners - home).toFixed(2);
    return { home, away };
}