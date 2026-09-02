// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CAIXA DE ATENDIMENTO — a tela (contrato S2, 02/09/2026 · doc 34 §F2.2/2.3/2.4/2.7/2.8)
//
// É onde o agente vive: a fila, com as abas Abertas · Resolvidos · Grupos, as sub-abas Atendendo ·
// Aguardando · ChatBot com contador em cada uma, e o cartão trazendo as TRÊS etiquetas que o dono
// pediu — caixa de entrada · setor · atendente. Sem elas, olhando a fila, ninguém sabe de quem é o
// quê.
//
// ── ⛔ O QUE ESTA TELA NÃO É ────────────────────────────────────────────────────────────────────
// Ela NÃO é o isolamento. O isolamento é do servidor: a lista já chega filtrada por
// `ragnabot-caixa.service.js`, e um agente pedindo a conversa de outro PELA API recebe 404. Aqui
// não há um único `if` que esconda linha — se houvesse, ele estaria mascarando um vazamento em vez
// de impedi-lo. É a diferença entre esta entrega e uma entrega de aparência.
//
// ── O CONTADOR VEM DO SERVIDOR, NÃO DO `length` DA PÁGINA ───────────────────────────────────────
// A lista é paginada (25 por vez). Contar o que está na tela diria «3 abertas» com 300 na fila.
// Os números vêm de `/contadores`, que usa O MESMO construtor de `where` da listagem — contador
// que mente é pior que contador ausente.
//
// ── PARA TESTE ──────────────────────────────────────────────────────────────────────────────────
// `CartaoDeConversa`, `Abas`, `SubAbas` e `EtiquetasDoCartao` são PUROS: recebem tudo por
// propriedade, não buscam nada, não chamam a rede. Medidos por `web/tests/caixa.smoke.mjs` com
// `renderToString`, sem navegador e sem servidor. Só `CaixaDeAtendimento`, embaixo, fala com a rede.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, Search, History, Users } from 'lucide-react';

import CapaSecao from '../componentes/CapaSecao.jsx';
import { Etiqueta, Faixa, T, Vazio, campoEstilo, cartao } from './EmpresaFormulario.jsx';
import {
  ABAS, SUBABAS,
  contadores as pedirContadores, historicoDoContato, listarConversas, listarSetores,
  sincronizarSetores,
  retrocarregarConversas,
} from '../lib/api-caixa.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 0. FORMATAÇÃO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** "há 4 min", "há 2 h", "há 3 d". Data crua numa fila obriga o olho a fazer conta. */
export function desdeQuando(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const seg = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  return `há ${Math.floor(seg / 86400)} d`;
}

/** O tom de cada estado. A PALAVRA sempre acompanha — severidade nunca viaja só na cor. */
const TOM_DO_ESTADO = {
  atendendo: 'ok', aguardando: 'aviso', chatbot: 'info', resolvida: 'neutro', adiada: 'neutro',
};
const ROTULO_DO_ESTADO = {
  atendendo: 'Atendendo', aguardando: 'Aguardando', chatbot: 'ChatBot',
  resolvida: 'Resolvida', adiada: 'Adiada',
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. PEÇAS PURAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ AS TRÊS ETIQUETAS (pedido nº 4 do dono): caixa de entrada · setor · atendente.
 *
 * As três aparecem SEMPRE, inclusive vazias ("Sem setor", "Sem atendente"), com tom apagado. O
 * servidor já as monta em `etiquetasDaConversa()` — aqui só se desenha. Etiqueta que some quando o
 * valor falta faz o cartão mudar de forma na fila e o olho perde a coluna; e "sem setor" é uma
 * informação, não uma ausência: é justamente a conversa que ninguém roteou.
 */
export function EtiquetasDoCartao({ etiquetas = [] }) {
  const titulo = {
    caixa: 'Caixa de entrada (a conexão por onde o cliente falou)',
    setor: 'Setor responsável',
    atendente: 'Quem está atendendo',
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-etiquetas>
      {etiquetas.map((e) => (
        <Etiqueta
          key={e.tipo}
          tom={e.vazia ? 'neutro' : (e.tipo === 'setor' ? 'info' : (e.tipo === 'atendente' ? 'ok' : 'neutro'))}
          titulo={titulo[e.tipo] || e.tipo}
        >
          {e.rotulo}
        </Etiqueta>
      ))}
    </div>
  );
}

/** Uma conversa na fila. */
export function CartaoDeConversa({ conversa, aba, aoVerHistorico }) {
  const c = conversa;
  const quando = aba === 'resolvidos' ? c.resolvidaEm : c.ultimaAtividadeEm;
  const rotuloQuando = aba === 'resolvidos' ? 'resolvida' : 'última atividade';
  return (
    <div
      data-conversa={c.cwConversationId}
      style={{ ...cartao, padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}
    >
      <div style={{
        minWidth: 64, textAlign: 'center', padding: '6px 8px', borderRadius: 8,
        background: T.sup, border: `1px solid ${T.borda}`,
        fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: '0.8rem', color: T.ink,
      }} title="Protocolo do atendimento">
        {c.protocolo || `#${c.cwConversationId}`}
      </div>

      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontWeight: 700, color: T.ink }}>
          {c.contato?.nome || c.contato?.chave || 'Contato sem nome'}
          {c.ehGrupo ? <span style={{ marginLeft: 6, color: T.mut, fontWeight: 500, fontSize: '0.75rem' }}>(grupo)</span> : null}
        </div>
        <div style={{ fontSize: '0.76rem', color: T.mut, marginTop: 2, wordBreak: 'break-all' }}>
          {c.contato?.chave || '—'}
          <span style={{ color: T.sec }}> · {rotuloQuando} {desdeQuando(quando)}</span>
          {aba === 'resolvidos' && c.resolvidaPor?.nome
            ? <span style={{ color: T.sec }}> · por {c.resolvidaPor.nome}</span> : null}
        </div>
        <div style={{ marginTop: 8 }}>
          <EtiquetasDoCartao etiquetas={c.etiquetas} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <Etiqueta tom={TOM_DO_ESTADO[c.estado] || 'neutro'}>{ROTULO_DO_ESTADO[c.estado] || c.estado}</Etiqueta>
        {/* Só faz sentido pedir histórico quando há setor: o histórico É por setor. */}
        {c.setor?.id && aoVerHistorico ? (
          <button
            type="button"
            onClick={() => aoVerHistorico(c)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              borderRadius: 8, border: `1px solid ${T.borda}`, background: 'transparent',
              color: T.sec, fontSize: '0.72rem', cursor: 'pointer',
            }}
            title="Atendimentos anteriores deste contato NESTE setor"
          >
            <History size={13} /> Histórico do setor
          </button>
        ) : null}
      </div>
    </div>
  );
}

function botaoAba(ativo) {
  return {
    padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
    border: `1px solid ${ativo ? T.primaria : T.borda}`,
    background: ativo ? T.infoDim : 'transparent',
    color: ativo ? T.ink : T.sec,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}

/** As abas de cima. O contador fica DENTRO do botão, como no chat atual. */
export function Abas({ aba, contagem = {}, aoTrocar }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} data-abas>
      {ABAS.map((a) => (
        <button
          key={a.valor}
          type="button"
          data-aba={a.valor}
          onClick={() => aoTrocar && aoTrocar(a.valor)}
          style={botaoAba(aba === a.valor)}
        >
          {a.rotulo}
          <span data-contador={a.valor} style={{
            background: T.sup, borderRadius: 999, padding: '1px 7px', fontSize: '0.72rem', color: T.mut,
          }}>{contagem[a.valor] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** As sub-abas de "Abertas". */
export function SubAbas({ sub, contagem = {}, aoTrocar }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-subabas>
      {SUBABAS.map((s) => (
        <button
          key={s.valor || 'todas'}
          type="button"
          data-subaba={s.valor || 'todas'}
          title={s.apoio || ''}
          onClick={() => aoTrocar && aoTrocar(s.valor)}
          style={{ ...botaoAba((sub || null) === s.valor), padding: '5px 10px', fontSize: '0.78rem' }}
        >
          {s.rotulo}
          <span data-contador={s.valor || 'todas'} style={{
            background: T.sup, borderRadius: 999, padding: '1px 6px', fontSize: '0.7rem', color: T.mut,
          }}>{contagem[s.contador] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** O histórico do contato dentro de um setor. Ficha do atendimento — nunca conteúdo de mensagem. */
export function PainelDeHistorico({ alvo, resultado, carregando, erro, aoFechar }) {
  if (!alvo) return null;
  return (
    <div style={{ ...cartao, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={16} />
          Histórico de {alvo.contato?.nome || alvo.contato?.chave || 'contato'} no setor {alvo.setor?.nome || alvo.setor?.id}
        </div>
        <button type="button" onClick={aoFechar} style={{ ...botaoAba(false), padding: '4px 10px' }}>Fechar</button>
      </div>
      <p style={{ color: T.mut, fontSize: '0.76rem', margin: '6px 0 10px' }}>
        Só deste setor. Um mesmo cliente pode ter conversas em setores diferentes, e elas não se
        misturam — é a regra que o dono pediu.
      </p>
      {erro ? <Faixa tom="erro" titulo="Não consegui carregar">{erro}</Faixa> : null}
      {carregando ? <Vazio>Carregando…</Vazio> : null}
      {!carregando && !erro && resultado && resultado.total === 0
        ? <Vazio>Nenhum atendimento anterior deste contato neste setor.</Vazio> : null}
      {!carregando && !erro && resultado?.itens?.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {resultado.itens.map((c) => (
            <div key={c.id} style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              padding: '8px 10px', border: `1px solid ${T.borda}`, borderRadius: 10,
            }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', color: T.ink }}>
                {c.protocolo || `#${c.cwConversationId}`}
              </span>
              <Etiqueta tom={TOM_DO_ESTADO[c.estado] || 'neutro'}>{ROTULO_DO_ESTADO[c.estado] || c.estado}</Etiqueta>
              <span style={{ fontSize: '0.76rem', color: T.sec }}>aberta {desdeQuando(c.abertaEm)}</span>
              {c.resolvidaEm ? <span style={{ fontSize: '0.76rem', color: T.sec }}>· resolvida {desdeQuando(c.resolvidaEm)}</span> : null}
              {c.atendente?.nome ? <span style={{ fontSize: '0.76rem', color: T.mut }}>· {c.atendente.nome}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export default function CaixaDeAtendimento() {
  const [aba, setAba] = useState('abertas');
  const [sub, setSub] = useState(null);
  const [busca, setBusca] = useState('');
  const [setorFiltro, setSetorFiltro] = useState('');
  const [pagina, setPagina] = useState(1);

  const [lista, setLista] = useState(null);
  const [contagem, setContagem] = useState({});
  const [setores, setSetores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [retrocarregando, setRetrocarregando] = useState(false);
  const [recado, setRecado] = useState(null);

  const [alvoHistorico, setAlvoHistorico] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [historicoCarregando, setHistoricoCarregando] = useState(false);
  const [historicoErro, setHistoricoErro] = useState(null);

  const filtros = useMemo(() => ({
    busca: busca.trim() || undefined,
    cwTeamId: setorFiltro || undefined,
  }), [busca, setorFiltro]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [l, n] = await Promise.all([
        listarConversas({ aba, sub: sub || undefined, pagina, ...filtros }),
        pedirContadores(filtros),
      ]);
      setLista(l);
      setContagem(n);
    } catch (e) {
      setErro(e.message || 'Não consegui carregar a caixa.');
      setLista(null);
    } finally {
      setCarregando(false);
    }
  }, [aba, sub, pagina, filtros]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    listarSetores().then((r) => setSetores(r.itens || [])).catch(() => setSetores([]));
  }, []);

  const verHistorico = useCallback(async (c) => {
    setAlvoHistorico(c);
    setHistorico(null);
    setHistoricoErro(null);
    setHistoricoCarregando(true);
    try {
      const r = await historicoDoContato({
        cwTeamId: c.setor?.id,
        contatoChave: c.contato?.chave || undefined,
        cwContactId: c.contato?.chave ? undefined : c.contato?.id,
      });
      setHistorico(r);
    } catch (e) {
      setHistoricoErro(e.message || 'Não consegui carregar o histórico.');
    } finally {
      setHistoricoCarregando(false);
    }
  }, []);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setRecado(null);
    try {
      const r = await sincronizarSetores();
      setRecado(`Setores conferidos: ${r.setores?.times ?? 0}. Vínculos de atendente: ${r.membros?.vinculos ?? 0}.`);
      const s = await listarSetores();
      setSetores(s.itens || []);
      await carregar();
    } catch (e) {
      setRecado(null);
      setErro(e.message || 'Não consegui sincronizar.');
    } finally {
      setSincronizando(false);
    }
  }, [carregar]);

  /**
   * RETROCARGA — as conversas que já existiam entram na fila.
   *
   * Duas etapas de propósito: primeiro a SIMULAÇÃO (mede e mostra, sem gravar), e só depois a
   * execução. Botão que grava de primeira, numa operação que varre a plataforma inteira, é botão
   * que ninguém aperta com segurança.
   */
  const retrocarregar = useCallback(async (simular) => {
    setRetrocarregando(true);
    setRecado(null);
    try {
      const r = await retrocarregarConversas({ simular });
      const q = r.retrocarga || {};
      const aprox = Object.keys(q.aproximacoes || {}).length;
      setRecado(simular
        ? `Simulação: ${q.lidas ?? 0} conversa(s) na plataforma. `
          + `Entrariam como ${Object.entries(q.porEstado || {}).map(([e, n]) => `${n} ${e}`).join(' · ') || 'nada'}. `
          + 'Nada foi gravado.'
        : `${q.lidas ?? 0} conversa(s) lidas: ${q.criadas ?? 0} nova(s), ${q.atualizadas ?? 0} atualizada(s)`
          + `${q.naoGravadas ? `, ${q.naoGravadas} não gravada(s)` : ''}.`
          + (aprox ? ' Alguns campos de conversas resolvidas foram deduzidos (a plataforma não guarda quem resolveu).' : ''));
      if (!simular) await carregar();
    } catch (e) {
      setRecado(null);
      setErro(e.message || 'Não consegui trazer as conversas existentes.');
    } finally {
      setRetrocarregando(false);
    }
  }, [carregar]);

  const totalPaginas = lista ? Math.max(1, Math.ceil(lista.total / (lista.porPagina || 25))) : 1;
  const administra = lista?.escopo?.administra === true;
  const semSetor = lista?.escopo && !administra && (lista.escopo.setores || []).length === 0;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
      <CapaSecao
        secao="operacao"
        olho="Atendimento"
        titulo="Caixa de atendimento"
        apoio="A sua fila. Você vê as conversas atribuídas a você, as que você resolveu e a fila dos setores de que participa."
        acoes={(
          <button
            type="button"
            onClick={carregar}
            disabled={carregando}
            style={{ ...botaoAba(false), opacity: carregando ? 0.6 : 1 }}
          >
            <RefreshCw size={14} /> Atualizar
          </button>
        )}
      />

      {erro ? <Faixa tom="erro" titulo="Não consegui carregar">{erro}</Faixa> : null}
      {recado ? <Faixa tom="ok" titulo="Sincronizado">{recado}</Faixa> : null}

      {semSetor ? (
        <Faixa
          tom="aviso"
          titulo="Você ainda não está em nenhum setor"
          acoes={administra ? null : undefined}
        >
          Por isso a fila aparece vazia: quem não é membro de um setor não vê a fila dele. Peça a
          quem administra a empresa para sincronizar os setores. Isto é proposital — sem saber a que
          setor você pertence, mostrar a fila seria mostrar conversa de outra equipe.
        </Faixa>
      ) : null}

      <div style={{ ...cartao, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Abas aba={aba} contagem={contagem} aoTrocar={(v) => { setAba(v); setSub(null); setPagina(1); }} />
          {administra ? (
            <button
              type="button"
              onClick={sincronizar}
              disabled={sincronizando}
              style={{ ...botaoAba(false), opacity: sincronizando ? 0.6 : 1 }}
              title="Traz da plataforma os setores e quem é membro de cada um"
            >
              <Users size={14} /> {sincronizando ? 'Sincronizando…' : 'Sincronizar setores'}
            </button>
          ) : null}
          {administra ? (
            <>
              <button
                type="button"
                onClick={() => retrocarregar(true)}
                disabled={retrocarregando}
                style={{ ...botaoAba(false), opacity: retrocarregando ? 0.6 : 1 }}
                title="Mostra o que entraria na fila, sem gravar nada"
              >
                <Search size={14} /> Conferir conversas existentes
              </button>
              <button
                type="button"
                onClick={() => retrocarregar(false)}
                disabled={retrocarregando}
                style={{ ...botaoAba(false), opacity: retrocarregando ? 0.6 : 1 }}
                title="Traz para a fila as conversas que já existiam na plataforma. Pode rodar quantas vezes quiser: não duplica."
              >
                <RefreshCw size={14} /> {retrocarregando ? 'Trazendo…' : 'Trazer conversas existentes'}
              </button>
            </>
          ) : null}
        </div>

        {aba === 'abertas' ? (
          <SubAbas sub={sub} contagem={contagem} aoTrocar={(v) => { setSub(v); setPagina(1); }} />
        ) : null}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 13, color: T.mut }} />
            <input
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
              placeholder="Buscar por nome, número ou protocolo"
              style={{ ...campoEstilo, paddingLeft: 30 }}
            />
          </div>
          <select
            value={setorFiltro}
            onChange={(e) => { setSetorFiltro(e.target.value); setPagina(1); }}
            style={{ ...campoEstilo, width: 'auto', minWidth: 180 }}
          >
            <option value="">Todos os meus setores</option>
            {setores.map((s) => (
              <option key={s.cwTeamId} value={s.cwTeamId}>{s.nome}</option>
            ))}
          </select>
        </div>
      </div>

      {carregando && !lista ? <Vazio>Carregando a fila…</Vazio> : null}

      {lista && lista.itens.length === 0 && !carregando ? (
        <Vazio>
          <Inbox size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Nenhuma conversa nesta aba.
        </Vazio>
      ) : null}

      {lista?.itens?.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {lista.itens.map((c) => (
            <CartaoDeConversa key={c.id} conversa={c} aba={aba} aoVerHistorico={verHistorico} />
          ))}
        </div>
      ) : null}

      <PainelDeHistorico
        alvo={alvoHistorico}
        resultado={historico}
        carregando={historicoCarregando}
        erro={historicoErro}
        aoFechar={() => { setAlvoHistorico(null); setHistorico(null); setHistoricoErro(null); }}
      />

      {lista && lista.total > (lista.porPagina || 25) ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} style={botaoAba(false)}>Anterior</button>
          <span style={{ color: T.mut, fontSize: '0.8rem' }}>página {pagina} de {totalPaginas} · {lista.total} conversas</span>
          <button type="button" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} style={botaoAba(false)}>Próxima</button>
        </div>
      ) : null}
    </div>
  );
}
