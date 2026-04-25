const footballData = {
    "España - LaLiga": [
        { name: "Real Madrid", corners: 6.2 }, { name: "FC Barcelona", corners: 5.9 },
        { name: "Atlético Madrid", corners: 5.1 }, { name: "Athletic Club", corners: 5.5 },
        { name: "Real Sociedad", corners: 5.3 }, { name: "Girona FC", corners: 4.8 },
        { name: "Villarreal CF", corners: 5.0 }, { name: "Real Betis", corners: 5.2 }
    ],
    "España - Segunda División": [
        { name: "Levante UD", corners: 5.1 }, { name: "Real Oviedo", corners: 4.9 },
        { name: "RCD Espanyol", corners: 5.4 }, { name: "SD Eibar", corners: 5.6 },
        { name: "Real Valladolid", corners: 5.1 }, { name: "Sporting Gijón", corners: 4.8 },
        { name: "CD Leganés", corners: 4.3 }, { name: "Racing Santander", corners: 5.0 }
    ],
    "Inglaterra - Premier League": [
        { name: "Manchester City", corners: 7.2 }, { name: "Arsenal", corners: 6.6 },
        { name: "Liverpool", corners: 6.9 }, { name: "Tottenham", corners: 6.1 },
        { name: "Aston Villa", corners: 6.0 }, { name: "Man United", corners: 5.8 }
    ]
};

const leagueSelect = document.getElementById('league-select');
const homeSelect = document.getElementById('home-team');
const awaySelect = document.getElementById('away-team');
const calcBtn = document.getElementById('calculate-btn');
const resultsDiv = document.getElementById('results');

function init() {
    leagueSelect.innerHTML = '<option value="">-- Elige una Liga --</option>';
    Object.keys(footballData).sort().forEach(liga => {
        leagueSelect.add(new Option(liga, liga));
    });
}

leagueSelect.onchange = () => {
    const teams = footballData[leagueSelect.value] || [];
    homeSelect.innerHTML = awaySelect.innerHTML = '<option value="">Selecciona equipo</option>';
    teams.sort((a,b) => a.name.localeCompare(b.name)).forEach(t => {
        homeSelect.add(new Option(t.name, t.corners));
        awaySelect.add(new Option(t.name, t.corners));
    });
    homeSelect.disabled = awaySelect.disabled = (teams.length === 0);
};

calcBtn.onclick = () => {
    const h = parseFloat(homeSelect.value);
    const a = parseFloat(awaySelect.value);
    
    if (!h || !a) {
        alert("Por favor selecciona ambos equipos");
        return;
    }

    const totalEsperado = (h + a).toFixed(2);
    // Lógica mejorada: Probabilidad basada en el promedio combinado
    let prob = (totalEsperado / 11) * 100;
    if(totalEsperado > 10.5) prob += 15;
    const finalProb = Math.min(Math.max(prob, 30), 98.2).toFixed(1);

    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = `
        <h3 style="margin:0; color:#ef4444;">Resultado del Análisis</h3>
        <p style="margin:10px 0;">Promedio estimado: <strong>${totalEsperado} córners</strong></p>
        <div class="metric">
            <span>Probabilidad +8.5 Córners:</span>
            <span class="pct">${finalProb}%</span>
        </div>
        <p style="font-size:0.8rem; color:#94a3b8; margin-top:15px;">* Basado en promedios de la temporada actual.</p>
    `;
};

init();
