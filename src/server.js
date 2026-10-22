import express from 'express';
import { pool } from './db.js';

const app = express();
const PORT = 3000;

app.use(express.json());

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

// Verifica se o servidor está funcionando
app.get('/api/health', (req, res) => {
    return res.json({
        status: 'ok',
        message: 'Servidor do Projeto-Oviv funcionando!',
    });
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});