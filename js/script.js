// Futsal Analytics - Final Functional Version
// Includes: Smart Calendar, Full Charts, Navigation Logic (Fixed)

// --- Utility: Log & Debug ---
const debugOutput = document.getElementById('debug-output');
function logDebug(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    let msg = `[${timestamp}] ${message}`;
    if (data) msg += '\n' + JSON.stringify(data, null, 2);
    console.log(message, data);
    if (debugOutput) debugOutput.textContent = msg + '\n' + '-'.repeat(40) + '\n' + debugOutput.textContent;
}

// Global Error Handler
window.onerror = function (msg, url, line) {
    console.error(`Error: ${msg} at ${line}`);
};

// --- CONSTANTS ---
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_PER_DAY = 24 * 60;

// --- STATE ---
let PLAYER_NAMES = {};
let TOTAL_MINUTES_PROCESSED = 0;
let APP_STATE = { players: {}, quartets: {}, goalkeepers: {}, processedFiles: [] };

function resetState() {
    APP_STATE = { players: {}, quartets: {}, goalkeepers: {}, processedFiles: [] };
    TOTAL_MINUTES_PROCESSED = 0;
}

// --- CORE PARSING ---
function processTimelineSheet(rows, sheetName) {
    if (!rows || rows.length < 2) return;
    const headers = rows[0].map(h => (String(h) || "").toUpperCase().trim());
    const IDX = {
        TIMING: headers.indexOf("TIMING"),
        PORTIERI: headers.indexOf("PORTIERI"),
        Q1: headers.indexOf("Q1"), Q2: headers.indexOf("Q2"), Q3: headers.indexOf("Q3"), Q4: headers.indexOf("Q4"),
        GF: headers.indexOf("GOAL FATTI"), GS: headers.indexOf("GOAL SUBITI"),
        TF: headers.indexOf("TIRI IN PORTA"), TO: headers.indexOf("TIRI OUT"),
        PARATE: headers.indexOf("PARATE"), PP: headers.indexOf("PALLE PERSE"), PR: headers.indexOf("PALLE RECUPERATE"),
        FF: headers.indexOf("FALLI FATTI"), FS: headers.indexOf("FALLI SUBITI")
    };
    if (IDX.TIMING === -1 || IDX.Q1 === -1) return;

    let lastQuartetKey = null;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nextRow = rows[i + 1];
        let duration = 0;
        const toDecimalTime = (val) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string' && val.includes(':')) {
                const parts = val.split(':').map(Number);
                if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) / 86400;
                if (parts.length === 2) return (parts[0] * 60 + parts[1]) / 86400;
            }
            return parseFloat(val);
        };
        const t1 = toDecimalTime(row[IDX.TIMING]);
        if (isNaN(t1)) continue;
        if (nextRow) {
            const t2 = toDecimalTime(nextRow[IDX.TIMING]);
            if (!isNaN(t2) && t2 > t1) {
                duration = (t2 - t1) * MIN_PER_DAY;
                TOTAL_MINUTES_PROCESSED += duration;
            }
        }

        const gkId = row[IDX.PORTIERI];
        if (hasValue(gkId)) {
            addStat(APP_STATE.goalkeepers, gkId, 'minutes', duration);
            if (hasValue(row[IDX.PARATE])) {
                addStat(APP_STATE.goalkeepers, gkId, 'saves', 1);
                const s = String(row[IDX.PARATE]).toUpperCase();
                if (s.includes("SX")) addStat(APP_STATE.goalkeepers, gkId, 'savesSX', 1);
                else if (s.includes("DX")) addStat(APP_STATE.goalkeepers, gkId, 'savesDX', 1);
                else addStat(APP_STATE.goalkeepers, gkId, 'savesCT', 1);
            }
            if (hasValue(row[IDX.GS])) {
                addStat(APP_STATE.goalkeepers, gkId, 'gs', 1);
                const s = String(row[IDX.GS]).toUpperCase();
                if (s.includes("SX")) addStat(APP_STATE.goalkeepers, gkId, 'goalsSX', 1);
                else if (s.includes("DX")) addStat(APP_STATE.goalkeepers, gkId, 'goalsDX', 1);
                else addStat(APP_STATE.goalkeepers, gkId, 'goalsCT', 1);
            }
        }

        const qMembers = [row[IDX.Q1], row[IDX.Q2], row[IDX.Q3], row[IDX.Q4]].filter(x => hasValue(x));
        if (qMembers.length === 0) continue;
        const quartetKey = qMembers.sort().join("-");
        if (quartetKey !== lastQuartetKey) {
            addStat(APP_STATE.quartets, quartetKey, 'freq', 1);
            lastQuartetKey = quartetKey;
        }

        qMembers.forEach(pid => addStat(APP_STATE.players, pid, 'minutes', duration));
        addStat(APP_STATE.quartets, quartetKey, 'minutes', duration, { members: qMembers });

        const scorerId = row[IDX.GF];
        if (hasValue(scorerId)) {
            addStat(APP_STATE.players, scorerId, 'goals', 1);
            qMembers.forEach(pid => addStat(APP_STATE.players, pid, 'plusMinus', 1));
            addStat(APP_STATE.quartets, quartetKey, 'gf', 1);
        }
        if (hasValue(row[IDX.GS])) {
            qMembers.forEach(pid => { addStat(APP_STATE.players, pid, 'gs', 1); addStat(APP_STATE.players, pid, 'plusMinus', -1); });
            addStat(APP_STATE.quartets, quartetKey, 'gs', 1);
        }
        if (hasValue(row[IDX.TF])) { addStat(APP_STATE.players, row[IDX.TF], 'shotsOn', 1); addStat(APP_STATE.quartets, quartetKey, 'shotsOn', 1); }
        if (hasValue(row[IDX.TO])) { addStat(APP_STATE.players, row[IDX.TO], 'shotsOff', 1); addStat(APP_STATE.quartets, quartetKey, 'shotsOff', 1); }
        if (hasValue(row[IDX.GS])) addStat(APP_STATE.quartets, quartetKey, 'shotsAgainst', 1);
        if (hasValue(row[IDX.PP])) { addStat(APP_STATE.players, row[IDX.PP], 'pp', 1); addStat(APP_STATE.quartets, quartetKey, 'pp', 1); }
        if (hasValue(row[IDX.PR])) { addStat(APP_STATE.players, row[IDX.PR], 'pr', 1); addStat(APP_STATE.quartets, quartetKey, 'pr', 1); }
        if (hasValue(row[IDX.FF])) addStat(APP_STATE.players, row[IDX.FF], 'ff', 1);
        if (hasValue(row[IDX.FS])) addStat(APP_STATE.players, row[IDX.FS], 'fs', 1);
    }
}

function addStat(store, id, prop, val, metadata = {}) {
    if (!store[id]) store[id] = { id: id, ...metadata };
    else Object.assign(store[id], metadata);
    if (!store[id][prop]) store[id][prop] = 0;
    store[id][prop] += val;
}
function hasValue(val) { return val !== undefined && val !== null && val !== ""; }
function formatTime(m) {
    if (!m) return "0:00";
    const mm = Math.floor(m), ss = Math.round((m - mm) * 60);
    return `${mm}:${ss.toString().padStart(2, '0')}`;
}

// --- UI LOGIC ---
function updateUI() {
    document.getElementById('home-matches').textContent = APP_STATE.processedFiles.length;
    document.getElementById('home-time').textContent = formatTime(TOTAL_MINUTES_PROCESSED);
    document.getElementById('total-match-time').textContent = formatTime(TOTAL_MINUTES_PROCESSED);

    const activePlayers = Object.values(APP_STATE.players).filter(p => !APP_STATE.goalkeepers[p.id] && PLAYER_NAMES[p.id]);
    const activeGoalkeepers = Object.values(APP_STATE.goalkeepers).filter(g => PLAYER_NAMES[g.id]);
    document.getElementById('home-players').textContent = activePlayers.length + activeGoalkeepers.length;

    if (activePlayers.length > 0) {
        const topScorer = activePlayers.sort((a, b) => (b.goals || 0) - (a.goals || 0))[0];
        const topName = PLAYER_NAMES[topScorer.id] || `Player ${topScorer.id}`;
        document.getElementById('home-top-scorer').textContent = `${topName.split(' ')[0]} (${topScorer.goals || 0})`;
    }

    // Roster
    const rosterGrid = document.getElementById('roster-grid');
    if (rosterGrid) {
        rosterGrid.innerHTML = '';
        [...activeGoalkeepers, ...activePlayers].sort((a, b) => parseInt(a.id) - parseInt(b.id)).forEach(p => {
            const fullName = PLAYER_NAMES[p.id];
            const isGk = !!APP_STATE.goalkeepers[p.id];
            const card = document.createElement('div');
            card.className = 'player-card';
            card.innerHTML = `
                <div class="player-photo-container">
                    <img src="assets/players/${p.id}.png" class="player-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                    <div class="player-placeholder" style="display:none;font-size:4rem;">👤</div>
                    <div class="player-number-badge">${p.id}</div>
                    ${isGk ? '<div class="player-role-badge">PORTIERE</div>' : ''}
                </div>
                <div class="player-info">
                    <div class="player-name">${fullName}</div>
                    <div class="player-stats-mini">
                        <div class="stat-mini"><div class="stat-mini-label">MIN</div><div class="stat-mini-value">${Math.floor(p.minutes || 0)}</div></div>
                        <div class="stat-mini"><div class="stat-mini-label">${isGk ? 'GS' : 'GOAL'}</div><div class="stat-mini-value">${isGk ? (p.gs || 0) : (p.goals || 0)}</div></div>
                    </div>
                </div>`;
            rosterGrid.appendChild(card);
        });
    }

    // Calendar Smart Logic
    const calTable = document.querySelector('#calendario-table tbody');
    if (calTable && typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.calendario) {
        calTable.innerHTML = '';
        PRELOADED_DATABASE.calendario.forEach(row => {
            const rowText = row.map(c => typeof c === 'object' ? c.text : String(c || '')).join(' ').toUpperCase();
            if (rowText.includes("CAMPIONATO REGIONALE") || row.every(c => !c)) return;

            const tr = document.createElement('tr');
            if (String(row[0] || '').length > 0 && (!row[1] || String(row[1]) === '')) {
                // Header
                const td = document.createElement('td');
                td.textContent = (typeof row[0] === 'object' ? row[0].text : String(row[0])).toUpperCase();
                td.colSpan = 10; td.style.fontWeight = '800'; td.style.textAlign = 'center'; td.style.background = 'var(--bg)';
                tr.appendChild(td);
            } else {
                // Data Row
                let dateIdx = row.findIndex(c => { const s = typeof c === 'object' ? c.text : String(c || ''); return s.match(/\d{1,2}[\/\-]\d{1,2}/); });
                if (dateIdx === -1 && row[5]) dateIdx = 5;
                else if (dateIdx === -1) dateIdx = 2;

                const tdDate = document.createElement('td'); tdDate.className = 'cal-date';
                if (dateIdx !== -1 && row[dateIdx]) tdDate.textContent = typeof row[dateIdx] === 'object' ? row[dateIdx].text : String(row[dateIdx]);
                tr.appendChild(tdDate);

                for (let i = 2; i < row.length; i++) {
                    if (i === dateIdx) continue;
                    const cell = row[i];
                    if (typeof cell === 'object' && cell.url) continue;
                    const td = document.createElement('td'); td.className = 'cal-content';
                    const s = String(cell || '');
                    td.textContent = s;
                    if (s.toUpperCase().includes('VALLI')) td.classList.add('highlight-valli');
                    tr.appendChild(td);
                }

                let linkFound = false;
                row.forEach(cell => {
                    if (typeof cell === 'object' && cell.url) {
                        const td = document.createElement('td'); td.className = 'cal-link';
                        const icon = cell.text.toUpperCase().includes('MDAY') || cell.url.match(/\.(jpg|png)$/i) ? '📸' : '🎬';
                        td.innerHTML = `<a href="${cell.url}" target="_blank" class="highlight-link">${icon} ${cell.text}</a>`;
                        tr.appendChild(td);
                        linkFound = true;
                    }
                });
                if (!linkFound) tr.appendChild(document.createElement('td'));
            }
            calTable.appendChild(tr);
        });
    }

    // Classifica
    const claTable = document.querySelector('#classifica-table tbody');
    if (claTable && typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.classifica) {
        claTable.innerHTML = '';
        PRELOADED_DATABASE.classifica.forEach(row => {
            if (row.every(c => !c)) return;
            const tr = document.createElement('tr');
            if (row.join(' ').toUpperCase().includes("VALLI")) tr.classList.add('highlight-valli');
            row.forEach(c => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
            claTable.appendChild(tr);
        });
    }

    // --- SHOW DASHBOARD ---
    const db = document.getElementById('dashboard');
    if (db) db.classList.remove('hidden');

    // Render Charts
    if (activePlayers.length > 0 && typeof Chart !== 'undefined') {
        try { renderCharts(activePlayers); } catch (e) { console.error("Chart Error", e); }
    }
}

let chartInstances = {};
function renderCharts(players) {
    // 1. Goals Chart
    if (chartInstances.goals) chartInstances.goals.destroy();
    const ctxGoals = document.getElementById('playersGoalsChart');
    if (ctxGoals) {
        const top = players.sort((a, b) => (b.goals || 0) - (a.goals || 0)).slice(0, 10);
        chartInstances.goals = new Chart(ctxGoals.getContext('2d'), {
            type: 'bar',
            data: {
                labels: top.map(p => PLAYER_NAMES[p.id].split(' ')[0]),
                datasets: [{ label: 'Goal', data: top.map(p => p.goals || 0), backgroundColor: '#6366f1' }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // 2. Quartets Chart
    if (chartInstances.quartets) chartInstances.quartets.destroy();
    const ctxQ = document.getElementById('quartetsPerformanceChart');
    if (ctxQ) {
        const topQ = Object.values(APP_STATE.quartets).sort((a, b) => ((b.gf || 0) - (b.gs || 0)) - ((a.gf || 0) - (a.gs || 0))).slice(0, 6);
        chartInstances.quartets = new Chart(ctxQ.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topQ.map(q => q.members.map(id => (PLAYER_NAMES[id] || '').split(' ')[0]).join('-')),
                datasets: [
                    { label: 'GF', data: topQ.map(q => q.gf || 0), backgroundColor: '#22c55e' },
                    { label: 'GS', data: topQ.map(q => q.gs || 0), backgroundColor: '#ef4444' }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    // 3. Goalkeepers Chart
    if (chartInstances.goalkeepers) chartInstances.goalkeepers.destroy();
    const ctxGK = document.getElementById('goalkeepersChart');
    if (ctxGK) {
        const gks = Object.values(APP_STATE.goalkeepers).sort((a, b) => b.minutes - a.minutes);
        chartInstances.goalkeepers = new Chart(ctxGK.getContext('2d'), {
            type: 'bar',
            data: {
                labels: gks.map(g => (PLAYER_NAMES[g.id] || '').split(' ')[0]),
                datasets: [
                    { label: 'Parate', data: gks.map(g => g.saves || 0), backgroundColor: '#22c55e' },
                    { label: 'GS', data: gks.map(g => -(g.gs || 0)), backgroundColor: '#ef4444' }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    logDebug("App Initialized");

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.view-content').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tg = document.getElementById(t.dataset.target);
        if (tg) tg.classList.add('active');
    }));

    // Sub-Tabs
    document.querySelectorAll('.sub-tab-btn').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.sub-tab-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.sub-view').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tg = document.getElementById(t.dataset.subtarget);
        if (tg) tg.classList.add('active');
    }));

    // Advanced Navigation Helper
    function navigateTo(targetView) {
        const mainTab = document.querySelector(`[data-target="${targetView}"]`);
        if (mainTab) { mainTab.click(); return; }
        const subTab = document.querySelector(`[data-subtarget="${targetView}"]`);
        if (subTab) {
            const statTab = document.querySelector('[data-target="stats-container-view"]');
            if (statTab) statTab.click();
            subTab.click();
        }
    }

    // Quick Links & Stat Cards
    document.querySelectorAll('.quick-link-btn').forEach(b => b.addEventListener('click', () => navigateTo(b.dataset.goto)));
    document.querySelectorAll('.stat-clickable').forEach(c => c.addEventListener('click', () => navigateTo(c.dataset.goto)));

    // Data Load
    const loadDB = () => {
        if (typeof PRELOADED_DATABASE === 'undefined') return;
        resetState();
        if (PRELOADED_DATABASE.players_list) PLAYER_NAMES = PRELOADED_DATABASE.players_list;
        if (PRELOADED_DATABASE.matches) {
            PRELOADED_DATABASE.matches.forEach(m => {
                if (m.name) APP_STATE.processedFiles.push(m.name);
                m.sheets.forEach(s => processTimelineSheet(s.rows, s.name));
            });
        }
        updateUI();
    };
    loadDB();

    // Auto-Sync
    window.forceSync = function () {
        const s = document.createElement('script');
        s.src = `js/database.js?t=${Date.now()}`;
        s.onload = loadDB;
        document.body.appendChild(s);
    };
});
