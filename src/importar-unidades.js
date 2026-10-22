import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { pool } from './db.js';

const caminhoArquivo = path.resolve(
    process.cwd(),
    'dados',
    'COPASA - FABRIC_29.09.26.xlsx'
);

const confirmar = process.argv.includes('--confirmar');

function limpar(valor) {
    if (valor === null || valor === undefined) return null;

    const texto = String(valor).trim();
    return texto === '' ? null : texto;
}

function normalizarChave(valor) {
    const texto = limpar(valor);
    return texto === null ? null : texto.toLowerCase();
}

function normalizarTexto(valor) {
    const texto = limpar(valor);
    if (texto === null) return null;

    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function limparDadosOriginais(registro) {
    return Object.fromEntries(
        Object.entries(registro).map(([chave, valor]) => [
            chave,
            typeof valor === 'string'
                ? (valor.trim() === '' ? null : valor.trim())
                : valor,
        ])
    );
}

function mapearUnidade(registro) {
    const quantidadeTexto = limpar(registro.QTD);

    const quantidade = quantidadeTexto === null
        ? null
        : Number(quantidadeTexto);

    if (quantidade !== null && !Number.isFinite(quantidade)) {
        throw new Error(
            `Valor de QTD inválido para o ID ${limpar(registro.ID)}: ${quantidadeTexto}`
        );
    }

    return {
        external_id: limpar(registro.ID),
        company: limpar(registro.EMPRESA),
        unit_name: limpar(registro.UNIDADE),
        address: limpar(registro['ENDEREÇO COMPLETO']),
        city: limpar(registro.MUNICIPIO),
        equipment_model: limpar(registro.EQUIPAMENTO),
        contracted_speed: limpar(registro['VELOCIDADE DO LINK']),
        service_type: limpar(registro['PRODUTO ']),
        raw_data: limparDadosOriginais(registro),
        network: limpar(registro.NETWORK),
        hostname: limpar(registro.HOSTNAME),
        network_to_clone: limpar(registro['NET WORK PARA CLONAR']),
        coordinates: limpar(registro['COORDENADAS GEOGRÁFICAS']),
        quantity: quantidade,
        vgr_id: limpar(registro['ID VGR']),
        meraki_lan_network: limpar(registro['REDE LAN MERAKI']),
        meraki_lan_ip: limpar(registro['IP LAN MERAKI']),
        dedicated_id: limpar(registro['ID DEDICADO']),
        internet_id: limpar(registro['ID INTERNET']),
        carrier: limpar(registro.OPERADORA),
        lot: limpar(registro.LOTE),
        fortinet_info: limpar(registro['UNIDADES COM FORTINET']),
    };
}

function verificarDuplicados(valores, descricao) {
    const vistos = new Set();
    const duplicados = new Set();

    for (const valor of valores) {
        const chave = descricao === 'NETWORK'
            ? normalizarChave(valor)
            : limpar(valor);

        if (chave === null) continue;

        if (vistos.has(chave)) {
            duplicados.add(chave);
        }

        vistos.add(chave);
    }

    if (duplicados.size > 0) {
        throw new Error(
            `A planilha contém valores duplicados em ${descricao}: ${[...duplicados].join(', ')}`
        );
    }
}

function classificarUnidades(unidades, existentes) {
    const porId = new Map();
    const porNetwork = new Map();

    for (const existente of existentes) {
        const id = limpar(existente.external_id);

        if (id !== null) {
            porId.set(id, existente);
        }

        const network = normalizarChave(existente.network);

        if (network !== null) {
            const lista = porNetwork.get(network) ?? [];
            lista.push(existente);
            porNetwork.set(network, lista);
        }
    }

    const plano = {
        novas: [],
        atualizacoes: [],
        conflitos: [],
    };

    for (const unidade of unidades) {
        const porExternalId = porId.get(unidade.external_id);

        const networkKey = normalizarChave(unidade.network);
        const correspondenciasNetwork = porNetwork.get(networkKey) ?? [];

        if (correspondenciasNetwork.length > 1) {
            plano.conflitos.push(
                `NETWORK "${unidade.network}" já aparece em mais de uma unidade no banco.`
            );
            continue;
        }

        const porNetworkExistente = correspondenciasNetwork[0];

        if (!porExternalId && !porNetworkExistente) {
            plano.novas.push(unidade);
            continue;
        }

        if (
            porExternalId &&
            porNetworkExistente &&
            porExternalId.id === porNetworkExistente.id
        ) {
            plano.atualizacoes.push({
                unidade,
                id: porExternalId.id,
            });
            continue;
        }

        if (porExternalId) {
            plano.conflitos.push(
                `O ID externo ${unidade.external_id} já está associado a outro NETWORK no banco.`
            );
            continue;
        }

        if (porNetworkExistente) {
            plano.conflitos.push(
                `O NETWORK "${unidade.network}" já pertence ao ID externo ${porNetworkExistente.external_id}, não ao ID ${unidade.external_id}.`
            );
            continue;
        }

        plano.conflitos.push(
            `Não foi possível classificar a unidade de ID ${unidade.external_id}.`
        );
    }

    return plano;
}

function imprimirPlano({
    totalLinhas,
    candidatos,
    paraRevisao,
    unidades,
    plano,
}) {
    console.log('\n--- Validação da planilha ---');
    console.log(`Linhas lidas: ${totalLinhas}`);
    console.log(`Candidatas (ID numérico, empresa e unidade): ${candidatos}`);
    console.log(`Aguardando revisão por NETWORK vazio ou pendente: ${paraRevisao}`);
    console.log(`Unidades aptas para importação: ${unidades}`);
    console.log(`Novas unidades: ${plano.novas.length}`);

    console.log(
        `Unidades existentes compatíveis para atualização: ${plano.atualizacoes.length}`
    );

    console.log(
        `Conflitos que impedem a importação: ${plano.conflitos.length}`
    );

    if (plano.conflitos.length > 0) {
        console.log('\n--- Conflitos encontrados ---');

        for (const conflito of plano.conflitos) {
            console.log(`- ${conflito}`);
        }
    }
}

async function inserirUnidade(client, unidade) {
    const colunas = Object.keys(unidade);

    const valores = colunas.map((coluna) =>
        coluna === 'raw_data'
            ? JSON.stringify(unidade[coluna])
            : unidade[coluna]
    );

    const placeholders = colunas.map((coluna, indice) =>
        coluna === 'raw_data'
            ? `$${indice + 1}::jsonb`
            : `$${indice + 1}`
    );

    const sql = `
        INSERT INTO units (${colunas.join(', ')})
        VALUES (${placeholders.join(', ')})
    `;

    await client.query(sql, valores);
}

async function atualizarUnidade(client, id, unidade) {
    const colunas = Object.keys(unidade);

    const valores = colunas.map((coluna) =>
        coluna === 'raw_data'
            ? JSON.stringify(unidade[coluna])
            : unidade[coluna]
    );

    const atribuicoes = colunas.map((coluna, indice) =>
        coluna === 'raw_data'
            ? `${coluna} = $${indice + 1}::jsonb`
            : `${coluna} = $${indice + 1}`
    );

    valores.push(id);

    const sql = `
        UPDATE units
        SET ${atribuicoes.join(', ')}, updated_at = NOW()
        WHERE id = $${valores.length}
    `;

    await client.query(sql, valores);
}

async function main() {
    if (!fs.existsSync(caminhoArquivo)) {
        throw new Error(`Planilha não encontrada: ${caminhoArquivo}`);
    }

    const workbook = XLSX.readFile(caminhoArquivo);
    const nomeAba = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[nomeAba];

    const dados = XLSX.utils.sheet_to_json(worksheet, {
        defval: null,
        raw: false,
    });

    const candidatos = dados.filter((registro) => {
        const id = limpar(registro.ID);

        return /^\d+$/.test(id ?? '') &&
            limpar(registro.EMPRESA) !== null &&
            limpar(registro.UNIDADE) !== null;
    });

    verificarDuplicados(
        candidatos.map((registro) => limpar(registro.ID)),
        'ID'
    );

    const paraRevisao = candidatos.filter((registro) => {
        const network = limpar(registro.NETWORK);

        return network === null ||
            normalizarTexto(network) === 'pendente definicao';
    });

    const aptas = candidatos.filter((registro) => {
        const network = limpar(registro.NETWORK);

        return network !== null &&
            normalizarTexto(network) !== 'pendente definicao';
    });

    verificarDuplicados(
        aptas.map((registro) => limpar(registro.NETWORK)),
        'NETWORK'
    );

    const unidades = aptas.map(mapearUnidade);

    const existentesResult = await pool.query(
        'SELECT id, external_id, network FROM units'
    );

    const planoInicial = classificarUnidades(
        unidades,
        existentesResult.rows
    );

    imprimirPlano({
        totalLinhas: dados.length,
        candidatos: candidatos.length,
        paraRevisao: paraRevisao.length,
        unidades: unidades.length,
        plano: planoInicial,
    });

    if (planoInicial.conflitos.length > 0) {
        throw new Error(
            'Importação bloqueada: resolva os conflitos antes de continuar.'
        );
    }

    // Por padrão, apenas simula. Não grava nada no banco.
    if (!confirmar) {
        console.log(
            '\nSIMULAÇÃO concluída: nenhum dado foi inserido ou atualizado.'
        );

        console.log(
            'Revise os números acima antes de autorizar a gravação.'
        );

        console.log(
            'A gravação real exige o comando explícito: node src/importar-unidades.js --confirmar'
        );

        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            'LOCK TABLE units IN SHARE ROW EXCLUSIVE MODE'
        );

        // Confere novamente os dados dentro da transação.
        const atuaisResult = await client.query(
            'SELECT id, external_id, network FROM units FOR UPDATE'
        );

        const planoFinal = classificarUnidades(
            unidades,
            atuaisResult.rows
        );

        if (planoFinal.conflitos.length > 0) {
            throw new Error(
                `Importação bloqueada após nova validação: ${planoFinal.conflitos.join(' | ')}`
            );
        }

        // Impede NETWORK duplicado, ignorando maiúsculas e espaços externos.
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS units_network_normalized_uidx
            ON units (LOWER(BTRIM(network)))
            WHERE network IS NOT NULL AND BTRIM(network) <> ''
        `);

        for (const unidade of planoFinal.novas) {
            await inserirUnidade(client, unidade);
        }

        for (const item of planoFinal.atualizacoes) {
            await atualizarUnidade(
                client,
                item.id,
                item.unidade
            );
        }

        await client.query('COMMIT');

        console.log('\nIMPORTAÇÃO concluída com sucesso.');

        console.log(
            `Unidades inseridas: ${planoFinal.novas.length}`
        );

        console.log(
            `Unidades atualizadas: ${planoFinal.atualizacoes.length}`
        );

        console.log(
            `Unidades mantidas para revisão: ${paraRevisao.length}`
        );
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

main()
    .catch((error) => {
        console.error('\nErro:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });