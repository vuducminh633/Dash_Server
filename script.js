// script.js — Core ABR streaming engine.
//
// Variable flow:
//
//   network.js  ──► fetchSegment(url) ──► raw ArrayBuffer
//   bandwidthCal.js ──► fetchAndMeasure(url)
//                          ├─ updates state.estimatedBandwidthMbps (EMA)
//                          ├─ updates state.lastRawMeasuredMbps
//                          └─ returns { buffer, rawMbps }
//   script.js   ──► selectQuality() reads state.estimatedBandwidthMbps
//               ──► pushTo(videoSB/audioSB, buffer) feeds MSE SourceBuffers
//               ──► updates state QoE fields
//               ──► calls ui.js functions to render dashboard

import {
    QUALITY_LEVELS,
    TOTAL_CHUNKS,
    SAFETY_MARGIN,
    BUFFER_LOW_THRESHOLD,
    BUFFER_HIGH_TARGET,
    TELEMETRY_INTERVAL_MS,
} from './config.js';
import { parseMpd } from './mpd.js';

import { state } from './state.js';
import { buildChunkUrl, buildInitUrl, fetchSegment } from './network.js';
import { fetchAndMeasure } from './bandwidthCal.js';
import {
    pushToChart,
    highlightPsnrBar,
    updateMetricPanel,
    updateQoEPanel,
    appendLogRow,
    clearLog,
} from './ui.js';

// ── MediaSource bootstrap ─────────────────────────────────────────────────────

const video       = document.getElementById('video-player');
const mediaSource = new MediaSource();
let   videoSB         = null;
let   audioSB         = null;
let   fetchController = null;  // AbortController for the current in-flight fetch
let   isDeadlineAbort = false; // true when the deadline timer fires the abort

// ── MPD bootstrap ─────────────────────────────────────────────────────────────
// Parse very_low_res/output.mpd to dynamically read segment count, duration
// and codec string. Top-level await blocks further module evaluation until
// the fetch resolves — the DOM is already built so this causes no visual delay.
const mpdInfo = await parseMpd('very_low_res/output.mpd').catch(() => ({
    totalChunks    : TOTAL_CHUNKS,
    segmentDuration: 2,
    totalDuration  : TOTAL_CHUNKS * 2,
    codecs         : 'avc1.4d401f',
    mimeType       : 'video/mp4',
}));
console.log('[MPD]', mpdInfo);

// Parse audio MPD for the shared audio track
const audioMpdInfo = await parseMpd('audio/output.mpd').catch(() => null);

// Use the minimum of video and audio chunk counts so we never fetch a video
// chunk that has no matching audio segment (video has one extra tail chunk).
mpdInfo.totalChunks = Math.min(
    mpdInfo.totalChunks,
    audioMpdInfo?.totalChunks ?? mpdInfo.totalChunks
);

// ── Progress bar elements (display-only) ──────────────────────────────────

const seekBuffer   = document.getElementById('seekBuffer');
const seekPlayed   = document.getElementById('seekPlayed');
const seekThumb    = document.getElementById('seekThumb');
const playPauseBtn = document.getElementById('playPauseBtn');
const timeDisplay  = document.getElementById('timeDisplay');

function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function updateSeekBar() {
    const dur = video.duration;
    if (!dur || !isFinite(dur)) return;
    const pct = (video.currentTime / dur) * 100;
    seekPlayed.style.width = pct + '%';
    seekThumb.style.left   = pct + '%';

    // Show the furthest buffered end point
    let bufEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.end(i) > bufEnd) bufEnd = video.buffered.end(i);
    }
    seekBuffer.style.width  = (bufEnd / dur * 100) + '%';
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(dur)}`;
}

// Update buffer indicator as data arrives
video.addEventListener('progress', updateSeekBar);


video.src = URL.createObjectURL(mediaSource);

mediaSource.addEventListener('sourceopen', () => {
    const videoMime = `${mpdInfo.mimeType}; codecs="${mpdInfo.codecs}"`;
    videoSB = mediaSource.addSourceBuffer(videoMime);
    videoSB.mode = 'segments';

    const audioCodec = audioMpdInfo?.codecs || 'mp4a.40.2';
    audioSB = mediaSource.addSourceBuffer(`audio/mp4; codecs="${audioCodec}"`);
    audioSB.mode = 'segments';

    mediaSource.duration = mpdInfo.totalDuration;
});

// ── Play / Pause button ─────────────────────────────────────────────

playPauseBtn.addEventListener('click', () => {
    if (!state.isPlaying) return;
    if (video.paused) { video.play(); } else { video.pause(); }
});
video.addEventListener('play',  () => { playPauseBtn.textContent = '⏸'; });
video.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; });
video.addEventListener('ended', () => { playPauseBtn.textContent = '▶'; });

// ── ABR Decision Engine ───────────────────────────────────────────────────────

// ─ Throughput-based: picks highest tier whose bitrate ≤ EMA × SAFETY_MARGIN ──
function selectQualityThroughput() {
    const safeMbps = state.estimatedBandwidthMbps * SAFETY_MARGIN;
    let best = QUALITY_LEVELS[0];
    for (const level of QUALITY_LEVELS) {
        if (level.bitrateMbps <= safeMbps) best = level;
    }
    return best;
}



// ── MSE SourceBuffer push ─────────────────────────────────────────────────────
// Wraps the event-driven SourceBuffer API in a Promise.
// This is the key pattern that prevents race conditions:
// the core loop awaits this before requesting the next chunk,
// guaranteeing that only one appendBuffer call is ever in-flight at a time.

function pushTo(sb, buffer) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            sb.removeEventListener('updateend', onDone);
            sb.removeEventListener('error',     onError);
        };
        const onDone  = () => { cleanup(); resolve(); };
        const onError = (e) => { cleanup(); reject(e); };

        sb.addEventListener('updateend', onDone);
        sb.addEventListener('error',     onError);
        sb.appendBuffer(buffer);
    });
}

// ── Buffer level ─────────────────────────────────────────────────────────────

function getBufferLevel() {
    if (!video.buffered.length) return 0;
    const now = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
        if (now >= video.buffered.start(i) && now <= video.buffered.end(i)) {
            return video.buffered.end(i) - now;
        }
    }
    return 0;
}

// ── Core fetch + decode loop ──────────────────────────────────────────────────
// Called by the timeupdate listener and by the start button.
// The isFetching mutex ensures only one pipeline is active at a time.

async function fetchNextChunk() {
    if (state.isFetching || !state.isPlaying) return;
    if (state.currentIndex > mpdInfo.totalChunks) {
        return;
    }

    state.bufferLevelSeconds = getBufferLevel();
    if (state.bufferLevelSeconds >= BUFFER_HIGH_TARGET) return; // buffer full

    state.isFetching = true; // ← lock

    try {
        // ── 1. ABR: choose quality ────────────────────────────────────────────
        const chosen       = selectQualityThroughput();
        const prevFolder   = state.currentQuality;
        const isFirstChunk = state.currentIndex === 1;
        const qualityChanged = chosen.folder !== prevFolder;

        // ── 2. Inject init segment on first chunk or quality switch ─────────
        if (isFirstChunk || qualityChanged) {
            const videoInitBuf = await fetchSegment(buildInitUrl(chosen.folder))
                .catch(() => null);
            if (videoInitBuf) await pushTo(videoSB, videoInitBuf);
            if (isFirstChunk) {
                const audioInitBuf = await fetchSegment(buildInitUrl('audio'))
                    .catch(() => null);
                if (audioInitBuf) await pushTo(audioSB, audioInitBuf);
            }
        }

        // ── 3. Track quality switch direction ─────────────────────────────────
        if (qualityChanged && !isFirstChunk) {
            const prevIdx = QUALITY_LEVELS.findIndex(q => q.folder === prevFolder);
            const nextIdx = QUALITY_LEVELS.findIndex(q => q.folder === chosen.folder);
            state.previousQuality = prevFolder;
            state.qualitySwitches++;
            state.lastDecision = nextIdx > prevIdx ? 'UP' : 'DOWN';
        } else {
            state.lastDecision = 'HOLD';
        }
        state.currentQuality = chosen.folder;

        // ── 4. Fetch media chunk with deadline abort ────────────────────────────
        // If the download takes longer than 80% of the current buffer level
        // (min 3 s), we would stall before the chunk arrives — so abort early,
        // slam the EMA estimate down, and let the next timeupdate cycle retry
        // at the lower quality tier selectQuality() will now choose.
        const deadlineMs = Math.max(state.bufferLevelSeconds * 800, 3000);
        isDeadlineAbort  = false;
        fetchController  = new AbortController();
        const abortTimer = setTimeout(() => {
            isDeadlineAbort = true;
            fetchController?.abort();
        }, deadlineMs);

        const url = buildChunkUrl(state.currentQuality, state.currentIndex);
        let buffer, rawMbps;
        try {
            ({ buffer, rawMbps } = await fetchAndMeasure(url, fetchController.signal));
        } finally {
            clearTimeout(abortTimer);
            fetchController = null;
        }

        // ── 5. Push to MSE decoders ───────────────────────────────────────────
        await pushTo(videoSB, buffer);
        // ── 5b. Fetch and push matching audio chunk ───────────────────────────
        // Wrapped in its own try/catch so an audio error (e.g. duplicate
        // timestamps after a proactive upgrade) never blocks the index increment.
        try {
            const audioBuf = await fetchSegment(
                buildChunkUrl('audio', state.currentIndex)
            ).catch(() => null);
            if (audioBuf) await pushTo(audioSB, audioBuf);
        } catch (audioErr) {
            console.warn('[AUDIO] push skipped:', audioErr.message);
        }

        // ── 6. Update QoE state ───────────────────────────────────────────────
        const chunkVideoKbps = chosen.bitrateMbps * 1000;
        state.totalChunkKbpsSum += chunkVideoKbps;
        state.chunksDelivered++;

        // ── 7. Snapshot buffer level and write log row ────────────────────────
        state.bufferLevelSeconds = getBufferLevel();
        appendLogRow({
            index      : state.currentIndex,
            folder     : state.currentQuality,
            rawMbps,
            estMbps    : state.estimatedBandwidthMbps,
            bufferLevel: state.bufferLevelSeconds,
            decision   : state.lastDecision,
        });

        // ── 8. Advance to next chunk ──────────────────────────────────────────
        state.currentIndex++;

    } catch (err) {
        if (err.name === 'AbortError') {
            if (isDeadlineAbort) {
                state.estimatedBandwidthMbps = QUALITY_LEVELS[0].bitrateMbps * 0.5;
                console.warn('[ABR] Fetch aborted (deadline exceeded) — forced downgrade');
            }
        } else {
            console.error('[ABR FETCH ERROR]', err.message);
        }
        // Release lock either way so the timeupdate loop can retry
    }

    state.isFetching = false; // ← unlock

    // Self-continue: keep filling the buffer without waiting for the next timeupdate tick.
    if (state.isPlaying && state.currentIndex <= mpdInfo.totalChunks &&
        getBufferLevel() < BUFFER_HIGH_TARGET) {
        fetchNextChunk();
    }
}

// ── Buffer watcher → drives the fetch loop ────────────────────────────────────
// timeupdate fires every ~250 ms during playback — cheap to check.

video.addEventListener('timeupdate', () => {
    updateSeekBar();
    state.bufferLevelSeconds = getBufferLevel();
    if (
        state.bufferLevelSeconds < BUFFER_LOW_THRESHOLD &&
        !state.isFetching &&
        state.isPlaying
    ) {
        fetchNextChunk();
    }
});

// ── Stall detector ────────────────────────────────────────────────────────────
// 'waiting' fires when the browser runs out of buffered data mid-play.

video.addEventListener('waiting', () => {
    if (state.isPlaying) {
        state.stallEvents++;
        fetchNextChunk();
    }
});

// ── Telemetry ticker (1 Hz) ───────────────────────────────────────────────────
// Reads state + video element, then pushes values to all UI modules.

setInterval(() => {
    if (!state.isPlaying) return;

    state.bufferLevelSeconds = getBufferLevel();

    // Figure out exactly which quality tier is currently playing
    const quality = QUALITY_LEVELS.find(q => q.folder === state.currentQuality) ?? QUALITY_LEVELS[0];
    
    const avgKbps = state.chunksDelivered > 0
        ? Math.round(state.totalChunkKbpsSum / state.chunksDelivered)
        : 0;

    // Push the network EMA and the exact Video Bitrate to the chart!
    pushToChart(state.estimatedBandwidthMbps, state.lastRawMeasuredMbps);
    
    // Update the live active column on our PSNR benchmark graph
    highlightPsnrBar(quality.label);

    updateMetricPanel({
        bufferLevel      : state.bufferLevelSeconds,
        qualityLabel     : quality.label,
        currentSpeedKbps : Math.round(state.estimatedBandwidthMbps * 1000),
        currentPsnr      : quality.psnr
    });

    updateQoEPanel({
        switches: state.qualitySwitches,
        stalls  : state.stallEvents,
        avgKbps,
    });

}, TELEMETRY_INTERVAL_MS);

// ── Start button ──────────────────────────────────────────────────────────────

document.getElementById('startBtn').addEventListener('click', async () => {
    if (!videoSB) {
        console.warn('MediaSource not ready yet.');
        return;
    }

    // Reset state for a clean play session
    state.currentIndex             = 1;
    state.isFetching               = false;
    state.currentQuality           = 'low_res';
    state.previousQuality          = 'low_res';
    state.estimatedBandwidthMbps   = 0;
    state.lastRawMeasuredMbps      = 0;
    state.qualitySwitches          = 0;
    state.stallEvents              = 0;
    state.totalChunkKbpsSum        = 0;
    state.chunksDelivered          = 0;
    state.bufferLevelSeconds       = 0;
    state.lastDecision             = 'HOLD';
    state.isPlaying                = true;

    document.getElementById('startBtn').disabled = true;
    clearLog();

    // Seed the pipeline with the first chunk, then let timeupdate drive the rest
    await fetchNextChunk();
    video.play().catch(console.error);
});