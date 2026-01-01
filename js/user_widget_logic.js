
// --- User Widget Logic ---
function renderUserHeader() {
    if (!CURRENT_USER) return;
    const nameEl = document.getElementById('current-user-name');
    const roleEl = document.getElementById('current-user-role');
    const avatarEl = document.getElementById('current-user-avatar');

    if (nameEl) nameEl.textContent = CURRENT_USER.username.split('@')[0];
    if (roleEl) roleEl.textContent = CURRENT_USER.role;
    if (avatarEl) {
        const initial = CURRENT_USER.username.charAt(0).toUpperCase();
        avatarEl.textContent = initial;
    }
}

window.toggleUserPanel = function () {
    const panel = document.getElementById('user-panel');
    if (panel) {
        panel.classList.toggle('show');
        if (panel.classList.contains('show')) {
            fetchActiveUsers();
        }
    }
};

// Close on click outside
document.addEventListener('click', (e) => {
    const widget = document.getElementById('user-widget');
    const panel = document.getElementById('user-panel');
    if (widget && panel && !widget.contains(e.target)) {
        panel.classList.remove('show');
    }
});

function fetchActiveUsers() {
    const list = document.getElementById('active-users-list');
    if (!list) return;

    list.innerHTML = '';
    // "Connected" users are simulated by looking at accessLogs from last 24h
    const logs = JSON.parse(localStorage.getItem('accessLogs') || '[]');
    const now = new Date();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Group by user, get latest activity
    const userActivity = {};

    logs.forEach(log => {
        const d = new Date(log.date);
        if (now - d < ONE_DAY) {
            // In enforceLogin we store `${username} (${role})` as the 3rd arg to logAccessAttempt
            let identity = log.role;
            if (!userActivity[identity] || new Date(userActivity[identity]) < d) {
                userActivity[identity] = d;
            }
        }
    });

    // Ensure Current user is present and up to date
    if (CURRENT_USER) {
        const id = `${CURRENT_USER.username} (${CURRENT_USER.role})`;
        userActivity[id] = new Date();
    }

    const sortedUsers = Object.entries(userActivity).sort((a, b) => b[1] - a[1]);

    if (sortedUsers.length === 0) {
        list.innerHTML = '<li style="padding:0.5rem; color:var(--text-muted);">Nessun altro utente attivo.</li>';
        return;
    }

    sortedUsers.forEach(([name, time]) => {
        const isMe = CURRENT_USER && name.includes(CURRENT_USER.username);

        // Format time
        const diffMins = Math.floor((now - time) / 60000);
        let timeStr = 'Adesso';
        if (diffMins > 0) timeStr = `${diffMins} min fa`;
        if (diffMins > 60) timeStr = `${Math.floor(diffMins / 60)} ore fa`;

        const li = document.createElement('li');
        li.className = 'active-user-item';
        li.innerHTML = `
                <div class="active-user-avatar">${name.charAt(0).toUpperCase()}</div>
                <div class="active-user-info">
                    <span class="active-user-name">${name} ${isMe ? '(Tu)' : ''}</span>
                    <span class="active-user-time">${timeStr}</span>
                </div>
            `;
        list.appendChild(li);
    });
}

window.logout = function () {
    if (confirm("Vuoi disconnetterti?")) {
        CURRENT_USER = null;
        localStorage.removeItem('currentUserRole');
        location.reload();
    }
};
