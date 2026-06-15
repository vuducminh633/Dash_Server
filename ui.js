// ui.js — All DOM mutations live here.
import { QUALITY_LEVELS } from './config.js';

const MAX_CHART_POINTS = 60;   // 60 seconds of history at 1 Hz

// ── Chart 1: Telemetry Chart Setup ───────────────────────────────────────────
const chartContext = document.getElementById('telemetryChart').getContext('2d');
const telemetryChart = new Chart(chartContext, {
    type: 'line',
    data: {
        labels: Array(MAX_CHART_POINTS).fill(''),
        datasets: [
            {
                label: 'EMA Bandwidth Estimate (Mbps)',
                borderColor: '#4ade80',
                backgroundColor: 'rgba(74, 222, 128, 0.08)',
                data: Array(MAX_CHART_POINTS).fill(null),
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                borderWidth: 2,
            },
            {
                label: 'Last Chunk Speed (Mbps)',
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.08)',
                data: Array(MAX_CHART_POINTS).fill(null),
                fill: true,
                tension: 0.1,
                pointRadius: 4,
                borderWidth: 1.5,
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
                suggestedMax: 6,
                ticks: { color: '#555', callback: v => v.toFixed(1) + ' M' },
                grid: { color: 'rgba(0,0,0,0.06)' },
            },
            x: { display: false },
        },
        plugins: {
            legend: { labels: { color: '#333', usePointStyle: true } },
        },
    }
});

// ── Chart 2: Objective PSNR Bar Chart Setup ──────────────────────────────────
const psnrLabels = QUALITY_LEVELS.map(q => q.label);
const psnrValues = QUALITY_LEVELS.map(q => q.psnr);

const psnrContext = document.getElementById('psnrChart').getContext('2d');
const psnrChart = new Chart(psnrContext, {
    type: 'bar',
    data: {
        labels: psnrLabels,
        datasets: [{
            label: 'Peak Signal-to-Noise Ratio (dB)',
            data: psnrValues,
            backgroundColor: Array(QUALITY_LEVELS.length).fill('rgba(148, 163, 184, 0.3)'), 
            borderColor: Array(QUALITY_LEVELS.length).fill('#94a3b8'),
            borderWidth: 1.5,
            barPercentage: 0.6
        }]
    },
    options: {
        responsive: true,
        animation: false,
        scales: {
            y: {
                min: 20, // PSNR under 20 is completely broken quality
                max: 50,
                ticks: { callback: v => v + ' dB', color: '#555' },
                grid: { color: 'rgba(0,0,0,0.06)' }
            },
            x: { ticks: { color: '#333' } }
        },
        plugins: {
            legend: { display: false }
        }
    }
});

export function pushToChart(bandwidthMbps, rawSpeedMbps) {
    telemetryChart.data.datasets[0].data.shift();
    telemetryChart.data.datasets[0].data.push(+bandwidthMbps.toFixed(3));

    telemetryChart.data.datasets[1].data.shift();
    telemetryChart.data.datasets[1].data.push(rawSpeedMbps > 0 ? +rawSpeedMbps.toFixed(3) : null);

    telemetryChart.update('none');
}

// Highlights the active ABR selection on the bar chart layout
export function highlightPsnrBar(activeLabel) {
    const activeIndex = QUALITY_LEVELS.findIndex(q => q.label === activeLabel);
    
    const bgColors = Array(QUALITY_LEVELS.length).fill('rgba(148, 163, 184, 0.2)');
    const borderColors = Array(QUALITY_LEVELS.length).fill('#94a3b8');

    if (activeIndex !== -1) {
        bgColors[activeIndex] = 'rgba(37, 99, 235, 0.75)';  // High visibility engine blue
        borderColors[activeIndex] = '#2563eb';
    }

    psnrChart.data.datasets[0].backgroundColor = bgColors;
    psnrChart.data.datasets[0].borderColor = borderColors;
    psnrChart.update('none');
}

export function updateMetricPanel({ bufferLevel, qualityLabel, currentSpeedKbps, currentPsnr }) {
    document.getElementById('m-buffer').innerText  = `${bufferLevel.toFixed(1)} s`;
    document.getElementById('m-quality').innerText = qualityLabel;
    document.getElementById('m-speed').innerText   = `${currentSpeedKbps} kbps`;
    document.getElementById('m-psnr').innerText    = `${currentPsnr.toFixed(2)} dB`;
}

export function updateQoEPanel({ switches, stalls, avgKbps }) {
    document.getElementById('q-switches').innerText = switches;
    document.getElementById('q-stalls').innerText   = stalls;
    document.getElementById('q-avgbr').innerText    = `${avgKbps} kbps`;
}

export function appendLogRow({ index, folder, rawMbps, estMbps, bufferLevel, decision }) {
    const tbody = document.getElementById('logBody');
    const decisionColor = decision === 'UP' ? '#16a34a' : decision === 'DOWN' ? '#dc2626' : '#888';

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

    while (tbody.rows.length > MAX_LOG_ROWS) {
        tbody.deleteRow(tbody.rows.length - 1);
    }
}

const MAX_LOG_ROWS = 100;
export function clearLog() {
    document.getElementById('logBody').innerHTML = '';
}