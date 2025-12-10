const socket = new WebSocket(`ws://${window.location.host}/ws/metrics`);
const tableBody = document.getElementById('procBody');
const auditList = document.getElementById('audit-list');

function switchTab(tab) {
    const navPerf = document.getElementById('nav-perf');
    
    const navProc = document.getElementById('nav-proc');
    const viewPerf = document.getElementById('view-perf');
    const viewProc = document.getElementById('view-proc');


    if (tab === 'perf') {
        navPerf.classList.add('active');
        navProc.classList.remove('active');
        viewPerf.classList.remove('hidden-view');
        viewProc.classList.add('hidden-view');
    } else {
        navPerf.classList.remove('active');
        navProc.classList.add('active');
        viewPerf.classList.add('hidden-view');
        viewProc.classList.remove('hidden-view');
    }
}

Chart.defaults.color = '#64748b'; 
Chart.defaults.font.family = "'Inter', sans-serif";

const ctx = document.getElementById('sysChart').getContext('2d');
const gradientCpu = ctx.createLinearGradient(0, 0, 0, 400);
gradientCpu.addColorStop(0, 'rgba(37, 99, 235, 0.2)');
gradientCpu.addColorStop(1, 'rgba(37, 99, 235, 0)');

const sysChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'CPU Load',
            borderColor: '#2563eb',
            backgroundColor: gradientCpu,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            data: [],
            tension: 0.3,
            fill: true
        }, {
            label: 'Memory',
            borderColor: '#10b981',
            borderWidth: 2,
            pointRadius: 0,
            borderDash: [5, 5],
            data: [],
            tension: 0.3,
            fill: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
            legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } },
            tooltip: { backgroundColor: '#1e293b', padding: 10 }
        },
        scales: {
            y: { beginAtZero: true, max: 100, grid: { color: '#e2e8f0', drawBorder: false } },
            x: { grid: { display: false } }
        }
    }
});

socket.onmessage = function(event) {
    const data = JSON.parse(event.data);
    updateDashboard(data);
};

function updateDashboard(data) {
    document.getElementById('cpu-val').innerText = `${data.system.cpu_percent}%`;
    document.getElementById('mem-val').innerText = `${data.system.mem_percent}%`;
    document.getElementById('disk-val').innerText = `${data.system.disk_percent}%`;
    document.getElementById('net-down').innerText = data.system.net_recv_speed;
    document.getElementById('net-up').innerText = data.system.net_sent_speed;
    
    const cpuEl = document.getElementById('cpu-val');
    if(data.system.cpu_percent > 80) cpuEl.style.color = '#ef4444';
    else cpuEl.style.color = '#2563eb';

    const statusEl = document.querySelector('.status-indicator');
    if(statusEl) statusEl.innerHTML = `<span class="dot"></span> Uptime: ${data.system.uptime}`;

    const timeLabel = data.system.ts;
    if (sysChart.data.labels.length > 50) {
        sysChart.data.labels.shift();
        sysChart.data.datasets[0].data.shift();
        sysChart.data.datasets[1].data.shift();
    }
    sysChart.data.labels.push(timeLabel);
    sysChart.data.datasets[0].data.push(data.system.cpu_percent);
    sysChart.data.datasets[1].data.push(data.system.mem_percent);
    sysChart.update();

    renderTable(data.processes);
}

let currentProcesses = [];

function renderTable(processes) {
    currentProcesses = processes;
    const filter = document.getElementById('search').value.toLowerCase();
    
    const html = processes
        .filter(p => p.name.toLowerCase().includes(filter) || p.pid.toString().includes(filter))
        .map(p => {
            const rowStyle = p.cpu > 50 ? 'style="background: #fef2f2;"' : '';
            return `
            <tr ${rowStyle}>
                <td><span class="pid-badge">${p.pid}</span></td>
                <td style="font-weight: 500;">${p.name}</td>
                <td style="${p.cpu > 50 ? 'color:#ef4444; font-weight:700;' : ''}">${p.cpu}%</td>
                <td>${p.mem} MB</td>
                <td><span class="cmd-text" title="${p.cmd}">${p.cmd || '-'}</span></td>
                <td>
                    <button class="btn-term" onclick="killProcess(${p.pid})">
                        <i class="ph-bold ph-skull"></i> Kill
                    </button>
                </td>
            </tr>
        `}).join('');
    tableBody.innerHTML = html;
}

function filterTable() {
    renderTable(currentProcesses);
}

async function killProcess(pid) {
    if(!confirm(`⚠️ WARNING: Are you sure you want to terminate PID ${pid}?`)) return;
    
    try {
        const res = await fetch(`/api/process/${pid}/terminate`, { method: 'POST' });
        if(res.ok) {
            const entry = await res.json();
            addAuditLogToUI(entry);
        } else {
            alert("Failed to terminate. (Access Denied)");
        }
    } catch(err) {
        console.error(err);
    }
}

function addAuditLogToUI(entry) {
    const li = document.createElement('li');
    li.style.borderLeftColor = '#ef4444'; 
    li.innerHTML = `
        <span class="audit-time">${entry.timestamp.split('T')[1].split('.')[0]}</span>
        <span class="audit-action" style="color:#ef4444;">Terminated PID ${entry.pid}</span>
    `;
    
    const emptyMsg = document.querySelector('.empty-state');
    if(emptyMsg) emptyMsg.remove();
    
    auditList.prepend(li);
}

async function downloadLog() {
    try {
        const res = await fetch('/api/audit');
        const data = await res.json();
        
        if (!data || data.length === 0) {
            alert("Audit log is empty.");
            return;
        }

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_log_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert("Error downloading log: " + err);
    }
}

async function loadInitialAudit() {
    try {
        const res = await fetch('/api/audit');
        const logs = await res.json();
        logs.forEach(entry => {
            addAuditLogToUI(entry);
        });
    } catch (err) {
        console.error("Could not load audit history", err);
    }
}

loadInitialAudit();