// ============================================================================
// INTERFAZ: ligas, toggles de mercado, selección de liga y carga de equipos
// ----------------------------------------------------------------------------
// Todo lo que dibuja/controla los selectores de arriba del formulario. No
// calcula probabilidades (eso es models/stats.js) ni guarda datos (eso es
// betting/tracker.js) — solo arma la UI y actualiza el estado compartido.
// ============================================================================

import { LIGAS, TEAM_STRENGTH_DB } from '../config/leagues.js';
import { state } from '../state.js';

// Ligas "compuestas" (copas): combinan la base de equipos de 2 divisiones ya
// existentes en vez de tener la suya propia (ver comentario en config/leagues.js
// junto a COPADELREY / COPPAITALIA).
export function getLeagueTeamDb(leagueKey) {
    const liga = LIGAS[leagueKey];
    if (liga && Array.isArray(liga.compositeOf)) {
        const merged = {};
        liga.compositeOf.forEach(k => Object.assign(merged, TEAM_STRENGTH_DB[k] || {}));
        return merged;
    }
    return TEAM_STRENGTH_DB[leagueKey] || {};
}

// ========== INTERFAZ ==========
export function renderLeaguePills() {
    const c = document.getElementById('league-pills'); c.innerHTML = '';
    for (const [k, v] of Object.entries(LIGAS)) {
        const b = document.createElement('button');
        b.className = 'league-pill';
        b.textContent = v.name;
        b.setAttribute('data-key', k);
        b.onclick = (e) => selectLeague(k, e);
        c.appendChild(b);
    }
}

export function renderMarketToggles() {
    const c = document.getElementById('market-toggles'); c.innerHTML = '';
    const liga = state.currentLeagueKey ? LIGAS[state.currentLeagueKey] : null;
    [{ key: 'goles', label: '⚽ Goles' }, { key: 'btts', label: '🤝 BTTS' }, { key: 'corn', label: '⬡ Corn' }].forEach(x => {
        const b = document.createElement('button'); b.className = 'mkt-toggle'; b.textContent = x.label;
        if (!liga || liga.markets[x.key]) {
            if (state.activeMarkets[x.key]) b.classList.add('on');
            b.onclick = () => { state.activeMarkets[x.key] = !state.activeMarkets[x.key]; b.classList.toggle('on'); };
        } else {
            b.classList.add('unavailable');
            state.activeMarkets[x.key] = false;
        }
        c.appendChild(b);
    });
}

export function selectLeague(key, e) {
    if (state.currentLeagueKey === key) return;
    state.currentLeagueKey = key;
    document.querySelectorAll('.league-pill').forEach(p => p.classList.remove('active'));
    if (e && e.target) {
        e.target.classList.add('active');
    } else {
        const pill = document.querySelector(`.league-pill[data-key="${key}"]`);
        if (pill) pill.classList.add('active');
    }
    const liga = LIGAS[key];
    state.activeMarkets = { goles: liga.markets.goles, ht: liga.markets.ht, btts: liga.markets.btts, corn: liga.markets.corn };
    renderMarketToggles();
    loadTeams(key);
    // Al cambiar de liga se limpia el resultado anterior para evitar mostrar un
    // partido calculado con una liga distinta a la seleccionada.
    state.currentMatchHome = null; state.currentMatchAway = null; state.currentMatchLeagueName = null;
    document.getElementById('results').classList.add('hidden');
}

export function loadTeams(key) {
    const homeInput = document.getElementById('home-team-input');
    const awayInput = document.getElementById('away-team-input');
    const homeList = document.getElementById('home-teams');
    const awayList = document.getElementById('away-teams');

    const teams = Object.keys(getLeagueTeamDb(key)).sort();

    homeList.innerHTML = awayList.innerHTML = '';
    teams.forEach(n => {
        const opt1 = document.createElement('option');
        opt1.value = n;
        homeList.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = n;
        awayList.appendChild(opt2);
    });

    homeInput.value = '';
    awayInput.value = '';
    homeInput.disabled = awayInput.disabled = false;
}

