import { Router } from 'express';
import { pool } from '../src/db.js';

import {
    requireAuth,
    requireManager,
    requireAnalyst
} from '../src/auth-middleware.js';

const router = Router();

router.use(requireAuth);

const FINAL_STATUSES = new Set([
    'ATIVIDADE_MIGRADA',
    'CANCELADA'
]);

const VALID_STATUSES = new Set([
    'CONTATANDO_TECNICO',
    'INICIANDO_CONFIGURACAO',
    'FINALIZANDO_CONFIGURACAO',
    'TESTES_FINAIS',
    'ATIVIDADE_MIGRADA',
    'IMPEDIMENTO',
    'CANCELADA'
]);

const MAX_IMPORT_ROWS = 10000;

function positiveInteger(value) {
    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0
        ? number
        : null;
}

function safeText(value, maxLength = 500) {
    if (
        typeof value !== 'string' &&
        typeof value !== 'number'
    ) {
        return '';
    }

    return String(value).trim().slice(0, maxLength);
}

function safeRawData(value) {
    return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    )
        ? value
        : null;
}

async function projectExists(db, projectId) {
    const result = await db.query(
        `SELECT id, name, description
         FROM oviv_projects
         WHERE id = $1
           AND active = TRUE`,
        [projectId]
    );

    return result.rows[0] || null;
}

async function writeHistory(db, {
    projectId,
    activityId = null,
    actor,
    action,
    previousStatus = null,
    newStatus = null,
    details = ''
}) {
    await db.query(
        `INSERT INTO oviv_activity_history (
            project_id,
            activity_id,
            user_id,
            user_name,
            action,
            previous_status,
            new_status,
            details
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            projectId,
            activityId,
            actor.id,
            actor.name,
            action,
            previousStatus,
            newStatus,
            details
        ]
    );
}

function serverError(res, message, error) {
    console.error(message, error.message);

    return res.status(500).json({
        message
    });
}


// ============================================================
// GET /api/oviv/projects
// Lista projetos e totais.
// ============================================================

router.get('/projects', async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                p.id,
                p.name,
                p.description,

                COUNT(a.id)::INTEGER AS total,

                COUNT(a.id) FILTER (
                    WHERE a.status = 'PENDENTE'
                      AND a.adopted_by_user_id IS NULL
                )::INTEGER AS pending,

                COUNT(a.id) FILTER (
                    WHERE a.adopted_by_user_id IS NOT NULL
                )::INTEGER AS adopted,

                COUNT(a.id) FILTER (
                    WHERE a.started_at IS NOT NULL
                      AND a.completed_at IS NULL
                      AND a.status NOT IN (
                          'ATIVIDADE_MIGRADA',
                          'CANCELADA'
                      )
                )::INTEGER AS in_progress,

                COUNT(a.id) FILTER (
                    WHERE a.status = 'ATIVIDADE_MIGRADA'
                )::INTEGER AS completed,

                COUNT(a.id) FILTER (
                    WHERE a.status = 'IMPEDIMENTO'
                )::INTEGER AS blocked,

                COALESCE(
                    SUM(
                        GREATEST(
                            0,
                            EXTRACT(
                                EPOCH FROM (NOW() - a.started_at)
                            )
                        )
                    ) FILTER (
                        WHERE a.started_at IS NOT NULL
                          AND a.completed_at IS NULL
                          AND a.status NOT IN (
                              'ATIVIDADE_MIGRADA',
                              'CANCELADA'
                          )
                    ),
                    0
                )::BIGINT AS active_seconds

            FROM oviv_projects p

            LEFT JOIN oviv_project_activities a
                ON a.project_id = p.id

            WHERE p.active = TRUE

            GROUP BY p.id, p.name, p.description
            ORDER BY p.name
        `);

        return res.json({
            projects: result.rows
        });
    } catch (error) {
        return serverError(
            res,
            'Não foi possível listar os projetos.',
            error
        );
    }
});


// ============================================================
// GET /api/oviv/projects/:projectId/activities
// Inclui responsável atribuído e responsável pela adoção.
// ============================================================

router.get(
    '/projects/:projectId/activities',
    async (req, res) => {
        try {
            const project = await projectExists(
                pool,
                req.params.projectId
            );

            if (!project) {
                return res.status(404).json({
                    message: 'Projeto não encontrado.'
                });
            }

            const result = await pool.query(
                `SELECT
                    a.id,
                    a.project_id,
                    a.row_key,
                    a.identifier,
                    a.title,
                    a.city,
                    a.source_row,
                    a.status,

                    a.assigned_to_user_id,
                    assigned.name AS assigned_to_name,
                    a.assigned_by_user_id,
                    a.assigned_at,

                    a.adopted_by_user_id,
                    adopted.name AS analyst_name,

                    a.adopted_at,
                    a.started_at,
                    a.completed_at,
                    a.created_at,
                    a.updated_at,

                    CASE
                        WHEN a.started_at IS NULL THEN 0
                        ELSE GREATEST(
                            0,
                            EXTRACT(
                                EPOCH FROM (
                                    COALESCE(a.completed_at, NOW())
                                    - a.started_at
                                )
                            )
                        )::BIGINT
                    END AS elapsed_seconds

                 FROM oviv_project_activities a

                 LEFT JOIN users assigned
                    ON assigned.id = a.assigned_to_user_id

                 LEFT JOIN users adopted
                    ON adopted.id = a.adopted_by_user_id

                 WHERE a.project_id = $1

                 ORDER BY a.created_at, a.id`,
                [project.id]
            );

            return res.json({
                project,
                total: result.rowCount,
                activities: result.rows
            });
        } catch (error) {
            return serverError(
                res,
                'Não foi possível consultar as atividades.',
                error
            );
        }
    }
);


// ============================================================
// POST /api/oviv/projects/:projectId/import
// Somente gestor pode importar.
// ============================================================

router.post(
    '/projects/:projectId/import',
    requireManager,
    async (req, res) => {
        const rows = req.body?.activities;

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({
                message:
                    'Envie activities com as linhas da planilha.'
            });
        }

        if (rows.length > MAX_IMPORT_ROWS) {
            return res.status(413).json({
                message:
                    `Limite de ${MAX_IMPORT_ROWS} linhas por requisição.`
            });
        }

        const client = await pool.connect();
        let transactionOpen = false;

        try {
            const project = await projectExists(
                client,
                req.params.projectId
            );

            if (!project) {
                return res.status(404).json({
                    message: 'Projeto não encontrado.'
                });
            }

            await client.query('BEGIN');
            transactionOpen = true;

            let imported = 0;
            let duplicates = 0;
            let invalid = 0;

            for (const item of rows) {
                const rawData = safeRawData(item?.rawData);
                const rowKey = safeText(item?.rowKey, 200);

                if (!rawData || !rowKey) {
                    invalid++;
                    continue;
                }

                const inserted = await client.query(
                    `INSERT INTO oviv_project_activities (
                        project_id,
                        row_key,
                        identifier,
                        title,
                        city,
                        source_row
                     )
                     VALUES ($1, $2, $3, $4, $5, $6::JSONB)

                     ON CONFLICT (project_id, row_key)
                     DO NOTHING

                     RETURNING id`,
                    [
                        project.id,
                        rowKey,
                        safeText(item.identifier),
                        safeText(item.title),
                        safeText(item.city),
                        JSON.stringify(rawData)
                    ]
                );

                if (inserted.rowCount) {
                    imported++;
                } else {
                    duplicates++;
                }
            }

            await writeHistory(client, {
                projectId: project.id,
                actor: req.user,
                action: 'Planilha importada',
                details:
                    `${imported} atividades importadas; ` +
                    `${duplicates} duplicatas ignoradas; ` +
                    `${invalid} linhas inválidas.`
            });

            await client.query('COMMIT');
            transactionOpen = false;

            return res.status(201).json({
                message: 'Importação processada.',
                projectId: project.id,
                received: rows.length,
                imported,
                duplicates,
                invalid
            });
        } catch (error) {
            if (transactionOpen) {
                await client.query('ROLLBACK');
            }

            return serverError(
                res,
                'Não foi possível importar as atividades.',
                error
            );
        } finally {
            client.release();
        }
    }
);


// ============================================================
// PATCH /api/oviv/projects/:projectId/activities/:activityId/assign
// Somente gestor pode atribuir. A atribuição não inicia o timer.
// ============================================================

router.patch(
    '/projects/:projectId/activities/:activityId/assign',
    requireManager,
    async (req, res) => {
        const activityId = positiveInteger(
            req.params.activityId
        );

        const analystId = positiveInteger(
            req.body?.analystId
        );

        if (!activityId || !analystId) {
            return res.status(400).json({
                message:
                    'Informe uma atividade e um analista válidos.'
            });
        }

        const client = await pool.connect();
        let transactionOpen = false;

        try {
            const analystResult = await client.query(
                `SELECT id, name
                 FROM users
                 WHERE id = $1
                   AND role = 'ANALISTA'
                   AND active = TRUE
                 LIMIT 1`,
                [analystId]
            );

            if (!analystResult.rowCount) {
                return res.status(404).json({
                    message:
                        'O analista não existe ou está inativo.'
                });
            }

            await client.query('BEGIN');
            transactionOpen = true;

            const found = await client.query(
                `SELECT
                    id,
                    project_id,
                    identifier,
                    title,
                    status,
                    assigned_to_user_id,
                    adopted_by_user_id
                 FROM oviv_project_activities
                 WHERE id = $1
                   AND project_id = $2
                 FOR UPDATE`,
                [
                    activityId,
                    req.params.projectId
                ]
            );

            if (!found.rowCount) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(404).json({
                    message:
                        'Atividade não encontrada neste projeto.'
                });
            }

            const activity = found.rows[0];

            if (activity.adopted_by_user_id !== null) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(409).json({
                    message:
                        'A atividade já foi adotada e não pode ser reatribuída por esta ação.'
                });
            }

            const previousAssignment =
                activity.assigned_to_user_id;

            const updated = await client.query(
                `UPDATE oviv_project_activities
                 SET
                    assigned_to_user_id = $2,
                    assigned_by_user_id = $3,
                    assigned_at = NOW(),
                    updated_at = NOW()
                 WHERE id = $1

                 RETURNING
                    id,
                    project_id,
                    identifier,
                    title,
                    status,
                    assigned_to_user_id,
                    assigned_by_user_id,
                    assigned_at`,
                [
                    activityId,
                    analystId,
                    req.user.id
                ]
            );

            const analystName =
                analystResult.rows[0].name;

            await writeHistory(client, {
                projectId: activity.project_id,
                activityId,
                actor: req.user,
                action: previousAssignment
                    ? 'Atribuição alterada'
                    : 'Atividade atribuída',
                details:
                    `${activity.identifier || activity.id} · ` +
                    `Responsável atribuído: ${analystName}`
            });

            await client.query('COMMIT');
            transactionOpen = false;

            return res.json({
                message: 'Atividade atribuída com sucesso.',
                activity: updated.rows[0]
            });
        } catch (error) {
            if (transactionOpen) {
                await client.query('ROLLBACK');
            }

            return serverError(
                res,
                'Não foi possível atribuir a atividade.',
                error
            );
        } finally {
            client.release();
        }
    }
);


// ============================================================
// POST /api/oviv/projects/:projectId/activities/:activityId/adopt
// O analista autenticado assume a atividade atribuída a ele.
// O tempo começa neste momento.
// ============================================================

router.post(
    '/projects/:projectId/activities/:activityId/adopt',
    requireAnalyst,
    async (req, res) => {
        const activityId = positiveInteger(
            req.params.activityId
        );

        if (!activityId) {
            return res.status(400).json({
                message: 'ID de atividade inválido.'
            });
        }

        const client = await pool.connect();
        let transactionOpen = false;

        try {
            await client.query('BEGIN');
            transactionOpen = true;

            const found = await client.query(
                `SELECT
                    id,
                    project_id,
                    identifier,
                    title,
                    status,
                    assigned_to_user_id,
                    adopted_by_user_id
                 FROM oviv_project_activities
                 WHERE id = $1
                   AND project_id = $2
                 FOR UPDATE`,
                [
                    activityId,
                    req.params.projectId
                ]
            );

            if (!found.rowCount) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(404).json({
                    message:
                        'Atividade não encontrada neste projeto.'
                });
            }

            const activity = found.rows[0];

            if (activity.adopted_by_user_id !== null) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(409).json({
                    message: 'A atividade já foi adotada.'
                });
            }

            if (
                activity.assigned_to_user_id !== null &&
                Number(activity.assigned_to_user_id) !==
                    Number(req.user.id)
            ) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(403).json({
                    message:
                        'Esta atividade foi atribuída a outro analista.'
                });
            }

            const updated = await client.query(
                `UPDATE oviv_project_activities
                 SET
                    adopted_by_user_id = $2,
                    adopted_by_name = $3,
                    adopted_at = NOW(),
                    started_at = NOW(),
                    completed_at = NULL,
                    status = 'CONTATANDO_TECNICO',
                    updated_at = NOW()
                 WHERE id = $1

                 RETURNING
                    id,
                    project_id,
                    identifier,
                    title,
                    status,
                    assigned_to_user_id,
                    adopted_by_user_id,
                    adopted_by_name,
                    adopted_at,
                    started_at,
                    completed_at`,
                [
                    activityId,
                    req.user.id,
                    req.user.name
                ]
            );

            await writeHistory(client, {
                projectId: activity.project_id,
                activityId,
                actor: req.user,
                action: 'Atividade adotada',
                previousStatus: activity.status,
                newStatus: 'CONTATANDO_TECNICO',
                details:
                    `${activity.identifier || activity.id} · ` +
                    'Cronômetro iniciado.'
            });

            await client.query('COMMIT');
            transactionOpen = false;

            return res.json({
                message:
                    'Atividade adotada e cronômetro iniciado.',
                activity: updated.rows[0]
            });
        } catch (error) {
            if (transactionOpen) {
                await client.query('ROLLBACK');
            }

            return serverError(
                res,
                'Não foi possível adotar a atividade.',
                error
            );
        } finally {
            client.release();
        }
    }
);


// ============================================================
// PATCH /api/oviv/projects/:projectId/activities/:activityId/status
// Somente o analista responsável pode atualizar sua atividade.
// ============================================================

router.patch(
    '/projects/:projectId/activities/:activityId/status',
    requireAnalyst,
    async (req, res) => {
        const activityId = positiveInteger(
            req.params.activityId
        );

        const nextStatus = req.body?.status;

        if (!activityId) {
            return res.status(400).json({
                message: 'ID de atividade inválido.'
            });
        }

        if (!VALID_STATUSES.has(nextStatus)) {
            return res.status(400).json({
                message: 'Status inválido.',
                allowedStatuses: [...VALID_STATUSES]
            });
        }

        const client = await pool.connect();
        let transactionOpen = false;

        try {
            await client.query('BEGIN');
            transactionOpen = true;

            const found = await client.query(
                `SELECT
                    id,
                    project_id,
                    identifier,
                    title,
                    status,
                    adopted_by_user_id
                 FROM oviv_project_activities
                 WHERE id = $1
                   AND project_id = $2
                 FOR UPDATE`,
                [
                    activityId,
                    req.params.projectId
                ]
            );

            if (!found.rowCount) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(404).json({
                    message:
                        'Atividade não encontrada neste projeto.'
                });
            }

            const activity = found.rows[0];

            if (
                Number(activity.adopted_by_user_id) !==
                Number(req.user.id)
            ) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(403).json({
                    message:
                        'Somente o analista responsável pode atualizar esta atividade.'
                });
            }

            if (FINAL_STATUSES.has(activity.status)) {
                await client.query('ROLLBACK');
                transactionOpen = false;

                return res.status(409).json({
                    message: 'A atividade já foi finalizada.'
                });
            }

            const updated = await client.query(
                `UPDATE oviv_project_activities
                 SET
                    status = $2,
                    completed_at = CASE
                        WHEN $2 IN (
                            'ATIVIDADE_MIGRADA',
                            'CANCELADA'
                        )
                        THEN NOW()
                        ELSE NULL
                    END,
                    updated_at = NOW()
                 WHERE id = $1

                 RETURNING
                    id,
                    project_id,
                    identifier,
                    title,
                    status,
                    adopted_by_user_id,
                    adopted_by_name,
                    adopted_at,
                    started_at,
                    completed_at,
                    updated_at`,
                [
                    activityId,
                    nextStatus
                ]
            );

            const notes = safeText(
                req.body?.notes,
                2000
            );

            await writeHistory(client, {
                projectId: activity.project_id,
                activityId,
                actor: req.user,
                action: 'Status atualizado',
                previousStatus: activity.status,
                newStatus: nextStatus,
                details:
                    `${activity.identifier || activity.id} · ` +
                    `${activity.status} → ${nextStatus}` +
                    (notes ? ` · ${notes}` : '')
            });

            await client.query('COMMIT');
            transactionOpen = false;

            return res.json({
                message: 'Status atualizado com sucesso.',
                activity: updated.rows[0]
            });
        } catch (error) {
            if (transactionOpen) {
                await client.query('ROLLBACK');
            }

            return serverError(
                res,
                'Não foi possível atualizar o status.',
                error
            );
        } finally {
            client.release();
        }
    }
);


// ============================================================
// GET /api/oviv/projects/:projectId/history
// ============================================================

router.get(
    '/projects/:projectId/history',
    async (req, res) => {
        try {
            const project = await projectExists(
                pool,
                req.params.projectId
            );

            if (!project) {
                return res.status(404).json({
                    message: 'Projeto não encontrado.'
                });
            }

            const requestedLimit =
                positiveInteger(req.query.limit) || 200;

            const limit = Math.min(requestedLimit, 1000);

            const result = await pool.query(
                `SELECT
                    h.id,
                    h.project_id,
                    h.activity_id,
                    a.identifier AS activity_identifier,
                    h.user_id,

                    COALESCE(
                        u.name,
                        h.user_name
                    ) AS user_name,

                    h.action,
                    h.previous_status,
                    h.new_status,
                    h.details,
                    h.created_at

                 FROM oviv_activity_history h

                 LEFT JOIN oviv_project_activities a
                    ON a.id = h.activity_id

                 LEFT JOIN users u
                    ON u.id = h.user_id

                 WHERE h.project_id = $1

                 ORDER BY h.created_at DESC, h.id DESC
                 LIMIT $2`,
                [
                    project.id,
                    limit
                ]
            );

            return res.json({
                project,
                total: result.rowCount,
                history: result.rows
            });
        } catch (error) {
            return serverError(
                res,
                'Não foi possível carregar o histórico.',
                error
            );
        }
    }
);

export default router;