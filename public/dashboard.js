'use strict';

const STORAGE_KEY = 'oviv_demo_fixed_v1';
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_HISTORY_ITEMS = 1000;
const DEMO_USER = 'Administrador (demo)';

const STATUS = {
    PENDENTE: {
        label: 'Pendente',
        css: 'badge-pending'
    },
    EM_DESLOCAMENTO: {
        label: 'Em deslocamento',
        css: 'badge-travel'
    },
    EM_EXECUCAO: {
        label: 'Em andamento',
        css: 'badge-progress'
    },
    CONCLUIDA: {
        label: 'Concluída',
        css: 'badge-done'
    },
    IMPEDIMENTO: {
        label: 'Impedimento',
        css: 'badge-blocked'
    },
    CANCELADA: {
        label: 'Cancelada',
        css: 'badge-cancelled'
    }
};

const TERMINAL = ['CONCLUIDA', 'CANCELADA'];

const $ = (selector, root = document) =>
    root.querySelector(selector);

const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

let toastTimer;
let pendingImport = null;

function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
}

// Dados fictícios utilizados para iniciar a demonstração.
function sampleState() {
    const now = new Date().toISOString();

    return {
        analysts: [
            {
                id: 1,
                name: 'Ana Martins',
                email: 'ana.martins@demo.invalid',
                active: true
            },
            {
                id: 2,
                name: 'Bruno Costa',
                email: 'bruno.costa@demo.invalid',
                active: true
            },
            {
                id: 3,
                name: 'Camila Rocha',
                email: 'camila.rocha@demo.invalid',
                active: true
            }
        ],

        units: [
            {
                id: 1,
                code: 'DEMO-001',
                name: 'Unidade demonstrativa Centro',
                city: 'Cidade exemplo - MG',
                sourceKey: null,
                imported: false
            },
            {
                id: 2,
                code: 'DEMO-002',
                name: 'Unidade demonstrativa Norte',
                city: 'Cidade exemplo - MG',
                sourceKey: null,
                imported: false
            },
            {
                id: 3,
                code: 'DEMO-003',
                name: 'Unidade demonstrativa Sul',
                city: 'Cidade exemplo - MG',
                sourceKey: null,
                imported: false
            },
            {
                id: 4,
                code: 'DEMO-004',
                name: 'Unidade demonstrativa Leste',
                city: 'Cidade exemplo - MG',
                sourceKey: null,
                imported: false
            }
        ],

        visits: [
            {
                id: 1,
                analystId: 1,
                unitId: 1,
                checkInAt: minutesAgo(84),
                checkOutAt: null,
                activities: [
                    {
                        id: 1,
                        title: 'Verificar equipamento',
                        description:
                            'Conferir o funcionamento do equipamento demonstrativo.',
                        status: 'EM_EXECUCAO',
                        createdAt: minutesAgo(75),
                        startedAt: minutesAgo(68),
                        completedAt: null,
                        notes: []
                    },
                    {
                        id: 2,
                        title: 'Testar conectividade',
                        description:
                            'Validar conectividade usando dados fictícios.',
                        status: 'PENDENTE',
                        createdAt: minutesAgo(70),
                        startedAt: null,
                        completedAt: null,
                        notes: []
                    }
                ]
            },
            {
                id: 2,
                analystId: 2,
                unitId: 2,
                checkInAt: minutesAgo(43),
                checkOutAt: null,
                activities: [
                    {
                        id: 3,
                        title: 'Inspeção de rotina',
                        description:
                            'Inspeção ilustrativa para demonstração.',
                        status: 'EM_DESLOCAMENTO',
                        createdAt: minutesAgo(38),
                        startedAt: null,
                        completedAt: null,
                        notes: []
                    },
                    {
                        id: 4,
                        title: 'Conferir configuração',
                        description: 'Atividade fictícia de exemplo.',
                        status: 'IMPEDIMENTO',
                        createdAt: minutesAgo(31),
                        startedAt: null,
                        completedAt: null,
                        notes: []
                    }
                ]
            },
            {
                id: 3,
                analystId: 3,
                unitId: 3,
                checkInAt: minutesAgo(240),
                checkOutAt: minutesAgo(125),
                activities: [
                    {
                        id: 5,
                        title: 'Revisão de equipamento',
                        description: 'Serviço demonstrativo concluído.',
                        status: 'CONCLUIDA',
                        createdAt: minutesAgo(230),
                        startedAt: minutesAgo(220),
                        completedAt: now,
                        notes: []
                    }
                ]
            }
        ],

        auditLog: [
            {
                id: 1,
                at: now,
                action: 'Demonstração iniciada',
                user: DEMO_USER,
                detail:
                    'Dados fictícios carregados. Nenhuma planilha foi importada.'
            }
        ],

        nextAnalystId: 4,
        nextUnitId: 5,
        nextVisitId: 4,
        nextActivityId: 6,
        nextAuditId: 2
    };
}

function normalizeState(data) {
    data.analysts = Array.isArray(data.analysts)
        ? data.analysts
        : [];

    data.units = Array.isArray(data.units)
        ? data.units
        : [];

    data.visits = Array.isArray(data.visits)
        ? data.visits
        : [];

    data.auditLog = Array.isArray(data.auditLog)
        ? data.auditLog
        : [];

    data.units.forEach(unit => {
        if (!Object.hasOwn(unit, 'sourceKey')) {
            unit.sourceKey = null;
        }
    });

    data.visits.forEach(visit => {
        visit.activities = Array.isArray(visit.activities)
            ? visit.activities
            : [];

        visit.activities.forEach(activity => {
            activity.notes = Array.isArray(activity.notes)
                ? activity.notes
                : [];
        });
    });

    const analystIds = data.analysts.map(
        item => Number(item.id) + 1
    );

    const unitIds = data.units.map(
        item => Number(item.id) + 1
    );

    const visitIds = data.visits.map(
        item => Number(item.id) + 1
    );

    const activityIds = data.visits.flatMap(
        visit => visit.activities.map(
            item => Number(item.id) + 1
        )
    );

    const auditIds = data.auditLog.map(
        item => Number(item.id) + 1
    );

    data.nextAnalystId = Math.max(
        Number(data.nextAnalystId) || 1,
        ...analystIds,
        1
    );

    data.nextUnitId = Math.max(
        Number(data.nextUnitId) || 1,
        ...unitIds,
        1
    );

    data.nextVisitId = Math.max(
        Number(data.nextVisitId) || 1,
        ...visitIds,
        1
    );

    data.nextActivityId = Math.max(
        Number(data.nextActivityId) || 1,
        ...activityIds,
        1
    );

    data.nextAuditId = Math.max(
        Number(data.nextAuditId) || 1,
        ...auditIds,
        1
    );

    return data;
}

function loadState() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);

        if (stored) {
            const parsed = JSON.parse(stored);

            if (
                parsed &&
                Array.isArray(parsed.analysts) &&
                Array.isArray(parsed.units) &&
                Array.isArray(parsed.visits)
            ) {
                const data = normalizeState(parsed);

                if (!data.auditLog.length) {
                    data.auditLog.push({
                        id: data.nextAuditId++,
                        at: new Date().toISOString(),
                        action: 'Histórico ativado',
                        user: DEMO_USER,
                        detail:
                            'O histórico foi habilitado nesta demonstração.'
                    });

                    localStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify(data)
                    );
                }

                return data;
            }
        }
    } catch (error) {
        console.error(
            'Falha ao carregar os dados locais:',
            error
        );
    }

    const initial = sampleState();

    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(initial)
        );
    } catch (error) {
        console.warn(
            'Armazenamento local indisponível:',
            error
        );
    }

    return initial;
}

let state = loadState();

function saveState() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(state)
        );

        return true;
    } catch (error) {
        console.error(
            'Falha ao salvar os dados:',
            error
        );

        toast(
            'O navegador não conseguiu salvar os dados. Verifique o armazenamento local.',
            true
        );

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

function analystById(id) {
    return state.analysts.find(
        item => item.id === Number(id)
    );
}

function unitById(id) {
    return state.units.find(
        item => item.id === Number(id)
    );
}

function openVisits() {
    return state.visits.filter(
        visit => !visit.checkOutAt
    );
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

function isoTime(value) {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? String(value || '')
        : date.toISOString();
}

function isToday(value) {
    if (!value) return false;

    const date = new Date(value);
    const now = new Date();

    return date.getDate() === now.getDate()
        && date.getMonth() === now.getMonth()
        && date.getFullYear() === now.getFullYear();
}

function toast(message, error = false) {
    const element = $('#toast');

    element.textContent = message;
    element.className = error ? 'toast error' : 'toast';
    element.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        element.hidden = true;
    }, 3800);
}

function logAction(action, detail) {
    if (!Array.isArray(state.auditLog)) {
        state.auditLog = [];
    }

    state.auditLog.unshift({
        id: state.nextAuditId++,
        at: new Date().toISOString(),
        action,
        user: DEMO_USER,
        detail: String(detail || '')
    });

    if (state.auditLog.length > MAX_HISTORY_ITEMS) {
        state.auditLog.length = MAX_HISTORY_ITEMS;
    }
}

function setView(name) {
    const validViews = [
        'dashboard',
        'analysts',
        'units',
        'new-visit',
        'import',
        'history'
    ];

    if (!validViews.includes(name)) {
        name = 'dashboard';
    }

    $$('.view').forEach(view => {
        view.hidden = view.id !== `view-${name}`;
    });

    $$('.nav-button[data-nav]').forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.nav === name
        );
    });

    if (name === 'dashboard') renderDashboard();
    if (name === 'analysts') renderAnalysts();
    if (name === 'units') renderUnits();
    if (name === 'new-visit') renderVisitOptions();
    if (name === 'history') renderHistory();
    if (name === 'import') renderImportHelp();

    if (location.hash !== `#${name}`) {
        history.replaceState(null, '', `#${name}`);
    }
}

function renderSummary() {
    const opened = openVisits();

    const activeActivities = opened.flatMap(
        visit => visit.activities || []
    );

    const allActivities = state.visits.flatMap(
        visit => visit.activities || []
    );

    $('#kpi-pending').textContent =
        activeActivities.filter(
            activity => activity.status === 'PENDENTE'
        ).length;

    $('#kpi-progress').textContent =
        activeActivities.filter(activity =>
            ['EM_DESLOCAMENTO', 'EM_EXECUCAO'].includes(
                activity.status
            )
        ).length;

    $('#kpi-impediments').textContent =
        activeActivities.filter(
            activity => activity.status === 'IMPEDIMENTO'
        ).length;

    $('#kpi-completed').textContent =
        allActivities.filter(activity =>
            activity.status === 'CONCLUIDA' &&
            isToday(activity.completedAt)
        ).length;

    $('#kpi-visits').textContent = opened.length;

    $('#kpi-analysts').textContent =
        new Set(opened.map(visit => visit.analystId)).size;

    $('#visit-count').textContent =
        `${opened.length} ${opened.length === 1 ? 'visita' : 'visitas'}`;

    $('#nav-analyst-count').textContent =
        state.analysts.filter(analyst => analyst.active).length;

    $('#nav-unit-count').textContent = state.units.length;
    $('#nav-history-count').textContent = state.auditLog.length;

    $('#last-updated').textContent =
        new Intl.DateTimeFormat(
            'pt-BR',
            { timeStyle: 'short' }
        ).format(new Date());
}

function renderActivity(activity, visitId) {
    const info = STATUS[activity.status] || STATUS.PENDENTE;
    const locked = TERMINAL.includes(activity.status);

    const options = Object.entries(STATUS).map(([value, item]) =>
        `<option value="${value}" ${
            value === activity.status ? 'selected' : ''
        }>${item.label}</option>`
    ).join('');

    return `
        <article class="activity">
            <div>
                <span class="activity-title">
                    ${esc(activity.title)}
                </span>

                ${
                    activity.description
                        ? `<span class="activity-description">${esc(activity.description)}</span>`
                        : ''
                }

                <div class="activity-meta">
                    <span class="badge ${info.css}">
                        ${info.label}
                    </span>

                    ${
                        activity.startedAt
                            ? `<small>Início: ${esc(formatDateTime(activity.startedAt))}</small>`
                            : ''
                    }

                    ${
                        activity.completedAt
                            ? `<small>Fim: ${esc(formatDateTime(activity.completedAt))}</small>`
                            : ''
                    }
                </div>
            </div>

            <div class="activity-controls">
                <label class="sr-only" for="status-${activity.id}">
                    Status de ${esc(activity.title)}
                </label>

                <select
                    class="status-select"
                    id="status-${activity.id}"
                    data-status-select
                    ${locked ? 'disabled' : ''}>

                    ${options}
                </select>

                <input
                    class="status-note"
                    data-status-note
                    type="text"
                    maxlength="300"
                    placeholder="Observação (opcional)"
                    aria-label="Observação para o histórico"
                    ${locked ? 'disabled' : ''}>

                <button
                    class="button secondary small"
                    type="button"
                    data-action="save-status"
                    data-visit-id="${visitId}"
                    data-activity-id="${activity.id}"
                    ${locked ? 'disabled' : ''}>

                    Salvar
                </button>
            </div>
        </article>
    `;
}

function renderVisit(visit) {
    const analyst = analystById(visit.analystId);
    const unit = unitById(visit.unitId);
    const activities = visit.activities || [];

    const canClose = activities.length > 0 &&
        activities.every(
            activity => TERMINAL.includes(activity.status)
        );

    const initials = (analyst?.name || '?')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(word => word[0].toUpperCase())
        .join('');

    const activityHTML = activities.length
        ? activities.map(
            activity => renderActivity(activity, visit.id)
        ).join('')
        : `
            <div class="empty">
                Nenhuma atividade cadastrada nesta visita ainda.
                Adicione o primeiro serviço.
            </div>
        `;

    return `
        <article class="visit-card">
            <div class="visit-top">
                <div class="person">
                    <span class="avatar">
                        ${esc(initials)}
                    </span>

                    <div>
                        <strong>
                            ${esc(analyst?.name || 'Analista não encontrado')}
                        </strong>

                        <small>
                            Visita #${visit.id} · Check-in
                            ${esc(formatDateTime(visit.checkInAt))}
                        </small>
                    </div>
                </div>

                <div class="visit-buttons">
                    <button
                        class="button secondary small"
                        type="button"
                        data-action="add-activity"
                        data-visit-id="${visit.id}">

                        ＋ Atividade
                    </button>

                    <button
                        class="button secondary small"
                        type="button"
                        data-action="close-visit"
                        data-visit-id="${visit.id}"
                        ${canClose ? '' : 'disabled'}>

                        Encerrar visita
                    </button>
                </div>
            </div>

            <div class="unit-strip">
                <span class="unit-pin">⌖</span>

                <div>
                    <strong>
                        ${esc(unit?.name || 'Unidade não encontrada')}
                    </strong>

                    <small>
                        ${esc(unit?.code || '')}
                        ${unit?.city ? ` · ${esc(unit.city)}` : ''}
                    </small>
                </div>
            </div>

            <div class="activity-head">
                <span>Atividades da visita</span>

                <span>
                    ${activities.length}
                    ${activities.length === 1 ? 'atividade' : 'atividades'}
                </span>
            </div>

            <div class="activity-list">
                ${activityHTML}
            </div>
        </article>
    `;
}

function renderDashboard() {
    renderSummary();

    const visits = openVisits().sort(
        (a, b) => new Date(b.checkInAt) - new Date(a.checkInAt)
    );

    $('#visits-container').innerHTML = visits.length
        ? visits.map(renderVisit).join('')
        : `
            <div class="empty">
                <strong>Nenhuma visita aberta</strong>
                <p>Inicie uma visita para começar o acompanhamento.</p>

                <button
                    class="button primary"
                    type="button"
                    data-nav="new-visit">

                    ＋ Iniciar visita
                </button>
            </div>
        `;
}

function renderAnalysts() {
    $('#analyst-count').textContent =
        `${state.analysts.length} ${
            state.analysts.length === 1 ? 'analista' : 'analistas'
        }`;

    const opened = openVisits();

    $('#analysts-list').innerHTML = state.analysts.length
        ? [...state.analysts]
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
            .map(analyst => {
                const visit = opened.find(
                    item => item.analystId === analyst.id
                );

                const initials = analyst.name
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map(word => word[0].toUpperCase())
                    .join('');

                const label = !analyst.active
                    ? 'Inativo'
                    : visit
                        ? 'Em visita'
                        : 'Disponível';

                const badge = !analyst.active
                    ? 'badge-cancelled'
                    : visit
                        ? 'badge-progress'
                        : 'badge-done';

                return `
                    <article class="entity-row">
                        <span class="avatar">
                            ${esc(initials)}
                        </span>

                        <div class="entity-main">
                            <strong>${esc(analyst.name)}</strong>
                            <small>${esc(analyst.email)}</small>
                        </div>

                        <div class="entity-actions">
                            <span class="badge ${badge}">
                                ${label}
                            </span>

                            <button
                                class="button secondary small"
                                type="button"
                                data-action="toggle-analyst"
                                data-analyst-id="${analyst.id}"
                                ${visit ? 'disabled title="Encerre a visita antes de desativar"' : ''}>

                                ${analyst.active ? 'Desativar' : 'Reativar'}
                            </button>
                        </div>
                    </article>
                `;
            }).join('')
        : `
            <div class="empty">
                Nenhum analista cadastrado.
                Use o formulário para adicionar o primeiro.
            </div>
        `;
}

function renderUnits() {
    $('#unit-count').textContent =
        `${state.units.length} ${
            state.units.length === 1 ? 'unidade' : 'unidades'
        }`;

    $('#units-list').innerHTML = state.units.length
        ? [...state.units]
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
            .map(unit => {
                const used = state.visits.some(
                    visit => visit.unitId === unit.id
                );

                const active = openVisits().some(
                    visit => visit.unitId === unit.id
                );

                return `
                    <article class="entity-row">
                        <span class="mini-symbol">⌖</span>

                        <div class="entity-main">
                            <strong>${esc(unit.name)}</strong>

                            <small>
                                ${esc(unit.code)}
                                ${unit.city ? ` · ${esc(unit.city)}` : ''}
                                ${unit.imported ? ' · IMPORTADA' : ''}
                            </small>
                        </div>

                        <div class="entity-actions">
                            <span class="badge ${
                                active ? 'badge-progress' : 'badge-done'
                            }">
                                ${active ? 'Em atendimento' : 'Disponível'}
                            </span>

                            <button
                                class="button secondary small"
                                type="button"
                                data-action="delete-unit"
                                data-unit-id="${unit.id}"
                                ${used ? 'disabled title="Há visitas associadas a esta unidade"' : ''}>

                                Remover
                            </button>
                        </div>
                    </article>
                `;
            }).join('')
        : `
            <div class="empty">
                Nenhuma unidade cadastrada.
                Use o formulário ou importe uma planilha.
            </div>
        `;

    renderVisitOptions();
}

function renderVisitOptions() {
    const analystSelect = $('#visit-analyst');
    const unitSelect = $('#visit-unit');

    if (!analystSelect || !unitSelect) return;

    const oldAnalyst = analystSelect.value;
    const oldUnit = unitSelect.value;

    const available = state.analysts.filter(
        analyst => analyst.active &&
            !openVisits().some(
                visit => visit.analystId === analyst.id
            )
    );

    analystSelect.innerHTML =
        '<option value="">Selecione um analista</option>' +
        available.map(analyst =>
            `<option value="${analyst.id}">${esc(analyst.name)}</option>`
        ).join('');

    unitSelect.innerHTML =
        '<option value="">Selecione uma unidade</option>' +
        state.units.map(unit =>
            `<option value="${unit.id}">${esc(unit.name)} · ${esc(unit.code)}</option>`
        ).join('');

    if (available.some(
        analyst => String(analyst.id) === oldAnalyst
    )) {
        analystSelect.value = oldAnalyst;
    }

    if (state.units.some(
        unit => String(unit.id) === oldUnit
    )) {
        unitSelect.value = oldUnit;
    }

    const hint = $('#visit-form-hint');

    if (!available.length) {
        hint.textContent =
            'Não há analistas disponíveis. Cadastre ou reative um analista, ou encerre uma visita aberta.';
    } else if (!state.units.length) {
        hint.textContent =
            'Cadastre uma unidade antes de registrar o check-in.';
    } else {
        hint.textContent =
            'Check-in manual, sem GPS. Um analista só pode ter uma visita aberta por vez.';
    }

    $('#visit-form button[type="submit"]').disabled =
        !available.length || !state.units.length;
}

/* CADASTRO DE ANALISTAS */

function createAnalyst(event) {
    event.preventDefault();

    const name = $('#analyst-name').value.trim();
    const email = $('#analyst-email').value.trim().toLowerCase();

    if (!name || !email) return;

    if (state.analysts.some(
        analyst => analyst.email.toLowerCase() === email
    )) {
        toast(
            'Já existe um analista com esse e-mail demonstrativo.',
            true
        );
        return;
    }

    const analyst = {
        id: state.nextAnalystId++,
        name,
        email,
        active: true
    };

    state.analysts.push(analyst);

    logAction(
        'Analista cadastrado',
        `${analyst.name} (${analyst.email}) foi adicionado à demonstração.`
    );

    if (!saveState()) return;

    event.currentTarget.reset();

    renderAll();
    setView('analysts');

    toast('Analista cadastrado nesta demonstração.');
}

/* CADASTRO DE UNIDADES */

function createUnit(event) {
    event.preventDefault();

    const code = $('#unit-code').value.trim().toUpperCase();
    const name = $('#unit-name').value.trim();
    const city = $('#unit-city').value.trim();

    if (!code || !name) return;

    if (state.units.some(
        unit => unit.code.toLowerCase() === code.toLowerCase()
    )) {
        toast('Este código demonstrativo já existe.', true);
        return;
    }

    const unit = {
        id: state.nextUnitId++,
        code,
        name,
        city,
        sourceKey: null,
        imported: false
    };

    state.units.push(unit);

    logAction(
        'Unidade cadastrada',
        `${unit.code} · ${unit.name}${unit.city ? ` · ${unit.city}` : ''}.`
    );

    if (!saveState()) return;

    event.currentTarget.reset();

    renderAll();
    setView('units');

    toast('Unidade cadastrada nesta demonstração.');
}

/* VISITAS E CHECK-IN */

function createVisit(event) {
    event.preventDefault();

    const analystId = Number($('#visit-analyst').value);
    const unitId = Number($('#visit-unit').value);

    const analyst = analystById(analystId);
    const unit = unitById(unitId);

    if (!analyst || !analyst.active || !unit) {
        toast(
            'Selecione um analista ativo e uma unidade válida.',
            true
        );
        return;
    }

    if (openVisits().some(
        visit => visit.analystId === analystId
    )) {
        toast(
            'Este analista já possui uma visita aberta.',
            true
        );
        return;
    }

    const visit = {
        id: state.nextVisitId++,
        analystId,
        unitId,
        checkInAt: new Date().toISOString(),
        checkOutAt: null,
        activities: []
    };

    state.visits.push(visit);

    logAction(
        'Check-in registrado',
        `Visita #${visit.id} · ${analyst.name} · ${unit.code} — ${unit.name}.`
    );

    if (!saveState()) return;

    event.currentTarget.reset();

    renderAll();
    setView('dashboard');

    toast(
        `Check-in de ${analyst.name} registrado na demonstração.`
    );
}

/* CRIAÇÃO DE ATIVIDADES */

function openActivity(visitId) {
    const visit = state.visits.find(
        item => item.id === Number(visitId) && !item.checkOutAt
    );

    if (!visit) {
        toast('Visita não encontrada ou já encerrada.', true);
        return;
    }

    const analyst = analystById(visit.analystId);
    const unit = unitById(visit.unitId);

    $('#activity-visit-id').value = String(visit.id);

    $('#activity-visit-label').textContent =
        `${analyst?.name || 'Analista'} · ${unit?.name || 'Unidade'} · Visita #${visit.id}`;

    $('#activity-title').value = '';
    $('#activity-description').value = '';

    $('#activity-dialog').showModal();
    $('#activity-title').focus();
}

function createActivity(event) {
    event.preventDefault();

    const visitId = Number($('#activity-visit-id').value);
    const title = $('#activity-title').value.trim();
    const description = $('#activity-description').value.trim();

    const visit = state.visits.find(
        item => item.id === visitId && !item.checkOutAt
    );

    if (!visit || !title) {
        toast(
            'Informe o título de uma atividade para uma visita aberta.',
            true
        );
        return;
    }

    const activity = {
        id: state.nextActivityId++,
        title,
        description,
        status: 'PENDENTE',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        notes: []
    };

    visit.activities.push(activity);

    const analyst = analystById(visit.analystId);
    const unit = unitById(visit.unitId);

    logAction(
        'Atividade criada',
        `Atividade #${activity.id} · ${activity.title} · Visita #${visit.id} · ${analyst?.name || 'Analista'} · ${unit?.name || 'Unidade'} · Status PENDENTE.`
    );

    if (!saveState()) return;

    $('#activity-dialog').close();

    renderAll();
    toast('Atividade criada com status Pendente.');
}

/* ATUALIZAÇÃO DE STATUS */

function saveActivityStatus(button) {
    const visit = state.visits.find(
        item => item.id === Number(button.dataset.visitId) &&
            !item.checkOutAt
    );

    const activity = visit?.activities.find(
        item => item.id === Number(button.dataset.activityId)
    );

    const controls = button.closest('.activity-controls');

    const select = controls?.querySelector(
        '[data-status-select]'
    );

    const noteInput = controls?.querySelector(
        '[data-status-note]'
    );

    const nextStatus = select?.value;
    const note = noteInput?.value.trim() || '';

    if (!visit || !activity) {
        toast(
            'Atividade não encontrada ou visita encerrada.',
            true
        );
        return;
    }

    if (TERMINAL.includes(activity.status)) {
        toast(
            'Atividades concluídas ou canceladas não podem ser alteradas nesta demonstração.',
            true
        );
        return;
    }

    if (!STATUS[nextStatus]) {
        toast('Selecione um status válido.', true);
        return;
    }

    if (nextStatus === activity.status && !note) {
        toast(
            'Selecione um novo status ou informe uma observação.',
            true
        );
        return;
    }

    const previousStatus = activity.status;
    const now = new Date().toISOString();

    if (
        nextStatus === 'EM_EXECUCAO' &&
        !activity.startedAt
    ) {
        activity.startedAt = now;
    }

    if (nextStatus === 'CONCLUIDA') {
        activity.completedAt = now;
    }

    activity.status = nextStatus;

    if (!Array.isArray(activity.notes)) {
        activity.notes = [];
    }

    activity.notes.push({
        at: now,
        previousStatus,
        status: nextStatus,
        note
    });

    const analyst = analystById(visit.analystId);

    const detail = previousStatus === nextStatus
        ? `Observação registrada para a atividade #${activity.id} · ${activity.title}.`
        : `Atividade #${activity.id} · ${activity.title} · ${STATUS[previousStatus]?.label || previousStatus} → ${STATUS[nextStatus].label}.`;

    logAction(
        previousStatus === nextStatus
            ? 'Observação registrada'
            : 'Status atualizado',
        `${detail}${note ? ` Observação: ${note}` : ''} Responsável: ${analyst?.name || 'Analista'}.`
    );

    if (!saveState()) return;

    renderAll();

    toast(
        previousStatus === nextStatus
            ? 'Observação adicionada ao histórico.'
            : 'Status da atividade atualizado.'
    );
}

/* ENCERRAMENTO DE VISITA */

function closeVisit(button) {
    const visit = state.visits.find(
        item => item.id === Number(button.dataset.visitId) &&
            !item.checkOutAt
    );

    if (!visit) return;

    if (
        !visit.activities.length ||
        !visit.activities.every(
            activity => TERMINAL.includes(activity.status)
        )
    ) {
        toast(
            'Conclua ou cancele todas as atividades antes de encerrar a visita.',
            true
        );
        return;
    }

    const analyst = analystById(visit.analystId);
    const unit = unitById(visit.unitId);

    if (!confirm(
        `Encerrar a visita de ${analyst?.name || 'este analista'}?`
    )) {
        return;
    }

    visit.checkOutAt = new Date().toISOString();

    logAction(
        'Visita encerrada',
        `Visita #${visit.id} · ${analyst?.name || 'Analista'} · ${unit?.name || 'Unidade'} · ${visit.activities.length} atividades.`
    );

    if (!saveState()) return;

    renderAll();
    toast('Visita encerrada.');
}

/* ATIVAÇÃO DE ANALISTAS */

function toggleAnalyst(button) {
    const analyst = analystById(
        Number(button.dataset.analystId)
    );

    if (!analyst) return;

    if (openVisits().some(
        visit => visit.analystId === analyst.id
    )) {
        toast(
            'Encerre a visita antes de desativar o analista.',
            true
        );
        return;
    }

    analyst.active = !analyst.active;

    logAction(
        analyst.active
            ? 'Analista reativado'
            : 'Analista desativado',
        `${analyst.name} (${analyst.email}).`
    );

    if (!saveState()) return;

    renderAll();
    setView('analysts');

    toast(
        analyst.active
            ? 'Analista reativado.'
            : 'Analista desativado.'
    );
}

/* REMOÇÃO DE UNIDADES */

function deleteUnit(button) {
    const id = Number(button.dataset.unitId);

    if (state.visits.some(visit => visit.unitId === id)) {
        toast(
            'Esta unidade possui visitas associadas e não pode ser removida.',
            true
        );
        return;
    }

    const unit = unitById(id);

    if (!unit || !confirm(
        `Remover a unidade "${unit.name}" desta demonstração?`
    )) {
        return;
    }

    state.units = state.units.filter(
        item => item.id !== id
    );

    logAction(
        'Unidade removida',
        `${unit.code} · ${unit.name}.`
    );

    if (!saveState()) return;

    renderAll();
    setView('units');

    toast('Unidade removida.');
}

/* RESTAURAÇÃO DOS DADOS DE EXEMPLO */

function resetDemo() {
    if (!confirm(
        'Restaurar os dados de exemplo? As alterações e o histórico desta demonstração neste navegador serão substituídos.'
    )) {
        return;
    }

    state = sampleState();

    logAction(
        'Demonstração restaurada',
        'Os dados fictícios de exemplo foram restaurados.'
    );

    if (!saveState()) return;

    renderAll();
    setView('dashboard');

    toast('Dados de exemplo restaurados.');
}

/* IMPORTAÇÃO LOCAL DE EXCEL E CSV */

function renderImportHelp() {
    const fileInput = $('#import-file');

    if (
        fileInput &&
        !fileInput.files.length &&
        !pendingImport
    ) {
        $('#import-preview').classList.add('preview-hidden');
    }
}

function normalizeHeader(value) {
    return String(value ?? '')
        .replace(/^\uFEFF/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function cleanCell(value) {
    if (value === null || value === undefined) return '';

    return String(value)
        .replace(/\s+/g, ' ')
        .trim();
}

// Chave técnica local de deduplicação.
// Não é um hash criptográfico nem representa anonimização.
function makeSourceKey(id, name, city) {
    const text = [
        cleanCell(id),
        cleanCell(name).toLocaleLowerCase('pt-BR'),
        cleanCell(city).toLocaleLowerCase('pt-BR')
    ].join('|');

    let hash = 2166136261;

    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return `src-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function findColumn(headers, aliases) {
    return headers.find(header =>
        aliases.includes(normalizeHeader(header))
    );
}

async function prepareImport(event) {
    event.preventDefault();

    const file = $('#import-file').files?.[0];

    if (!file) {
        toast('Selecione um arquivo Excel ou CSV.', true);
        return;
    }

    if (file.size > MAX_IMPORT_BYTES) {
        toast(
            'O arquivo ultrapassa 20 MB, limite desta demonstração.',
            true
        );
        return;
    }

    if (!window.XLSX) {
        toast(
            'A biblioteca Excel não carregou. Confira a conexão e atualize a página.',
            true
        );
        return;
    }

    const extension = file.name.split('.').pop().toLowerCase();

    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        toast(
            'Formato não suportado. Escolha XLSX, XLS ou CSV.',
            true
        );
        return;
    }

    const preview = $('#import-preview');

    preview.classList.remove('preview-hidden');

    $('#import-summary').textContent =
        'Lendo a planilha neste navegador…';

    $('#import-preview-body').innerHTML = '';
    $('#confirm-import').disabled = true;

    try {
        // A leitura ocorre localmente. O arquivo não é enviado ao servidor.
        const buffer = await file.arrayBuffer();

        const workbook = window.XLSX.read(
            buffer,
            { type: 'array' }
        );

        const firstSheet = workbook.SheetNames[0];

        if (!firstSheet) {
            throw new Error(
                'Não foi encontrada nenhuma aba na planilha.'
            );
        }

        const worksheet = workbook.Sheets[firstSheet];

        const rows = window.XLSX.utils.sheet_to_json(
            worksheet,
            {
                defval: null,
                raw: false
            }
        );

        if (!rows.length) {
            throw new Error(
                'A primeira aba não contém linhas de dados.'
            );
        }

        const headers = Object.keys(rows[0]);

        const idColumn = findColumn(headers, [
            'ID',
            'CODIGO',
            'CODIGO DA UNIDADE',
            'CODIGO UNIDADE'
        ]);

        const nameColumn = findColumn(headers, [
            'UNIDADE',
            'NOME DA UNIDADE',
            'NOME UNIDADE'
        ]);

        const cityColumn = findColumn(headers, [
            'MUNICIPIO',
            'CIDADE',
            'MUNICIPIO DA UNIDADE'
        ]);

        if (!idColumn || !nameColumn) {
            throw new Error(
                'Não encontrei as colunas ID e UNIDADE. Confira os cabeçalhos da primeira linha.'
            );
        }

        const prepared = [];
        const seenIds = new Set();

        let invalidRows = 0;
        let duplicatesInFile = 0;

        for (const row of rows) {
            const externalId = cleanCell(row[idColumn]);
            const name = cleanCell(row[nameColumn]);
            const city = cityColumn
                ? cleanCell(row[cityColumn])
                : '';

            // Somente ID numérico, nome da unidade e município.
            // As demais colunas são descartadas.
            if (!/^\d+$/.test(externalId) || !name) {
                invalidRows++;
                continue;
            }

            if (seenIds.has(externalId)) {
                duplicatesInFile++;
                continue;
            }

            seenIds.add(externalId);

            const sourceKey = makeSourceKey(
                externalId,
                name,
                city
            );

            prepared.push({
                sourceKey,
                name,
                city
            });
        }

        if (!prepared.length) {
            throw new Error(
                'Nenhuma unidade válida foi encontrada. São necessárias as colunas ID e UNIDADE.'
            );
        }

        const existingKeys = new Set(
            state.units
                .map(unit => unit.sourceKey)
                .filter(Boolean)
        );

        const alreadyImported = prepared.filter(
            unit => existingKeys.has(unit.sourceKey)
        ).length;

        const newItems = prepared.filter(
            unit => !existingKeys.has(unit.sourceKey)
        );

        pendingImport = {
            items: newItems,
            totalValid: prepared.length,
            invalidRows,
            duplicatesInFile,
            alreadyImported
        };

        renderImportPreview();

    } catch (error) {
        console.error(
            'Erro ao analisar a planilha:',
            error
        );

        pendingImport = null;

        preview.classList.remove('preview-hidden');

        $('#import-summary').textContent =
            error.message || 'Não foi possível ler a planilha.';

        $('#import-preview-body').innerHTML = '';
        $('#import-preview-count').textContent = 'Falha na análise';
        $('#confirm-import').disabled = true;

        toast(
            error.message || 'Não foi possível analisar o arquivo.',
            true
        );
    }
}

function renderImportPreview() {
    if (!pendingImport) return;

    const tableRows = pendingImport.items
        .slice(0, 15)
        .map((item, index) => {
            const code =
                `IMP-${String(state.nextUnitId + index).padStart(4, '0')}`;

            return `
                <tr>
                    <td>${code}</td>
                    <td>${esc(item.name)}</td>
                    <td>${esc(item.city || '—')}</td>
                    <td class="row-new">Será importada</td>
                </tr>
            `;
        })
        .join('');

    const extraRows = pendingImport.items.length > 15
        ? `
            <tr>
                <td colspan="4">
                    … mais ${pendingImport.items.length - 15}
                    unidades serão incluídas após a confirmação.
                </td>
            </tr>
        `
        : '';

    $('#import-preview-body').innerHTML =
        tableRows + extraRows;

    $('#import-preview-count').textContent =
        `${pendingImport.items.length} novas unidades`;

    $('#import-summary').innerHTML = `
        Encontradas <strong>${pendingImport.totalValid}</strong> unidades válidas.
        <strong>${pendingImport.items.length}</strong> serão adicionadas;
        <strong>${pendingImport.alreadyImported}</strong> já existem e serão ignoradas;
        <strong>${pendingImport.duplicatesInFile}</strong> duplicatas no arquivo foram ignoradas;
        <strong>${pendingImport.invalidRows}</strong> linhas inválidas foram ignoradas.
        <br>
        Campos guardados: <strong>nome da unidade e município</strong>,
        além de uma chave técnica de deduplicação. As demais colunas não são armazenadas.
    `;

    $('#confirm-import').disabled =
        pendingImport.items.length === 0;
}

function confirmImport() {
    if (!pendingImport || !pendingImport.items.length) {
        toast('Não há novas unidades para importar.', true);
        return;
    }

    const items = pendingImport.items;

    let added = 0;

    const skipped =
        pendingImport.alreadyImported +
        pendingImport.duplicatesInFile;

    for (const item of items) {
        if (state.units.some(
            unit => unit.sourceKey &&
                unit.sourceKey === item.sourceKey
        )) {
            continue;
        }

        const code =
            `IMP-${String(state.nextUnitId).padStart(4, '0')}`;

        state.units.push({
            id: state.nextUnitId++,
            code,
            name: item.name,
            city: item.city,
            sourceKey: item.sourceKey,
            imported: true
        });

        added++;
    }

    if (added === 0) {
        toast(
            'Todas as unidades da planilha já foram importadas.',
            true
        );
        return;
    }

    logAction(
        'Planilha importada',
        `${added} unidades adicionadas; ${skipped} duplicatas ignoradas; ${pendingImport.invalidRows} linhas inválidas ignoradas. Campos de infraestrutura foram descartados.`
    );

    if (!saveState()) return;

    pendingImport = null;

    $('#import-form').reset();

    $('#import-preview').classList.add('preview-hidden');
    $('#import-preview-body').innerHTML = '';
    $('#import-summary').textContent = '';
    $('#confirm-import').disabled = true;

    renderAll();
    setView('units');

    toast(
        `${added} unidades importadas localmente. Nenhum arquivo foi enviado ao servidor.`
    );
}

/* HISTÓRICO DE AÇÕES */

function renderHistory() {
    const search = ($('#history-search')?.value || '')
        .trim()
        .toLocaleLowerCase('pt-BR');

    const select = $('#history-action-filter');
    const previous = select.value;

    const actions = [...new Set(
        state.auditLog.map(entry => entry.action)
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

    const filtered = [...state.auditLog]
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .filter(entry => {
            const matchesAction =
                !actionFilter || entry.action === actionFilter;

            const text =
                `${entry.action} ${entry.user} ${entry.detail}`
                    .toLocaleLowerCase('pt-BR');

            return matchesAction &&
                (!search || text.includes(search));
        });

    $('#history-count').textContent =
        `${filtered.length} ${
            filtered.length === 1 ? 'registro' : 'registros'
        }`;

    $('#history-body').innerHTML = filtered.map(entry => `
        <tr>
            <td title="${esc(entry.at)}">
                ${esc(isoTime(entry.at))}
            </td>

            <td class="history-action">
                ${esc(entry.action)}
            </td>

            <td>
                ${esc(entry.user || DEMO_USER)}
            </td>

            <td class="history-detail">
                ${esc(entry.detail)}
            </td>
        </tr>
    `).join('');

    const empty = $('#history-empty');

    empty.classList.toggle(
        'preview-hidden',
        filtered.length > 0
    );

    $('#history-body').parentElement.classList.toggle(
        'preview-hidden',
        filtered.length === 0
    );

    $('#nav-history-count').textContent =
        state.auditLog.length;
}

function exportHistoryCSV() {
    const entries = [...state.auditLog]
        .sort((a, b) => new Date(b.at) - new Date(a.at));

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
    link.download = 'oviv-historico-demonstracao.csv';

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    logAction(
        'Histórico exportado',
        `${entries.length} registros exportados para CSV neste dispositivo.`
    );

    saveState();
    renderHistory();

    toast('Histórico exportado como CSV neste dispositivo.');
}

/* EVENTOS DA INTERFACE */

function renderAll() {
    renderSummary();
    renderDashboard();
    renderAnalysts();
    renderUnits();
    renderVisitOptions();
    renderHistory();
}

document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');

    if (nav) {
        event.preventDefault();
        setView(nav.dataset.nav);
        return;
    }

    const action = event.target.closest('[data-action]');

    if (!action) return;

    switch (action.dataset.action) {
        case 'add-activity':
            openActivity(action.dataset.visitId);
            break;

        case 'save-status':
            saveActivityStatus(action);
            break;

        case 'close-visit':
            closeVisit(action);
            break;

        case 'toggle-analyst':
            toggleAnalyst(action);
            break;

        case 'delete-unit':
            deleteUnit(action);
            break;
    }
});

$('#analyst-form').addEventListener(
    'submit',
    createAnalyst
);

$('#unit-form').addEventListener(
    'submit',
    createUnit
);

$('#visit-form').addEventListener(
    'submit',
    createVisit
);

$('#activity-form').addEventListener(
    'submit',
    createActivity
);

$('#import-form').addEventListener(
    'submit',
    prepareImport
);

$('#confirm-import').addEventListener(
    'click',
    confirmImport
);

$('#cancel-import').addEventListener('click', () => {
    pendingImport = null;

    $('#import-preview').classList.add('preview-hidden');
    $('#import-preview-body').innerHTML = '';
    $('#import-summary').textContent = '';
    $('#confirm-import').disabled = true;
    $('#import-file').value = '';

    toast(
        'Importação cancelada. Nenhuma unidade foi adicionada.'
    );
});

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

$('#close-activity-dialog').addEventListener('click', () => {
    $('#activity-dialog').close();
});

$('#cancel-activity').addEventListener('click', () => {
    $('#activity-dialog').close();
});

$('#reset-demo').addEventListener(
    'click',
    resetDemo
);

$('#refresh-dashboard').addEventListener('click', () => {
    renderAll();
    toast('Painel atualizado com os dados locais.');
});

window.addEventListener('hashchange', () => {
    setView(location.hash.slice(1) || 'dashboard');
});

renderAll();
setView(location.hash.slice(1) || 'dashboard');