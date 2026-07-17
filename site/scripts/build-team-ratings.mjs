#!/usr/bin/env node
// ============================================================================
// build-team-ratings.mjs
// ----------------------------------------------------------------------------
// Calcula ratings de ataque/defensa REALES (no estimados a mano) para CUALQUIER
// liga de Bzzoiro, usando los partidos finalizados de los últimos N días.
// Es la misma idea que usamos para MLS/USLC, pero automática y para cualquier
// liga que Bzzoiro cubra.
//
// CÓMO CORRERLO
//   1. Necesitas Node.js 18 o más nuevo (usa fetch nativo, no hace falta instalar nada).
//   2. node build-team-ratings.mjs <TU_API_KEY> <league_id> <CLAVE_EN_TU_APP> [dias]
//
//   Ejemplos:
//     node build-team-ratings.mjs abc123 39 PL 200
//     (39 = Premier League en Bzzoiro, "PL" = la clave que usa data.predict, 200 días atrás)
//
//   No sé de memoria el league_id de Bzzoiro para cada liga (son IDs internos de
//   ellos, no listados en su marketing). Para encontrarlo:
//     node build-team-ratings.mjs <TU_API_KEY> --buscar-liga "nombre de la liga"
//   Esto intenta /api/v2/leagues/?name=... (best-effort: si Bzzoiro no soporta
//   exactamente ese filtro, te lo dirá y tendrás que confirmar el ID por otra vía,
//   por ejemplo mirando la respuesta de /api/v2/events/live/ para un partido de esa
//   liga, que trae league_id y league_name juntos).
//
// QUÉ HACE
//   1. Trae todos los partidos FINALIZADOS de esa liga en el rango de fechas.
//   2. Sinónimo de lo que hicimos a mano con la tabla de la USL: suma goles a
//      favor/en contra de cada equipo, calcula su promedio por partido, y lo
//      normaliza contra el promedio de TODA la liga (así el promedio de la liga
//      siempre queda en atk=1.00 / def=1.00, igual que el resto de la app).
//   3. Imprime el bloque JS listo para pegar en TEAM_STRENGTH_DB, en
//      js/config/leagues.js — no toca tus archivos, tú decides si lo pegas.
//
// LIMITACIÓN HONESTA: usa goles reales, no el xG que muestra el marketing de
// Bzzoiro en las predicciones (ese xG es la salida del modelo, usarlo para
// calibrar el modelo sería circular). Goles reales tienen algo más de "ruido"
// de partido a partido, pero con suficientes partidos (ideal: 15+) se estabiliza
// razonablemente bien — es el mismo criterio que usamos para la tabla de USLC.
// ============================================================================

const API_BASE = 'https://sports.bzzoiro.com/api/v2';
const MIN_PARTIDOS_CONFIABLE = 5; // por debajo de esto, avisamos que es poco dato

function fmtDate(d) {
    return d.toISOString().slice(0, 10);
}

async function apiGet(apiKey, path) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Authorization': `Token ${apiKey}` }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} en ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }
    return res.json();
}

async function buscarLiga(apiKey, nombre) {
    console.log(`Buscando liga "${nombre}" en /api/v2/leagues/?name=...`);
    try {
        const data = await apiGet(apiKey, `/leagues/?name=${encodeURIComponent(nombre)}&limit=10`);
        const results = data.results || [];
        if (!results.length) {
            console.log('No se encontraron resultados. Puede que el nombre no coincida exacto, o que');
            console.log('este endpoint no soporte el filtro "name" tal cual. Prueba con otro texto, o');
            console.log('busca el league_id manualmente viendo /api/v2/events/live/ para un partido de esa liga.');
            return;
        }
        console.log('\nResultados encontrados:');
        results.forEach(l => console.log(`  id=${l.id}  ${l.name}${l.country ? ' (' + l.country + ')' : ''}`));
    } catch (err) {
        console.log(`No se pudo consultar /leagues/: ${err.message}`);
        console.log('Ese endpoint puede no existir con ese nombre exacto en la API real. Alternativa:');
        console.log('mira la respuesta de /api/v2/events/live/ — cada evento trae league_id y league_name juntos.');
    }
}

async function traerPartidosFinalizados(apiKey, leagueId, dateFrom, dateTo) {
    let eventos = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const data = await apiGet(
            apiKey,
            `/events/?league_id=${leagueId}&date_from=${fmtDate(dateFrom)}&date_to=${fmtDate(dateTo)}&status=finished&limit=${limit}&offset=${offset}`
        );
        const results = data.results || [];
        eventos = eventos.concat(results);
        if (!data.next || results.length < limit) break;
        offset += limit;
        if (offset > 5000) break; // salvavidas anti-loop-infinito
    }
    return eventos;
}

function calcularRatings(eventos) {
    const nombrePorId = {};
    const stats = {}; // team_id -> { gf, ga, jugados }

    function asegurar(id, nombre) {
        if (!stats[id]) stats[id] = { gf: 0, ga: 0, jugados: 0 };
        if (nombre) nombrePorId[id] = nombre;
    }

    let ignorados = 0;
    for (const ev of eventos) {
        if (!Number.isFinite(ev.home_score) || !Number.isFinite(ev.away_score)) { ignorados++; continue; }
        asegurar(ev.home_team_id, ev.home_team);
        asegurar(ev.away_team_id, ev.away_team);
        stats[ev.home_team_id].gf += ev.home_score;
        stats[ev.home_team_id].ga += ev.away_score;
        stats[ev.home_team_id].jugados += 1;
        stats[ev.away_team_id].gf += ev.away_score;
        stats[ev.away_team_id].ga += ev.home_score;
        stats[ev.away_team_id].jugados += 1;
    }

    let totalGf = 0, totalPartidosEquipo = 0;
    for (const id in stats) {
        totalGf += stats[id].gf;
        totalPartidosEquipo += stats[id].jugados;
    }
    if (totalPartidosEquipo === 0) return { ratings: null, promedioLiga: 0, ignorados };

    const promedioLiga = totalGf / totalPartidosEquipo;

    const ratings = {};
    for (const id in stats) {
        const s = stats[id];
        const nombre = nombrePorId[id] || `team_id_${id}`;
        ratings[nombre] = {
            atk: +(s.gf / s.jugados / promedioLiga).toFixed(2),
            def: +(s.ga / s.jugados / promedioLiga).toFixed(2),
            jugados: s.jugados,
            pocoDato: s.jugados < MIN_PARTIDOS_CONFIABLE
        };
    }
    return { ratings, promedioLiga, ignorados };
}

function imprimirBloqueJS(claveLiga, ratings) {
    console.log(`\n=== Pega esto en TEAM_STRENGTH_DB (js/config/leagues.js), reemplazando "${claveLiga}": ===\n`);
    const entradas = Object.entries(ratings).sort((a, b) => b[1].atk - a[1].atk);
    console.log(`    "${claveLiga}": {`);
    entradas.forEach(([nombre, r], i) => {
        const coma = i < entradas.length - 1 ? ',' : '';
        const aviso = r.pocoDato ? ' ⚠️ pocos partidos, dato poco confiable' : '';
        console.log(`        "${nombre}": { atk: ${r.atk.toFixed(2)}, def: ${r.def.toFixed(2)} }${coma} // ${r.jugados} partidos${aviso}`);
    });
    console.log('    }');
}

async function main() {
    const args = process.argv.slice(2);
    const apiKey = args[0];

    if (!apiKey) {
        console.log('Uso:');
        console.log('  node build-team-ratings.mjs <API_KEY> <league_id> <CLAVE_EN_TU_APP> [dias=200]');
        console.log('  node build-team-ratings.mjs <API_KEY> --buscar-liga "nombre de la liga"');
        process.exit(1);
    }

    if (args[1] === '--buscar-liga') {
        await buscarLiga(apiKey, args.slice(2).join(' '));
        return;
    }

    const leagueId = args[1];
    const claveLiga = args[2];
    const dias = parseInt(args[3] || '200', 10);

    if (!leagueId || !claveLiga) {
        console.log('Faltan argumentos. Uso:');
        console.log('  node build-team-ratings.mjs <API_KEY> <league_id> <CLAVE_EN_TU_APP> [dias=200]');
        process.exit(1);
    }

    const dateTo = new Date();
    const dateFrom = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    console.log(`Trayendo partidos finalizados de league_id=${leagueId} entre ${fmtDate(dateFrom)} y ${fmtDate(dateTo)}...`);

    let eventos;
    try {
        eventos = await traerPartidosFinalizados(apiKey, leagueId, dateFrom, dateTo);
    } catch (err) {
        console.error(`\nError consultando la API: ${err.message}`);
        console.error('Revisa: la API_KEY, que el league_id sea correcto, y tu conexión.');
        process.exit(1);
    }

    console.log(`Encontrados ${eventos.length} eventos en ese rango.`);

    if (!eventos.length) {
        console.log('No hay partidos finalizados en ese rango de fechas. Prueba con más días (ej: 365)');
        console.log('o confirma el league_id con --buscar-liga.');
        return;
    }

    const { ratings, promedioLiga, ignorados } = calcularRatings(eventos);

    if (!ratings) {
        console.log('Ninguno de los eventos traídos tenía marcador (home_score/away_score). No se puede calcular.');
        return;
    }

    if (ignorados > 0) {
        console.log(`(${ignorados} eventos no tenían marcador y se ignoraron)`);
    }

    const nEquipos = Object.keys(ratings).length;
    console.log(`Promedio real de la liga: ${promedioLiga.toFixed(3)} goles/equipo/partido — ${nEquipos} equipos con datos.`);

    const pocoDato = Object.values(ratings).filter(r => r.pocoDato).length;
    if (pocoDato > 0) {
        console.log(`⚠️  ${pocoDato} equipo(s) tienen menos de ${MIN_PARTIDOS_CONFIABLE} partidos en el rango — sus ratings`);
        console.log('   están marcados abajo y conviene tratarlos con más cautela (ascendidos, expansión, etc).');
    }

    imprimirBloqueJS(claveLiga, ratings);
}

main().catch(err => {
    console.error('Error inesperado:', err.message);
    process.exit(1);
});
