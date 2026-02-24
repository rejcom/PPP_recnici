// ============================================================
// PPP Dashboard – hlavní logika
// ============================================================

let supabaseClient = null;
let currentUser = null;
let currentProfessional = null;
let currentClientId = null;
let progressChartInstance = null;
const API_BASE = '/api/db';

// ============================================================
// Inicializace
// ============================================================

async function initApp() {
    try {
        const res = await fetch('/api/supabase-config');
        const config = await res.json();
        supabaseClient = window.supabase.createClient(config.url, config.anonKey);

        // Listener pro auth změny (potvrzení e-mailu, atd.)
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                // Dokončit registraci pokud čeká
                const savedMeta = localStorage.getItem('ppp_registration_meta');
                if (savedMeta) {
                    const meta = JSON.parse(savedMeta);
                    const { data: existing } = await supabaseClient
                        .from('professionals')
                        .select('id')
                        .eq('auth_user_id', session.user.id)
                        .maybeSingle();
                    if (!existing) {
                        await completeRegistration(session.user, meta, session.user.email);
                    }
                    localStorage.removeItem('ppp_registration_meta');
                }
                await loadProfessionalProfile();
                showDashboard();
            }
        });

        // Zkontrolovat existující session
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            currentUser = session.user;
            await loadProfessionalProfile();
            showDashboard();
        } else {
            showLogin();
        }
    } catch (e) {
        console.error('Init error:', e);
        showLogin();
    }
}

// ============================================================
// Auth
// ============================================================

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadDashboardData();
}

async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;

    // Zkontrolovat, jestli čeká nedokončená registrace
    const savedMeta = localStorage.getItem('ppp_registration_meta');
    if (savedMeta) {
        const meta = JSON.parse(savedMeta);
        // Zkontrolovat, jestli profil už existuje
        const { data: existing } = await supabaseClient
            .from('professionals')
            .select('id')
            .eq('auth_user_id', data.user.id)
            .maybeSingle();
        if (!existing) {
            await completeRegistration(data.user, meta, email);
        }
        localStorage.removeItem('ppp_registration_meta');
    }

    await loadProfessionalProfile();
    showDashboard();
}

async function register(email, password, meta) {
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: meta }
    });
    if (error) throw error;

    // Pokud Supabase vyžaduje potvrzení e-mailu, session nebude
    const session = data.session;
    if (!session) {
        // E-mail confirmation je zapnutá — uživatel musí potvrdit e-mail
        alert('Registrace úspěšná! Zkontrolujte svůj e-mail a klikněte na potvrzovací odkaz. Pak se přihlaste.');
        // Uložit metadata do localStorage pro dokončení po přihlášení
        localStorage.setItem('ppp_registration_meta', JSON.stringify({
            ...meta,
            email: email,
            user_id: data.user?.id
        }));
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
        return;
    }

    // Session existuje (e-mail confirmation vypnutá) — vytvořit profil
    currentUser = data.user;
    await completeRegistration(data.user, meta, email);
    await loadProfessionalProfile();
    showDashboard();
}

// Dokončení registrace — vytvoření instituce + profilu
async function completeRegistration(user, meta, email) {
    try {
        // Vytvořit nebo najít instituci
        let institutionId = null;
        if (meta.institution) {
            const { data: inst } = await supabaseClient
                .from('institutions')
                .select('id')
                .eq('name', meta.institution)
                .single();
            if (inst) {
                institutionId = inst.id;
            } else {
                const { data: newInst, error: instErr } = await supabaseClient
                    .from('institutions')
                    .insert({ name: meta.institution, type: 'ppp' })
                    .select('id')
                    .single();
                if (instErr) console.error('Institution insert error:', instErr);
                if (newInst) institutionId = newInst.id;
            }
        }

        // Vytvořit profil profesionála
        const { error: profErr } = await supabaseClient.from('professionals').insert({
            auth_user_id: user.id,
            first_name: meta.first_name || meta.first_name,
            last_name: meta.last_name || meta.last_name,
            role: meta.role || 'psycholog',
            institution_id: institutionId,
            email: email
        });
        if (profErr) console.error('Professional insert error:', profErr);
    } catch (e) {
        console.error('completeRegistration error:', e);
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    currentProfessional = null;
    showLogin();
}

async function loadProfessionalProfile() {
    if (!currentUser) return;
    const { data } = await supabaseClient
        .from('professionals')
        .select('*, institutions(name, type)')
        .eq('auth_user_id', currentUser.id)
        .single();
    currentProfessional = data;
    if (data) {
        document.getElementById('navUserName').textContent =
            `${data.first_name} ${data.last_name}`;
        if (data.institutions) {
            document.getElementById('institutionName').textContent = data.institutions.name;
        }
    }
}

function getAuthHeaders() {
    const session = supabaseClient?.realtime?.accessToken;
    // Use supabase session token
    return {};
}

async function apiCall(endpoint, method = 'GET', body = null) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}/${endpoint}`, opts);
    return res.json();
}

// ============================================================
// Dashboard Data
// ============================================================

async function loadDashboardData() {
    switchTab('overview');
    await Promise.all([
        loadOverview(),
        loadClients(),
        populateClientSelects()
    ]);
    setupProgressRatings();
}

async function loadOverview() {
    try {
        const [clientsRes, sessionsRes] = await Promise.all([
            apiCall('clients'),
            apiCall('sessions?recent=true&limit=10')
        ]);

        const clients = clientsRes.data || [];
        const sessions = sessionsRes.data || [];

        document.getElementById('statClients').textContent = clients.length;
        document.getElementById('statSessions').textContent = sessions.length;

        // Spočítat sezení tento měsíc
        const now = new Date();
        const thisMonth = sessions.filter(s => {
            const d = new Date(s.session_date);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        document.getElementById('statThisMonth').textContent = thisMonth.length;

        // Poslední sezení
        renderRecentSessions(sessions.slice(0, 5));
    } catch (e) {
        console.error('loadOverview error:', e);
    }
}

function renderRecentSessions(sessions) {
    const el = document.getElementById('recentSessionsList');
    if (!sessions.length) {
        el.innerHTML = '<p class="empty-state">Žádná sezení zatím nezaznamenána.</p>';
        return;
    }
    el.innerHTML = sessions.map(s => `
        <div class="list-item" onclick="openClientDetail('${s.client_id}')">
            <div class="list-item-main">
                <span class="list-item-title">${s.clients?.first_name || ''} ${s.clients?.last_name || ''}</span>
                <span class="list-item-sub">${s.session_type || 'sezení'}</span>
            </div>
            <div class="list-item-meta">
                <span class="date-badge">${formatDate(s.session_date)}</span>
            </div>
        </div>
    `).join('');
}

// ============================================================
// Klienti
// ============================================================

async function loadClients(searchQuery = '') {
    try {
        const endpoint = searchQuery
            ? `clients?search=${encodeURIComponent(searchQuery)}`
            : 'clients';
        const res = await apiCall(endpoint);
        renderClients(res.data || []);
    } catch (e) {
        console.error('loadClients error:', e);
    }
}

function renderClients(clients) {
    const el = document.getElementById('clientsList');
    if (!clients.length) {
        el.innerHTML = '<p class="empty-state">Žádní klienti. Přidejte nového klienta.</p>';
        return;
    }
    el.innerHTML = clients.map(c => `
        <div class="client-card" onclick="openClientDetail('${c.id}')">
            <div class="client-avatar">${(c.first_name?.[0] || '?')}${(c.last_name?.[0] || '')}</div>
            <div class="client-info">
                <div class="client-name">${c.first_name} ${c.last_name}</div>
                <div class="client-meta">${c.school_name || 'Škola neuvedena'}${c.class_name ? ', ' + c.class_name : ''}</div>
                <div class="client-meta">${c.total_sessions || 0} sezení · Posl.: ${c.last_session ? formatDate(c.last_session) : 'nikdy'}</div>
            </div>
        </div>
    `).join('');
}

async function openClientDetail(clientId) {
    currentClientId = clientId;
    document.getElementById('clientDetailModal').style.display = 'flex';

    // Aktivovat tab "Info"
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.detail-content').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-detail="info"]').classList.add('active');
    document.getElementById('detail-info').classList.add('active');

    await Promise.all([
        loadClientInfo(clientId),
        loadClientSessions(clientId),
        loadClientProgress(clientId),
        loadClientDocs(clientId)
    ]);
}

async function loadClientInfo(clientId) {
    const res = await apiCall(`clients?id=${clientId}`);
    const c = res.data;
    if (!c) return;

    document.getElementById('clientDetailName').textContent = `${c.first_name} ${c.last_name}`;
    document.getElementById('clientInfoContent').innerHTML = `
        <div class="info-grid">
            <div class="info-item"><span class="info-label">Datum narození</span><span>${c.birth_date ? formatDate(c.birth_date) : '—'}</span></div>
            <div class="info-item"><span class="info-label">Pohlaví</span><span>${c.gender === 'M' ? 'Chlapec' : c.gender === 'F' ? 'Dívka' : '—'}</span></div>
            <div class="info-item"><span class="info-label">Škola</span><span>${c.school_name || '—'}</span></div>
            <div class="info-item"><span class="info-label">Třída</span><span>${c.class_name || '—'}</span></div>
            <div class="info-item"><span class="info-label">Rodič</span><span>${c.parent_name || '—'}</span></div>
            <div class="info-item"><span class="info-label">Telefon</span><span>${c.parent_phone || '—'}</span></div>
            <div class="info-item"><span class="info-label">E-mail</span><span>${c.parent_email || '—'}</span></div>
            <div class="info-item full-width"><span class="info-label">Poznámky</span><span>${c.notes || '—'}</span></div>
        </div>
        <div class="info-actions">
            <button class="btn btn-small" onclick="editClient('${clientId}')">✏️ Upravit</button>
            <button class="btn btn-small btn-danger" onclick="deactivateClient('${clientId}')">🗑 Deaktivovat</button>
        </div>
    `;
}

async function loadClientSessions(clientId) {
    const res = await apiCall(`sessions?client_id=${clientId}`);
    const sessions = res.data || [];
    const el = document.getElementById('clientSessionsList');

    if (!sessions.length) {
        el.innerHTML = '<p class="empty-state">Žádná sezení.</p>';
        return;
    }

    el.innerHTML = sessions.map(s => `
        <div class="session-card">
            <div class="session-header">
                <span class="date-badge">${formatDate(s.session_date)}</span>
                <span class="session-type-badge">${s.session_type || '—'}</span>
                <span class="session-prof">${s.professionals?.first_name || ''} ${s.professionals?.last_name || ''}</span>
            </div>
            <div class="session-body">
                ${s.zavery ? `<p><strong>Závěry:</strong> ${truncate(s.zavery, 200)}</p>` : ''}
                ${s.doporuceni ? `<p><strong>Doporučení:</strong> ${truncate(s.doporuceni, 200)}</p>` : ''}
                ${s.poznamky ? `<p><strong>Poznámky:</strong> ${truncate(s.poznamky, 150)}</p>` : ''}
            </div>
            <div class="session-actions">
                <button class="btn btn-small" onclick="viewSession('${s.id}')">📋 Detail</button>
            </div>
        </div>
    `).join('');
}

async function loadClientProgress(clientId, category = '') {
    const endpoint = category
        ? `progress?client_id=${clientId}&category=${encodeURIComponent(category)}`
        : `progress?client_id=${clientId}`;
    const res = await apiCall(endpoint);
    const data = res.data || [];

    renderProgressChart(data);
    renderProgressTimeline(data);
}

function renderProgressChart(data) {
    const canvas = document.getElementById('progressChart');
    if (progressChartInstance) progressChartInstance.destroy();

    if (!data.length) {
        progressChartInstance = null;
        return;
    }

    // Seskupit podle kategorie
    const categories = {};
    data.forEach(d => {
        if (!categories[d.category]) categories[d.category] = [];
        categories[d.category].push({ x: d.noted_at || d.created_at, y: d.rating });
    });

    const colors = [
        '#4f46e5', '#10b981', '#f59e0b', '#ef4444',
        '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6'
    ];

    const datasets = Object.entries(categories).map(([cat, points], i) => ({
        label: categoryLabel(cat),
        data: points.sort((a, b) => new Date(a.x) - new Date(b.x)),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + '20',
        tension: 0.3,
        fill: true
    }));

    progressChartInstance = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            scales: {
                x: {
                    type: 'category',
                    labels: [...new Set(data.map(d => formatDate(d.noted_at || d.created_at)))],
                    title: { display: true, text: 'Datum' }
                },
                y: {
                    min: 1,
                    max: 5,
                    title: { display: true, text: 'Hodnocení' },
                    ticks: { stepSize: 1 }
                }
            },
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function renderProgressTimeline(data) {
    const el = document.getElementById('progressTimeline');
    if (!data.length) {
        el.innerHTML = '<p class="empty-state">Zatím žádné hodnocení pokroku.</p>';
        return;
    }

    // Seskupit podle data
    const byDate = {};
    data.forEach(d => {
        const key = formatDate(d.noted_at || d.created_at);
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(d);
    });

    el.innerHTML = Object.entries(byDate).reverse().map(([date, items]) => `
        <div class="timeline-entry">
            <div class="timeline-date">${date}</div>
            <div class="timeline-ratings">
                ${items.map(it => `
                    <span class="rating-pill rating-${it.rating}">
                        ${categoryLabel(it.category)}: ${it.rating}/5
                    </span>
                `).join('')}
                ${items[0]?.note ? `<p class="timeline-note">${items[0].note}</p>` : ''}
            </div>
        </div>
    `).join('');
}

async function loadClientDocs(clientId) {
    const res = await apiCall(`documents?client_id=${clientId}`);
    const docs = res.data || [];
    renderDocsList(docs, 'clientDocsList');
}

// ============================================================
// Dokumenty
// ============================================================

function renderDocsList(docs, containerId) {
    const el = document.getElementById(containerId);
    if (!docs.length) {
        el.innerHTML = '<p class="empty-state">Žádné dokumenty.</p>';
        return;
    }
    el.innerHTML = docs.map(d => `
        <div class="list-item">
            <div class="list-item-main">
                <span class="list-item-title">${d.file_name}</span>
                <span class="list-item-sub">${d.document_type || 'Dokument'} · v${d.version}</span>
            </div>
            <div class="list-item-meta">
                <span class="date-badge">${formatDate(d.created_at)}</span>
                <button class="btn btn-small" onclick="downloadDoc('${d.id}')">📥 Stáhnout</button>
            </div>
        </div>
    `).join('');
}

async function downloadDoc(docId) {
    const res = await apiCall(`documents?id=${docId}&download=true`);
    if (res.url) {
        window.open(res.url, '_blank');
    } else {
        alert('Chyba při stahování dokumentu.');
    }
}

function uploadDocument() {
    document.getElementById('docUploadInput').click();
}

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('docUploadInput');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result.split(',')[1];
                try {
                    await apiCall('documents', 'POST', {
                        client_id: currentClientId,
                        file_name: file.name,
                        file_data: base64,
                        content_type: file.type,
                        document_type: 'zprava'
                    });
                    alert('Dokument nahrán.');
                    if (currentClientId) loadClientDocs(currentClientId);
                } catch (err) {
                    alert('Chyba při nahrávání: ' + err.message);
                }
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });
    }
});

// ============================================================
// Nové sezení
// ============================================================

async function populateClientSelects() {
    const res = await apiCall('clients');
    const clients = res.data || [];
    const opts = clients.map(c =>
        `<option value="${c.id}">${c.first_name} ${c.last_name}</option>`
    ).join('');

    ['sessionClientSelect', 'docFilterClient'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const first = el.options[0]?.outerHTML || '';
            el.innerHTML = first + opts;
        }
    });
}

function setupProgressRatings() {
    const categories = [
        ['chovani', 'Chování'],
        ['soustredeni', 'Soustředění'],
        ['matematika', 'Matematika'],
        ['cteni', 'Čtení'],
        ['psani', 'Psaní'],
        ['komunikace', 'Komunikace'],
        ['socialni_dovednosti', 'Sociální dovednosti'],
        ['emoce', 'Emoce'],
        ['motorika', 'Motorika']
    ];

    const container = document.getElementById('progressRatings');
    if (!container) return;

    container.innerHTML = categories.map(([key, label]) => `
        <div class="rating-item">
            <label>${label}</label>
            <div class="rating-stars" data-category="${key}">
                ${[1,2,3,4,5].map(n => `
                    <button class="star-btn" data-value="${n}" onclick="setRating('${key}', ${n})">${n}</button>
                `).join('')}
            </div>
        </div>
    `).join('');
}

const sessionRatings = {};

function setRating(category, value) {
    sessionRatings[category] = value;
    const container = document.querySelector(`.rating-stars[data-category="${category}"]`);
    container.querySelectorAll('.star-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.value) <= value);
    });
}

async function saveSession() {
    const clientId = document.getElementById('sessionClientSelect').value;
    if (!clientId) {
        alert('Vyberte klienta.');
        return;
    }

    const body = {
        client_id: clientId,
        professional_id: currentProfessional?.id,
        session_type: document.getElementById('sessionTypeSelect').value,
        transcript: document.getElementById('sessionTranscript').value,
        anamneza: document.getElementById('sessAnamneza').value,
        pozorovani: document.getElementById('sessPozorovani').value,
        metody: document.getElementById('sessMetody').value,
        zavery: document.getElementById('sessZavery').value,
        doporuceni: document.getElementById('sessDoporuceni').value,
        poznamky: document.getElementById('sessPoznamky').value
    };

    // Přidat hodnocení pokroku
    const progressNotes = Object.entries(sessionRatings)
        .filter(([_, v]) => v > 0)
        .map(([cat, rating]) => ({
            category: cat,
            rating: rating,
            note: ''
        }));
    if (progressNotes.length) body.progress_notes = progressNotes;

    try {
        const res = await apiCall('sessions', 'POST', body);
        if (res.error) throw new Error(res.error);
        alert('Sezení uloženo!');
        // Vyčistit formulář
        document.getElementById('sessionTranscript').value = '';
        document.getElementById('sessAnamneza').value = '';
        document.getElementById('sessPozorovani').value = '';
        document.getElementById('sessMetody').value = '';
        document.getElementById('sessZavery').value = '';
        document.getElementById('sessDoporuceni').value = '';
        document.getElementById('sessPoznamky').value = '';
        Object.keys(sessionRatings).forEach(k => delete sessionRatings[k]);
        setupProgressRatings();
        loadOverview();
    } catch (e) {
        alert('Chyba: ' + e.message);
    }
}

async function generateAIReport() {
    const transcript = document.getElementById('sessionTranscript').value;
    if (!transcript.trim()) {
        alert('Nejdříve vložte přepis rozhovoru.');
        return;
    }

    const btn = document.getElementById('generateFromTranscript');
    btn.textContent = '⏳ Generuji...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/ai-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript })
        });
        const data = await res.json();

        if (data.anamneza) document.getElementById('sessAnamneza').value = data.anamneza;
        if (data.pozorovani) document.getElementById('sessPozorovani').value = data.pozorovani;
        if (data.metody) document.getElementById('sessMetody').value = data.metody;
        if (data.zavery) document.getElementById('sessZavery').value = data.zavery;
        if (data.doporuceni) document.getElementById('sessDoporuceni').value = data.doporuceni;
        if (data.poznamky) document.getElementById('sessPoznamky').value = data.poznamky;
    } catch (e) {
        alert('Chyba AI generování: ' + e.message);
    } finally {
        btn.textContent = '🤖 Generovat AI zápis';
        btn.disabled = false;
    }
}

async function saveNewClient() {
    const body = {
        first_name: document.getElementById('newClientFirstName').value,
        last_name: document.getElementById('newClientLastName').value,
        birth_date: document.getElementById('newClientBirthDate').value || null,
        gender: document.getElementById('newClientGender').value || null,
        school_name: document.getElementById('newClientSchool').value || null,
        class_name: document.getElementById('newClientClass').value || null,
        parent_name: document.getElementById('newClientParent').value || null,
        parent_phone: document.getElementById('newClientParentPhone').value || null,
        parent_email: document.getElementById('newClientParentEmail').value || null,
        notes: document.getElementById('newClientNotes').value || null,
        institution_id: currentProfessional?.institution_id
    };

    if (!body.first_name || !body.last_name) {
        alert('Vyplňte jméno a příjmení.');
        return;
    }

    try {
        const res = await apiCall('clients', 'POST', body);
        if (res.error) throw new Error(res.error);
        closeModal('newClientModal');
        await loadClients();
        await populateClientSelects();
        alert('Klient uložen!');
        // Vyčistit formulář
        ['newClientFirstName','newClientLastName','newClientBirthDate','newClientGender',
         'newClientSchool','newClientClass','newClientParent','newClientParentPhone',
         'newClientParentEmail','newClientNotes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    } catch (e) {
        alert('Chyba: ' + e.message);
    }
}

async function deactivateClient(clientId) {
    if (!confirm('Opravdu chcete deaktivovat tohoto klienta?')) return;
    await apiCall('clients', 'PUT', { id: clientId, is_active: false });
    closeModal('clientDetailModal');
    loadClients();
}

// ============================================================
// Session detail
// ============================================================

async function viewSession(sessionId) {
    const res = await apiCall(`sessions?id=${sessionId}`);
    const s = res.data;
    if (!s) return;

    const content = `
        <div class="session-detail-view">
            <h4>${formatDate(s.session_date)} — ${s.session_type || 'Sezení'}</h4>
            ${s.transcript ? `<h5>Přepis</h5><pre class="transcript-pre">${s.transcript}</pre>` : ''}
            ${s.anamneza ? `<h5>Anamnéza</h5><p>${s.anamneza}</p>` : ''}
            ${s.pozorovani ? `<h5>Pozorování</h5><p>${s.pozorovani}</p>` : ''}
            ${s.metody ? `<h5>Metody</h5><p>${s.metody}</p>` : ''}
            ${s.zavery ? `<h5>Závěry</h5><p>${s.zavery}</p>` : ''}
            ${s.doporuceni ? `<h5>Doporučení</h5><p>${s.doporuceni}</p>` : ''}
            ${s.poznamky ? `<h5>Poznámky</h5><p>${s.poznamky}</p>` : ''}
        </div>
    `;

    // Show in sessions tab
    const el = document.getElementById('clientSessionsList');
    el.innerHTML = `
        <button class="btn btn-small" onclick="loadClientSessions('${currentClientId}')">← Zpět na seznam</button>
        ${content}
    `;
}

// ============================================================
// Navigace
// ============================================================

function switchTab(tabName) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById(`tab-${tabName}`)?.classList.add('active');

    // Načíst data pro daný tab
    if (tabName === 'clients') loadClients();
    if (tabName === 'documents') loadAllDocs();
    if (tabName === 'overview') loadOverview();
}

async function loadAllDocs() {
    const filter = document.getElementById('docFilterClient')?.value;
    const endpoint = filter
        ? `documents?client_id=${filter}`
        : 'documents';
    const res = await apiCall(endpoint);
    renderDocsList(res.data || [], 'allDocsList');
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// ============================================================
// Helpers
// ============================================================

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('cs-CZ');
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
}

function categoryLabel(cat) {
    const labels = {
        'chovani': 'Chování',
        'soustredeni': 'Soustředění',
        'matematika': 'Matematika',
        'cteni': 'Čtení',
        'psani': 'Psaní',
        'komunikace': 'Komunikace',
        'socialni_dovednosti': 'Soc. dov.',
        'emoce': 'Emoce',
        'motorika': 'Motorika'
    };
    return labels[cat] || cat;
}

// ============================================================
// Event Listeners
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // Login/Register
    document.getElementById('loginBtn').addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value;
        const pw = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('loginError');
        try {
            errEl.style.display = 'none';
            await login(email, pw);
        } catch (e) {
            errEl.textContent = e.message;
            errEl.style.display = 'block';
        }
    });

    document.getElementById('registerBtn').addEventListener('click', async () => {
        const email = document.getElementById('regEmail').value;
        const pw = document.getElementById('regPassword').value;
        const errEl = document.getElementById('registerError');
        try {
            errEl.style.display = 'none';
            await register(email, pw, {
                first_name: document.getElementById('regFirstName').value,
                last_name: document.getElementById('regLastName').value,
                role: document.getElementById('regRole').value,
                institution: document.getElementById('regInstitution').value
            });
        } catch (e) {
            errEl.textContent = e.message;
            errEl.style.display = 'block';
        }
    });

    document.getElementById('showRegisterBtn').addEventListener('click', () => {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
    });

    document.getElementById('showLoginBtn').addEventListener('click', () => {
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Navigační taby
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Detail taby (klient)
    document.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.detail-content').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`detail-${tab.dataset.detail}`).classList.add('active');

            // Pokud je to pokrok, znovu načíst s filtrem
            if (tab.dataset.detail === 'progress' && currentClientId) {
                const cat = document.getElementById('progressCategory').value;
                loadClientProgress(currentClientId, cat);
            }
        });
    });

    // Progress category filter
    document.getElementById('progressCategory')?.addEventListener('change', (e) => {
        if (currentClientId) loadClientProgress(currentClientId, e.target.value);
    });

    // Nový klient
    document.getElementById('addClientBtn')?.addEventListener('click', () => {
        document.getElementById('newClientModal').style.display = 'flex';
    });

    document.getElementById('saveNewClientBtn')?.addEventListener('click', saveNewClient);

    // Vyhledávání klientů
    let searchTimer;
    document.getElementById('clientSearch')?.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadClients(e.target.value), 300);
    });

    // Uložení sezení
    document.getElementById('saveSessionBtn')?.addEventListener('click', saveSession);
    document.getElementById('saveAndExportBtn')?.addEventListener('click', async () => {
        await saveSession();
        // TODO: export Word
        alert('Export do Word bude dostupný v příští verzi.');
    });

    // AI generování
    document.getElementById('generateFromTranscript')?.addEventListener('click', generateAIReport);

    // Filtr dokumentů
    document.getElementById('docFilterClient')?.addEventListener('change', loadAllDocs);

    // Kliknutí mimo modal – zavřít
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Enter na login
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });

    // Start
    initApp();
});
