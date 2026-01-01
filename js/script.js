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

// --- TAB RENDER LOGIC ---
function renderTabsWithLocks() {
    const userRole = localStorage.getItem('currentUserRole');
    let permissions = [];

    // Attempt to load permissions from DB
    if (typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.permissions) {
        permissions = PRELOADED_DATABASE.permissions;
    }

    const tabsContainer = document.querySelector('.tabs');
    if (!tabsContainer) return;

    let rolePerms = permissions.find(p => p.Ruolo === userRole || p.Ruolo_Accesso === userRole);

    // Default Fallback
    if (!rolePerms) {
        if (userRole === 'Admin') {
            rolePerms = { Home: true, Rosa: true, Staff: true, Statistiche: true, Calendario: true, Classifica: true, Schemi: true, Relazioni: true, Setup: true };
        } else {
            // Default restricted for unknown
            rolePerms = { Home: true, Rosa: true, Staff: true, Statistiche: true, Calendario: true, Classifica: true, Schemi: false, Relazioni: false, Setup: false };
        }
    }

    const tabs = tabsContainer.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
        const text = btn.textContent.replace(' 🔒', '').trim();
        let label = text;
        const keyMap = {
            "HOME": "Home", "ROSA": "Rosa", "STAFF": "Staff",
            "STATISTICHE": "Statistiche", "CALENDARIO": "Calendario", "CLASSIFICA": "Classifica",
            "SCHEMI": "Schemi", "RELAZIONI": "Relazioni", "SETUP": "Setup"
        };
        const permKey = keyMap[label.toUpperCase()] || label;

        let allowed = false;
        if (rolePerms) {
            const v = rolePerms[permKey];
            if (v === true || v === 1 || String(v).toLowerCase() === 'true') {
                allowed = true;
            }
        }

        // Safety: Admin is always allowed (case-insensitive)
        if (String(userRole).toUpperCase() === 'ADMIN') allowed = true;

        if (!allowed) {
            btn.textContent = label + ' 🔒';
            btn.setAttribute('data-locked', 'true');
            btn.classList.add('locked-tab');
        } else {
            btn.textContent = label;
            btn.removeAttribute('data-locked');
            btn.classList.remove('locked-tab');
        }
    });
}

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
        if (hasValue(scorerId) && scorerId != 0) {
            APP_STATE.totalGF++;
            addStat(APP_STATE.players, scorerId, 'goals', 1);
            qMembers.forEach(pid => addStat(APP_STATE.players, pid, 'plusMinus', 1));
            addStat(APP_STATE.quartets, quartetKey, 'gf', 1);
        }
        if (hasValue(row[IDX.GS]) && row[IDX.GS] != 0) {
            APP_STATE.totalGS++;
            qMembers.forEach(pid => { addStat(APP_STATE.players, pid, 'gs', 1); addStat(APP_STATE.players, pid, 'plusMinus', -1); });
            addStat(APP_STATE.quartets, quartetKey, 'gs', 1);
        }
        if (hasValue(row[IDX.TF]) && row[IDX.TF] != 0) { addStat(APP_STATE.players, row[IDX.TF], 'shotsOn', 1); addStat(APP_STATE.quartets, quartetKey, 'shotsOn', 1); }
        if (hasValue(row[IDX.TO]) && row[IDX.TO] != 0) { addStat(APP_STATE.players, row[IDX.TO], 'shotsOff', 1); addStat(APP_STATE.quartets, quartetKey, 'shotsOff', 1); }
        if (hasValue(row[IDX.GS]) && row[IDX.GS] != 0) addStat(APP_STATE.quartets, quartetKey, 'shotsAgainst', 1);
        if (hasValue(row[IDX.PP]) && row[IDX.PP] != 0) { addStat(APP_STATE.players, row[IDX.PP], 'pp', 1); addStat(APP_STATE.quartets, quartetKey, 'pp', 1); }
        if (hasValue(row[IDX.PR]) && row[IDX.PR] != 0) { addStat(APP_STATE.players, row[IDX.PR], 'pr', 1); addStat(APP_STATE.quartets, quartetKey, 'pr', 1); }
        if (hasValue(row[IDX.FF]) && row[IDX.FF] != 0) addStat(APP_STATE.players, row[IDX.FF], 'ff', 1);
        if (hasValue(row[IDX.FS]) && row[IDX.FS] != 0) addStat(APP_STATE.players, row[IDX.FS], 'fs', 1);
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

        const allIds = Object.keys(PLAYER_NAMES).map(k => parseInt(k));
        activePlayers = [];
        activeGoalkeepers = [];

        allIds.forEach(id => {
            const role = PLAYER_ROLES[id];
            const isGkRole = role === 'PORTIERE';
            const hasGkStats = APP_STATE.goalkeepers && APP_STATE.goalkeepers[id];

            if (isGkRole || hasGkStats) {
                const gState = (APP_STATE.goalkeepers && APP_STATE.goalkeepers[id]) || { id: id, minutes: 0, gs: 0, goalsSX: 0, goalsCT: 0, goalsDX: 0, saves: 0, savesSX: 0, savesCT: 0, savesDX: 0 };
                activeGoalkeepers.push(gState);
            } else {
                const pState = (APP_STATE.players && APP_STATE.players[id]) || { id: id, minutes: 0, goals: 0, gs: 0, pr: 0, pp: 0, shotsOn: 0, shotsOff: 0, ff: 0, fs: 0, plusMinus: 0 };
                activePlayers.push(pState);
            }
        });

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
        // Goal Calculation Logic (Strictly from processed files for consistency)
        const finalGF = APP_STATE.totalGF || 0;
        const finalGS = APP_STATE.totalGS || 0;
        const finalPG = (APP_STATE.processedFiles || []).length; // Use loaded files count for consistency

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
            const allIds = Object.keys(PLAYER_NAMES).map(k => parseInt(k)).sort((a, b) => a - b);

            allIds.forEach(id => {
                const pState = (APP_STATE.players && APP_STATE.players[id]) || (APP_STATE.goalkeepers && APP_STATE.goalkeepers[id]);
                // Default object if no stats
                const p = pState || { id: id, minutes: 0, goals: 0, gs: 0, pr: 0, pp: 0 };

                let fullName = PLAYER_NAMES[id] || `ID: ${id}`;
                const role = PLAYER_ROLES[id];
                const isGk = role === 'PORTIERE' || (APP_STATE.goalkeepers && APP_STATE.goalkeepers[id]);
                const isCaptain = id === 4; // Biolcati is Captain

                const card = document.createElement('div');
                card.className = 'player-card';
                card.innerHTML = `
                <div class="player-photo-container">
                    <img src="assets/players/${id}.png" class="player-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                    <div class="player-placeholder" style="display:none;font-size:4rem;">👤</div>
                    <div class="player-number-badge">${id}</div>
                    ${isGk ? '<div class="player-role-badge">PORTIERE</div>' : (role ? `<div class="player-role-badge role-field">${role}</div>` : '')}
                </div>
                <div class="player-info">
                    <div class="player-name">${fullName} ${isCaptain ? '<span style="color:var(--primary); font-weight:bold; margin-left:5px;" title="Capitano">©</span>' : ''}</div>
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
                const rowStr = row.join(' ').toUpperCase();
                if (rowStr.includes("CAMPIONATO")) return;
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
        renderPresenzeTable();
        renderRelazioniList();
        renderFilesTable();
        // Update Tabs Locks
        renderTabsWithLocks();

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

function renderPresenzeTable() {
    const container = document.querySelector('#presenze-view .card-body');
    if (!container) {
        console.error("Presenze view container not found");
        return;
    }

    // Check if data exists
    if (!PRELOADED_DATABASE.presenze || PRELOADED_DATABASE.presenze.length < 2) {
        console.warn("Presenze data insufficient:", PRELOADED_DATABASE.presenze);
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Nessun dato presenze disponibile (Dati insufficienti).</div>';
        return;
    }

    const data = PRELOADED_DATABASE.presenze;
    console.log("Presenze Data Loaded:", data);
    const headerRow = data[0];
    const totalRow = data[data.length - 1];
    const playersList = PRELOADED_DATABASE.players_list || {};

    // Helper to fuzzy find player ID
    const findPlayerId = (sheetName) => {
        // Normalize: lowercase, remove accents, remove dots, extra spaces
        const sName = sheetName.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/\./g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Specific overrides with HARDCODED IDs for fail-safety
        if (sName.includes('riki') || sName.includes('riccardo')) return "11";

        // Distinguish Niccolò Mantovan vs Nicola Veneziani
        if (sName.includes('mantovan') || sName.includes('nicolo m') || sName.includes('niccolo m')) return "9";

        if (sName.includes('nicola v') || sName.includes('veneziani nicola')) return "10";

        // Fallback for just "Nicola" or "Nicolo" if ambiguous, default to one or check more
        if (sName.includes('nicol') || sName.includes('nicola')) {
            // Try to match specific surname if present in DB
            let match = Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('veneziani nicola'));
            if (match) return match;
            return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('nicola') || playersList[k].toLowerCase().includes('nicolo'));
        }

        if (sName.includes('rayenne') || sName.includes('rayane')) return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('rayane') || playersList[k].toLowerCase().includes('daifi'));
        if (sName.includes('yousef')) return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('youssef'));

        // General search: check if surname or name matches
        const parts = sName.split(' ');
        const mainName = parts[0]; // "Erik", "Mattia"

        for (const [id, fullName] of Object.entries(playersList)) {
            const fName = fullName.toLowerCase();
            if (fName.includes(mainName)) {
                // If there's an initial in sheetName "Mattia D.", check if full name has "De" or surname match
                if (parts.length > 1) {
                    // Check if second part (initial) matches start of any subsequent name part
                    const initial = parts[1].charAt(0);
                    if (fName.split(' ').some((p, idx) => idx > 0 && p.startsWith(initial))) {
                        return id;
                    }
                } else {
                    return id;
                }
            }
        }
        // Fallback
        return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes(mainName));
    };

    // Extract stats
    const stats = [];
    for (let i = 1; i < headerRow.length; i++) {
        if (!headerRow[i]) continue;
        let name = headerRow[i];
        const pid = findPlayerId(name);

        // If ID matches, use the official full name from DB for display
        if (pid && playersList[pid]) {
            name = playersList[pid];
        }

        stats.push({
            name: name,
            total: totalRow[i] || 0,
            id: pid
        });
    }

    // DEBUG: Check specific problematic players
    const problematicIDs = ["9", "10", "11"];
    stats.forEach(s => {
        if (s.id && problematicIDs.includes(String(s.id))) {
            console.log(`[DEBUG PRESENZE] Found problematic ID ${s.id} (${s.name}) with total ${s.total}`);
        }
    });

    // Sort by Total Descending
    stats.sort((a, b) => b.total - a.total);

    // Build Grid HTML
    let styleBlock = `
        <style>
            .attendance-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 1.5rem;
                padding: 1.5rem;
            }
            .attendance-card {
                background: #1e293b; 
                background: var(--card-bg, #1e293b);
                border-radius: 16px;
                padding: 1.5rem 1rem;
                text-align: center;
                border: 1px solid #334155;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                transition: transform 0.2s, box-shadow 0.2s;
                position: relative;
                overflow: hidden;
            }
            .attendance-card:hover {
                transform: translateY(-5px);
                border-color: #6366f1;
                box-shadow: 0 10px 20px -2px rgba(99, 102, 241, 0.2);
            }
            .att-photo {
                width: 80px;
                height: 80px;
                margin: 0 auto 1rem auto;
                border-radius: 50%;
                overflow: hidden;
                border: 3px solid #334155;
                background: #0f172a;
            }
            .att-photo img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .att-name {
                font-weight: 700;
                margin-bottom: 0.5rem;
                font-size: 0.95rem;
                color: #e2e8f0;
                min-height: 1.5em;
                line-height: 1.2;
            }
            .att-value {
                font-size: 2.5rem;
                font-weight: 800;
                color: #6366f1;
                line-height: 1;
                margin-bottom: 0.25rem;
            }
            .att-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                color: #94a3b8;
                font-weight: 600;
            }
        </style>
    `;

    let html = styleBlock + '<div class="attendance-grid">';
    stats.forEach(s => {
        // Photo URL with cache busting
        const photoUrl = s.id ? `assets/players/${s.id}.png?v=${new Date().getTime()}` : 'assets/staff/placeholder.png';

        html += `
            <div class="attendance-card">
                <div class="att-photo">
                    <img src="${photoUrl}" alt="${s.name}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                    <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:#334155; border-radius:50%; font-size:2rem;">👤</div>
                </div>
                <div class="att-name">${s.name}</div>
                <div class="att-value">${s.total}</div>
                <div class="att-label">Presenze</div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

function renderRelazioniList() {
    const container = document.getElementById('relazioni-list'); // Keeping ID but treating as container
    if (!container) return;

    container.innerHTML = '';
    // Use grid class
    container.className = 'relazioni-grid';
    container.style.listStyle = 'none'; // Ensure no bullets if it's still ul/li in HTML (it is)
    container.style.padding = '0';

    if (!PRELOADED_DATABASE.relazioni_files || PRELOADED_DATABASE.relazioni_files.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; padding: 2rem; color: var(--text-muted); text-align: center;">Nessuna relazione disponibile.</div>';
        return;
    }

    PRELOADED_DATABASE.relazioni_files.forEach(file => {
        // Create a card-like element
        const item = document.createElement('li'); // Keep li since parent is ul
        item.className = 'relazioni-item';

        item.innerHTML = `
            <a href="DB/Relazioni/${file}" target="_blank" class="relazioni-card">
                <div class="rel-icon">📄</div>
                <div class="rel-name">${file}</div>
                <div class="rel-action">Apri PDF</div>
            </a>
        `;
        container.appendChild(item);
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

// --- Access Logs Logic ---
function logAccessAttempt(section, success) {
    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');
    logs.unshift({
        date: new Date().toISOString(),
        section: section,
        success: success
    });
    // Keep max 50 logs
    if (logs.length > 50) logs.pop();
    localStorage.setItem('accessLogs', JSON.stringify(logs));
}

function renderAccessLogs() {
    const tbody = document.querySelector('#access-log-table tbody');
    if (!tbody) return;

    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');

    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:1rem; color:var(--text-muted);">Nessun accesso registrato.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    logs.forEach(log => {
        const tr = document.createElement('tr');
        const d = new Date(log.date);
        const dateStr = d.toLocaleDateString('it-IT');
        const timeStr = d.toLocaleTimeString('it-IT');

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td><span class="badge">${log.section.replace('-view', '').toUpperCase()}</span></td>
            <td>
                <span class="badge ${log.success ? 'text-success' : 'text-danger'}" style="border: 1px solid currentColor;">
                    ${log.success ? '✅ SUCCESSO' : '❌ NEGATO'}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.clearAccessLogs = function () {
    if (confirm("Sei sicuro di voler cancellare il registro accessi?")) {
        localStorage.removeItem('accessLogs');
        renderAccessLogs();
    }
}

// --- User Management Logic ---
function initUsers() {
    // 1. Try to load from Preloaded DB (Source of Truth from Excel)
    if (typeof PRELOADED_DATABASE !== 'undefined') {
        if (PRELOADED_DATABASE.users_data && PRELOADED_DATABASE.users_data.length > 0) {
            localStorage.setItem('appUsers', JSON.stringify(PRELOADED_DATABASE.users_data));
        }
        if (PRELOADED_DATABASE.access_logs && PRELOADED_DATABASE.access_logs.length > 0) {
            localStorage.setItem('accessLogs', JSON.stringify(PRELOADED_DATABASE.access_logs));
        }
    }

    // 2. Fallback / Ensure Admin
    let users = JSON.parse(localStorage.getItem('appUsers') || '[]');

    // Ensure default admin exists
    const defaultAdminEmail = 'be.stefano1971';
    const hasDefaultAdmin = users.find(u => u.username === defaultAdminEmail);

    if (!hasDefaultAdmin) {
        users.push({ username: defaultAdminEmail, password: 'Alask@2025', role: 'Admin' });
        localStorage.setItem('appUsers', JSON.stringify(users));
    }
}

// --- Backup / Export Logic ---
window.exportBackup = function () {
    const data = {
        users: getUsers(),
        logs: JSON.parse(localStorage.getItem('accessLogs') || '[]')
    };

    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = "backup_data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert("File di backup scaricato.\n\nSe 'sync_data.py' è in esecuzione (monitoraggio), l'aggiornamento sarà automatico.\nAltrimenti avvia lo script per completare la registrazione.");
};

window.forceSync = function () {
    // Ideally this would trigger python script, but in browser we assume user runs it.
    // We reload to get new database.js
    if (confirm("Hai eseguito lo script 'sync_data.py'?\n\nPremi OK per ricaricare i dati aggiornati.")) {
        location.reload();
    }
};

function getUsers() {
    return JSON.parse(localStorage.getItem('appUsers') || '[]');
}

function saveUsers(users) {
    localStorage.setItem('appUsers', JSON.stringify(users));
    renderUsersTable();
}

function addUser() {
    const userIn = document.getElementById('new-username');
    const passIn = document.getElementById('new-password');
    const roleIn = document.getElementById('new-role');

    const username = userIn.value.trim();
    const password = passIn.value.trim();
    const role = roleIn.value;

    if (!username || !password) { alert("Completa tutti i campi."); return; }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(username)) {
        alert("Inserisci un indirizzo email valido.");
        return;
    }

    const users = getUsers();
    if (users.find(u => u.username === username)) { alert("Utente già esistente."); return; }

    users.push({ username, password, role });
    saveUsers(users);

    userIn.value = '';
    passIn.value = '';
    alert("Utente aggiunto!");
}

window.deleteUser = function (username) {
    if (!confirm(`Eliminare l'utente "${username}"?`)) return;
    let users = getUsers();
    users = users.filter(u => u.username !== username);
    saveUsers(users);
}

function renderUsersTable() {
    const tbody = document.querySelector('#users-table tbody');
    if (!tbody) return;

    const users = getUsers();
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.username}</td>
            <td><span class="badge" style="background: ${['Admin', 'Staff Tecnico', 'Dirigenza'].includes(u.role) ? 'var(--primary)' : 'var(--border)'}">${u.role}</span></td>
            <td style="font-family: monospace;">${u.password}</td>
            <td style="text-align: right;">
                <button class="btn danger" style="padding: 2px 8px; font-size: 0.7rem;" onclick="deleteUser('${u.username}')">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Also render pending requests whenever users table is updated
    renderPendingRequestsTable();
}

// --- Pending Requests Logic ---
function getPendingRequests() {
    return JSON.parse(localStorage.getItem('pendingRegistrations') || '[]');
}

function savePendingRequests(reqs) {
    localStorage.setItem('pendingRegistrations', JSON.stringify(reqs));
    renderPendingRequestsTable();
    updateSetupNotification();
}

function updateSetupNotification() {
    const reqs = getPendingRequests();
    const count = reqs.length;
    const setupBtn = document.querySelector('.tab-btn[data-target="setup-view"]');
    if (!setupBtn) return;

    // Remove existing badge if any
    const existingBadge = setupBtn.querySelector('.notif-badge');
    if (existingBadge) existingBadge.remove();

    if (count > 0) {
        // Add new badge
        const badge = document.createElement('span');
        badge.className = 'notif-badge';
        badge.style.cssText = 'background: #ef4444; color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 999px; margin-left: 8px; vertical-align: middle; font-weight: bold;';
        badge.innerText = count;
        setupBtn.appendChild(badge);
    }
}

function renderPendingRequestsTable() {
    const tbody = document.querySelector('#pending-users-table tbody');
    updateSetupNotification(); // Ensure badge is synced

    if (!tbody) return;

    const reqs = getPendingRequests();
    tbody.innerHTML = '';

    if (reqs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-muted); padding: 1rem;">Nessuna richiesta in attesa.</td></tr>';
        return;
    }

    const availableRoles = [
        "Admin", "Atleta +18", "Atleta -18",
        "Dirigenza", "Genitore", "Ospite", "Staff Tecnico"
    ];

    reqs.forEach((r, index) => {
        let options = availableRoles.map(role =>
            `<option value="${role}" ${r.role === role ? 'selected' : ''}>${role}</option>`
        ).join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${r.email}</td>
            <td>
                <select id="pending-role-${index}" style="padding: 2px; border-radius: 4px; background: #1e293b; color: white; border: 1px solid #334155;">
                    ${options}
                </select>
            </td>
            <td style="text-align: right;">
                <button class="btn success" style="padding: 2px 8px; font-size: 0.7rem; margin-right: 5px;" onclick="approveRequest(${index})">✅</button>
                <button class="btn danger" style="padding: 2px 8px; font-size: 0.7rem;" onclick="rejectRequest(${index})">❌</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.approveRequest = function (index) {
    const reqs = getPendingRequests();
    const req = reqs[index];
    if (!req) return;

    // Get selected role
    const roleSelect = document.getElementById(`pending-role-${index}`);
    const selectedRole = roleSelect ? roleSelect.value : req.role;

    if (!confirm(`Approvare richiesta per ${req.email} con ruolo ${selectedRole}?`)) return;

    // Add to users
    const users = getUsers();
    if (users.find(u => u.username === req.email)) {
        alert("Utente già esistente nel sistema.");
        // Should we delete the request? Yes.
    } else {
        users.push({ username: req.email, password: req.password, role: selectedRole });
        saveUsers(users);

        // Notify User via Email (Client-side trigger)
        const subject = encodeURIComponent('Richiesta Accesso App Approvata');
        const body = encodeURIComponent(`Ciao,\n\nLa tua richiesta di accesso è stata approvata.\n\nUsername: ${req.email}\nPassword: ${req.password}\nRuolo: ${selectedRole}\n\nPuoi ora effettuare il login.`);
        // Note: Opening multiple mailto links rapidly might be blocked by browsers, but for single approval it's fine.
        // We use setTimeout to ensure UI updates aren't blocked.
        setTimeout(() => {
            window.open(`mailto:${req.email}?subject=${subject}&body=${body}`);
        }, 500);
    }

    // Remove from pending
    reqs.splice(index, 1);
    savePendingRequests(reqs);
};

window.rejectRequest = function (index) {
    if (!confirm("Rifiutare questa richiesta?")) return;
    const reqs = getPendingRequests();
    reqs.splice(index, 1);
    savePendingRequests(reqs);
};


// --- Access Logs Logic ---
function logAccessAttempt(section, success, role) {
    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');

    // Detect Device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const device = isMobile ? 'Mobile' : 'Desktop';

    logs.unshift({
        date: new Date().toISOString(),
        section: section,
        success: success,
        role: role || 'Ospite',
        device: device
    });
    // Keep max 50 logs
    if (logs.length > 50) logs.pop();
    localStorage.setItem('accessLogs', JSON.stringify(logs));
}

function renderAccessLogs() {
    const tbody = document.querySelector('#access-log-table tbody');
    if (!tbody) return;

    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');

    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1rem; color:var(--text-muted);">Nessun accesso registrato.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    logs.forEach(log => {
        const tr = document.createElement('tr');
        const d = new Date(log.date);
        const dateStr = d.toLocaleDateString('it-IT');
        const timeStr = d.toLocaleTimeString('it-IT');

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td><span class="badge" style="background: ${['Staff Tecnico', 'Admin', 'Dirigenza'].includes(log.role) ? 'var(--primary)' : 'var(--border)'}">${log.role}</span></td>
            <td>${log.device}</td>
            <td><span class="badge" style="font-weight:normal;">${log.section.replace('-view', '').toUpperCase()}</span></td>
            <td>
                <span class="badge ${log.success ? 'text-success' : 'text-danger'}" style="border: 1px solid currentColor;">
                    ${log.success ? '✅ OK' : '❌ NO'}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}




window.clearAccessLogs = function () {
    if (confirm("Sei sicuro di voler cancellare il registro accessi?")) {
        localStorage.removeItem('accessLogs');
        renderAccessLogs();
    }
}

// --- Login Modal Logic ---
function showLoginModal(onSuccess, onFail) {
    const modal = document.getElementById('login-modal');
    const userIn = document.getElementById('login-username');
    const passIn = document.getElementById('login-password');
    const btnConfirm = document.getElementById('login-confirm');
    const btnCancel = document.getElementById('login-cancel');

    if (!modal) return;

    // Reset
    userIn.value = '';
    passIn.value = '';
    passIn.type = 'password';
    const showPassChk = document.getElementById('show-password-chk');
    if (showPassChk) showPassChk.checked = false;

    modal.style.display = 'flex';
    userIn.focus();

    const handleLogin = () => {
        const username = userIn.value.trim();
        const password = passIn.value.trim();

        const users = getUsers();
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            modal.style.display = 'none';
            cleanup();
            onSuccess(user.role, user.username);
        } else {
            alert("Credenziali non valide!");
            // Optional: onFail('Sconosciuto'); but we let them retry or cancel
        }
    };

    const handleCancel = () => {
        modal.style.display = 'none';
        cleanup();
        if (onFail) onFail();
    };

    // Simple event handlers that we remove later to avoid dupes?
    // Actually, cloning node is safer or just use 'onclick'
    btnConfirm.onclick = handleLogin;
    btnCancel.onclick = handleCancel;

    // Enter key
    const handleKey = (e) => { if (e.key === 'Enter') handleLogin(); };
    passIn.onkeyup = handleKey;

    function cleanup() {
        btnConfirm.onclick = null;
        btnCancel.onclick = null;
        passIn.onkeyup = null;
    }
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    initUsers();

    // Registration Modal Logic
    const regLink = document.getElementById('open-register-link');
    const regModal = document.getElementById('register-modal');
    const loginModal = document.getElementById('login-modal');

    // Check initial notification
    updateSetupNotification();

    // Show Password Toggle
    const showPassChk = document.getElementById('show-password-chk');
    if (showPassChk) {
        showPassChk.addEventListener('change', (e) => {
            const passInput = document.getElementById('login-password');
            if (passInput) {
                passInput.type = e.target.checked ? 'text' : 'password';
            }
        });
    }

    if (regLink && regModal) {
        regLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (loginModal) loginModal.style.display = 'none';
            regModal.style.display = 'flex';
        });

        document.getElementById('reg-cancel').addEventListener('click', () => {
            regModal.style.display = 'none';
            // Return to login if needed, or just close
            if (loginModal) loginModal.style.display = 'flex';
        });

        document.getElementById('reg-confirm').addEventListener('click', () => {
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value.trim();
            const role = document.getElementById('reg-role').value;

            if (!email || !password || !role) { alert("Compila tutti i campi e seleziona un ruolo."); return; }

            // Validate email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert("Email non valida.");
                return;
            }

            // Check if user already exists
            const users = getUsers();
            if (users.find(u => u.username === email)) {
                alert("Utente già registrato!");
                return;
            }

            // Check if pending exists
            const pending = getPendingRequests();
            if (pending.find(p => p.email === email)) {
                alert("Hai già una richiesta in attesa!");
                return;
            }

            // Add to pending
            pending.push({ email, password, role, date: new Date().toISOString() });
            savePendingRequests(pending);

            // Email Notification to Admin
            const adminEmail = 'be.stefano1971@gmail.com'; // Default admin email
            const subject = encodeURIComponent('Nuova Richiesta Registrazione App');
            const body = encodeURIComponent(`Un nuovo utente ha richiesto l'accesso:\n\nEmail: ${email}\nRuolo: ${role}\n\nAccedi all'app per approvare.`);
            window.open(`mailto:${adminEmail}?subject=${subject}&body=${body}`);

            alert("Richiesta inviata! Si aprirà il tuo client di posta per notificare l'amministratore.");
            regModal.style.display = 'none';
            document.getElementById('reg-email').value = '';
            document.getElementById('reg-password').value = '';

            if (loginModal) loginModal.style.display = 'flex';
        });
    }

    window.CURRENT_USER = null;

    // Permissions Logic
    function canAccess(viewId, role) {
        const restricted = ['setup-view', 'relazioni-view'];
        if (!restricted.includes(viewId)) return true; // Public views
        if (role === 'Admin' || role === 'Staff Tecnico' || role === 'Dirigenza') return true; // Privileged roles
        return false; // Others blocked
    }

    // MANDATORY STARTUP LOGIN
    function enforceLogin() {
        // Hide cancel button for initial login
        const cancelBtn = document.getElementById('login-cancel');
        if (cancelBtn) cancelBtn.style.display = 'none';

        showLoginModal(
            (role, username) => {
                // Success
                window.CURRENT_USER = { role, username };
                localStorage.setItem('currentUserRole', role);
                renderTabsWithLocks();
                renderUserHeader(); // Update Header Widget

                logAccessAttempt('APP_START', true, `${username} (${role})`);

                // Show cancel button again for future use
                if (cancelBtn) cancelBtn.style.display = 'inline-block';

                // Default view
                const homeBtn = document.querySelector('.tab-btn[data-target="home-view"]');
                if (homeBtn && !homeBtn.classList.contains('locked-tab')) homeBtn.click();
            },
            () => {
                // Should not happen if cancel is hidden, but just in case
                location.reload();
            }
        );
    }

    // Start !
    setTimeout(enforceLogin, 100);

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(t => t.addEventListener('click', () => {
        const targetId = t.dataset.target;

        if (!window.CURRENT_USER) {
            enforceLogin();
            return;
        }

        if (t.classList.contains('locked-tab') || t.getAttribute('data-locked') === 'true') {
            // Access Denied
            logAccessAttempt(targetId, false, `${window.CURRENT_USER.username} (Denied)`);
            alert("⛔ Sezione bloccata per il tuo ruolo.");
            return;
        }

        // Logic from canAccess is now handled by renderTabsWithLocks adding the class
        logAccessAttempt(targetId, true, window.CURRENT_USER.username);
        activateView(targetId, t);

        if (targetId === 'relazioni-view') renderRelazioniList();
        if (targetId === 'setup-view') renderUsersTable();
    }));

    function activateView(targetId, btn) {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.view-content').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        const tg = document.getElementById(targetId);
        if (tg) tg.classList.add('active');
    }

    document.querySelectorAll('.sub-tab-btn').forEach(t => t.addEventListener('click', () => {
        const targetId = t.dataset.subtarget;

        if (targetId === 'accessi-subview') {
            renderAccessLogs();
            renderUsersTable();
        }

        const parent = t.closest('.view-content') || document;
        parent.querySelectorAll('.sub-tab-btn').forEach(x => x.classList.remove('active'));
        parent.querySelectorAll('.sub-view').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tg = document.getElementById(targetId);
        if (tg) tg.classList.add('active');
    }));

    function navigateTo(targetView) {
        const mainTab = document.querySelector(`[data-target="${targetView}"]`);
        if (mainTab) { mainTab.click(); return; }
        const subTab = document.querySelector(`[data-subtarget="${targetView}"]`);
        if (subTab) {
            const statTab = document.querySelector('[data-target="stats-container-view"]');
            if (statTab) {
                statTab.click();
            }
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

    // --- Log Upload Logic ---
    const logUpload = document.getElementById('log-upload');
    if (logUpload) {
        logUpload.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) {
                const text = e.target.result;
                parseAndRestoreLog(text);
            };
            reader.readAsText(file);
            // Reset input so same file can be selected again
            e.target.value = '';
        });
    }

    function parseAndRestoreLog(text) {
        try {
            const lines = text.split('\n');
            let usersCount = 0;
            let logsCount = 0;

            const usersMap = {};
            const newLogs = [];
            const logSignatures = new Set();

            // Simple state machine parser
            let currentSection = null; // 'USERS', 'LOGS'

            lines.forEach(line => {
                line = line.trim();
                if (!line || line.startsWith('=')) return;

                if (line.includes('[UTENTI -')) {
                    currentSection = 'USERS';
                    return;
                }
                if (line.includes('[ACCESS LOGS -')) {
                    currentSection = 'LOGS';
                    return;
                }

                if (currentSection === 'USERS' && line.startsWith('User:')) {
                    // Parse: User: admin | Role: Admin | Pwd: ...
                    try {
                        const parts = line.split('|').map(s => s.trim());
                        const username = parts[0].split(':')[1].trim();
                        const role = parts[1].split(':')[1].trim();
                        const pwd = parts[2].split(':')[1].trim();

                        if (username) {
                            usersMap[username] = { username, role, password: pwd };
                        }
                    } catch (e) {
                        console.warn("Skipping malformed user line:", line);
                    }
                } else if (currentSection === 'LOGS') {
                    // Parse: 01/01/2026 10:00:00 | Admin | Setup | OK: true
                    // OR ISO format in older logs
                    try {
                        const parts = line.split('|').map(s => s.trim());
                        if (parts.length >= 4) {
                            let dateStr = parts[0];
                            const role = parts[1];
                            const section = parts[2];
                            const successStr = parts[3].split(':')[1].trim(); // OK: true -> true

                            // Convert italian date format back to ISO for storage if needed, 
                            // or keep as is. Our renderAccessLogs expects ISO for 'new Date()'.
                            // If it's DD/MM/YYYY HH:MM:SS, we need to convert.
                            if (dateStr.includes('/')) {
                                const [dPart, tPart] = dateStr.split(' ');
                                const [day, month, year] = dPart.split('/');
                                // Reformat to YYYY-MM-DDTHH:MM:SS for Date constructor consistency
                                dateStr = `${year}-${month}-${day}T${tPart}`;
                            }

                            const logObj = {
                                date: dateStr,
                                role: role,
                                section: section,
                                success: successStr === 'true' || successStr === 'True' || successStr === '1',
                                device: 'Restored'
                            };

                            // Deduplication logic
                            const signature = `${logObj.date}|${logObj.role}|${logObj.section}|${logObj.success}`;
                            if (!logSignatures.has(signature)) {
                                logSignatures.add(signature);
                                newLogs.push(logObj);
                                logsCount++;
                            }
                        }
                    } catch (e) {
                        console.warn("Skipping malformed log line:", line);
                    }
                }
            });

            const newUsers = Object.values(usersMap);
            usersCount = newUsers.length;

            if (newUsers.length > 0) {
                saveUsers(newUsers);
                initUsers(); // Refresh global user state
            }

            if (newLogs.length > 0) {
                // Merge or replace? Let's prepend distinct ones or just replace to be safe as a "Restore".
                // User asked to "Carica" (Load). Usually implies adding or restoring state.
                // Given the sync log accumulates history, we can just save it.
                // Sort descending by date (newest first)
                newLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
                localStorage.setItem('accessLogs', JSON.stringify(newLogs)); // Save sorted logs
                renderAccessLogs();
            }

            alert(`Ripristino Completato!\n\nUtenti caricati: ${usersCount}\nLog caricati: ${logsCount}`);

        } catch (e) {
            console.error(e);
            alert("Errore durante il parsing del file di log. Assicurati che sia un file 'sync_log.txt' valido.");
        }
    }

});
