import XLSX from 'xlsx';
import { pool } from './db.js';

const caminhoArquivo = './dados/COPASA - FABRIC_29.09.26.xlsx';


const limpar = (valor) => {
    if (valor === null || valor === undefined) {
        return null;
    }

    const texto = String(valor).trim();

    return texto === '' ? null : texto;
};


function limparDadosOriginais(registro) {
    return Object.fromEntries(
        Object.entries(registro).map(([chave, valor]) => [
            chave,
            typeof valor === 'string'
                ? (valor.trim() === '' ? null : valor.trim())
                : valor
        ])
    );
}



const valorDefinido = (valor) => {
    const texto = String(valor ?? '').trim().toUpperCase();

    return texto !== '' && texto !== 'PENDENTE DEFINIÇÃO';
};

async function simularImportacao() {
    try {
        // 1. Ler a planilha
        const workbook = XLSX.readFile(caminhoArquivo);
        const nomeAba = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[nomeAba];

        const dados = XLSX.utils.sheet_to_json(worksheet, {
            defval: null,
            raw: false
        });

        // 2. Separar registros candidatos e registros para revisão
        const candidatos = dados.filter(registro =>
            /^\d+$/.test(String(registro.ID ?? '').trim()) &&
            limpar(registro.EMPRESA) !== null &&
            limpar(registro.UNIDADE) !== null
        );

        const paraRevisao = candidatos.filter(registro =>
            !valorDefinido(registro.NETWORK)
        );

        const aptos = candidatos.filter(registro =>
            valorDefinido(registro.NETWORK)
        );


        const registrosParaImportar = aptos.filter(registro =>
            limpar(registro.ID) !== null &&
            limpar(registro.EMPRESA) !== null &&
            limpar(registro.UNIDADE) !== null &&
            limpar(registro.NETWORK) !== null
        );


        function mapearUnidade(registro) {
            return {
                external_id: limpar(registro.ID),
                company: limpar(registro.EMPRESA),
                unit_name: limpar(registro.UNIDADE),
                address: limpar(registro['ENDEREÇO COMPLETO']),
                city: limpar(registro.MUNICIPIO),

                network: limpar(registro.NETWORK),
                hostname: limpar(registro.HOSTNAME),
                network_to_clone: limpar(registro['NET WORK PARA CLONAR']),
                coordinates: limpar(registro['COORDENADAS GEOGRÁFICAS']),

                quantity: limpar(registro.QTD) === null
                    ? null
                    : Number(registro.QTD),

                equipment_model: limpar(registro.EQUIPAMENTO),
                vgr_id: limpar(registro['ID VGR']),
                meraki_lan_network: limpar(registro['REDE LAN MERAKI']),
                meraki_lan_ip: limpar(registro['IP LAN MERAKI']),
                dedicated_id: limpar(registro['ID DEDICADO']),
                internet_id: limpar(registro['ID INTERNET']),

                contracted_speed: limpar(registro['VELOCIDADE DO LINK']),
                service_type: limpar(registro['PRODUTO ']),
                carrier: limpar(registro.OPERADORA),
                lot: limpar(registro.LOTE),
                fortinet_info: limpar(registro['UNIDADES COM FORTINET']),

                raw_data: limparDadosOriginais(registro)
            };
        }

        const amostras = registrosParaImportar
            .slice(0, 3)
            .map(mapearUnidade);

        console.log('\n--- Prévia do mapeamento ---');
        console.dir(amostras, { depth: null });


        const registrosInvalidos = aptos.filter(registro =>
            !registrosParaImportar.includes(registro)
        );

        console.log(
            'Registros aprovados na validação final:',
            registrosParaImportar.length
        );

        console.log(
            'Registros para revisão adicional:',
            registrosInvalidos.length
        );


        // 3. Conferir NETWORK repetidos na planilha
        const contagemNetworks = new Map();

        for (const registro of aptos) {
            const network = limpar(registro.NETWORK).toUpperCase();

            contagemNetworks.set(
                network,
                (contagemNetworks.get(network) ?? 0) + 1
            );
        }

        const networksDuplicados = new Set(
            [...contagemNetworks]
                .filter(([, quantidade]) => quantidade > 1)
                .map(([network]) => network)
        );

        // 4. Consultar os NETWORK que já existem no banco
        // Esta consulta não modifica nenhum dado.
        const resultado = await pool.query(`
            SELECT id, external_id, network
            FROM units
            WHERE network IS NOT NULL
        `);

        const networksBanco = new Map();

        for (const unidade of resultado.rows) {
            const network = limpar(unidade.network)?.toUpperCase();

            if (!network) continue;

            if (!networksBanco.has(network)) {
                networksBanco.set(network, []);
            }

            networksBanco.get(network).push(unidade);
        }

        // 5. Simular a classificação de cada registro
        let novas = 0;
        let existentes = 0;
        let ambiguos = 0;
        let duplicadosNaPlanilha = 0;

        for (const registro of aptos) {
            const network = limpar(registro.NETWORK).toUpperCase();

            if (networksDuplicados.has(network)) {
                duplicadosNaPlanilha++;
                continue;
            }

            const correspondencias = networksBanco.get(network) ?? [];

            if (correspondencias.length > 1) {
                ambiguos++;
            } else if (correspondencias.length === 1) {
                existentes++;
            } else {
                novas++;
            }
        }

        // 6. Exibir relatório
        console.log('\n===== SIMULAÇÃO DE IMPORTAÇÃO OVIV =====');
        console.log('Aba:', nomeAba);
        console.log('Registros lidos:', dados.length);
        console.log('Candidatos:', candidatos.length);
        console.log('Aptos para correspondência:', aptos.length);
        console.log('Para revisão:', paraRevisao.length);
        console.log('NETWORK duplicados na planilha:', duplicadosNaPlanilha);
        console.log('Possíveis unidades novas:', novas);
        console.log('Correspondências únicas no banco:', existentes);
        console.log('Correspondências ambíguas no banco:', ambiguos);
        console.log('Nenhum dado foi inserido ou atualizado.');

        if (paraRevisao.length > 0) {
            console.log('\n--- Registros para revisão ---');

            for (const registro of paraRevisao) {
                console.log({
                    ID: registro.ID,
                    UNIDADE: registro.UNIDADE,
                    NETWORK: registro.NETWORK
                });
            }
        }

        if (networksDuplicados.size > 0) {
            console.log('\n--- NETWORK duplicados na planilha ---');
            console.log([...networksDuplicados]);
        }

    } catch (error) {
        console.error('Erro na simulação:', error.message);
    } finally {
        await pool.end();
    }
}

simularImportacao();
