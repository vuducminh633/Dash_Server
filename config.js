// config.js — ABR constants and quality tier definitions

// Quality tiers ordered lowest → highest.
// bitrateMbps is the MAXIMUM expected encoding bitrate of that tier.
// The ABR engine picks the highest tier whose bitrateMbps fits within
// the safe bandwidth budget (estimatedBandwidth * SAFETY_MARGIN).
export const QUALITY_LEVELS = [
    { folder: 'very_low_res', bitrateMbps: 0.08,  label: '144p',  psnr: 29.81 },
    { folder: 'low_res',      bitrateMbps: 0.254, label: '240p',  psnr: 32.03 },
    { folder: 'mid_res',      bitrateMbps: 0.76,  label: '480p',  psnr: 35.32 },
    { folder: 'high_res',     bitrateMbps: 1.884, label: '720p',  psnr: 38.97 },
    { folder: 'ultra_res',    bitrateMbps: 4.953, label: '1080p', psnr: 45.61 },
];

export const TOTAL_CHUNKS = 64; // fallback only, MPD parsing overrides this

// Fraction of estimated bandwidth the ABR engine is allowed to use.
// 0.75 = leave 25% headroom to absorb measurement noise.
export const SAFETY_MARGIN = 0.75;

// Fetch more chunks when buffered play-time drops below this threshold (seconds).
export const BUFFER_LOW_THRESHOLD = 4;

// Stop fetching once the buffer is this full (seconds).
// Kept intentionally short (8 s) so that when the connection improves,
// the player only has to play through ~4 s of old low-quality content
// before it can start fetching at the new higher quality.
export const BUFFER_HIGH_TARGET = 8;

// Asymmetric EMA weights for bandwidth estimation.
// Drop fast (high alpha), rise slowly (low alpha) — conservative ABR behaviour.
export const EMA_ALPHA_DOWN = 0.5;
export const EMA_ALPHA_UP   = 0.15;

// How often the telemetry ticker refreshes the dashboard (ms).
export const TELEMETRY_INTERVAL_MS = 1000;

// ABR algorithm selection.
// Mutate .mode at runtime to switch algorithms on the fly.
//   'throughput' — classic bandwidth-based (EMA estimate × SAFETY_MARGIN)
//   'bola'       — buffer-based (log-scale interpolation on buffer fill level)
//   'hybrid'     — conservative: takes the lower-quality pick of the two
export const abrConfig = { mode: 'throughput' };
