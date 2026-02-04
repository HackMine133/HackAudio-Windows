const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const jsmediatags = require('jsmediatags');

// --- Элементы DOM ---
const visualizerCanvas = document.getElementById('visualizer');
const coverArtDiv = document.getElementById('cover-art');
const coverImage = document.getElementById('cover-image');
const defaultIcon = document.getElementById('default-icon');
const mainDisplay = document.querySelector('.main-display');

// Now Playing Panel
const nowPlayingTitle = document.getElementById('now-playing-title');
const nowPlayingArtist = document.getElementById('now-playing-artist');
const nowPlayingCover = document.getElementById('now-playing-cover');
const nowPlayingPlaceholder = document.getElementById('now-playing-placeholder');
const nowPlayingLikeBtn = document.getElementById('now-playing-like-btn');
const nowPlayingPosition = document.getElementById('now-playing-position');
const editTrackBtn = document.getElementById('edit-track-btn');

// Controls
const playPauseBtn = document.getElementById('play-pause-btn');
const playPauseIcon = playPauseBtn.querySelector('i');
const nextBtn = document.getElementById('next-btn');
const prevBtn = document.getElementById('prev-btn');
const loopBtn = document.getElementById('loop-btn');
const settingsBtn = document.getElementById('settings-btn');
const eqBtn = document.getElementById('eq-btn');
const addToPlaylistBtn = document.getElementById('add-to-playlist-btn');
const toggleViewBtn = document.getElementById('toggle-view');

// Sliders
const volumeSlider = document.getElementById('volume-slider');
const volumeText = document.getElementById('volume-text');
const muteBtn = document.getElementById('mute-btn');
const seekSlider = document.getElementById('seek-slider');
const currentTimeText = document.getElementById('current-time');
const durationText = document.getElementById('duration');

// Speed
const speedBtn = document.getElementById('speed-btn');
const speedPopup = document.getElementById('speed-popup');
const speedSlider = document.getElementById('speed-slider');
const speedDisplayText = document.getElementById('speed-display-text');

// Window
const btnMin = document.getElementById('btn-min');
const btnMax = document.getElementById('btn-max');
const btnClose = document.getElementById('btn-close');

// Settings Panel
const settingsPanel = document.getElementById('settings-panel');
const colorPicker = document.getElementById('accent-color-picker');
const autoColorCheckbox = document.getElementById('auto-color-mode');
const vizSensitivityInput = document.getElementById('viz-sensitivity');
const vizBarCountInput = document.getElementById('viz-bar-count');
const showCoverVizCheckbox = document.getElementById('show-cover-viz');
const bonusVolumeCheckbox = document.getElementById('bonus-volume');
const whiteThemeCheckbox = document.getElementById('white-theme-mode');
const controlsLayoutSelect = document.getElementById('controls-layout');

// Modals
const eqWindow = document.getElementById('eq-window');
const closeEqBtn = document.getElementById('close-eq-btn');
const eqPresetsSelect = document.getElementById('eq-presets');
const eqSlidersContainer = document.getElementById('eq-sliders');
const saveEqPresetBtn = document.getElementById('save-eq-preset-btn');

const editWindow = document.getElementById('edit-window');
const editTitleInput = document.getElementById('edit-title-input');
const editArtistInput = document.getElementById('edit-artist-input');
const editCoverPreview = document.getElementById('edit-cover-preview');
const changeCoverBtn = document.getElementById('change-cover-btn');
const editCoverInput = document.getElementById('edit-cover-input');
const saveEditFileBtn = document.getElementById('save-edit-file-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

// Video
const videoContainer = document.getElementById('video-container');
const mainVideo = document.getElementById('main-video');
const videoFullscreenBtn = document.getElementById('video-fullscreen-btn');
const closeVideoBtn = document.getElementById('close-video-btn');

// Playlist
const togglePlaylistBtn = document.getElementById('toggle-playlist');
const playlistPanel = document.getElementById('playlist-panel');
const playlistListUl = document.getElementById('playlist-list');
const addFilesBtn = document.getElementById('add-files-btn');
const playPlaylistBtn = document.getElementById('play-playlist-btn');
const showLikedBtn = document.getElementById('show-liked-btn');
const fileInput = document.getElementById('file-input');
const searchInput = document.getElementById('playlist-search-input'); // НОВОЕ: Поиск

// --- State ---
let audioCtx;
let analyser;
let gainNode;
let source;
let eqBands = [];
let audio = new Audio();
let isPlaying = false;
let isMidiPlaying = false; 
let midiInterval = null;
let midiOscillator = null;

let trackStats = JSON.parse(localStorage.getItem('trackStats')) || {};
let customMetadata = JSON.parse(localStorage.getItem('customMetadata')) || {};
let manualPlaylist = JSON.parse(localStorage.getItem('savedPlaylist')) || [];
let likedTracks = new Set(JSON.parse(localStorage.getItem('likedTracks')) || []);

let activeQueue = [];
let currentIndex = -1;
let playbackHistory = [];

let currentMode = 'manual';
let loopMode = 0; 
const loopIcons = ['fa-repeat', 'fa-repeat', 'fa-1', 'fa-shuffle'];
const loopTitles = ['Повтор: Выкл', 'Повтор: Плейлист', 'Повтор: Трек', 'Случайно']; // НОВОЕ: Тултипы

let vizSensitivity = 1.0;
let vizBarCount = 128;
let showCoverInViz = false;
let currentCoverSrc = null;
let currentFilePath = null; // Храним текущий путь глобально
let isMuted = false;
let lastVolumeBeforeMute = 50;

let viewMode = 0; 
let isShowingLiked = false;
let isAutoColor = false;
let isWhiteTheme = false;
let menuLayout = 'bottom';

const eqFrequencies = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
let eqGains = new Array(10).fill(0);

const eqPresets = {
    flat: [0,0,0,0,0,0,0,0,0,0],
    bass: [8,6,4,2,0,0,0,0,0,0],
    rock: [4,3,2,1,-1,-1,1,2,3,4],
    pop: [-1,1,3,4,4,3,1,-1,-1,-1],
    jazz: [3,2,1,2,-1,-1,0,1,2,3],
    classical: [4,3,2,1,1,1,2,3,4,5],
    vocal: [-2,-2,-1,1,4,4,3,1,0,-1]
};

// --- DRAG & DROP FIX ---
document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add('drag-active');
});

document.body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('drag-active');
});

document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('drag-active');
    
    const files = [];
    for (const f of e.dataTransfer.files) {
        // Простая проверка на аудио/видео расширения
        if (f.path && /\.(mp3|wav|ogg|flac|m4a|mp4|webm|mid|midi)$/i.test(f.path)) {
            files.push(f.path);
        }
    }
    
    if (files.length > 0) {
        files.forEach(p => {
            if (!manualPlaylist.includes(p)) manualPlaylist.push(p);
        });
        localStorage.setItem('savedPlaylist', JSON.stringify(manualPlaylist));
        renderPlaylist();
        // Если ничего не играет, запустить первый добавленный
        currentMode = 'manual';
        activeQueue = manualPlaylist;
        currentIndex = manualPlaylist.indexOf(files[0]);

		loadTrack(files[0]);
    }
});

// --- SHORTCUTS ---
document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') {
        if (e.key === 'Enter' && document.activeElement === editTitleInput) return;
        return;
    }

    switch (e.code) {
        case 'Space':
            e.preventDefault(); 
            if (isPlaying) pauseTrack();
            else if (audio.src || isMidiPlaying) playTrack();
            break;
        case 'ArrowRight':
            if (audio.src && !isMidiPlaying) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
            break;
        case 'ArrowLeft':
            if (audio.src && !isMidiPlaying) audio.currentTime = Math.max(0, audio.currentTime - 5);
            break;
        case 'KeyF':
            toggleViewMode();
            break;
        case 'KeyP':
            togglePlaylist();
            break;
    }
});

// --- AUDIO INIT ---
function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;

        source = audioCtx.createMediaElementSource(audio);
        
        let previousNode = source;
        eqBands = eqFrequencies.map((freq, index) => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1;
            filter.gain.value = eqGains[index];
            previousNode.connect(filter);
            previousNode = filter;
            return filter;
        });

        eqBands[eqBands.length - 1].connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// --- VISUALIZER ---
const canvasCtx = visualizerCanvas.getContext('2d');
let animationId;

function resizeCanvas() {
    visualizerCanvas.width = visualizerCanvas.clientWidth;
    visualizerCanvas.height = visualizerCanvas.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    if (visualizerCanvas.width !== visualizerCanvas.clientWidth) resizeCanvas();
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    canvasCtx.clearRect(0, 0, width, height);

    if (showCoverInViz && currentCoverSrc && viewMode === 1) {
        const img = new Image();
        img.src = currentCoverSrc;
        if (img.complete) {
            canvasCtx.save();
            canvasCtx.globalAlpha = 0.2;
            const scale = Math.max(width / img.width, height / img.height);
            const x = (width / 2) - (img.width / 2) * scale;
            const y = (height / 2) - (img.height / 2) * scale;
            canvasCtx.drawImage(img, x, y, img.width * scale, img.height * scale);
            canvasCtx.restore();
        }
    }

    const usefulDataLength = Math.floor(bufferLength * 0.65); 
    const step = Math.floor(usefulDataLength / vizBarCount);
    const barWidth = (width / vizBarCount);
    
    let x = 0;
    const accentColor = document.documentElement.style.getPropertyValue('--accent-color') || '#2f66ca';

    for (let i = 0; i < vizBarCount; i++) {
        const dataIndex = Math.floor(i * step);
        let value = dataArray[dataIndex] || 0;
        
        let barHeight = (value / 255) * height * vizSensitivity;
        if (barHeight > height) barHeight = height;

        const gradient = canvasCtx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, accentColor);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
    }
}

// --- EQ Logic ---
function createEqUI() {
    eqSlidersContainer.innerHTML = '';
    eqFrequencies.forEach((freq, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'eq-band';
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = '-12'; slider.max = '12';
        slider.value = eqGains[i]; slider.className = 'eq-slider'; slider.orient = 'vertical';
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            eqGains[i] = val;
            if (eqBands[i]) eqBands[i].gain.value = val;
            eqPresetsSelect.value = 'custom';
            saveSettings();
        });
        const label = document.createElement('div');
        label.className = 'eq-freq-label';
        label.textContent = freq >= 1000 ? (freq/1000) + 'k' : freq;
        wrapper.appendChild(slider); wrapper.appendChild(label);
        eqSlidersContainer.appendChild(wrapper);
    });
}
createEqUI();
eqPresetsSelect.addEventListener('change', () => {
    const val = eqPresetsSelect.value;
    if (eqPresets[val]) {
        eqGains = [...eqPresets[val]];
        updateEqFromGains();
        saveSettings();
    }
});
function updateEqFromGains() {
    const sliders = eqSlidersContainer.querySelectorAll('input');
    sliders.forEach((slider, i) => {
        slider.value = eqGains[i];
        if (eqBands[i]) eqBands[i].gain.value = eqGains[i];
    });
}
// ИСПРАВЛЕНИЕ 3: Переключатель окна эквалайзера
eqBtn.addEventListener('click', () => {
    if (eqWindow.style.display === 'block') {
        eqWindow.style.display = 'none';
    } else {
        eqWindow.style.display = 'block';
    }
});
closeEqBtn.addEventListener('click', () => eqWindow.style.display = 'none');
saveEqPresetBtn.addEventListener('click', () => { alert('Настройки эквалайзера сохранены!'); saveSettings(); });

// --- PLAYBACK LOGIC ---
async function loadTrack(filePath) {
    if (!filePath) return;
    currentFilePath = filePath;
    
    stopMidiStub();
    videoContainer.style.display = 'none';
    mainVideo.pause();

    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.mid' || ext === '.midi') {
        initAudioContext();
        updateMainLikeButton(filePath);
        readMetadata(filePath);
        playMidiStub(filePath);
        return;
    }

    initAudioContext();

    if (!trackStats[filePath]) trackStats[filePath] = { addedAt: Date.now(), playCount: 0, lastPlayed: 0 };
    trackStats[filePath].playCount++;
    trackStats[filePath].lastPlayed = Date.now();
    localStorage.setItem('trackStats', JSON.stringify(trackStats));

    updateMainLikeButton(filePath);
    updateAddToPlaylistBtn(filePath);
    updateNowPlayingPosition();
    readMetadata(filePath);
    
    audio.src = filePath;
    audio.playbackRate = parseFloat(speedSlider.value);
    audio.load();
    setVolume(volumeSlider.value); 
    playTrack();
    
    renderPlaylist();
}

function playMidiStub(filePath) {
    isMidiPlaying = true;
    isPlaying = true;
    playPauseIcon.className = 'fas fa-pause';
    
    nowPlayingTitle.textContent = path.basename(filePath);
    nowPlayingArtist.textContent = "MIDI File";
    updateNowPlayingPosition();
    
    if (audioCtx) {
        midiOscillator = audioCtx.createOscillator();
        midiOscillator.type = 'square';
        midiOscillator.frequency.setValueAtTime(440, audioCtx.currentTime); 
        midiOscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
        const midiGain = audioCtx.createGain();
        midiGain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        midiGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        midiOscillator.connect(midiGain);
        midiGain.connect(audioCtx.destination);
        midiOscillator.start();
        midiOscillator.stop(audioCtx.currentTime + 0.5);
    }

    let dummyTime = 0;
    const dummyDuration = 120;
    durationText.textContent = formatTime(dummyDuration);
    
    midiInterval = setInterval(() => {
        dummyTime++;
        if (dummyTime > dummyDuration) {
            stopMidiStub();
            playNext(); 
            return;
        }
        currentTimeText.textContent = formatTime(dummyTime);
        seekSlider.value = (dummyTime / dummyDuration) * 100;
        updateSeekVisual(seekSlider.value);
    }, 1000);
}

function stopMidiStub() {
    isMidiPlaying = false;
    if (midiInterval) clearInterval(midiInterval);
    if (midiOscillator) {
        try { midiOscillator.stop(); } catch(e){}
    }
}

function setVolume(sliderValue) {
    let max = bonusVolumeCheckbox.checked ? 200 : 100;
    let vol = sliderValue / 100; 
    
    if (vol > 1.0) {
        audio.volume = 1.0;
        if (gainNode) gainNode.gain.value = vol; 
    } else {
        audio.volume = vol;
        if (gainNode) gainNode.gain.value = 1.0;
    }
    volumeText.textContent = Math.round(sliderValue) + '%';
    if (Number(sliderValue) > 0) {
        lastVolumeBeforeMute = Number(sliderValue);
    }
    updateMuteButtonState(sliderValue);
}

function updateMuteButtonState(sliderValue) {
    const isZero = Number(sliderValue) === 0;
    isMuted = isZero;
    if (muteBtn) {
        muteBtn.innerHTML = `<i class="fas ${isZero ? 'fa-volume-mute' : 'fa-volume-up'}"></i>`;
        muteBtn.title = isZero ? 'Включить звук' : 'Без звука';
    }
}

function playTrack() {
    if (isMidiPlaying) {
        isPlaying = true;
        playPauseIcon.className = 'fas fa-pause';
        return;
    }
    audio.play().then(() => {
        isPlaying = true;
        playPauseIcon.className = 'fas fa-pause';
        if (!animationId) drawVisualizer();
    }).catch(e => console.error(e));
}

function pauseTrack() {
    if (isMidiPlaying) {
        isPlaying = false;
        playPauseIcon.className = 'fas fa-play';
        return;
    }
    audio.pause();
    isPlaying = false;
    playPauseIcon.className = 'fas fa-play';
}

function playNext() {
    if (activeQueue.length === 0) return;
    playbackHistory.push(currentIndex);

    let nextIndex;
    if (loopMode === 3) { 
        nextIndex = Math.floor(Math.random() * activeQueue.length);
    } else {
        nextIndex = currentIndex + 1;
        if (nextIndex >= activeQueue.length) nextIndex = 0; 
    }
    currentIndex = nextIndex;
    loadTrack(activeQueue[nextIndex]);
}

function playPrev() {
    if (activeQueue.length === 0) return;
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }
    if (playbackHistory.length > 0) {
        currentIndex = playbackHistory.pop();
        loadTrack(activeQueue[currentIndex]);
        return;
    }
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = activeQueue.length - 1;
    currentIndex = prevIndex;
    loadTrack(activeQueue[prevIndex]);
}

audio.addEventListener('ended', () => {
    switch (loopMode) {
        case 0: // Повтор: Выкл
            isPlaying = false;
            playPauseIcon.className = 'fas fa-play';
            break;

        case 1: // Повтор: Плейлист
            playNext();
            break;

        case 2: // Повтор: Трек
            audio.currentTime = 0;
            playTrack();
            break;

        case 3: // Случайно
            playNext();
            break;
    }
});

// Controls
playPauseBtn.addEventListener('click', () => {
    if (isPlaying) pauseTrack();
    else if (audio.src || isMidiPlaying) playTrack();
});
nextBtn.addEventListener('click', playNext);
prevBtn.addEventListener('click', playPrev);

// ИСПРАВЛЕНИЕ 7: Tooltip для повтора
loopBtn.addEventListener('click', () => {
    loopMode++; if (loopMode > 3) loopMode = 0;
    loopBtn.querySelector('i').className = `fas ${loopIcons[loopMode]}`;
    loopBtn.title = loopTitles[loopMode]; // Обновляем текст
    if (loopMode !== 0) loopBtn.classList.add('active'); else loopBtn.classList.remove('active');
    saveSettings();
});

// ИСПРАВЛЕНИЕ 2: Add to Playlist Logic (по пути файла)
addToPlaylistBtn.addEventListener('click', () => {
    // Используем currentFilePath вместо activeQueue[currentIndex] для надежности
    if (!currentFilePath) return;
    
    // Проверяем наличие по значению строки, а не по индексу
    if (manualPlaylist.includes(currentFilePath)) {
        // Удаляем
        manualPlaylist = manualPlaylist.filter(p => p !== currentFilePath);
        addToPlaylistBtn.innerHTML = '<i class="fas fa-plus"></i>';
        addToPlaylistBtn.title = "Добавить в плейлист";
    } else {
        // Добавляем
        manualPlaylist.push(currentFilePath);
        addToPlaylistBtn.innerHTML = '<i class="fas fa-minus"></i>';
        addToPlaylistBtn.title = "Убрать из плейлиста";
    }
    localStorage.setItem('savedPlaylist', JSON.stringify(manualPlaylist));
    
    // Обновляем плейлист, если мы в режиме Manual
    if (currentMode === 'manual' || !isShowingLiked) {
        renderPlaylist();
    }
});

function updateMainLikeButton(filePath) {
    if (!nowPlayingLikeBtn) return;
    const isLiked = likedTracks.has(filePath);
    nowPlayingLikeBtn.classList.toggle('liked', isLiked);
    nowPlayingLikeBtn.innerHTML = `<i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>`;
    nowPlayingLikeBtn.title = isLiked ? 'Убрать из любимых' : 'В любимые';
}

if (nowPlayingLikeBtn) {
    nowPlayingLikeBtn.addEventListener('click', () => {
        if (!currentFilePath) return;
        toggleLike(currentFilePath);
        renderPlaylist();
    });
}

function updateNowPlayingPosition() {
    if (!nowPlayingPosition) return;
    if (!activeQueue.length || currentIndex < 0) {
        nowPlayingPosition.textContent = '—';
        updatePrevNextTooltips();
        return;
    }
    nowPlayingPosition.textContent = `${currentIndex + 1}/${activeQueue.length}`;
    updatePrevNextTooltips();
}

function getTrackLabel(filePath) {
    if (!filePath) return 'Неизвестно';
    const meta = customMetadata[filePath] || {};
    const title = meta.title || path.basename(filePath, path.extname(filePath));
    const artist = meta.artist || 'Неизвестен';
    return `${title} — ${artist}`;
}

function updatePrevNextTooltips() {
    if (!activeQueue.length || currentIndex < 0) {
        prevBtn.title = 'Предыдущий (←)';
        nextBtn.title = 'Следующий (→)';
        return;
    }
    const prevIndex = currentIndex - 1 < 0 ? activeQueue.length - 1 : currentIndex - 1;
    const nextIndex = currentIndex + 1 >= activeQueue.length ? 0 : currentIndex + 1;
    prevBtn.title = `Предыдущий: ${getTrackLabel(activeQueue[prevIndex])} (←)`;
    nextBtn.title = `Следующий: ${getTrackLabel(activeQueue[nextIndex])} (→)`;
}

function applyControlsLayout(layout) {
    menuLayout = layout;
    document.body.dataset.menuLayout = layout;
    if (controlsLayoutSelect) controlsLayoutSelect.value = layout;
}

function updateAddToPlaylistBtn(filePath) {
    if (manualPlaylist.includes(filePath)) {
        addToPlaylistBtn.innerHTML = '<i class="fas fa-minus"></i>';
        addToPlaylistBtn.title = "Убрать из плейлиста";
    } else {
        addToPlaylistBtn.innerHTML = '<i class="fas fa-plus"></i>';
        addToPlaylistBtn.title = "Добавить в плейлист";
    }
}

// Volume & Seek
volumeSlider.addEventListener('input', (e) => { setVolume(e.target.value); saveSettings(); });
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        if (isMuted) {
            const restoreValue = lastVolumeBeforeMute || 50;
            volumeSlider.value = restoreValue;
            setVolume(restoreValue);
            isMuted = false;
        } else {
            lastVolumeBeforeMute = Number(volumeSlider.value) || 50;
            volumeSlider.value = 0;
            setVolume(0);
            isMuted = true;
        }
        saveSettings();
    });
}
seekSlider.addEventListener('input', (e) => {
    if(!isMidiPlaying) {
        const time = (e.target.value / 100) * audio.duration;
        audio.currentTime = time;
    }
});
audio.addEventListener('timeupdate', () => {
    if (!isNaN(audio.duration)) {
        seekSlider.value = (audio.currentTime / audio.duration) * 100;
        currentTimeText.textContent = formatTime(audio.currentTime);
        durationText.textContent = formatTime(audio.duration);
        updateSeekVisual(seekSlider.value);
    }
});
function updateSeekVisual(val) {
    const accent = document.documentElement.style.getPropertyValue('--accent-color') || '#2f66ca';
    seekSlider.style.background = `linear-gradient(to right, ${accent} 0%, ${accent} ${val}%, #444 ${val}%, #444 100%)`;
}
function formatTime(s) {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec<10?'0'+sec:sec}`;
}

// Speed
speedBtn.addEventListener('click', (e) => { e.stopPropagation(); speedPopup.classList.toggle('active'); });
document.addEventListener('click', (e) => { if (!speedBtn.contains(e.target) && !speedPopup.contains(e.target)) speedPopup.classList.remove('active'); });
speedSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    audio.playbackRate = val;
    speedDisplayText.textContent = val.toFixed(1) + 'x';
    saveSettings();
});

// View Toggle
function toggleViewMode() {
    viewMode++; if (viewMode > 2) viewMode = 0;
    updateViewMode(); saveSettings();
}
function updateViewMode() {
    mainDisplay.classList.remove('hybrid-mode');
    if (viewMode === 0) {
        visualizerCanvas.style.display = 'none'; coverArtDiv.style.display = 'flex';
        toggleViewBtn.innerHTML = '<i class="fas fa-image"></i>';
    } else if (viewMode === 1) {
        visualizerCanvas.style.display = 'block'; coverArtDiv.style.display = 'none';
        toggleViewBtn.innerHTML = '<i class="fas fa-wave-square"></i>'; resizeCanvas();
    } else if (viewMode === 2) {
        mainDisplay.classList.add('hybrid-mode');
        toggleViewBtn.innerHTML = '<i class="fas fa-layer-group"></i>'; resizeCanvas();
    }
}
toggleViewBtn.addEventListener('click', toggleViewMode);

// --- METADATA & COLOR ---
function readMetadata(filePath) {
    const data = customMetadata[filePath] || {};
    nowPlayingTitle.textContent = "Загрузка...";
    
    if (data.title) {
        updateMetaUI(data.title, data.artist, data.cover);
        return;
    }

    jsmediatags.read(filePath, {
        onSuccess: (tag) => {
            const tags = tag.tags;
            const title = tags.title || path.basename(filePath, path.extname(filePath));
            const artist = tags.artist || "Неизвестен";
            let coverUrl = null;
            if (tags.picture) {
                const { data, format } = tags.picture;
                let base64 = "";
                for (let i=0; i<data.length; i++) base64 += String.fromCharCode(data[i]);
                coverUrl = `data:${format};base64,${window.btoa(base64)}`;
            }
            updateMetaUI(title, artist, coverUrl);
        },
        onError: () => {
            updateMetaUI(path.basename(filePath, path.extname(filePath)), "Неизвестен", null);
        }
    });
}

function updateMetaUI(title, artist, coverUrl) {
    nowPlayingTitle.textContent = title;
    nowPlayingArtist.textContent = artist;
    
    currentCoverSrc = coverUrl; 

    if (coverUrl) {
        // Если обложка ЕСТЬ
        coverImage.src = coverUrl;
        nowPlayingCover.src = coverUrl;
        coverImage.style.opacity = 1;
        coverImage.style.display = 'block';
        defaultIcon.style.display = 'none';
        nowPlayingCover.style.display = 'block';
        nowPlayingPlaceholder.style.display = 'none';

        if (isAutoColor) {
            applyAutoColor(coverUrl);
        }
    } else {
        // Если обложки НЕТ
        coverImage.style.display = 'none';
        defaultIcon.style.display = 'block';
        nowPlayingCover.style.display = 'none';
        nowPlayingPlaceholder.style.display = 'block';
        
        // ИСПРАВЛЕНИЕ: Мы убрали проверку "if (!isAutoColor)".
        // Теперь, если обложки нет, мы ВСЕГДА возвращаем цвет,
        // который выбрал пользователь в настройках.
        const userColor = colorPicker.value;
        applyTheme(userColor, hexToRgb(userColor));
    }
}

function applyAutoColor(src) {
    const tempImg = new Image();
    tempImg.src = src;
    tempImg.onload = () => {
        const c = getAverageColor(tempImg);
        if (c) applyTheme(c.hex, c.rgb);
    };
}

autoColorCheckbox.addEventListener('change', (e) => {
    isAutoColor = e.target.checked;
    saveSettings();
    
    if (isAutoColor && currentCoverSrc) {
        applyAutoColor(currentCoverSrc);
    } else {
        const userColor = colorPicker.value;
        applyTheme(userColor, hexToRgb(userColor));
    }
});

// --- ИСПРАВЛЕНИЕ 4: EDIT TRACK (Better "Save As" logic) ---
editTrackBtn.addEventListener('click', () => {
    if (!currentFilePath) return;
    
    // Предзаполняем поля текущими данными
    const meta = customMetadata[currentFilePath] || {};
    editTitleInput.value = meta.title || nowPlayingTitle.textContent;
    editArtistInput.value = meta.artist || nowPlayingArtist.textContent;
    editCoverPreview.src = currentCoverSrc || '';
    
    editWindow.style.display = 'block';
});
cancelEditBtn.addEventListener('click', () => editWindow.style.display = 'none');
changeCoverBtn.addEventListener('click', () => editCoverInput.click());
editCoverInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => { editCoverPreview.src = evt.target.result; };
        reader.readAsDataURL(file);
    }
});

saveEditFileBtn.addEventListener('click', async () => {
    const filePath = currentFilePath;
    if (!filePath) return;

    // Сохраняем новые данные в локальную БД для ТЕКУЩЕГО файла (чтобы обновилось сразу)
    const newTitle = editTitleInput.value.trim();
    const newArtist = editArtistInput.value.trim();
    const newCover = editCoverPreview.src.startsWith('data:') ? editCoverPreview.src : null;

    // Обновление интерфейса мгновенно
    updateMetaUI(newTitle, newArtist, newCover);

    // Спрашиваем, куда сохранить копию с новыми "тегами" (виртуальными)
    const { canceled, filePath: savePath } = await ipcRenderer.invoke('show-save-dialog', {
        defaultPath: path.join(path.dirname(filePath), `${newArtist} - ${newTitle}${path.extname(filePath)}`)
    });

    if (canceled || !savePath) {
        // Если отменили сохранение файла, просто сохраняем метаданные для текущего файла
        customMetadata[filePath] = { title: newTitle, artist: newArtist, cover: newCover };
        localStorage.setItem('customMetadata', JSON.stringify(customMetadata));
        editWindow.style.display = 'none';
        renderPlaylist();
        return;
    }

    // Копируем физический файл
    fs.copyFile(filePath, savePath, (err) => {
        if (err) {
            alert('Ошибка при сохранении: ' + err);
            return;
        }
        
        // Привязываем метаданные к НОВОМУ файлу
        customMetadata[savePath] = {
            title: newTitle,
            artist: newArtist,
            cover: newCover
        };
        localStorage.setItem('customMetadata', JSON.stringify(customMetadata));
        
        // Добавляем новый файл в плейлист
        if (!manualPlaylist.includes(savePath)) {
            manualPlaylist.push(savePath);
            localStorage.setItem('savedPlaylist', JSON.stringify(manualPlaylist));
        }

        alert('Файл сохранен! (Метаданные обновлены в базе приложения)');
        editWindow.style.display = 'none';
        renderPlaylist();
    });
});

// --- SETTINGS ---
settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('active'));
colorPicker.addEventListener('input', (e) => {
    if (!isAutoColor) { 
        applyTheme(e.target.value, hexToRgb(e.target.value));
    }
    saveSettings();
});
vizSensitivityInput.addEventListener('input', (e) => { vizSensitivity = parseFloat(e.target.value); saveSettings(); });
vizBarCountInput.addEventListener('input', (e) => { vizBarCount = parseInt(e.target.value); saveSettings(); });
showCoverVizCheckbox.addEventListener('change', (e) => { showCoverInViz = e.target.checked; saveSettings(); });
bonusVolumeCheckbox.addEventListener('change', (e) => { 
    volumeSlider.max = e.target.checked ? 200 : 100; 
    setVolume(volumeSlider.value); 
    saveSettings(); 
});
whiteThemeCheckbox.addEventListener('change', (e) => {
    isWhiteTheme = e.target.checked;
    if(isWhiteTheme) document.body.classList.add('light-theme'); else document.body.classList.remove('light-theme');
    saveSettings();
});
if (controlsLayoutSelect) {
    controlsLayoutSelect.addEventListener('change', (e) => {
        applyControlsLayout(e.target.value);
        saveSettings();
    });
}

// --- Playlist Logic ---
function togglePlaylist() {
    playlistPanel.classList.toggle('open');
}
togglePlaylistBtn.addEventListener('click', togglePlaylist);

addFilesBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(f => {
        if (!manualPlaylist.includes(f.path)) manualPlaylist.push(f.path);
    });
    localStorage.setItem('savedPlaylist', JSON.stringify(manualPlaylist));
    renderPlaylist();
    fileInput.value = '';
});

playPlaylistBtn.addEventListener('click', () => {
    let list = isShowingLiked ? Array.from(likedTracks) : manualPlaylist;
    if (list.length > 0) {
        currentMode = isShowingLiked ? 'liked' : 'manual';
        activeQueue = list;
        currentIndex = 0;
        loadTrack(activeQueue[0]);
    }
});
showLikedBtn.addEventListener('click', () => {
    isShowingLiked = !isShowingLiked;
    showLikedBtn.classList.toggle('active-filter', isShowingLiked);
    // Сбрасываем поиск при смене режима
    searchInput.value = ''; 
    renderPlaylist();
});

// ИСПРАВЛЕНИЕ 6: Поиск
searchInput.addEventListener('input', () => {
    renderPlaylist();
});

function renderPlaylist() {
    playlistListUl.innerHTML = '';
    const fullList = isShowingLiked ? Array.from(likedTracks) : manualPlaylist;
    const filterTerm = searchInput.value.toLowerCase();

    fullList.forEach((filePath, originalIndex) => { // originalIndex важен для логики
        const meta = customMetadata[filePath] || {};
        const title = (meta.title || path.basename(filePath, path.extname(filePath)));
        const artist = (meta.artist || "Неизвестен");

        // Фильтрация (Поиск)
        if (filterTerm && !title.toLowerCase().includes(filterTerm) && !artist.toLowerCase().includes(filterTerm)) {
            return; // Пропускаем рендер, но не меняем массив данных
        }

        const li = document.createElement('li');
        li.className = 'playlist-item';
        if (currentFilePath === filePath) li.classList.add('active');

        const isLiked = likedTracks.has(filePath);

        li.innerHTML = `
            <div class="playlist-info">
                <span class="track-name">${title}</span>
                <span class="track-artist">${artist}</span>
            </div>
            <div class="playlist-actions">
                <button class="playlist-like-btn ${isLiked ? 'liked' : ''}"><i class="${isLiked ? 'fas' : 'far'} fa-heart"></i></button>
                ${!isShowingLiked ? '<button class="delete-track-btn"><i class="fas fa-times"></i></button>' : ''}
            </div>
        `;
        
        // Клик по треку - запускаем по точному пути
        li.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            currentMode = isShowingLiked ? 'liked' : 'manual';
            activeQueue = fullList; // Очередь всегда полная, даже если визуально отфильтрована
            // Находим индекс в полной очереди
            currentIndex = fullList.indexOf(filePath);
            loadTrack(filePath);
        });

        li.querySelector('.playlist-like-btn').addEventListener('click', (e) => {
            e.stopPropagation(); toggleLike(filePath); renderPlaylist();
        });

        if(!isShowingLiked) {
            li.querySelector('.delete-track-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                manualPlaylist = manualPlaylist.filter(p => p !== filePath);
                localStorage.setItem('savedPlaylist', JSON.stringify(manualPlaylist));
                if(currentFilePath === filePath) updateAddToPlaylistBtn(filePath);
                renderPlaylist();
            });
        }
        playlistListUl.appendChild(li);
    });
    updateNowPlayingPosition();
}

function toggleLike(filePath) {
    if (likedTracks.has(filePath)) likedTracks.delete(filePath);
    else likedTracks.add(filePath);
    localStorage.setItem('likedTracks', JSON.stringify([...likedTracks]));
    if (currentFilePath === filePath) updateMainLikeButton(filePath);
}

// --- Utils ---
function getAverageColor(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 100; canvas.height = 100;
    ctx.drawImage(img, 0, 0, 100, 100);
    const data = ctx.getImageData(0,0,100,100).data;
    let r=0,g=0,b=0,c=0;
    for(let i=0; i<data.length; i+=40) { r+=data[i]; g+=data[i+1]; b+=data[i+2]; c++; }
    r=Math.floor(r/c); g=Math.floor(g/c); b=Math.floor(b/c);
    return { hex: rgbToHex(r,g,b), rgb: `${r},${g},${b}` };
}
function rgbToHex(r, g, b) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }
function hexToRgb(hex) {
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return res ? `${parseInt(res[1],16)}, ${parseInt(res[2],16)}, ${parseInt(res[3],16)}` : '47, 102, 202';
}
function applyTheme(hex, rgb) {
    document.documentElement.style.setProperty('--accent-color', hex);
    document.documentElement.style.setProperty('--accent-rgb', rgb);
}

// --- Settings Persistence ---
function saveSettings() {
    const s = {
        volume: volumeSlider.value,
        accent: colorPicker.value,
        vizSens: vizSensitivity,
        vizCount: vizBarCount,
        showCoverViz: showCoverInViz,
        bonusVol: bonusVolumeCheckbox.checked,
        whiteTheme: isWhiteTheme,
        isAutoColor: isAutoColor,
        loop: loopMode,
        view: viewMode,
        speed: speedSlider.value,
        menuLayout: menuLayout
    };
    localStorage.setItem('appSettings', JSON.stringify(s));
}

function loadSettings() {
    const s = JSON.parse(localStorage.getItem('appSettings'));
    if (!s) return;
    if (s.volume) { volumeSlider.value = s.volume; setVolume(s.volume); }
    if (s.accent) { colorPicker.value = s.accent; applyTheme(s.accent, hexToRgb(s.accent)); }
    if (s.vizSens) vizSensitivity = s.vizSens; vizSensitivityInput.value = s.vizSens;
    if (s.vizCount) vizBarCount = s.vizCount; vizBarCountInput.value = s.vizCount;
    if (s.showCoverViz) showCoverInViz = s.showCoverViz; showCoverVizCheckbox.checked = s.showCoverViz;
    if (s.bonusVol) bonusVolumeCheckbox.checked = s.bonusVol; volumeSlider.max = s.bonusVol ? 200 : 100;
    if (s.whiteTheme) { isWhiteTheme = s.whiteTheme; whiteThemeCheckbox.checked = s.whiteTheme; if(s.whiteTheme) document.body.classList.add('light-theme'); }
    if (s.isAutoColor) { isAutoColor = s.isAutoColor; autoColorCheckbox.checked = s.isAutoColor; }
    if (s.loop) { 
        loopMode = s.loop; 
        loopBtn.querySelector('i').className = `fas ${loopIcons[loopMode]}`;
        loopBtn.title = loopTitles[loopMode]; // Restore tooltip
        if(loopMode!==0) loopBtn.classList.add('active'); 
    }
    if (s.view) { viewMode = s.view; updateViewMode(); }
    if (s.speed) { speedSlider.value = s.speed; audio.playbackRate = s.speed; speedDisplayText.textContent = parseFloat(s.speed).toFixed(1)+'x'; }
    if (s.menuLayout) applyControlsLayout(s.menuLayout);
}

// Init
btnClose.addEventListener('click', () => ipcRenderer.send('app-close'));
btnMin.addEventListener('click', () => ipcRenderer.send('app-minimize'));
btnMax.addEventListener('click', () => ipcRenderer.send('app-maximize'));
ipcRenderer.on('open-file', (event, filePath) => {
    if (!manualPlaylist.includes(filePath)) manualPlaylist.push(filePath);
    currentMode = 'manual';
    activeQueue = manualPlaylist;
    currentIndex = manualPlaylist.indexOf(filePath);
    loadTrack(filePath);
});

loadSettings();
applyControlsLayout(menuLayout);
renderPlaylist();
