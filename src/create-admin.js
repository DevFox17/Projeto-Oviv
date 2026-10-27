import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

async function main() {
    const name = process.env.OVIV_ADMIN_NAME?.trim();
    const email = process.env.OVIV_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.OVIV_ADMIN_PASSWORD;

    if (!name || !email || !password) {
        throw new Error(
            'Configure temporariamente OVIV_ADMIN_NAME, OVIV_ADMIN_EMAIL e OVIV_ADMIN_PASSWORD no .env.'
        );
    }

    if (password.length < 12) {
        throw new Error(
            'A senha do gestor precisa ter pelo menos 12 caracteres.'
        );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const existing = await pool.query(
        `SELECT id
         FROM users
         WHERE LOWER(email) = LOWER($1)
         LIMIT 1`,
        [email]
    );

    let result;

    if (existing.rowCount > 0) {
        result = await pool.query(
            `UPDATE users
             SET
                name = $2,
                password_hash = $3,
                role = 'GP',
                active = TRUE
             WHERE id = $1

             RETURNING id, name, email, role`,
            [
                existing.rows[0].id,
                name,
                passwordHash
            ]
        );
    } else {
        result = await pool.query(
            `INSERT INTO users (
                name,
                email,
                password_hash,
                role,
                active
             )
             VALUES ($1, $2, $3, 'GP', TRUE)

             RETURNING id, name, email, role`,
            [
                name,
                email,
                passwordHash
            ]
        );
    }

    console.log('\nConta de gestor preparada com sucesso:');
    console.table(result.rows);
    console.log('\nEntre pela tela de login do Oviv.');
}

main()
    .catch(error => {
        console.error('\nFalha ao preparar a conta:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });