import express from 'express';
import { pool } from './db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, '../public')));

app.use(
    '/public',
    express.static(path.join(__dirname, '../public'))
);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Verifica a conexão com o PostgreSQL
app.get('/api/db-health', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT current_database() AS database, NOW() AS server_time'
        );

        return res.json({
            status: 'ok',
            message: 'Conexão com o PostgreSQL funcionando!',
            database: result.rows[0].database,
            serverTime: result.rows[0].server_time,
        });
    } catch (error) {
        console.error('Falha ao consultar o banco:', error.message);

        return res.status(500).json({
            status: 'error',
            message: 'Não foi possível consultar o banco de dados.',
        });
    }
});

// Lista as unidades cadastradas
app.get('/api/units', async (req, res) => {
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
            units: result.rows,
        });
    } catch (error) {
        console.error('Erro ao consultar unidades:', error.message);

        return res.status(500).json({
            message: 'Erro ao consultar as unidades.',
        });
    }
});

// Pesquisa uma unidade pelo NETWORK ou HOSTNAME
app.get('/api/units/search/:identifier', async (req, res) => {
    try {
        const { identifier } = req.params;

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
                OR network ~ ('(^|[^0-9])' || $1 || '([^0-9]|$)')
                OR hostname ~ ('(^|[^0-9])' || $1 || '([^0-9]|$)')
            LIMIT 2`,
            [identifier]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                message: 'Nenhuma unidade encontrada com esse NETWORK ou HOSTNAME.',
            });
        }

        if (result.rowCount > 1) {
            return res.status(409).json({
                message: 'A pesquisa encontrou mais de uma unidade. É necessário refinar o identificador.',
            });
        }

        return res.status(200).json({
            unit: result.rows[0],
        });
    } catch (error) {
        console.error('Erro ao pesquisar unidade:', error.message);

        return res.status(500).json({
            message: 'Erro interno ao pesquisar a unidade.',
        });
    }
});

// Registra o check-in de um analista em uma unidade
app.post('/api/visits/check-in', async (req, res) => {
    const analystId = Number(req.body?.analystId);
    const unitId = Number(req.body?.unitId);

    if (
        !Number.isSafeInteger(analystId) ||
        analystId <= 0 ||
        !Number.isSafeInteger(unitId) ||
        unitId <= 0
    ) {
        return res.status(200).json({
            message: 'Informe um ID de analista e uma unidade válidos.',
        });
    }

    try {
        // Verifica se o analista existe e está ativo
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
                message: 'Analista não encontrado ou inativo.',
            });
        }

        // Verifica se a unidade existe
        const unit = await pool.query(
            'SELECT id FROM units WHERE id = $1',
            [unitId]
        );

        if (unit.rowCount === 0) {
            return res.status(404).json({
                message: 'Unidade não encontrada.',
            });
        }

        // Registra a visita com o horário gerado pelo PostgreSQL
        const result = await pool.query(
            `INSERT INTO visits (analyst_id, unit_id)
             VALUES ($1, $2)
             RETURNING
                id,
                analyst_id,
                unit_id,
                check_in_at,
                checked_out_at`,
            [analystId, unitId]
        );

        return res.status(201).json({
            message: 'Check-in registrado com sucesso.',
            visit: result.rows[0],
        });
    } catch (error) {
        // Impede duas visitas abertas para o mesmo analista
        if (
            error.code === '23505' &&
            error.constraint === 'visits_one_open_per_analyst'
        ) {
            return res.status(409).json({
                message: 'Este analista já possui uma visita aberta.',
            });
        }

        console.error('Erro ao registrar check-in:', error.message);

        return res.status(500).json({
            message: 'Não foi possível registrar o check-in.',
        });
    }
});

// Cria uma atividade dentro de uma visita
app.post('/api/visits/:visitId/activities', async (req, res) => {
    const visitId = Number(req.params.visitId);

    const title = typeof req.body?.title === 'string'
        ? req.body.title.trim()
        : '';

    const description = typeof req.body?.description === 'string'
        ? req.body.description.trim() || null
        : null;

    if (
        !Number.isSafeInteger(visitId) ||
        visitId <= 0 ||
        !title
    ) {
        return res.status(400).json({
            message: 'Informe uma visita válida e o título da atividade.',
        });
    }

    let client;
    let transacaoAberta = false;

    try {
        client = await pool.connect();

        await client.query('BEGIN');
        transacaoAberta = true;

        // Verifica se a visita existe e continua aberta
        const visitaResult = await client.query(
            `SELECT id, checked_out_at
             FROM visits
             WHERE id = $1
             FOR UPDATE`,
            [visitId]
        );

        if (visitaResult.rowCount === 0) {
            await client.query('ROLLBACK');
            transacaoAberta = false;

            return res.status(404).json({
                message: 'Visita não encontrada.',
            });
        }

        if (visitaResult.rows[0].checked_out_at !== null) {
            await client.query('ROLLBACK');
            transacaoAberta = false;

            return res.status(409).json({
                message: 'Não é possível adicionar atividades a uma visita encerrada.',
            });
        }

        // Cria a atividade com status inicial PENDENTE
        const atividadeResult = await client.query(
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
            [visitId, title, description]
        );

        const atividade = atividadeResult.rows[0];

        // Registra o status inicial no histórico
        await client.query(
            `INSERT INTO activity_history (
                activity_id,
                previous_status,
                new_status,
                notes
            )
            VALUES ($1, NULL, 'PENDENTE', $2)`,
            [atividade.id, 'Atividade criada na visita']
        );

        await client.query('COMMIT');
        transacaoAberta = false;

        return res.status(201).json({
            message: 'Atividade criada com sucesso.',
            activity: atividade,
        });
    } catch (error) {
        if (client && transacaoAberta) {
            await client.query('ROLLBACK');
        }

        console.error('Erro ao criar atividade:', error.message);

        return res.status(500).json({
            message: 'Não foi possível criar a atividade.',
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// Atualiza o status de uma atividade
app.patch('/api/activities/:activityId/status', async (req, res) => {
    const activityId = Number(req.params.activityId);
    const status = req.body?.status;

    const statusesPermitidos = [
        'PENDENTE',
        'EM_DESLOCAMENTO',
        'EM_EXECUCAO',
        'CONCLUIDA',
        'IMPEDIMENTO',
        'CANCELADA',
    ];

    const notes = typeof req.body?.notes === 'string'
        ? req.body.notes.trim() || null
        : null;

    if (!Number.isSafeInteger(activityId) || activityId <= 0) {
        return res.status(400).json({
            message: 'Informe um ID de atividade válido.',
        });
    }

    if (!statusesPermitidos.includes(status)) {
        return res.status(400).json({
            message: 'Status inválido.',
            statusPermitidos: statusesPermitidos,
        });
    }

    let client;
    let transacaoAberta = false;

    try {
        client = await pool.connect();

        await client.query('BEGIN');
        transacaoAberta = true;

        // Busca a atividade e verifica se a visita continua aberta.
        const consulta = await client.query(
            `SELECT
                a.id,
                a.status,
                a.started_at,
                a.completed_at,
                v.checked_out_at
             FROM activities a
             JOIN visits v ON v.id = a.visit_id
             WHERE a.id = $1
             FOR UPDATE OF a, v`,
            [activityId]
        );

        if (consulta.rowCount === 0) {
            await client.query('ROLLBACK');
            transacaoAberta = false;

            return res.status(404).json({
                message: 'Atividade não encontrada.',
            });
        }

        const atividadeAtual = consulta.rows[0];

        if (atividadeAtual.checked_out_at !== null) {
            await client.query('ROLLBACK');
            transacaoAberta = false;

            return res.status(409).json({
                message: 'Não é possível alterar uma atividade de uma visita encerrada.',
            });
        }

        if (
            atividadeAtual.status === 'CONCLUIDA' ||
            atividadeAtual.status === 'CANCELADA'
        ) {
            await client.query('ROLLBACK');
            transacaoAberta = false;

            return res.status(409).json({
                message: 'Uma atividade concluída ou cancelada não pode ser alterada.',
            });
        }

        if (atividadeAtual.status === status) {
            await client.query('COMMIT');
            transacaoAberta = false;

            return res.status(200).json({
                message: 'A atividade já possui esse status.',
                activity: {
                    id: atividadeAtual.id,
                    status: atividadeAtual.status,
                },
            });
        }

        // Atualiza o status e os horários correspondentes.
        const resultado = await client.query(
            `UPDATE activities
             SET
                status = $2,
                started_at = CASE
                    WHEN $2 = 'EM_EXECUCAO' AND started_at IS NULL
                    THEN NOW()
                    ELSE started_at
                END,
                completed_at = CASE
                    WHEN $2 = 'CONCLUIDA' THEN NOW()
                    ELSE completed_at
                END,
                updated_at = NOW()
             WHERE id = $1
             RETURNING id, visit_id, title, status,
                       started_at, completed_at, updated_at`,
            [activityId, status]
        );

        // Registra a mudança no histórico.
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
                atividadeAtual.status,
                status,
                notes,
            ]
        );

        await client.query('COMMIT');
        transacaoAberta = false;

        return res.status(200).json({
            message: 'Status atualizado com sucesso.',
            activity: resultado.rows[0],
        });
    } catch (error) {
        if (client && transacaoAberta) {
            await client.query('ROLLBACK');
        }

        console.error('Erro ao atualizar status:', error.message);

        return res.status(500).json({
            message: 'Não foi possível atualizar o status da atividade.',
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});

// Dados operacionais do dashboard gerencial
app.get('/api/dashboard', async (req, res) => {
    try {
        // Indicadores gerais da operação
        const resumo = await pool.query(`
            SELECT
                (
                    SELECT COUNT(*)
                    FROM activities a
                    JOIN visits v ON v.id = a.visit_id
                    WHERE v.checked_out_at IS NULL
                      AND a.status = 'PENDENTE'
                ) AS pending,

                (
                    SELECT COUNT(*)
                    FROM activities a
                    JOIN visits v ON v.id = a.visit_id
                    WHERE v.checked_out_at IS NULL
                      AND a.status IN (
                          'EM_DESLOCAMENTO',
                          'EM_EXECUCAO'
                      )
                ) AS in_progress,

                (
                    SELECT COUNT(*)
                    FROM activities a
                    JOIN visits v ON v.id = a.visit_id
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

        // Visitas abertas e atividades de cada analista
        const operacao = await pool.query(`
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
            summary: resumo.rows[0],
            activeVisits: operacao.rows
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


app.get('/api/health', (req, res) => {
    return res.json({
        status: 'ok',
        message: 'Servidor do Projeto-Oviv funcionando!',
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});