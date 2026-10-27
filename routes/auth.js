import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import { pool } from '../src/db.js';

import {
    requireAuth,
    requireManager,
    hashSessionToken,
    readCookie
} from '../src/auth-middleware.js';

const router = Router();

const SESSION_DURATION_SECONDS = 12 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;

function safeText(value, maxLength = 150) {
    return typeof value === 'string'
        ? value.trim().slice(0, maxLength)
        : '';
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        employee_code: user.employee_code || null,
        role: user.role,
        active: user.active
    };
}

function setSessionCookie(res, token) {
    const secure =
        process.env.NODE_ENV === 'production'
            ? '; Secure'
            : '';

    res.setHeader(
        'Set-Cookie',
        `oviv_session=${encodeURIComponent(token)}; ` +
        `HttpOnly; SameSite=Lax; Path=/; ` +
        `Max-Age=${SESSION_DURATION_SECONDS}${secure}`
    );
}

function clearSessionCookie(res) {
    const secure =
        process.env.NODE_ENV === 'production'
            ? '; Secure'
            : '';

    res.setHeader(
        'Set-Cookie',
        `oviv_session=; HttpOnly; SameSite=Lax; ` +
        `Path=/; Max-Age=0${secure}`
    );
}


// ============================================================
// POST /api/auth/login
// Entrar com e-mail e senha.
// ============================================================

router.post('/login', async (req, res) => {
    const email = safeText(req.body?.email, 254)
        .toLowerCase();

    const password =
        typeof req.body?.password === 'string'
            ? req.body.password
            : '';

    if (!email || !password) {
        return res.status(400).json({
            message: 'Informe o e-mail e a senha.'
        });
    }

    try {
        const result = await pool.query(
            `SELECT
                id,
                name,
                email,
                password_hash,
                role,
                active,
                employee_code
             FROM users
             WHERE LOWER(email) = LOWER($1)
             LIMIT 1`,
            [email]
        );

        const user = result.rows[0];

        if (
            !user ||
            !user.active ||
            !user.password_hash
        ) {
            return res.status(401).json({
                message: 'E-mail ou senha inválidos.'
            });
        }

        const validPassword = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!validPassword) {
            return res.status(401).json({
                message: 'E-mail ou senha inválidos.'
            });
        }

        const token = crypto
            .randomBytes(32)
            .toString('hex');

        const tokenHash = hashSessionToken(token);

        await pool.query(
            `INSERT INTO oviv_sessions (
                token_hash,
                user_id,
                expires_at
             )
             VALUES (
                $1,
                $2,
                NOW() + ($3 * INTERVAL '1 second')
             )`,
            [
                tokenHash,
                user.id,
                SESSION_DURATION_SECONDS
            ]
        );

        await pool.query(
            `UPDATE users
             SET last_login_at = NOW()
             WHERE id = $1`,
            [user.id]
        );

        setSessionCookie(res, token);

        return res.json({
            message: 'Login realizado com sucesso.',
            user: publicUser(user)
        });
    } catch (error) {
        console.error(
            'Erro no login:',
            error.message
        );

        return res.status(500).json({
            message: 'Não foi possível realizar o login.'
        });
    }
});


// ============================================================
// GET /api/auth/me
// Retorna a identidade da sessão atual.
// ============================================================

router.get('/me', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                id,
                name,
                email,
                employee_code,
                role,
                active
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [req.user.id]
        );

        if (!result.rowCount) {
            return res.status(401).json({
                message: 'Usuário não encontrado.'
            });
        }

        return res.json({
            user: publicUser(result.rows[0])
        });
    } catch (error) {
        console.error(
            'Erro ao carregar a sessão:',
            error.message
        );

        return res.status(500).json({
            message: 'Não foi possível verificar a sessão.'
        });
    }
});


// ============================================================
// POST /api/auth/logout
// Encerra a sessão atual.
// ============================================================

router.post('/logout', async (req, res) => {
    try {
        const token = readCookie(req, 'oviv_session');

        if (token) {
            await pool.query(
                `DELETE FROM oviv_sessions
                 WHERE token_hash = $1`,
                [hashSessionToken(token)]
            );
        }

        clearSessionCookie(res);

        return res.json({
            message: 'Sessão encerrada.'
        });
    } catch (error) {
        console.error(
            'Erro ao encerrar a sessão:',
            error.message
        );

        clearSessionCookie(res);

        return res.status(500).json({
            message: 'Não foi possível encerrar a sessão.'
        });
    }
});


// ============================================================
// GET /api/auth/analysts
// Lista os analistas ativos. Exclusivo do gestor.
// ============================================================

router.get(
    '/analysts',
    requireAuth,
    requireManager,
    async (_req, res) => {
        try {
            const result = await pool.query(
                `SELECT
                    id,
                    name,
                    email,
                    employee_code,
                    role,
                    active
                 FROM users
                 WHERE role = 'ANALISTA'
                   AND active = TRUE
                 ORDER BY name`
            );

            return res.json({
                analysts: result.rows.map(publicUser)
            });
        } catch (error) {
            console.error(
                'Erro ao listar analistas:',
                error.message
            );

            return res.status(500).json({
                message: 'Não foi possível listar os analistas.'
            });
        }
    }
);


// ============================================================
// POST /api/auth/analysts
// Cria um usuário de perfil ANALISTA. Exclusivo do gestor.
// ============================================================

router.post(
    '/analysts',
    requireAuth,
    requireManager,
    async (req, res) => {
        const name = safeText(req.body?.name);
        const email = safeText(req.body?.email, 254)
            .toLowerCase();

        const employeeCode = safeText(
            req.body?.employeeCode,
            50
        );

        const password =
            typeof req.body?.password === 'string'
                ? req.body.password
                : '';

        if (!name || !email || !password) {
            return res.status(400).json({
                message:
                    'Nome, e-mail e senha inicial são obrigatórios.'
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                message: 'Informe um e-mail válido.'
            });
        }

        if (password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({
                message:
                    `A senha inicial deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
            });
        }

        try {
            const passwordHash = await bcrypt.hash(
                password,
                12
            );

            const result = await pool.query(
                `INSERT INTO users (
                    name,
                    email,
                    password_hash,
                    employee_code,
                    role,
                    active
                 )
                 VALUES ($1, $2, $3, $4, 'ANALISTA', TRUE)

                 RETURNING
                    id,
                    name,
                    email,
                    employee_code,
                    role,
                    active`,
                [
                    name,
                    email,
                    passwordHash,
                    employeeCode || null
                ]
            );

            return res.status(201).json({
                message: 'Analista cadastrado com sucesso.',
                user: publicUser(result.rows[0])
            });
        } catch (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    message:
                        'Este e-mail ou matrícula já está cadastrado.'
                });
            }

            console.error(
                'Erro ao cadastrar analista:',
                error.message
            );

            return res.status(500).json({
                message: 'Não foi possível cadastrar o analista.'
            });
        }
    }
);

export default router;