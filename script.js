const footballData = {
    "España - LaLiga": [
        { name: "Real Madrid", corners: 6.2 }, { name: "FC Barcelona", corners: 5.9 },
        { name: "Girona FC", corners: 4.8 }, { name: "Atlético Madrid", corners: 5.1 }
    ],
    "España - Segunda": [
        { name: "Levante UD", corners: 5.2 }, { name: "Real Oviedo", corners: 4.9 }
    ]
};

const leagueSelect = document.getElementById('league-select');
const homeSelect = document.getElementById('home-team');
const awaySelect = document.getElementById('away-team');
const calcBtn = document.getElementById('calculate-btn');
const resultsContainer = document.getElementById('results-container');

function init() {
    leagueSelect.innerHTML = '<option value="">Selecciona Liga</option>';
    Object.keys(footballData).forEach(l => leagueSelect.add(new Option(l, l)));
}

leagueSelect.onchange = () => {
    const teams = footballData[leagueSelect.value] || [];
    homeSelect.innerHTML = awaySelect.innerHTML = '<option value="">Equipo</option>';
    teams.forEach(t => {
        homeSelect.add(new Option(t.name, t.corners));
        awaySelect.add(new Option(t.name, t.corners));
    });
    homeSelect.disabled = awaySelect.disabled = false;
};

calcBtn.onclick = () => {
    const h = parseFloat(homeSelect.value);
    const a = parseFloat(awaySelect.value);
    if (!h || !a) return;

    const total = (h + a).toFixed(2);
    document.getElementById('total-c-val').textContent = total;
    resultsContainer.classList.remove('hidden');
    
    document.getElementById('markets-area').innerHTML = `
        <div class="market-card">
            <div style="display:flex; justify-content:space-between">
                <span>OVER 8.5</span>
                <span style="color:#4ade80">72%</span>
            </div>
            <div class="bar-container"><div class="bar-fill" style="width:72%"></div></div>
        </div>
    `;
    
    document.getElementById('verdict-area').innerHTML = `
        <h3 style="margin:0; color:#ef4444">VERDICTO FINAL</h3>
        <p>Alta probabilidad de Over en este encuentro.</p>
    `;
};

init();
