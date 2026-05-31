// state.js — Single mutable state object shared across all modules.
//
// Import and mutate state.X directly in any module.
// No getters/setters needed — JS module scope keeps this safe.

export const state = {

    // ── Streaming core ────────────────────────────────────────────────────────
    currentIndex    : 1,       // Next chunk index to fetch (1-based)
    isFetching      : false,   // Mutex: prevents concurrent fetches
    currentQuality  : 'low_res',
    previousQuality : 'low_res',
    isPlaying       : false,
    lastDecision    : 'HOLD',  // 'UP' | 'DOWN' | 'HOLD' — for log column

    // ── Bandwidth estimation ─────────────────────────────────────────────────
    // Updated by bandwidthCal.js after every chunk download.
    estimatedBandwidthMbps : 0,   // EMA-smoothed estimate
    lastRawMeasuredMbps    : 0,   // Most recent single-chunk measurement

    // ── QoE (Quality of Experience) tracking ─────────────────────────────────
    qualitySwitches   : 0,
    stallEvents       : 0,
    totalChunkKbpsSum : 0,    // Running sum for avg bitrate calculation
    chunksDelivered   : 0,

    // ── Buffer ────────────────────────────────────────────────────────────────
    bufferLevelSeconds : 0,   // Updated before every log row and in telemetry tick

};
