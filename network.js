// network.js — URL construction and raw binary fetching.
//
// This module has NO side-effects on state.
// It only builds URLs and returns raw ArrayBuffers.
// Bandwidth accounting happens in bandwidthCal.js (one layer up).

// ── URL builders ─────────────────────────────────────────────────────────────

export function buildChunkUrl(qualityFolder, index) {
    return `${qualityFolder}/chunk_${index}.m4s`;
}

export function buildInitUrl(qualityFolder) {
    return `${qualityFolder}/init.mp4`;
}

// ── Raw fetch ─────────────────────────────────────────────────────────────────
// cache: 'no-store' forces the request through the network on every call,
// which is essential for accurate bandwidth measurement and throttling.

export async function fetchSegment(url, signal) {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching: ${url}`);
    }
    return response.arrayBuffer();
}
