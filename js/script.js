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
    const permissions = (typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.permissions) || [];
    const tabs = document.querySelectorAll('.tab-btn, .sub-tab-btn');

    // Split permissions into two tables if header row exists
    const pivotIdx = permissions.findIndex(p => p.Ruolo_Accesso === 'Ruolo_Accesso');
    const table1 = pivotIdx !== -1 ? permissions.slice(0, pivotIdx) : permissions;
    const table2 = pivotIdx !== -1 ? permissions.slice(pivotIdx + 1) : [];

    const getPerm = (role, key) => {
        if (String(role).toUpperCase() === 'ADMIN') return true;

        // Mapping for Table 1 (Structural Tabs)
        const map1 = {
            "SOCIETÀ": "Società", "SOCIETA": "Società", "HOME": "Home",
            "SPONSOR": "Sponsor", "PRIVACY": "Privacy", "SETUP": "Setup",
            "LOGISTICA": "Logistica", "STORIA": "Storia", "RELAZIONI": "Relazioni"
        };

        // Mapping for Table 2 (Technical Content)
        const map2 = {
            "U15": "Società", "ROSA": "Home", "GIOCATORI": "Home",
            "STAFF": "Logistica", "ORGANIGRAMMA": "Logistica",
            "STATISTICHE": "Storia", "STATISTICA": "Storia",
            "SCHEMI": "Relazioni", "PERFORMANCE": "Sponsor"
        };

        let val = false;

        // Check Table 2 first (more specific)
        if (map2[key.toUpperCase()]) {
            const p = table2.find(r => (r.Ruolo_Accesso || r.Ruolo) === role);
            if (p) val = p[map2[key.toUpperCase()]];
        }
        // Fallback to Table 1
        else if (map1[key.toUpperCase()]) {
            const p = table1.find(r => (r.Ruolo_Accesso || r.Ruolo) === role);
            if (p) val = p[map1[key.toUpperCase()]];
        }
        else {
            // Default cases for teams not explicitly in mapping (fallback to Home or true?)
            const teams = ["1^ SQUADRA", "U19", "SGS", "CSI", "FEMMINILE", "PULCINI", "PRIMI CALCI"];
            if (teams.includes(key.toUpperCase())) {
                const p = table1.find(r => (r.Ruolo_Accesso || r.Ruolo) === role);
                val = p ? p.Home : true;
            } else {
                val = true; // Default allowed
            }
        }

        return val === true || val === 1 || String(val).toLowerCase() === 'true';
    };

    tabs.forEach(btn => {
        const label = btn.textContent.replace(' 🔒', '').trim();
        const allowed = getPerm(userRole, label);

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
let PLAYER_BIRTHYEARS = {};
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
        FF: findIdx(["FALLI FATTI"]), FS: findIdx(["FALLI SUBITI"]),
        TM: findIdx(["TIRI MURATI", "T.M.", "TM"])
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
            if (hasValue(row[IDX.PARATE]) && row[IDX.PARATE] != 0) {
                addStat(APP_STATE.goalkeepers, gkId, 'saves', 1);
                const s = String(row[IDX.PARATE]).toUpperCase();
                if (s.includes("SX")) addStat(APP_STATE.goalkeepers, gkId, 'savesSX', 1);
                else if (s.includes("DX")) addStat(APP_STATE.goalkeepers, gkId, 'savesDX', 1);
                else addStat(APP_STATE.goalkeepers, gkId, 'savesCT', 1);
            }
            if (hasValue(row[IDX.GS]) && row[IDX.GS] != 0) {
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
        if (hasValue(row[IDX.TM]) && row[IDX.TM] != 0) { addStat(APP_STATE.players, row[IDX.TM], 'tm', 1); }
    }
}

function addStat(store, id, prop, val, metadata = {}) {
    const cleanId = String(id).trim();
    if (!store[cleanId]) store[cleanId] = { id: cleanId, ...metadata };
    else if (metadata.members) store[cleanId].members = metadata.members;
    if (!store[cleanId][prop]) store[cleanId][prop] = 0;
    store[cleanId][prop] += val;
}
function hasValue(val) {
    if (val === undefined || val === null) return false;
    const s = String(val).trim().toLowerCase();
    return s !== "" && s !== "nan" && s !== "null" && s !== "0" && s !== "0.0";
}
function formatTime(m) {
    if (!m || isNaN(m)) return "0:00";
    const mm = Math.floor(m), ss = Math.round((m - mm) * 60);
    return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function formatChartName(fullName) {
    if (!fullName) return "";
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length <= 1) return parts[0];
    const first = parts[0].toUpperCase();
    const prefixes = ["DE", "DI", "DA", "DEL", "DELLA", "DALLA", "LO", "LE", "LA"];
    if (prefixes.includes(first) && parts.length > 1) {
        return parts[0] + " " + parts[1];
    }
    return parts[0];
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
                const pState = (APP_STATE.players && APP_STATE.players[id]) || { id: id, minutes: 0, goals: 0, gs: 0, pr: 0, pp: 0, shotsOn: 0, shotsOff: 0, tm: 0, ff: 0, fs: 0, plusMinus: 0 };
                activePlayers.push(pState);
            }
        });

        // Populate Team Home Stats
        updateTeamHomeStats('u15', 'U15');
        updateTeamHomeStats('first-team', '1^Squadra');
        updateTeamHomeStats('u19', 'U19');
        updateTeamHomeStats('csi', 'CSI');
        updateTeamHomeStats('femminile', 'Femminile');

        // Override U15 with dynamic file stats if available
        const matchesEl = document.getElementById('u15-matches');
        const gfEl = document.getElementById('u15-gf');
        const gsEl = document.getElementById('u15-gs');
        if (matchesEl && (APP_STATE.processedFiles || []).length > 0) matchesEl.textContent = (APP_STATE.processedFiles || []).length;
        if (gfEl && APP_STATE.totalGF !== undefined) gfEl.textContent = APP_STATE.totalGF;
        if (gsEl && APP_STATE.totalGS !== undefined) gsEl.textContent = APP_STATE.totalGS;

        // Roster
        const rosterGrid = document.getElementById('roster-grid');
        if (rosterGrid) {
            rosterGrid.innerHTML = '';
            const allIds = Object.keys(PLAYER_NAMES).map(k => parseInt(k)).sort((a, b) => a - b);

            allIds.forEach(id => {
                const role = PLAYER_ROLES[id];
                const birthYear = PLAYER_BIRTHYEARS[id];
                const isGk = role === 'PORTIERE' || (APP_STATE.goalkeepers && APP_STATE.goalkeepers[id]);

                // Prioritize GK stats for GKs, otherwise player stats
                const pState = isGk
                    ? ((APP_STATE.goalkeepers && APP_STATE.goalkeepers[id]) || (APP_STATE.players && APP_STATE.players[id]))
                    : ((APP_STATE.players && APP_STATE.players[id]) || (APP_STATE.goalkeepers && APP_STATE.goalkeepers[id]));

                // Default object with all necessary properties
                const p = pState || { id: id, minutes: 0, goals: 0, gs: 0, pr: 0, pp: 0, saves: 0 };
                if (p.saves === undefined) p.saves = 0; // Ensure saves exists if we got a state that didn't have it

                let fullName = PLAYER_NAMES[id] || `ID: ${id}`;
                const isCaptain = id === 4; // Biolcati is Captain

                // Attendance Data Extraction (Inner Helper)
                const getAttendance = () => {
                    if (typeof PRELOADED_DATABASE === 'undefined' || !PRELOADED_DATABASE.presenze) return 0;
                    const data = PRELOADED_DATABASE.presenze;
                    const headerRow = data[0];
                    const playersList = PRELOADED_DATABASE.players_list || {};

                    const findPlayerIdHelper = (sheetName) => {
                        const sName = sheetName.toLowerCase()
                            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                            .replace(/\./g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        if (sName.includes('riki') || sName.includes('riccardo')) return "11";
                        if (sName.includes('mantovan') || sName.includes('nicolo m') || sName.includes('niccolo m')) return "9";
                        if (sName.includes('nicola v') || sName.includes('veneziani nicola')) return "10";
                        if (sName.includes('nicol') || sName.includes('nicola')) {
                            let match = Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('veneziani nicola'));
                            if (match) return match;
                            return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('nicola') || playersList[k].toLowerCase().includes('nicolo'));
                        }
                        if (sName.includes('rayenne') || sName.includes('rayane')) return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('rayane') || playersList[k].toLowerCase().includes('daifi'));
                        if (sName.includes('yousef')) return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes('youssef'));
                        const parts = sName.split(' ');
                        const mainName = parts[0];
                        for (const [pid, fullName] of Object.entries(playersList)) {
                            const fName = fullName.toLowerCase();
                            if (fName.includes(mainName)) {
                                if (parts.length > 1) {
                                    const initial = parts[1].charAt(0);
                                    if (fName.split(' ').some(p => p.startsWith(initial))) return pid;
                                } else return pid;
                            }
                        }
                        return Object.keys(playersList).find(k => playersList[k].toLowerCase().includes(mainName));
                    };

                    // Find correct column index
                    let colIdx = -1;
                    for (let i = 1; i < headerRow.length; i++) {
                        if (findPlayerIdHelper(headerRow[i]) == id) {
                            colIdx = i;
                            break;
                        }
                    }

                    if (colIdx === -1) return 0;

                    // Sum occurrences of X or R in that column
                    let count = 0;
                    for (let r = 1; r < data.length; r++) {
                        const row = data[r];
                        if (row && row[0] && String(row[0]).toUpperCase().includes("TOTALE")) continue;
                        const val = String(row[colIdx] || "").toUpperCase();
                        if (val === 'X' || val === 'R') count++;
                    }
                    return count;
                };

                const presenzeCount = getAttendance();

                const card = document.createElement('div');
                card.className = 'player-card';
                const hasPerfAccess = (function () {
                    const role = window.CURRENT_USER ? window.CURRENT_USER.role : '';
                    if (role === 'Admin') return true;
                    // Reference the same logic as renderTabsWithLocks
                    const perms = (typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.permissions) || [];
                    const pIdx = perms.findIndex(p => p.Ruolo_Accesso === 'Ruolo_Accesso');
                    const t2 = pIdx !== -1 ? perms.slice(pIdx + 1) : [];
                    const rr = t2.find(r => (r.Ruolo_Accesso || r.Ruolo) === role);
                    if (rr) {
                        const val = rr.Sponsor;
                        return val === true || val === 1 || String(val).toLowerCase() === 'true';
                    }
                    return false;
                })();

                card.innerHTML = `
                <div class="player-photo-container">
                    <img src="assets/players/${id}.png?v=${Date.now()}" class="player-photo" 
                        onerror="if(!this.src.includes('.jpg')){this.src='assets/players/${id}.jpg?v=' + Date.now()}else{this.style.display='none';this.nextElementSibling.style.display='block'}">
                    <div class="player-placeholder" style="display:none;font-size:4rem;">👤</div>
                    <div class="player-number-badge">${id}</div>
                    ${isGk ? '<div class="player-role-badge">PORTIERE</div>' : (role ? `<div class="player-role-badge">${role}</div>` : '')}
                </div>
                <div class="player-info">
                    <div class="player-name">
                        ${fullName} ${birthYear ? `<span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400; margin-left: 4px;">(${birthYear})</span>` : ''}
                        ${isCaptain ? '<span style="color:var(--primary); font-weight:bold; margin-left:5px;" title="Capitano">©</span>' : ''}
                    </div>
                    <div class="player-stats-mini">
                        <div class="stat-mini"><div class="stat-mini-label">MIN</div><div class="stat-mini-value">${Math.floor(p.minutes || 0)}</div></div>
                        <div class="stat-mini"><div class="stat-mini-label">${isGk ? 'GS' : 'GOAL'}</div><div class="stat-mini-value">${isGk ? (p.gs || 0) : (p.goals || 0)}</div></div>
                        <div class="stat-mini"><div class="stat-mini-label">PRE</div><div class="stat-mini-value">${presenzeCount}</div></div>
                        <div class="stat-mini">
                            <div class="stat-mini-label">${isGk ? 'PAR' : 'PR-PP'}</div>
                            <div class="stat-mini-value" style="color: ${isGk ? 'var(--success)' : ((p.pr || 0) - (p.pp || 0) > 0 ? 'var(--success)' : ((p.pr || 0) - (p.pp || 0) < 0 ? 'var(--danger)' : 'var(--text-muted)'))}">
                                ${isGk ? (p.saves || 0) : ((p.pr || 0) - (p.pp || 0) > 0 ? '+' : '') + ((p.pr || 0) - (p.pp || 0))}
                            </div>
                        </div>
                    </div>
                    <div style="margin-top: 1.25rem;">
                        <button class="btn btn-ap" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-weight: 700; font-size: 0.8rem; ${!hasPerfAccess ? 'opacity: 0.8; filter: grayscale(0.5);' : ''}" 
                            onclick="${hasPerfAccess ? `openPlayerPerformance('${fullName.replace(/'/g, "\\'")}')` : "alert('⛔ Accesso riservato allo Staff Tecnico e Dirigenza.')"}">
                            ${hasPerfAccess ? '' : '🔒 '}Autovalutazione della Performance
                        </button>
                    </div>
                </div>`;
                rosterGrid.appendChild(card);
            });
        }

        // Render Charts
        if (typeof Chart !== 'undefined') {
            try { renderCharts(activePlayers, activeGoalkeepers); } catch (e) { console.error("Chart Error:", e); }
        }

        // Render Stats Tables
        renderPlayersTable(activePlayers);
        renderGoalkeepersTable(activeGoalkeepers);
        renderQuartetsTable();
        renderRelazioniList();
        renderSchemiVideos();
        renderFilesTable();
        renderPrivacyTable();

        // Render Team Custom Tables (U15, 1^ Squadra, U19, CSI, Femminile)
        renderTeamCustomTables('u15', 'U15');
        renderTeamCustomTables('first-team', '1^Squadra');
        renderTeamCustomTables('u19', 'U19');
        renderTeamCustomTables('csi', 'CSI');
        renderTeamCustomTables('femminile', 'Femminile');

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
        // FILTER: Do not show individual player performance in the general list
        if (file.toLowerCase().startsWith('performance/')) return;

        // Create a card-like element
        const item = document.createElement('li'); // Keep li since parent is ul
        item.className = 'relazioni-item';

        // Clean name for display: remove extension and folder path
        const displayName = file.split('/').pop().replace(/\.(pdf|docx|doc)$/i, '');

        // Encode file path properly
        const validPath = encodeURI(file);

        item.innerHTML = `
            <a href="DB/relazioni/${validPath}" target="_blank" class="relazioni-card">
                <div class="rel-icon">${file.toLowerCase().endsWith('.pdf') ? '📄' : '📝'}</div>
                <div class="rel-name">${displayName}</div>
                <div class="rel-action">Apri Documento</div>
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

function renderSchemiVideos() {
    if (typeof PRELOADED_DATABASE === 'undefined' || !PRELOADED_DATABASE.schemi_videos) return;

    const grids = {
        angoli: document.getElementById('grid-angoli'),
        punizioni: document.getElementById('grid-punizioni'),
        rimesse: document.getElementById('grid-rimesse'),
        inizio: document.getElementById('grid-inizio'),
        "4-0": document.getElementById('grid-40'),
        "3-1": document.getElementById('grid-31'),
        altro: document.getElementById('grid-40') // Fallback
    };

    // Clear all grids
    Object.values(grids).forEach(g => { if (g) g.innerHTML = ''; });

    PRELOADED_DATABASE.schemi_videos.forEach(video => {
        const grid = grids[video.category] || grids.altro;
        if (!grid) return;

        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <div class="video-player-container">
                <video controls preload="metadata">
                    <source src="${video.path}" type="video/mp4">
                    Il tuo browser non supporta il video player.
                </video>
            </div>
            <div class="video-info">
                <div class="video-title">${video.name.replace(/\.[^/.]+$/, "")}</div>
                <div class="video-type">${video.category}</div>
            </div>
        `;
        grid.appendChild(card);
    });

    // Check if grids are empty and show message
    Object.entries(grids).forEach(([cat, grid]) => {
        if (grid && grid.children.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; padding: 2rem; color: var(--text-muted); text-align: center;">Nessun video caricato per questa categoria.</div>`;
        }
    });
}

let chartInstances = {};

// Set global defaults for Chart.js
if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#ffffff';
    Chart.defaults.font.weight = 'bold';
    Chart.defaults.font.family = "'Inter', sans-serif";
}

function renderCharts(players, gks) {
    if (chartInstances.goals) chartInstances.goals.destroy();
    const ctxGoals = document.getElementById('playersGoalsChart');
    if (ctxGoals) {
        const top = players.sort((a, b) => (b.goals || 0) - (a.goals || 0)).slice(0, 10);
        chartInstances.goals = new Chart(ctxGoals.getContext('2d'), {
            type: 'bar',
            data: {
                labels: top.map(p => formatChartName(PLAYER_NAMES[p.id] || p.id)),
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
                labels: topQ.map(q => q.members.map(id => formatChartName(PLAYER_NAMES[id] || id)).join('-')),
                datasets: [{ label: 'GF', data: topQ.map(q => q.gf || 0), backgroundColor: '#22c55e' }, { label: 'GS', data: topQ.map(q => q.gs || 0), backgroundColor: '#ef4444' }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.qShots) chartInstances.qShots.destroy();
    const ctxQS = document.getElementById('quartetsShotsChart');
    if (ctxQS) {
        const topQS = Object.values(APP_STATE.quartets).sort((a, b) => (b.shotsOn || 0) - (a.shotsOn || 0)).slice(0, 6);
        chartInstances.qShots = new Chart(ctxQS.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topQS.map(q => q.members.map(id => formatChartName(PLAYER_NAMES[id] || id)).join('-')),
                datasets: [
                    { label: 'Tiri Fatti', data: topQS.map(q => q.shotsOn || 0), backgroundColor: '#22c55e' },
                    { label: 'Tiri Subiti', data: topQS.map(q => q.shotsAgainst || 0), backgroundColor: '#ef4444' }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.qPRPP) chartInstances.qPRPP.destroy();
    const ctxQPR = document.getElementById('quartetsPRPPChart');
    if (ctxQPR) {
        const topQPR = Object.values(APP_STATE.quartets).sort((a, b) => (b.pr || 0) - (a.pr || 0)).slice(0, 6);
        chartInstances.qPRPP = new Chart(ctxQPR.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topQPR.map(q => q.members.map(id => formatChartName(PLAYER_NAMES[id] || id)).join('-')),
                datasets: [
                    { label: 'Recuperate', data: topQPR.map(q => q.pr || 0), backgroundColor: '#22c55e' },
                    { label: 'Perse', data: topQPR.map(q => q.pp || 0), backgroundColor: '#ef4444' }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.qTiming) chartInstances.qTiming.destroy();
    const ctxQT = document.getElementById('quartetsTimingChart');
    if (ctxQT) {
        const topQT = Object.values(APP_STATE.quartets).sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).slice(0, 6);
        chartInstances.qTiming = new Chart(ctxQT.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topQT.map(q => q.members.map(id => formatChartName(PLAYER_NAMES[id] || id)).join('-')),
                datasets: [{ label: 'Minuti', data: topQT.map(q => Math.floor(q.minutes || 0)), backgroundColor: '#06b6d4' }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.goalkeepers) chartInstances.goalkeepers.destroy();
    const ctxGK = document.getElementById('goalkeepersChart');
    if (ctxGK && gks) {
        const sortedGks = [...gks].sort((a, b) => (b.saves || 0) - (a.saves || 0));
        chartInstances.goalkeepers = new Chart(ctxGK.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedGks.map(g => formatChartName(PLAYER_NAMES[g.id] || g.id)),
                datasets: [
                    { label: 'Parate SX', data: sortedGks.map(g => g.savesSX || 0), backgroundColor: '#16a34a', stack: 'Parate' },
                    { label: 'Parate CT', data: sortedGks.map(g => g.savesCT || 0), backgroundColor: '#22c55e', stack: 'Parate' },
                    { label: 'Parate DX', data: sortedGks.map(g => g.savesDX || 0), backgroundColor: '#86efac', stack: 'Parate' },
                    { label: 'GS SX', data: sortedGks.map(g => -(g.goalsSX || 0)), backgroundColor: '#991b1b', stack: 'GS' },
                    { label: 'GS CT', data: sortedGks.map(g => -(g.goalsCT || 0)), backgroundColor: '#ef4444', stack: 'GS' },
                    { label: 'GS DX', data: sortedGks.map(g => -(g.goalsDX || 0)), backgroundColor: '#fca5a5', stack: 'GS' }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        ticks: {
                            callback: function (value) { return Math.abs(value); }
                        }
                    },
                    y: {
                        stacked: true,
                        ticks: {
                            padding: 10
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                label += Math.abs(context.parsed.x);
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    if (chartInstances.gkTiming) chartInstances.gkTiming.destroy();
    const ctxGKT = document.getElementById('goalkeepersTimingChart');
    if (ctxGKT && gks) {
        const sortedGksT = [...gks].sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
        chartInstances.gkTiming = new Chart(ctxGKT.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedGksT.map(g => formatChartName(PLAYER_NAMES[g.id] || g.id)),
                datasets: [{ label: 'Minuti Totali', data: sortedGksT.map(g => Math.floor(g.minutes || 0)), backgroundColor: '#06b6d4' }]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false }
        });
    }

    if (chartInstances.prpp) chartInstances.prpp.destroy();
    const ctxPRPP = document.getElementById('playersPRPPChart');
    if (ctxPRPP) {
        const topPRPP = [...players].sort((a, b) => (b.pr || 0) - (a.pr || 0)).slice(0, 10);
        chartInstances.prpp = new Chart(ctxPRPP.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topPRPP.map(p => formatChartName(PLAYER_NAMES[p.id] || p.id)),
                datasets: [
                    { label: 'Recuperate (PR)', data: topPRPP.map(p => p.pr || 0), backgroundColor: '#22c55e' },
                    { label: 'Perse (PP)', data: topPRPP.map(p => p.pp || 0), backgroundColor: '#ef4444' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: false },
                    y: { stacked: false }
                }
            }
        });
    }

    if (chartInstances.shots) chartInstances.shots.destroy();
    const ctxShots = document.getElementById('playerShotsChart');
    if (ctxShots) {
        const topShots = [...players].sort((a, b) => ((b.shotsOn || 0) + (b.shotsOff || 0) + (b.tm || 0)) - ((a.shotsOn || 0) + (a.shotsOff || 0) + (a.tm || 0))).slice(0, 10);
        chartInstances.shots = new Chart(ctxShots.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topShots.map(p => formatChartName(PLAYER_NAMES[p.id] || p.id)),
                datasets: [
                    { label: 'In Porta', data: topShots.map(p => p.shotsOn || 0), backgroundColor: '#22c55e' },
                    { label: 'Fuori', data: topShots.map(p => p.shotsOff || 0), backgroundColor: '#eab308' },
                    { label: 'Murati', data: topShots.map(p => p.tm || 0), backgroundColor: '#ef4444' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }

    if (chartInstances.timing) chartInstances.timing.destroy();
    const ctxTiming = document.getElementById('playersTimingChart');
    if (ctxTiming) {
        const topTiming = [...players].sort((a, b) => (b.minutes || 0) - (a.minutes || 0)).slice(0, 10);
        chartInstances.timing = new Chart(ctxTiming.getContext('2d'), {
            type: 'bar',
            data: {
                labels: topTiming.map(p => formatChartName(PLAYER_NAMES[p.id] || p.id)),
                datasets: [{ label: 'Minuti Totali', data: topTiming.map(p => Math.floor(p.minutes || 0)), backgroundColor: '#06b6d4' }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }
}

// --- Access Logs Logic ---
function logAccessAttempt(section, success, manualUser) {
    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');

    // Determine user info
    let uName = 'Ospite';
    let uRole = 'Ospite';

    // Prefer passed arg, then global user, then default
    if (manualUser) {
        uName = manualUser;
    } else if (window.CURRENT_USER) {
        uName = window.CURRENT_USER.username;
        uRole = window.CURRENT_USER.role;
    }

    logs.unshift({
        date: new Date().toISOString(),
        section: section,
        success: success,
        role: uName, // Storing username in 'role' field for backward compat with python script or just use a new field?
        // Python script looks for l.get('role'). Let's put the identifier there.
        device: navigator.userAgent // Optional: add device info
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
window.initUsers = function () {
    // 1. Try to load from Preloaded DB (Source of Truth from Excel + Persistent JSON)
    if (typeof PRELOADED_DATABASE !== 'undefined') {
        if (PRELOADED_DATABASE.users_data && PRELOADED_DATABASE.users_data.length > 0) {
            // MERGE Logic: Don't just overwrite, as we might have unsynced local users.
            let localUsers = [];
            try {
                localUsers = JSON.parse(localStorage.getItem('appUsers') || '[]');
            } catch (e) { localUsers = []; }

            const dbUsers = PRELOADED_DATABASE.users_data;
            const userMap = {};

            // 1. Add DB Users first (Baseline)
            dbUsers.forEach(u => { if (u.username) userMap[u.username] = u; });

            // 2. Add Local Users (Preserve unsynced changes)
            //    Note: If a user was deleted in DB but still in Local, it reappears. 
            //    This is acceptable given we want to avoid "disappearing new users".
            localUsers.forEach(u => {
                if (u.username) {
                    // Only overwrite if deemed "newer" or simply trust local for now?
                    // Let's trust local presence for new users. 
                    // For existing users, if password changed locally, we want that.
                    userMap[u.username] = u;
                }
            });

            const mergedUsers = Object.values(userMap);
            localStorage.setItem('appUsers', JSON.stringify(mergedUsers));
        }

        if (PRELOADED_DATABASE.access_logs && PRELOADED_DATABASE.access_logs.length > 0) {
            // Similar merge logic for logs could be useful, but let's stick to users for now as per request.
            // For logs, we usually want to append.
            // But existing logic was overwrite. Let's keep overwrite for logs to avoid duplication complexity for now
            // unless requested.
            localStorage.setItem('accessLogs', JSON.stringify(PRELOADED_DATABASE.access_logs));
        }
    }

    // 2. Fallback / Ensure Admin
    let users = [];
    try {
        users = JSON.parse(localStorage.getItem('appUsers') || '[]');
    } catch (e) { users = []; }

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

window.getUsers = function () {
    try {
        return JSON.parse(localStorage.getItem('appUsers') || '[]');
    } catch (e) { return []; }
}

function saveUsers(users) {
    localStorage.setItem('appUsers', JSON.stringify(users));
    renderUsersTable();
}

window.addUser = function () {
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

window.renderUsersTable = function () {
    const tbody = document.querySelector('#users-table tbody');
    if (!tbody) return;

    // Update Header if needed (Quick check to ensure 'Stato' column exists)
    const thead = document.querySelector('#users-table thead tr');
    if (thead && !thead.innerHTML.includes('Stato')) {
        // Rebuild header to include Stato
        thead.innerHTML = `
            <th style="width: 35%;">Email</th>
            <th style="width: 15%;">Stato</th>
            <th style="width: 20%;">Ruolo</th>
            <th style="width: 20%;">Pwd</th>
            <th style="text-align: right; width: 10%;"></th>
        `;
    }

    const users = getUsers();
    tbody.innerHTML = '';

    const currentUser = window.CURRENT_USER ? window.CURRENT_USER.username : null;

    users.forEach(u => {
        const isSelf = u.username === currentUser;

        let statusHtml = '<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>';
        let isOnline = isSelf;

        if (isSelf) {
            statusHtml = '<span class="badge" style="background: var(--success); color: white; display: inline-flex; align-items: center; gap: 4px;">🟢 Online (Tu)</span>';
        } else if (u.last_seen) {
            const last = new Date(u.last_seen);
            const now = new Date();
            const diffMins = (now - last) / (1000 * 60); // minutes

            if (diffMins < 10) {
                statusHtml = '<span class="badge" style="background: var(--success); color: white; display: inline-flex; align-items: center; gap: 4px;">🟢 Online</span>';
                isOnline = true;
            } else {
                const dateStr = last.toLocaleDateString('it-IT');
                const timeStr = last.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                statusHtml = `<span style="color: var(--text-muted); font-size: 0.75rem;">Ultimo: ${dateStr} ${timeStr}</span>`;
            }
        }

        const tr = document.createElement('tr');
        if (isOnline) tr.style.background = 'rgba(34, 197, 94, 0.1)';

        tr.innerHTML = `
            <td>${u.username}</td>
             <td>${statusHtml}</td>
            <td><span class="badge" style="background: ${['Admin', 'Staff Tecnico', 'Dirigenza'].includes(u.role) ? 'var(--primary)' : 'var(--border)'}">${u.role}</span></td>
            <td style="font-family: monospace;">${u.password}</td>
            <td style="text-align: right;">
                ${!isSelf ? `<button class="btn danger" style="padding: 2px 8px; font-size: 0.7rem;" onclick="deleteUser('${u.username}')">🗑️</button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Also render pending requests whenever users table is updated
    renderPendingRequestsTable();
}

// --- Pending Requests Logic ---
window.getPendingRequests = function () {
    try {
        return JSON.parse(localStorage.getItem('pendingRegistrations') || '[]');
    } catch (e) { return []; }
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

window.renderPendingRequestsTable = function () {
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

window.renderAccessLogs = function () {
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
        const restricted = ['setup-view'];
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
                updateUI(); // Refresh UI to update permissions on buttons

                logAccessAttempt('APP_START', true, `${username} (${role})`);

                // Show cancel button again for future use
                if (cancelBtn) cancelBtn.style.display = 'inline-block';

                // Default view
                const defaultBtn = document.querySelector('.tab-btn[data-target="staff-view"]');
                if (defaultBtn && !defaultBtn.classList.contains('locked-tab')) {
                    defaultBtn.click();
                    setTimeout(() => {
                        const subBtn = document.querySelector('.sub-tab-btn[data-subtarget="staff-home-subview"]');
                        if (subBtn) subBtn.click();
                    }, 100);
                }
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

        // Auto-navigate to first sub-chapter
        const viewContent = document.getElementById(targetId);
        if (viewContent) {
            const firstSubTab = viewContent.querySelector('.sub-tab-btn');
            if (firstSubTab) {
                // Ensure we don't click if it's locked (though sub-tabs might handle it, it's safer)
                if (!firstSubTab.classList.contains('locked-tab') && firstSubTab.getAttribute('data-locked') !== 'true') {
                    firstSubTab.click();
                }
            }
        }

        if (targetId === 'setup-view') {
            renderUsersTable();
            renderAccessLogs();
        }
        if (targetId === 'schemi-view') renderSchemiVideos();
        if (targetId === 'privacy-view') renderPrivacyTable();
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

        if (t.classList.contains('locked-tab') || t.getAttribute('data-locked') === 'true') {
            alert("⛔ Sezione bloccata per il tuo ruolo.");
            return;
        }

        if (targetId === 'accessi-subview') {
            renderAccessLogs();
            renderUsersTable();
        }
        if (targetId === 'staff-relazioni-subview') {
            renderRelazioniList();
        }

        const parent = t.closest('.sub-view-container') || t.closest('.view-content') || document;
        parent.querySelectorAll('.sub-tab-btn').forEach(x => x.classList.remove('active'));
        parent.querySelectorAll('.sub-view').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        const tg = document.getElementById(targetId);
        if (tg) {
            tg.classList.add('active');

            // Auto-navigate to first nested sub-tab if present
            const nestedTab = tg.querySelector('.sub-tab-btn');
            if (nestedTab && !nestedTab.classList.contains('locked-tab') && nestedTab.getAttribute('data-locked') !== 'true') {
                if (nestedTab !== t) {
                    nestedTab.click();
                }
            }
        }
    }));

    function navigateTo(targetView) {
        if (targetView && targetView.toLowerCase().endsWith('.pdf')) {
            window.open(targetView, '_blank');
            return;
        }
        const mainTab = document.querySelector(`[data-target="${targetView}"]`);
        if (mainTab) { mainTab.click(); return; }

        const subTab = document.querySelector(`[data-subtarget="${targetView}"]`);
        if (subTab) {
            const statTab = document.querySelector('[data-target="stats-container-view"]');
            if (statTab) statTab.click();
            subTab.click();
            return;
        }

        // Check if it's a specific element ID (e.g., charts section)
        const element = document.getElementById(targetView);
        if (element) {
            const parentView = element.closest('.view-content');
            const parentSubView = element.closest('.sub-view');

            if (parentView) {
                const tab = document.querySelector(`[data-target="${parentView.id}"]`);
                if (tab) tab.click();
            }

            if (parentSubView) {
                const subTabBtn = document.querySelector(`[data-subtarget="${parentSubView.id}"]`);
                if (subTabBtn) subTabBtn.click();
            }

            setTimeout(() => {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
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
        if (PRELOADED_DATABASE.players_birthyears) PLAYER_BIRTHYEARS = PRELOADED_DATABASE.players_birthyears;

        if (PRELOADED_DATABASE.matches) {
            PRELOADED_DATABASE.matches.forEach(m => {
                if (m.name) APP_STATE.processedFiles.push(m.name);
                if (m.sheets) m.sheets.forEach(s => { if (s.rows) processTimelineSheet(s.rows, s.name); });
            });
        }

        logDebug(`Dati caricati: ${APP_STATE.processedFiles.length} file elaborati.`);

        // Explicitly render custom tables for all teams
        console.log("[loadDB] Triggering custom table rendering...");
        renderTeamCustomTables('u15', 'U15');
        renderU15Roster();
        renderTeamCustomTables('first-team', '1^Squadra');
        renderTeamCustomTables('u19', 'U19');
        renderTeamCustomTables('csi', 'CSI');
        renderTeamCustomTables('femminile', 'Femminile');

        if (typeof updateUI === 'function') {
            updateUI();
        } else {
            console.warn("updateUI function is missing!");
        }
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

    window.openPlayerPerformance = function (fullName) {
        if (typeof PRELOADED_DATABASE === 'undefined') return;

        // Check permissions via the same getPerm function logic or similar check
        const permissions = (typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.permissions) || [];
        const pivotIdx = permissions.findIndex(p => p.Ruolo_Accesso === 'Ruolo_Accesso');
        const table2 = pivotIdx !== -1 ? permissions.slice(pivotIdx + 1) : [];
        const roleRow = table2.find(r => (r.Ruolo_Accesso || r.Ruolo) === userRole);

        let hasPerfAccess = false;
        if (userRole === 'Admin') hasPerfAccess = true;
        else if (roleRow) {
            const val = roleRow.Sponsor; // Mapped to Performance
            hasPerfAccess = val === true || val === 1 || String(val).toLowerCase() === 'true';
        }

        if (!hasPerfAccess) {
            alert("⛔ Accesso riservato allo Staff Tecnico e Dirigenza.");
            return;
        }

        const perfNames = PRELOADED_DATABASE.performance_names || [];
        const relFiles = PRELOADED_DATABASE.relazioni_files || [];

        // Check if DB says there are any files
        if (relFiles.length === 0) {
            alert("Nessun file trovato nel database (relazioni_files vuoto).");
            return;
        }

        // Advanced Normalization: lowercase, no accents, only letters and numbers
        const normalize = (s) => String(s).toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, '') // Keep spaces for word split
            .trim();

        const getWords = (s) => normalize(s).split(/\s+/).filter(w => w.length > 1);

        const targetWords = getWords(fullName);

        logDebug(`Matching performance for: ${fullName}`, { targetWords });

        // 1. Find the best match in performance_names (from Excel)
        let bestMatchedName = null;
        let maxOverlap = 0;

        perfNames.forEach(pn => {
            const pnWords = getWords(pn);
            const overlap = pnWords.filter(w => targetWords.includes(w)).length;
            let fuzzyOverlap = overlap;
            if (overlap === 0) {
                pnWords.forEach(pw => {
                    targetWords.forEach(tw => {
                        if (pw.length > 3 && tw.length > 3) {
                            if (pw.includes(tw) || tw.includes(pw)) fuzzyOverlap += 0.8;
                        }
                    });
                });
            }

            if (fuzzyOverlap > maxOverlap) {
                maxOverlap = fuzzyOverlap;
                bestMatchedName = pn;
            }
        });

        // Threshold for a valid match
        if (!bestMatchedName || maxOverlap < 1) {
            alert(`Nessuna valutazione trovata per ${fullName} nel file Excel.`);
            return;
        }

        logDebug(`Matched to Excel name: ${bestMatchedName} (score: ${maxOverlap})`);

        // 2. Look for best matching file in relazioni_files
        let bestFile = null;
        let maxFileOverlap = 0;

        relFiles.forEach(f => {
            if (!f.toLowerCase().endsWith('.pdf')) return;
            // Only look in Performance folder if distinct? OR just match all PDF
            // We want specific player performance files. Ideally they are in Performance/ folder.
            // But let's trust the name match.

            const fileNameOnly = f.split('/').pop().replace(/\.pdf$/i, '');
            const fileWords = getWords(fileNameOnly);

            const overlapTarget = fileWords.filter(w => targetWords.includes(w)).length;
            const overlapExcel = fileWords.filter(w => getWords(bestMatchedName).includes(w)).length;

            const totalOverlap = Math.max(overlapTarget, overlapExcel);

            if (totalOverlap > maxFileOverlap) {
                maxFileOverlap = totalOverlap;
                bestFile = f;
            }
        });

        if (bestFile && maxFileOverlap >= 1) {
            logDebug(`Opening PDF: ${bestFile} (score: ${maxFileOverlap})`);
            // Robust encoding: split by / and encode each part to avoid encoding the separators
            const parts = bestFile.split('/');
            const encodedPath = parts.map(p => encodeURIComponent(p)).join('/');

            logDebug(`Match found in DB. Opening file...`);

            // Standard Path Construction
            // We assume standard structure: DB/Relazioni/Performance/FileName.pdf
            // NOTE: Changed to Capitalized 'Relazioni' as this is likely the folder name on server.
            const url = `DB/Relazioni/${encodedPath}`;

            logDebug(`Target URL: ${url}`);

            const newWindow = window.open(url, '_blank');

            // If popup blocker prevents window.open, it returns null. 
            // In that case, we redirect the current tab.
            if (!newWindow) {
                window.location.href = url;
            }

            // Note: If the file is 404, the browser will just show its own 404 page. 
            // We can't catch that from JS easily across domains/protocols without fetch.
            // But since fetch is causing issues, we trust the direct link.

        } else {
            const diagInfo = `
Nome Cercato (Excel): ${bestMatchedName}
Score Match: ${maxFileOverlap}
File Trovati in DB: ${relFiles.length}
`;
            alert(`PDF non trovato nel DB (nessun match di nome).\n${diagInfo}`);
        }
    };

    // Link Rapidi Handler
    document.querySelectorAll('.quick-link-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = btn.getAttribute('data-goto');
            if (!target) return;

            // Handle PDF/File Links
            if (target.includes('.') || target.includes('/')) {
                window.open(target, '_blank');
                return;
            }

            // Handle Internal Navigation
            const el = document.getElementById(target);
            if (el) {
                // Check if inside a restricted view
                const parentView = el.closest('.view-content');
                if (parentView) {
                    const tabBtn = document.querySelector(`.tab-btn[data-target="${parentView.id}"]`);
                    if (tabBtn) tabBtn.click();
                }

                // Check for sub-views
                let current = el;
                const subViews = [];
                while (current && current !== parentView) {
                    if (current.classList.contains('sub-view')) {
                        subViews.unshift(current);
                    }
                    current = current.parentElement;
                }

                subViews.forEach(sv => {
                    const subBtn = document.querySelector(`.sub-tab-btn[data-subtarget="${sv.id}"]`);
                    if (subBtn) subBtn.click();
                });

                // Scroll
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 300);
            }
        });
    });

});

function renderPrivacyTable() {
    const tbody = document.querySelector('#privacy-table tbody');
    if (!tbody) return;

    if (typeof PRELOADED_DATABASE === 'undefined' || !PRELOADED_DATABASE.permissions) return;

    tbody.innerHTML = '';
    const permissions = PRELOADED_DATABASE.permissions;

    const check = (val) => {
        if (val === true || val === 1 || String(val).toLowerCase() === 'true') return '✅';
        if (val === false || val === 0 || String(val).toLowerCase() === 'false') return '🚫';
        return val || '';
    };

    permissions.forEach(row => {
        const tr = document.createElement('tr');

        // Style for the pivot row
        const isPivot = row.Ruolo_Accesso === 'Ruolo_Accesso';
        if (isPivot) {
            tr.style.background = 'rgba(99, 102, 241, 0.2)';
            tr.style.fontWeight = 'bold';
            tr.style.color = 'var(--primary)';
        }

        // Columns: Ruolo, Società, Home, Logistica, Storia, Relazioni, Sponsor, Privacy, Setup
        const cols = ['Ruolo_Accesso', 'Società', 'Home', 'Logistica', 'Storia', 'Relazioni', 'Sponsor', 'Privacy', 'Setup'];

        cols.forEach(col => {
            const td = document.createElement('td');
            const val = row[col];

            if (col === 'Ruolo_Accesso') {
                td.style.textAlign = 'left';
                td.style.fontWeight = '600';
                td.textContent = isPivot ? 'Mapping Segmento:' : (val || '-');
            } else {
                td.textContent = check(val);
                if (isPivot) td.style.fontSize = '0.75rem';
            }
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}
function renderTeamCustomTables(prefix, sheetName) {
    if (typeof PRELOADED_DATABASE === 'undefined' || !PRELOADED_DATABASE.extra_sheets) return;

    const data = PRELOADED_DATABASE.extra_sheets[sheetName];
    if (!data || data.length === 0) {
        console.warn(`[renderTeamCustomTables] No data found for sheet: ${sheetName}`);
        return;
    }
    console.log(`[renderTeamCustomTables] Rendering ${sheetName} for prefix ${prefix}. Rows: ${data.length}`);

    const header = data[0];
    const getCellContent = (cell, isHeader = false) => {
        if (typeof cell === 'object' && cell && cell.url) return cell.text || (isHeader ? '' : '0');
        const s = String(cell || '').trim();
        if (s === '') return isHeader ? '' : '0';
        return s;
    };

    // Partition data by empty columns
    const partitions = [];
    let currentPart = [];
    header.forEach((val, i) => {
        if (String(val || '').trim() === '' && i > 0) {
            if (currentPart.length > 0) partitions.push(currentPart);
            currentPart = [];
        } else {
            currentPart.push(i);
        }
    });
    if (currentPart.length > 0) partitions.push(currentPart);

    let calIndices = null;
    let claIndices = null;

    partitions.forEach(indices => {
        const rowText = indices.map(i => String(header[i] || '').toUpperCase()).join(' ');
        const hasCalKeywords = rowText.includes('LOCALI') || rowText.includes('DATE') || rowText.includes('DATA') || rowText.includes('NR.') || rowText.includes('RIS');
        const hasClaKeywords = rowText.includes('SQUADRE') || rowText.includes('SQUADRA') || rowText.includes('PT') || rowText.includes('POS');

        if (hasCalKeywords) {
            calIndices = indices;
        } else if (hasClaKeywords) {
            claIndices = indices;
        }
    });

    // Fallback: If only one partition and not identified, try default
    if (partitions.length === 1 && !calIndices && !claIndices) {
        const rowText = partitions[0].map(i => String(header[i] || '').toUpperCase()).join(' ');
        if (rowText.includes('RIS') || rowText.includes('COLUMN')) calIndices = partitions[0];
        else claIndices = partitions[0];
    }

    // 1. Calendario
    const calTable = document.querySelector(`#${prefix}-calendario-table tbody`);
    if (!calTable) console.error(`[renderTeamCustomTables] Table container #${prefix}-calendario-table tbody NOT FOUND`);
    if (calTable && calIndices) {
        calTable.innerHTML = '';
        data.forEach((row, rowIndex) => {
            const calRow = calIndices.map(i => row[i]);
            if (!calRow || calRow.every(c => !c)) return;

            const rowText = calRow.map(c => getCellContent(c, true)).join(' ').toUpperCase();
            if ((rowText.includes("GIORNATA") || rowText.includes("CAMPIONATO")) && calRow.every((c, i) => i === 0 || !c || (typeof c === 'object' && !c.url))) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.textContent = getCellContent(calRow[0], true).toUpperCase();
                td.colSpan = 15; td.style.fontWeight = '800'; td.style.textAlign = 'center'; td.style.background = 'var(--bg)';
                tr.appendChild(td);
                calTable.appendChild(tr);
                return;
            }

            const tr = document.createElement('tr');
            const isHeader = rowIndex === 0 || String(calRow[0]).toUpperCase().includes('DATA') || String(calRow[0]).toUpperCase().includes('NR.');

            calRow.forEach((cell) => {
                if (typeof cell === 'object' && cell && cell.url) return;
                const td = document.createElement('td');
                const s = getCellContent(cell, isHeader);
                td.textContent = s;
                if (isHeader) td.style.fontWeight = 'bold';
                if (s.toUpperCase().includes('VALLI')) td.classList.add('highlight-valli');
                if (s.match(/\d{1,2}[\/\-]\d{1,2}/)) td.className = 'cal-date';
                else td.className = 'cal-content';
                tr.appendChild(td);
            });

            let linkCells = calRow.filter(cell => cell && typeof cell === 'object' && cell.url);
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
                    const td = document.createElement('td');
                    td.className = 'cal-link';
                    const icon = cell.text.toUpperCase().includes('MDAY') || cell.url.match(/\.(jpg|png)$/i) ? '📸' : '🎬';
                    let cleanUrl = cell.url.replace(/\\/g, '/');
                    if (cleanUrl.startsWith('../')) cleanUrl = cleanUrl.substring(3);
                    if (cleanUrl.startsWith('./')) cleanUrl = cleanUrl.substring(2);
                    td.innerHTML = `<a href="${cleanUrl}" target="_blank" class="highlight-link">${icon} ${cell.text}</a>`;
                    tr.appendChild(td);
                });
            }
            calTable.appendChild(tr);
        });
    }

    // 2. Classifica
    const claTable = document.querySelector(`#${prefix}-classifica-table tbody`);
    if (claTable && claIndices) {
        claTable.innerHTML = '';
        data.forEach((row, rowIndex) => {
            const claRow = claIndices.map(i => row[i]);
            if (!claRow || claRow.every(c => !c)) return;

            const tr = document.createElement('tr');
            if (claRow.join(' ').toUpperCase().includes("VALLI")) tr.classList.add('highlight-valli');

            const isHeader = rowIndex === 0 || String(claRow[0]).toUpperCase().includes('SQUADRE');
            claRow.forEach(c => {
                const td = document.createElement('td');
                if (isHeader) td.style.fontWeight = 'bold';
                td.textContent = getCellContent(c, isHeader);
                tr.appendChild(td);
            });
            claTable.appendChild(tr);
        });
    }
}

function renderU15Roster() {
    console.log("[renderU15Roster] Starting...");
    const rosterGrid = document.querySelector('#u15-rosa-subview #roster-grid');
    if (!rosterGrid) {
        console.warn("[renderU15Roster] #roster-grid not found in #u15-rosa-subview");
        return;
    }

    if (!PRELOADED_DATABASE || !PRELOADED_DATABASE.u15_roster) {
        console.warn("[renderU15Roster] No roster data found.");
        rosterGrid.innerHTML = '<p>Dati non disponibili.</p>';
        return;
    }

    const roster = PRELOADED_DATABASE.u15_roster;
    // Deduplicate by ID
    const uniqueRoster = [];
    const seenIds = new Set();

    // Sort by ID number if possible
    roster.sort((a, b) => {
        const idA = parseInt(a.id) || 999;
        const idB = parseInt(b.id) || 999;
        return idA - idB;
    });

    roster.forEach(p => {
        if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            uniqueRoster.push(p);
        }
    });

    console.log(`[renderU15Roster] Rendering ${uniqueRoster.length} players.`);
    rosterGrid.innerHTML = uniqueRoster.map(p => `
        <div class="player-card">
            <div class="player-photo-container">
                <img src="${p.img}" class="player-photo" onerror="this.src='assets/logo.png'; this.style.opacity='0.5';">
                <div class="player-role-badge">${p.role || 'Giocatore'}</div>
            </div>
            <div class="player-info">
                <div class="player-name">${p.name || 'Agonista ' + p.id}</div>
            </div>
        </div>
    `).join('');
}

function updateTeamHomeStats(prefix, sheetName) {
    if (typeof PRELOADED_DATABASE === 'undefined') return;

    const data = PRELOADED_DATABASE.extra_sheets ? PRELOADED_DATABASE.extra_sheets[sheetName] : null;

    // Identify start of "Statistiche veloci" columns
    let statIdx = -1;
    if (data && data.length > 0) {
        const header = data[0];
        statIdx = header.findIndex((c, i) => i >= 8 && String(c || '').toUpperCase().includes('STAT'));
    }

    if (statIdx === -1) {
        // Fallback for U15 if "Statistiche veloci" not found
        if (!data && sheetName === 'U15' && PRELOADED_DATABASE.classifica) {
            const valliRow = PRELOADED_DATABASE.classifica.find(row => {
                const name = String(row[0] || '').toUpperCase();
                return name.includes("VALLI") || name.includes("CHIOGGIA") || name.includes("V.F.C");
            });
            if (valliRow) {
                const setVal = (suffix, val) => {
                    const el = document.getElementById(`${prefix}-${suffix}`);
                    if (el) el.textContent = val;
                };
                setVal('matches', parseInt(valliRow[2]) || 0); setVal('wins', parseInt(valliRow[3]) || 0);
                setVal('draws', parseInt(valliRow[4]) || 0); setVal('losses', parseInt(valliRow[5]) || 0);
                setVal('gf', parseInt(valliRow[6]) || 0); setVal('gs', parseInt(valliRow[7]) || 0);
            }
            return;
        }
        return;
    }

    // Extract unique pairs using a Map (keyed by label)
    const statsMap = new Map();
    const iconMap = {
        'POSIZIONE': '🏆', 'PUNTI': '🌟', 'PARTITE': '⚽', 'VITTORIE': '📈', 'PAREGGI': '🤝',
        'SCONFITTE': '📉', 'GOL SEGNATI': '🎯', 'GOL SUBITI': '🥅', 'DIFFERENZA': '⚖️',
        'MEDIA': '🔢', 'CAPOCANNONIERE': '🎖️', 'AMMONIZIONI': '🟨', 'ESPULSIONI': '🟥',
        'ETA': '📅', 'RIGORE': '⚽'
    };

    for (let r = 1; r < data.length; r++) {
        for (let c = statIdx; c < statIdx + 2; c++) {
            const cellVal = String(data[r][c] || '').trim();
            if (!cellVal) continue;
            let label = '', value = '';
            if (cellVal.includes('\n')) {
                const parts = cellVal.split('\n').filter(p => p.trim());
                if (cellVal.toUpperCase().includes('CAPOCANNONIERE')) {
                    label = 'Capocannoniere';
                    value = parts.filter(p => !p.toUpperCase().includes('CAPOCANNONIERE')).join(', ');
                } else if (parts.length >= 2) {
                    const first = parts[0].trim(), last = parts[parts.length - 1].trim();
                    if (/\d|°/.test(first)) { value = first; label = parts.slice(1).join(' ').trim(); }
                    else if (/\d|°/.test(last)) { value = last; label = parts.slice(0, -1).join(' ').trim(); }
                    else { value = first; label = last; }
                }
            } else if (cellVal.toUpperCase().includes('CAPOCANNONIERE')) {
                // Might be just the label, check if we can skip adding it as a pair if no value
                // But usually they are combined.
            }

            if (label && value) {
                const upLabel = label.toUpperCase();
                if (statsMap.has(upLabel)) continue; // Evita duplicati (es. Capocannoniere ripetuto)

                let icon = '📊';
                for (const [k, v] of Object.entries(iconMap)) { if (upLabel.includes(k)) { icon = v; break; } }

                let id = '';
                if (upLabel.includes('PARTITE')) id = `${prefix}-matches`;
                else if (upLabel.includes('VITTORIE') || upLabel === 'V') id = `${prefix}-wins`;
                else if (upLabel.includes('PAREGGI') || upLabel === 'N') id = `${prefix}-draws`;
                else if (upLabel.includes('SCONFITTE') || upLabel === 'P') id = `${prefix}-losses`;
                else if (upLabel.includes('GOL SEGNATI')) id = `${prefix}-gf`;
                else if (upLabel.includes('GOL SUBITI')) id = `${prefix}-gs`;

                statsMap.set(upLabel, { label, value, icon, id });
            }
        }
    }

    const stats = Array.from(statsMap.values());
    const grid = document.querySelector(`#${prefix}-home-subview .stats-grid`);
    if (grid && stats.length > 0) {
        grid.innerHTML = '';
        grid.style.gridTemplateColumns = stats.length > 6 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';
        grid.style.gap = '0.5rem';
        stats.forEach(s => {
            const card = document.createElement('div');
            card.className = 'stat-card';
            card.style.padding = '0.4rem 0.2rem';
            card.style.minWidth = '0';
            card.innerHTML = `
                <div class="stat-icon" style="font-size: 1rem; margin-bottom: 0.1rem;">${s.icon}</div>
                <div class="stat-value" ${s.id ? `id="${s.id}"` : ''} style="font-size: 0.9rem; white-space: pre-wrap; line-height: 1.1; font-weight: 700;">${s.value}</div>
                <div class="stat-label" style="font-size: 0.55rem; opacity: 0.8; word-break: break-word;">${s.label}</div>
            `;
            grid.appendChild(card);
        });
    }
}
