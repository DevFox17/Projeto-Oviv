'use strict';

/*
 * Oviv — frontend integrado à API e ao PostgreSQL.
 *
 * A identidade real do analista depende do login.
 * Para testes locais, caso não exista sessão, pedimos o ID
 * de um usuário ativo com perfil ANALISTA no banco.
 */

const API_BASE = '/api/oviv';
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_API_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_ROWS_PER_REQUEST = 10000;

const PROJECT_ICONS = {
    copasa: 'C',
    cemig: 'E',
    'banco-brasil': 'B'
};

const STATUS = {
    PENDENTE: {
        label: 'Pendente',
        css: 'status-pending'
    },
    CONTATANDO_TECNICO: {
        label: 'Contatando técnico',
        css: 'status-stage'
    },
    INICIANDO_CONFIGURACAO: {
        label: 'Iniciando configuração',
        css: 'status-configuring'
    },
    FINALIZANDO_CONFIGURACAO: {
        label: 'Finalizando configuração',
        css: 'status-configuring'
    },
    TESTES_FINAIS: {
        label: 'Realizando testes finais',
        css: 'status-stage'
    },
    ATIVIDADE_MIGRADA: {
        label: 'Atividade migrada',
        css: 'status-completed'
    },
    IMPEDIMENTO: {
        label: 'Impedimento',
        css: 'status-blocked'
    },
    CANCELADA: {
        label: 'Cancelada',
        css: 'status-cancelled'
    },

    // Compatibilidade com registros antigos.
    EM_CONFIGURACAO: {
        label: 'Em configuração',
        css: 'status-configuring'
    },
    CONCLUIDA: {
        label: 'Concluída',
        css: 'status-completed'
    }
};

const WORKFLOW_STATUSES = [
    'CONTATANDO_TECNICO',
    'INICIANDO_CONFIGURACAO',
    'FINALIZANDO_CONFIGURACAO',
    'TESTES_FINAIS',
    'IMPEDIMENTO',
    'ATIVIDADE_MIGRADA',
    'CANCELADA'
];

const FINAL_STATUSES = new Set([
    'ATIVIDADE_MIGRADA',
    'CONCLUIDA',
    'CANCELADA'
]);

const $ = (selector, root = document) =>
    root.querySelector(selector);

const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

let toastTimer = null;
let currentProjectId = null;
let currentProjects = [];
let currentActivities = [];
let currentHistory = [];
let pendingImport = null;
let currentView = 'projects';
let isRefreshing = false;
let authenticatedUser = null;
let analystsCache = [];
let assigningActivityId = null;


/* =========================================================
   1. COMUNICAÇÃO COM A API
========================================================= */

async function apiRequest(path, options = {}) {
    let response;

    try {
        response = await fetch(`${API_BASE}${path}`, {
            ...options,
            credentials: 'same-origin',
            headers: {
                ...(options.body
                    ? { 'Content-Type': 'application/json' }
                    : {}),
                ...(options.headers || {})
            }
        });
    } catch (error) {
        throw new Error(
            'Não foi possível conectar à API. Confirme se o npm start continua em execução.'
        );
    }

    let payload = null;

    const contentType =
        response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        payload = await response.json().catch(() => null);
    } else {
        const bodyText = await response.text().catch(() => '');

        payload = bodyText
            ? { message: bodyText }
            : null;
    }

    if (!response.ok) {
        const error = new Error(
            payload?.message ||
            `A API retornou o erro HTTP ${response.status}.`
        );

        error.status = response.status;
        error.payload = payload;

        throw error;
    }

    return payload;
}

function apiJson(method, body) {
    return {
        method,
        body: JSON.stringify(body)
    };
}


/* =========================================================
   IDENTIDADE OBTIDA DA SESSÃO AUTENTICADA
========================================================= */

function getLoggedUserId() {
    return authenticatedUser?.id
        ? Number(authenticatedUser.id)
        : null;
}

function getLoggedUserName() {
    return authenticatedUser?.name || '';
}

function isManagerUser() {
    const role = String(
        authenticatedUser?.role || ''
    ).trim().toUpperCase();

    return [
        'GP',
        'GESTOR',
        'GERENTE',
        'GERENTE DE PROJETO',
        'ADMIN',
        'ADMINISTRADOR'
    ].includes(role);
}

function isAnalystUser() {
    return (
        String(authenticatedUser?.role || '')
            .trim()
            .toUpperCase() === 'ANALISTA'
    );
}

function refreshUserLabel() {
    const label = $('#current-user-label');

    if (!label) return;

    if (!authenticatedUser) {
        label.textContent = 'Não autenticado';
        return;
    }

    const roleLabel = isManagerUser()
        ? 'Gestor'
        : 'Analista';

    label.textContent =
        `${authenticatedUser.name} · ${roleLabel}`;
}

/* =========================================================
   3. AVISOS DA INTERFACE
========================================================= */
function setBackendNotice(connected, errorMessage = '') {
    const badge = $('.demo-badge');
    const notice = $('.demo-notice');

    if (badge) {
        badge.textContent = connected
            ? 'API + POSTGRESQL'
            : 'API DESCONECTADA';
    }

    if (notice) {
        notice.innerHTML = connected
            ? '<strong>Sessão autenticada.</strong> Os dados são compartilhados pelo servidor. As permissões de gestor e analista são verificadas pela API.'
            : `<strong>Falha na conexão.</strong> ${esc(errorMessage || 'Verifique se o servidor está funcionando.')}`;
    }

    const importSubtitle =
        $('#view-import .page-heading .subtitle');

    if (importSubtitle) {
        importSubtitle.textContent =
            'O arquivo é lido no navegador e suas linhas são enviadas à API para armazenamento no PostgreSQL.';
    }

    const privacyNote =
        $('#view-import .privacy-note');

    if (privacyNote) {
        privacyNote.innerHTML =
            '<strong>Privacidade:</strong> somente os dados extraídos da planilha são enviados ao servidor. Importe apenas informações autorizadas pela empresa.';
    }

    const warningNote =
        $('#view-import .warning-note');

    if (warningNote) {
        warningNote.textContent =
            'Confira o projeto e a prévia antes de confirmar a importação. As operações serão compartilhadas com os usuários autorizados.';
    }

    const historyWarning = $('.history-warning');

    if (historyWarning) {
        historyWarning.textContent =
            'Histórico carregado do PostgreSQL. Os registros são compartilhados entre os usuários do sistema.';
    }

    const importEyebrow =
        $('#view-import .eyebrow');

    if (importEyebrow) {
        importEyebrow.textContent =
            'IMPORTAÇÃO PARA O SERVIDOR';
    }
}


/* =========================================================
   4. NORMALIZAÇÃO DOS DADOS VINDOS DO POSTGRESQL
========================================================= */

function normalizeProject(project) {
    return {
        id: String(project.id),
        name: project.name || project.id,
        description: project.description || '',
        icon: PROJECT_ICONS[project.id] ||
            String(project.name || 'O').slice(0, 1),

        total: Number(project.total || 0),
        pending: Number(project.pending || 0),
        adopted: Number(project.adopted || 0),
        inProgress: Number(project.in_progress || 0),
        completed: Number(project.completed || 0),
        blocked: Number(project.blocked || 0),
        activeSeconds: Number(project.active_seconds || 0)
    };
}

function normalizeActivity(row) {
    const rawData =
        row.source_row &&
            typeof row.source_row === 'object'
            ? row.source_row
            : {};

    const adoptedById =
        row.adopted_by_user_id == null
            ? null
            : Number(row.adopted_by_user_id);

    const assignedToId =
        row.assigned_to_user_id == null
            ? null
            : Number(row.assigned_to_user_id);

    return {
        id: Number(row.id),
        projectId: String(row.project_id),
        rowKey: row.row_key || '',

        identifier:
            row.identifier ||
            findIdentifierFromData(rawData) ||
            String(row.id),

        title:
            row.title ||
            findTitleFromData(rawData) ||
            'Atividade sem título',

        city:
            row.city ||
            findCityFromData(rawData) ||
            '',

        rawData,
        status: row.status || 'PENDENTE',

        assignedToId,
        assignedTo: row.assigned_to_name || '',
        assignedById: row.assigned_by_user_id ?? null,
        assignedAt: row.assigned_at || null,

        adopted: adoptedById !== null,
        adoptedById,
        adoptedBy: row.analyst_name || '',

        adoptedAt: row.adopted_at || null,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}
function normalizeHistory(row) {
    return {
        id: row.id,
        at: row.created_at,
        projectId: row.project_id,
        activityId: row.activity_id,
        identifier: row.activity_identifier || '',
        action: row.action || 'Ação',
        user: row.user_name || 'Sistema',
        previousStatus: row.previous_status || '',
        newStatus: row.new_status || '',
        detail: row.details || ''
    };
}


/* =========================================================
   5. UTILITÁRIOS
========================================================= */

function esc(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]
    );
}

function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .trim();
}

function normalizeHeader(value) {
    return normalizeText(value)
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function cleanCell(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return String(value)
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDateTime(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium'
    }).format(date);
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(
        0,
        Math.floor(Number(totalSeconds) || 0)
    );

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;

    return [hours, minutes, remainder]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function toast(message, isError = false) {
    const element = $('#toast');

    if (!element) return;

    element.textContent = message;
    element.className = isError ? 'toast error' : 'toast';
    element.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = window.setTimeout(() => {
        element.hidden = true;
    }, 4500);
}

function getProject(projectId = currentProjectId) {
    return currentProjects.find(
        project => project.id === projectId
    ) || null;
}

function currentActivity(activityId) {
    return currentActivities.find(
        activity =>
            String(activity.id) === String(activityId)
    ) || null;
}

function firstName(fullName) {
    const name = String(fullName || '').trim();

    return name
        ? name.split(/\s+/)[0]
        : '—';
}


/* =========================================================
   6. STATUS E CRONÔMETRO
========================================================= */

function isInProgress(activity) {
    return Boolean(activity?.adopted) &&
        Boolean(activity?.startedAt) &&
        !FINAL_STATUSES.has(activity.status);
}

function elapsedSeconds(activity) {
    const startValue =
        activity?.startedAt ||
        activity?.adoptedAt;

    if (!startValue) return 0;

    const start = new Date(startValue).getTime();

    if (!Number.isFinite(start)) return 0;

    const finalTime =
        FINAL_STATUSES.has(activity.status) &&
            activity.completedAt
            ? new Date(activity.completedAt).getTime()
            : Date.now();

    const end = Number.isFinite(finalTime)
        ? finalTime
        : Date.now();

    return Math.max(
        0,
        Math.floor((end - start) / 1000)
    );
}

function statusBadge(status) {
    const info = STATUS[status] || STATUS.PENDENTE;

    return `
        <span class="status-badge ${info.css}">
            ${esc(info.label)}
        </span>
    `;
}

function updateElapsedDisplays() {
    if (currentView !== 'dashboard') return;

    $$('[data-elapsed-activity-id]').forEach(element => {
        const activity = currentActivity(
            element.dataset.elapsedActivityId
        );

        if (activity && activity.adopted) {
            element.textContent = formatDuration(
                elapsedSeconds(activity)
            );
        }
    });

    const activeSeconds = currentActivities
        .filter(isInProgress)
        .reduce(
            (sum, activity) =>
                sum + elapsedSeconds(activity),
            0
        );

    const totalElement = $('#kpi-active-time');

    if (totalElement) {
        totalElement.textContent =
            `Tempo acumulado: ${formatDuration(activeSeconds)}`;
    }
}


/* =========================================================
   7. LEITURA E BUSCA NOS CAMPOS DA PLANILHA
========================================================= */

function getFieldValue(rawData, aliases) {
    for (const [key, value] of Object.entries(rawData || {})) {
        if (!aliases.includes(normalizeHeader(key))) {
            continue;
        }

        const cleaned = cleanCell(value);

        if (cleaned) return cleaned;
    }

    return '';
}

function findTitleFromData(rawData) {
    return getFieldValue(rawData, [
        'ATIVIDADE',
        'TITULO',
        'TÍTULO',
        'NOME DA ATIVIDADE',
        'UNIDADE',
        'NOME DA UNIDADE',
        'DESCRICAO',
        'DESCRIPTION',
        'TITLE'
    ]);
}

function findIdentifierFromData(rawData) {
    return getFieldValue(rawData, [
        'ID',
        'ID LINK',
        'ID VGR',
        'ID DEDICADO',
        'ID INTERNET',
        'CODIGO',
        'CÓDIGO',
        'IDENTIFICADOR'
    ]);
}

function findCityFromData(rawData) {
    return getFieldValue(rawData, [
        'MUNICIPIO',
        'MUNICÍPIO',
        'CIDADE',
        'MUNICIPIO DA UNIDADE'
    ]);
}

function searchableText(activity) {
    const raw = Object.entries(activity.rawData || {})
        .map(([key, value]) => `${key} ${cleanCell(value)}`)
        .join(' ');

    return normalizeText([
        activity.id,
        activity.title,
        activity.identifier,
        activity.city,
        activity.status,
        STATUS[activity.status]?.label,
        activity.adopted
            ? 'adotada adotado'
            : 'não adotada disponível',
        activity.adoptedBy,
        raw
    ].join(' '));
}


/* =========================================================
   8. SELEÇÃO DOS PROJETOS
========================================================= */

function renderProjectCards() {
    const container = $('#project-cards');

    if (!container) return;

    if (!currentProjects.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>Nenhum projeto disponível</strong>
                <p>Confira a conexão do servidor e a tabela oviv_projects no PostgreSQL.</p>
                <button
                    class="button button-primary"
                    type="button"
                    data-action="reload-projects"
                >
                    Tentar novamente
                </button>
            </div>
        `;

        return;
    }

    container.innerHTML = currentProjects.map(project => `
        <article class="project-card">
            <div class="project-card-top">
                <span class="project-icon">
                    ${esc(project.icon)}
                </span>

                <span class="project-count">
                    ${project.total} atividades
                </span>
            </div>

            <h2>${esc(project.name)}</h2>

            <p>${esc(project.description)}</p>

            <span class="project-card-meta">
                ${project.adopted} adotadas ·
                ${project.inProgress} em andamento
            </span>

            <button
                class="button button-primary"
                type="button"
                data-action="open-project"
                data-project-id="${esc(project.id)}"
            >
                Entrar no projeto →
            </button>
        </article>
    `).join('');
}

async function loadProjects({ silent = false } = {}) {
    try {
        const result = await apiRequest('/projects');

        currentProjects = (result.projects || [])
            .map(normalizeProject);

        setBackendNotice(true);
        renderProjectCards();

        if (
            currentProjectId &&
            !getProject(currentProjectId)
        ) {
            currentProjectId = null;
            setView('projects');
        }

        return currentProjects;
    } catch (error) {
        console.error('Falha ao carregar projetos:', error);

        setBackendNotice(false, error.message);
        renderProjectCards();

        if (!silent) {
            toast(error.message, true);
        }

        throw error;
    }
}


/* =========================================================
   9. CARREGAR ATIVIDADES E HISTÓRICO DO BANCO
========================================================= */

async function loadActivities(projectId = currentProjectId) {
    if (!projectId) return [];

    const result = await apiRequest(
        `/projects/${encodeURIComponent(projectId)}/activities`
    );

    currentActivities = (result.activities || [])
        .map(normalizeActivity);

    renderSummary();
    renderActivityRows();

    return currentActivities;
}

async function loadHistory(projectId = currentProjectId) {
    if (!projectId) return [];

    const result = await apiRequest(
        `/projects/${encodeURIComponent(projectId)}/history?limit=1000`
    );

    currentHistory = (result.history || [])
        .map(normalizeHistory);

    if (currentView === 'history') {
        renderHistory();
    }

    return currentHistory;
}

async function refreshCurrentProject({ silent = false } = {}) {
    if (!currentProjectId || isRefreshing) return;

    // Não recrie o seletor enquanto o analista está escolhendo um status.
    if (
        document.activeElement?.matches(
            'select[data-action="change-status"]'
        )
    ) {
        return;
    }

    isRefreshing = true;

    try {
        await loadProjects({ silent: true });

        if (!currentProjectId) return;

        await Promise.all([
            loadActivities(currentProjectId),
            loadHistory(currentProjectId)
        ]);

        if (currentView === 'dashboard') {
            renderDashboard();
        }

        if (currentView === 'history') {
            renderHistory();
        }
    } catch (error) {
        console.error(
            'Falha ao atualizar dados do projeto:',
            error
        );

        if (!silent) {
            toast(error.message, true);
        }
    } finally {
        isRefreshing = false;
    }
}


/* =========================================================
   10. CARTÕES DOS TOTAIS
========================================================= */

function renderSummary() {
    const activities = currentActivities;
    const active = activities.filter(isInProgress);

    $('#kpi-total').textContent = activities.length;

    $('#kpi-pending').textContent =
        activities.filter(activity =>
            activity.status === 'PENDENTE' &&
            !activity.adopted
        ).length;

    $('#kpi-adopted').textContent =
        activities.filter(activity =>
            activity.adopted
        ).length;

    $('#kpi-configuring').textContent =
        active.length;

    const activeSeconds = active.reduce(
        (sum, activity) =>
            sum + elapsedSeconds(activity),
        0
    );

    $('#kpi-active-time').textContent =
        `Tempo acumulado: ${formatDuration(activeSeconds)}`;

    $('#kpi-completed').textContent =
        activities.filter(activity =>
            ['ATIVIDADE_MIGRADA', 'CONCLUIDA']
                .includes(activity.status)
        ).length;

    $('#kpi-blocked').textContent =
        activities.filter(activity =>
            activity.status === 'IMPEDIMENTO'
        ).length;
}


/* =========================================================
   11. TABELA DE ATIVIDADES
========================================================= */

function renderActivityRows() {
    if (!$('#activity-search')) return;

    const activities = currentActivities;

    const query = normalizeText(
        $('#activity-search').value
    );

    const statusFilter = $('#status-filter').value;
    const adoptionFilter = $('#adoption-filter').value;

    const userId = getLoggedUserId();
    const manager = isManagerUser();
    const analyst = isAnalystUser();

    const filtered = activities.filter(activity => {
        if (
            query &&
            !searchableText(activity).includes(query)
        ) {
            return false;
        }

        if (
            statusFilter &&
            activity.status !== statusFilter
        ) {
            return false;
        }

        if (
            adoptionFilter === 'adopted' &&
            !activity.adopted
        ) {
            return false;
        }

        if (
            adoptionFilter === 'available' &&
            activity.adopted
        ) {
            return false;
        }

        if (
            adoptionFilter === 'in-progress' &&
            !isInProgress(activity)
        ) {
            return false;
        }

        return true;
    });

    $('#results-count').textContent =
        `${filtered.length} de ${activities.length} atividades`;

    $('#activities-table-body').innerHTML =
        filtered.map(activity => {
            const title =
                activity.title ||
                'Atividade sem título';

            const identifier =
                activity.identifier ||
                String(activity.id);

            const city =
                activity.city ||
                '—';

            const responsible = activity.adopted
                ? activity.adoptedBy
                : activity.assignedTo;

            const analystName = responsible
                ? firstName(responsible)
                : '—';

            const time = activity.adopted
                ? formatDuration(elapsedSeconds(activity))
                : '—';

            let adoptionInfo = 'Disponível';

            if (activity.adopted) {
                adoptionInfo =
                    `Adotada por ${activity.adoptedBy || 'Analista'}`;
            } else if (activity.assignedTo) {
                adoptionInfo =
                    `Atribuída a ${activity.assignedTo}`;
            }

            const adoptionClass =
                activity.adopted || activity.assignedTo
                    ? 'adoption-label adopted'
                    : 'adoption-label';

            const canUpdateStatus =
                analyst &&
                activity.adopted &&
                Number(activity.adoptedById) === userId &&
                !FINAL_STATUSES.has(activity.status);

            const statusControl = canUpdateStatus
                ? `
                    <select
                        class="status-select"
                        aria-label="Atualizar etapa de ${esc(identifier)}"
                        data-action="change-status"
                        data-activity-id="${esc(activity.id)}"
                    >
                        ${WORKFLOW_STATUSES.map(value => `
                            <option
                                value="${value}"
                                ${activity.status === value ? 'selected' : ''}
                            >
                                ${esc(STATUS[value].label)}
                            </option>
                        `).join('')}
                    </select>
                `
                : statusBadge(activity.status);

            let buttons = '';

            // O gestor pode atribuir ou reatribuir somente
            // atividades ainda não adotadas.
            if (manager && !activity.adopted) {
                buttons += `
                    <button
                        class="button button-assign button-small"
                        type="button"
                        data-action="assign-activity"
                        data-activity-id="${esc(activity.id)}"
                    >
                        ${activity.assignedTo
                        ? 'Atribuir novamente'
                        : 'Atribuir'}
                    </button>
                `;
            }

            // O analista só pode adotar uma atividade livre
            // ou que tenha sido atribuída a ele.
            if (analyst && !activity.adopted) {
                const availableForUser =
                    !activity.assignedToId ||
                    Number(activity.assignedToId) === userId;

                if (availableForUser) {
                    buttons += `
                        <button
                            class="button button-adopt button-small"
                            type="button"
                            data-action="adopt-activity"
                            data-activity-id="${esc(activity.id)}"
                        >
                            Adotar atividade
                        </button>
                    `;
                } else {
                    buttons += `
                        <span class="assigned-label">
                            Atribuída a outro analista
                        </span>
                    `;
                }
            }

            return `
                <tr
                    class="activity-row"
                    tabindex="0"
                    role="button"
                    aria-label="Visualizar ${esc(title)}"
                    data-action="view-activity"
                    data-activity-id="${esc(activity.id)}"
                >
                    <td class="activity-id">
                        ${esc(identifier)}
                    </td>

                    <td>
                        <span class="activity-name">
                            ${esc(title)}
                        </span>

                        <span class="activity-subtitle">
                            Clique na linha para ver os detalhes
                        </span>
                    </td>

                    <td>${esc(city)}</td>

                    <td>
                        <span class="activity-person">
                            ${esc(analystName)}
                        </span>
                    </td>

                    <td>
                        <span
                            class="activity-duration"
                            data-elapsed-activity-id="${esc(activity.id)}"
                        >
                            ${esc(time)}
                        </span>
                    </td>

                    <td>${statusControl}</td>

                    <td>
                        <span class="${adoptionClass}">
                            ${esc(adoptionInfo)}
                        </span>
                    </td>

                    <td class="activity-actions-cell">
                        <div class="activity-actions">
                            ${buttons || '—'}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    $('#activities-empty').hidden =
        filtered.length > 0;

    renderSummary();
}

/* =========================================================
   12. VISUALIZAÇÃO DA ATIVIDADE
========================================================= */

function renderActivityDetails(activityId) {
    const activity = currentActivity(activityId);

    if (!activity) {
        toast(
            'Atividade não encontrada. Atualize os dados.',
            true
        );

        return;
    }

    $('#detail-title').textContent =
        activity.title || 'Detalhes da atividade';

    $('#detail-subtitle').textContent =
        `Identificador: ${activity.identifier || activity.id} · ` +
        `${STATUS[activity.status]?.label || activity.status} · ` +
        `${activity.adopted ? 'Adotada' : 'Não adotada'}`;

    const metadata = [
        [
            'Status no Oviv',
            STATUS[activity.status]?.label || activity.status
        ],
        [
            'Adoção',
            activity.adopted
                ? `Adotada por ${activity.adoptedBy || 'Analista'} em ${formatDateTime(activity.adoptedAt)}`
                : 'Ainda não adotada'
        ],
        [
            'Analista responsável',
            activity.adopted
                ? activity.adoptedBy || 'Analista'
                : 'Ainda não definida'
        ],
        [
            'Tempo de atividade',
            activity.adopted
                ? formatDuration(elapsedSeconds(activity))
                : 'Ainda não iniciada'
        ],
        [
            'Início da atividade',
            formatDateTime(activity.startedAt || activity.adoptedAt)
        ],
        [
            'Finalização',
            formatDateTime(activity.completedAt)
        ],
        [
            'Importada em',
            formatDateTime(activity.createdAt)
        ]
    ];

    const allFields = [
        ...metadata,
        ...Object.entries(activity.rawData || {}).map(
            ([key, value]) => [
                key,
                cleanCell(value) || '—'
            ]
        )
    ];

    $('#activity-detail-fields').innerHTML =
        allFields.map(([key, value]) => `
            <div class="detail-field">
                <strong>${esc(key)}</strong>
                <span>${esc(value)}</span>
            </div>
        `).join('');

    // Esta função apenas abre os detalhes. Não adota a atividade.
    $('#activity-detail-dialog').showModal();
}


/* =========================================================
   13. ADOÇÃO E INÍCIO DO CRONÔMETRO
========================================================= */

async function adoptActivity(activityId) {
    const activity = currentActivity(activityId);

    if (!activity) {
        toast('Atividade não encontrada.', true);
        return;
    }

    if (!isAnalystUser()) {
        toast(
            'Somente um usuário autenticado como analista pode adotar atividades.',
            true
        );

        return;
    }

    if (activity.adopted) {
        toast('Esta atividade já foi adotada.', true);
        return;
    }

    if (
        activity.assignedToId &&
        Number(activity.assignedToId) !== getLoggedUserId()
    ) {
        toast(
            'Esta atividade foi atribuída a outro analista.',
            true
        );

        return;
    }

    if (!confirm(
        `Adotar "${activity.title}" e iniciar o cronômetro?`
    )) {
        return;
    }

    try {
        await apiRequest(
            `/projects/${encodeURIComponent(currentProjectId)}/activities/${encodeURIComponent(activity.id)}/adopt`,
            {
                method: 'POST'
            }
        );

        toast(
            'Atividade adotada. Cronômetro iniciado!'
        );

        await refreshCurrentProject({
            silent: true
        });
    } catch (error) {
        toast(error.message, true);
    }
}

/* =========================================================
   14. ATUALIZAÇÃO DAS ETAPAS
========================================================= */
async function updateActivityStatus(
    activityId,
    nextStatus
) {
    const activity = currentActivity(activityId);

    if (
        !activity ||
        !isAnalystUser() ||
        Number(activity.adoptedById) !== getLoggedUserId()
    ) {
        toast(
            'Somente o analista responsável pode atualizar esta atividade.',
            true
        );

        await refreshCurrentProject({
            silent: true
        });

        return;
    }

    if (!WORKFLOW_STATUSES.includes(nextStatus)) {
        toast('Status inválido.', true);
        return;
    }

    if (FINAL_STATUSES.has(activity.status)) {
        toast('Esta atividade já foi finalizada.', true);
        return;
    }

    if (activity.status === nextStatus) return;

    try {
        await apiRequest(
            `/projects/${encodeURIComponent(currentProjectId)}/activities/${encodeURIComponent(activity.id)}/status`,
            {
                method: 'PATCH',
                body: JSON.stringify({
                    status: nextStatus
                })
            }
        );

        toast(
            `Etapa atualizada: ${STATUS[nextStatus]?.label || nextStatus}.`
        );

        await refreshCurrentProject({
            silent: true
        });
    } catch (error) {
        toast(error.message, true);

        await refreshCurrentProject({
            silent: true
        });
    }
}
/* =========================================================
   15. IMPORTAÇÃO EXCEL/CSV
========================================================= */

function resetImportView() {
    if (pendingImport) return;

    $('#import-preview').hidden = true;
    $('#import-summary').textContent = '';
    $('#import-preview-body').innerHTML = '';
    $('#confirm-import').disabled = true;
}

function stableFingerprint(rawData) {
    const canonical = Object.keys(rawData)
        .sort((a, b) => a.localeCompare(b))
        .map(key =>
            `${normalizeText(key)}=${normalizeText(rawData[key])}`
        )
        .join('|');

    // Hash FNV-1a para gerar uma chave determinística da linha.
    let hash = 2166136261;

    for (let i = 0; i < canonical.length; i++) {
        hash ^= canonical.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return `row-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function toSafeRawData(row) {
    const result = {};

    for (const [key, value] of Object.entries(row)) {
        const header = String(key || '').trim();

        if (
            !header ||
            value === null ||
            value === undefined ||
            cleanCell(value) === ''
        ) {
            continue;
        }

        result[header] =
            cleanCell(value).slice(0, 4000);
    }

    return result;
}

async function prepareImport(event) {
    event.preventDefault();

    const file = $('#import-file').files?.[0];

    if (!file) {
        return toast('Selecione um arquivo Excel ou CSV.', true);
    }

    if (file.size > MAX_IMPORT_BYTES) {
        return toast(
            'O arquivo ultrapassa 20 MB, limite desta versão.',
            true
        );
    }

    if (!window.XLSX) {
        return toast(
            'A biblioteca Excel não foi carregada. Verifique sua conexão e recarregue a página.',
            true
        );
    }

    const extension = file.name
        .split('.')
        .pop()
        .toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        return toast(
            'Formato não suportado. Escolha XLSX, XLS ou CSV.',
            true
        );
    }

    $('#import-preview').hidden = false;

    $('#import-summary').textContent =
        'Analisando o arquivo neste navegador…';

    $('#import-preview-body').innerHTML = '';
    $('#confirm-import').disabled = true;

    try {
        const workbook = window.XLSX.read(
            await file.arrayBuffer(),
            { type: 'array' }
        );

        const sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error(
                'Nenhuma aba foi encontrada no arquivo.'
            );
        }

        const rows = window.XLSX.utils.sheet_to_json(
            workbook.Sheets[sheetName],
            {
                defval: '',
                raw: false
            }
        );

        if (!rows.length) {
            throw new Error(
                'A primeira aba não contém linhas de dados.'
            );
        }

        const validRows = [];
        const seen = new Set();
        let ignored = 0;

        for (const sourceRow of rows) {
            const rawData = toSafeRawData(sourceRow);

            if (!Object.keys(rawData).length) {
                ignored++;
                continue;
            }

            const title = findTitleFromData(rawData);
            const identifier = findIdentifierFromData(rawData);

            if (!title && !identifier) {
                ignored++;
                continue;
            }

            const rowKey = stableFingerprint(rawData);

            if (seen.has(rowKey)) {
                ignored++;
                continue;
            }

            seen.add(rowKey);

            validRows.push({
                rowKey,
                identifier: identifier || rowKey,
                title: title || `Atividade ${identifier || rowKey}`,
                city: findCityFromData(rawData),
                rawData
            });
        }

        if (!validRows.length) {
            throw new Error(
                'Nenhuma linha válida foi encontrada. Confira se a planilha contém colunas como ID, UNIDADE ou ATIVIDADE.'
            );
        }

        pendingImport = {
            projectId: currentProjectId,
            rows: validRows,
            totalRows: rows.length,
            ignored,
            fileName: file.name
        };

        renderImportPreview();
    } catch (error) {
        console.error(
            'Falha na leitura da planilha:',
            error
        );

        pendingImport = null;

        $('#import-summary').textContent =
            error.message ||
            'Não foi possível ler a planilha.';

        $('#confirm-import').disabled = true;

        toast(
            error.message ||
            'Não foi possível analisar o arquivo.',
            true
        );
    }
}

function renderImportPreview() {
    if (!pendingImport) return;

    const rows = pendingImport.rows;

    $('#import-preview-count').textContent =
        `${rows.length} atividades para enviar`;

    $('#import-summary').innerHTML = `
        Arquivo: <strong>${esc(pendingImport.fileName)}</strong><br>
        Linhas lidas: <strong>${pendingImport.totalRows}</strong> ·
        Linhas válidas: <strong>${rows.length}</strong> ·
        Linhas ignoradas/duplicadas no arquivo: <strong>${pendingImport.ignored}</strong>.
        <br>
        Ao confirmar, as linhas serão enviadas à API e gravadas no PostgreSQL. Duplicatas que já existirem no banco serão ignoradas pelo servidor.
    `;

    $('#import-preview-body').innerHTML =
        rows.slice(0, 12).map(activity => `
            <tr>
                <td>${esc(activity.identifier)}</td>
                <td>${esc(activity.title)}</td>
                <td>${esc(activity.city || '—')}</td>
                <td>
                    <span class="status-badge status-pending">
                        Pendente
                    </span>
                </td>
            </tr>
        `).join('');

    if (rows.length > 12) {
        $('#import-preview-body').insertAdjacentHTML(
            'beforeend',
            `
                <tr>
                    <td colspan="4">
                        Mais ${rows.length - 12} atividades serão enviadas após a confirmação.
                    </td>
                </tr>
            `
        );
    }

    $('#confirm-import').disabled = rows.length === 0;
}

async function confirmImport() {
    if (
        !pendingImport ||
        pendingImport.projectId !== currentProjectId
    ) {
        return toast(
            'Volte ao projeto correto e analise a planilha novamente.',
            true
        );
    }

    const rows = pendingImport.rows;
    const projectId = pendingImport.projectId;

    const payloadBytes = new Blob([
        JSON.stringify({ activities: rows })
    ]).size;

    $('#confirm-import').disabled = true;
    $('#confirm-import').textContent = 'Enviando…';

    try {
        let imported = 0;
        let duplicates = 0;
        let invalid = 0;

        // Arquivos normais vão em uma única requisição.
        // Arquivos muito grandes são divididos em lotes.
        const useBatches =
            rows.length > MAX_IMPORT_ROWS_PER_REQUEST ||
            payloadBytes > MAX_API_PAYLOAD_BYTES;

        const batchSize = useBatches
            ? 300
            : rows.length;

        for (
            let start = 0;
            start < rows.length;
            start += batchSize
        ) {
            const batch = rows.slice(start, start + batchSize);

            const result = await apiRequest(
                `/projects/${encodeURIComponent(projectId)}/import`,
                apiJson('POST', { activities: batch })
            );

            imported += Number(result.imported || 0);
            duplicates += Number(result.duplicates || 0);
            invalid += Number(result.invalid || 0);

            $('#confirm-import').textContent =
                `Enviando ${Math.min(start + batch.length, rows.length)} de ${rows.length}…`;
        }

        pendingImport = null;

        $('#import-form').reset();
        resetImportView();

        await refreshCurrentProject({ silent: true });
        setView('dashboard');

        toast(
            `Importação concluída: ${imported} adicionadas, ${duplicates} duplicatas ignoradas e ${invalid} linhas inválidas.`
        );
    } catch (error) {
        console.error(
            'Falha ao importar atividades:',
            error
        );

        toast(
            `A importação não foi concluída: ${error.message}`,
            true
        );
    } finally {
        $('#confirm-import').disabled = false;
        $('#confirm-import').textContent =
            'Confirmar importação';
    }
}

function cancelImport() {
    pendingImport = null;

    $('#import-form').reset();
    resetImportView();

    toast(
        'Importação cancelada. Nenhuma nova linha foi enviada.'
    );
}


/* =========================================================
   16. HISTÓRICO
========================================================= */

function renderHistory() {
    const query = normalizeText(
        $('#history-search')?.value || ''
    );

    const select = $('#history-action-filter');
    const previous = select.value;

    const actions = [
        ...new Set(
            currentHistory.map(entry => entry.action)
        )
    ].sort((a, b) =>
        a.localeCompare(b, 'pt-BR')
    );

    select.innerHTML =
        '<option value="">Todas as ações</option>' +
        actions.map(action => `
            <option value="${esc(action)}">
                ${esc(action)}
            </option>
        `).join('');

    if (actions.includes(previous)) {
        select.value = previous;
    }

    const actionFilter = select.value;

    const filtered = [...currentHistory]
        .sort((a, b) =>
            new Date(b.at) - new Date(a.at)
        )
        .filter(entry => {
            if (
                actionFilter &&
                entry.action !== actionFilter
            ) {
                return false;
            }

            const searchable = normalizeText(
                `${entry.action} ${entry.user} ${entry.detail} ${entry.identifier}`
            );

            return !query || searchable.includes(query);
        });

    $('#history-count').textContent =
        `${filtered.length} registros`;

    $('#history-body').innerHTML =
        filtered.map(entry => `
            <tr>
                <td>${esc(formatDateTime(entry.at))}</td>

                <td class="history-action">
                    ${esc(entry.action)}
                </td>

                <td>${esc(entry.user)}</td>

                <td class="history-detail">
                    ${esc(entry.detail || entry.identifier || '—')}
                </td>
            </tr>
        `).join('');

    $('#history-empty').hidden =
        filtered.length > 0;
}

function exportHistoryCSV() {
    const rows = [
        [
            'Data',
            'Ação',
            'Usuário',
            'Identificador da atividade',
            'Detalhes'
        ],

        ...currentHistory.map(entry => [
            entry.at
                ? new Date(entry.at).toISOString()
                : '',
            entry.action,
            entry.user,
            entry.identifier,
            entry.detail
        ])
    ];

    const csv = rows.map(row =>
        row.map(value =>
            `"${String(value ?? '').replace(/"/g, '""')}"`
        ).join(';')
    ).join('\r\n');

    const blob = new Blob(
        ['\uFEFF', csv],
        { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
        `oviv-historico-${currentProjectId}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    toast('Histórico do PostgreSQL exportado para CSV.');
}


/* =========================================================
   17. NAVEGAÇÃO
========================================================= */

function setView(viewName) {
    const valid = [
        'projects',
        'dashboard',
        'import',
        'history'
    ];

    if (!valid.includes(viewName)) {
        viewName = 'projects';
    }

    if (
        viewName !== 'projects' &&
        !currentProjectId
    ) {
        viewName = 'projects';
    }

    currentView = viewName;

    $('#view-projects').hidden =
        viewName !== 'projects';

    $('#project-workspace').hidden =
        viewName === 'projects';

    [
        'dashboard',
        'import',
        'history'
    ].forEach(name => {
        $(`#view-${name}`).hidden =
            name !== viewName;
    });

    $$('.project-nav [data-nav]').forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.nav === viewName
        );
    });

    if (viewName === 'dashboard') {
        renderDashboard();
    }

    if (viewName === 'import') {
        resetImportView();
    }

    if (viewName === 'history') {
        renderHistory();
    }

    const project = getProject();

    $('#current-project-label').hidden = !project;

    $('#current-project-label').textContent =
        project ? project.name : '';

    if (location.hash !== `#${viewName}`) {
        history.replaceState(
            null,
            '',
            `#${viewName}`
        );
    }
}

async function selectProject(projectId) {
    if (!currentProjects.some(
        project => project.id === projectId
    )) {
        return;
    }

    currentProjectId = projectId;
    currentActivities = [];
    currentHistory = [];

    setView('dashboard');

    try {
        await Promise.all([
            loadActivities(projectId),
            loadHistory(projectId),
            loadProjects({ silent: true })
        ]);

        renderDashboard();
    } catch (error) {
        toast(error.message, true);
    }
}

async function navigateTo(viewName) {
    if (viewName === 'projects') {
        currentProjectId = null;
        currentActivities = [];
        currentHistory = [];

        setView('projects');

        await loadProjects({ silent: true })
            .catch(() => { });

        return;
    }

    if (!currentProjectId) {
        setView('projects');
        return;
    }

    setView(viewName);

    if (viewName === 'dashboard') {
        await loadActivities()
            .catch(error => toast(error.message, true));
    }

    if (viewName === 'history') {
        await loadHistory()
            .catch(error => toast(error.message, true));
    }
}


/* =========================================================
   18. EVENTOS DA INTERFACE
========================================================= */

document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-nav]');

    if (nav) {
        event.preventDefault();
        await navigateTo(nav.dataset.nav);
        return;
    }

    const openImport =
        event.target.closest('[data-open-import]');

    if (openImport) {
        await navigateTo('import');
        return;
    }

    const action =
        event.target.closest('[data-action]');

    if (!action) return;

    switch (action.dataset.action) {
        case 'open-project':
            await selectProject(action.dataset.projectId);
            return;

        case 'reload-projects':
            await loadProjects().catch(() => { });
            return;

        case 'adopt-activity':
            event.stopPropagation();
            await adoptActivity(action.dataset.activityId);
            return;

        case 'filter-in-progress':
            $('#activity-search').value = '';
            $('#status-filter').value = '';
            $('#adoption-filter').value = 'in-progress';

            renderActivityRows();

            $('#activities-table-body')
                .closest('.panel')
                ?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

            return;

        case 'change-status':
            return;

        case 'view-activity':
            renderActivityDetails(
                action.dataset.activityId
            );
            return;
        case 'assign-activity':
            event.stopPropagation();

            await openAssignDialog(
                action.dataset.activityId
            );

            return;
    }
});

document.addEventListener('change', async event => {
    const statusSelect = event.target.closest(
        'select[data-action="change-status"]'
    );

    if (statusSelect) {
        await updateActivityStatus(
            statusSelect.dataset.activityId,
            statusSelect.value
        );
    }
});

document.addEventListener('keydown', event => {
    const row = event.target.closest(
        'tr[data-action="view-activity"]'
    );

    if (!row) return;

    if (
        event.target.closest(
            'button, select, input, a'
        )
    ) {
        return;
    }

    if (
        event.key === 'Enter' ||
        event.key === ' '
    ) {
        event.preventDefault();

        renderActivityDetails(
            row.dataset.activityId
        );
    }
});


/* =========================================================
   19. CONTROLES DE BUSCA, IMPORTAÇÃO E HISTÓRICO
========================================================= */

$('#activity-search').addEventListener(
    'input',
    renderActivityRows
);

$('#status-filter').addEventListener(
    'change',
    renderActivityRows
);

$('#adoption-filter').addEventListener(
    'change',
    renderActivityRows
);

$('#clear-search').addEventListener('click', () => {
    $('#activity-search').value = '';
    $('#status-filter').value = '';
    $('#adoption-filter').value = '';

    renderActivityRows();
});

$('#open-import').addEventListener(
    'click',
    () => navigateTo('import')
);

$('#import-form').addEventListener(
    'submit',
    prepareImport
);

$('#confirm-import').addEventListener(
    'click',
    confirmImport
);

$('#cancel-import').addEventListener(
    'click',
    cancelImport
);

$('#history-search').addEventListener(
    'input',
    renderHistory
);

$('#history-action-filter').addEventListener(
    'change',
    renderHistory
);

$('#export-history').addEventListener(
    'click',
    exportHistoryCSV
);

$('#close-detail').addEventListener(
    'click',
    () => $('#activity-detail-dialog').close()
);

$('#activity-detail-dialog').addEventListener(
    'click',
    event => {
        if (
            event.target ===
            $('#activity-detail-dialog')
        ) {
            $('#activity-detail-dialog').close();
        }
    }
);


/* =========================================================
   20. ATUALIZAR DADOS
========================================================= */

// O botão antigo "Restaurar exemplos" não pode apagar nem recriar
// dados reais do servidor. Agora ele apenas atualiza a API.
const refreshButton = $('#reset-demo');

if (refreshButton) {
    refreshButton.textContent = 'Atualizar dados';

    refreshButton.addEventListener('click', async () => {
        if (currentProjectId) {
            await refreshCurrentProject();
        } else {
            await loadProjects();
        }

        toast('Dados atualizados a partir do servidor.');
    });
}

// Mantém o contador visual atualizado a cada segundo.
window.setInterval(
    updateElapsedDisplays,
    1000
);

// Atualiza atividades e histórico a cada seis segundos.
// Isso permite que o gestor veja alterações feitas em outro dispositivo.
// É atualização periódica HTTP; não é WebSocket.
window.setInterval(async () => {
    if (!currentProjectId || document.hidden) return;

    await refreshCurrentProject({ silent: true });
}, 6000);

window.addEventListener('focus', async () => {
    if (currentProjectId) {
        await refreshCurrentProject({ silent: true });
    } else {
        await loadProjects({ silent: true })
            .catch(() => { });
    }
});

window.addEventListener('hashchange', async () => {
    const requested = location.hash.slice(1);

    if (requested === 'projects') {
        await navigateTo('projects');
    } else if (
        ['dashboard', 'import', 'history'].includes(requested) &&
        currentProjectId
    ) {
        await navigateTo(requested);
    }
});


/* =========================================================
   INICIALIZAÇÃO COM AUTENTICAÇÃO
========================================================= */

initializeAuthentication();

/* =========================================================
   TESTADOR VISUAL DA API DE CHECK-IN
========================================================= */

const checkinTestForm = $('#checkin-test-form');
const checkinTestResult = $('#checkin-test-result');
const checkinTestMessage = $('#checkin-test-message');
const checkinTestSubmit = $('#checkin-test-submit');
const checkinTestClear = $('#checkin-test-clear');


function showCheckinResult({
    success,
    httpStatus,
    payload
}) {
    checkinTestResult.hidden = false;

    checkinTestResult.classList.toggle(
        'success',
        success
    );

    checkinTestResult.classList.toggle(
        'error',
        !success
    );

    checkinTestMessage.textContent = success
        ? `Check-in registrado com sucesso. HTTP ${httpStatus}.`
        : `A operação não foi concluída. HTTP ${httpStatus}. Confira a resposta abaixo.`;

    checkinTestResult.textContent = JSON.stringify(
        {
            httpStatus,
            ...payload
        },
        null,
        2
    );
}


async function testVisitCheckIn(event) {
    event.preventDefault();

    const analystId = Number(
        $('#checkin-analyst-id').value
    );

    const unitId = Number(
        $('#checkin-unit-id').value
    );

    if (
        !Number.isSafeInteger(analystId) ||
        analystId <= 0
    ) {
        toast('Informe um ID de analista válido.', true);
        return;
    }

    if (
        !Number.isSafeInteger(unitId) ||
        unitId <= 0
    ) {
        toast('Informe um ID de unidade válido.', true);
        return;
    }

    checkinTestSubmit.disabled = true;
    checkinTestSubmit.textContent = 'Enviando requisição…';

    checkinTestResult.hidden = true;

    checkinTestMessage.textContent =
        'Enviando os dados para /api/visits/check-in…';

    try {
        const response = await fetch(
            '/api/visits/check-in',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                credentials: 'same-origin',

                body: JSON.stringify({
                    analystId,
                    unitId
                })
            }
        );

        let payload;

        try {
            payload = await response.json();
        } catch (_) {
            payload = {
                message: 'O servidor não retornou um JSON válido.'
            };
        }

        /*
         * A rota atual pode responder HTTP 200 mesmo quando
         * a validação dos IDs falha. Por isso, não basta
         * conferir response.ok: também verificamos se a API
         * devolveu o objeto visit.
         */
        const success =
            response.status === 201 &&
            Boolean(payload?.visit);

        showCheckinResult({
            success,
            httpStatus: response.status,
            payload
        });

        if (success) {
            toast(
                `Check-in registrado! ID da visita: ${payload.visit.id}.`
            );
        } else {
            toast(
                payload?.message ||
                'Não foi possível registrar o check-in.',
                true
            );
        }
    } catch (error) {
        showCheckinResult({
            success: false,
            httpStatus: 'SEM RESPOSTA',
            payload: {
                message:
                    'Não foi possível acessar a API. Confirme se o servidor está funcionando.',
                error: error.message
            }
        });

        toast('Falha ao conectar com a API de check-in.', true);
    } finally {
        checkinTestSubmit.disabled = false;
        checkinTestSubmit.textContent = 'Testar check-in';
    }
}


if (checkinTestForm) {
    checkinTestForm.addEventListener(
        'submit',
        testVisitCheckIn
    );
}


if (checkinTestClear) {
    checkinTestClear.addEventListener('click', () => {
        checkinTestForm.reset();

        checkinTestResult.hidden = true;
        checkinTestResult.textContent = '';

        checkinTestResult.classList.remove(
            'success',
            'error'
        );

        checkinTestMessage.textContent =
            'Preencha os dois IDs e execute o teste.';
    });
}

/* =========================================================
   EVENTOS DE LOGIN, GESTÃO E ATRIBUIÇÃO
========================================================= */

$('#login-form').addEventListener(
    'submit',
    handleLogin
);

$('#logout-button').addEventListener(
    'click',
    handleLogout
);

$('#analyst-create-form').addEventListener(
    'submit',
    createAnalyst
);

$('#assign-form').addEventListener(
    'submit',
    submitAssignment
);

$('#assign-close').addEventListener(
    'click',
    () => {
        assigningActivityId = null;
        $('#assign-dialog').close();
    }
);

$('#assign-cancel').addEventListener(
    'click',
    () => {
        assigningActivityId = null;
        $('#assign-dialog').close();
    }
);