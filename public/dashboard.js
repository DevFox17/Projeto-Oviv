'use strict';

/*
 * ============================================================
 * OVIV — MODO DEMONSTRAÇÃO ESTÁTICA
 * ============================================================
 *
 * Login e autenticação estão temporariamente desativados.
 * Nenhuma chamada é feita ao backend Node.js ou PostgreSQL.
 *
 * Os dados ficam no localStorage deste navegador.
 * Não há sincronização entre computadores ou celulares.
 *
 * Quando o login voltar, este arquivo será substituído pela
 * versão integrada à API.
 */

const STORAGE_KEY = 'oviv_static_demo_v1';
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_HISTORY = 1500;

const $ = (selector, root = document) =>
    root.querySelector(selector);

const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

const PROJECTS = [
    {
        id: 'copasa',
        name: 'Projeto COPASA',
        shortName: 'COPASA',
        description:
            'Atividades e configurações lógicas do projeto COPASA.',
        icon: 'C'
    },
    {
        id: 'cemig',
        name: 'Projeto CEMIG',
        shortName: 'CEMIG',
        description:
            'Atividades e configurações lógicas do projeto CEMIG.',
        icon: 'E'
    },
    {
        id: 'banco-brasil',
        name: 'Projeto Banco do Brasil',
        shortName: 'BANCO DO BRASIL',
        description:
            'Atividades e configurações lógicas do Banco do Brasil.',
        icon: 'B'
    }
];

/*
 * Nomes fictícios apenas para testar o botão Atribuir.
 * Não são contas de usuários reais.
 */
const DEMO_ANALYSTS = [
    {
        id: 'demo-1',
        name: 'Ana Souza'
    },
    {
        id: 'demo-2',
        name: 'Carlos Lima'
    },
    {
        id: 'demo-3',
        name: 'Mariana Alves'
    }
];

const DEMO_ACTOR = 'Analista demonstrativo';

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
    'CANCELADA'
]);

let state = null;

let currentProjectId = null;
let currentView = 'projects';
let pendingImport = null;
let assigningActivityId = null;
let toastTimer = null;


/* ============================================================
   1. UTILITÁRIOS
============================================================ */

function newId() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function esc(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]
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

function firstName(fullName) {
    const value = String(fullName || '').trim();

    return value
        ? value.split(/\s+/)[0]
        : '—';
}

function formatDateTime(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '—';
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

    const minutes = Math.floor(
        (seconds % 3600) / 60
    );

    const remainder = seconds % 60;

    return [hours, minutes, remainder]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function toast(message, isError = false) {
    const element = $('#toast');

    element.textContent = message;

    element.className = isError
        ? 'toast error'
        : 'toast';

    element.hidden = false;

    if (toastTimer) {
        clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
        element.hidden = true;
    }, 3800);
}

function getProject(projectId = currentProjectId) {
    return PROJECTS.find(
        project => project.id === projectId
    ) || null;
}

function getProjectData(projectId = currentProjectId) {
    if (!state.projects[projectId]) {
        state.projects[projectId] = {
            activities: []
        };
    }

    return state.projects[projectId];
}

function getActivities(projectId = currentProjectId) {
    return getProjectData(projectId).activities;
}

function currentActivity(activityId) {
    return getActivities().find(
        activity => String(activity.id) === String(activityId)
    ) || null;
}


/* ============================================================
   2. DADOS FICTÍCIOS
============================================================ */

function createDemoActivity(id, rawData, status = 'PENDENTE') {
    return {
        id,
        rowKey: `demo-${id}`,

        rawData,

        title:
            findTitleFromData(rawData) ||
            `Atividade ${id}`,

        identifier:
            findIdentifierFromData(rawData) ||
            String(id),

        city:
            findCityFromData(rawData) ||
            '',

        status,

        assignedToId: null,
        assignedTo: '',
        assignedAt: null,

        adopted: false,
        adoptedBy: '',
        adoptedAt: null,
        startedAt: null,
        completedAt: null,

        createdAt: new Date().toISOString()
    };
}

function createSeedState() {
    return {
        version: 1,

        projects: {
            copasa: {
                activities: [
                    createDemoActivity(
                        'demo-copasa-1',
                        {
                            ID: 'DEMO-2263651',
                            UNIDADE:
                                'Unidade fictícia COPASA Centro',
                            MUNICIPIO: 'Montes Claros',
                            'ID VGR': 'VGR-DEMO-01',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    ),

                    createDemoActivity(
                        'demo-copasa-2',
                        {
                            ID: 'DEMO-2263652',
                            UNIDADE:
                                'Unidade fictícia COPASA Norte',
                            MUNICIPIO: 'Montes Claros',
                            'ID VGR': 'VGR-DEMO-02',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    ),

                    createDemoActivity(
                        'demo-copasa-3',
                        {
                            ID: 'DEMO-2263653',
                            UNIDADE:
                                'Unidade fictícia COPASA Sul',
                            MUNICIPIO: 'Belo Horizonte',
                            'ID VGR': 'VGR-DEMO-03',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    )
                ]
            },

            cemig: {
                activities: [
                    createDemoActivity(
                        'demo-cemig-1',
                        {
                            ID: 'DEMO-CEMIG-001',
                            UNIDADE:
                                'Unidade fictícia CEMIG Centro',
                            MUNICIPIO: 'Belo Horizonte',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    ),

                    createDemoActivity(
                        'demo-cemig-2',
                        {
                            ID: 'DEMO-CEMIG-002',
                            UNIDADE:
                                'Unidade fictícia CEMIG Norte',
                            MUNICIPIO: 'Montes Claros',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    )
                ]
            },

            'banco-brasil': {
                activities: [
                    createDemoActivity(
                        'demo-bb-1',
                        {
                            ID: 'DEMO-BB-001',
                            UNIDADE:
                                'Unidade fictícia Banco do Brasil 01',
                            MUNICIPIO: 'Brasília',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    ),

                    createDemoActivity(
                        'demo-bb-2',
                        {
                            ID: 'DEMO-BB-002',
                            UNIDADE:
                                'Unidade fictícia Banco do Brasil 02',
                            MUNICIPIO: 'São Paulo',
                            PRODUTO: 'CONFIGURAÇÃO LÓGICA'
                        }
                    )
                ]
            }
        },

        auditLog: []
    };
}


/* ============================================================
   3. ARMAZENAMENTO LOCAL DA DEMONSTRAÇÃO
============================================================ */

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (saved) {
            const parsed = JSON.parse(saved);

            if (
                parsed &&
                parsed.projects &&
                Array.isArray(parsed.auditLog)
            ) {
                for (const project of PROJECTS) {
                    if (!parsed.projects[project.id]) {
                        parsed.projects[project.id] = {
                            activities: []
                        };
                    }

                    if (
                        !Array.isArray(
                            parsed.projects[project.id].activities
                        )
                    ) {
                        parsed.projects[project.id].activities = [];
                    }
                }

                return parsed;
            }
        }
    } catch (error) {
        console.error(
            'Erro ao carregar a demonstração:',
            error
        );
    }

    const initial = createSeedState();

    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(initial)
        );
    } catch (error) {
        console.error(
            'Não foi possível salvar a demonstração:',
            error
        );
    }

    return initial;
}

function saveState() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(state)
        );

        return true;
    } catch (error) {
        console.error(
            'Falha no armazenamento local:',
            error
        );

        toast(
            'O navegador não conseguiu salvar. O armazenamento pode estar cheio.',
            true
        );

        return false;
    }
}

function logAction(action, detail) {
    state.auditLog.unshift({
        id: newId(),
        projectId: currentProjectId,
        at: new Date().toISOString(),
        action,
        user: DEMO_ACTOR,
        detail
    });

    if (state.auditLog.length > MAX_HISTORY) {
        state.auditLog.length = MAX_HISTORY;
    }
}


/* ============================================================
   4. DADOS DA PLANILHA
============================================================ */

function getFieldValue(rawData, aliases) {
    for (const [key, value] of Object.entries(rawData || {})) {
        if (!aliases.includes(normalizeHeader(key))) {
            continue;
        }

        const cleaned = cleanCell(value);

        if (cleaned) {
            return cleaned;
        }
    }

    return '';
}

function findTitleFromData(rawData) {
    return getFieldValue(rawData, [
        'ATIVIDADE',
        'TITULO',
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
        'IDENTIFICADOR'
    ]);
}

function findCityFromData(rawData) {
    return getFieldValue(rawData, [
        'MUNICIPIO',
        'CIDADE',
        'MUNICIPIO DA UNIDADE'
    ]);
}

function stableFingerprint(rawData) {
    const canonical = Object.keys(rawData)
        .sort((a, b) => a.localeCompare(b))
        .map(key =>
            `${normalizeText(key)}=${normalizeText(rawData[key])}`
        )
        .join('|');

    let hash = 2166136261;

    for (let index = 0; index < canonical.length; index++) {
        hash ^= canonical.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `row-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function toSafeRawData(row) {
    const result = {};

    for (const [key, value] of Object.entries(row)) {
        const header = String(key || '').trim();
        const cell = cleanCell(value);

        if (!header || !cell) {
            continue;
        }

        result[header] = cell.slice(0, 4000);
    }

    return result;
}


/* ============================================================
   5. NAVEGAÇÃO
============================================================ */

function setView(viewName) {
    const allowed = [
        'projects',
        'dashboard',
        'import',
        'history'
    ];

    if (!allowed.includes(viewName)) {
        viewName = 'projects';
    }

    if (
        viewName !== 'projects' &&
        !currentProjectId
    ) {
        viewName = 'projects';
    }

    if (viewName === 'projects') {
        currentProjectId = null;
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

    const project = getProject();

    const projectLabel = $('#current-project-label');

    projectLabel.hidden = !project;

    projectLabel.textContent =
        project ? project.name : '';

    if (viewName === 'dashboard') {
        renderDashboard();
    }

    if (viewName === 'import') {
        resetImportView();
    }

    if (viewName === 'history') {
        renderHistory();
    }

    const hash = viewName === 'projects'
        ? '#projects'
        : `#${viewName}`;

    if (location.hash !== hash) {
        history.replaceState(null, '', hash);
    }
}

function selectProject(projectId) {
    if (!getProject(projectId)) {
        return;
    }

    currentProjectId = projectId;

    setView('dashboard');
}


/* ============================================================
   6. CARTÕES DOS PROJETOS
============================================================ */

function renderProjectCards() {
    const container = $('#project-cards');

    container.innerHTML = PROJECTS.map(project => {
        const activities = getActivities(project.id);

        const adopted = activities.filter(
            activity => activity.adopted
        ).length;

        const active = activities.filter(
            isInProgress
        ).length;

        return `
            <article class="project-card">
                <div class="project-card-top">
                    <span class="project-icon">
                        ${esc(project.icon)}
                    </span>

                    <span class="project-count">
                        ${activities.length} atividades
                    </span>
                </div>

                <h2>${esc(project.name)}</h2>

                <p>${esc(project.description)}</p>

                <span class="project-card-meta">
                    ${adopted} adotadas · ${active} em andamento
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
        `;
    }).join('');
}


/* ============================================================
   7. CRONÔMETRO
============================================================ */

function elapsedSeconds(activity) {
    const startValue =
        activity.startedAt ||
        activity.adoptedAt;

    if (!startValue) {
        return 0;
    }

    const start = new Date(startValue).getTime();

    if (!Number.isFinite(start)) {
        return 0;
    }

    const finalValue =
        FINAL_STATUSES.has(activity.status)
            ? activity.completedAt
            : null;

    const end = finalValue
        ? new Date(finalValue).getTime()
        : Date.now();

    if (!Number.isFinite(end)) {
        return 0;
    }

    return Math.max(
        0,
        Math.floor((end - start) / 1000)
    );
}

function isInProgress(activity) {
    return (
        activity.adopted &&
        Boolean(activity.startedAt) &&
        !FINAL_STATUSES.has(activity.status)
    );
}

function updateElapsedDisplays() {
    $$('[data-elapsed-activity-id]').forEach(element => {
        const activity = currentActivity(
            element.dataset.elapsedActivityId
        );

        if (activity?.adopted) {
            element.textContent =
                formatDuration(elapsedSeconds(activity));
        }
    });

    if (currentProjectId) {
        const seconds = getActivities()
            .filter(isInProgress)
            .reduce(
                (sum, activity) =>
                    sum + elapsedSeconds(activity),
                0
            );

        $('#kpi-active-time').textContent =
            `Tempo acumulado: ${formatDuration(seconds)}`;
    }
}


/* ============================================================
   8. RESUMO DOS TOTAIS
============================================================ */

function renderSummary() {
    const activities = getActivities();

    const active = activities.filter(
        isInProgress
    );

    $('#kpi-total').textContent =
        activities.length;

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

    $('#kpi-completed').textContent =
        activities.filter(activity =>
            activity.status === 'ATIVIDADE_MIGRADA'
        ).length;

    $('#kpi-blocked').textContent =
        activities.filter(activity =>
            activity.status === 'IMPEDIMENTO'
        ).length;

    const seconds = active.reduce(
        (sum, activity) =>
            sum + elapsedSeconds(activity),
        0
    );

    $('#kpi-active-time').textContent =
        `Tempo acumulado: ${formatDuration(seconds)}`;
}


/* ============================================================
   9. PESQUISA
============================================================ */

function searchableText(activity) {
    const rawFields = Object.entries(
        activity.rawData || {}
    )
        .map(([key, value]) =>
            `${key} ${cleanCell(value)}`
        )
        .join(' ');

    return normalizeText([
        activity.id,
        activity.identifier,
        activity.title,
        activity.city,
        activity.status,
        STATUS[activity.status]?.label,
        activity.assignedTo,
        activity.adoptedBy,
        rawFields
    ].join(' '));
}

function statusBadge(status) {
    const info = STATUS[status] || STATUS.PENDENTE;

    return `
        <span class="status-badge ${info.css}">
            ${esc(info.label)}
        </span>
    `;
}


/* ============================================================
   10. TABELA DE ATIVIDADES
============================================================ */

function renderActivityRows() {
    const activities = getActivities();

    const query = normalizeText(
        $('#activity-search').value
    );

    const statusFilter = $('#status-filter').value;
    const adoptionFilter = $('#adoption-filter').value;

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
            const identifier =
                activity.identifier ||
                String(activity.id);

            const title =
                activity.title ||
                'Atividade sem título';

            const city =
                activity.city ||
                '—';

            const responsible =
                activity.adoptedBy ||
                activity.assignedTo ||
                '';

            const analystName = responsible
                ? firstName(responsible)
                : '—';

            const elapsed = activity.adopted
                ? formatDuration(elapsedSeconds(activity))
                : '—';

            const adoptionText = activity.adopted
                ? `Adotada por ${activity.adoptedBy}`
                : activity.assignedTo
                    ? `Atribuída a ${activity.assignedTo}`
                    : 'Disponível';

            let statusControl;

            if (
                activity.adopted &&
                !FINAL_STATUSES.has(activity.status)
            ) {
                statusControl = `
                    <select
                        class="status-select"
                        aria-label="Atualizar etapa de ${esc(identifier)}"
                        data-action="change-status"
                        data-activity-id="${esc(activity.id)}"
                    >
                        ${WORKFLOW_STATUSES.map(status => `
                            <option
                                value="${status}"
                                ${activity.status === status ? 'selected' : ''}
                            >
                                ${esc(STATUS[status].label)}
                            </option>
                        `).join('')}
                    </select>
                `;
            } else {
                statusControl = statusBadge(activity.status);
            }

            let actions = '';

            if (!activity.adopted) {
                actions += `
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
                actions = `
                    <span class="assigned-label">
                        Já adotada
                    </span>
                `;
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
                            Clique na linha para ver os campos
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
                            ${esc(elapsed)}
                        </span>
                    </td>

                    <td>${statusControl}</td>

                    <td>
                        <span class="adoption-label ${activity.assignedTo || activity.adopted ? 'adopted' : ''}">
                            ${esc(adoptionText)}
                        </span>
                    </td>

                    <td class="activity-actions-cell">
                        <div class="activity-actions">
                            ${actions}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    $('#activities-empty').hidden =
        filtered.length > 0;

    renderSummary();
}

function renderDashboard() {
    const project = getProject();

    if (!project) {
        setView('projects');
        return;
    }

    $('#project-eyebrow').textContent =
        `PROJETO ${project.shortName}`;

    $('#dashboard-title').textContent =
        `Atividades — ${project.name}`;

    renderSummary();
    renderActivityRows();
}


/* ============================================================
   11. DETALHES DA ATIVIDADE
============================================================ */

function renderActivityDetails(activityId) {
    const activity = currentActivity(activityId);

    if (!activity) {
        toast('Atividade não encontrada.', true);
        return;
    }

    $('#detail-title').textContent =
        activity.title || 'Detalhes da atividade';

    $('#detail-subtitle').textContent =
        `Identificador: ${activity.identifier} · ` +
        `${STATUS[activity.status]?.label || activity.status}`;

    const metadata = [
        [
            'Status',
            STATUS[activity.status]?.label || activity.status
        ],
        [
            'Responsável atribuído',
            activity.assignedTo || 'Não atribuída'
        ],
        [
            'Atribuída em',
            formatDateTime(activity.assignedAt)
        ],
        [
            'Analista que adotou',
            activity.adoptedBy || 'Não adotada'
        ],
        [
            'Início do cronômetro',
            formatDateTime(activity.startedAt)
        ],
        [
            'Tempo de atividade',
            activity.adopted
                ? formatDuration(elapsedSeconds(activity))
                : 'Não iniciado'
        ],
        [
            'Finalização',
            formatDateTime(activity.completedAt)
        ],
        [
            'Importação',
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

    // Visualizar detalhes não altera a atividade.
    $('#activity-detail-dialog').showModal();
}


/* ============================================================
   12. ATRIBUIR ANALISTA FICTÍCIO
============================================================ */

function openAssignDialog(activityId) {
    const activity = currentActivity(activityId);

    if (!activity || activity.adopted) {
        toast(
            'Esta atividade não está disponível para atribuição.',
            true
        );

        return;
    }

    assigningActivityId = activity.id;

    $('#assign-activity-label').textContent =
        `${activity.identifier} — ${activity.title}`;

    $('#assign-analyst-select').innerHTML =
        '<option value="">Selecione um analista</option>' +
        DEMO_ANALYSTS.map(analyst => `
            <option
                value="${esc(analyst.id)}"
                ${activity.assignedToId === analyst.id ? 'selected' : ''}
            >
                ${esc(analyst.name)}
            </option>
        `).join('');

    $('#assign-dialog').showModal();
}

function submitAssignment(event) {
    event.preventDefault();

    const activity = currentActivity(assigningActivityId);

    if (!activity || activity.adopted) {
        toast(
            'A atividade não pode mais ser atribuída.',
            true
        );

        $('#assign-dialog').close();
        return;
    }

    const analystId = $('#assign-analyst-select').value;

    const analyst = DEMO_ANALYSTS.find(
        item => item.id === analystId
    );

    if (!analyst) {
        toast('Selecione um analista.', true);
        return;
    }

    const previous = activity.assignedTo;

    activity.assignedToId = analyst.id;
    activity.assignedTo = analyst.name;
    activity.assignedAt = new Date().toISOString();

    logAction(
        previous
            ? 'Atribuição alterada'
            : 'Atividade atribuída',
        `${activity.identifier} · Responsável: ${analyst.name}`
    );

    if (!saveState()) return;

    $('#assign-dialog').close();

    assigningActivityId = null;

    renderProjectCards();
    renderDashboard();
    renderHistory();

    toast(
        `Atividade atribuída a ${analyst.name} na demonstração.`
    );
}


/* ============================================================
   13. ADOÇÃO E CRONÔMETRO
============================================================ */

function adoptActivity(activityId) {
    const activity = currentActivity(activityId);

    if (!activity || activity.adopted) {
        toast(
            'A atividade não está disponível para adoção.',
            true
        );

        return;
    }

    const actingName =
        activity.assignedTo ||
        DEMO_ACTOR;

    if (!confirm(
        `Adotar "${activity.title}" como ${actingName} e iniciar o cronômetro?`
    )) {
        return;
    }

    const now = new Date().toISOString();

    activity.adopted = true;
    activity.adoptedBy = actingName;

    activity.adoptedAt = now;
    activity.startedAt = now;

    activity.completedAt = null;

    activity.status = 'CONTATANDO_TECNICO';

    logAction(
        'Atividade adotada',
        `${activity.identifier} · ${activity.title} · ` +
        `Analista: ${actingName} · Cronômetro iniciado.`
    );

    if (!saveState()) return;

    renderProjectCards();
    renderDashboard();
    renderHistory();

    toast(
        'Atividade adotada. Cronômetro iniciado na demonstração!'
    );
}


/* ============================================================
   14. ATUALIZAR ETAPA
============================================================ */

function updateActivityStatus(activityId, nextStatus) {
    const activity = currentActivity(activityId);

    if (!activity || !activity.adopted) {
        toast(
            'Adote a atividade antes de alterar a etapa.',
            true
        );

        renderDashboard();
        return;
    }

    if (!WORKFLOW_STATUSES.includes(nextStatus)) {
        toast('Status inválido.', true);
        renderDashboard();
        return;
    }

    if (FINAL_STATUSES.has(activity.status)) {
        toast(
            'Esta atividade já foi finalizada.',
            true
        );

        renderDashboard();
        return;
    }

    if (activity.status === nextStatus) return;

    const oldLabel =
        STATUS[activity.status]?.label ||
        activity.status;

    const newLabel =
        STATUS[nextStatus]?.label ||
        nextStatus;

    activity.status = nextStatus;

    if (FINAL_STATUSES.has(nextStatus)) {
        activity.completedAt = new Date().toISOString();
    } else {
        activity.completedAt = null;
    }

    logAction(
        'Status atualizado',
        `${activity.identifier} · ${oldLabel} → ${newLabel}`
    );

    if (!saveState()) return;

    renderProjectCards();
    renderDashboard();
    renderHistory();

    toast(`Etapa atualizada: ${newLabel}.`);
}


/* ============================================================
   15. IMPORTAÇÃO LOCAL DE PLANILHAS
============================================================ */

async function prepareImport(event) {
    event.preventDefault();

    const file = $('#import-file').files?.[0];

    if (!file) {
        toast('Selecione um arquivo Excel ou CSV.', true);
        return;
    }

    if (file.size > MAX_IMPORT_BYTES) {
        toast(
            'O arquivo ultrapassa o limite de 20 MB.',
            true
        );

        return;
    }

    if (!window.XLSX) {
        toast(
            'A biblioteca Excel não foi carregada. Verifique a conexão e recarregue a página.',
            true
        );

        return;
    }

    const extension = file.name
        .split('.')
        .pop()
        .toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        toast(
            'Formato não suportado. Use XLSX, XLS ou CSV.',
            true
        );

        return;
    }

    $('#import-preview').hidden = false;

    $('#import-summary').textContent =
        'Lendo a planilha…';

    $('#import-preview-body').innerHTML = '';

    $('#confirm-import').disabled = true;

    try {
        const workbook = window.XLSX.read(
            await file.arrayBuffer(),
            { type: 'array' }
        );

        const firstSheet = workbook.SheetNames[0];

        if (!firstSheet) {
            throw new Error(
                'Nenhuma aba encontrada no arquivo.'
            );
        }

        const rows = window.XLSX.utils.sheet_to_json(
            workbook.Sheets[firstSheet],
            {
                defval: '',
                raw: false
            }
        );

        if (!rows.length) {
            throw new Error(
                'A primeira aba da planilha está vazia.'
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

            const identifier =
                findIdentifierFromData(rawData);

            const title =
                findTitleFromData(rawData);

            if (!identifier && !title) {
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
                title: title || `Atividade ${identifier}`,
                city: findCityFromData(rawData),
                rawData
            });
        }

        if (!validRows.length) {
            throw new Error(
                'Nenhuma linha válida foi encontrada. Confira os campos ID, UNIDADE ou ATIVIDADE.'
            );
        }

        pendingImport = {
            projectId: currentProjectId,
            fileName: file.name,
            totalRows: rows.length,
            ignored,
            rows: validRows
        };

        renderImportPreview();
    } catch (error) {
        pendingImport = null;

        $('#import-summary').textContent =
            error.message ||
            'Não foi possível analisar o arquivo.';

        $('#confirm-import').disabled = true;

        toast(error.message, true);
    }
}

function renderImportPreview() {
    if (!pendingImport) return;

    const rows = pendingImport.rows;

    $('#import-preview-count').textContent =
        `${rows.length} atividades novas`;

    $('#import-summary').innerHTML = `
        Arquivo: <strong>${esc(pendingImport.fileName)}</strong><br>
        Linhas lidas: <strong>${pendingImport.totalRows}</strong> ·
        Linhas válidas: <strong>${rows.length}</strong> ·
        Linhas ignoradas ou repetidas no arquivo:
        <strong>${pendingImport.ignored}</strong>.
        <br>
        Os dados serão guardados somente neste navegador.
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
                        Mais ${rows.length - 12} atividades
                        serão importadas após a confirmação.
                    </td>
                </tr>
            `
        );
    }

    $('#confirm-import').disabled =
        rows.length === 0;
}

function confirmImport() {
    if (
        !pendingImport ||
        pendingImport.projectId !== currentProjectId
    ) {
        toast(
            'Volte ao projeto correto e analise a planilha novamente.',
            true
        );

        return;
    }

    const target = getActivities();
    const existingKeys = new Set(
        target.map(activity => activity.rowKey)
    );

    let added = 0;
    let duplicates = 0;

    const newActivities = [];

    for (const item of pendingImport.rows) {
        if (existingKeys.has(item.rowKey)) {
            duplicates++;
            continue;
        }

        newActivities.push({
            id: `import-${newId()}`,
            rowKey: item.rowKey,
            rawData: item.rawData,

            identifier: item.identifier,
            title: item.title,
            city: item.city,

            status: 'PENDENTE',

            assignedToId: null,
            assignedTo: '',
            assignedAt: null,

            adopted: false,
            adoptedBy: '',
            adoptedAt: null,
            startedAt: null,
            completedAt: null,

            createdAt: new Date().toISOString()
        });

        existingKeys.add(item.rowKey);
        added++;
    }

    const previousLength = target.length;

    target.push(...newActivities);

    logAction(
        'Planilha importada',
        `${pendingImport.fileName} · ` +
        `${added} atividades adicionadas · ` +
        `${duplicates} duplicatas ignoradas.`
    );

    if (!saveState()) {
        target.splice(previousLength);
        return;
    }

    pendingImport = null;

    $('#import-form').reset();

    resetImportView();

    renderProjectCards();
    renderDashboard();
    renderHistory();

    setView('dashboard');

    toast(
        `Importação concluída: ${added} novas atividades, ${duplicates} duplicatas ignoradas.`
    );
}

function cancelImport() {
    pendingImport = null;

    $('#import-form').reset();

    resetImportView();

    toast('Importação cancelada.');
}

function resetImportView() {
    if (pendingImport) return;

    $('#import-preview').hidden = true;

    $('#import-summary').textContent = '';
    $('#import-preview-body').innerHTML = '';

    $('#confirm-import').disabled = true;
}


/* ============================================================
   16. HISTÓRICO LOCAL
============================================================ */

function renderHistory() {
    const query = normalizeText(
        $('#history-search').value
    );

    const actionSelect = $('#history-action-filter');
    const previousValue = actionSelect.value;

    const entries = state.auditLog.filter(entry =>
        entry.projectId === currentProjectId
    );

    const actions = [
        ...new Set(
            entries.map(entry => entry.action)
        )
    ].sort((a, b) =>
        a.localeCompare(b, 'pt-BR')
    );

    actionSelect.innerHTML =
        '<option value="">Todas as ações</option>' +
        actions.map(action => `
            <option value="${esc(action)}">
                ${esc(action)}
            </option>
        `).join('');

    if (actions.includes(previousValue)) {
        actionSelect.value = previousValue;
    }

    const actionFilter = actionSelect.value;

    const filtered = [...entries]
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

            const text = normalizeText([
                entry.action,
                entry.user,
                entry.detail
            ].join(' '));

            return !query || text.includes(query);
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
                    ${esc(entry.detail)}
                </td>
            </tr>
        `).join('');

    $('#history-empty').hidden =
        filtered.length > 0;
}

function exportHistoryCSV() {
    const entries = state.auditLog.filter(entry =>
        entry.projectId === currentProjectId
    );

    const rows = [
        ['Data', 'Ação', 'Usuário', 'Detalhe'],

        ...entries.map(entry => [
            entry.at,
            entry.action,
            entry.user,
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
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download =
        `oviv-historico-${currentProjectId}.csv`;

    document.body.appendChild(anchor);

    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);

    toast('Histórico exportado.');
}


/* ============================================================
   17. RESTAURAR EXEMPLOS
============================================================ */

function resetDemo() {
    if (!confirm(
        'Restaurar os exemplos? Isso apagará as atividades importadas e o histórico salvo nesta demonstração.'
    )) {
        return;
    }

    state = createSeedState();

    saveState();

    currentProjectId = null;
    pendingImport = null;
    assigningActivityId = null;

    renderProjectCards();

    setView('projects');

    toast('Exemplos restaurados.');
}


/* ============================================================
   18. EVENTOS
============================================================ */

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');

    if (nav) {
        event.preventDefault();

        setView(nav.dataset.nav);
        return;
    }

    const openImport =
        event.target.closest('[data-open-import]');

    if (openImport) {
        setView('import');
        return;
    }

    const action =
        event.target.closest('[data-action]');

    if (!action) return;

    switch (action.dataset.action) {
        case 'open-project':
            selectProject(action.dataset.projectId);
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

        case 'assign-activity':
            event.stopPropagation();

            openAssignDialog(
                action.dataset.activityId
            );
            return;

        case 'adopt-activity':
            event.stopPropagation();

            adoptActivity(
                action.dataset.activityId
            );
            return;

        case 'change-status':
            return;

        case 'view-activity':
            renderActivityDetails(
                action.dataset.activityId
            );
            return;
    }
});

document.addEventListener('change', event => {
    const select = event.target.closest(
        'select[data-action="change-status"]'
    );

    if (!select) return;

    updateActivityStatus(
        select.dataset.activityId,
        select.value
    );
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


/* ============================================================
   19. EVENTOS DOS CONTROLES
============================================================ */

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

$('#open-import').addEventListener('click', () => {
    setView('import');
});

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

$('#reset-demo').addEventListener(
    'click',
    resetDemo
);

$('#assign-form').addEventListener(
    'submit',
    submitAssignment
);

$('#assign-close').addEventListener('click', () => {
    assigningActivityId = null;
    $('#assign-dialog').close();
});

$('#assign-cancel').addEventListener('click', () => {
    assigningActivityId = null;
    $('#assign-dialog').close();
});

$('#close-detail').addEventListener(
    'click',
    () => $('#activity-detail-dialog').close()
);

$('#activity-detail-dialog').addEventListener(
    'click',
    event => {
        if (event.target === $('#activity-detail-dialog')) {
            $('#activity-detail-dialog').close();
        }
    }
);


/* ============================================================
   20. INICIALIZAÇÃO
============================================================ */

// Nenhuma chamada a /api/auth, /api/oviv ou ao PostgreSQL.
// O login está temporariamente suspenso na interface.

state = loadState();

renderProjectCards();

setView('projects');

window.setInterval(
    updateElapsedDisplays,
    1000
);