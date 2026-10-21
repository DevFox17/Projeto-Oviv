import express from 'express';

import { pool } from './db.js';

const app = express();
const PORT = 3000;

app.use(express.json());


app.get('/api/db-health', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT current_database() AS database, NOW() AS server_time'
        );

        res.json({
            status: 'ok',
            message: 'Conexão com o PostgreSQL funcionando!',
            database: result.rows[0].database,
            serverTime: result.rows[0].server_time,
        });
    } catch (error) {
        console.error('Falha ao consultar o banco:', error.message);

        res.status(500).json({
            status: 'error',
            message: 'Não foi possível consultar o banco de dados.',
        });
    }
});


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

        res.status(200).json({
            total: result.rowCount,
            units: result.rows
        });
    } catch (error) {
        console.error('Erro ao consultar unidades:', error.message);

        res.status(500).json({
            message: 'Erro ao consultar as unidades.'
        });
    }
});


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
                message: 'Nenhuma unidade encontrada com esse NETWORK ou HOSTNAME.'
            });
        }

        if (result.rowCount > 1) {
            return res.status(409).json({
                message: 'A pesquisa encontrou mais de uma unidade. É necessário refinar o identificador.'
            });
        }

        return res.status(200).json({
            unit: result.rows[0]
        });
    } catch (error) {
        console.error('Erro ao pesquisar unidade:', error.message);

        return res.status(500).json({
            message: 'Erro interno ao pesquisar a unidade.'
        });
    }
});




app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Servidor do Projeto-Oviv funcionando!'
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
