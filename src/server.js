import express from 'express';
import { pool } from './db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from '../routes/auth.js';
import projectActivityRoutes from '../routes/project-activities.js';
import { attachUser } from './auth-middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;


// ============================================================
// MIDDLEWARES E ARQUIVOS ESTÁTICOS
// ============================================================

app.use(express.json({
    limit: '25mb'
}));

app.use(express.static(
    path.join(__dirname, '../public')
));

app.use(
    '/public',
    express.static(path.join(__dirname, '../public'))
);

app.get('/', (_req, res) => {
    res.sendFile(
        path.join(__dirname, '../index.html')
    );
});


// ============================================================
// NOVA API: AUTENTICAÇÃO E SESSÕES
// POST /api/auth/login
// GET  /api/auth/me
// POST /api/auth/logout
// GET  /api/auth/analysts
// POST /api/auth/analysts
// ============================================================

app.use(
    '/api/auth',
    attachUser,
    authRoutes
);


// ============================================================
// NOVA API: PROJETOS E ATIVIDADES DE CONFIGURAÇÃO LÓGICA
//
// GET   /api/oviv/projects
// GET   /api/oviv/projects/:projectId/activities
// POST  /api/oviv/projects/:projectId/import
// PATCH /api/oviv/projects/:projectId/activities/:activityId/assign
// POST  /api/oviv/projects/:projectId/activities/:activityId/adopt
// PATCH /api/oviv/projects/:projectId/activities/:activityId/status
// GET   /api/oviv/projects/:projectId/history
// ============================================================

app.use(
    '/api/oviv',
    attachUser,
    projectActivityRoutes
);


// ============================================================
// SAÚDE DO POSTGRESQL
// GET /api/db-health
// ============================================================

app.get('/api/db-health', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                current_database() AS database,
                NOW() AS server_time`
        );

        return res.json({
            status: 'ok',
            message: 'Conexão com o PostgreSQL funcionando!',
            database: result.rows[0].database,
            serverTime: result.rows[0].server_time
        });
    } catch (error) {
        console.error(
            'Falha ao consultar o banco:',
            error.message
        );

        return res.status(500).json({
            status: 'error',
            message: 'Não foi possível consultar o banco de dados.'
        });
    }
});


// ============================================================
// API ANTIGA: LISTAR UNIDADES
// GET /api/units
// ============================================================

app.get('/api/units', async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                external_id,
                company,
                unit_name,
                city,
                equipment_model,
                contracted_speed
            FROM units
            ORDER BY id
        `);

        return res.status(200).json({
            total: result.rowCount,
            units: result.rows
        });
    } catch (error) {
        console.error(
            'Erro ao consultar unidades:',
            error.message
        );

        return res.status(500).json({
            message: 'Erro ao consultar as unidades.'
        });
    }
});


// ============================================================
// API ANTIGA: PESQUISAR UNIDADE POR NETWORK OU HOSTNAME
// GET /api/units/search/:identifier
// ============================================================

app.get(
    '/api/units/search/:identifier',
    async (req, res) => {
        try {
            const identifier = String(
                req.params.identifier || ''
            ).trim();

            if (!identifier) {
                return res.status(400).json({
                    message: 'Informe um NETWORK ou HOSTNAME.'
                });
            }

            // Escapa caracteres especiais para uma busca por trecho
            // numérico não se transformar em uma expressão arbitrária.
            const escapedIdentifier = identifier.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&'
            );

            const result = await pool.query(
                `SELECT
                    id,
                    network,
                    hostname,
                    network_to_clone,
                    coordinates,
                    quantity,
                    equipment_model,
                    vgr_id,
                    meraki_lan_network,
                    meraki_lan_ip,
                    dedicated_id,
                    internet_id,
                    contracted_speed,
                    service_type,
                    carrier,
                    lot,
                    fortinet_info,
                    raw_data
                 FROM units
                 WHERE
                    LOWER(TRIM(network)) = LOWER(TRIM($1))
                    OR LOWER(TRIM(hostname)) = LOWER(TRIM($1))
                    OR network ~ ('(^|[^0-9])' || $2 || '([^0-9]|$)')
                    OR hostname ~ ('(^|[^0-9])' || $2 || '([^0-9]|$)')
                 LIMIT 2`,
                [
                    identifier,
                    escapedIdentifier
                ]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    message:
                        'Nenhuma unidade encontrada com esse NETWORK ou HOSTNAME.'
                });
            }

            if (result.rowCount > 1) {
                return res.status(409).json({
                    message:
                        'A pesquisa encontrou mais de uma unidade. É necessário refinar o identificador.'
                });
            }

            return res.status(200).json({
                unit: result.rows[0]
            });
        } catch (error) {
            console.error(
                'Erro ao pesquisar unidade:',
                error.message
            );

            return res.status(500).json({
                message: 'Erro interno ao pesquisar a unidade.'
            });
        }
    }
);


// ============================================================
// API ANTIGA: CHECK-IN DE UM ANALISTA EM UMA UNIDADE
// POST /api/visits/check-in
//
// Esta rota pertence ao fluxo de visitas. Ela não cadastra
// usuários e não substitui o login do Oviv.
// ============================================================

app.post(
    '/api/visits/check-in',
    async (req, res) => {
        const analystId = Number(req.body?.analystId);
        const unitId = Number(req.body?.unitId);

        if (
            !Number.isSafeInteger(analystId) ||
            analystId <= 0 ||
            !Number.isSafeInteger(unitId) ||
            unitId <= 0
        ) {
            return res.status(400).json({
                message:
                    'Informe um ID de analista e uma unidade válidos.'
            });
        }

        try {
            const analyst = await pool.query(
                `SELECT id
                 FROM users
                 WHERE id = $1
                   AND role = 'ANALISTA'
                   AND active = TRUE`,
                [analystId]
            );

            if (analyst.rowCount === 0) {
                return res.status(404).json({
                    message: 'Analista não encontrado ou inativo.'
                });
            }

            const unit = await pool.query(
                `SELECT id
                 FROM units
                 WHERE id = $1`,
                [unitId]
            );

            if (unit.rowCount === 0) {
                return res.status(404).json({
                    message: 'Unidade não encontrada.'
                });
            }

            const result = await pool.query(
                `INSERT INTO visits (
                    analyst_id,
                    unit_id
                 )
                 VALUES ($1, $2)
                 RETURNING
                    id,
                    analyst_id,
                    unit_id,
                    check_in_at,
                    checked_out_at`,
                [
                    analystId,
                    unitId
                ]
            );

            return res.status(201).json({
                message: 'Check-in registrado com sucesso.',
                visit: result.rows[0]
            });
        } catch (error) {
            if (
                error.code === '23505' &&
                error.constraint === 'visits_one_open_per_analyst'
            ) {
                return res.status(409).json({
                    message:
                        'Este analista já possui uma visita aberta.'
                });
            }

            console.error(
                'Erro ao registrar check-in:',
                error.message
            );

            return res.status(500).json({
                message: 'Não foi possível registrar o check-in.'
            });
        }
    }
);


// ============================================================
// API ANTIGA: CRIAR ATIVIDADE DENTRO DE UMA VISITA
// POST /api/visits/:visitId/activities
// ============================================================

app.post(
    '/api/visits/:visitId/activities',
    async (req, res) => {
        const visitId = Number(req.params.visitId);

        const title =
            typeof req.body?.title === 'string'
                ? req.body.title.trim()
                : '';

        const description =
            typeof req.body?.description === 'string'
                ? req.body.description.trim() || null
                : null;

        if (
            !Number.isSafeInteger(visitId) ||
            visitId <= 0 ||
            !title
        ) {
            return res.status(400).json({
                message:
                    'Informe uma visita válida e o título da atividade.'
            });
        }

        let client;
        let transactionOpen = false;

        try {
            client = await pool.connect();

            await client.query('BEGIN');
            transactionOpen = true;

            const visitResult = await client.query(
                `SELECT id, checked_out_at
                 FROM visits
                 WHERE id = $1
                 FOR UPDATE`,
                [visitId]
            );

            if (visitResult.rowCount === 0) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(404).json({
                    message: 'Visita não encontrada.'
                });
            }

            if (
                visitResult.rows[0].checked_out_at !== null
            ) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(409).json({
                    message:
                        'Não é possível adicionar atividades a uma visita encerrada.'
                });
            }

            const activityResult = await client.query(
                `INSERT INTO activities (
                    visit_id,
                    title,
                    description
                 )
                 VALUES ($1, $2, $3)
                 RETURNING
                    id,
                    visit_id,
                    title,
                    description,
                    status,
                    created_at`,
                [
                    visitId,
                    title,
                    description
                ]
            );

            const activity = activityResult.rows[0];

            await client.query(
                `INSERT INTO activity_history (
                    activity_id,
                    previous_status,
                    new_status,
                    notes
                 )
                 VALUES ($1, NULL, 'PENDENTE', $2)`,
                [
                    activity.id,
                    'Atividade criada na visita'
                ]
            );

            await client.query('COMMIT');
            transactionOpen = false;

            return res.status(201).json({
                message: 'Atividade criada com sucesso.',
                activity
            });
        } catch (error) {
            if (client && transactionOpen) {
                await client.query('ROLLBACK');
            }

            console.error(
                'Erro ao criar atividade:',
                error.message
            );

            return res.status(500).json({
                message: 'Não foi possível criar a atividade.'
            });
        } finally {
            if (client) {
                client.release();
            }
        }
    }
);


// ============================================================
// API ANTIGA: ATUALIZAR STATUS DE UMA ATIVIDADE DE VISITA
// PATCH /api/activities/:activityId/status
// ============================================================

app.patch(
    '/api/activities/:activityId/status',
    async (req, res) => {
        const activityId = Number(req.params.activityId);
        const status = req.body?.status;

        const allowedStatuses = [
            'PENDENTE',
            'EM_DESLOCAMENTO',
            'EM_EXECUCAO',
            'CONCLUIDA',
            'IMPEDIMENTO',
            'CANCELADA'
        ];

        const notes =
            typeof req.body?.notes === 'string'
                ? req.body.notes.trim() || null
                : null;

        if (
            !Number.isSafeInteger(activityId) ||
            activityId <= 0
        ) {
            return res.status(400).json({
                message: 'Informe um ID de atividade válido.'
            });
        }

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                message: 'Status inválido.',
                statusPermitidos: allowedStatuses
            });
        }

        let client;
        let transactionOpen = false;

        try {
            client = await pool.connect();

            await client.query('BEGIN');
            transactionOpen = true;

            const currentResult = await client.query(
                `SELECT
                    a.id,
                    a.status,
                    a.started_at,
                    a.completed_at,
                    v.checked_out_at
                 FROM activities a
                 JOIN visits v
                    ON v.id = a.visit_id
                 WHERE a.id = $1
                 FOR UPDATE OF a, v`,
                [activityId]
            );

            if (currentResult.rowCount === 0) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(404).json({
                    message: 'Atividade não encontrada.'
                });
            }

            const currentActivity = currentResult.rows[0];

            if (currentActivity.checked_out_at !== null) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(409).json({
                    message:
                        'Não é possível alterar uma atividade de uma visita encerrada.'
                });
            }

            if (
                currentActivity.status === 'CONCLUIDA' ||
                currentActivity.status === 'CANCELADA'
            ) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(409).json({
                    message:
                        'Uma atividade concluída ou cancelada não pode ser alterada.'
                });
            }

            if (currentActivity.status === status) {
                await client.query('COMMIT');
                transactionOpen = false;

                return res.status(200).json({
                    message: 'A atividade já possui esse status.',
                    activity: {
                        id: currentActivity.id,
                        status: currentActivity.status
                    }
                });
            }

            const updatedResult = await client.query(
                `UPDATE activities
                 SET
                    status = $2,

                    started_at = CASE
                        WHEN $2 = 'EM_EXECUCAO'
                             AND started_at IS NULL
                        THEN NOW()
                        ELSE started_at
                    END,

                    completed_at = CASE
                        WHEN $2 = 'CONCLUIDA'
                        THEN NOW()
                        ELSE completed_at
                    END,

                    updated_at = NOW()

                 WHERE id = $1

                 RETURNING
                    id,
                    visit_id,
                    title,
                    status,
                    started_at,
                    completed_at,
                    updated_at`,
                [
                    activityId,
                    status
                ]
            );

            await client.query(
                `INSERT INTO activity_history (
                    activity_id,
                    previous_status,
                    new_status,
                    notes
                 )
                 VALUES ($1, $2, $3, $4)`,
                [
                    activityId,
                    currentActivity.status,
                    status,
                    notes
                ]
            );

            await client.query('COMMIT');
            transactionOpen = false;

            return res.status(200).json({
                message: 'Status atualizado com sucesso.',
                activity: updatedResult.rows[0]
            });
        } catch (error) {
            if (client && transactionOpen) {
                await client.query('ROLLBACK');
            }

            console.error(
                'Erro ao atualizar status:',
                error.message
            );

            return res.status(500).json({
                message:
                    'Não foi possível atualizar o status da atividade.'
            });
        } finally {
            if (client) {
                client.release();
            }
        }
    }
);


// ============================================================
// API ANTIGA: DASHBOARD DE VISITAS
// GET /api/dashboard
// ============================================================

app.get('/api/dashboard', async (_req, res) => {
    try {
        const summary = await pool.query(`
            SELECT
                (
                    SELECT COUNT(*)
                    FROM activities a
                    JOIN visits v
                        ON v.id = a.visit_id
                    WHERE v.checked_out_at IS NULL
                      AND a.status = 'PENDENTE'
                ) AS pending,

                (
                    SELECT COUNT(*)
                    FROM activities a
                    JOIN visits v
                        ON v.id = a.visit_id
                    WHERE v.checked_out_at IS NULL
                      AND a.status IN (
                          'EM_DESLOCAMENTO',
                          'EM_EXECUCAO'
                      )
                ) AS in_progress,

                (
                    SELECT COUNT(*)
                    FROM activities a
                    JOIN visits v
                        ON v.id = a.visit_id
                    WHERE v.checked_out_at IS NULL
                      AND a.status = 'IMPEDIMENTO'
                ) AS impediments,

                (
                    SELECT COUNT(*)
                    FROM activities
                    WHERE status = 'CONCLUIDA'
                      AND completed_at >= DATE_TRUNC('day', NOW())
                ) AS completed_today,

                (
                    SELECT COUNT(*)
                    FROM visits
                    WHERE checked_out_at IS NULL
                ) AS active_visits,

                (
                    SELECT COUNT(DISTINCT analyst_id)
                    FROM visits
                    WHERE checked_out_at IS NULL
                ) AS active_analysts
        `);

        const operations = await pool.query(`
            SELECT
                v.id AS visit_id,
                v.check_in_at,

                u.id AS analyst_id,
                u.name AS analyst_name,

                un.id AS unit_id,
                un.unit_name,
                un.city,

                a.id AS activity_id,
                a.title AS activity_title,
                a.description AS activity_description,
                a.status AS activity_status,
                a.started_at,
                a.completed_at

            FROM visits v

            JOIN users u
                ON u.id = v.analyst_id

            JOIN units un
                ON un.id = v.unit_id

            LEFT JOIN activities a
                ON a.visit_id = v.id

            WHERE v.checked_out_at IS NULL

            ORDER BY
                v.check_in_at DESC,
                a.created_at ASC NULLS LAST
        `);

        return res.status(200).json({
            summary: summary.rows[0],
            activeVisits: operations.rows
        });
    } catch (error) {
        console.error(
            'Erro ao consultar o dashboard:',
            error.message
        );

        return res.status(500).json({
            message: 'Não foi possível carregar o dashboard.'
        });
    }
});


// ============================================================
// SAÚDE DO SERVIDOR
// GET /api/health
// ============================================================

app.get('/api/health', (_req, res) => {
    return res.json({
        status: 'ok',
        message: 'Servidor do Projeto-Oviv funcionando!'
    });
});


// ============================================================
// TRATAMENTO DE ERROS NÃO TRATADOS PELAS ROTAS
// ============================================================

app.use((error, _req, res, _next) => {
    console.error(
        'Erro inesperado no servidor:',
        error.message
    );

    if (res.headersSent) {
        return;
    }

    return res.status(500).json({
        message: 'Ocorreu um erro interno no servidor.'
    });
});


// ============================================================
// INICIALIZAÇÃO
// ============================================================

app.listen(PORT, () => {
    console.log(
        `Servidor rodando em http://localhost:${PORT}`
    );
});