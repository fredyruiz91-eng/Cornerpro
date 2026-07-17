// ============================================================================
// SISTEMA DE APUESTAS GUARDADAS (tracker + ROI real)
// ----------------------------------------------------------------------------
// Guardar/editar/borrar apuestas, calcular ROI real y punto de equilibrio, y
// dibujar la hoja "Mis Apuestas Guardadas". Todo esto vive en localStorage del
// navegador (no se sincroniza entre dispositivos).
// ============================================================================

import { colorFor } from '../models/stats.js';
import { addDiagLog } from '../utils/diag.js';
import { state } from '../state.js';

// ========== SISTEMA DE APUESTAS ==========
const STORAGE_KEY = 'dataPredict_bets_v30';
const OLD_STORAGE_KEYS = ['dataPredict_bets_v28']; // versiones previas, para migrar sin perder nada
export function migrateOldBetsIfNeeded() {
    try {
        if (localStorage.getItem(STORAGE_KEY)) return; // ya migrado o ya tiene datos propios
        for (const oldKey of OLD_STORAGE_KEYS) {
            const raw = localStorage.getItem(oldKey);
            if (!raw) continue;
            const oldBets = JSON.parse(raw) || [];
            if (!oldBets.length) continue;
            // Los datos viejos no tenían cuota/stake: se agregan como null/1 para que el
            // tracker los pueda mostrar igual (solo sin ROI hasta que se les ponga cuota).
            const migrated = oldBets.map(b => ({ cuota: null, stake: 1, ...b }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
            addDiagLog('♻️', `Migradas ${migrated.length} apuestas guardadas de una versión anterior`);
            return;
        }
    } catch (e) {
        addDiagLog('⚠️', `No se pudieron migrar apuestas antiguas: ${e.message}`);
    }
}
export function getSavedBets() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; } }
export function saveBetsToStorage(bets) { localStorage.setItem(STORAGE_KEY, JSON.stringify(bets)); }
let __betIdCounter = 0;
function generarBetId() {
    return Date.now() * 1000 + (__betIdCounter++ % 1000);
}

export function addBet(betData) { const bets = getSavedBets(); betData.id = generarBetId(); betData.fecha = new Date().toISOString(); betData.status = 'pending'; bets.unshift(betData); saveBetsToStorage(bets); return betData; }
export function updateBetStatus(betId, newStatus) { const bets = getSavedBets(); const bet = bets.find(b => b.id === betId); if (bet) { bet.status = newStatus; saveBetsToStorage(bets); renderSavedBets(); } }
export function deleteBet(betId) { let bets = getSavedBets(); bets = bets.filter(b => b.id !== betId); saveBetsToStorage(bets); renderSavedBets(); }
export function clearAllBets() { if (confirm('¿Eliminar TODAS las apuestas?')) { saveBetsToStorage([]); renderSavedBets(); } }

// Edición de cuota SIN usar prompt()/alert(): algunos navegadores y vistas previas en
// iframe bloquean esos diálogos del sistema en silencio, lo que hacía parecer que el
// botón "no hacía nada". En su lugar, mostramos un input editable dentro de la misma fila.
export function startEditOdds(betId) { state.editingOddsId = betId; renderSavedBets(); }
export function cancelEditOdds() { state.editingOddsId = null; renderSavedBets(); }
export function saveEditOdds(betId) {
    const inputEl = document.getElementById(`odds-input-${betId}`);
    const errEl = document.getElementById(`odds-error-${betId}`);
    if (!inputEl) return;
    const cuota = parseFloat(inputEl.value.replace(',', '.'));
    if (!Number.isFinite(cuota) || cuota <= 1) {
        if (errEl) errEl.textContent = 'Cuota inválida (debe ser un número mayor a 1)';
        return;
    }
    const bets = getSavedBets();
    const bet = bets.find(b => b.id === betId);
    if (bet) {
        bet.cuota = +cuota.toFixed(2);
        saveBetsToStorage(bets);
    }
    state.editingOddsId = null;
    renderSavedBets();
}

export function guardarApuesta(mercado, pick, probabilidad) {
    if (!state.currentMatchHome || !state.currentMatchAway || !state.currentLeagueKey) { alert('Primero calcula un partido.'); return; }
    // La apuesta se guarda sin cuota; se añade después con el ✏️ de la lista (edición
    // en línea, sin prompt()) para que funcione igual en cualquier navegador/visor.
    addBet({ partido: `${state.currentMatchHome} vs ${state.currentMatchAway}`, liga: state.currentLeagueKey, ligaNombre: state.currentMatchLeagueName, mercado, pick, probabilidad, cuota: null, stake: 1 });
    setTimeout(() => {
        document.querySelectorAll('.save-bet-btn, .result-save-btn').forEach(b => {
            if (b.dataset.mercado === mercado && b.dataset.pick === pick) {
                b.classList.add('saved');
                b.textContent = '✅ Guardado';
                setTimeout(() => {
                    b.classList.remove('saved');
                    b.textContent = '💾 ';
                }, 1500);
            }
        });
    }, 50);
    renderSavedBets();
}

export function renderSavedBets() {
    const container = document.getElementById('saved-bets-container');
    const countBadge = document.getElementById('bets-count-badge');
    if (!container) return;
    const bets = getSavedBets();
    const stats = { total: bets.length, won: bets.filter(b => b.status === 'won').length, lost: bets.filter(b => b.status === 'lost').length, pending: bets.filter(b => b.status === 'pending').length };
    const resolved = stats.won + stats.lost;
    const winRate = resolved > 0 ? (stats.won / resolved) * 100 : 0;
    // Punto de equilibrio: la cuota promedio mínima que necesitas, dado tu % de acierto
    // real, para no perder dinero a largo plazo (cuota_equilibrio = 1 / winRate).
    const breakeven = winRate > 0 ? 1 / (winRate / 100) : null;

    // Ganancia/pérdida real: solo se puede calcular sobre apuestas resueltas (won/lost)
    // que además tienen una cuota registrada. stake fijo de 1 unidad por defecto.
    const settledWithOdds = bets.filter(b => (b.status === 'won' || b.status === 'lost') && Number.isFinite(b.cuota));
    let netProfit = 0, staked = 0, avgOddsSum = 0;
    settledWithOdds.forEach(b => {
        const stake = Number.isFinite(b.stake) ? b.stake : 1;
        staked += stake;
        netProfit += b.status === 'won' ? stake * (b.cuota - 1) : -stake;
        avgOddsSum += b.cuota;
    });
    const roi = staked > 0 ? (netProfit / staked) * 100 : null;
    const avgOdds = settledWithOdds.length ? avgOddsSum / settledWithOdds.length : null;

    if (countBadge) countBadge.textContent = stats.total;

    let html = '';
    if (bets.length) {
        html += `<div class="bets-stats"><span>📊 Total: <strong>${stats.total}</strong></span><span class="stat-win">✅ ${stats.won}</span><span class="stat-lose">❌ ${stats.lost}</span><span class="stat-pending">⏳ ${stats.pending}</span>${resolved ? `<span>🎯 ${winRate.toFixed(0)}%</span>` : ''}</div>`;
        if (settledWithOdds.length) {
            const profitColor = netProfit > 0 ? 'var(--green)' : (netProfit < 0 ? 'var(--accent)' : 'var(--muted)');
            html += `<div class="bets-stats">
                <span style="color:${profitColor}">💰 ${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)}u</span>
                <span style="color:${profitColor}">📈 ROI ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</span>
                <span>🎲 cuota prom. ${avgOdds.toFixed(2)}</span>
                ${breakeven ? `<span>⚖️ equilibrio ${breakeven.toFixed(2)}</span>` : ''}
            </div>`;
            if (breakeven && avgOdds < breakeven) {
                html += `<div class="no-bets" style="color:var(--accent);padding:0 4px 10px;">⚠️ Tu cuota promedio (${avgOdds.toFixed(2)}) está por debajo de tu punto de equilibrio (${breakeven.toFixed(2)}): con tu % de acierto actual, en el largo plazo esto pierde dinero aunque ganes más apuestas de las que pierdes.</div>`;
            }
        } else if (resolved) {
            html += `<div class="no-bets" style="padding:0 4px 10px;">Añade la cuota (✏️) en tus apuestas resueltas para ver ganancia real y ROI, no solo % de acierto.</div>`;
        }
        bets.forEach(b => {
            const cls = b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : 'pending';
            const emoji = b.status === 'won' ? '✅' : b.status === 'lost' ? '❌' : '⏳';
            const stakeB = Number.isFinite(b.stake) ? b.stake : 1;
            const betProfit = (b.status === 'won' || b.status === 'lost') && Number.isFinite(b.cuota)
                ? (b.status === 'won' ? stakeB * (b.cuota - 1) : -stakeB)
                : null;
            const cuotaLabel = Number.isFinite(b.cuota) ? `@${b.cuota.toFixed(2)}` : 'sin cuota';
            const profitLabel = betProfit !== null
                ? `<span style="color:${betProfit >= 0 ? 'var(--green)' : 'var(--accent)'}">${betProfit >= 0 ? '+' : ''}${betProfit.toFixed(2)}u</span>`
                : '';
            const isEditingOdds = state.editingOddsId === b.id;
            const oddsControl = isEditingOdds
                ? `<span style="display:inline-flex;align-items:center;gap:4px;">
                        <input type="number" step="0.01" min="1.01" id="odds-input-${b.id}" value="${Number.isFinite(b.cuota) ? b.cuota : ''}" placeholder="1.85"
                            style="width:56px;padding:3px 6px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(20,25,40,0.6);color:var(--text);font-size:0.7rem;" />
                        <button onclick="saveEditOdds(${b.id})" title="Guardar cuota" style="background:rgba(46,204,113,0.2);border:1px solid rgba(46,204,113,0.5);color:var(--green);border-radius:10px;padding:2px 7px;font-size:0.65rem;cursor:pointer;">✓</button>
                        <button onclick="cancelEditOdds()" title="Cancelar" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:var(--muted);border-radius:10px;padding:2px 7px;font-size:0.65rem;cursor:pointer;">✕</button>
                        <span id="odds-error-${b.id}" style="color:var(--accent);font-size:0.6rem;"></span>
                   </span>`
                : `${cuotaLabel} ${profitLabel}`;
            html += `<div class="bet-item ${cls}"><div class="bet-info"><div class="bet-match">${b.partido}</div><div class="bet-detail">${b.ligaNombre} · ${b.mercado} · ${b.pick} ${emoji} · ${oddsControl}</div><div class="bet-prob" style="color:${colorFor(b.probabilidad)}">${b.probabilidad.toFixed(0)}%</div></div><div class="bet-actions">${isEditingOdds ? '' : `<button class="btn-pending" onclick="startEditOdds(${b.id})" title="Editar cuota">✏️</button>`}${b.status !== 'won' ? `<button class="btn-won" onclick="updateBetStatus(${b.id},'won')">✅</button>` : ''}${b.status !== 'lost' ? `<button class="btn-lost" onclick="updateBetStatus(${b.id},'lost')">❌</button>` : ''}${b.status !== 'pending' ? `<button class="btn-pending" onclick="updateBetStatus(${b.id},'pending')">⏳</button>` : ''}<button class="btn-delete" onclick="deleteBet(${b.id})">🗑️</button></div></div>`;
        });
        html += `<button class="clear-all-bets" onclick="clearAllBets()">🗑️ Eliminar todas</button>`;
    } else {
        html += `<div class="no-bets" style="text-align:center;padding:20px;color:var(--muted);">📭 Sin apuestas. Usa 💾 <strong>Guardar</strong> en cualquier mercado.</div>`;
    }
    container.innerHTML = html;
}

export function openBetsModal() {
    renderSavedBets();
    document.getElementById('bets-modal-backdrop').classList.add('open');
    document.getElementById('bets-modal-sheet').classList.add('open');
    document.body.style.overflow = 'hidden';
}

export function closeBetsModal() {
    document.getElementById('bets-modal-backdrop').classList.remove('open');
    document.getElementById('bets-modal-sheet').classList.remove('open');
    document.body.style.overflow = '';
}


// Estas funciones se llaman desde onclick="" generado dinámicamente dentro del HTML de
// cada apuesta (botones ✅❌⏳🗑️✏️✓✕ y los botones "💾 Guardar" de cada mercado). Un
// onclick="" en un string de HTML busca la función en el scope GLOBAL (window), no
// dentro de este módulo — por eso hace falta exponerlas así explícitamente.
window.guardarApuesta = guardarApuesta;
window.updateBetStatus = updateBetStatus;
window.deleteBet = deleteBet;
window.clearAllBets = clearAllBets;
window.startEditOdds = startEditOdds;
window.cancelEditOdds = cancelEditOdds;
window.saveEditOdds = saveEditOdds;
