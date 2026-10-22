
import XLSX from 'xlsx';

const caminhoArquivo = './dados/COPASA - FABRIC_29.09.26.xlsx';

try {

    const workbook = XLSX.readFile(caminhoArquivo);
    const nomeAba = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[nomeAba];

    const dados = XLSX.utils.sheet_to_json(worksheet, {
        defval: null,
        raw: false
    });

    const registrosValidos = dados.filter(registro =>
        /^\d+$/.test(String(registro.ID ?? '').trim()) &&
        String(registro.EMPRESA ?? '').trim() !== '' &&
        String(registro.UNIDADE ?? '').trim() !== ''
    );

    const idsValidos = registrosValidos.map(registro =>
        String(registro.ID).trim()
    );

    const idsDuplicadosValidos = idsValidos.filter(
        (id, indice) => idsValidos.indexOf(id) !== indice
    );

    console.log(
        'IDs duplicados entre candidatos:',
        [...new Set(idsDuplicadosValidos)]
    );

    const registrosParaRevisao = dados.filter(registro =>
        !registrosValidos.includes(registro)
    );

    console.log('\nRegistros para revisão:');

    registrosParaRevisao.forEach((registro, indice) => {
        console.log(`\nRegistro ${indice + 1}:`, registro);
    });

    const idsCandidatos = registrosValidos.map(registro =>
        String(registro.ID).trim()
    );

    console.log(
        'Candidatos com ID não numérico:',
        idsCandidatos.filter(id => !/^\d+$/.test(id))
    );

    const ids = dados.map(registro =>
        registro.ID == null ? '' : String(registro.ID).trim()
    );

    const idsInvalidos = ids.filter(id =>
        id !== '' && !/^\d+$/.test(id)
    );

    console.log('IDs não numéricos:', idsInvalidos);

    const contagem = new Map();

    for (const id of ids) {
        if (id !== '') {
            contagem.set(id, (contagem.get(id) || 0) + 1);
        }
    }

    const idsDuplicados = [...contagem.entries()]
        .filter(([id, quantidade]) => quantidade > 1);

    console.log('\nAba:', nomeAba);
    console.log('\nResumo da validação:');
    console.log('Total lido:', dados.length);
    console.log('Candidatos à importação:', registrosValidos.length);
    console.log('Registros para revisão:', dados.length - registrosValidos.length);
    console.log('IDs duplicados:', idsDuplicados);

    console.log('\nPrévia dos primeiros 3 candidatos:');

    registrosValidos.slice(0, 3).forEach((registro, indice) => {
        console.log(`\nUnidade ${indice + 1}:`);
        console.log('ID:', registro.ID);
        console.log('Empresa:', registro.EMPRESA);
        console.log('Unidade:', registro.UNIDADE);
        console.log('Network:', registro.NETWORK);
        console.log('Hostname:', registro.HOSTNAME);
        console.log('Equipamento:', registro.EQUIPAMENTO);
        console.log('Produto:', registro['PRODUTO ']);
    });

    const pendenciasRede = registrosValidos.filter(registro =>
        String(registro.NETWORK ?? '')
            .trim()
            .toUpperCase() === 'PENDENTE DEFINIÇÃO' ||
        String(registro.HOSTNAME ?? '')
            .trim()
            .toUpperCase() === 'PENDENTE DEFINIÇÃO'
    );

    console.log(
        '\nUnidades com NETWORK ou HOSTNAME pendente:',
        pendenciasRede.length
    );

    pendenciasRede.slice(0, 10).forEach(registro => {
        console.log({
            ID: registro.ID,
            UNIDADE: registro.UNIDADE,
            NETWORK: registro.NETWORK,
            HOSTNAME: registro.HOSTNAME
        });
    });


    const vgrPreenchidos = registrosValidos.filter(registro =>
        String(registro['ID VGR'] ?? '').trim() !== ''
    );

    const vgrVazios = registrosValidos.filter(registro =>
        String(registro['ID VGR'] ?? '').trim() === ''
    );

    const idsVgr = vgrPreenchidos.map(registro =>
        String(registro['ID VGR']).trim()
    );

    const vgrDuplicados = idsVgr.filter(
        (id, indice) => idsVgr.indexOf(id) !== indice
    );


    const networksPreenchidos = registrosValidos.filter(registro => {
        const network = String(registro.NETWORK ?? '').trim();

        return network !== '' &&
            network.toUpperCase() !== 'PENDENTE DEFINIÇÃO';
    });

    const networks = networksPreenchidos.map(registro =>
        String(registro.NETWORK).trim().toUpperCase()
    );

    const networksDuplicados = networks.filter(
        (network, indice) => networks.indexOf(network) !== indice
    );

    console.log('\n--- Validação do NETWORK ---');
    console.log('NETWORK preenchido e definido:', networksPreenchidos.length);
    console.log(
        'NETWORK vazio:',
        registrosValidos.filter(registro =>
            String(registro.NETWORK ?? '').trim() === ''
        ).length
    );
    console.log(
        'NETWORK pendente:',
        registrosValidos.filter(registro =>
            String(registro.NETWORK ?? '').trim().toUpperCase()
            === 'PENDENTE DEFINIÇÃO'
        ).length
    );
    console.log(
        'NETWORK duplicados:',
        [...new Set(networksDuplicados)]
    );





} catch (error) {
    console.error('Erro ao ler a planilha:', error.message);
}
