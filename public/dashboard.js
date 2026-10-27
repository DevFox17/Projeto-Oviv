'use strict';

/*
 * OVIV — Dashboard integrado ao Node.js e PostgreSQL.
 *
 * Login e identidade: /api/auth
 * Projetos e atividades: /api/oviv
 *
 * Não utiliza localStorage como fonte de verdade.
 */

const API_BASE = '/api/oviv';
const AUTH_BASE = '/api/auth';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const IMPORT_BATCH_SIZE = 100;

const PROJECT_ICONS = {
    copasa: 'C',
    cemig: 'E',
    'banco-brasil': 'B'
};

const MANAGER_ROLES = new Set([
    'GP',
    'GESTOR',
    'GERENTE',
    'GERENTE_PROJETO',
    'GERENTE DE PROJETO',
    'ADMIN',
    'ADMINISTRADOR'
]);

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

    // Compatibilidade com status legados.
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

let authenticatedUser = null;

let currentProjects = [];
let currentActivities = [];
let currentHistory = [];
let analystsCache = [];

let currentProjectId = null;
let currentView = 'projects';

let pendingImport = null;
let assigningActivityId = null;

let toastTimer = null;
let isRefreshing = false;


/* =========================================================
   1. UTILITÁRIOS
========================================================= */

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
    const normalized = String(fullName || '').trim();

    return normalized
        ? normalized.split(/\s+/)[0]
        : '—';
}

function formatDateTime(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
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

    if (!element) return;

    element.textContent = String(message);

    element.className = isError
        ? 'toast error'
        : 'toast';

    element.hidden = false;

    if (toastTimer) {
        clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
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


/* =========================================================
   2. COMUNICAÇÃO COM A API
========================================================= */

async function requestJson(url, options = {}) {
    let response;

    try {
        response = await fetch(url, {
            ...options,

            credentials: 'same-origin',

            headers: {
                ...(options.body
                    ? {
                        'Content-Type': 'application/json'
                    }
                    : {}),

                ...(options.headers || {})
            }
        });
    } catch (error) {
        throw new Error(
            'Não foi possível conectar ao servidor. Confira se o npm start está em execução.'
        );
    }

    let payload = null;

    const contentType =
        response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        payload = await response.json().catch(() => null);
    } else {
        const text = await response.text().catch(() => '');

        payload = text
            ? { message: text }
            : null;
    }

    if (!response.ok) {
        const error = new Error(
            payload?.message ||
            `Erro HTTP ${response.status}.`
        );

        error.status = response.status;
        error.payload = payload;

        throw error;
    }

    return payload;
}

function apiRequest(path, options = {}) {
    return requestJson(
        `${API_BASE}${path}`,
        options
    );
}

function authRequest(path, options = {}) {
    return requestJson(
        `${AUTH_BASE}${path}`,
        options
    );
}

function jsonBody(method, data) {
    return {
        method,
        body: JSON.stringify(data)
    };
}


/* =========================================================
   3. AUTENTICAÇÃO E PERFIS
========================================================= */

function normalizeRole(role) {
    return String(role || '')
        .trim()
        .toUpperCase();
}

function isManagerUser() {
    return MANAGER_ROLES.has(
        normalizeRole(authenticatedUser?.role)
    );
}

function isAnalystUser() {
    return (
        normalizeRole(authenticatedUser?.role) ===
        'ANALISTA'
    );
}

function getLoggedUserId() {
    const id = Number(authenticatedUser?.id);

    return Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

function getLoggedUserName() {
    return authenticatedUser?.name || '';
}

function ensureUserLabel() {
    const container = $('.topbar-right');

    if (!container) return;

    if ($('#current-user-label')) return;

    const label = document.createElement('span');

    label.id = 'current-user-label';
    label.className = 'current-project-label';
    label.textContent = '';

    const badge = $('.demo-badge', container);

    if (badge) {
        container.insertBefore(label, badge);
    } else {
        container.prepend(label);
    }
}

function refreshUserLabel() {
    ensureUserLabel();

    const label = $('#current-user-label');

    if (!label) return;

    label.textContent = authenticatedUser
        ? `${authenticatedUser.name} · ${authenticatedUser.role}`
        : '';
}

function showAuthenticatedShell(isAuthenticated) {
    $('#auth-screen').hidden = isAuthenticated;

    const topbar = $('.topbar');
    const notice = $('.demo-notice');
    const shell = $('.app-shell');

    if (topbar) {
        topbar.hidden = !isAuthenticated;
    }

    if (notice) {
        notice.hidden = !isAuthenticated;
    }

    if (shell) {
        shell.hidden = !isAuthenticated;
    }
}

function setBackendNotice(connected, message = '') {
    const badge = $('.demo-badge');
    const notice = $('.demo-notice');

    if (badge) {
        badge.textContent = connected
            ? 'API + POSTGRESQL'
            : 'API DESCONECTADA';
    }

    if (notice) {
        notice.textContent = connected
            ? 'Conexão com o PostgreSQL estabelecida. Permissões de gestor e analista são verificadas pelo servidor.'
            : `Falha de conexão: ${message || 'verifique se o servidor está funcionando.'}`;
    }

    const importSubtitle =
        $('#view-import .page-heading .subtitle');

    if (importSubtitle) {
        importSubtitle.textContent =
            'A planilha é processada no navegador e as linhas selecionadas são enviadas à API para armazenamento no PostgreSQL.';
    }

    const privacyNote =
        $('#view-import .privacy-note');

    if (privacyNote) {
        privacyNote.textContent =
            'Os valores extraídos das linhas importadas serão armazenados no PostgreSQL. O arquivo Excel original não é enviado como arquivo. Importe somente dados que você tem autorização para utilizar.';
    }

    const warningNote =
        $('#view-import .warning-note');

    if (warningNote) {
        warningNote.textContent =
            'Confira o projeto e a prévia antes de confirmar. As atividades importadas ficam disponíveis no servidor para os usuários autorizados.';
    }

    const historyWarning = $('.history-warning');

    if (historyWarning) {
        historyWarning.textContent =
            'O histórico é carregado do PostgreSQL e compartilhado entre os usuários autorizados do sistema.';
    }

    const importEyebrow =
        $('#view-import .eyebrow');

    if (importEyebrow) {
        importEyebrow.textContent =
            'IMPORTAÇÃO PARA O SERVIDOR';
    }
}

function updateRoleVisibility() {
    const manager = isManagerUser();

    const managerPanel = $('#manager-panel');
    const importButton = $('#open-import');

    if (managerPanel) {
        managerPanel.hidden = !manager;
    }

    if (importButton) {
        importButton.hidden = !manager;
    }

    refreshUserLabel();
}

async function handleLogin(event) {
    event.preventDefault();

    const button = $('#login-submit');
    const message = $('#login-message');

    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;

    message.textContent = '';

    button.disabled = true;
    button.textContent = 'Entrando…';

    try {
        const result = await authRequest(
            '/login',
            jsonBody('POST', {
                email,
                password
            })
        );

        authenticatedUser = result.user;

        $('#login-password').value = '';

        await onAuthenticated();
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = 'Entrar';
    }
}

async function handleLogout() {
    try {
        await authRequest(
            '/logout',
            {
                method: 'POST'
            }
        );
    } catch (error) {
        console.error(
            'Erro ao encerrar a sessão:',
            error.message
        );
    }

    authenticatedUser = null;

    currentProjects = [];
    currentActivities = [];
    currentHistory = [];
    analystsCache = [];

    currentProjectId = null;
    pendingImport = null;
    assigningActivityId = null;

    $('#manager-panel').hidden = true;

    showAuthenticatedShell(false);

    $('#login-form').reset();

    $('#login-message').textContent =
        'Sessão encerrada. Entre novamente para continuar.';

    $('#login-email').focus();
}

async function initializeAuthentication() {
    ensureUserLabel();

    showAuthenticatedShell(false);

    try {
        const result = await authRequest('/me');

        if (!result?.user) {
            throw new Error(
                'O servidor não retornou o usuário autenticado.'
            );
        }

        authenticatedUser = result.user;

        await onAuthenticated();
    } catch (error) {
        if (error.status === 401) {
            $('#login-email').focus();
            return;
        }

        $('#login-message').textContent =
            'Não foi possível verificar a sessão. Confira se a API de autenticação está registrada no servidor.';

        console.error(
            'Falha ao verificar a sessão:',
            error.message
        );
    }
}

async function onAuthenticated() {
    if (!authenticatedUser) {
        showAuthenticatedShell(false);
        return;
    }

    showAuthenticatedShell(true);

    refreshUserLabel();
    updateRoleVisibility();

    currentProjectId = null;
    currentActivities = [];
    currentHistory = [];

    setView('projects');

    try {
        await loadProjects();

        if (isManagerUser()) {
            await loadAnalysts();
        }
    } catch (error) {
        toast(error.message, true);
    }
}


/* =========================================================
   4. LEITURA DOS DADOS DE ATIVIDADE
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

function normalizeProject(row) {
    return {
        id: String(row.id),
        name: row.name || row.id,
        description: row.description || '',

        icon:
            PROJECT_ICONS[row.id] ||
            String(row.name || 'O').slice(0, 1),

        total: Number(row.total || 0),
        pending: Number(row.pending || 0),
        adopted: Number(row.adopted || 0),
        inProgress: Number(row.in_progress || 0),
        completed: Number(row.completed || 0),
        blocked: Number(row.blocked || 0)
    };
}

function normalizeActivity(row) {
    const rawData =
        row.source_row &&
        typeof row.source_row === 'object'
            ? row.source_row
            : {};

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

        assignedToId:
            row.assigned_to_user_id == null
                ? null
                : Number(row.assigned_to_user_id),

        assignedTo:
            row.assigned_to_name || '',

        assignedById:
            row.assigned_by_user_id == null
                ? null
                : Number(row.assigned_by_user_id),

        assignedAt: row.assigned_at || null,

        adoptedById:
            row.adopted_by_user_id == null
                ? null
                : Number(row.adopted_by_user_id),

        adoptedBy:
            row.analyst_name ||
            row.adopted_by_name ||
            '',

        adopted: row.adopted_by_user_id != null,

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
        projectId: row.project_id,
        activityId: row.activity_id,
        identifier: row.activity_identifier || '',
        at: row.created_at,
        action: row.action || 'Ação',
        user: row.user_name || 'Sistema',
        previousStatus: row.previous_status || '',
        newStatus: row.new_status || '',
        detail: row.details || ''
    };
}


/* =========================================================
   5. CARREGAR PROJETOS, ATIVIDADES E HISTÓRICO
========================================================= */

async function loadProjects() {
    try {
        const result = await apiRequest('/projects');

        currentProjects = (result.projects || [])
            .map(normalizeProject);

        setBackendNotice(true);

        renderProjectCards();

        if (
            currentProjectId &&
            !currentProjects.some(
                project => project.id === currentProjectId
            )
        ) {
            currentProjectId = null;
            setView('projects');
        }

        return currentProjects;
    } catch (error) {
        setBackendNotice(false, error.message);
        throw error;
    }
}

async function loadActivities(projectId = currentProjectId) {
    if (!projectId) {
        currentActivities = [];
        renderActivityRows();
        return [];
    }

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
    if (!projectId) {
        currentHistory = [];
        renderHistory();
        return [];
    }

    const result = await apiRequest(
        `/projects/${encodeURIComponent(projectId)}/history?limit=1000`
    );

    currentHistory = (result.history || [])
        .map(normalizeHistory);

    renderHistory();

    return currentHistory;
}

async function refreshCurrentProject({ silent = false } = {}) {
    if (
        !authenticatedUser ||
        !currentProjectId ||
        isRefreshing
    ) {
        return;
    }

    if (
        document.activeElement?.matches(
            'select[data-action="change-status"]'
        )
    ) {
        return;
    }

    isRefreshing = true;

    try {
        await Promise.all([
            loadActivities(currentProjectId),
            loadHistory(currentProjectId),
            loadProjects()
        ]);

        if (currentView === 'dashboard') {
            renderDashboard();
        }
    } catch (error) {
        if (!silent) {
            toast(error.message, true);
        }

        console.error(
            'Falha ao atualizar as atividades:',
            error.message
        );
    } finally {
        isRefreshing = false;
    }
}


/* =========================================================
   6. CARTÕES DE PROJETOS
========================================================= */

function renderProjectCards() {
    const container = $('#project-cards');

    if (!container) return;

    if (!currentProjects.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>Nenhum projeto encontrado</strong>
                <p>Verifique a tabela oviv_projects no PostgreSQL.</p>
                <button
                    class="button button-primary"
                    type="button"
                    data-action="reload-projects"
                >
                    Atualizar projetos
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


/* =========================================================
   7. NAVEGAÇÃO
========================================================= */

function setView(viewName) {
    const validViews = [
        'projects',
        'dashboard',
        'import',
        'history'
    ];

    if (!validViews.includes(viewName)) {
        viewName = 'projects';
    }

    if (!authenticatedUser) {
        showAuthenticatedShell(false);
        return;
    }

    if (
        viewName !== 'projects' &&
        !currentProjectId
    ) {
        viewName = 'projects';
    }

    if (
        viewName === 'import' &&
        !isManagerUser()
    ) {
        toast(
            'A importação de planilhas é exclusiva do gestor.',
            true
        );

        viewName = 'dashboard';
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

    const label = $('#current-project-label');

    if (label) {
        label.hidden = !project;
        label.textContent = project
            ? project.name
            : '';
    }

    if (location.hash !== `#${viewName}`) {
        history.replaceState(
            null,
            '',
            `#${viewName}`
        );
    }
}

async function navigateTo(viewName) {
    if (!authenticatedUser) {
        showAuthenticatedShell(false);
        return;
    }

    if (viewName === 'projects') {
        currentProjectId = null;

        currentActivities = [];
        currentHistory = [];

        setView('projects');

        await loadProjects().catch(error => {
            toast(error.message, true);
        });

        return;
    }

    if (!currentProjectId) {
        setView('projects');
        return;
    }

    setView(viewName);

    if (viewName === 'dashboard') {
        await loadActivities().catch(error => {
            toast(error.message, true);
        });
    }

    if (viewName === 'history') {
        await loadHistory().catch(error => {
            toast(error.message, true);
        });
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
            loadHistory(projectId)
        ]);

        renderDashboard();
    } catch (error) {
        toast(error.message, true);
    }
}


/* =========================================================
   8. CRONÔMETRO E INDICADORES
========================================================= */

function elapsedSeconds(activity) {
    const startValue =
        activity.startedAt ||
        activity.adoptedAt;

    if (!startValue) return 0;

    const start = new Date(startValue).getTime();

    if (!Number.isFinite(start)) return 0;

    const endValue =
        FINAL_STATUSES.has(activity.status) &&
        activity.completedAt
            ? activity.completedAt
            : null;

    const end = endValue
        ? new Date(endValue).getTime()
        : Date.now();

    if (!Number.isFinite(end)) return 0;

    return Math.max(
        0,
        Math.floor((end - start) / 1000)
    );
}

function isInProgress(activity) {
    return Boolean(activity.adopted) &&
        Boolean(activity.startedAt) &&
        !FINAL_STATUSES.has(activity.status);
}

function renderSummary() {
    const activities = currentActivities;

    const active = activities.filter(isInProgress);

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
            [
                'ATIVIDADE_MIGRADA',
                'CONCLUIDA'
            ].includes(activity.status)
        ).length;

    $('#kpi-blocked').textContent =
        activities.filter(activity =>
            activity.status === 'IMPEDIMENTO'
        ).length;

    const accumulatedSeconds = active.reduce(
        (sum, activity) =>
            sum + elapsedSeconds(activity),
        0
    );

    $('#kpi-active-time').textContent =
        `Tempo acumulado: ${formatDuration(accumulatedSeconds)}`;
}

function updateElapsedDisplays() {
    $$('[data-elapsed-activity-id]').forEach(element => {
        const activity = currentActivity(
            element.dataset.elapsedActivityId
        );

        if (activity?.adopted) {
            element.textContent = formatDuration(
                elapsedSeconds(activity)
            );
        }
    });

    if (currentProjectId) {
        const activeSeconds = currentActivities
            .filter(isInProgress)
            .reduce(
                (sum, activity) =>
                    sum + elapsedSeconds(activity),
                0
            );

        const element = $('#kpi-active-time');

        if (element) {
            element.textContent =
                `Tempo acumulado: ${formatDuration(activeSeconds)}`;
        }
    }
}

function statusBadge(status) {
    const info = STATUS[status] || STATUS.PENDENTE;

    return `
        <span class="status-badge ${info.css}">
            ${esc(info.label)}
        </span>
    `;
}


/* =========================================================
   9. PESQUISA EM TODOS OS CAMPOS
========================================================= */

function searchableText(activity) {
    const sourceText = Object.entries(
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
        sourceText
    ].join(' '));
}


/* =========================================================
   10. TABELA DE ATIVIDADES
========================================================= */

function renderActivityRows() {
    const query = normalizeText(
        $('#activity-search').value
    );

    const statusFilter =
        $('#status-filter').value;

    const adoptionFilter =
        $('#adoption-filter').value;

    const userId = getLoggedUserId();

    const manager = isManagerUser();
    const analyst = isAnalystUser();

    const filtered = currentActivities.filter(activity => {
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
        `${filtered.length} de ${currentActivities.length} atividades`;

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
                activity.adopted
                    ? activity.adoptedBy
                    : activity.assignedTo;

            const analystName = responsible
                ? firstName(responsible)
                : '—';

            const time = activity.adopted
                ? formatDuration(elapsedSeconds(activity))
                : '—';

            let adoptionText = 'Disponível';

            if (activity.adopted) {
                adoptionText =
                    `Adotada por ${activity.adoptedBy || 'Analista'}`;
            } else if (activity.assignedTo) {
                adoptionText =
                    `Atribuída a ${activity.assignedTo}`;
            }

            const adoptionClass =
                activity.adopted || activity.assignedTo
                    ? 'adoption-label adopted'
                    : 'adoption-label';

            const canChangeStatus =
                analyst &&
                activity.adopted &&
                Number(activity.adoptedById) === userId &&
                !FINAL_STATUSES.has(activity.status);

            const statusControl = canChangeStatus
                ? `
                    <select
                        class="status-select"
                        aria-label="Atualizar etapa da atividade ${esc(identifier)}"
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
                `
                : statusBadge(activity.status);

            let actionButtons = '';

            if (manager && !activity.adopted) {
                actionButtons += `
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

            if (analyst && !activity.adopted) {
                const canAdopt =
                    !activity.assignedToId ||
                    activity.assignedToId === userId;

                if (canAdopt) {
                    actionButtons += `
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
                    actionButtons += `
                        <span class="assigned-label">
                            Atribuída a outro analista
                        </span>
                    `;
                }
            }

            if (activity.adopted) {
                actionButtons += `
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
                            ${esc(adoptionText)}
                        </span>
                    </td>

                    <td class="activity-actions-cell">
                        <div class="activity-actions">
                            ${actionButtons || '—'}
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

    if (!project) return;

    $('#project-eyebrow').textContent =
        `PROJETO ${project.name}`;

    $('#dashboard-title').textContent =
        `Atividades — ${project.name}`;

    $('#open-import').hidden =
        !isManagerUser();

    renderSummary();
    renderActivityRows();
}


/* =========================================================
   11. DETALHES DA ATIVIDADE (SOMENTE LEITURA)
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
        `Identificador: ${activity.identifier} · ` +
        `${STATUS[activity.status]?.label || activity.status}`;

    const metadata = [
        [
            'Status no Oviv',
            STATUS[activity.status]?.label || activity.status
        ],
        [
            'Responsável atribuído',
            activity.assignedTo || 'Ainda não atribuído'
        ],
        [
            'Atribuída em',
            formatDateTime(activity.assignedAt)
        ],
        [
            'Responsável pela adoção',
            activity.adoptedBy || 'Ainda não adotada'
        ],
        [
            'Adoção iniciada em',
            formatDateTime(activity.adoptedAt)
        ],
        [
            'Tempo decorrido',
            activity.adopted
                ? formatDuration(elapsedSeconds(activity))
                : 'Cronômetro não iniciado'
        ],
        [
            'Finalizada em',
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

    // Abrir os detalhes não atribui nem adota uma atividade.
    $('#activity-detail-dialog').showModal();
}


/* =========================================================
   12. ADOÇÃO DA ATIVIDADE PELO ANALISTA
========================================================= */

async function adoptActivity(activityId) {
    const activity = currentActivity(activityId);

    if (!activity) {
        toast('Atividade não encontrada.', true);
        return;
    }

    if (!isAnalystUser()) {
        toast(
            'Entre com uma conta de analista para adotar atividades.',
            true
        );

        return;
    }

    if (activity.adopted) {
        toast('Esta atividade já foi adotada.', true);
        return;
    }

    const userId = getLoggedUserId();

    if (
        activity.assignedToId &&
        activity.assignedToId !== userId
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
   13. ATUALIZAÇÃO DE STATUS
========================================================= */

async function updateActivityStatus(
    activityId,
    nextStatus
) {
    const activity = currentActivity(activityId);

    if (
        !activity ||
        !isAnalystUser() ||
        activity.adoptedById !== getLoggedUserId()
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
            jsonBody('PATCH', {
                status: nextStatus
            })
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
   14. CADASTRO E LISTAGEM DE ANALISTAS (GESTOR)
========================================================= */

async function loadAnalysts() {
    if (!isManagerUser()) return [];

    const result = await authRequest('/analysts');

    analystsCache = result.analysts || [];

    $('#analysts-table-body').innerHTML =
        analystsCache.map(analyst => `
            <tr>
                <td>${esc(analyst.id)}</td>
                <td>${esc(analyst.name)}</td>
                <td>${esc(analyst.email)}</td>
                <td>${esc(analyst.employee_code || '—')}</td>
            </tr>
        `).join('');

    $('#analysts-empty').hidden =
        analystsCache.length > 0;

    renderAssignmentOptions();

    return analystsCache;
}

async function createAnalyst(event) {
    event.preventDefault();

    if (!isManagerUser()) {
        toast(
            'Somente o gestor pode cadastrar analistas.',
            true
        );

        return;
    }

    const button = $('#analyst-create-submit');

    const payload = {
        name: $('#analyst-full-name').value.trim(),
        email: $('#analyst-email').value.trim(),
        employeeCode: $('#analyst-code').value.trim(),
        password: $('#analyst-password').value
    };

    button.disabled = true;
    button.textContent = 'Cadastrando…';

    try {
        const result = await authRequest(
            '/analysts',
            jsonBody('POST', payload)
        );

        $('#analyst-create-form').reset();

        await loadAnalysts();

        toast(
            `Analista ${result.user.name} cadastrado com sucesso.`
        );
    } catch (error) {
        toast(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = 'Cadastrar analista';
    }
}


/* =========================================================
   15. ATRIBUIÇÃO DA ATIVIDADE PELO GESTOR
========================================================= */

function renderAssignmentOptions() {
    const select = $('#assign-analyst-select');

    if (!select) return;

    if (!analystsCache.length) {
        select.innerHTML = `
            <option value="">
                Nenhum analista ativo cadastrado
            </option>
        `;

        return;
    }

    select.innerHTML =
        '<option value="">Selecione um analista</option>' +
        analystsCache.map(analyst => `
            <option value="${esc(analyst.id)}">
                ${esc(analyst.name)}
            </option>
        `).join('');
}

async function openAssignDialog(activityId) {
    if (!isManagerUser()) {
        toast(
            'Somente o gestor pode atribuir atividades.',
            true
        );

        return;
    }

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

    try {
        await loadAnalysts();

        if (!analystsCache.length) {
            toast(
                'Cadastre um analista antes de atribuir atividades.',
                true
            );

            return;
        }

        $('#assign-analyst-select').value =
            activity.assignedToId
                ? String(activity.assignedToId)
                : '';

        $('#assign-dialog').showModal();
    } catch (error) {
        toast(error.message, true);
    }
}

async function submitAssignment(event) {
    event.preventDefault();

    if (
        !isManagerUser() ||
        !currentProjectId ||
        !assigningActivityId
    ) {
        toast(
            'Não foi possível identificar a atividade para atribuição.',
            true
        );

        return;
    }

    const analystId = Number(
        $('#assign-analyst-select').value
    );

    if (!Number.isSafeInteger(analystId) || analystId <= 0) {
        toast('Selecione um analista.', true);
        return;
    }

    const button = $('#assign-submit');

    button.disabled = true;
    button.textContent = 'Atribuindo…';

    try {
        await apiRequest(
            `/projects/${encodeURIComponent(currentProjectId)}/activities/${encodeURIComponent(assigningActivityId)}/assign`,
            jsonBody('PATCH', {
                analystId
            })
        );

        $('#assign-dialog').close();

        assigningActivityId = null;

        toast('Atividade atribuída com sucesso.');

        await refreshCurrentProject({
            silent: true
        });
    } catch (error) {
        toast(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = 'Confirmar atribuição';
    }
}


/* =========================================================
   16. IMPORTAÇÃO DE PLANILHAS (GESTOR)
========================================================= */

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

        if (!header || !cell) continue;

        result[header] = cell.slice(0, 4000);
    }

    return result;
}

function resetImportView() {
    if (pendingImport) return;

    $('#import-preview').hidden = true;
    $('#import-summary').textContent = '';
    $('#import-preview-body').innerHTML = '';

    $('#confirm-import').disabled = true;
}

async function prepareImport(event) {
    event.preventDefault();

    if (!isManagerUser()) {
        toast(
            'Somente o gestor pode importar planilhas.',
            true
        );

        return;
    }

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
            'A biblioteca Excel não foi carregada. Confira sua conexão e atualize a página.',
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
            {
                type: 'array'
            }
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
                'A primeira aba está vazia.'
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

            const identifier =
                findIdentifierFromData(rawData);

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
            'Não foi possível analisar a planilha.';

        $('#confirm-import').disabled = true;

        toast(error.message, true);
    }
}

function renderImportPreview() {
    if (!pendingImport) return;

    const rows = pendingImport.rows;

    $('#import-preview-count').textContent =
        `${rows.length} atividades para importar`;

    $('#import-summary').innerHTML = `
        Arquivo: <strong>${esc(pendingImport.fileName)}</strong><br>
        Linhas lidas: <strong>${pendingImport.totalRows}</strong> ·
        Linhas válidas: <strong>${rows.length}</strong> ·
        Linhas ignoradas: <strong>${pendingImport.ignored}</strong>.
        <br>
        Após a confirmação, as linhas serão enviadas à API e
        gravadas no PostgreSQL. Duplicatas já existentes no banco
        serão ignoradas pelo servidor.
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

    $('#confirm-import').disabled = false;
}

async function confirmImport() {
    if (
        !isManagerUser() ||
        !pendingImport ||
        pendingImport.projectId !== currentProjectId
    ) {
        toast(
            'Volte ao projeto correto e analise a planilha novamente.',
            true
        );

        return;
    }

    const rows = pendingImport.rows;
    const projectId = pendingImport.projectId;

    const button = $('#confirm-import');

    let imported = 0;
    let duplicates = 0;
    let invalid = 0;

    button.disabled = true;

    try {
        for (
            let index = 0;
            index < rows.length;
            index += IMPORT_BATCH_SIZE
        ) {
            const batch = rows.slice(
                index,
                index + IMPORT_BATCH_SIZE
            );

            button.textContent =
                `Enviando ${Math.min(index + batch.length, rows.length)} de ${rows.length}…`;

            const result = await apiRequest(
                `/projects/${encodeURIComponent(projectId)}/import`,
                jsonBody('POST', {
                    activities: batch
                })
            );

            imported += Number(result.imported || 0);
            duplicates += Number(result.duplicates || 0);
            invalid += Number(result.invalid || 0);
        }

        pendingImport = null;

        $('#import-form').reset();

        resetImportView();

        await refreshCurrentProject({
            silent: true
        });

        setView('dashboard');

        toast(
            `Importação concluída: ${imported} novas atividades, ${duplicates} duplicatas ignoradas e ${invalid} linhas inválidas.`
        );
    } catch (error) {
        toast(
            `A importação não foi concluída: ${error.message}. Verifique o projeto antes de tentar novamente.`,
            true
        );
    } finally {
        button.disabled = false;
        button.textContent = 'Confirmar importação';
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
   17. HISTÓRICO
========================================================= */

function renderHistory() {
    const query = normalizeText(
        $('#history-search').value
    );

    const select = $('#history-action-filter');
    const oldValue = select.value;

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

    if (actions.includes(oldValue)) {
        select.value = oldValue;
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

            const searchText = normalizeText([
                entry.action,
                entry.user,
                entry.detail,
                entry.identifier,
                entry.previousStatus,
                entry.newStatus
            ].join(' '));

            return !query || searchText.includes(query);
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
            'Identificador',
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
        {
            type: 'text/csv;charset=utf-8;'
        }
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

    toast('Histórico exportado para CSV.');
}


/* =========================================================
   18. EVENTOS DE CLIQUE E TECLADO
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
            await selectProject(
                action.dataset.projectId
            );
            return;

        case 'reload-projects':
            await loadProjects().catch(error => {
                toast(error.message, true);
            });
            return;

        case 'adopt-activity':
            event.stopPropagation();

            await adoptActivity(
                action.dataset.activityId
            );
            return;

        case 'assign-activity':
            event.stopPropagation();

            await openAssignDialog(
                action.dataset.activityId
            );
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
    }
});

document.addEventListener('change', async event => {
    const select = event.target.closest(
        'select[data-action="change-status"]'
    );

    if (!select) return;

    await updateActivityStatus(
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


/* =========================================================
   19. LIGAÇÃO DOS FORMULÁRIOS E BOTÕES
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

$('#assign-close').addEventListener('click', () => {
    assigningActivityId = null;
    $('#assign-dialog').close();
});

$('#assign-cancel').addEventListener('click', () => {
    assigningActivityId = null;
    $('#assign-dialog').close();
});

$('#open-import').addEventListener(
    'click',
    () => navigateTo('import')
);

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
   20. ATUALIZAÇÃO AUTOMÁTICA
========================================================= */

// Atualiza visualmente o cronômetro a cada segundo.
window.setInterval(
    updateElapsedDisplays,
    1000
);

// Atualiza dados compartilhados do servidor periodicamente.
window.setInterval(async () => {
    if (
        !authenticatedUser ||
        document.hidden
    ) {
        return;
    }

    if (currentProjectId) {
        await refreshCurrentProject({
            silent: true
        });
    } else {
        await loadProjects().catch(() => {});
    }
}, 6000);

window.addEventListener('focus', async () => {
    if (!authenticatedUser) return;

    if (currentProjectId) {
        await refreshCurrentProject({
            silent: true
        });
    } else {
        await loadProjects().catch(() => {});
    }
});

window.addEventListener('hashchange', async () => {
    if (!authenticatedUser) return;

    const requested = location.hash.slice(1);

    if (requested === 'projects') {
        await navigateTo('projects');
        return;
    }

    if (
        [
            'dashboard',
            'import',
            'history'
        ].includes(requested) &&
        currentProjectId
    ) {
        await navigateTo(requested);
    }
});


/* =========================================================
   21. INICIALIZAÇÃO
========================================================= */

ensureUserLabel();

// Esconde o sistema até que a sessão seja confirmada.
showAuthenticatedShell(false);

// Verifica se já existe uma sessão válida no servidor.
initializeAuthentication();