// ============================================================================
// ESTADO COMPARTIDO DE LA APP
// ----------------------------------------------------------------------------
// En el archivo único original, cosas como "qué liga está seleccionada" o "si
// la API está online" vivían como variables sueltas (let currentLeagueKey...)
// dentro del mismo <script>. Al separar en módulos, cada archivo tiene su
// propio scope aislado, así que ese estado necesita un lugar común que todos
// puedan leer y modificar: este objeto.
//
// Import y uso en cualquier módulo:
//   import { state } from '../state.js';
//   state.currentLeagueKey = 'PL';
// (Mutar una propiedad del objeto SÍ funciona entre módulos; lo que no
// funcionaría es reasignar `state` completo desde otro archivo.)
// ============================================================================

export const state = {
    currentLeagueKey: null,
    activeMarkets: { goles: true, btts: true, corn: true },
    currentMatchHome: null,
    currentMatchAway: null,
    currentMatchLeagueName: null,
    apiOnline: false,
    editingOddsId: null
};
