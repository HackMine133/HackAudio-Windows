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
    currentFilteredIndex: -1,
    currentJamendoIndex: -1,
    isPlaying: false,
    isShuffle: false,
    loopMode: 0, // 0: None, 1: All, 2: One
    currentTab: 'library',
    libraryFilter: 'all',
    searchQuery: '',
    sortBy: 'added',
    sortDir: 'desc',
    favorites: new Set(),
    recentlyPlayed: [],
    
    // Аудио контекст
    audioCtx: null,
    analyser: null,
    gainNode: null, 
    source: null,
    bassNode: null,
    midNode: null,
    trebleNode: null,
    panNode: null,
    dataArray: null,
    
    // Настройки
    bonusVolume: 100, 
    playbackRate: 1.0,
    eq: { bass: 0, mid: 0, treble: 0 },
    pan: 0,
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
    filterPills: document.querySelectorAll('.pill'),
    sortSelect: document.getElementById('sort-select'),
    sortDirBtn: document.getElementById('sort-dir-btn'),
    
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
    bassSlider: document.getElementById('bass-slider'),
    bassVal: document.getElementById('bass-val'),
    midSlider: document.getElementById('mid-slider'),
    midVal: document.getElementById('mid-val'),
    trebleSlider: document.getElementById('treble-slider'),
    trebleVal: document.getElementById('treble-val'),
    panSlider: document.getElementById('pan-slider'),
    panVal: document.getElementById('pan-val'),
    
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
    els.filterPills.forEach(btn => {
        btn.addEventListener('click', () => setLibraryFilter(btn.dataset.filter));
    });
    els.sortSelect.onchange = (e) => {
        state.sortBy = e.target.value;
        updateFilteredPlaylist();
        saveLibraryPrefs();
    };
    els.sortDirBtn.onclick = toggleSortDir;

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

    els.autoColorCheck.onchange = (e) => {
        if (e.target.checked && els.cover.src) {
            applyAutoColorFromImage(els.cover.src);
        } else {
            resetThemeColor();
        }
    };
    
    els.speedSlider.oninput = (e) => {
        state.playbackRate = parseFloat(e.target.value);
        state.audio.playbackRate = state.playbackRate;
        els.speedVal.innerText = state.playbackRate.toFixed(1);
        saveAudioPrefs();
    };
    
    els.bonusVolSlider.oninput = (e) => {
        state.bonusVolume = parseInt(e.target.value);
        els.bonusVolVal.innerText = state.bonusVolume;
        setGain();
        saveAudioPrefs();
    };

    els.bassSlider.oninput = (e) => {
        state.eq.bass = parseInt(e.target.value);
        els.bassVal.innerText = state.eq.bass;
        setEQ();
        saveAudioPrefs();
    };
    els.midSlider.oninput = (e) => {
        state.eq.mid = parseInt(e.target.value);
        els.midVal.innerText = state.eq.mid;
        setEQ();
        saveAudioPrefs();
    };
    els.trebleSlider.oninput = (e) => {
        state.eq.treble = parseInt(e.target.value);
        els.trebleVal.innerText = state.eq.treble;
        setEQ();
        saveAudioPrefs();
    };
    els.panSlider.oninput = (e) => {
        state.pan = parseFloat(e.target.value);
        els.panVal.innerText = state.pan.toFixed(1);
        setPan();
        saveAudioPrefs();
    };

    window.addEventListener('keydown', handleKeyboardShortcuts);
}

// --- Аудио Логика ---

function initAudioContext() {
    // Создаем контекст только один раз
    if (!state.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new AudioContext();
        
        // Граф: Source -> EQ -> Pan -> Gain (Bonus) -> Analyser -> Destination
        state.source = state.audioCtx.createMediaElementSource(state.audio);
        state.bassNode = state.audioCtx.createBiquadFilter();
        state.midNode = state.audioCtx.createBiquadFilter();
        state.trebleNode = state.audioCtx.createBiquadFilter();
        state.panNode = state.audioCtx.createStereoPanner();
        state.gainNode = state.audioCtx.createGain();
        state.analyser = state.audioCtx.createAnalyser();
        
        state.bassNode.type = 'lowshelf';
        state.bassNode.frequency.value = 80;
        state.midNode.type = 'peaking';
        state.midNode.frequency.value = 1000;
        state.midNode.Q.value = 1;
        state.trebleNode.type = 'highshelf';
        state.trebleNode.frequency.value = 8000;

        state.analyser.fftSize = 256; 
        state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);

        state.source.connect(state.bassNode);
        state.bassNode.connect(state.midNode);
        state.midNode.connect(state.trebleNode);
        state.trebleNode.connect(state.panNode);
        state.panNode.connect(state.gainNode);
        state.gainNode.connect(state.analyser);
        state.analyser.connect(state.audioCtx.destination);
    }
    
    // Если контекст был suspended (браузерная политика), возобновляем его
    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }

    setGain();
    setEQ();
    setPan();
}

function setGain() {
    if(!state.gainNode) return;
    const gainVal = state.bonusVolume / 100;
    state.gainNode.gain.value = gainVal;
}

function setEQ() {
    if(!state.bassNode || !state.midNode || !state.trebleNode) return;
    state.bassNode.gain.value = state.eq.bass;
    state.midNode.gain.value = state.eq.mid;
    state.trebleNode.gain.value = state.eq.treble;
}

function setPan() {
    if(!state.panNode) return;
    state.panNode.pan.value = state.pan;
}

function playTrack(index, fromJamendo = false) {
    if (fromJamendo) {
        state.currentMode = 'jamendo';
        const track = state.jamendoTracks[index];
        state.audio.src = track.audio; // URL
        state.currentJamendoIndex = index;
        updatePlayerUI(track, true);
    } else {
        state.currentMode = 'local';
        if (index < 0 || index >= state.filteredPlaylist.length) return;
        const track = state.filteredPlaylist[index];
        state.currentIndex = state.playlist.findIndex(t => t.path === track.path);
        state.currentFilteredIndex = index;
        state.currentJamendoIndex = -1;
        state.audio.src = track.path;
        updatePlayerUI(track, false);
        addToRecent(track.path);
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
            if(els.autoColorCheck.checked) applyAutoColorFromImage(track.image);
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
                if(els.autoColorCheck.checked) applyAutoColorFromImage(meta.picture);
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
        if (state.currentJamendoIndex < state.jamendoTracks.length - 1) {
            playTrack(state.currentJamendoIndex + 1, true);
        } else if (state.loopMode === 1 && state.jamendoTracks.length > 0) {
            playTrack(0, true);
        }
        return;
    }

    if (state.filteredPlaylist.length === 0) return;

    if (state.isShuffle) {
        let rand = Math.floor(Math.random() * state.filteredPlaylist.length);
        playTrack(rand);
    } else {
        if (state.currentFilteredIndex === -1) {
            playTrack(0);
        } else if (state.currentFilteredIndex < state.filteredPlaylist.length - 1) {
            playTrack(state.currentFilteredIndex + 1);
        } else if (state.loopMode === 1) {
            playTrack(0);
        }
    }
}

function playPrev() {
    if (state.audio.currentTime > 3) {
        state.audio.currentTime = 0;
    } else {
        if (state.currentMode === 'jamendo' && state.currentJamendoIndex > 0) {
            playTrack(state.currentJamendoIndex - 1, true);
        } else if (state.currentMode === 'local' && state.currentFilteredIndex > 0) {
            playTrack(state.currentFilteredIndex - 1);
        }
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
            baseName: path.basename(p),
            addedAt: Date.now()
        });
    }
    updateFilteredPlaylist();
    if(state.playlist.length > 0 && state.currentIndex === -1) switchTab('library');
}

function handleDrop(e) {
    e.preventDefault(); e.stopPropagation();
    const files = Array.from(e.dataTransfer.files).map(f => f.path);
    loadFiles(files);
}

function handleSearch(e) {
    state.searchQuery = e.target.value.toLowerCase();
    updateFilteredPlaylist();
}

function renderPlaylist() {
    els.playlistContainer.innerHTML = '';
    if (state.filteredPlaylist.length === 0) {
        if (state.libraryFilter === 'favorites') {
            els.playlistContainer.innerHTML = '<div class="empty-state"><i class="fas fa-heart-broken"></i><p>Избранных треков пока нет</p></div>';
        } else if (state.libraryFilter === 'recent') {
            els.playlistContainer.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>Недавно прослушанные появятся после воспроизведения</p></div>';
        } else {
            els.playlistContainer.innerHTML = '<div class="empty-state"><p>Список пуст</p></div>';
        }
        return;
    }
    state.filteredPlaylist.forEach((track, index) => {
        const li = document.createElement('li');
        li.className = 'track-item';
        const isCurrent = (state.currentIndex !== -1 && state.playlist[state.currentIndex] && state.playlist[state.currentIndex].path === track.path);
        if (isCurrent && state.currentMode === 'local') li.classList.add('active');
        const isFav = state.favorites.has(track.path);

        li.innerHTML = `
            <span class="col-idx">${index + 1}</span>
            <span class="col-title">${track.name}</span>
            <span class="col-artist">${track.artist}</span>
            <span class="col-album">${track.album}</span>
            <span class="col-fav">
                <button class="fav-btn ${isFav ? 'active' : ''}" title="Избранное">
                    <i class="fas fa-heart"></i>
                </button>
            </span>
        `;
        li.onclick = () => playTrack(index, false);
        li.querySelector('.fav-btn').onclick = (event) => {
            event.stopPropagation();
            toggleFavorite(track.path);
        };
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

// --- Библиотека: фильтры, сортировка ---

function updateFilteredPlaylist() {
    let list = [...state.playlist];

    if (state.searchQuery) {
        list = list.filter(t =>
            t.name.toLowerCase().includes(state.searchQuery) ||
            t.artist.toLowerCase().includes(state.searchQuery)
        );
    }

    if (state.libraryFilter === 'favorites') {
        list = list.filter(t => state.favorites.has(t.path));
    } else if (state.libraryFilter === 'recent') {
        const recentMap = new Map(state.recentlyPlayed.map((path, idx) => [path, idx]));
        list = list
            .filter(t => recentMap.has(t.path))
            .sort((a, b) => recentMap.get(a.path) - recentMap.get(b.path));
    }

    if (state.libraryFilter !== 'recent') {
        const dir = state.sortDir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            if (state.sortBy === 'added') return (a.addedAt - b.addedAt) * dir;
            const aVal = (a[state.sortBy] || '').toString().toLowerCase();
            const bVal = (b[state.sortBy] || '').toString().toLowerCase();
            return aVal.localeCompare(bVal) * dir;
        });
    }

    state.filteredPlaylist = list;
    if (state.currentIndex !== -1 && state.playlist[state.currentIndex]) {
        const currentPath = state.playlist[state.currentIndex].path;
        state.currentFilteredIndex = list.findIndex(track => track.path === currentPath);
    } else {
        state.currentFilteredIndex = -1;
    }
    renderPlaylist();
}

function setLibraryFilter(filter) {
    state.libraryFilter = filter;
    els.filterPills.forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
    updateFilteredPlaylist();
    saveLibraryPrefs();
}

function toggleSortDir() {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    updateSortIcon();
    updateFilteredPlaylist();
    saveLibraryPrefs();
}

function updateSortIcon() {
    const icon = state.sortDir === 'asc' ? 'fa-sort-amount-up-alt' : 'fa-sort-amount-down-alt';
    els.sortDirBtn.innerHTML = `<i class="fas ${icon}"></i>`;
}

function toggleFavorite(trackPath) {
    if (state.favorites.has(trackPath)) {
        state.favorites.delete(trackPath);
    } else {
        state.favorites.add(trackPath);
    }
    saveFavorites();
    updateFilteredPlaylist();
}

function addToRecent(trackPath) {
    state.recentlyPlayed = state.recentlyPlayed.filter(path => path !== trackPath);
    state.recentlyPlayed.unshift(trackPath);
    state.recentlyPlayed = state.recentlyPlayed.slice(0, 50);
    saveRecent();
    if (state.libraryFilter === 'recent') updateFilteredPlaylist();
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
    const storedTheme = localStorage.getItem('theme');
    if(storedTheme === 'light') {
        document.body.classList.add('light-theme');
        els.themeCheck.checked = true;
    }

    const favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    state.favorites = new Set(favorites);

    const recent = JSON.parse(localStorage.getItem('recentlyPlayed') || '[]');
    state.recentlyPlayed = recent;

    const libraryPrefs = JSON.parse(localStorage.getItem('libraryPrefs') || '{}');
    if (libraryPrefs.filter) state.libraryFilter = libraryPrefs.filter;
    if (libraryPrefs.sortBy) state.sortBy = libraryPrefs.sortBy;
    if (libraryPrefs.sortDir) state.sortDir = libraryPrefs.sortDir;

    const audioPrefs = JSON.parse(localStorage.getItem('audioPrefs') || '{}');
    if (audioPrefs.bonusVolume) state.bonusVolume = audioPrefs.bonusVolume;
    if (audioPrefs.playbackRate) state.playbackRate = audioPrefs.playbackRate;
    if (audioPrefs.eq) state.eq = audioPrefs.eq;
    if (audioPrefs.pan !== undefined) state.pan = audioPrefs.pan;

    els.bonusVolSlider.value = state.bonusVolume;
    els.bonusVolVal.innerText = state.bonusVolume;
    els.speedSlider.value = state.playbackRate;
    els.speedVal.innerText = state.playbackRate.toFixed(1);
    els.bassSlider.value = state.eq.bass;
    els.bassVal.innerText = state.eq.bass;
    els.midSlider.value = state.eq.mid;
    els.midVal.innerText = state.eq.mid;
    els.trebleSlider.value = state.eq.treble;
    els.trebleVal.innerText = state.eq.treble;
    els.panSlider.value = state.pan;
    els.panVal.innerText = state.pan.toFixed(1);

    els.sortSelect.value = state.sortBy;
    updateSortIcon();
    setLibraryFilter(state.libraryFilter);
}

function saveFavorites() {
    localStorage.setItem('favorites', JSON.stringify(Array.from(state.favorites)));
}

function saveRecent() {
    localStorage.setItem('recentlyPlayed', JSON.stringify(state.recentlyPlayed));
}

function saveLibraryPrefs() {
    localStorage.setItem('libraryPrefs', JSON.stringify({
        filter: state.libraryFilter,
        sortBy: state.sortBy,
        sortDir: state.sortDir
    }));
}

function saveAudioPrefs() {
    localStorage.setItem('audioPrefs', JSON.stringify({
        bonusVolume: state.bonusVolume,
        playbackRate: state.playbackRate,
        eq: state.eq,
        pan: state.pan
    }));
}

function handleKeyboardShortcuts(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
    } else if (event.code === 'ArrowRight') {
        state.audio.currentTime = Math.min(state.audio.currentTime + 5, state.audio.duration || state.audio.currentTime);
    } else if (event.code === 'ArrowLeft') {
        state.audio.currentTime = Math.max(state.audio.currentTime - 5, 0);
    } else if (event.code === 'ArrowUp') {
        event.preventDefault();
        state.audio.volume = Math.min(state.audio.volume + 0.05, 1);
        els.volumeSlider.value = Math.round(state.audio.volume * 100);
        updateVolumeIcon();
    } else if (event.code === 'ArrowDown') {
        event.preventDefault();
        state.audio.volume = Math.max(state.audio.volume - 0.05, 0);
        els.volumeSlider.value = Math.round(state.audio.volume * 100);
        updateVolumeIcon();
    }
}

function applyAutoColorFromImage(imageSrc) {
    if (!imageSrc) {
        applyAutoColor();
        return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const size = 40;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        document.documentElement.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
        document.documentElement.style.setProperty('--accent-hover', `rgba(${r}, ${g}, ${b}, 0.8)`);
    };
    img.onerror = applyAutoColor;
    img.src = imageSrc;
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
