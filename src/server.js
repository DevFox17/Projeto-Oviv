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



app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Servidor do Projeto-Oviv funcionando!'
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
