// ui.js — All DOM mutations live here.
//
// Exports:
//   pushToChart(bandwidthMbps, rawSpeedMbps)
//   updateMetricPanel({ bufferLevel, qualityLabel, droppedFrames })
//   updateQoEPanel({ switches, stalls, avgKbps })
//   appendLogRow({ index, folder, rawMbps, estMbps, bufferLevel, decision })
//   clearLog()
//
// script.js calls these functions; it never touches the DOM directly.

// ── Chart.js setup ────────────────────────────────────────────────────────────

const MAX_CHART_POINTS = 60;   // 60 seconds of history at 1 Hz

const chart = new Chart(
    document.getElementById('telemetryChart').getContext('2d'),
    {
        type: 'line',
        data: {
            labels: Array(MAX_CHART_POINTS).fill(''),
            datasets: [
                {
                    label: 'Network Bandwidth (Mbps)',
                    borderColor: '#4ade80', // Green
                    backgroundColor: 'rgba(74, 222, 128, 0.08)',
                    data: Array(MAX_CHART_POINTS).fill(null),
                    fill: true,
                    tension: 0.35, // Smooth curves for organic network speed
                    pointRadius: 0,
                    borderWidth: 2,
                },
                {
                    label: 'Video Bitrate (Mbps)',
                    borderColor: '#a855f7', // Purple
                    backgroundColor: 'rgba(168, 85, 247, 0.08)',
                    data: Array(MAX_CHART_POINTS).fill(null),
                    fill: true,
                    stepped: true, // Creates strict "steps" because video tiers are exact!
                    pointRadius: 0,
                    borderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 3, // HARD LIMIT: The graph will never scale higher than 3 Mbps
                    ticks: { 
                        color: '#555', 
                        callback: v => v.toFixed(1) + ' M',
                        stepSize: 0.5 // Forces clean grid lines every 500k
                    },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
                x: { display: false },
            },
            plugins: {
                legend: { labels: { color: '#333', usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3)} Mbps`,
                    },
                },
            },
        },
    }
);

// ── Chart updater ─────────────────────────────────────────────────────────────
export function pushToChart(networkMbps, videoMbps) {
    chart.data.datasets[0].data.shift();
    chart.data.datasets[0].data.push(networkMbps > 0 ? +networkMbps.toFixed(3) : null);

    chart.data.datasets[1].data.shift();
    chart.data.datasets[1].data.push(videoMbps > 0 ? +videoMbps.toFixed(3) : null);

    chart.update('none'); 
}

// ── Metric panel ─────────────────────────────────────────────────────────────
// Updates the three live metric cards: Buffer Level, Quality, Dropped Frames.

export function updateMetricPanel({ bufferLevel, qualityLabel, currentSpeedKbps }) {
    document.getElementById('m-buffer').innerText   = `${bufferLevel.toFixed(1)} s`;
    document.getElementById('m-quality').innerText  = qualityLabel;
    document.getElementById('m-speed').innerText    = `${currentSpeedKbps} kbps`;
}

// ── QoE panel ─────────────────────────────────────────────────────────────────

export function updateQoEPanel({ switches, stalls, avgKbps }) {
    document.getElementById('q-switches').innerText = switches;
    document.getElementById('q-stalls').innerText   = stalls;
    document.getElementById('q-avgbr').innerText    = `${avgKbps} kbps`;
}

// ── Rolling log table ─────────────────────────────────────────────────────────
// Newest row at the top. Capped at MAX_LOG_ROWS to avoid DOM bloat.

const MAX_LOG_ROWS = 100;

export function appendLogRow({ index, folder, rawMbps, estMbps, bufferLevel, decision }) {
    const tbody = document.getElementById('logBody');

    const decisionColor =
        decision === 'UP'   ? '#16a34a' :
        decision === 'DOWN' ? '#dc2626' :
                              '#888';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${new Date().toLocaleTimeString()}</td>
        <td>${index}</td>
        <td>${folder}</td>
        <td>${rawMbps.toFixed(3)}</td>
        <td>${estMbps.toFixed(3)}</td>
        <td>${bufferLevel.toFixed(1)}</td>
        <td style="color:${decisionColor};font-weight:bold">${decision}</td>
    `;

    tbody.insertBefore(row, tbody.firstChild);

    // Trim old rows
    while (tbody.rows.length > MAX_LOG_ROWS) {
        tbody.deleteRow(tbody.rows.length - 1);
    }
}

export function clearLog() {
    document.getElementById('logBody').innerHTML = '';
}
