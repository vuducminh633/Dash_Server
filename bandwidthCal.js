// bandwidthCal.js — Fetch a media segment, measure real throughput,
// and update the shared EMA bandwidth estimate in state.
//
// Data flow:
//   fetchAndMeasure(url)
//     └─ fetchSegment(url)          [network.js]  — raw binary download
//     └─ measure elapsed time       [performance.now]
//     └─ update state.estimatedBandwidthMbps  [asymmetric EMA]
//     └─ return { buffer, rawMbps } [to script.js core loop]

import { EMA_ALPHA_DOWN, EMA_ALPHA_UP } from './config.js';
import { state } from './state.js';
import { fetchSegment } from './network.js';

/**
 * Downloads a segment, measures its real throughput, and feeds the result
 * into an asymmetric EMA filter stored in state.
 *
 * Asymmetric EMA:
 *   - Fast alpha (0.5) when speed DROPS  → react immediately to congestion
 *   - Slow alpha (0.15) when speed RISES → avoid over-committing on a burst
 *
 * @param {string} url
 * @returns {Promise<{ buffer: ArrayBuffer, rawMbps: number }>}
 */
export async function fetchAndMeasure(url, signal) {
    const t0     = performance.now();
    const buffer = await fetchSegment(url, signal);
    const t1     = performance.now();

    const durationSec = Math.max((t1 - t0) / 1000, 0.001); // guard div/0
    const rawMbps     = (buffer.byteLength * 8) / durationSec / 1_000_000;

    // ── Update EMA estimate ───────────────────────────────────────────────────
    if (state.estimatedBandwidthMbps === 0) {
        // Cold start: seed the filter directly with the first measurement
        state.estimatedBandwidthMbps = rawMbps;
    } else {
        const alpha = rawMbps < state.estimatedBandwidthMbps
            ? EMA_ALPHA_DOWN   // network got worse  → react fast
            : EMA_ALPHA_UP;    // network got better → rise slowly

        state.estimatedBandwidthMbps =
            alpha * rawMbps + (1 - alpha) * state.estimatedBandwidthMbps;
    }

    state.lastRawMeasuredMbps = rawMbps;

    console.log(
        `[RADAR] ${url} | raw: ${rawMbps.toFixed(2)} Mbps | ` +
        `EMA: ${state.estimatedBandwidthMbps.toFixed(2)} Mbps`
    );

    return { buffer, rawMbps };
}