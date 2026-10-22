import { createInterface } from 'node:readline/promises'
;import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
});

function perguntar(mensagem) {
    return rl.question(mensagem);
}

function perguntarSenhaOculta() {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;

        if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
            reject(new Error(
                'Execute este script em um terminal interativo.'
            ));
            return;
        }

        let senha = '';

        process.stdout.write('Senha (mínimo 8 caracteres): ');

        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        function finalizar() {
            stdin.removeListener('data', receberEntrada);
            stdin.setRawMode(false);
            stdin.pause();
            process.stdout.write('\n');
        }

        function receberEntrada(tecla) {
            for (const caractere of tecla) {
                if (caractere === '\u0003') {
                    finalizar();
                    reject(new Error('Operação cancelada.'));
                    return;
                }

                if (
                    caractere === '\r' ||
                    caractere === '\n'
                ) {
                    finalizar();
                    resolve(senha);
                    return;
                }

                if (
                    caractere === '\u007f' ||
                    caractere === '\b'
                ) {
                    senha = Array.from(senha)
                        .slice(0, -1)
                        .join('');
                    continue;
                }

                if (caractere >= ' ') {
                    senha += caractere;
                }
            }
        }

        stdin.on('data', receberEntrada);
    });
}

async function main() {
    try {
        const nome = (await perguntar('Nome do analista: ')).trim();
        const email = (
            await perguntar('E-mail do analista: ')
        ).trim().toLowerCase();

        if (!nome || !email || !email.includes('@')) {
            throw new Error('Informe um nome e um e-mail válidos.');
        }

        rl.close();

        const senha = await perguntarSenhaOculta();

        if (senha.length < 8) {
            throw new Error(
                'A senha deve ter pelo menos 8 caracteres.'
            );
        }

        const senhaHash = await bcrypt.hash(senha, 12);

        const resultado = await pool.query(
            `INSERT INTO users (
                name,
                email,
                password_hash,
                role
            )
            VALUES ($1, $2, $3, 'ANALISTA')
            RETURNING id, name, email, role, active`,
            [nome, email, senhaHash]
        );

        console.log('\nAnalista cadastrado com sucesso!');
        console.log(resultado.rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            console.error('Este e-mail já está cadastrado.');
        } else {
            console.error('Erro:', error.message);
        }

        process.exitCode = 1;
    } finally {
        rl.close();
        await pool.end();
    }
}

main();