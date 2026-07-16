// ============================================================================
// PUNTO DE ENTRADA / ORQUESTADOR
// ----------------------------------------------------------------------------
// Conecta todos los módulos: arma la petición a la API (api/bzzoiro.js), cae al
// modelo local si hace falta (models/stats.js), guarda picks (betting/tracker.js)
// y dibuja los selectores (ui/render.js). Este archivo casi no tiene fórmulas ni
// datos propios — solo orden y flujo.
// ============================================================================

import { LIGAS, HOME_ADVANTAGE, WC26_STATE } from './config/leagues.js';
import {
plattCalibrate, poissonOver, negBinOver, calcBTTS, calcResultProbs, colorFor, cardClassFor
} from './models/stats.js';
import { addDiagLog } from './utils/diag.js';
import { state } from './state.js';
import { testApiConnection, fetchMatchDataFromAPI } from './api/bzzoiro.js';
import { renderSavedBets, openBetsModal, closeBetsModal, migrateOldBetsIfNeeded } from './betting/tracker.js';
import { getLeagueTeamDb, renderLeaguePills, renderMarketToggles, selectLeague } from './ui/render.js';

// Restricción específica del Mundial 2026 (ver nota junto a WC26_STATE en
// config/leagues.js: por defecto NO está bloqueada, esto es solo el chequeo).
function canUseWC26(home, away) {
return !WC26_STATE.blocked || (WC26_STATE.activeTeams.includes(home) && WC26_STATE.activeTeams.includes(away));
}

// ========== CÁLCULO PRINCIPAL ==========
document.getElementById('calc-btn').onclick = async () => {
    const home = document.getElementById('home-team-input').value.trim();
    const away = document.getElementById('away-team-input').value.trim();

    if (!state.currentLeagueKey) { alert('Selecciona liga'); return; }
    if (state.currentLeagueKey === 'WC26' && !canUseWC26(home, away)) { alert('WC26 está bloqueado fuera de las selecciones activas del estado actual del torneo.'); return; }
    if (!home || !away) { alert('Selecciona equipos'); return; }
    if (home === away) { alert('Equipos diferentes'); return; }

    const db = getLeagueTeamDb(state.currentLeagueKey);
    if (!db[home] || !db[away]) {
        alert('Uno o ambos equipos no existen en esta liga.');
        return;
    }

    state.currentMatchHome = home;
    state.currentMatchAway = away;
    state.currentMatchLeagueName = LIGAS[state.currentLeagueKey].name;

    const btn = document.getElementById('calc-btn');
    btn.disabled = true;
    btn.textContent = '🔄 CALCULANDO...';

    try {
        addDiagLog('📈', `Calculando: ${home} vs ${away}`);
        
        let apiData = null;
        if (state.apiOnline) {
            apiData = await fetchMatchDataFromAPI(state.currentLeagueKey, home, away);
        }

        const liga = LIGAS[state.currentLeagueKey];
        // Los ratings locales (hStr/aStr) siempre se calculan: la API de Bzzoiro no
        // entrega goles esperados de 1er tiempo ni de córneres, así que esos dos mercados
        // siempre usan el motor local. Lo que sí puede venir de la API son los goles
        // esperados (xG) totales de la predicción ML real, que son mejores que nuestra
        // estimación local cuando están disponibles.
        const hStr = db[home] || { atk: 1, def: 1 };
        const aStr = db[away] || { atk: 1, def: 1 };
        const baseGoals = liga.goalsAvg / 2;
        const hAdv = HOME_ADVANTAGE[state.currentLeagueKey] || 1.08;

        let lH, lA, usedApiGoals = false;
        if (apiData && apiData.expected_goals && Number.isFinite(apiData.expected_goals.home) && Number.isFinite(apiData.expected_goals.away)) {
            addDiagLog('📡', 'Usando xG real de la predicción ML de Bzzoiro');
            lH = +apiData.expected_goals.home.toFixed(2);
            lA = +apiData.expected_goals.away.toFixed(2);
            usedApiGoals = true;
        } else {
            addDiagLog('📊', 'Usando modelo local (ratings de ataque/defensa)');
            lH = +(baseGoals * hStr.atk * aStr.def * hAdv).toFixed(2);
            lA = +(baseGoals * aStr.atk * hStr.def).toFixed(2);
        }
        const lHT = +((baseGoals * hStr.atk * aStr.def * hAdv * 0.40) + (baseGoals * aStr.atk * hStr.def * 0.40)).toFixed(2);

        const leagueCornersAvg = Number(liga.cornAvg);
        // Mejora: los córneres no solo suben con más ataque, sino también cuando el rival
        // tiene una defensa más floja (def > 1 = defensa débil = más presión sostenida =
        // más córneres concedidos). Antes solo se usaba el promedio de ataque; ahora se
        // combina con el promedio de "def" de ambos equipos para reflejar eso.
        const attackPressure = (hStr.atk + aStr.atk) / 2;
        const defenseWeakness = (hStr.def + aStr.def) / 2;
        const lCornRaw = leagueCornersAvg * ((attackPressure + defenseWeakness) / 2);
        const lCorn = +Math.min(11.0, Math.max(8.0, lCornRaw)).toFixed(2);
        const cornR = liga.cornR || 18; // Bzzoiro no expone un parámetro de dispersión de córneres

        addDiagLog('✅', `Cálculo completado: lCorn=${lCorn}, cornR=${cornR}`);

        document.getElementById('results').classList.remove('hidden');
        document.getElementById('loading-indicator').classList.remove('hidden');
        document.getElementById('output').classList.add('hidden');

        setTimeout(() => {
            document.getElementById('loading-indicator').classList.add('hidden');
            document.getElementById('output').classList.remove('hidden');

            document.getElementById('match-header-container').innerHTML = `
                <div class="match-header animate-in">
                    <div style="text-align:center;font-size:0.7rem;color:var(--muted);">${liga.name} ${state.apiOnline ? '📡' : '📊'}</div>
                    <div class="teams-row"><div class="team-side"><div class="team-name">${home}</div></div><div class="vs-center">VS</div><div class="team-side"><div class="team-name">${away}</div></div></div>
                </div>`;

            let hPN, dPN, aPN;
            if (apiData && apiData.match_result) {
                // La API ya entrega probabilidades calibradas por su propio modelo ML
                // (CatBoost); son mejores que re-derivarlas nosotros desde xG + Poisson.
                addDiagLog('📡', 'Usando 1X2 calibrado de Bzzoiro');
                hPN = +apiData.match_result.prob_home.toFixed(1);
                dPN = +apiData.match_result.prob_draw.toFixed(1);
                aPN = +apiData.match_result.prob_away.toFixed(1);
            } else {
                const rp = calcResultProbs(lH, lA, state.currentLeagueKey);
                const hP = +plattCalibrate(rp.home, 'resultado').toFixed(1), dP = +plattCalibrate(rp.draw, 'resultado').toFixed(1), aP = +plattCalibrate(rp.away, 'resultado').toFixed(1);
                const resultSum = (hP + dP + aP) || 1;
                hPN = +(hP * 100 / resultSum).toFixed(1);
                dPN = +(dP * 100 / resultSum).toFixed(1);
                aPN = +(aP * 100 / resultSum).toFixed(1);
            }

            document.getElementById('match-header-container').innerHTML += `
                <div class="result-boxes animate-in">
                    <div class="result-box">
                        <div class="rb-label">LOCAL</div>
                        <div class="rb-pct" style="color:${colorFor(hPN)}">${hPN}%</div>
                        <button class="result-save-btn" data-mercado="Resultado" data-pick="Local" onclick="guardarApuesta('Resultado','Local',${hPN.toFixed(0)})">💾 Guardar</button>
                    </div>
                    <div class="result-box">
                        <div class="rb-label">X</div>
                        <div class="rb-pct" style="color:var(--yellow)">${dPN}%</div>
                        <button class="result-save-btn" data-mercado="Resultado" data-pick="Empate" onclick="guardarApuesta('Resultado','Empate',${dPN.toFixed(0)})">💾 Guardar</button>
                    </div>
                    <div class="result-box">
                        <div class="rb-label">VISIT</div>
                        <div class="rb-pct" style="color:${colorFor(aPN)}">${aPN}%</div>
                        <button class="result-save-btn" data-mercado="Resultado" data-pick="Visitante" onclick="guardarApuesta('Resultado','Visitante',${aPN.toFixed(0)})">💾 Guardar</button>
                    </div>
                </div>`;

            let html = '';
            const l = lH + lA;
            const apiOU = apiData && apiData.over_under;
            // Estas variables se calculan una sola vez aquí y se reutilizan tal cual en el
            // bloque de "mejor pick" más abajo. Antes el pick se recalculaba por separado
            // con solo el modelo local, así que si la API estaba activa el número mostrado
            // en la tarjeta del mercado y el de "mejor pick" podían no coincidir.
            let g15 = null, g25 = null, btts = null, g05 = null;

            if (state.activeMarkets.goles) {
                g15 = apiOU ? Math.min(98, Math.max(2, apiOU.prob_over_15)) : plattCalibrate(poissonOver(l, 1.5), 'goals15');
                g25 = apiOU ? Math.min(98, Math.max(2, apiOU.prob_over_25)) : plattCalibrate(poissonOver(l, 2.5), 'goals25');
                html += `<div class="section-header"><span class="section-title">⚽ GOLES TOTALES</span><span class="section-lambda">${apiOU ? 'xG API' : 'λ'} <span>${l.toFixed(2)}</span></span></div>
                    <div class="market-card ${cardClassFor(g15)}"><div class="line-label">+1.5</div><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" data-target="${g15}" style="background:${colorFor(g15)};"></div></div></div><div class="pct-label" style="color:${colorFor(g15)}">${g15.toFixed(0)}%</div><button class="save-bet-btn" data-mercado="Goles +1.5" data-pick="Over" onclick="guardarApuesta('Goles +1.5','Over',${g15.toFixed(0)})">💾 Guardar</button></div>
                    <div class="market-card ${cardClassFor(g25)}"><div class="line-label">+2.5</div><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" data-target="${g25}" style="background:${colorFor(g25)};"></div></div></div><div class="pct-label" style="color:${colorFor(g25)}">${g25.toFixed(0)}%</div><button class="save-bet-btn" data-mercado="Goles +2.5" data-pick="Over" onclick="guardarApuesta('Goles +2.5','Over',${g25.toFixed(0)})">💾 Guardar</button></div>`;
            }
            if (state.activeMarkets.ht) {
                // HT siempre local: Bzzoiro no separa expected_goals por 1er tiempo.
                g05 = plattCalibrate(poissonOver(lHT, 0.5), 'goals_ht05');
                const g15ht = plattCalibrate(poissonOver(lHT, 1.5), 'goals_ht15');
                html += `<div class="section-header"><span class="section-title">⏱ 1er TIEMPO</span><span class="section-lambda">λ <span>${lHT}</span></span></div>
                    <div class="market-card ${cardClassFor(g05)}"><div class="line-label">+0.5</div><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" data-target="${g05}" style="background:${colorFor(g05)};"></div></div></div><div class="pct-label" style="color:${colorFor(g05)}">${g05.toFixed(0)}%</div><button class="save-bet-btn" data-mercado="HT +0.5" data-pick="Over" onclick="guardarApuesta('HT +0.5','Over',${g05.toFixed(0)})">💾 Guardar</button></div>
                    <div class="market-card ${cardClassFor(g15ht)}"><div class="line-label">+1.5</div><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" data-target="${g15ht}" style="background:${colorFor(g15ht)};"></div></div></div><div class="pct-label" style="color:${colorFor(g15ht)}">${g15ht.toFixed(0)}%</div><button class="save-bet-btn" data-mercado="HT +1.5" data-pick="Over" onclick="guardarApuesta('HT +1.5','Over',${g15ht.toFixed(0)})">💾 Guardar</button></div>`;
            }
            if (state.activeMarkets.btts) {
                btts = (apiData && apiData.btts && Number.isFinite(apiData.btts.prob_yes))
                    ? Math.min(98, Math.max(2, apiData.btts.prob_yes))
                    : plattCalibrate(calcBTTS(lH, lA, state.currentLeagueKey), 'btts');
                html += `<div class="section-header"><span class="section-title">🤝 AMBOS MARCAN</span></div>
                    <div class="market-card ${cardClassFor(btts)}"><div class="line-label">BTTS</div><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" data-target="${btts}" style="background:${colorFor(btts)};"></div></div></div><div class="pct-label" style="color:${colorFor(btts)}">${btts.toFixed(0)}%</div><button class="save-bet-btn" data-mercado="BTTS" data-pick="Sí" onclick="guardarApuesta('BTTS','Sí',${btts.toFixed(0)})">💾 Guardar</button></div>`;
            }
            if (state.activeMarkets.corn) {
                html += `<div class="section-header"><span class="section-title">⬡ CÓRNERES TOTALES</span><span class="section-lambda">μ <span>${lCorn.toFixed(1)}</span> (r=${cornR})</span></div>`;
                [7.5, 8.5, 9.5, 10.5].forEach(line => {
                    const corn = plattCalibrate(negBinOver(lCorn, line, cornR), 'corners');
                    html += `<div class="market-card ${cardClassFor(corn)}"><div class="line-label">+${line}</div><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" data-target="${corn}" style="background:${colorFor(corn)};"></div></div></div><div class="pct-label" style="color:${colorFor(corn)}">${corn.toFixed(0)}%</div><button class="save-bet-btn" data-mercado="Corners +${line}" data-pick="Over" onclick="guardarApuesta('Corners +${line}','Over',${corn.toFixed(0)})">💾 Guardar</button></div>`;
                });
            }

            document.getElementById('all-markets-container').innerHTML = html;

            const g15Rec = g15, g25Rec = g25, bttsRec = btts, g05htRec = g05;

            let bestPick = null;
            let bestProb = -1;

            if (state.activeMarkets.goles) {
                if (g15Rec > 60 && g15Rec > bestProb) { bestPick = 'OVER 1.5'; bestProb = g15Rec; }
                if (g25Rec > 60 && g25Rec > bestProb) { bestPick = 'OVER 2.5'; bestProb = g25Rec; }
            }
            if (state.activeMarkets.btts && bttsRec > 60 && bttsRec > bestProb) { bestPick = 'BTTS SÍ'; bestProb = bttsRec; }
            if (state.activeMarkets.ht && g05htRec > 60 && g05htRec > bestProb) { bestPick = 'HT OVER 0.5'; bestProb = g05htRec; }
            if (state.activeMarkets.corn) {
                const cornLines = [7.5, 8.5, 9.5, 10.5];
                for (const line of cornLines) {
                    const cornProb = plattCalibrate(negBinOver(lCorn, line, cornR), 'corners');
                    if (cornProb > 60 && cornProb > bestProb) {
                        bestPick = `CORNERS +${line}`;
                        bestProb = cornProb;
                    }
                }
            }
            if (!bestPick) {
                bestPick = 'SIN PICK';
                bestProb = 0;
            }

            document.getElementById('recomendacion-container').innerHTML = `
                <div class="recomendacion animate-in">
                    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:6px;">🎯 MEJOR PICK</div>
                    <div class="rec-main" style="color:${colorFor(bestProb)}">${bestPick}</div>
                    <div style="font-size:1.2rem;font-family:'Bebas Neue';color:${colorFor(bestProb)};margin-top:4px;">${bestProb.toFixed(0)}%</div>
                    <div style="font-size:0.65rem;color:var(--muted);margin-top:8px;">Basado en todas las líneas calculadas</div>
                </div>`;
            
            renderSavedBets();
            setTimeout(() => document.querySelectorAll('.bar-fill').forEach(b => { if (b.dataset.target) b.style.width = b.dataset.target + '%'; }), 50);
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            btn.disabled = false;
            btn.textContent = 'CALCULAR PROBABILIDADES';
        }, 800);
    } catch (error) {
        console.error('Error en cálculo:', error);
        addDiagLog('❌', `Error: ${error.message}`);
        btn.disabled = false;
        btn.textContent = 'CALCULAR PROBABILIDADES';
        alert('Error al calcular.');
    }
};


// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', async () => {
    addDiagLog('🚀', 'Data.Predict PRO v3.0');
    addDiagLog('🔍', 'Bzzoiro Sports Data API');
    migrateOldBetsIfNeeded();
    renderLeaguePills();
    renderMarketToggles();
    const firstPill = document.querySelector('.league-pill');
    if (firstPill) {
        const key = firstPill.getAttribute('data-key');
        selectLeague(key, null);
    }
    renderSavedBets();

    document.getElementById('bets-shortcut-btn').onclick = openBetsModal;
    document.getElementById('bets-modal-close').onclick = closeBetsModal;
    document.getElementById('bets-modal-backdrop').onclick = closeBetsModal;

    addDiagLog('🔌', 'Conectando a Bzzoiro...');
    await testApiConnection();
});
