const refreshButton = document.getElementById('refresh-button');
const connectionStatus = document.getElementById('connection-status');
const lastUpdated = document.getElementById('last-updated');
const errorMessage = document.getElementById('error-message');
const visitsTableBody = document.getElementById('visits-table-body');
const visitCount = document.getElementById('visit-count');

let isLoading = false;

const statusInfo = {
    PENDENTE: {
        label: 'Pendente',
        className: 'badge-pending',
    },
    EM_DESLOCAMENTO: {
        label: 'Em deslocamento',
        className: 'badge-travel',
    },
    EM_EXECUCAO: {
        label: 'Em andamento',
        className: 'badge-progress',
    },
    CONCLUIDA: {
        label: 'Concluída',
        className: 'badge-done',
    },
    IMPEDIMENTO: {
        label: 'Impedimento',
        className: 'badge-blocked',
    },
    CANCELADA: {
        label: 'Cancelada',
        className: 'badge-cancelled',
    },
};

function escapeHTML(value) {
    const caracteres = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };

    return String(value ?? '').replace(
        /[&<>"']/g,
        (caractere) => caracteres[caractere]
    );
}

function formatarNumero(value) {
    return Number(value ?? 0).toLocaleString('pt-BR');
}

function formatarDataHora(value) {
    if (!value) return '—';

    const data = new Date(value);

    if (Number.isNaN(data.getTime())) {
        return '—';
    }

    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(data);
}

function atualizarIndicadores(summary = {}) {
    document.getElementById('kpi-pending').textContent =
        formatarNumero(summary.pending);

    document.getElementById('kpi-progress').textContent =
        formatarNumero(summary.in_progress);

    document.getElementById('kpi-impediments').textContent =
        formatarNumero(summary.impediments);

    document.getElementById('kpi-completed').textContent =
        formatarNumero(summary.completed_today);

    document.getElementById('kpi-visits').textContent =
        formatarNumero(summary.active_visits);

    document.getElementById('kpi-analysts').textContent =
        formatarNumero(summary.active_analysts);
}

function obterIniciais(nome) {
    const palavras = String(nome ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (palavras.length === 0) return '?';

    return palavras
        .slice(0, 2)
        .map((palavra) => palavra.charAt(0))
        .join('')
        .toUpperCase();
}

function renderizarAtividade(atividade) {
    const status = statusInfo[atividade.activity_status] ?? {
        label: atividade.activity_status ?? 'Desconhecido',
        className: 'badge-cancelled',
    };

    const descricao = atividade.activity_description
        ? `<small class="activity-description">${escapeHTML(atividade.activity_description)}</small>`
        : '';

    return `
        <div class="activity-item">
            <span class="activity-title">
                ${escapeHTML(atividade.activity_title || 'Atividade sem título')}
            </span>

            ${descricao}

            <span class="badge ${status.className}">
                ${escapeHTML(status.label)}
            </span>
        </div>
    `;
}

function renderizarVisitas(linhas = []) {
    const visitas = new Map();

    for (const linha of linhas) {
        const chave = String(linha.visit_id);

        if (!visitas.has(chave)) {
            visitas.set(chave, {
                visit_id: linha.visit_id,
                analyst_name: linha.analyst_name,
                unit_name: linha.unit_name,
                city: linha.city,
                check_in_at: linha.check_in_at,
                activities: [],
            });
        }

        if (linha.activity_id !== null && linha.activity_id !== undefined) {
            visitas.get(chave).activities.push(linha);
        }
    }

    const lista = [...visitas.values()];

    visitCount.textContent =
        `${lista.length} ${lista.length === 1 ? 'visita' : 'visitas'}`;

    if (lista.length === 0) {
        visitsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    Nenhuma visita aberta no momento.
                </td>
            </tr>
        `;
        return;
    }

    visitsTableBody.innerHTML = lista.map((visita) => {
        const nomeAnalista = visita.analyst_name || 'Analista não identificado';
        const unidade = visita.unit_name || 'Unidade sem nome';

        const cidade = visita.city
            ? `<small>${escapeHTML(visita.city)}</small>`
            : '';

        const atividades = visita.activities.length > 0
            ? visita.activities.map(renderizarAtividade).join('')
            : '<span class="no-activities">Nenhuma atividade cadastrada.</span>';

        return `
            <tr>
                <td>
                    <div class="person-cell">
                        <span class="avatar">
                            ${escapeHTML(obterIniciais(nomeAnalista))}
                        </span>

                        <div>
                            <strong>${escapeHTML(nomeAnalista)}</strong>
                            <small>Visita #${escapeHTML(visita.visit_id)}</small>
                        </div>
                    </div>
                </td>

                <td>
                    <div class="unit-cell">
                        <strong>${escapeHTML(unidade)}</strong>
                        ${cidade}
                    </div>
                </td>

                <td class="checkin-cell">
                    ${escapeHTML(formatarDataHora(visita.check_in_at))}
                </td>

                <td>
                    <div class="activity-list">
                        ${atividades}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function carregarDashboard() {
    if (isLoading) return;

    isLoading = true;
    refreshButton.disabled = true;
    connectionStatus.textContent = 'Atualizando...';
    connectionStatus.className = 'connection-status';

    try {
        const response = await fetch('/api/dashboard', {
            headers: {
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`A API respondeu com status ${response.status}.`);
        }

        const data = await response.json();

        atualizarIndicadores(data.summary);
        renderizarVisitas(data.activeVisits);

        errorMessage.hidden = true;
        connectionStatus.textContent = 'Conectado';
        connectionStatus.className = 'connection-status';

        lastUpdated.textContent = formatarDataHora(new Date().toISOString());
    } catch (error) {
        console.error('Erro ao carregar dashboard:', error);

        connectionStatus.textContent = 'Sem conexão';
        connectionStatus.className = 'connection-status offline';

        errorMessage.textContent =
            'Não foi possível atualizar o dashboard. Verifique se o servidor está ligado.';
        errorMessage.hidden = false;
    } finally {
        refreshButton.disabled = false;
        isLoading = false;
    }
}

refreshButton.addEventListener('click', carregarDashboard);

// Atualiza os dados automaticamente a cada 15 segundos.
carregarDashboard();
setInterval(carregarDashboard, 15000);