// Futsal Analytics - Local Safe Script (V3 - Single File)
// Implements Time-based Event Stream Processing

// --- Utility: Log & Debug ---
const debugPanel = document.getElementById('debug-panel');
const debugOutput = document.getElementById('debug-output');

function logDebug(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    let msg = `[${timestamp}] ${message}`;
    if (data) {
        msg += '\n' + JSON.stringify(data, null, 2);
    }
    console.log(message, data);
    if (debugOutput) debugOutput.textContent = msg + '\n' + '-'.repeat(40) + '\n' + debugOutput.textContent;
}

// --- CONSTANTS ---
const SHEET_NAMES_TO_PROCESS = ['PRIMO TEMPO', 'SECONDO TEMPO'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_PER_DAY = 24 * 60; // 1440

// --- STATE ---
let PLAYER_NAMES = {}; // Mappatura ID -> Cognome/Nome
let TOTAL_MINUTES_PROCESSED = 0;

let APP_STATE = {
    players: {},
    quartets: {},
    goalkeepers: {},
    processedFiles: []
};

function resetState() {
    APP_STATE = { players: {}, quartets: {}, goalkeepers: {}, processedFiles: [] };
    TOTAL_MINUTES_PROCESSED = 0;
}

// --- CORE PARSING ---

/**
 * Processes a timeline sheet (Event Stream) row by row.
 */
function processTimelineSheet(rows, sheetName) {
    if (!rows || rows.length < 2) return;

    // 1. Identify Headers
    const headers = rows[0].map(h => (String(h) || "").toUpperCase().trim());

    // Map Columns
    const IDX = {
        TIMING: headers.indexOf("TIMING"),
        PORTIERI: headers.indexOf("PORTIERI"),
        Q1: headers.indexOf("Q1"),
        Q2: headers.indexOf("Q2"),
        Q3: headers.indexOf("Q3"),
        Q4: headers.indexOf("Q4"),
        GF: headers.indexOf("GOAL FATTI"),
        GS: headers.indexOf("GOAL SUBITI"),
        TF: headers.indexOf("TIRI IN PORTA"),
        TO: headers.indexOf("TIRI OUT"),
        TM: headers.indexOf("TIRI MURATI"),
        PARATE: headers.indexOf("PARATE"),
        PP: headers.indexOf("PALLE PERSE"),
        PR: headers.indexOf("PALLE RECUPERATE"),
        FF: headers.indexOf("FALLI FATTI"),
        FS: headers.indexOf("FALLI SUBITI")
    };

    logDebug(`Mappa Colonne (${sheetName}):`, IDX);

    if (IDX.TIMING === -1 || IDX.Q1 === -1) {
        logDebug(`❌ ERRORE: Colonne critiche TIMING/Q non trovate in ${sheetName}.`);
        return;
    }

    let lastQuartetKey = null;

    // 2. Iterate Rows
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nextRow = rows[i + 1];

        // --- Calculate Duration ---
        // Duration is Delta between this row TIMING and next row TIMING.
        // If next row is missing (end of sheet), duration is 0 (or small fallback).
        let duration = 0;

        // Helper interno per convertire tempo (Excel o Stringa) in numero decimale
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

        // --- GOALKEEPER ---
        const gkId = row[IDX.PORTIERI];
        if (hasValue(gkId)) {
            addStat(APP_STATE.goalkeepers, gkId, 'minutes', duration);

            // GK Saves
            const saveVal = row[IDX.PARATE];
            if (hasValue(saveVal)) {
                addStat(APP_STATE.goalkeepers, gkId, 'saves', 1);
                const s = String(saveVal).toUpperCase();
                if (s.includes("SX")) addStat(APP_STATE.goalkeepers, gkId, 'savesSX', 1);
                else if (s.includes("DX")) addStat(APP_STATE.goalkeepers, gkId, 'savesDX', 1);
                else addStat(APP_STATE.goalkeepers, gkId, 'savesCT', 1); // Default a Centrale (CT) se non specificato
            }

            // GK Goals Against
            const gsVal = row[IDX.GS];
            if (hasValue(gsVal)) {
                addStat(APP_STATE.goalkeepers, gkId, 'gs', 1);
                const s = String(gsVal).toUpperCase();
                if (s.includes("SX")) addStat(APP_STATE.goalkeepers, gkId, 'goalsSX', 1);
                else if (s.includes("DX")) addStat(APP_STATE.goalkeepers, gkId, 'goalsDX', 1);
                else addStat(APP_STATE.goalkeepers, gkId, 'goalsCT', 1); // Default a Centrale (CT)
            }
        }

        // --- Identify Actors ---
        const qMembers = [row[IDX.Q1], row[IDX.Q2], row[IDX.Q3], row[IDX.Q4]]
            .filter(x => x !== undefined && x !== null); // Removing nulls

        if (qMembers.length === 0) continue;

        // Quartet Key (Sorted IDs)
        const quartetKey = qMembers.sort().join("-");

        if (quartetKey !== lastQuartetKey) {
            addStat(APP_STATE.quartets, quartetKey, 'freq', 1);
            lastQuartetKey = quartetKey;
        }

        // --- Accumulate Stats ---

        // 1. Minutes
        qMembers.forEach(pid => addStat(APP_STATE.players, pid, 'minutes', duration));
        addStat(APP_STATE.quartets, quartetKey, 'minutes', duration, { members: qMembers });

        // 2. Events (Goals, Shots, etc.)
        // These events apply to the LINEUP ON THE FIELD at that moment.
        // Usually valid for the players + quartet.

        // Goal For
        const scorerId = row[IDX.GF];
        if (hasValue(scorerId)) {
            // Assegna il goal PERSONALE solo al marcatore
            addStat(APP_STATE.players, scorerId, 'goals', 1);

            // Assegna il Plus/Minus (+1) a TUTTI i presenti (incluso il marcatore)
            qMembers.forEach(pid => {
                addStat(APP_STATE.players, pid, 'plusMinus', 1);
            });

            addStat(APP_STATE.quartets, quartetKey, 'gf', 1);
            addStat(APP_STATE.quartets, quartetKey, 'diff', 1);
        }

        // Goal Against
        if (hasValue(row[IDX.GS])) {
            qMembers.forEach(pid => {
                addStat(APP_STATE.players, pid, 'gs', 1);
                addStat(APP_STATE.players, pid, 'plusMinus', -1);
            });
            addStat(APP_STATE.quartets, quartetKey, 'gs', 1);
            addStat(APP_STATE.quartets, quartetKey, 'diff', -1);
        }

        // Tiri in Porta (TF)
        const tfPlayer = row[IDX.TF];
        if (hasValue(tfPlayer)) {
            addStat(APP_STATE.players, tfPlayer, 'shotsOn', 1);
            addStat(APP_STATE.quartets, quartetKey, 'shotsOn', 1);
        }

        // Tiri Out (TO)
        const toPlayer = row[IDX.TO];
        if (hasValue(toPlayer)) {
            addStat(APP_STATE.players, toPlayer, 'shotsOff', 1);
            addStat(APP_STATE.quartets, quartetKey, 'shotsOff', 1);
        }

        // Tiri Subiti (Aggregati per Quartetto)
        if (hasValue(row[IDX.GS]) || hasValue(row[IDX.PARATE])) {
            addStat(APP_STATE.quartets, quartetKey, 'shotsAgainst', 1);
        }

        // Palle Perse (PP)
        const ppPlayer = row[IDX.PP];
        if (hasValue(ppPlayer)) {
            addStat(APP_STATE.players, ppPlayer, 'pp', 1);
            addStat(APP_STATE.quartets, quartetKey, 'pp', 1);
        }

        // Palle Recuperate (PR)
        const prPlayer = row[IDX.PR];
        if (hasValue(prPlayer)) {
            addStat(APP_STATE.players, prPlayer, 'pr', 1);
            addStat(APP_STATE.quartets, quartetKey, 'pr', 1);
        }

        // Falli Fatti (FF)
        const ffPlayer = row[IDX.FF];
        if (hasValue(ffPlayer)) {
            addStat(APP_STATE.players, ffPlayer, 'ff', 1);
            addStat(APP_STATE.quartets, quartetKey, 'ff', 1);
        }

        // Falli Subiti (FS)
        const fsPlayer = row[IDX.FS];
        if (hasValue(fsPlayer)) {
            addStat(APP_STATE.players, fsPlayer, 'fs', 1);
            addStat(APP_STATE.quartets, quartetKey, 'fs', 1);
        }

    }
}

// Helper: Add value to stat object
function addStat(store, id, prop, val, metadata = {}) {
    if (!store[id]) {
        store[id] = { id: id, ...metadata };
    } else {
        // Applica metadati mancanti (es. members) se non presenti
        Object.assign(store[id], metadata);
    }
    if (!store[id][prop]) store[id][prop] = 0;
    store[id][prop] += val;
}

// Helper: Check if cell has meaningful content (not null/undefined/empty)
function hasValue(val) {
    return val !== undefined && val !== null && val !== "";
}

// --- UI LOGIC ---

function updateUI() {
    // 0. Aggiorna Home Page Stats
    document.getElementById('home-matches').textContent = APP_STATE.processedFiles.length;
    document.getElementById('home-time').textContent = formatTime(TOTAL_MINUTES_PROCESSED);

    const activePlayers = Object.values(APP_STATE.players).filter(p => !APP_STATE.goalkeepers[p.id] && PLAYER_NAMES[p.id]);
    const activeGoalkeepers = Object.values(APP_STATE.goalkeepers).filter(g => PLAYER_NAMES[g.id]);
    document.getElementById('home-players').textContent = activePlayers.length + activeGoalkeepers.length;

    if (activePlayers.length > 0) {
        const topScorer = activePlayers.sort((a, b) => (b.goals || 0) - (a.goals || 0))[0];
        const topName = PLAYER_NAMES[topScorer.id];
        const parts = topName.split(' ');
        const shortName = parts.length >= 2 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];
        document.getElementById('home-top-scorer').textContent = `${shortName} (${topScorer.goals || 0})`;
    }

    // Aggiorna Tempo Totale nel Header
    document.getElementById('total-match-time').textContent = formatTime(TOTAL_MINUTES_PROCESSED);

    // 0. Files Table
    const fTable = document.querySelector('#files-table tbody');
    if (fTable) {
        fTable.innerHTML = '';
        APP_STATE.processedFiles.forEach((name, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${idx + 1}</td>
                <td><span class="file-badge">${name}</span></td>
                <td><span class="text-success">✅ Elaborato</span></td>
            `;
            fTable.appendChild(tr);
        });
    }

    // 0.5. Roster Grid (Rosa Giocatori)
    const rosterGrid = document.getElementById('roster-grid');
    if (rosterGrid) {
        rosterGrid.innerHTML = '';

        // Giocatori di movimento
        const fieldPlayers = Object.values(APP_STATE.players)
            .filter(p => !APP_STATE.goalkeepers[p.id] && PLAYER_NAMES[p.id])
            .sort((a, b) => parseInt(a.id) - parseInt(b.id));

        // Portieri
        const goalkeepers = Object.values(APP_STATE.goalkeepers)
            .filter(g => PLAYER_NAMES[g.id])
            .sort((a, b) => parseInt(a.id) - parseInt(b.id));

        // Combina entrambi: prima i portieri, poi i giocatori
        const allPlayers = [...goalkeepers, ...fieldPlayers];

        allPlayers.forEach(p => {
            const fullName = PLAYER_NAMES[p.id];
            const isGoalkeeper = APP_STATE.goalkeepers[p.id] !== undefined;

            let stats = '';
            if (isGoalkeeper) {
                stats = `
                    <div class="stat-mini">
                        <div class="stat-mini-label">Parate</div>
                        <div class="stat-mini-value">${p.saves || 0}</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">GS</div>
                        <div class="stat-mini-value">${p.gs || 0}</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">Minuti</div>
                        <div class="stat-mini-value">${Math.floor(p.minutes || 0)}</div>
                    </div>
                `;
            } else {
                const getEff = (player) => {
                    const balance = (player.goals || 0) - (player.gs || 0) + (player.pr || 0) - (player.pp || 0);
                    return player.minutes > 0 ? (balance / player.minutes) * 100 : 0;
                };
                const ip = getEff(p).toFixed(1);
                stats = `
                    <div class="stat-mini">
                        <div class="stat-mini-label">Goal</div>
                        <div class="stat-mini-value">${p.goals || 0}</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">Minuti</div>
                        <div class="stat-mini-value">${Math.floor(p.minutes || 0)}</div>
                    </div>
                    <div class="stat-mini">
                        <div class="stat-mini-label">IP%</div>
                        <div class="stat-mini-value">${ip}%</div>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = 'player-card';
            card.innerHTML = `
                <div class="player-photo-container">
                    <img src="assets/players/${p.id}.png" 
                         alt="${fullName}" 
                         class="player-photo"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div class="player-placeholder" style="display:none;">⚽</div>
                    <div class="player-number-badge">${p.id}</div>
                    ${isGoalkeeper ? '<div class="player-role-badge">PORTIERE</div>' : ''}
                </div>
                <div class="player-info">
                    <div class="player-name">${fullName}</div>
                    <div class="player-stats-mini">
                        ${stats}
                    </div>
                </div>
            `;
            rosterGrid.appendChild(card);
        });
    }

    // 1. Players Table
    const pTable = document.querySelector('#players-table tbody');
    pTable.innerHTML = '';

    // Filtra (esclude i portieri) e ordina per Indice Efficienza (Formula: (GF-GS+PR-PP)/MIN * 100)
    const getEff = (p) => {
        const balance = (p.goals || 0) - (p.gs || 0) + (p.pr || 0) - (p.pp || 0);
        return p.minutes > 0 ? (balance / p.minutes) * 100 : -1000;
    };

    const players = Object.values(APP_STATE.players)
        .filter(p => !APP_STATE.goalkeepers[p.id] && PLAYER_NAMES[p.id]) // Esclude portieri e ID non in elenco
        .sort((a, b) => getEff(b) - getEff(a));

    players.forEach(p => {
        const tr = document.createElement('tr');
        const fullName = PLAYER_NAMES[p.id];

        // Formattazione Nome: COGNOME N.
        const parts = fullName.split(' ');
        const formattedName = parts.length >= 2 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];

        const eff = getEff(p).toFixed(1);
        const tiriTot = (p.shotsOn || 0) + (p.shotsOff || 0);

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${formattedName}</strong></td> 
            <td>${formatTime(p.minutes)}</td>
            <td>${p.goals || 0}</td>
            <td>${p.gs || 0}</td>
            <td>${p.shotsOn || 0}<small class="text-muted">/${tiriTot}</small></td>
            <td>${p.pr || 0}</td>
            <td>${p.pp || 0}</td>
            <td>${p.ff || 0}</td>
            <td>${p.fs || 0}</td>
            <td class="${parseFloat(eff) > 0 ? 'text-success' : (parseFloat(eff) < 0 ? 'text-danger' : '')}"><strong>${eff}%</strong></td>
        `;
        pTable.appendChild(tr);
    });

    // 3. Goalkeepers Output
    const gTable = document.querySelector('#goalkeepers-table tbody');
    gTable.innerHTML = '';

    const goalkeepers = Object.values(APP_STATE.goalkeepers).sort((a, b) => b.minutes - a.minutes);

    goalkeepers.forEach(g => {
        const tr = document.createElement('tr');
        const tt = (g.gs || 0) + (g.saves || 0);
        const ratio = tt > 0 ? ((g.saves / tt) * 100).toFixed(1) : "0.0";
        const gkName = PLAYER_NAMES[g.id] || `#${g.id}`;
        tr.innerHTML = `
            <td><strong>${gkName}</strong></td>
            <td>${formatTime(g.minutes)}</td>
            <td>${g.gs || 0}</td>
            <td class="text-muted" style="font-size: 0.8rem;">${g.goalsSX || 0}</td>
            <td class="text-muted" style="font-size: 0.8rem;">${g.goalsCT || 0}</td>
            <td class="text-muted" style="font-size: 0.8rem;">${g.goalsDX || 0}</td>
            <td>${g.saves || 0}</td>
            <td class="text-muted" style="font-size: 0.8rem;">${g.savesSX || 0}</td>
            <td class="text-muted" style="font-size: 0.8rem;">${g.savesCT || 0}</td>
            <td class="text-muted" style="font-size: 0.8rem;">${g.savesDX || 0}</td>
        `;
        gTable.appendChild(tr);
    });

    // 4. Quartets Table
    const qTable = document.querySelector('#quartets-table tbody');
    qTable.innerHTML = '';

    const getQuartetIP = (q) => {
        const balance = (q.gf || 0) - (q.gs || 0) + (q.pr || 0) - (q.pp || 0) + ((q.shotsOn || 0) + (q.shotsOff || 0) - (q.shotsAgainst || 0));
        return q.minutes > 0 ? (balance / q.minutes) * 100 : -1000;
    };

    let quartets = Object.values(APP_STATE.quartets)
        .sort((a, b) => getQuartetIP(b) - getQuartetIP(a));

    quartets.forEach(q => {
        if (!q.members) return;
        const tr = document.createElement('tr');

        const membersFormatted = q.members.map(id => {
            const fullName = PLAYER_NAMES[id] || `#${id}`;
            const parts = fullName.split(' ');
            return parts.length >= 2 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0];
        }).join(' - ');

        const ip = getQuartetIP(q).toFixed(1);
        const gBal = (q.gf || 0) - (q.gs || 0);
        const tBal = ((q.shotsOn || 0) + (q.shotsOff || 0)) - (q.shotsAgainst || 0);
        const pBal = (q.pr || 0) - (q.pp || 0);
        const tf = (q.shotsOn || 0) + (q.shotsOff || 0);

        tr.innerHTML = `
            <td><small class="badge">${membersFormatted}</small></td>
            <td>${q.gf || 0}</td>
            <td>${q.gs || 0}</td>
            <td>${tf}</td>
            <td>${q.shotsAgainst || 0}</td>
            <td>${q.pr || 0}</td>
            <td>${q.pp || 0}</td>
            <td><strong>${q.freq || 0}</strong></td>
            <td class="${parseFloat(ip) > 0 ? 'text-success' : (parseFloat(ip) < 0 ? 'text-danger' : '')}"><strong>${ip}%</strong></td>
            <td class="text-muted">${formatTime(q.minutes)}</td>
        `;
        qTable.appendChild(tr);
    });

    if (players.length > 0) {
        document.getElementById('dashboard').classList.remove('hidden');
        renderCharts();
    }

    // 5. Calendario Output
    const calTable = document.querySelector('#calendario-table tbody');
    if (calTable && typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.calendario) {
        calTable.innerHTML = '';
        PRELOADED_DATABASE.calendario.forEach(row => {
            // Salta righe vuote o che contengono l'intestazione del campionato fissa
            const rowText = row.map(c => typeof c === 'object' && c.text ? c.text : String(c || '')).join(' ').toUpperCase();
            if (rowText.includes("CAMPIONATO REGIONALE") || row.every(cell => !cell || cell === "")) return;

            const tr = document.createElement('tr');

            // Logica Intelligente:
            // Se c'è una data cella col 1, è una partita (Data - Partita - Risultato).
            // Altrimenti intestazione (Giornata X).
            const hasData = row[1] && String(row[1]).trim().length > 0;

            if (hasData) {
                // RIGA PARTITA: Data (1), Partita (2), Risultato (3). Ignora NR(0) e Struttura(4).
                const targetIndices = [1, 2, 3];

                targetIndices.forEach(idx => {
                    const td = document.createElement('td');
                    const cell = row[idx];
                    const cellStr = String(cell || '');

                    td.textContent = cellStr;
                    if (cellStr.toUpperCase().includes("VALLI")) {
                        td.classList.add('highlight-valli');
                    }
                    if (idx === 1) td.style.whiteSpace = 'nowrap';
                    tr.appendChild(td);
                });

                // Cerca LINK nelle colonne successive (dalla 4 in poi)
                let linkFound = false;
                for (let i = 4; i < row.length; i++) {
                    const cell = row[i];
                    if (typeof cell === 'object' && cell !== null && cell.url) {
                        const td = document.createElement('td');
                        const link = document.createElement('a');
                        link.href = cell.url;
                        link.target = '_blank';
                        link.className = 'highlight-link';

                        const urlLower = cell.url.toLowerCase();
                        const textLower = cell.text.toLowerCase();
                        let icon = '🎬';
                        let label = cell.text;

                        if (urlLower.match(/\.(jpg|jpeg|png|gif|webp|bmp)/) || textLower.includes('mday')) {
                            icon = '📸';
                            link.classList.add('link-image');
                        } else if (urlLower.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv)/) || textLower.includes('video') || textLower.includes('mvp') || textLower.includes('highlight')) {
                            icon = '🎬';
                            link.classList.add('link-video');
                        }

                        link.innerHTML = `${icon} ${label}`;
                        td.appendChild(link);
                        linkFound = true;
                    }
                }

                // Cella vuota se nessun link (per allineamento)
                if (!linkFound) {
                    const td = document.createElement('td');
                    tr.appendChild(td);
                }

            } else {
                // RIGA INTESTAZIONE (Giornata X)
                // Usiamo il contenuto della cella 0 (NR) o la prima trovata
                const headerText = row.find(c => c && String(c).trim() !== '') || row[0];
                const td = document.createElement('td');
                td.colSpan = 4; // Colspan = 4 (Data, Partita, Ris, Link)
                td.textContent = String(headerText).toUpperCase();
                td.style.fontWeight = '800';
                td.style.textAlign = 'center';
                td.style.backgroundColor = 'var(--bg)';
                td.style.padding = '0.75rem';
                td.style.color = 'var(--primary)';
                tr.appendChild(td);
            }

            calTable.appendChild(tr);
        });
    }

    // 6. Classifica Output
    const claTable = document.querySelector('#classifica-table tbody');
    if (claTable && typeof PRELOADED_DATABASE !== 'undefined' && PRELOADED_DATABASE.classifica) {
        claTable.innerHTML = '';
        PRELOADED_DATABASE.classifica.forEach(row => {
            // Salta righe vuote o che contengono l'intestazione del campionato
            const rowText = row.join(' ').toUpperCase();
            if (rowText.includes("CAMPIONATO REGIONALE") || row.every(cell => cell === "")) return;

            const tr = document.createElement('tr');
            if (rowText.includes("VALLI")) tr.classList.add('highlight-valli');

            row.forEach(cell => {
                const td = document.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
            });
            claTable.appendChild(tr);
        });
    }
}

let chartInstances = {};

function renderCharts() {
    const getEffScore = (p) => {
        const balance = (p.goals || 0) - (p.gs || 0) + (p.pr || 0) - (p.pp || 0);
        return p.minutes > 0 ? (balance / p.minutes) * 100 : -1000;
    };

    const players = Object.values(APP_STATE.players)
        .filter(p => !APP_STATE.goalkeepers[p.id])
        .sort((a, b) => getEffScore(b) - getEffScore(a))
        .slice(0, 10);
    const formatName = (fullName) => {
        const parts = fullName.split(' ');
        if (parts.length >= 2) {
            return `${parts[0]} ${parts[1].charAt(0)}.`;
        }
        return parts[0];
    };

    const labels = players.map(p => {
        const name = PLAYER_NAMES[p.id] || `#${p.id}`;
        return formatName(name);
    });

    // 1. Players Chart
    if (chartInstances.goals) chartInstances.goals.destroy();
    const ctxGoals = document.getElementById('playersGoalsChart').getContext('2d');

    const rawEff = players.map(p => getEffScore(p));
    const maxBarAbs = Math.max(...players.map(p => Math.max(p.goals || 0, p.shotsOn || 0, p.pr || 0, Math.abs(p.pp || 0))), 1);

    // Scaliamo l'efficienza % in modo che il range ideale sia visibile insieme alle barre
    // Ma manteniamo il valore reale nei tooltip
    const maxRawEff = Math.max(...rawEff.map(Math.abs), 1);
    const scaledEff = rawEff.map(v => (v / maxRawEff) * maxBarAbs);

    const maxPlayerMinutes = Math.max(...players.map(p => p.minutes || 0), 1);
    const scaledMin = players.map(p => (p.minutes / maxPlayerMinutes) * maxBarAbs);

    chartInstances.goals = new Chart(ctxGoals, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Goal',
                    data: players.map(p => p.goals || 0),
                    backgroundColor: 'rgba(99, 102, 241, 1)'
                },
                {
                    label: 'Tiri Porta',
                    data: players.map(p => p.shotsOn || 0),
                    backgroundColor: 'rgba(34, 197, 94, 1)'
                },
                {
                    label: 'PR',
                    data: players.map(p => p.pr || 0),
                    backgroundColor: 'rgba(6, 182, 212, 1)'
                },
                {
                    label: 'PP',
                    data: players.map(p => -(p.pp || 0)),
                    backgroundColor: 'rgba(239, 68, 68, 1)'
                },
                {
                    label: 'REND.',
                    type: 'line',
                    data: scaledEff,
                    borderColor: '#a855f7',
                    borderWidth: 3,
                    pointRadius: 4,
                    tension: 0.3,
                    realPerc: rawEff.map(v => v.toFixed(1))
                },
                {
                    label: 'Utilizzo (Minuti %)',
                    type: 'line',
                    data: scaledMin,
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 2,
                    tension: 0.3,
                    realPerc: players.map(p => (p.minutes / maxPlayerMinutes * 100).toFixed(1))
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: '#94a3b8' }, title: { display: true, text: 'Conteggio Eventi', color: '#94a3b8' } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 9 }, boxWidth: 10, padding: 5 } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (context.dataset.type === 'line' && context.dataset.realPerc) {
                                return label + ': ' + context.dataset.realPerc[context.dataIndex] + '%';
                            }
                            if (label) label += ': ';
                            return label + context.parsed.y;
                        }
                    }
                }
            }
        }
    });

    // 2. Quartets Chart
    if (chartInstances.quartets) chartInstances.quartets.destroy();
    const ctxQ = document.getElementById('quartetsPerformanceChart').getContext('2d');

    const getQEffScore = (q) => {
        const shotsFatti = (q.shotsOn || 0) + (q.shotsOff || 0);
        const activityBalance = shotsFatti + (q.pr || 0) - (q.shotsAgainst || 0) - (q.pp || 0);
        const goalBalance = (q.gf || 0) - (q.gs || 0);

        const term1 = activityBalance > 0 ? (q.minutes / activityBalance) : q.minutes;
        return term1 + goalBalance;
    };

    const topQuartets = Object.values(APP_STATE.quartets)
        .filter(q => getQEffScore(q) > 0)
        .sort((a, b) => getQEffScore(b) - getQEffScore(a)) // Ordine decrescente
        .slice(0, 6);

    const qLabels = topQuartets.map(q => {
        return q.members.map(id => {
            const name = PLAYER_NAMES[id] || `#${id}`;
            return formatName(name);
        }).join('-');
    });

    // Calcoliamo il valore massimo tra tutte le barre per la normalizzazione
    const maxQBar = Math.max(...topQuartets.map(q => Math.max(q.gf || 0, q.gs || 0, (q.shotsOn || 0) + (q.shotsOff || 0), q.shotsAgainst || 0, q.pr || 0, q.pp || 0)), 1);

    const globalMaxQ = Math.max(...Object.values(APP_STATE.quartets).map(q => getQEffScore(q)), 1);
    const rawQEff = topQuartets.map(q => getQEffScore(q));

    // Percentuale proporzionata al massimo globale
    const propQEff = rawQEff.map(v => (v / globalMaxQ) * 100);

    // Scaliamo per la linea (rispetto alle barre nel grafico)
    const scaledQEff = propQEff.map(v => (v / 100) * maxQBar);
    const realPercQEff = propQEff.map(v => v.toFixed(1));

    chartInstances.quartets = new Chart(ctxQ, {
        type: 'bar',
        data: {
            labels: qLabels,
            datasets: [
                {
                    label: 'GF',
                    data: topQuartets.map(q => q.gf || 0),
                    backgroundColor: '#22c55e'
                },
                {
                    label: 'GS',
                    data: topQuartets.map(q => q.gs || 0),
                    backgroundColor: '#ef4444'
                },
                {
                    label: 'TF',
                    data: topQuartets.map(q => (q.shotsOn || 0) + (q.shotsOff || 0)),
                    backgroundColor: 'rgba(34, 197, 94, 0.4)'
                },
                {
                    label: 'TS',
                    data: topQuartets.map(q => -(q.shotsAgainst || 0)),
                    backgroundColor: 'rgba(239, 68, 68, 0.4)'
                },
                {
                    label: 'PR',
                    data: topQuartets.map(q => q.pr || 0),
                    backgroundColor: 'rgba(6, 182, 212, 1)'
                },
                {
                    label: 'PP',
                    data: topQuartets.map(q => -(q.pp || 0)),
                    backgroundColor: 'rgba(153, 27, 27, 1)'
                },
                {
                    label: 'REND.',
                    type: 'line',
                    data: scaledQEff,
                    borderColor: '#a855f7',
                    borderWidth: 2,
                    pointBackgroundColor: '#a855f7',
                    fill: false,
                    realPerc: realPercQEff
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    position: 'bottom',
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    title: { display: true, text: 'Conteggio (Goal/Tiri)', color: '#94a3b8' }
                },
                y: {
                    ticks: { color: '#f8fafc', font: { size: 10 } }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 9 }, boxWidth: 10, padding: 5 } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (context.dataset.type === 'line' && context.dataset.realPerc) {
                                return label + ': ' + context.dataset.realPerc[context.dataIndex] + '%';
                            }
                            if (label) label += ': ';
                            return label + context.parsed.x;
                        }
                    }
                }
            }
        }
    });

    // 3. Goalkeepers Chart
    if (chartInstances.goalkeepers) chartInstances.goalkeepers.destroy();
    const ctxGK = document.getElementById('goalkeepersChart').getContext('2d');

    const gks = Object.values(APP_STATE.goalkeepers).sort((a, b) => b.minutes - a.minutes);
    const gkLabels = gks.map(g => formatName(PLAYER_NAMES[g.id] || `#${g.id}`));

    const gkMaxBar = Math.max(...gks.map(g => Math.max(g.saves || 0, g.gs || 0)), 1);

    chartInstances.goalkeepers = new Chart(ctxGK, {
        type: 'bar',
        data: {
            labels: gkLabels,
            datasets: [
                {
                    label: 'Parate SX',
                    data: gks.map(g => g.savesSX || 0),
                    backgroundColor: 'rgba(34, 197, 94, 0.5)',
                    stack: 'saves'
                },
                {
                    label: 'Parate CT',
                    data: gks.map(g => g.savesCT || 0),
                    backgroundColor: 'rgba(34, 197, 94, 0.75)',
                    stack: 'saves'
                },
                {
                    label: 'Parate DX',
                    data: gks.map(g => g.savesDX || 0),
                    backgroundColor: 'rgba(34, 197, 94, 1)',
                    stack: 'saves'
                },
                {
                    label: 'GS SX',
                    data: gks.map(g => -(g.goalsSX || 0)),
                    backgroundColor: 'rgba(239, 68, 68, 0.5)',
                    stack: 'goals'
                },
                {
                    label: 'GS CT',
                    data: gks.map(g => -(g.goalsCT || 0)),
                    backgroundColor: 'rgba(239, 68, 68, 0.75)',
                    stack: 'goals'
                },
                {
                    label: 'GS DX',
                    data: gks.map(g => -(g.goalsDX || 0)),
                    backgroundColor: 'rgba(239, 68, 68, 1)',
                    stack: 'goals'
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    stacked: true,
                    ticks: { color: '#f8fafc' }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { size: 9 }, boxWidth: 10, padding: 5 } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (context.dataset.type === 'line' && context.dataset.realPerc) {
                                return label + ': ' + context.dataset.realPerc[context.dataIndex] + '%';
                            }
                            if (label) label += ': ';
                            return label + Math.abs(context.parsed.x);
                        }
                    }
                }
            }
        }
    });
}

function formatTime(minutes) {
    if (!minutes) return "0:00";
    const m = Math.floor(minutes);
    const s = Math.round((minutes - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {

    const fileListObj = document.getElementById('file-list');

    function forceSync() {
        fileListObj.innerHTML = `Sincronizzazione in corso...`;

        // Inietta un nuovo script tag per bypassare la cache e rileggere var PRELOADED_DATABASE
        const oldScript = document.getElementById('db-sync-script');
        if (oldScript) oldScript.remove();

        const newScript = document.createElement('script');
        newScript.id = 'db-sync-script';
        newScript.src = `js/database.js?t=${Date.now()}`;
        newScript.onload = () => {
            loadDataFromDB();
            // Se il timestamp era identico, loadDataFromDB non fa nulla, quindi forziamo un messaggio
            if (fileListObj.innerHTML === `Sincronizzazione in corso...`) {
                fileListObj.innerHTML = `✅ Dati aggiornati (Indice: ${APP_STATE.processedFiles.length})`;
            }
        };
        newScript.onerror = () => {
            fileListObj.innerHTML = `❌ Errore: file database.js non trovato.`;
        };
        document.body.appendChild(newScript);
    }

    window.forceSync = forceSync;


    // Tabs Logic
    const tabs = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.target).classList.add('active');
        });
    });

    // Sub-Tabs Logic
    const subTabs = document.querySelectorAll('.sub-tab-btn');
    const subViews = document.querySelectorAll('.sub-view');
    subTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            subTabs.forEach(t => t.classList.remove('active'));
            subViews.forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.subtarget).classList.add('active');
        });
    });

    // Navigation Helper
    function navigateTo(targetView) {
        // 1. Prova a trovare un tab principale
        const mainTab = document.querySelector(`[data-target="${targetView}"]`);
        if (mainTab) {
            mainTab.click();
            return;
        }

        // 2. Se non è un tab principale, controlla se è una sub-view
        const subTab = document.querySelector(`[data-subtarget="${targetView}"]`);
        if (subTab) {
            // Trova il contenitore padre della sub-view (stats-container-view)
            // Attiva il tab "Statistiche"
            const statTab = document.querySelector('[data-target="stats-container-view"]');
            if (statTab) statTab.click();

            // Attiva il sub-tab specifico
            subTab.click();
        }
    }

    // Quick Links Logic
    const quickLinks = document.querySelectorAll('.quick-link-btn');
    quickLinks.forEach(link => {
        link.addEventListener('click', () => {
            navigateTo(link.dataset.goto);
        });
    });

    // Stat Cards Clickable Logic
    const statCards = document.querySelectorAll('.stat-clickable');
    statCards.forEach(card => {
        card.addEventListener('click', () => {
            navigateTo(card.dataset.goto);
        });
    });

    let lastDbTimestamp = null;

    function loadDataFromDB() {
        if (typeof PRELOADED_DATABASE === 'undefined') return;

        // Verifica se il database è effettivamente nuovo
        if (PRELOADED_DATABASE.timestamp === lastDbTimestamp) return;
        lastDbTimestamp = PRELOADED_DATABASE.timestamp;

        logDebug("Aggiornamento dati rilevato: " + lastDbTimestamp);
        resetState();

        // 1. Carica nomi
        if (PRELOADED_DATABASE.players_list) {
            PLAYER_NAMES = PRELOADED_DATABASE.players_list;
        }

        // 2. Procesa match
        if (PRELOADED_DATABASE.matches) {
            PRELOADED_DATABASE.matches.forEach(match => {
                if (match.name) APP_STATE.processedFiles.push(match.name);
                match.sheets.forEach(sheet => {
                    processTimelineSheet(sheet.rows, sheet.name);
                });
            });
            updateUI();
            fileListObj.innerHTML = `✅ Dati sincronizzati (Indice: ${APP_STATE.processedFiles.length})`;
        }
    }

    // --- AUTO-LOAD & POLLING ---
    loadDataFromDB();

    setInterval(() => {
        // Inietta un nuovo script tag per bypassare la cache e rileggere var PRELOADED_DATABASE
        const oldScript = document.getElementById('db-sync-script');
        if (oldScript) oldScript.remove();

        const newScript = document.createElement('script');
        newScript.id = 'db-sync-script';
        newScript.src = `js/database.js?t=${Date.now()}`;
        newScript.onload = () => loadDataFromDB();
        document.body.appendChild(newScript);
    }, 10000); // Controlla ogni 10 secondi
});
