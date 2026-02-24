// ===== KONFIGURACE =====
// API klíče jsou nyní bezpečně na backendu (Vercel serverless funkce)
const AZURE_CONFIG = {
    language: 'cs-CZ'
};

// ===== GLOBÁLNÍ PROMĚNNÉ =====
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let timerInterval = null;
let recognizer = null;
let isRealTimeActive = false;

// ===== DIARIZACE - ROZPOZNÁVÁNÍ ŘEČNÍKŮ =====
let detectedSpeakers = new Map(); // speakerId -> { number, role }
let speakerCounter = 0;
let lastSpeakerId = null;
let currentManualSpeaker = null; // pro manuální přepínání řečníků
let useDiarization = false; // true pokud ConversationTranscriber funguje

// ===== ELEMENTY =====
const elements = {
    startRealtime: document.getElementById('startRealtime'),
    stopRealtime: document.getElementById('stopRealtime'),
    uploadAudio: document.getElementById('uploadAudio'),
    audioFile: document.getElementById('audioFile'),
    status: document.getElementById('status'),
    recordingTime: document.getElementById('recordingTime'),
    transcript: document.getElementById('transcript'),
    clearTranscript: document.getElementById('clearTranscript'),
    generateReport: document.getElementById('generateReport'),
    exportWord: document.getElementById('exportWord'),
    exportPDF: document.getElementById('exportPDF'),
    saveLocal: document.getElementById('saveLocal'),
    clientName: document.getElementById('clientName'),
    sessionDate: document.getElementById('sessionDate'),
    sessionType: document.getElementById('sessionType'),
    // Report fields
    anamneza: document.getElementById('anamneza'),
    pozorovani: document.getElementById('pozorovani'),
    metody: document.getElementById('metody'),
    zavery: document.getElementById('zavery'),
    doporuceni: document.getElementById('doporuceni'),
    poznamky: document.getElementById('poznamky')
};

// ===== INICIALIZACE =====
document.addEventListener('DOMContentLoaded', () => {
    // Nastavit dnešní datum
    elements.sessionDate.valueAsDate = new Date();

    // Event listeners
    elements.startRealtime.addEventListener('click', startRealTimeTranscription);
    elements.stopRealtime.addEventListener('click', stopRealTimeTranscription);
    elements.uploadAudio.addEventListener('click', () => elements.audioFile.click());
    elements.audioFile.addEventListener('change', handleAudioUpload);
    elements.clearTranscript.addEventListener('click', clearTranscript);
    elements.generateReport.addEventListener('click', generateReport);
    elements.exportWord.addEventListener('click', exportToWord);
    elements.exportPDF.addEventListener('click', exportToPDF);
    elements.saveLocal.addEventListener('click', saveLocally);

    // Demo tlačítko
    const loadDemoBtn = document.getElementById('loadDemo');
    if (loadDemoBtn) {
        loadDemoBtn.addEventListener('click', loadDemoData);
    }

    // Manuální přepínání řečníků
    const addSpeakerBtn = document.getElementById('addSpeaker');
    if (addSpeakerBtn) {
        addSpeakerBtn.addEventListener('click', addManualSpeaker);
    }
    const switchSpeakerBtn = document.getElementById('switchSpeaker');
    if (switchSpeakerBtn) {
        switchSpeakerBtn.addEventListener('click', switchToNextSpeaker);
    }

    // Kontrola Azure Speech SDK
    if (typeof SpeechSDK === 'undefined') {
        console.warn('⚠️ Azure Speech SDK není načteno. Čekám 2 sekundy...');
        updateStatus('⚠️ Načítám Azure SDK...', 'processing');

        setTimeout(() => {
            if (typeof SpeechSDK === 'undefined') {
                console.error('❌ Azure Speech SDK se nepodařilo načíst!');
                updateStatus('⚠️ Azure SDK chybí - zkontrolujte internet', 'warning');
                alert('Azure Speech SDK se nepodařilo načíst.\n\nZkontrolujte:\n1. Internetové připojení\n2. Firewall\n3. Zkuste obnovit stránku (F5)');
            } else {
                console.log('✅ Azure Speech SDK načteno (po čekání)');
                updateStatus('Připraveno', 'ready');
            }
        }, 2000);
    } else {
        console.log('✅ Azure Speech SDK načteno úspěšně');
        updateStatus('Připraveno', 'ready');
    }

    // Kontrola podpory prohlížeče
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Váš prohlížeč nepodporuje nahrávání zvuku. Použijte prosím moderní prohlížeč (Chrome, Edge, Firefox).');
    }

    // Klávesová zkratka Tab pro přepínání řečníků
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && isRealTimeActive && !useDiarization) {
            e.preventDefault();
            switchToNextSpeaker();
        }
        // Klávesy 1-9 pro rychlé přepnutí na konkrétního řečníka
        if (e.altKey && e.key >= '1' && e.key <= '9' && isRealTimeActive && !useDiarization) {
            e.preventDefault();
            const speakerIds = Array.from(detectedSpeakers.keys());
            const index = parseInt(e.key) - 1;
            if (index < speakerIds.length) {
                switchToSpeaker(speakerIds[index]);
            }
        }
    });
});

// ===== REAL-TIME PŘEPIS =====
async function startRealTimeTranscription() {
    try {
        updateStatus('Inicializace...', 'processing');

        // Kontrola Azure Speech SDK
        if (typeof SpeechSDK === 'undefined') {
            alert('Azure Speech SDK není načteno!\n\nZkuste:\n1. Obnovit stránku (F5)\n2. Zkontrolovat internetové připojení\n3. Vypnout firewall/antivirus');
            updateStatus('Chyba: SDK není načteno', 'ready');
            return;
        }

        // Získat přístup k mikrofonu
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Nastavit MediaRecorder pro lokální uložení
        setupMediaRecorder(stream);

        // Inicializovat Azure Speech SDK
        await initializeAzureSpeech(stream);

        // Spustit nahrávání a přepis
        mediaRecorder.start();
        recordingStartTime = Date.now();
        startTimer();
        isRealTimeActive = true;

        updateStatus('Nahrávám a přepisuji...', 'recording');
        elements.startRealtime.disabled = true;
        elements.stopRealtime.disabled = false;
        elements.uploadAudio.disabled = true;

    } catch (error) {
        console.error('Chyba při spuštění přepisu:', error);
        alert('Nelze spustit nahrávání. Povolte přístup k mikrofonu.');
        updateStatus('Chyba', 'ready');
    }
}

function setupMediaRecorder(stream) {
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        await saveAudioLocally(audioBlob);

        // Zastavit všechny audio stopy
        stream.getTracks().forEach(track => track.stop());
    };
}

async function initializeAzureSpeech(stream) {
    try {
        console.log('Inicializuji Azure Speech SDK...');

        // Reset speaker tracking
        detectedSpeakers.clear();
        speakerCounter = 0;
        lastSpeakerId = null;
        useDiarization = false;
        updateSpeakerPanel();

        // Získat token z backendu
        console.log('Získávám token z backendu...');
        const tokenResponse = await fetch('/api/speech-token');
        if (!tokenResponse.ok) {
            throw new Error('Nelze získat Azure token. Zkontrolujte backend a environment proměnné.');
        }
        const { token, region } = await tokenResponse.json();
        console.log('✅ Token získán z backendu');

        // Vytvořit speech config
        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
        speechConfig.speechRecognitionLanguage = AZURE_CONFIG.language;

        // Povolit diarizaci v průběžných výsledcích (dle Microsoft dokumentace)
        speechConfig.setProperty(
            "SpeechServiceResponse_DiarizeIntermediateResults", "true"
        );

        // Audio config
        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();

        // Zkusit ConversationTranscriber (automatická diarizace)
        // Pokud není dostupný nebo selže, použijeme SpeechRecognizer + manuální přepínání
        let useConversationTranscriber = false;
        if (typeof SpeechSDK.ConversationTranscriber === 'function') {
            try {
                recognizer = new SpeechSDK.ConversationTranscriber(speechConfig, audioConfig);
                useConversationTranscriber = true;
                console.log('✅ ConversationTranscriber dostupný');
            } catch (e) {
                console.warn('⚠️ ConversationTranscriber není dostupný, používám SpeechRecognizer:', e.message);
            }
        }

        if (useConversationTranscriber) {
            // === REŽIM 1: Automatická diarizace ===
            useDiarization = true;
            showManualSpeakerControls(false);

            recognizer.transcribing = (s, e) => {
                if (e.result.text) {
                    const speakerId = e.result.speakerId || 'Unknown';
                    registerSpeaker(speakerId);
                    appendToTranscript(e.result.text, false, speakerId);
                }
            };

            recognizer.transcribed = (s, e) => {
                if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                    const speakerId = e.result.speakerId || 'Unknown';
                    registerSpeaker(speakerId);
                    appendToTranscript(e.result.text, true, speakerId);
                }
            };

            recognizer.canceled = (s, e) => {
                console.error('❌ Diarizace zrušena:', e.reason, e.errorDetails);
                // Fallback na SpeechRecognizer
                console.log('🔄 Přepínám na SpeechRecognizer...');
                recognizer.close();
                recognizer = null;
                initializeFallbackRecognizer(speechConfig);
            };

            recognizer.sessionStopped = (s, e) => {
                console.log('Session stopped');
            };

            recognizer.startTranscribingAsync(
                () => {
                    console.log('✅ Conversation Transcription spuštěno (auto-diarizace)');
                    updateStatus('🎤 Nahrávám (auto rozpoznávání řečníků)...', 'recording');
                },
                (err) => {
                    console.warn('⚠️ ConversationTranscriber selže, fallback:', err);
                    recognizer.close();
                    recognizer = null;
                    initializeFallbackRecognizer(speechConfig);
                }
            );

        } else {
            // === REŽIM 2: SpeechRecognizer + manuální přepínání řečníků ===
            initializeFallbackRecognizer(speechConfig);
        }

    } catch (error) {
        console.error('❌ Výjimka při inicializaci:', error);
        alert('Chyba při inicializaci Azure Speech: ' + error.message);
        updateStatus('Chyba', 'ready');
    }
}

// Fallback: standardní SpeechRecognizer s manuálním přepínáním řečníků
function initializeFallbackRecognizer(speechConfig) {
    try {
        useDiarization = false;
        const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
        recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
        console.log('✅ SpeechRecognizer vytvořen (manuální režim)');

        // Automaticky přidat prvního řečníka pokud žádný neexistuje
        if (detectedSpeakers.size === 0) {
            registerSpeaker('Manual-1');
            currentManualSpeaker = 'Manual-1';
        }
        showManualSpeakerControls(true);

        recognizer.recognizing = (s, e) => {
            if (e.result.text) {
                const speaker = currentManualSpeaker || 'Manual-1';
                appendToTranscript(e.result.text, false, speaker);
            }
        };

        recognizer.recognized = (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                const speaker = currentManualSpeaker || 'Manual-1';
                console.log(`✅ Rozpoznáno [${getSpeakerLabel(speaker)}]:`, e.result.text);
                appendToTranscript(e.result.text, true, speaker);
            }
        };

        recognizer.canceled = (s, e) => {
            if (e.reason === SpeechSDK.CancellationReason.Error) {
                console.error('❌ Speech error:', e.errorDetails);
                alert('Chyba Azure Speech: ' + e.errorDetails);
            }
        };

        recognizer.startContinuousRecognitionAsync(
            () => {
                console.log('✅ SpeechRecognizer spuštěn (manuální řečníci)');
                updateStatus('🎤 Nahrávám – přepínejte řečníky tlačítkem...', 'recording');
            },
            (err) => {
                console.error('❌ Chyba při spuštění:', err);
                alert('Nelze spustit rozpoznávání: ' + err);
                updateStatus('Chyba', 'ready');
            }
        );
    } catch (error) {
        console.error('❌ Fallback recognizer selhal:', error);
        alert('Nelze spustit přepis: ' + error.message);
        updateStatus('Chyba', 'ready');
    }
}

function stopRealTimeTranscription() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    if (recognizer) {
        const stopMethod = useDiarization ? 'stopTranscribingAsync' : 'stopContinuousRecognitionAsync';
        if (typeof recognizer[stopMethod] === 'function') {
            recognizer[stopMethod](
                () => {
                    console.log('Přepis zastaven');
                    recognizer.close();
                    recognizer = null;
                },
                (err) => {
                    console.error('Chyba při zastavování:', err);
                    try { recognizer.close(); } catch(e) {}
                    recognizer = null;
                }
            );
        } else {
            try { recognizer.close(); } catch(e) {}
            recognizer = null;
        }
    }

    showManualSpeakerControls(false);

    stopTimer();
    isRealTimeActive = false;

    updateStatus('Zastaveno', 'ready');
    elements.startRealtime.disabled = false;
    elements.stopRealtime.disabled = true;
    elements.uploadAudio.disabled = false;
}

// ===== NAHRÁNÍ AUDIO SOUBORU =====
async function handleAudioUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    updateStatus('Zpracovávám audio soubor...', 'processing');

    // V produkci: poslat soubor na backend, který volá Azure Speech API
    // Pro demo: simulace

    setTimeout(() => {
        const demoText = `[DEMO PŘEPIS z nahraného souboru "${file.name}"]\n\nDobré odpoledne, jsem tady s mojí dcerou Aničkou. Má problémy ve škole, zejména s matematikou. Učitelka říkala, že je často roztěkaná a má problémy s koncentrací...\n\n[Pro skutečný přepis nahrajte Azure Speech Service klíč]`;
        elements.transcript.textContent = demoText;
        updateStatus('Přepis dokončen', 'ready');
    }, 2000);
}

// ===== LOKÁLNÍ ULOŽENÍ AUDIO =====
async function saveAudioLocally(audioBlob) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    const clientName = elements.clientName.value || 'Nepojmenovano';

    // Vytvoří název souboru
    const fileName = `${dateStr}_${timeStr}_${sanitizeFileName(clientName)}.webm`;

    // Stáhnout soubor
    const url = URL.createObjectURL(audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`Audio uloženo: ${fileName}`);
}

function sanitizeFileName(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// ===== PŘEPIS - POMOCNÉ FUNKCE =====
function appendToTranscript(text, isFinal, speaker = null) {
    const transcript = elements.transcript;

    // Vymazat placeholder text
    if (transcript.textContent === 'Zde se zobrazí přepis rozhovoru...') {
        transcript.textContent = '';
    }

    if (isFinal) {
        // Finální text - odstranit interim text a přidat finální
        const interimSpan = transcript.querySelector('.interim-text');
        if (interimSpan) {
            interimSpan.remove();
        }

        // Přidat nový řádek pokud se změnil řečník
        const showSpeakerLabel = speaker && speaker !== 'Unknown' && speaker !== lastSpeakerId;
        if (showSpeakerLabel) {
            lastSpeakerId = speaker;

            // Nový řádek před novým řečníkem
            if (transcript.textContent.length > 0) {
                transcript.appendChild(document.createTextNode('\n'));
            }

            // Označení řečníka
            const speakerSpan = document.createElement('strong');
            speakerSpan.className = 'speaker-label';
            speakerSpan.dataset.speakerId = speaker;
            speakerSpan.style.color = getSpeakerColor(speaker);
            speakerSpan.textContent = `[${getSpeakerLabel(speaker)}] `;
            transcript.appendChild(speakerSpan);
        }

        // Přidat finální text
        const textNode = document.createTextNode(text + ' ');
        transcript.appendChild(textNode);
    } else {
        // Průběžný text - zobrazit kurzívou
        let interimSpan = transcript.querySelector('.interim-text');
        if (!interimSpan) {
            interimSpan = document.createElement('span');
            interimSpan.className = 'interim-text';
            interimSpan.style.fontStyle = 'italic';
            interimSpan.style.color = '#999';
            transcript.appendChild(interimSpan);
        }

        // S označením řečníka pro průběžný text
        if (speaker && speaker !== 'Unknown') {
            interimSpan.textContent = ` [${getSpeakerLabel(speaker)}] ${text}`;
        } else {
            interimSpan.textContent = ' ' + text;
        }
    }

    // Scroll dolů
    transcript.scrollTop = transcript.scrollHeight;
}

// ===== SPRÁVA ŘEČNÍKŮ (DIARIZACE) =====

// Barvy pro řečníky (max 8)
const SPEAKER_COLORS = [
    '#0078d4', // modrá
    '#107c10', // zelená
    '#d13438', // červená
    '#8764b8', // fialová
    '#ff8c00', // oranžová
    '#00b7c3', // tyrkysová
    '#6b69d6', // indigo
    '#c239b3'  // magenta
];

// Výchozí role pro přiřazení
const SPEAKER_ROLES = [
    'Psycholog',
    'Etoped',
    'Žák/Student',
    'Rodič',
    'Učitel',
    'Logoped',
    'Speciální pedagog',
    'Jiný'
];

function registerSpeaker(speakerId) {
    if (!speakerId || speakerId === 'Unknown') return;
    if (detectedSpeakers.has(speakerId)) return;

    speakerCounter++;
    detectedSpeakers.set(speakerId, {
        number: speakerCounter,
        role: '',  // uživatel přiřadí roli
        color: SPEAKER_COLORS[(speakerCounter - 1) % SPEAKER_COLORS.length]
    });

    console.log(`🆕 Nový řečník detekován: ${speakerId} → Řečník ${speakerCounter}`);
    updateSpeakerPanel();
}

function getSpeakerLabel(speakerId) {
    if (!speakerId || speakerId === 'Unknown') return '?';
    const speaker = detectedSpeakers.get(speakerId);
    if (!speaker) return '?';

    if (speaker.role) {
        return `${speaker.role} (Ř${speaker.number})`;
    }
    return `Řečník ${speaker.number}`;
}

function getSpeakerColor(speakerId) {
    if (!speakerId || speakerId === 'Unknown') return '#666';
    const speaker = detectedSpeakers.get(speakerId);
    return speaker ? speaker.color : '#666';
}

function updateSpeakerPanel() {
    const panel = document.getElementById('speakerPanel');
    const list = document.getElementById('speakerList');
    if (!panel || !list) return;

    if (detectedSpeakers.size === 0) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    list.innerHTML = '';

    detectedSpeakers.forEach((speaker, speakerId) => {
        const item = document.createElement('div');
        item.className = 'speaker-item';
        item.innerHTML = `
            <span class="speaker-badge" style="background-color: ${speaker.color};">Ř${speaker.number}</span>
            <select class="speaker-role-select" data-speaker-id="${speakerId}" 
                    onchange="assignSpeakerRole('${speakerId}', this.value)">
                <option value="">-- Přiřadit roli --</option>
                ${SPEAKER_ROLES.map(role => 
                    `<option value="${role}" ${speaker.role === role ? 'selected' : ''}>${role}</option>`
                ).join('')}
            </select>
            <span class="speaker-id-info">${speakerId}</span>
        `;
        list.appendChild(item);
    });

    // Aktualizovat rychlá tlačítka řečníků (pro manuální režim)
    updateQuickSpeakerButtons();
}

function updateQuickSpeakerButtons() {
    const container = document.getElementById('speakerQuickButtons');
    if (!container) return;
    container.innerHTML = '';

    detectedSpeakers.forEach((speaker, speakerId) => {
        const btn = document.createElement('button');
        btn.className = 'speaker-quick-btn' + (speakerId === currentManualSpeaker ? ' active' : '');
        btn.dataset.speakerId = speakerId;
        btn.innerHTML = `<span class="speaker-badge" style="background-color: ${speaker.color}; min-width: 24px; height: 22px; font-size: 11px;">Ř${speaker.number}</span> ${speaker.role || 'Řečník ' + speaker.number}`;
        btn.onclick = () => switchToSpeaker(speakerId);
        container.appendChild(btn);
    });
}

function assignSpeakerRole(speakerId, role) {
    const speaker = detectedSpeakers.get(speakerId);
    if (speaker) {
        speaker.role = role;
        console.log(`✅ Řečník ${speaker.number} (${speakerId}) → role: ${role}`);

        // Aktualizovat všechny existující labely v přepisu
        refreshSpeakerLabelsInTranscript();
        // Aktualizovat rychlá tlačítka
        updateQuickSpeakerButtons();
        updateActiveSpeakerDisplay();
    }
}

function refreshSpeakerLabelsInTranscript() {
    const transcript = elements.transcript;
    const labels = transcript.querySelectorAll('.speaker-label');
    labels.forEach(label => {
        const speakerId = label.dataset.speakerId;
        if (speakerId && detectedSpeakers.has(speakerId)) {
            const speaker = detectedSpeakers.get(speakerId);
            label.textContent = `[${getSpeakerLabel(speakerId)}] `;
            label.style.color = getSpeakerColor(speakerId);
        }
    });
}

// ===== MANUÁLNÍ PŘEPÍNÁNÍ ŘEČNÍKŮ =====

function addManualSpeaker() {
    speakerCounter++;
    const speakerId = `Manual-${speakerCounter}`;
    detectedSpeakers.set(speakerId, {
        number: speakerCounter,
        role: '',
        color: SPEAKER_COLORS[(speakerCounter - 1) % SPEAKER_COLORS.length]
    });
    currentManualSpeaker = speakerId;
    updateSpeakerPanel();
    updateActiveSpeakerDisplay();
    console.log(`🆕 Přidán řečník ${speakerCounter}`);
}

function switchToNextSpeaker() {
    if (detectedSpeakers.size === 0) return;

    const speakerIds = Array.from(detectedSpeakers.keys());
    const currentIndex = speakerIds.indexOf(currentManualSpeaker);
    const nextIndex = (currentIndex + 1) % speakerIds.length;
    currentManualSpeaker = speakerIds[nextIndex];
    lastSpeakerId = null; // Vynutit zobrazení nového labelu
    updateActiveSpeakerDisplay();
    console.log(`🔄 Přepnuto na: ${getSpeakerLabel(currentManualSpeaker)}`);
}

function switchToSpeaker(speakerId) {
    if (detectedSpeakers.has(speakerId)) {
        currentManualSpeaker = speakerId;
        lastSpeakerId = null;
        updateActiveSpeakerDisplay();
    }
}

function showManualSpeakerControls(show) {
    const controls = document.getElementById('manualSpeakerControls');
    if (controls) {
        controls.style.display = show ? 'flex' : 'none';
    }
}

function updateActiveSpeakerDisplay() {
    const display = document.getElementById('activeSpeakerDisplay');
    if (display && currentManualSpeaker) {
        const speaker = detectedSpeakers.get(currentManualSpeaker);
        if (speaker) {
            display.innerHTML = `<span class="speaker-badge" style="background-color: ${speaker.color};">Ř${speaker.number}</span> ${getSpeakerLabel(currentManualSpeaker)}`;
        }
    }

    // Aktualizovat aktivní stav tlačítek řečníků
    const buttons = document.querySelectorAll('.speaker-quick-btn');
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.speakerId === currentManualSpeaker);
    });
}

function clearTranscript() {
    if (confirm('Opravdu chcete vymazat přepis?')) {
        elements.transcript.textContent = 'Zde se zobrazí přepis rozhovoru...';
    }
}

// ===== ČASOVAČ =====
function startTimer() {
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        elements.recordingTime.textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// ===== STATUS =====
function updateStatus(text, type) {
    elements.status.textContent = text;
    elements.status.className = `status-indicator ${type}`;
}

// ===== GENEROVÁNÍ STRUKTUROVANÉHO ZÁPISU =====
async function generateReport() {
    const transcriptText = elements.transcript.textContent;

    if (!transcriptText || transcriptText === 'Zde se zobrazí přepis rozhovoru...') {
        alert('Nejprve vytvořte přepis rozhovoru.');
        return;
    }

    updateStatus('🤖 Mistral AI generuje zápis...', 'processing');

    // Vytvoření promptu pro Mistral AI
    const systemPrompt = `Jsi odborný psycholog pracující v pedagogicko-psychologické poradně.
Tvým úkolem je převést přepis rozhovoru s klientem do strukturovaného psychologického zápisu.

STRUKTURA ZÁPISU:
1. Důvod návštěvy / Anamnéza - Proč klient přišel, co ho trápí, rodinná anamnéza
2. Pozorování během schůzky - Chování, emotivní stav, komunikace, interakce
3. Provedená vyšetření / Metody - Jaké testy, dotazníky nebo metody byly použity
4. Zjištění a závěry - Co bylo zjištěno, diagnostické úvahy, hypotézy
5. Doporučení a další postup - Konkrétní doporučení, intervence, další schůzky

DŮLEŽITÉ:
- Buď věcný, odborný, ale srozumitelný
- Používej psychologickou terminologii správně
- Zachovej důvěrnost a respekt
- Pokud informace v přepisu chybí, napiš [potřeba doplnit]
- Nevymýšlej informace, které nejsou v přepisu`;

    const userPrompt = `Přepis rozhovoru:

${transcriptText}

Vytvořte strukturovaný psychologický zápis podle výše uvedené struktury. Odpověz POUZE JSON objektem v tomto formátu (bez markdown bloků):
{
  "anamneza": "text",
  "pozorovani": "text",
  "metody": "text",
  "zavery": "text",
  "doporuceni": "text"
}`;

    try {
        // Volání backendu (který volá Mistral AI)
        const response = await fetch('/api/ai-generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                transcript: transcriptText
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Mistral API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        // Extrahovat JSON z odpovědi (může být v markdown bloku)
        let reportJson;
        try {
            // Pokusit se najít JSON v odpovědi
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                reportJson = JSON.parse(jsonMatch[0]);
            } else {
                reportJson = JSON.parse(aiResponse);
            }
        } catch (e) {
            console.error('Chyba parsování JSON:', e);
            throw new Error('AI nevrátila platný JSON formát');
        }

        // Vyplnit formulář
        elements.anamneza.value = reportJson.anamneza || '[potřeba doplnit]';
        elements.pozorovani.value = reportJson.pozorovani || '[potřeba doplnit]';
        elements.metody.value = reportJson.metody || '[potřeba doplnit]';
        elements.zavery.value = reportJson.zavery || '[potřeba doplnit]';
        elements.doporuceni.value = reportJson.doporuceni || '[potřeba doplnit]';
        elements.poznamky.value = `Automaticky vygenerováno pomocí Mistral AI (${new Date().toLocaleString('cs-CZ')}). Prosím zkontrolujte a upravte.`;

        updateStatus('✅ Zápis vygenerován Mistral AI', 'ready');

        // Scroll k zápisům
        document.querySelector('.report-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('Chyba při generování zápisu:', error);
        updateStatus('❌ Chyba při generování', 'ready');
        alert(`Chyba při generování zápisu:\n\n${error.message}\n\nZkontrolujte:\n1. Mistral API klíč\n2. Internetové připojení\n3. Konzoli (F12) pro detaily`);
    }
}

// ===== EXPORT =====
function exportToWord() {
    const reportData = collectReportData();

    // Vytvoření jednoduchého HTML dokumentu pro Word
    let html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Psychologický zápis</title></head>
        <body>
            <h1>Záznam ze schůzky - Pedagogicko-psychologická poradna</h1>
            <p><strong>Klient:</strong> ${reportData.clientName || 'Nepojmenováno'}</p>
            <p><strong>Datum:</strong> ${reportData.date}</p>
            <p><strong>Typ schůzky:</strong> ${reportData.sessionType}</p>
            <hr>

            <h2>1. Důvod návštěvy / Anamnéza</h2>
            <p>${reportData.anamneza}</p>

            <h2>2. Pozorování během schůzky</h2>
            <p>${reportData.pozorovani}</p>

            <h2>3. Provedená vyšetření / Metody</h2>
            <p>${reportData.metody}</p>

            <h2>4. Zjištění a závěry</h2>
            <p>${reportData.zavery}</p>

            <h2>5. Doporučení a další postup</h2>
            <p>${reportData.doporuceni}</p>

            <h2>6. Poznámky psychologa</h2>
            <p>${reportData.poznamky}</p>

            <hr>
            <h2>Přepis rozhovoru</h2>
            <p style="white-space: pre-wrap;">${reportData.transcript}</p>
        </body>
        </html>
    `;

    // Stáhnout jako .doc soubor
    const blob = new Blob(['\ufeff', html], {
        type: 'application/msword'
    });

    const url = URL.createObjectURL(blob);
    const fileName = `Zapis_${reportData.clientName || 'klient'}_${reportData.date}.doc`;
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFileName(fileName);
    a.click();
    URL.revokeObjectURL(url);

    alert('Dokument byl exportován do Word formátu!');
}

function exportToPDF() {
    alert('Export do PDF vyžaduje dodatečnou knihovnu (např. jsPDF).\n\nPro demo verzi použijte export do Word a pak převeďte do PDF pomocí Word aplikace.');
}

function saveLocally() {
    const reportData = collectReportData();
    const json = JSON.stringify(reportData, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = `Zapis_${reportData.clientName || 'klient'}_${reportData.date}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFileName(fileName);
    a.click();
    URL.revokeObjectURL(url);

    alert('Data byla uložena lokálně ve formátu JSON!');
}

function collectReportData() {
    return {
        clientName: elements.clientName.value,
        date: elements.sessionDate.value,
        sessionType: elements.sessionType.options[elements.sessionType.selectedIndex].text,
        anamneza: elements.anamneza.value,
        pozorovani: elements.pozorovani.value,
        metody: elements.metody.value,
        zavery: elements.zavery.value,
        doporuceni: elements.doporuceni.value,
        poznamky: elements.poznamky.value,
        transcript: elements.transcript.textContent,
        timestamp: new Date().toISOString()
    };
}

// ===== AZURE SETUP INSTRUKCE =====
function showAzureSetupInstructions() {
    const message = `
🔧 NASTAVENÍ AZURE SPEECH SERVICE

Pro funkční přepis je potřeba nastavit Azure Speech Service:

1. Přejděte na portal.azure.com
2. Vytvořte "Speech Service" resource
3. Zkopírujte klíč (Key) a region
4. Vložte do souboru app.js do AZURE_CONFIG

📌 FREE TIER:
- 5 hodin audio ZDARMA měsíčně
- Skvělé pro testování a malý provoz

💰 NÁKLADY PO FREE TIER:
- Standard: ~1 USD / hodina audio
- Pro PPP s ~20 sezeními měsíčně: 10-20 USD/měsíc

Více info v README.md
    `;

    alert(message);
    updateStatus('Vyžaduje Azure konfiguraci', 'ready');
}

// ===== DEMO DATA =====
function loadDemoData() {
    elements.clientName.value = 'Anna Nováková';

    // Reset přepisu
    elements.transcript.innerHTML = '';

    // Simulovat řečníky v demo datech
    detectedSpeakers.clear();
    speakerCounter = 0;
    lastSpeakerId = null;

    // Zaregistrovat demo řečníky
    registerSpeaker('Guest-1');
    assignSpeakerRole('Guest-1', 'Psycholog');
    registerSpeaker('Guest-2');
    assignSpeakerRole('Guest-2', 'Rodič');
    registerSpeaker('Guest-3');
    assignSpeakerRole('Guest-3', 'Žák/Student');

    // Přidat demo přepis s označením řečníků
    const demoConversation = [
        { speaker: 'Guest-1', text: 'Dobrý den, vítejte v poradně. Já jsem psycholožka Novotná. S kým mám tu čest?' },
        { speaker: 'Guest-2', text: 'Dobrý den, já jsem Nováková a tohle je moje dcera Anička. Je jí 9 let a je ve třetí třídě.' },
        { speaker: 'Guest-1', text: 'Ahoj Aničko. Pověz mi, co tě ve škole baví?' },
        { speaker: 'Guest-3', text: 'Ahoj. Mě baví čtení a kreslení. Ale matematiku nemám ráda.' },
        { speaker: 'Guest-1', text: 'A co přesně ti na matematice dělá problémy?' },
        { speaker: 'Guest-3', text: 'Ty příklady jsou moc těžké, já si je nemůžu zapamatovat. A když se snažím, tak mě to nebaví a koukám z okna.' },
        { speaker: 'Guest-2', text: 'Učitelka nám říkala, že je často roztěkaná a má problémy se soustředěním. Doma při domácích úkolech to trvá věčnost, musím s ní sedět a neustále ji vracet k úkolům.' },
        { speaker: 'Guest-1', text: 'Rozumím. A jak dlouho tyto problémy trvají? Bylo to tak vždycky, nebo se to zhoršilo?' },
        { speaker: 'Guest-2', text: 'V první třídě to bylo v pohodě, ale od druhé třídy se to postupně zhoršuje. Jinak je to šikovná holka, ráda čte, maluje. Ale ta matematika... nevím, jestli to není nějaká počtářská porucha nebo ADHD?' },
        { speaker: 'Guest-1', text: 'Děkuji za informace. Uděláme několik testů, abychom zjistili, kde přesně je problém. Aničko, zahrajeme si spolu takové hry, ano?' },
        { speaker: 'Guest-3', text: 'Jo, to jo! Jaké hry?' }
    ];

    demoConversation.forEach(entry => {
        appendToTranscript(entry.text, true, entry.speaker);
    });

    console.log('Demo data nahrána s rozpoznáváním řečníků. Zkuste tlačítko "Generovat zápis z přepisu"');
}

// Přidat demo data tlačítko (jen pro testování)
console.log('💡 Pro testování zadejte do konzole: loadDemoData()');
