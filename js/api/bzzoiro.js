// ============================================================================
// INTEGRACIÓN CON LA API DE BZZOIRO SPORTS DATA (v2)
// ----------------------------------------------------------------------------
// Todo lo que habla por red vive aquí: probar conexión, buscar team_id por
// nombre, encontrar el próximo partido entre 2 equipos y traer la predicción
// ML real de Bzzoiro. Si algo de esto falla, main.js cae solo al modelo local
// (js/models/stats.js) — esta capa nunca debe romper el cálculo, solo devolver
// null cuando no hay dato.
// ============================================================================

import { addDiagLog } from '../utils/diag.js';
import { state } from '../state.js';

// ========== CONFIGURACIÓN API (Bzzoiro Sports Data, v2) ==========
// La base real de la API es .../api/v2/ (la versión anterior usaba .../api/events,
// que no existe → por eso siempre caía a "datos locales" sin importar la clave).
const API_BASE = 'https://sports.bzzoiro.com/api/v2';
// Consigue una clave gratis en https://sports.bzzoiro.com/register/ (cuenta → API key)
// y pégala aquí. La clave de ejemplo anterior no es una clave real de tu cuenta.
// NOTA DE SEGURIDAD: esta clave queda expuesta en el HTML/JS del cliente (visible para
// cualquiera que abra las herramientas de desarrollador). Si esta app se publica de
// verdad, la llamada a la API externa debería pasar por un backend/proxy propio que
// guarde la clave en el servidor, nunca en el front-end.
const API_KEY = 'dd07cdbeed19f58195949f42b3836397a172cb11';
const API_TIMEOUT = 6000;
const CACHE_KEY = 'dataPredict_api_cache_v29';
const CACHE_TTL = 60 * 60 * 1000;
// Cache en memoria de nombre de equipo -> team_id de Bzzoiro (evita repetir /teams/?name=)
const teamIdCache = {};


// ========== CACHÉ LOCAL ==========
function getApiCache(leagueId, home, away) {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
        const key = `${leagueId}_${home}_${away}`;
        const data = cache[key];
        if (data && Date.now() - data.timestamp < CACHE_TTL) {
            addDiagLog('📦', `Caché: ${key}`);
            return data.value;
        }
        delete cache[key];
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) { 
        addDiagLog('⚠️', `Error caché: ${e.message}`);
    }
    return null;
}

function setApiCache(leagueId, home, away, data) {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
        const key = `${leagueId}_${home}_${away}`;
        cache[key] = { value: data, timestamp: Date.now() };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        addDiagLog('💾', `Caché guardado: ${key}`);
    } catch (e) { 
        addDiagLog('⚠️', `Error guardar caché: ${e.message}`);
    }
}

// ========== FUNCIONES API ==========

// Helper genérico con timeout y manejo de error uniforme para toda la API v2.
async function apiGet(path) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            method: 'GET',
            headers: { 'Authorization': `Token ${API_KEY}` },
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error('TIMEOUT');
        throw err;
    }
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${path}`);
    return response.json();
}

export async function testApiConnection() {
    const statusEl = document.getElementById('api-status');
    const badgeEl = document.getElementById('api-badge');

    addDiagLog('🔌', `Probando: ${API_BASE}/events/live/`);

    try {
        // Endpoint real, liviano y sin parámetros obligatorios: sirve como "ping".
        await apiGet('/events/live/');
        state.apiOnline = true;
        statusEl.innerHTML = '<span class="api-status-icon">✅</span><span class="api-status-text">API Bzzoiro conectada</span>';
        statusEl.className = 'api-status online';
        badgeEl.classList.remove('offline');
        badgeEl.classList.add('online');
        badgeEl.textContent = '🔗 API ONLINE';
        addDiagLog('✅', 'Conexión exitosa con Bzzoiro');
    } catch (error) {
        state.apiOnline = false;
        const errorMsg = error.message;

        statusEl.innerHTML = `<span class="api-status-icon">⚠️</span><span class="api-status-text">Bzzoiro no disponible (${errorMsg})</span><button class="api-retry-btn" onclick="testApiConnection()">Reintentar</button>`;
        statusEl.className = 'api-status offline';
        badgeEl.classList.remove('online');
        badgeEl.classList.add('offline');
        badgeEl.textContent = '🔗 API OFFLINE';

        addDiagLog('❌', `Bzzoiro no disponible: ${errorMsg}`);
        if (errorMsg.includes('401') || errorMsg.includes('403')) {
            addDiagLog('🔑', 'Revisa tu API_KEY: regístrate en sports.bzzoiro.com/register/');
        }
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('TIMEOUT')) {
            addDiagLog('🌐', 'Puede ser CORS (bloqueo del navegador) o falta de red, no solo la API');
        }
        addDiagLog('📊', 'Usando datos locales (fallback)');
    }
}

// Busca el team_id de Bzzoiro a partir del nombre local del equipo.
export async function findTeamId(name) {
    if (teamIdCache[name] !== undefined) return teamIdCache[name];
    try {
        const data = await apiGet(`/teams/?name=${encodeURIComponent(name)}&limit=5`);
        const results = data.results || [];
        if (!results.length) { teamIdCache[name] = null; return null; }
        const lower = name.toLowerCase();
        const exact = results.find(t =>
            (t.name || '').toLowerCase() === lower || (t.short_name || '').toLowerCase() === lower
        );
        const id = (exact || results[0]).id;
        teamIdCache[name] = id;
        return id;
    } catch (err) {
        addDiagLog('❌', `Buscando equipo "${name}": ${err.message}`);
        return null;
    }
}

// Busca, entre los próximos partidos del equipo local, el que sea contra el visitante.
export async function findUpcomingEvent(homeId, awayId) {
    const fmt = d => d.toISOString().slice(0, 10);
    const today = fmt(new Date());
    const future = fmt(new Date(Date.now() + 21 * 24 * 60 * 60 * 1000));
    // CORRECCIÓN: el sub-recurso real de Bzzoiro es /fixtures/, no /matches/ (por eso
    // salían los 404 en el panel de diagnóstico). Sin filtros de fecha, la API ya
    // devuelve por defecto una ventana de ahora−3h a ahora+7d, pero mandamos date_from/
    // date_to explícitos para cubrir un rango más amplio (hasta 21 días) y encontrar
    // partidos programados con más antelación.
    const data = await apiGet(`/teams/${homeId}/fixtures/?date_from=${today}&date_to=${future}&limit=50`);
    const list = data.results || data.matches || [];
    return list.find(m => m.away_team_id === awayId || m.home_team_id === awayId) || null;
}

// Trae la predicción ML ya calculada por Bzzoiro para un evento (si existe).
export async function getPrediction(eventId) {
    try {
        return await apiGet(`/predictions/by-event/${eventId}/`);
    } catch (err) {
        try {
            const data = await apiGet(`/predictions/?event=${eventId}&limit=1`);
            return (data.results && data.results[0]) || null;
        } catch (err2) {
            addDiagLog('⚠️', `Sin predicción de Bzzoiro para event_id=${eventId}`);
            return null;
        }
    }
}

// Punto de entrada: resuelve equipos → evento → predicción real, con caché local.
export async function fetchMatchDataFromAPI(leagueId, homeTeam, awayTeam) {
    if (!state.apiOnline) return null;

    const cachedData = getApiCache(leagueId, homeTeam, awayTeam);
    if (cachedData) return cachedData;

    try {
        const [homeId, awayId] = await Promise.all([findTeamId(homeTeam), findTeamId(awayTeam)]);
        if (!homeId || !awayId) {
            addDiagLog('⚠️', 'No se encontró team_id de Bzzoiro para uno o ambos equipos');
            return null;
        }

        const event = await findUpcomingEvent(homeId, awayId);
        if (!event) {
            addDiagLog('⚠️', 'No hay un partido próximo entre estos equipos en la API (puede que aún no esté programado)');
            return null;
        }

        const pred = await getPrediction(event.id);
        if (!pred || !pred.markets) {
            addDiagLog('⚠️', 'Evento encontrado pero sin predicción ML todavía');
            return null;
        }

        const result = {
            source: 'bzzoiro',
            event_id: event.id,
            expected_goals: pred.markets.expected_goals || null,   // { home, away }
            match_result: pred.markets.match_result || null,        // { prob_home, prob_draw, prob_away }
            over_under: pred.markets.over_under || null,            // { prob_over_15, prob_over_25, prob_over_35 }
            btts: pred.markets.btts || null                         // { prob_yes }
        };

        setApiCache(leagueId, homeTeam, awayTeam, result);
        addDiagLog('📡', `Predicción Bzzoiro: xG ${result.expected_goals?.home ?? '?'} - ${result.expected_goals?.away ?? '?'}`);
        return result;
    } catch (error) {
        addDiagLog('❌', `Error API: ${error.message}`);
        return null;
    }
}


// testApiConnection() se llama desde un onclick="" generado dinámicamente (el botón
// "Reintentar" del panel de estado), y esos onclick="" en HTML buscan la función
// en el scope GLOBAL (window), no dentro de este módulo. Por eso se expone así.
window.testApiConnection = testApiConnection;
