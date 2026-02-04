const { ipcRenderer } = require('electron');
const path = require('path');
const jsmediatags = require('jsmediatags');

// --- Глобальное состояние ---
const state = {
    audio: new Audio(),
    playlist: [], // Локальные файлы
    filteredPlaylist: [],
    jamendoTracks: [], // Результаты поиска
    currentMode: 'local', // 'local' или 'jamendo'
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    loopMode: 0, // 0: None, 1: All, 2: One
    currentTab: 'library',
    
    // Аудио контекст
    audioCtx: null,
    analyser: null,
    gainNode: null, 
    source: null,
    dataArray: null,
    
    // Настройки
    bonusVolume: 100, 
    playbackRate: 1.0,
    jamendoClientId: 'a648284a'
};

// Важно для визуализатора (CORS)
state.audio.crossOrigin = "anonymous";

// --- DOM Элементы ---
const els = {
    // Вкладки
    navBtns: document.querySelectorAll('.nav-btn[data-tab]'),
    tabs: document.querySelectorAll('.tab-content'),
    
    // Плеер
    playBtn: document.getElementById('play-pause-btn'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    shuffleBtn: document.getElementById('shuffle-btn'),
    loopBtn: document.getElementById('loop-btn'),
    
    volumeSlider: document.getElementById('volume-slider'),
    muteBtn: document.getElementById('mute-btn'),
    
    progressWrapper: document.getElementById('progress-wrapper'),
    progressFill: document.getElementById('progress-fill'),
    progressHandle: document.getElementById('progress-handle'),
    
    timeCurrent: document.getElementById('current-time'),
    timeTotal: document.getElementById('total-time'),
    
    // Инфо о треке
    cover: document.getElementById('player-cover'),
    defIcon: document.getElementById('player-default-icon'),
    title: document.getElementById('player-title'),
    artist: document.getElementById('player-artist'),
    
    // Библиотека
    playlistContainer: document.getElementById('playlist-list'),
    searchInput: document.getElementById('search-input'),
    addBtn: document.getElementById('add-folder-btn'),
    fileInput: document.getElementById('file-input'),
    
    // Визуализация
    canvas: document.getElementById('visualizer'),
    
    // Jamendo
    jamInput: document.getElementById('jamendo-input'),
    jamBtn: document.getElementById('jamendo-search-btn'),
    jamResults: document.getElementById('jamendo-results'),
    
    // Settings & Controls
    themeCheck: document.getElementById('theme-checkbox'),
    autoColorCheck: document.getElementById('autocolor-checkbox'),
    speedSlider: document.getElementById('speed-slider'),
    speedVal: document.getElementById('speed-val'),
    bonusVolSlider: document.getElementById('bonus-vol-slider'),
    bonusVolVal: document.getElementById('gain-val'),
    
    // Window
    minBtn: document.getElementById('btn-min'),
    maxBtn: document.getElementById('btn-max'),
    closeBtn: document.getElementById('btn-close')
};

// --- Инициализация ---
window.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadSettings();
    resizeCanvas();
    
    document.body.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    document.body.addEventListener('drop', handleDrop);
});

ipcRenderer.on('open-file-args', (event, args) => {
    loadFiles(args);
});

function initEventListeners() {
    // Window Controls
    els.closeBtn.onclick = () => ipcRenderer.send('app-close');
    els.minBtn.onclick = () => ipcRenderer.send('app-minimize');
    els.maxBtn.onclick = () => ipcRenderer.send('app-maximize');

    // Навигация по вкладкам
    els.navBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Аудио управление
    els.playBtn.onclick = togglePlay;
    els.prevBtn.onclick = playPrev;
    els.nextBtn.onclick = playNext;
    els.shuffleBtn.onclick = toggleShuffle;
    els.loopBtn.onclick = toggleLoop;

    // Громкость
    els.volumeSlider.oninput = (e) => {
        state.audio.volume = e.target.value / 100;
        updateVolumeIcon();
    };
    els.muteBtn.onclick = () => {
        state.audio.muted = !state.audio.muted;
        updateVolumeIcon();
    };

    // Прогресс бар
    els.progressWrapper.onclick = seek;
    
    // События Аудио Элемента
    state.audio.addEventListener('timeupdate', updateProgress);
    state.audio.addEventListener('ended', handleEnded);
    state.audio.addEventListener('play', () => {
        state.isPlaying = true;
        els.playBtn.innerHTML = '<i class="fas fa-pause"></i>';
        initAudioContext(); // Запуск контекста
        requestAnimationFrame(renderFrame);
    });
    state.audio.addEventListener('pause', () => {
        state.isPlaying = false;
        els.playBtn.innerHTML = '<i class="fas fa-play"></i>';
    });
    state.audio.addEventListener('loadedmetadata', () => {
        els.timeTotal.innerText = formatTime(state.audio.duration);
    });

    // Библиотека
    els.addBtn.onclick = () => els.fileInput.click();
    els.fileInput.onchange = (e) => {
        const paths = Array.from(e.target.files).map(f => f.path);
        loadFiles(paths);
        e.target.value = ''; 
    };
    els.searchInput.oninput = handleSearch;

    // Jamendo Search
    els.jamBtn.onclick = searchJamendo;
    els.jamInput.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') searchJamendo();
    });
    
    // Настройки
    els.themeCheck.onchange = (e) => {
        document.body.classList.toggle('light-theme', e.target.checked);
        localStorage.setItem('theme', e.target.checked ? 'light' : 'dark');
    };
    
    els.speedSlider.oninput = (e) => {
        state.playbackRate = parseFloat(e.target.value);
        state.audio.playbackRate = state.playbackRate;
        els.speedVal.innerText = state.playbackRate.toFixed(1);
    };
    
    els.bonusVolSlider.oninput = (e) => {
        state.bonusVolume = parseInt(e.target.value);
        els.bonusVolVal.innerText = state.bonusVolume;
        setGain();
    };
}

// --- Аудио Логика ---

function initAudioContext() {
    // Создаем контекст только один раз
    if (!state.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new AudioContext();
        
        // Граф: Source -> Gain (Bonus) -> Analyser -> Destination
        state.source = state.audioCtx.createMediaElementSource(state.audio);
        state.gainNode = state.audioCtx.createGain();
        state.analyser = state.audioCtx.createAnalyser();
        
        state.analyser.fftSize = 256; 
        state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);

        state.source.connect(state.gainNode);
        state.gainNode.connect(state.analyser);
        state.analyser.connect(state.audioCtx.destination);
    }
    
    // Если контекст был suspended (браузерная политика), возобновляем его
    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }

    setGain();
}

function setGain() {
    if(!state.gainNode) return;
    const gainVal = state.bonusVolume / 100;
    state.gainNode.gain.value = gainVal;
}

function playTrack(index, fromJamendo = false) {
    if (fromJamendo) {
        state.currentMode = 'jamendo';
        const track = state.jamendoTracks[index];
        state.audio.src = track.audio; // URL
        updatePlayerUI(track, true);
    } else {
        state.currentMode = 'local';
        if (index < 0 || index >= state.filteredPlaylist.length) return;
        const track = state.filteredPlaylist[index];
        state.currentIndex = state.playlist.findIndex(t => t.path === track.path);
        state.audio.src = track.path;
        updatePlayerUI(track, false);
    }

    state.audio.playbackRate = state.playbackRate;
    state.audio.play().catch(e => console.error("Play error:", e));
}

function updatePlayerUI(track, isRemote) {
    els.title.innerText = track.name;
    els.artist.innerText = track.artist;
    
    if(!isRemote) renderPlaylist();

    if (isRemote) {
        // Для Jamendo картинка уже есть
        if(track.image) {
            els.cover.src = track.image;
            els.cover.style.opacity = 1;
            els.defIcon.style.opacity = 0;
            if(els.autoColorCheck.checked) applyAutoColor();
        } else {
            showDefaultCover();
        }
    } else {
        // Локальные файлы читаем теги
        getMetadata(track.path).then(meta => {
            if(meta.picture) {
                els.cover.src = meta.picture;
                els.cover.style.opacity = 1;
                els.defIcon.style.opacity = 0;
                if(els.autoColorCheck.checked) applyAutoColor();
            } else {
                showDefaultCover();
            }
        });
    }
}

function showDefaultCover() {
    els.cover.style.opacity = 0;
    els.defIcon.style.opacity = 1;
    resetThemeColor();
}

function togglePlay() {
    if (!state.audio.src) return;
    state.audio.paused ? state.audio.play() : state.audio.pause();
}

function playNext() {
    // Если играем Jamendo, логика Next проще (просто следующий в списке результатов)
    if(state.currentMode === 'jamendo') {
         // Для простоты реализации "next" в jamendo не реализован в этом блоке
         // так как индекс трека в результатах не сохраняется в глобальный currentIndex
         // при желании можно добавить
         return; 
    }

    if (state.isShuffle) {
        let rand = Math.floor(Math.random() * state.filteredPlaylist.length);
        playTrack(rand);
    } else {
        if (state.currentIndex < state.filteredPlaylist.length - 1) {
            playTrack(state.currentIndex + 1);
        } else if (state.loopMode === 1) {
            playTrack(0);
        }
    }
}

function playPrev() {
    if (state.audio.currentTime > 3) {
        state.audio.currentTime = 0;
    } else {
        if (state.currentMode === 'local' && state.currentIndex > 0) playTrack(state.currentIndex - 1);
    }
}

function handleEnded() {
    if (state.loopMode === 2) {
        state.audio.currentTime = 0;
        state.audio.play();
    } else {
        playNext();
    }
}

function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    els.shuffleBtn.classList.toggle('active', state.isShuffle);
}

function toggleLoop() {
    state.loopMode = (state.loopMode + 1) % 3;
    els.loopBtn.classList.remove('active');
    els.loopBtn.innerHTML = '<i class="fas fa-redo"></i>';
    if (state.loopMode === 1) els.loopBtn.classList.add('active');
    else if (state.loopMode === 2) {
        els.loopBtn.classList.add('active'); 
        els.loopBtn.innerHTML = '<i class="fas fa-redo-alt"></i> 1';
    }
}

function seek(e) {
    const rect = els.progressWrapper.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    if(state.audio.duration) {
        state.audio.currentTime = percent * state.audio.duration;
    }
}

function updateProgress() {
    if (isNaN(state.audio.duration)) return;
    const percent = (state.audio.currentTime / state.audio.duration) * 100;
    els.progressFill.style.width = percent + '%';
    els.progressHandle.style.left = percent + '%';
    els.timeCurrent.innerText = formatTime(state.audio.currentTime);
}

function updateVolumeIcon() {
    const vol = state.audio.volume;
    if (state.audio.muted || vol === 0) els.muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
    else if (vol < 0.5) els.muteBtn.innerHTML = '<i class="fas fa-volume-down"></i>';
    else els.muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
}

// --- Управление Файлами ---

async function loadFiles(filePaths) {
    const exts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
    const validFiles = filePaths.filter(p => exts.includes(path.extname(p).toLowerCase()));
    
    for (const p of validFiles) {
        if (state.playlist.some(t => t.path === p)) continue;
        const meta = await getMetadata(p);
        state.playlist.push({
            path: p,
            name: meta.title || path.basename(p, path.extname(p)),
            artist: meta.artist || 'Неизвестен',
            album: meta.album || '---',
            baseName: path.basename(p)
        });
    }
    state.filteredPlaylist = [...state.playlist];
    renderPlaylist();
    if(state.playlist.length > 0 && state.currentIndex === -1) switchTab('library');
}

function handleDrop(e) {
    e.preventDefault(); e.stopPropagation();
    const files = Array.from(e.dataTransfer.files).map(f => f.path);
    loadFiles(files);
}

function handleSearch(e) {
    const query = e.target.value.toLowerCase();
    if (!query) {
        state.filteredPlaylist = [...state.playlist];
    } else {
        state.filteredPlaylist = state.playlist.filter(t => 
            t.name.toLowerCase().includes(query) || 
            t.artist.toLowerCase().includes(query)
        );
    }
    renderPlaylist();
}

function renderPlaylist() {
    els.playlistContainer.innerHTML = '';
    if (state.filteredPlaylist.length === 0) {
        els.playlistContainer.innerHTML = '<div class="empty-state"><p>Список пуст</p></div>';
        return;
    }
    state.filteredPlaylist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-item';
        const isCurrent = (state.currentIndex !== -1 && state.playlist[state.currentIndex] && state.playlist[state.currentIndex].path === track.path);
        if (isCurrent && state.currentMode === 'local') li.classList.add('active');

        li.innerHTML = `
            <span class="col-idx">${index + 1}</span>
            <span class="col-title">${track.name}</span>
            <span class="col-artist">${track.artist}</span>
            <span class="col-album">${track.album}</span>
        `;
        li.onclick = () => playTrack(index, false);
        els.playlistContainer.appendChild(li);
    });
}

// --- Jamendo API ---

async function searchJamendo() {
    const query = els.jamInput.value.trim();
    if(!query) return;
    
    els.jamResults.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Поиск...</p></div>';
    
    try {
        const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${state.jamendoClientId}&format=jsonpretty&limit=20&namesearch=${encodeURIComponent(query)}&include=musicinfo`;
        const res = await fetch(url);
        const data = await res.json();
        
        if(data.results && data.results.length > 0) {
            state.jamendoTracks = data.results.map(t => ({
                name: t.name,
                artist: t.artist_name,
                album: t.album_name,
                image: t.album_image,
                audio: t.audio,
                id: t.id
            }));
            renderJamendoResults();
        } else {
            els.jamResults.innerHTML = '<div class="empty-state"><p>Ничего не найдено</p></div>';
        }
    } catch(e) {
        console.error(e);
        els.jamResults.innerHTML = '<div class="empty-state"><p>Ошибка сети</p></div>';
    }
}

function renderJamendoResults() {
    els.jamResults.innerHTML = '';
    state.jamendoTracks.forEach((track, index) => {
        const div = document.createElement('div');
        div.className = 'jamendo-item';
        div.innerHTML = `
            <img class="jamendo-img" src="${track.image}" loading="lazy">
            <div class="jamendo-title">${track.name}</div>
            <div class="jamendo-artist">${track.artist}</div>
        `;
        div.onclick = () => playTrack(index, true);
        els.jamResults.appendChild(div);
    });
}


// --- Метаданные ---

function getMetadata(filePath) {
    return new Promise((resolve) => {
        jsmediatags.read(filePath, {
            onSuccess: (tag) => {
                let picture = null;
                if (tag.tags.picture) {
                    const { data, format } = tag.tags.picture;
                    let base64String = "";
                    for (let i = 0; i < data.length; i++) {
                        base64String += String.fromCharCode(data[i]);
                    }
                    picture = `data:${format};base64,${window.btoa(base64String)}`;
                }
                resolve({
                    title: tag.tags.title,
                    artist: tag.tags.artist,
                    album: tag.tags.album,
                    picture: picture
                });
            },
            onError: (error) => {
                resolve({});
            }
        });
    });
}

// --- Визуализатор ---

function renderFrame() {
    // Рекурсивный вызов всегда нужен, если мы хотим, чтобы визуализатор "жил"
    requestAnimationFrame(renderFrame);
    
    // Но рисуем только если играем и вкладка активна
    if (!state.isPlaying || state.currentTab !== 'visualizer' || !state.analyser) {
        return;
    }

    state.analyser.getByteFrequencyData(state.dataArray);

    const ctx = els.canvas.getContext('2d');
    const w = els.canvas.width;
    const h = els.canvas.height;
    const barWidth = (w / state.dataArray.length) * 2.5;
    let x = 0;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < state.dataArray.length; i++) {
        const barHeight = state.dataArray[i] * (h / 255);
        
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        
        const gradient = ctx.createLinearGradient(0, h, 0, h - barHeight);
        gradient.addColorStop(0, accent);
        gradient.addColorStop(1, '#ffffff');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, h - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

function resizeCanvas() {
    els.canvas.width = els.canvas.clientWidth;
    els.canvas.height = els.canvas.clientHeight;
}

window.addEventListener('resize', resizeCanvas);

// --- Вспомогательные ---

function switchTab(tabName) {
    state.currentTab = tabName;
    els.navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    els.tabs.forEach(tab => tab.classList.toggle('active', tab.id === `tab-${tabName}`));
    if(tabName === 'visualizer') resizeCanvas();
}

function formatTime(seconds) {
    if(!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' + s : s}`;
}

function loadSettings() {
    if(localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        els.themeCheck.checked = true;
    }
}

function applyAutoColor() {
    const hue = Math.floor(Math.random() * 360);
    document.documentElement.style.setProperty('--accent', `hsl(${hue}, 70%, 50%)`);
    document.documentElement.style.setProperty('--accent-hover', `hsl(${hue}, 70%, 40%)`);
}

function resetThemeColor() {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-hover');
}