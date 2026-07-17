// ============================================================================
// PANEL DE DIAGNÓSTICO
// ----------------------------------------------------------------------------
// Pequeño logger visual que escribe en el <div id="diag-panel"> del HTML.
// Lo usan tanto api/bzzoiro.js como main.js para dejar rastro de qué pasó en
// cada llamada (útil para depurar la API sin abrir la consola del navegador).
// ============================================================================

export const diagLog = [];

export function addDiagLog(icon, message) {
    diagLog.push({ icon, message, time: new Date().toLocaleTimeString() });
    const panel = document.getElementById('diag-panel');
    if (panel) {
        panel.innerHTML = diagLog.map(d =>
            `<div class="diag-line"><span class="diag-icon">${d.icon}</span><span class="diag-text">[${d.time}] ${d.message}</span></div>`
        ).join('');
        panel.scrollTop = panel.scrollHeight;
    }
}
