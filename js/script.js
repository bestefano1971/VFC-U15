// Futsal Analytics - Final Functional Version
// Includes: Smart Calendar, Full Charts, Navigation Logic (Fixed)

// --- Utility: Log & Debug ---
function logDebug(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    let msg = `[${timestamp}] ${message}`;
    if (data) msg += '\n' + JSON.stringify(data, null, 2);
    console.log(message, data);
    const out = document.getElementById('debug-output');
    if (out) {
        if (out.textContent === "In attesa di dati..." || out.textContent === "Inizializzazione...") out.textContent = "";
        out.textContent = msg + '\n' + '-'.repeat(40) + '\n' + out.textContent;
    }
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
let PLAYER_ROLES = {};
let TOTAL_MINUTES_PROCESSED = 0;
let APP_STATE = { players: {}, quartets: {}, goalkeepers: {}, processedFiles: [], totalGF: 0, totalGS: 0 };

function resetState() {
    APP_STATE = { players: {}, quartets: {}, goalkeepers: {}, processedFiles: [], totalGF: 0, totalGS: 0 };
    TOTAL_MINUTES_PROCESSED = 0;
    logDebug("State Reset Success");
}

// --- CORE PARSING ---
function processTimelineSheet(rows, sheetName) {
    if (!rows || rows.length < 2) return;

    // Find the header row (the one containing 'TIMING' or 'PORTIERI')
    let headerIdx = rows.findIndex(r => r && r.some(c => String(c || "").toUpperCase().includes("TIMING")));
    if (headerIdx === -1) {
        logDebug(`WARNING: Headers not found in sheet ${sheetName}`);
        return;
    }

    const headers = rows[headerIdx].map(h => (String(h) || "").toUpperCase().trim());
    const findIdx = (names) => headers.findIndex(h => names.some(n => h.includes(n)));
    const IDX = {
        TIMING: findIdx(["TIMING"]),
        PORTIERI: findIdx(["PORTIERI", "PORTIERE"]),
        Q1: findIdx(["Q1"]), Q2: findIdx(["Q2"]), Q3: findIdx(["Q3"]), Q4: findIdx(["Q4"]),
        GF: findIdx(["GOAL FATTI", "GOAL F", "RETI F"]),
        GS: findIdx(["GOAL SUBITI", "GOAL S", "RETI S"]),
        TF: findIdx(["TIRI IN PORTA", "TIRI IN"]),
        TO: findIdx(["TIRI OUT", "TIRI FUORI"]),
        PARATE: findIdx(["PARATE"]),
        PP: findIdx(["PALLE PERSE", "P.P.", "PP"]),
        PR: findIdx(["PALLE RECUPERATE", "P.R.", "PR"]),
        FF: findIdx(["FALLI FATTI"]), FS: findIdx(["FALLI SUBITI"])
    };
    if (IDX.TIMING === -1 || IDX.Q1 === -1) return;

    let lastQuartetKey = null;

    for (let i = headerIdx + 1; i < rows.length; i++) {
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
            APP_STATE.totalGF++;
            addStat(APP_STATE.players, scorerId, 'goals', 1);
            qMembers.forEach(pid => addStat(APP_STATE.players, pid, 'plusMinus', 1));
            addStat(APP_STATE.quartets, quartetKey, 'gf', 1);
        }
        if (hasValue(row[IDX.GS])) {
            APP_STATE.totalGS++;
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
    const cleanId = String(id).trim();
    if (!store[cleanId]) store[cleanId] = { id: cleanId, ...metadata };
    else if (metadata.members) store[cleanId].members = metadata.members;
    if (!store[cleanId][prop]) store[cleanId][prop] = 0;
    store[cleanId][prop] += val;
}
function hasValue(val) { return val !== undefined && val !== null && String(val).trim() !== ""; }
function formatTime(m) {
    if (!m || isNaN(m)) return "0:00";
    const mm = Math.floor(m), ss = Math.round((m - mm) * 60);
    return `${mm}:${ss.toString().padStart(2, '0')}`;
}

// --- UI LOGIC ---
function updateUI() {
    logDebug("Updating UI...");
    let activePlayers = [];
    let activeGoalkeepers = [];

    try {
        const totalTimeEl = document.getElementById('total-match-time');
        if (totalTimeEl) totalTimeEl.textContent = formatTime(TOTAL_MINUTES_PROCESSED);

        // Safeguard PLAYER_NAMES
        if (!PLAYER_NAMES || Object.keys(PLAYER_NAMES).length === 0) {
            if (typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.players_list) {
                PLAYER_NAMES = PRELOADED_DATABASE.players_list;
            }
        }

        activePlayers = Object.values(APP_STATE.players || {}).filter(p => p && (!APP_STATE.goalkeepers || !APP_STATE.goalkeepers[p.id]) && PLAYER_NAMES[p.id]);
        activeGoalkeepers = Object.values(APP_STATE.goalkeepers || {}).filter(g => g && PLAYER_NAMES[g.id]);

        // Official Stats from Classifica
        let classGF = 0, classGS = 0, classPG = 0;
        if (typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.classifica) {
            const valliRow = PRELOADED_DATABASE.classifica.find(r => {
                if (!r || !r[0]) return false;
                const name = String(r[0]).toUpperCase();
                return name.includes("VALLI") || name.includes("CHIOGGIA") || name.includes("V.F.C");
            });

            if (valliRow) {
                logDebug("MATCH FOUND in classifica:", valliRow);
                classPG = parseInt(valliRow[2]) || 0;
                classGF = parseInt(valliRow[6]) || 0;
                classGS = parseInt(valliRow[7]) || 0;

                const winsEl = document.getElementById('home-wins');
                const drawsEl = document.getElementById('home-draws');
                const lossesEl = document.getElementById('home-losses');
                if (winsEl) winsEl.textContent = valliRow[3] !== undefined ? valliRow[3] : 0;
                if (drawsEl) drawsEl.textContent = valliRow[4] !== undefined ? valliRow[4] : 0;
                if (lossesEl) lossesEl.textContent = valliRow[5] !== undefined ? valliRow[5] : 0;
            }
        }

        // Goal Calculation Logic (Max of Sync Files and Classifica)
        const finalGF = Math.max(APP_STATE.totalGF || 0, classGF);
        const finalGS = Math.max(APP_STATE.totalGS || 0, classGS);
        const finalPG = Math.max((APP_STATE.processedFiles || []).length, classPG);

        const matchesEl = document.getElementById('home-matches');
        const gfEl = document.getElementById('home-gf');
        const gsEl = document.getElementById('home-gs');

        if (matchesEl) matchesEl.textContent = finalPG;
        if (gfEl) gfEl.textContent = finalGF;
        if (gsEl) gsEl.textContent = finalGS;

        // Roster
        const rosterGrid = document.getElementById('roster-grid');
        if (rosterGrid) {
            rosterGrid.innerHTML = '';
            [...activeGoalkeepers, ...activePlayers].sort((a, b) => parseInt(a.id) - parseInt(b.id)).forEach(p => {
                if (!p || !p.id) return;
                const fullName = PLAYER_NAMES[p.id] || `ID: ${p.id}`;
                const isGk = !!(APP_STATE.goalkeepers && APP_STATE.goalkeepers[p.id]);
                const card = document.createElement('div');
                card.className = 'player-card';
                card.innerHTML = `
                <div class="player-photo-container">
                    <img src="assets/players/${p.id}.png" class="player-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                    <div class="player-placeholder" style="display:none;font-size:4rem;">👤</div>
                    <div class="player-number-badge">${p.id}</div>
                    ${isGk ? '<div class="player-role-badge">PORTIERE</div>' : (PLAYER_ROLES[p.id] ? `<div class="player-role-badge role-field">${PLAYER_ROLES[p.id]}</div>` : '')}
                </div>
                <div class="player-info">
                    <div class="player-name">${fullName}</div>
                    <div class="player-stats-mini">
                        <div class="stat-mini"><div class="stat-mini-label">MIN</div><div class="stat-mini-value">${Math.floor(p.minutes || 0)}</div></div>
                        <div class="stat-mini"><div class="stat-mini-label">${isGk ? 'GS' : 'GOAL'}</div><div class="stat-mini-value">${isGk ? (p.gs || 0) : (p.goals || 0)}</div></div>
                        <div class="stat-mini">
                            <div class="stat-mini-label">PR-PP</div>
                            <div class="stat-mini-value" style="color: ${(p.pr || 0) - (p.pp || 0) > 0 ? 'var(--success)' : ((p.pr || 0) - (p.pp || 0) < 0 ? 'var(--danger)' : 'var(--text-muted)')}">
                                ${(p.pr || 0) - (p.pp || 0) > 0 ? '+' : ''}${(p.pr || 0) - (p.pp || 0)}
                            </div>
                        </div>
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
                if (!row || row.length === 0) return;
                const rowText = row.map(c => typeof c === 'object' ? (c ? c.text : '') : String(c || '')).join(' ').toUpperCase();
                if (rowText.includes("CAMPIONATO REGIONALE") || row.every(c => !c)) return;

                const tr = document.createElement('tr');
                if (String(row[0] || '').length > 0 && (!row[1] || String(row[1]) === '')) {
                    const td = document.createElement('td');
                    td.textContent = (typeof row[0] === 'object' ? (row[0] ? row[0].text : '') : String(row[0])).toUpperCase();
                    td.colSpan = 10; td.style.fontWeight = '800'; td.style.textAlign = 'center'; td.style.background = 'var(--bg)';
                    tr.appendChild(td);
                } else {
                    let dateIdx = row.findIndex(c => { const s = typeof c === 'object' ? (c ? c.text : '') : String(c || ''); return s.match(/\d{1,2}[\/\-]\d{1,2}/); });
                    const isHeader = row[0] === 'DATA';
                    if (dateIdx === -1) dateIdx = isHeader ? 0 : 0;

                    const tdDate = document.createElement('td');
                    tdDate.className = 'cal-date';
                    if (dateIdx !== -1 && row[dateIdx]) tdDate.textContent = typeof row[dateIdx] === 'object' ? (row[dateIdx] ? row[dateIdx].text : '') : String(row[dateIdx]);
                    if (isHeader) tdDate.style.fontWeight = 'bold';
                    tr.appendChild(tdDate);

                    for (let i = 0; i < row.length; i++) {
                        if (i === dateIdx) continue;
                        const cell = row[i];
                        if (typeof cell === 'object' && cell && cell.url) continue;
                        const td = document.createElement('td'); td.className = 'cal-content';
                        const s = String(cell || '');
                        td.textContent = s;
                        if (s.toUpperCase().includes('VALLI')) td.classList.add('highlight-valli');
                        if (isHeader) td.style.fontWeight = 'bold';
                        tr.appendChild(td);
                    }

                    let linkCells = [];
                    row.forEach(cell => { if (cell && typeof cell === 'object' && cell.url) linkCells.push(cell); });
                    if (linkCells.length > 0) {
                        const getScore = (text) => {
                            const t = (text || "").toUpperCase();
                            if (t.includes('MDAY')) return 1;
                            if (t.includes('MVP')) return 2;
                            if (t.includes('HIGH') || t.includes('HIGHT')) return 3;
                            return 4;
                        };
                        linkCells.sort((a, b) => getScore(a.text) - getScore(b.text));
                        linkCells.forEach(cell => {
                            const td = document.createElement('td'); td.className = 'cal-link';
                            const icon = cell.text.toUpperCase().includes('MDAY') || cell.url.match(/\.(jpg|png)$/i) ? '📸' : '🎬';
                            td.innerHTML = `<a href="${cell.url}" target="_blank" class="highlight-link">${icon} ${cell.text}</a>`;
                            tr.appendChild(td);
                        });
                    } else if (!isHeader) {
                        tr.appendChild(document.createElement('td'));
                    }
                }
                calTable.appendChild(tr);
            });
        }

        // Classifica
        const claTable = document.querySelector('#classifica-table tbody');
        if (claTable && typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.classifica) {
            claTable.innerHTML = '';
            PRELOADED_DATABASE.classifica.forEach(row => {
                if (!row || row.every(c => !c)) return;
                const tr = document.createElement('tr');
                if (row.join(' ').toUpperCase().includes("VALLI")) tr.classList.add('highlight-valli');
                row.forEach(c => { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
                claTable.appendChild(tr);
            });
        }

        // Render Charts
        if (activePlayers.length > 0 && typeof Chart !== 'undefined') {
            try { renderCharts(activePlayers); } catch (e) { console.error("Chart Error:", e); }
        }

        // Render Stats Tables
        renderPlayersTable(activePlayers);
        renderGoalkeepersTable(activeGoalkeepers);
        renderQuartetsTable();
        renderFilesTable();

    } catch (err) {
        logDebug("CRITICAL ERROR in updateUI: " + err.stack);
    }
}

function renderPlayersTable(players) {
    const tbody = document.querySelector('#players-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    players.sort((a, b) => (b.goals || 0) - (a.goals || 0));
    players.forEach(p => {
        const tr = document.createElement('tr');
        const name = PLAYER_NAMES[p.id] || `Player ${p.id}`;
        const totalShots = (p.shotsOn || 0) + (p.shotsOff || 0);
        tr.innerHTML = `
            <td>${p.id}</td><td>${name}</td><td>${formatTime(p.minutes)}</td><td class="text-success">${p.goals || 0}</td><td class="text-danger">${p.gs || 0}</td>
            <td>${totalShots} <small class="text-muted">(${p.shotsOn || 0})</small></td><td>${p.pr || 0}</td><td>${p.pp || 0}</td><td>${p.ff || 0}</td><td>${p.fs || 0}</td><td>${p.plusMinus || 0}</td> 
        `;
        tbody.appendChild(tr);
    });
}

function renderGoalkeepersTable(gks) {
    const tbody = document.querySelector('#goalkeepers-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    gks.sort((a, b) => b.minutes - a.minutes);
    gks.forEach(g => {
        const tr = document.createElement('tr');
        const name = PLAYER_NAMES[g.id] || `GK ${g.id}`;
        tr.innerHTML = `
            <td>${name}</td><td>${formatTime(g.minutes)}</td><td class="text-danger" style="font-weight:bold;">${g.gs || 0}</td>
            <td class="text-muted">${g.goalsSX || 0}</td><td class="text-muted">${g.goalsCT || 0}</td><td class="text-muted">${g.goalsDX || 0}</td>
            <td class="text-success" style="font-weight:bold;">${g.saves || 0}</td><td class="text-muted">${g.savesSX || 0}</td><td class="text-muted">${g.savesCT || 0}</td><td class="text-muted">${g.savesDX || 0}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderQuartetsTable() {
    const tbody = document.querySelector('#quartets-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const quartets = Object.values(APP_STATE.quartets).sort((a, b) => b.minutes - a.minutes);
    quartets.forEach(q => {
        const tr = document.createElement('tr');
        const names = q.members.map(id => String(PLAYER_NAMES[id] || id).split(' ')[0]).join(', ');
        const totalShots = (q.shotsOn || 0) + (q.shotsOff || 0);
        const plusMinus = (q.gf || 0) - (q.gs || 0);
        tr.innerHTML = `
            <td style="font-size: 0.85rem;">${names}</td><td class="text-success">${q.gf || 0}</td><td class="text-danger">${q.gs || 0}</td>
            <td>${totalShots}</td><td>${q.shotsAgainst || 0}</td><td>${q.pr || 0}</td><td>${q.pp || 0}</td><td>${q.freq || 0}</td>
            <td style="color: ${plusMinus > 0 ? 'var(--success)' : (plusMinus < 0 ? 'var(--danger)' : 'inherit')}">${plusMinus > 0 ? '+' + plusMinus : plusMinus}</td><td>${formatTime(q.minutes)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFilesTable() {
    const tbody = document.querySelector('#files-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    APP_STATE.processedFiles.forEach((f, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${idx + 1}</td><td>${f}</td><td><span class="badge text-success">Caricato</span></td>`;
        tbody.appendChild(tr);
    });
}

let chartInstances = {};
function renderCharts(players) {
    if (chartInstances.goals) chartInstances.goals.destroy();
    const ctxGoals = document.getElementById('playersGoalsChart');
    if (ctxGoals) {
        const top = players.sort((a, b) => (b.goals || 0) - (a.goals || 0)).slice(0, 10);
        chartInstances.goals = new Chart(ctxGoals.getContext('2d'), {
            type: 'bar',
            data: {
                labels: top.map(p => String(PLAYER_NAMES[p.id] || p.id).split(' ')[0]),
                datasets: [{ label: 'Goal', data: top.map(p => p.goals || 0), backgroundColor: '#6366f1' }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.quartets) chartInstances.quartets.destroy();
    const ctxQ = document.getElementById('quartetsPerformanceChart');
    if (ctxQ) {
        const topQ = Object.values(APP_STATE.quartets).sort((a, b) => ((b.gf || 0) - (b.gs || 0)) - ((a.gf || 0) - (a.gs || 0))).slice(0, 6);
        chartInstances.quartets = new Chart(ctxQ.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topQ.map(q => q.members.map(id => String(PLAYER_NAMES[id] || id).split(' ')[0]).join('-')),
                datasets: [{ label: 'GF', data: topQ.map(q => q.gf || 0), backgroundColor: '#22c55e' }, { label: 'GS', data: topQ.map(q => q.gs || 0), backgroundColor: '#ef4444' }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.goalkeepers) chartInstances.goalkeepers.destroy();
    const ctxGK = document.getElementById('goalkeepersChart');
    if (ctxGK) {
        const gks = Object.values(APP_STATE.goalkeepers).sort((a, b) => b.minutes - a.minutes);
        chartInstances.goalkeepers = new Chart(ctxGK.getContext('2d'), {
            type: 'bar',
            data: {
                labels: gks.map(g => String(PLAYER_NAMES[g.id] || g.id).split(' ')[0]),
                datasets: [{ label: 'Parate', data: gks.map(g => g.saves || 0), backgroundColor: '#22c55e' }, { label: 'GS', data: gks.map(g => -(g.gs || 0)), backgroundColor: '#ef4444' }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    // Tabs
    const protectedViews = ['files-view', 'debug-view'];
    const STAFF_PASSWORD = 'valli2025';

    document.querySelectorAll('.tab-btn').forEach(t => t.addEventListener('click', () => {
        const targetId = t.dataset.target;
        if (protectedViews.includes(targetId)) {
            const pass = prompt("Area Riservata allo Staff. Inserisci la password:");
            if (pass !== STAFF_PASSWORD) { alert("Password errata. Accesso negato."); return; }
        }
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.view-content').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tg = document.getElementById(targetId);
        if (tg) tg.classList.add('active');
    }));

    document.querySelectorAll('.sub-tab-btn').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.sub-tab-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.sub-view').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tg = document.getElementById(t.dataset.subtarget);
        if (tg) tg.classList.add('active');
    }));

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

    document.querySelectorAll('.quick-link-btn').forEach(b => b.addEventListener('click', () => navigateTo(b.dataset.goto)));
    document.querySelectorAll('.stat-clickable').forEach(c => c.addEventListener('click', () => navigateTo(c.dataset.goto)));

    // Data Load
    const loadDB = () => {
        logDebug("Inizio caricamento database...");

        if (typeof PRELOADED_DATABASE === 'undefined') {
            logDebug("ERRORE: PRELOADED_DATABASE non trovato.");
            return;
        }

        resetState();

        if (PRELOADED_DATABASE.players_list) PLAYER_NAMES = PRELOADED_DATABASE.players_list;
        if (PRELOADED_DATABASE.players_roles) PLAYER_ROLES = PRELOADED_DATABASE.players_roles;

        if (PRELOADED_DATABASE.matches) {
            PRELOADED_DATABASE.matches.forEach(m => {
                if (m.name) APP_STATE.processedFiles.push(m.name);
                if (m.sheets) m.sheets.forEach(s => { if (s.rows) processTimelineSheet(s.rows, s.name); });
            });
        }

        logDebug(`Dati caricati: ${APP_STATE.processedFiles.length} file elaborati.`);
        updateUI();
    };
    loadDB();

});
