'use strict';

const STORAGE_KEY = 'oviv_project_demo_v1';
const DEMO_USER = 'Administrador (demo)';
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_HISTORY_ITEMS = 1500;

const PROJECTS = [
    {
        id: 'copasa',
        name: 'Projeto COPASA',
        shortName: 'COPASA',
        description: 'Atividades e configurações lógicas do projeto COPASA.',
        icon: 'C'
    },
    {
        id: 'cemig',
        name: 'Compania de energia',
        shortName: 'CEMIG',
        description: 'Atividades e configurações lógicas do projeto CEMIG.',
        icon: 'E'
    },
    {
        id: 'banco-brasil',
        name: 'Teste BC',
        shortName: 'BANCO DO BRASIL',
        description: 'Atividades e configurações lógicas do projeto Banco do Brasil.',
        icon: 'B'
    }
];

const STATUS = {
    PENDENTE: { label: 'Pendente', css: 'status-pending' },
    EM_CONFIGURACAO: { label: 'Em configuração', css: 'status-configuring' },
    CONCLUIDA: { label: 'Concluída', css: 'status-completed' },
    IMPEDIMENTO: { label: 'Impedimento', css: 'status-blocked' },
    CANCELADA: { label: 'Cancelada', css: 'status-cancelled' }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let toastTimer;
let currentProjectId = null;
let pendingImport = null;

function newId(prefix = 'act') {
    if (window.crypto?.randomUUID) {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function demoActivity(id, data, status = 'PENDENTE', adopted = false) {
    return {
        id,
        rowKey: `demo-${id}`,
        rawData: data,
        title: findTitleFromData(data) || `Atividade ${id}`,
        identifier: findIdentifierFromData(data) || String(id),
        city: findCityFromData(data) || '',
        status,
        adopted,
        adoptedBy: adopted ? DEMO_USER : null,
        adoptedAt: adopted
            ? new Date(Date.now() - 25 * 60_000).toISOString()
            : null,
        createdAt: new Date(Date.now() - 7 * 60_000).toISOString()
    };
}

// Dados inteiramente fictícios para a demonstração.
function seedData() {
    const copasaRows = [
        demoActivity('copasa-1', {
            ID: 'DEMO-2263651',
            UNIDADE: 'Unidade demonstrativa COPASA Centro',
            MUNICIPIO: 'Cidade exemplo - MG',
            'ID VGR': 'VGR-DEMO-01',
            'VELOCIDADE DO LINK': 'Exemplo demonstrativo',
            PRODUTO: 'CONFIGURAÇÃO LÓGICA (DEMO)'
        }, 'PENDENTE'),

        demoActivity('copasa-2', {
            ID: 'DEMO-2263652',
            UNIDADE: 'Unidade demonstrativa COPASA Norte',
            MUNICIPIO: 'Cidade exemplo - MG',
            'ID VGR': 'VGR-DEMO-02',
            PRODUTO: 'CONFIGURAÇÃO LÓGICA (DEMO)'
        }, 'EM_CONFIGURACAO', true),

        demoActivity('copasa-3', {
            ID: 'DEMO-2263653',
            UNIDADE: 'Unidade demonstrativa COPASA Sul',
            MUNICIPIO: 'Cidade exemplo - MG',
            'ID VGR': 'VGR-DEMO-03',
            PRODUTO: 'CONFIGURAÇÃO LÓGICA (DEMO)'
        }, 'CONCLUIDA')
    ];

    const cemigRows = [
        demoActivity('cemig-1', {
            ID: 'DEMO-CEMIG-001',
            UNIDADE: 'Unidade demonstrativa CEMIG Centro',
            MUNICIPIO: 'Cidade exemplo - MG',
            'TIPO DE ATIVIDADE': 'Configuração lógica demonstrativa'
        }),

        demoActivity('cemig-2', {
            ID: 'DEMO-CEMIG-002',
            UNIDADE: 'Unidade demonstrativa CEMIG Leste',
            MUNICIPIO: 'Cidade exemplo - MG',
            'TIPO DE ATIVIDADE': 'Configuração lógica demonstrativa'
        }, 'IMPEDIMENTO')
    ];

    const bbRows = [
        demoActivity('bb-1', {
            ID: 'DEMO-BB-001',
            UNIDADE: 'Unidade demonstrativa Banco do Brasil 01',
            MUNICIPIO: 'Cidade exemplo - DF',
            'TIPO DE ATIVIDADE': 'Configuração lógica demonstrativa'
        }),

        demoActivity('bb-2', {
            ID: 'DEMO-BB-002',
            UNIDADE: 'Unidade demonstrativa Banco do Brasil 02',
            MUNICIPIO: 'Cidade exemplo - SP',
            'TIPO DE ATIVIDADE': 'Configuração lógica demonstrativa'
        })
    ];

    return {
        version: 1,

        projects: {
            copasa: { activities: copasaRows },
            cemig: { activities: cemigRows },
            'banco-brasil': { activities: bbRows }
        },

        auditLog: [
            {
                id: newId('log'),
                at: new Date().toISOString(),
                projectId: null,
                action: 'Demonstração iniciada',
                user: DEMO_USER,
                detail: 'Carregados registros fictícios de exemplo; nenhuma planilha real foi importada.'
            }
        ]
    };
}

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
                        parsed.projects[project.id] = { activities: [] };
                    }

                    if (!Array.isArray(parsed.projects[project.id].activities)) {
                        parsed.projects[project.id].activities = [];
                    }
                }

                return parsed;
            }
        }
    } catch (error) {
        console.error('Falha ao carregar a demonstração:', error);
    }

    const initial = seedData();

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    } catch (error) {
        console.warn('Não foi possível inicializar o armazenamento local:', error);
    }

    return initial;
}

let state = loadState();

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch (error) {
        console.error('Não foi possível salvar os dados:', error);
        toast('O armazenamento local pode estar cheio. Os dados não foram salvos.', true);
        return false;
    }
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
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
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();

    return String(value).replace(/\s+/g, ' ').trim();
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

function isoTime(value) {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? String(value ?? '')
        : date.toISOString();
}

function toast(message, isError = false) {
    const element = $('#toast');

    element.textContent = message;
    element.className = isError ? 'toast error' : 'toast';
    element.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        element.hidden = true;
    }, 3800);
}

function getProject(projectId = currentProjectId) {
    return PROJECTS.find(project => project.id === projectId) || null;
}

function getProjectData(projectId = currentProjectId) {
    if (!state.projects[projectId]) {
        state.projects[projectId] = { activities: [] };
    }

    if (!Array.isArray(state.projects[projectId].activities)) {
        state.projects[projectId].activities = [];
    }

    return state.projects[projectId];
}

function getActivities(projectId = currentProjectId) {
    return getProjectData(projectId).activities;
}

function currentActivity(activityId) {
    return getActivities().find(
        activity => activity.id === activityId
    ) || null;
}

function logAction(action, detail, projectId = currentProjectId) {
    state.auditLog.unshift({
        id: newId('log'),
        at: new Date().toISOString(),
        projectId,
        action,
        user: DEMO_USER,
        detail: String(detail || '')
    });

    if (state.auditLog.length > MAX_HISTORY_ITEMS) {
        state.auditLog.length = MAX_HISTORY_ITEMS;
    }
}

function setView(viewName) {
    const valid = ['projects', 'dashboard', 'import', 'history'];

    if (!valid.includes(viewName)) {
        viewName = 'projects';
    }

    if (viewName === 'projects') {
        currentProjectId = null;
    }

    if (viewName !== 'projects' && !currentProjectId) {
        viewName = 'projects';
    }

    $('#view-projects').hidden = viewName !== 'projects';
    $('#project-workspace').hidden = viewName === 'projects';

    ['dashboard', 'import', 'history'].forEach(name => {
        $(`#view-${name}`).hidden = name !== viewName;
    });

    $$('.project-nav [data-nav]').forEach(button => {
        button.classList.toggle('active', button.dataset.nav === viewName);
    });

    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'import') resetImportView();
    if (viewName === 'history') renderHistory();

    const project = getProject();

    $('#current-project-label').hidden = !project;
    $('#current-project-label').textContent = project ? project.name : '';

    if (location.hash !== `#${viewName}`) {
        history.replaceState(null, '', `#${viewName}`);
    }
}

function selectProject(projectId) {
    if (!getProject(projectId)) return;

    currentProjectId = projectId;

    renderProjectCards();
    setView('dashboard');
}

function renderProjectCards() {
    $('#project-cards').innerHTML = PROJECTS.map(project => {
        const activities = getActivities(project.id);
        const adoptedCount = activities.filter(activity => activity.adopted).length;

        return `
            <article class="project-card">
                <div class="project-card-top">
                    <span class="project-icon">${esc(project.icon)}</span>
                    <span class="project-count">${activities.length} atividades</span>
                </div>

                <h2>${esc(project.name)}</h2>
                <p>${esc(project.description)}</p>

                <span class="project-card-meta">
                    ${adoptedCount} adotadas
                </span>

                <button
                    class="button button-primary"
                    type="button"
                    data-action="open-project"
                    data-project-id="${esc(project.id)}">

                    Entrar no projeto →
                </button>
            </article>
        `;
    }).join('');
}

function renderSummary(activities) {
    $('#kpi-total').textContent = activities.length;

    $('#kpi-pending').textContent = activities.filter(
        activity => activity.status === 'PENDENTE'
    ).length;

    $('#kpi-adopted').textContent = activities.filter(
        activity => activity.adopted
    ).length;

    $('#kpi-configuring').textContent = activities.filter(
        activity => activity.status === 'EM_CONFIGURACAO'
    ).length;

    $('#kpi-completed').textContent = activities.filter(
        activity => activity.status === 'CONCLUIDA'
    ).length;

    $('#kpi-blocked').textContent = activities.filter(
        activity => activity.status === 'IMPEDIMENTO'
    ).length;
}

function getFieldValue(rawData, aliases) {
    for (const [key, value] of Object.entries(rawData || {})) {
        if (!aliases.includes(normalizeHeader(key))) continue;

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

// Pesquisa todos os valores e nomes de colunas importados.
function searchableText(activity) {
    const rawText = Object.entries(activity.rawData || {})
        .map(([key, value]) => `${key} ${cleanCell(value)}`)
        .join(' ');

    return normalizeText([
        activity.id,
        activity.title,
        activity.identifier,
        activity.city,
        activity.status,
        STATUS[activity.status]?.label,
        activity.adopted ? 'adotada adotado' : 'não adotada disponível',
        activity.adoptedBy,
        rawText
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

function renderActivityRows() {
    const activities = getActivities();
    const query = normalizeText($('#activity-search').value);
    const statusFilter = $('#status-filter').value;
    const adoptionFilter = $('#adoption-filter').value;

    const filtered = activities.filter(activity => {
        if (query && !searchableText(activity).includes(query)) {
            return false;
        }

        if (statusFilter && activity.status !== statusFilter) {
            return false;
        }

        if (adoptionFilter === 'adopted' && !activity.adopted) {
            return false;
        }

        if (adoptionFilter === 'available' && activity.adopted) {
            return false;
        }

        return true;
    });

    $('#results-count').textContent =
        `${filtered.length} de ${activities.length} atividades`;

    $('#activities-table-body').innerHTML = filtered.map(activity => {
        const title = activity.title ||
            findTitleFromData(activity.rawData) ||
            'Atividade sem título';

        const identifier = activity.identifier ||
            findIdentifierFromData(activity.rawData) ||
            activity.id;

        const city = activity.city ||
            findCityFromData(activity.rawData) ||
            '—';

        const adoptedInfo = activity.adopted
            ? `
                <span class="adoption-label adopted">
                    Adotada<br>
                    <small>${esc(activity.adoptedBy || DEMO_USER)}</small>
                </span>
            `
            : '<span class="adoption-label">Disponível</span>';

        const actionButton = activity.adopted
            ? `
                <button
                    class="button button-adopted button-small"
                    type="button"
                    disabled>

                    Atividade adotada
                </button>
            `
            : `
                <button
                    class="button button-adopt button-small"
                    type="button"
                    data-action="adopt-activity"
                    data-activity-id="${esc(activity.id)}">

                    Adotar atividade
                </button>
            `;

        return `
            <tr
                class="activity-row"
                tabindex="0"
                role="button"
                aria-label="Visualizar ${esc(title)}"
                data-action="view-activity"
                data-activity-id="${esc(activity.id)}">

                <td class="activity-id">
                    ${esc(identifier)}
                </td>

                <td>
                    <span class="activity-name">${esc(title)}</span>
                    <span class="activity-subtitle">
                        Clique na linha para ver todos os campos
                    </span>
                </td>

                <td>${esc(city)}</td>
                <td>${statusBadge(activity.status)}</td>
                <td>${adoptedInfo}</td>
                <td>${actionButton}</td>
            </tr>
        `;
    }).join('');

    $('#activities-empty').hidden = filtered.length > 0;

    renderSummary(activities);
}

function renderDashboard() {
    const project = getProject();

    if (!project) {
        setView('projects');
        return;
    }

    $('#project-eyebrow').textContent = `PROJETO ${project.shortName}`;
    $('#dashboard-title').textContent = `Atividades — ${project.name}`;

    renderSummary(getActivities());
    renderActivityRows();
}

function renderActivityDetails(activityId) {
    const activity = currentActivity(activityId);

    if (!activity) {
        toast('Atividade não encontrada neste projeto.', true);
        return;
    }

    const fields = Object.entries(activity.rawData || {});

    $('#detail-title').textContent =
        activity.title || 'Detalhes da atividade';

    $('#detail-subtitle').textContent =
        `Identificador: ${activity.identifier || activity.id} · ${
            STATUS[activity.status]?.label || activity.status
        } · ${activity.adopted ? 'Adotada' : 'Não adotada'}`;

    const metadata = [
        ['Status no Oviv', STATUS[activity.status]?.label || activity.status],
        [
            'Adoção',
            activity.adopted
                ? `Adotada por ${activity.adoptedBy || DEMO_USER} em ${formatDateTime(activity.adoptedAt)}`
                : 'Ainda não adotada'
        ],
        ['Importada em', formatDateTime(activity.createdAt)]
    ];

    const allFields = [
        ...metadata,
        ...fields.map(([key, value]) => [key, cleanCell(value) || '—'])
    ];

    $('#activity-detail-fields').innerHTML = allFields.map(([key, value]) => `
        <div class="detail-field">
            <strong>${esc(key)}</strong>
            <span>${esc(value)}</span>
        </div>
    `).join('');

    // Essa janela é somente para visualização.
    // Ela não adota a atividade nem modifica seu status.
    $('#activity-detail-dialog').showModal();
}

function adoptActivity(activityId) {
    const activity = currentActivity(activityId);

    if (!activity) {
        toast('Atividade não encontrada neste projeto.', true);
        return;
    }

    if (activity.adopted) {
        toast('Esta atividade já foi adotada.', true);
        return;
    }

    const title = activity.title || activity.identifier || activity.id;

    if (!confirm(`Adotar a atividade "${title}" nesta demonstração?`)) {
        return;
    }

    activity.adopted = true;
    activity.adoptedBy = DEMO_USER;
    activity.adoptedAt = new Date().toISOString();

    logAction(
        'Atividade adotada',
        `${activity.identifier || activity.id} · ${activity.title || 'Atividade sem título'}`
    );

    if (!saveState()) return;

    renderAllCurrentProject();

    toast('Atividade adotada. A ação foi adicionada ao histórico.');
}

function renderAllCurrentProject() {
    renderProjectCards();

    if (currentProjectId) {
        renderDashboard();
        renderHistory();
    }
}

/* IMPORTAÇÃO LOCAL */

function renderImportView() {
    $('#import-preview').hidden = true;
    $('#import-summary').textContent = '';
    $('#import-preview-body').innerHTML = '';
    $('#confirm-import').disabled = true;
}

function resetImportView() {
    if (!pendingImport) {
        renderImportView();
    }
}

function stableFingerprint(rawData) {
    const canonical = Object.keys(rawData)
        .sort((a, b) => a.localeCompare(b))
        .map(key => `${normalizeText(key)}=${normalizeText(rawData[key])}`)
        .join('|');

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

        if (!header) continue;
        if (value === null || value === undefined || cleanCell(value) === '') {
            continue;
        }

        result[header] = cleanCell(value).slice(0, 4000);
    }

    return result;
}

async function prepareImport(event) {
    event.preventDefault();

    const file = $('#import-file').files?.[0];

    if (!file) {
        toast('Selecione um arquivo Excel ou CSV.', true);
        return;
    }

    if (file.size > MAX_IMPORT_BYTES) {
        toast('O arquivo ultrapassa 20 MB, limite desta demonstração.', true);
        return;
    }

    if (!window.XLSX) {
        toast(
            'A biblioteca Excel não foi carregada. Confira sua conexão e atualize a página.',
            true
        );
        return;
    }

    const extension = file.name.split('.').pop().toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        toast('Formato não suportado. Escolha XLSX, XLS ou CSV.', true);
        return;
    }

    $('#import-preview').hidden = false;
    $('#import-summary').textContent = 'Analisando o arquivo neste navegador…';
    $('#import-preview-body').innerHTML = '';
    $('#confirm-import').disabled = true;

    try {
        // O arquivo é lido localmente e não é enviado para o servidor.
        const workbook = window.XLSX.read(
            await file.arrayBuffer(),
            { type: 'array' }
        );

        const sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error('Nenhuma aba foi encontrada no arquivo.');
        }

        const worksheet = workbook.Sheets[sheetName];

        const rows = window.XLSX.utils.sheet_to_json(worksheet, {
            defval: '',
            raw: false
        });

        if (!rows.length) {
            throw new Error('A primeira aba não contém linhas de dados.');
        }

        const validRows = [];
        let ignored = 0;
        let duplicates = 0;

        const existingFingerprints = new Set(
            getActivities()
                .map(activity => activity.rowKey)
                .filter(Boolean)
        );

        const seen = new Set();

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

            if (existingFingerprints.has(rowKey) || seen.has(rowKey)) {
                duplicates++;
                continue;
            }

            seen.add(rowKey);

            validRows.push({
                id: newId('activity'),
                rowKey,
                rawData,
                title: title || `Atividade ${identifier}`,
                identifier: identifier || rowKey,
                city: findCityFromData(rawData),
                status: 'PENDENTE',
                adopted: false,
                adoptedBy: null,
                adoptedAt: null,
                createdAt: new Date().toISOString()
            });
        }

        if (!validRows.length) {
            throw new Error(
                'Nenhuma nova linha válida foi encontrada. Confira se há campos como ID, UNIDADE ou ATIVIDADE.'
            );
        }

        pendingImport = {
            projectId: currentProjectId,
            rows: validRows,
            totalRows: rows.length,
            ignored,
            duplicates,
            fileName: file.name
        };

        renderImportPreview();

    } catch (error) {
        console.error('Falha na leitura da planilha:', error);

        pendingImport = null;

        $('#import-summary').textContent =
            error.message || 'Não foi possível ler a planilha.';

        $('#confirm-import').disabled = true;

        toast(error.message || 'Não foi possível analisar o arquivo.', true);
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
        Novas atividades: <strong>${rows.length}</strong> ·
        Duplicatas ignoradas: <strong>${pendingImport.duplicates}</strong> ·
        Linhas ignoradas: <strong>${pendingImport.ignored}</strong>.
        <br>
        Todos os campos não vazios são mantidos localmente para permitir busca
        e visualização completa. O arquivo não é enviado a servidor algum.
    `;

    $('#import-preview-body').innerHTML = rows
        .slice(0, 12)
        .map(activity => `
            <tr>
                <td>${esc(activity.identifier)}</td>
                <td>${esc(activity.title)}</td>
                <td>${esc(activity.city || '—')}</td>
                <td><span class="status-badge status-pending">Pendente</span></td>
            </tr>
        `)
        .join('');

    if (rows.length > 12) {
        $('#import-preview-body').insertAdjacentHTML(
            'beforeend',
            `<tr><td colspan="4">Mais ${rows.length - 12} atividades serão importadas após a confirmação.</td></tr>`
        );
    }

    $('#confirm-import').disabled = rows.length === 0;
}

function confirmImport() {
    if (
        !pendingImport ||
        pendingImport.projectId !== currentProjectId
    ) {
        toast('Volte ao projeto correto e analise a planilha novamente.', true);
        return;
    }

    const projectName = getProject()?.name || currentProjectId;
    const rows = pendingImport.rows;
    const projectActivities = getActivities();
    const oldLength = projectActivities.length;

    projectActivities.push(...rows);

    logAction(
        'Planilha importada',
        `${pendingImport.fileName}: ${rows.length} atividades adicionadas ao projeto ${projectName}; ${pendingImport.duplicates} duplicatas ignoradas e ${pendingImport.ignored} linhas ignoradas.`
    );

    if (!saveState()) {
        projectActivities.splice(oldLength);
        return;
    }

    const inserted = rows.length;

    pendingImport = null;

    $('#import-form').reset();
    renderImportView();

    renderAllCurrentProject();
    setView('dashboard');

    toast(`${inserted} atividades importadas em ${projectName}.`);
}

function cancelImport() {
    pendingImport = null;

    $('#import-form').reset();
    renderImportView();

    toast('Importação cancelada. Nenhuma atividade foi adicionada.');
}

/* HISTÓRICO */

function renderHistory() {
    const query = normalizeText($('#history-search')?.value || '');
    const select = $('#history-action-filter');
    const previous = select.value;

    const relevantLog = state.auditLog.filter(entry =>
        !entry.projectId || entry.projectId === currentProjectId
    );

    const actions = [...new Set(
        relevantLog.map(entry => entry.action)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    select.innerHTML =
        '<option value="">Todas as ações</option>' +
        actions.map(action =>
            `<option value="${esc(action)}">${esc(action)}</option>`
        ).join('');

    if (actions.includes(previous)) {
        select.value = previous;
    }

    const actionFilter = select.value;

    const filtered = [...relevantLog]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .filter(entry => {
            if (actionFilter && entry.action !== actionFilter) {
                return false;
            }

            const searchable = normalizeText(
                `${entry.action} ${entry.user} ${entry.detail}`
            );

            return !query || searchable.includes(query);
        });

    $('#history-count').textContent =
        `${filtered.length} registros`;

    $('#history-body').innerHTML = filtered.map(entry => `
        <tr>
            <td>${esc(isoTime(entry.at))}</td>
            <td class="history-action">${esc(entry.action)}</td>
            <td>${esc(entry.user || DEMO_USER)}</td>
            <td>${esc(entry.detail)}</td>
        </tr>
    `).join('');

    $('#history-empty').hidden = filtered.length > 0;
}

function exportHistoryCSV() {
    const entries = state.auditLog.filter(entry =>
        !entry.projectId || entry.projectId === currentProjectId
    );

    const rows = [
        ['Data', 'Ação', 'Usuário', 'Detalhe'],
        ...entries.map(entry => [
            isoTime(entry.at),
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
    const link = document.createElement('a');

    link.href = url;
    link.download = `oviv-historico-${currentProjectId}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    logAction(
        'Histórico exportado',
        `${entries.length} registros exportados para CSV.`
    );

    saveState();
    renderHistory();

    toast('Histórico exportado para CSV.');
}

function resetDemo() {
    if (!confirm(
        'Restaurar todos os dados de exemplo? Isso remove os projetos importados, adoções e histórico salvos neste navegador.'
    )) {
        return;
    }

    state = seedData();
    currentProjectId = null;
    pendingImport = null;

    if (!saveState()) return;

    renderProjectCards();
    setView('projects');

    toast('Dados demonstrativos restaurados.');
}

function renderAllCurrentProject() {
    renderProjectCards();
    renderDashboard();
    renderHistory();
}

/* EVENTOS DA INTERFACE */

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');

    if (nav) {
        event.preventDefault();
        setView(nav.dataset.nav);
        return;
    }

    const importLink = event.target.closest('[data-open-import]');

    if (importLink) {
        setView('import');
        return;
    }

    const action = event.target.closest('[data-action]');

    if (action) {
        switch (action.dataset.action) {
            case 'open-project':
                selectProject(action.dataset.projectId);
                return;

            case 'adopt-activity':
                event.preventDefault();
                event.stopPropagation();
                adoptActivity(action.dataset.activityId);
                return;

            case 'view-activity':
                renderActivityDetails(action.dataset.activityId);
                return;
        }
    }
});

document.addEventListener('keydown', event => {
    const row = event.target.closest(
        'tr[data-action="view-activity"]'
    );

    if (!row) return;

    if (event.key === 'Enter' || event.key === ' ') {
        if (event.target.closest('button')) return;

        event.preventDefault();
        renderActivityDetails(row.dataset.activityId);
    }
});

$('#open-import').addEventListener(
    'click',
    () => setView('import')
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

$('#reset-demo').addEventListener(
    'click',
    resetDemo
);

$('#close-detail').addEventListener('click', () => {
    $('#activity-detail-dialog').close();
});

$('#activity-detail-dialog').addEventListener('click', event => {
    if (event.target === $('#activity-detail-dialog')) {
        $('#activity-detail-dialog').close();
    }
});

window.addEventListener('hashchange', () => {
    const requested = location.hash.slice(1);

    if (requested === 'projects') {
        setView('projects');
    } else if (
        ['dashboard', 'import', 'history'].includes(requested) &&
        currentProjectId
    ) {
        setView(requested);
    }
});

// Inicialização: a primeira tela sempre é a seleção do projeto.
renderProjectCards();
setView('projects');