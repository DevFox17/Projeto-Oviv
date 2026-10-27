import crypto from 'node:crypto';
import { pool } from './db.js';

export const MANAGER_ROLES = new Set([
    'GP',
    'GESTOR',
    'GERENTE',
    'GERENTE DE PROJETO',
    'ADMIN',
    'ADMINISTRADOR'
]);

export function normalizeRole(role) {
    return String(role || '')
        .trim()
        .toUpperCase();
}

export function readCookie(req, name) {
    const cookieHeader = req.headers.cookie || '';

    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');

        if (separator < 0) continue;

        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();

        if (key === name) {
            return decodeURIComponent(value);
        }
    }

    return null;
}

export function hashSessionToken(token) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}

export function isManager(user) {
    return MANAGER_ROLES.has(
        normalizeRole(user?.role)
    );
}

export async function attachUser(req, res, next) {
    req.user = null;
    req.sessionTokenHash = null;

    const token = readCookie(req, 'oviv_session');

    if (!token) {
        return next();
    }

    try {
        const tokenHash = hashSessionToken(token);

        const result = await pool.query(
            `SELECT
                u.id,
                u.name,
                u.email,
                u.role,
                u.active
             FROM oviv_sessions s

             JOIN users u
                ON u.id = s.user_id

             WHERE s.token_hash = $1
               AND s.expires_at > NOW()
               AND u.active = TRUE

             LIMIT 1`,
            [tokenHash]
        );

        if (result.rowCount > 0) {
            req.user = result.rows[0];
            req.sessionTokenHash = tokenHash;
        } else {
            // Limpa uma sessão expirada ou inválida.
            await pool.query(
                `DELETE FROM oviv_sessions
                 WHERE token_hash = $1
                    OR expires_at <= NOW()`,
                [tokenHash]
            );
        }

        return next();
    } catch (error) {
        return next(error);
    }
}

export function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            message: 'Faça login para continuar.'
        });
    }

    return next();
}

export function requireManager(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            message: 'Faça login para continuar.'
        });
    }

    if (!isManager(req.user)) {
        return res.status(403).json({
            message: 'Esta operação é exclusiva do gestor.'
        });
    }

    return next();
}

export function requireAnalyst(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            message: 'Faça login para continuar.'
        });
    }

    if (normalizeRole(req.user.role) !== 'ANALISTA') {
        return res.status(403).json({
            message: 'Esta operação exige o perfil de analista.'
        });
    }

    return next();
}