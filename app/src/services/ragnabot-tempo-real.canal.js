// ════════════════════════════════════════════════════════════════════════════════════════════════
// O CANAL COMUM DO TEMPO REAL — como um aviso nascido numa réplica chega às outras.
//
// ⚠️ ESTE ARQUIVO EXISTE POR CAUSA DE UM DEFEITO QUE SÓ APARECE EM PRODUÇÃO.
// O motor roda com `replicas: 2`. O aviso («a conversa 41 mudou») nasce no pod que recebeu o
// webhook. O atendente está com o navegador pendurado no OUTRO pod. Sem um canal comum, ele
// simplesmente NUNCA recebe — e o defeito é intermitente por natureza: com um pod só (que é como
// se testa na mesa) funciona sempre; com dois, funciona em metade das vezes. É o tipo de defeito
// que se atribui a "internet ruim" por meses.
//
// A resposta É canal comum. NÃO é afinidade de sessão no proxy: afinidade amarra a pessoa a um pod
// e transforma um rollout normal (que troca os pods) em «a tela congelou», além de não resolver
// nada quando o evento nasce no worker e não no web.
//
// ── POR QUE POSTGRES `LISTEN/NOTIFY` E NÃO REDIS ────────────────────────────────────────────────
// O critério do contrato para o TRANSPORTE ("o caminho que exige menos infraestrutura ganha") vale
// igual para o BARRAMENTO. Medido em 03/09/2026:
//
//   · Postgres: a aplicação JÁ conecta (`DATABASE_URL` → serviço `banco-lider`, o HAProxy que
//     segue o primário do Patroni), a biblioteca `pg` JÁ é dependência declarada, a NetworkPolicy
//     `ragnabot-allow` JÁ libera a porta 5432, e o segredo JÁ existe no `Secret` do pod.
//     Custo de infraestrutura para ligar: ZERO.
//   · Redis: exige dependência nova (`ioredis`), três chaves novas no `Secret` (endereços dos
//     Sentinels, nome do mestre, senha), e a descoberta pelo Sentinel — cuja porta 26379 NÃO foi
//     medida na NetworkPolicy (a medição de 28/08 provou 6379, não 26379). Ou seja: pelo menos
//     uma decisão de infraestrutura do chefe antes de a primeira mensagem andar.
//
// Redis continua sendo a escolha certa QUANDO o volume justificar (`NOTIFY` serializa no servidor
// de banco e o teto de carga útil é 8000 bytes). Por isso este arquivo expõe um CONTRATO de canal
// (`ligar`/`publicar`/`parar`/`estado`) e não uma implementação amarrada: trocar o transporte do
// barramento é escrever um segundo `criarCanal*` e mudar UMA linha em quem o cria.
//
// ── O QUE VIAJA AQUI ────────────────────────────────────────────────────────────────────────────
// ⛔ NENHUM TEXTO DE CLIENTE. O aviso carrega QUE HOUVE mudança e os campos de ROTEAMENTO (de quem
// é a conversa, de que setor, em que estado) — que é o mínimo para decidir quem pode recebê-lo. O
// conteúdo a tela busca na fonte, pelas rotas que já impõem a visibilidade. Duas fontes de verdade
// para a mesma conversa é como uma delas fica desatualizada, e a desatualizada é sempre a que
// alguém está lendo.
//
// ── O LÍDER MUDA (e é por isso que a reconexão não é enfeite) ────────────────────────────────────
// `banco-lider` é um HAProxy: quando o Patroni promove o outro nó, a conexão de escuta CAI. Sem
// reconexão com recuo exponencial, o pod ficaria vivo, saudável na sonda, e mudo para sempre — o
// pior estado possível. Cada religada é registrada e aparece no `/saude`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import pg from 'pg';

/** Nome do canal do Postgres. Minúsculo e sem aspas de propósito: `NOTIFY` dobra o nome para
 *  minúsculo quando não vem entre aspas, e um nome com maiúscula publicaria num canal e escutaria
 *  em outro — sem erro nenhum, só silêncio. */
export const CANAL_PADRAO = 'ragnabot_ao_vivo';

/** Teto do `NOTIFY` no Postgres é 8000 bytes. Cortamos MUITO antes, porque um aviso que estoura o
 *  teto não é truncado: a transação inteira falha. Se um evento passar daqui, é sinal de que
 *  alguém começou a mandar conteúdo pelo canal — que é justamente o que a lei proíbe. */
export const TETO_CARGA_BYTES = 6000;

const RECUO_MIN_MS = 1000;
const RECUO_MAX_MS = 30_000;

/**
 * Um canal LOCAL — entrega só a quem está neste processo.
 *
 * Não é brinquedo de teste: é o modo DEGRADADO honesto. Quando o barramento não pode ser ligado
 * (sem `DATABASE_URL`, banco fora), a tela de quem está pendurado NESTE pod continua se
 * atualizando, e o `/saude` diz `canal: 'local'` — em vez de fingir que está tudo bem.
 */
export function criarCanalLocal({ aoReceber } = {}) {
  let ligado = false;
  const contadores = { publicados: 0, recebidos: 0, reconexoes: 0 };
  return {
    tipo: 'local',
    async ligar() { ligado = true; return { ligado: true, tipo: 'local' }; },
    async publicar(evento) {
      contadores.publicados += 1;
      // Sem ida ao banco: quem publica é o próprio processo, e o eco é imediato.
      contadores.recebidos += 1;
      aoReceber?.(evento);
      return { entregue: 'local' };
    },
    async parar() { ligado = false; },
    estado() { return { tipo: 'local', ligado, compartilhado: false, ...contadores, ultimoErro: null }; },
  };
}

/**
 * O canal COMPARTILHADO — `LISTEN`/`NOTIFY` do Postgres.
 *
 * @param {object} p
 * @param {string} p.url        cadeia de conexão (a MESMA `DATABASE_URL`; o líder muda, e o
 *                              endereço tem de ser o do serviço `banco-lider`, nunca o de um nó)
 * @param {string} [p.canal]
 * @param {(evento:object)=>void} p.aoReceber  chamado para CADA aviso que chega (inclusive o eco
 *                              do que este processo publicou — quem descarta o próprio eco é o
 *                              serviço, pela marca de origem)
 * @param {object} [p.log]
 */
export function criarCanalPostgres({ url, canal = CANAL_PADRAO, aoReceber, log = console } = {}) {
  if (!url) throw new Error('canal de tempo real: falta a cadeia de conexão do banco');

  let cliente = null;
  let ligado = false;
  let parando = false;
  let tentativa = 0;
  let agendado = null;
  const contadores = { publicados: 0, recebidos: 0, reconexoes: 0, falhasAoPublicar: 0 };
  let ultimoErro = null;
  let ligadoEm = null;

  function recuo() {
    // Recuo exponencial COM sorteio. Sem o sorteio, as duas réplicas que caíram juntas (troca de
    // líder derruba as duas) voltariam no mesmo milissegundo, para sempre, batendo no banco em
    // dupla a cada tentativa.
    const base = Math.min(RECUO_MAX_MS, RECUO_MIN_MS * 2 ** Math.min(tentativa, 5));
    return Math.round(base * (0.5 + Math.random()));
  }

  function agendarReligada() {
    if (parando || agendado) return;
    const espera = recuo();
    tentativa += 1;
    agendado = setTimeout(() => { agendado = null; conectar(); }, espera);
    // `unref` para não segurar o processo vivo no encerramento — o desligamento gracioso é do
    // servidor, e um temporizador pendurado o transforma em espera de 30 s a cada implantação.
    if (typeof agendado.unref === 'function') agendado.unref();
  }

  async function conectar() {
    if (parando) return;
    const c = new pg.Client({
      connectionString: url,
      // Nome que aparece em `pg_stat_activity`. Sem ele, uma conexão parada para sempre num
      // `LISTEN` parece conexão vazada de aplicação — e alguém a mata achando que é lixo.
      application_name: 'ragnabot-motor:ao-vivo',
      // A conexão fica ociosa por design (é escuta). Um tempo limite de consulta curto aqui
      // mataria o `LISTEN`; o que protege é o `keepAlive` do soquete.
      keepAlive: true,
    });
    c.on('error', (e) => {
      // ⚠️ SEM ESTE OUVINTE, um erro de soquete numa conexão ociosa vira `unhandled 'error' event`
      // e DERRUBA O PROCESSO. É o modo mais comum de uma escuta de LISTEN matar a aplicação.
      ultimoErro = e.message;
      ligado = false;
      try { c.end().catch(() => {}); } catch { /* já morreu */ }
      if (cliente === c) cliente = null;
      log?.warn?.(`[ao-vivo] canal caiu: ${e.message} — religando`);
      contadores.reconexoes += 1;
      agendarReligada();
    });
    c.on('end', () => {
      if (cliente === c && !parando) {
        ligado = false; cliente = null;
        contadores.reconexoes += 1;
        agendarReligada();
      }
    });
    c.on('notification', (n) => {
      if (n.channel !== canal) return;
      contadores.recebidos += 1;
      let evento = null;
      try { evento = JSON.parse(n.payload); } catch {
        ultimoErro = 'aviso ilegível no canal';
        return;
      }
      try { aoReceber?.(evento); } catch (e) {
        // Falha ao entregar a UM assinante não pode derrubar a escuta de TODOS.
        log?.warn?.(`[ao-vivo] entrega falhou: ${e.message}`);
      }
    });

    try {
      await c.connect();
      // `LISTEN` sem aspas: o Postgres dobra para minúsculo, e é por isso que o nome do canal já
      // nasce minúsculo aqui em cima.
      await c.query(`LISTEN ${canal}`);
      cliente = c;
      ligado = true;
      ligadoEm = new Date().toISOString();
      tentativa = 0;
      ultimoErro = null;
      log?.info?.(`[ao-vivo] canal comum ligado (postgres, ${canal})`);
    } catch (e) {
      ultimoErro = e.message;
      ligado = false;
      try { await c.end(); } catch { /* nada a fazer */ }
      log?.warn?.(`[ao-vivo] não consegui ligar o canal comum: ${e.message}`);
      agendarReligada();
    }
  }

  return {
    tipo: 'postgres',
    canal,
    async ligar() { await conectar(); return { ligado, tipo: 'postgres', canal }; },

    /**
     * Publica no canal comum. Devolve o que ACONTECEU, nunca lança:
     * um aviso perdido não pode derrubar o webhook que estava gravando a mensagem do cliente.
     */
    async publicar(evento) {
      contadores.publicados += 1;
      const carga = JSON.stringify(evento);
      if (Buffer.byteLength(carga, 'utf8') > TETO_CARGA_BYTES) {
        contadores.falhasAoPublicar += 1;
        ultimoErro = 'aviso grande demais para o canal (alguém está mandando conteúdo por aqui?)';
        return { entregue: false, motivo: 'CARGA_GRANDE' };
      }
      if (!cliente || !ligado) {
        contadores.falhasAoPublicar += 1;
        return { entregue: false, motivo: 'CANAL_FORA' };
      }
      try {
        // Parâmetro ligado (`$1`), nunca interpolação: a carga é JSON com texto de terceiro
        // (nome de caixa, nome de setor) e concatenar isso numa sentença é injeção de SQL.
        await cliente.query('SELECT pg_notify($1, $2)', [canal, carga]);
        return { entregue: true };
      } catch (e) {
        contadores.falhasAoPublicar += 1;
        ultimoErro = e.message;
        return { entregue: false, motivo: 'ERRO', erro: e.message };
      }
    },

    async parar() {
      parando = true;
      if (agendado) { clearTimeout(agendado); agendado = null; }
      const c = cliente; cliente = null; ligado = false;
      if (c) { try { await c.end(); } catch { /* já caiu */ } }
    },

    estado() {
      return {
        tipo: 'postgres', canal, ligado, compartilhado: true, ligadoEm,
        ...contadores, ultimoErro,
      };
    },
  };
}

export default { criarCanalLocal, criarCanalPostgres, CANAL_PADRAO, TETO_CARGA_BYTES };
