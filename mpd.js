// mpd.js — Minimal MPEG-DASH MPD manifest parser.
//
// Extracts only what the ABR engine needs:
//   totalChunks     — number of media segments in the SegmentTimeline
//   segmentDuration — nominal duration of each segment (seconds)
//   totalDuration   — total presentation duration (seconds)
//   codecs          — codec string from the first Representation element
//   mimeType        — mimeType from the first Representation element
//
// Falls back to a safe default object if the fetch or parse fails.

export async function parseMpd(url) {
    const text = await fetch(url).then(r => {
        if (!r.ok) throw new Error(`MPD fetch failed: ${r.status}`);
        return r.text();
    });

    const doc = new DOMParser().parseFromString(text, 'text/xml');

    // ── Total presentation duration ───────────────────────────────────────────
    const mpdEl       = doc.querySelector('MPD');
    const totalDuration = parseIsoDuration(
        mpdEl?.getAttribute('mediaPresentationDuration') || 'PT0S'
    );

    // ── Timescale from SegmentTemplate ────────────────────────────────────────
    const segTemplate = doc.querySelector('SegmentTemplate');
    const timescale   = parseInt(segTemplate?.getAttribute('timescale') || '15360', 10);

    // ── Count segments from SegmentTimeline ───────────────────────────────────
    // DASH spec: <S d="…" r="N" /> means (r + 1) consecutive segments of that
    // duration. A missing r attribute means a single segment (r = 0 implied).
    let totalChunks     = 0;
    let segmentDuration = 2; // fallback in case timeline is empty
    doc.querySelectorAll('SegmentTimeline S').forEach(s => {
        const rAttr = s.getAttribute('r');
        const count = rAttr !== null ? parseInt(rAttr, 10) + 1 : 1;
        totalChunks += count;

        const d = parseInt(s.getAttribute('d') || '0', 10);
        if (d > 0 && segmentDuration === 2) {
            // Use the first segment's duration as the nominal segment duration.
            segmentDuration = d / timescale;
        }
    });

    // ── Codec + MIME type from the first Representation ───────────────────────
    // After audio re-encode the MPD will carry e.g. "avc1.640015, mp4a.40.2"
    // automatically — no code change needed.
    const repr     = doc.querySelector('Representation');
    const codecs   = repr?.getAttribute('codecs')   || 'avc1.4d401f';
    const mimeType = repr?.getAttribute('mimeType') || 'video/mp4';

    return { totalChunks, segmentDuration, totalDuration, codecs, mimeType };
}

// ── ISO 8601 duration → seconds ───────────────────────────────────────────────
// Handles the subset produced by ffmpeg -f dash: PT[H]H[M]M[S]S
function parseIsoDuration(iso) {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
    if (!m) return 0;
    return (parseFloat(m[1] || 0) * 3600)
         + (parseFloat(m[2] || 0) * 60)
         +  parseFloat(m[3] || 0);
}
