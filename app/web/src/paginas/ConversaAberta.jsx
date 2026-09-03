// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CONVERSA ABERTA — o painel onde o atendente lê e responde.  Contrato S-ATENDER (03/09/2026)
//
// ── A FRASE QUE ORIGINOU ESTE ARQUIVO ───────────────────────────────────────────────────────────
// O dono abriu a nossa tela de Atendimentos e disse: «não consigo aceitar, transferir e VER NADA DA
// CONVERSA». Até aqui a caixa era uma lista: clicar num cartão não abria coisa nenhuma.
//
// ── ⛔ O QUE ESTA TELA NÃO É ────────────────────────────────────────────────────────────────────
// Ela NÃO decide quem escreve. Quem decide é o servidor, e a resposta vem pronta em `escrita.pode`
// junto com a explicação em português (`escrita.explicacao`). Aqui não há um único `if` de papel de
// usuário. Se o campo de texto sumisse por regra da TELA, bastaria um `curl` para escrever na
// conversa de outro — e é exatamente esse `curl` que o teste da mesa dispara e vê ser recusado.
//
// ── O CONTEÚDO NÃO É NOSSO, E NÃO FICA AQUI ─────────────────────────────────────────────────────
// As mensagens são lidas AO VIVO na plataforma a cada abertura. Nada é copiado para as nossas
// tabelas — texto de cliente tem dono, e uma segunda cópia é uma segunda verdade para vazar.
//
// ── HORÁRIO EM UTC−3, SEMPRE ────────────────────────────────────────────────────────────────────
// A plataforma carimba em UTC. Quem lê é gente em Fortaleza/São Luís. Mostrar «14:32» quando são
// 11:32 faz o atendente responder «respondi agora» a uma mensagem de três horas atrás.
//
// ── PARA TESTE ──────────────────────────────────────────────────────────────────────────────────
// `Balao`, `LinhaDoTempo`, `BarraDeEscrita` e `PainelDeTransferencia` são PUROS: recebem tudo por
// propriedade e não chamam a rede.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, Bot, Check, Eye, Lock, Paperclip, Send, StickyNote, User, UserPlus, X,
} from 'lucide-react';

import { Etiqueta, Faixa, T, Vazio, campoEstilo, cartao } from './EmpresaFormulario.jsx';
import {
  abrirConversa, aceitarConversa, assumirConversa, destinosDeTransferencia,
  enderecoDoAnexo, enviarMensagem, transferirConversa,
} from '../lib/api-caixa.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 0. FORMATAÇÃO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O horário como o atendente vive — UTC−3, sempre, independentemente do relógio do navegador.
 *
 * ⚠️ NÃO uso `toLocaleTimeString` sem fuso: o navegador de quem abre a tela de outro lugar (ou com o
 * relógio errado) mostraria outra hora, e duas pessoas olhando a MESMA conversa discutiriam sobre
 * quando o cliente escreveu. O fuso é do NEGÓCIO, não da máquina.
 */
export function horaLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** O rótulo do dia, para separar as mensagens. «Hoje» e «Ontem» poupam a conta de cabeça. */
export function diaLocal(iso) {
  if (!iso) return '';
  const fmt = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
  const dia = fmt(new Date(iso));
  const hoje = fmt(new Date());
  const ontem = fmt(new Date(Date.now() - 86400000));
  if (dia === hoje) return 'Hoje';
  if (dia === ontem) return 'Ontem';
  return dia;
}

const QUEM = {
  cliente: { rotulo: 'Cliente', icone: User, lado: 'esquerda', fundo: 'var(--bg-surface)' },
  atendente: { rotulo: 'Atendente', icone: User, lado: 'direita', fundo: 'var(--info-dim)' },
  robo: { rotulo: 'Robô', icone: Bot, lado: 'direita', fundo: 'var(--bg-surface)' },
  nota: { rotulo: 'Nota interna', icone: StickyNote, lado: 'direita', fundo: 'var(--warning-dim)' },
  sistema: { rotulo: 'Sistema', icone: null, lado: 'centro', fundo: 'transparent' },
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. PEÇAS PURAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Uma mensagem. Quem falou vem escrito, além do lado — cor sozinha não informa quem é quem. */
export function Balao({ mensagem, cwConversationId }) {
  const m = mensagem;
  const q = QUEM[m.lado] || QUEM.sistema;
  const Icone = q.icone;

  if (m.lado === 'sistema') {
    return (
      <div data-mensagem={m.id} style={{ textAlign: 'center', color: T.mut, fontSize: '0.72rem', padding: '2px 0' }}>
        {m.texto || '—'} · {horaLocal(m.quando)}
      </div>
    );
  }

  return (
    <div
      data-mensagem={m.id}
      data-lado={m.lado}
      style={{ display: 'flex', justifyContent: q.lado === 'direita' ? 'flex-end' : 'flex-start' }}
    >
      <div style={{
        maxWidth: 'min(620px, 82%)', background: q.fundo,
        border: `1px solid ${m.lado === 'nota' ? T.aviso : T.borda}`,
        borderRadius: 12, padding: '8px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, color: T.mut, fontSize: '0.7rem' }}>
          {Icone ? <Icone size={11} /> : null}
          <strong style={{ fontWeight: 700 }}>{m.autorNome || q.rotulo}</strong>
          {m.lado === 'nota' ? <span title="Só a equipe vê. O cliente não recebe.">· só a equipe vê</span> : null}
        </div>

        {m.texto ? (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: T.ink, fontSize: '0.86rem' }}>
            {m.texto}
          </div>
        ) : null}

        {(m.anexos || []).map((a) => (
          <Anexo key={`${m.id}-${a.indice}`} anexo={a} cwConversationId={cwConversationId} cwMessageId={m.id} />
        ))}

        <div style={{ marginTop: 4, color: T.mut, fontSize: '0.68rem', textAlign: 'right' }}>
          {horaLocal(m.quando)}
          {m.entrega ? ` · ${m.entrega}` : ''}
        </div>
      </div>
    </div>
  );
}

/**
 * O anexo. O endereço é o do NOSSO painel — o da plataforma nunca chega ao navegador.
 *
 * Imagem e áudio abrem aqui mesmo; o resto vira link para baixar. Se a busca falhar (a plataforma
 * pode recusar, e a janela do arquivo expira), o `onError` troca a foto pelo nome do arquivo em vez
 * de deixar um retângulo quebrado sem explicação.
 */
export function Anexo({ anexo, cwConversationId, cwMessageId }) {
  const [falhou, setFalhou] = useState(false);
  const url = enderecoDoAnexo(cwConversationId, cwMessageId, anexo.indice);
  const nome = anexo.nome || `arquivo ${anexo.indice + 1}`;

  if (falhou || !anexo.tipo || !['image', 'audio', 'video'].includes(anexo.tipo)) {
    return (
      <a
        href={url} target="_blank" rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, color: T.primaria, fontSize: '0.8rem' }}
      >
        <Paperclip size={13} /> {nome}
        {falhou ? <span style={{ color: T.mut }}> (não consegui abrir aqui — tente baixar)</span> : null}
      </a>
    );
  }
  if (anexo.tipo === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 6 }}>
        <img
          src={url} alt={nome} onError={() => setFalhou(true)}
          style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, display: 'block' }}
        />
      </a>
    );
  }
  const Media = anexo.tipo === 'audio' ? 'audio' : 'video';
  return (
    <Media
      src={url} controls onError={() => setFalhou(true)}
      style={{ marginTop: 6, maxWidth: '100%', borderRadius: 8 }}
    />
  );
}

/** O histórico, em ordem, com separador de dia. */
export function LinhaDoTempo({ mensagens = [], cwConversationId, aviso }) {
  const blocos = useMemo(() => {
    const saida = [];
    let diaAtual = null;
    for (const m of mensagens) {
      const dia = diaLocal(m.quando);
      if (dia !== diaAtual) { saida.push({ tipo: 'dia', chave: `d-${dia}-${m.id}`, dia }); diaAtual = dia; }
      saida.push({ tipo: 'msg', chave: `m-${m.id}`, m });
    }
    return saida;
  }, [mensagens]);

  return (
    <div data-linha-do-tempo style={{ display: 'grid', gap: 8, padding: '4px 2px' }}>
      {aviso ? <Faixa tom="aviso" titulo="O conteúdo não carregou">{aviso}</Faixa> : null}
      {!aviso && mensagens.length === 0
        ? <Vazio>Nenhuma mensagem nesta conversa ainda.</Vazio> : null}
      {blocos.map((b) => (b.tipo === 'dia' ? (
        <div key={b.chave} style={{ textAlign: 'center', color: T.mut, fontSize: '0.7rem', margin: '6px 0 2px' }}>
          <span style={{ background: T.sup, border: `1px solid ${T.borda}`, borderRadius: 999, padding: '2px 10px' }}>{b.dia}</span>
        </div>
      ) : (
        <Balao key={b.chave} mensagem={b.m} cwConversationId={cwConversationId} />
      )))}
    </div>
  );
}

function botao(tom = 'neutro', { largo = false } = {}) {
  const cores = {
    neutro: { borda: T.borda, fundo: 'transparent', cor: T.sec },
    ok: { borda: T.ok, fundo: T.okDim, cor: T.ink },
    info: { borda: T.primaria, fundo: T.infoDim, cor: T.ink },
    aviso: { borda: T.aviso, fundo: T.avisoDim, cor: T.ink },
  }[tom] || {};
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: largo ? '8px 14px' : '5px 10px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${cores.borda}`, background: cores.fundo, color: cores.cor,
    fontSize: '0.78rem', fontWeight: 700,
  };
}

/**
 * ⭐ A BARRA DE ESCRITA — ou a explicação de por que ela não está aqui.
 *
 * Sem atribuição o campo NÃO EXISTE. E, no lugar dele, aparece a frase que o SERVIDOR mandou, com o
 * botão que resolve (Aceitar, ou Assumir para quem administra). Esconder sem explicar transforma
 * uma regra em defeito aparente, e é assim que se abre chamado de suporte contra o próprio produto.
 */
export function BarraDeEscrita({
  escrita, enviando, texto, aoDigitar, aoEnviar, nota, aoTrocarNota,
  aoAceitar, aoAssumir, ocupado,
}) {
  if (!escrita?.pode) {
    return (
      <div data-sem-escrita style={{
        ...cartao, padding: 12, display: 'flex', gap: 10, alignItems: 'center',
        flexWrap: 'wrap', borderStyle: 'dashed',
      }}>
        <Lock size={16} style={{ color: T.mut, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 220, color: T.sec, fontSize: '0.82rem' }}>
          {escrita?.explicacao || 'Você não pode escrever nesta conversa.'}
        </div>
        {escrita?.podeAceitar ? (
          <button type="button" onClick={aoAceitar} disabled={ocupado} style={botao('ok', { largo: true })}>
            <Check size={14} /> {ocupado ? 'Aceitando…' : 'Aceitar e responder'}
          </button>
        ) : null}
        {escrita?.podeAssumir ? (
          <button
            type="button" onClick={aoAssumir} disabled={ocupado} style={botao('aviso', { largo: true })}
            title="Toma a conversa para você. Fica registrado como transferência, com o seu nome."
          >
            <UserPlus size={14} /> {ocupado ? 'Assumindo…' : 'Assumir para mim'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div data-barra-escrita style={{ ...cartao, padding: 10, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.sec, fontSize: '0.76rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={nota === true} onChange={(e) => aoTrocarNota(e.target.checked)} />
          <StickyNote size={13} /> Nota interna (o cliente não recebe)
        </label>
        {nota ? (
          <span style={{ color: T.aviso, fontSize: '0.74rem' }}>
            Fica registrada na conversa, só para a equipe.
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={texto}
          onChange={(e) => aoDigitar(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha. É o gesto que o atendente já traz de casa.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aoEnviar(); }
          }}
          rows={2}
          placeholder={nota ? 'Escreva a nota para a equipe…' : 'Escreva a resposta ao cliente… (Enter envia, Shift+Enter quebra linha)'}
          style={{ ...campoEstilo, resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }}
        />
        <button
          type="button" onClick={aoEnviar} disabled={enviando || !String(texto || '').trim()}
          style={{ ...botao(nota ? 'aviso' : 'info', { largo: true }), height: 56, opacity: enviando ? 0.6 : 1 }}
        >
          <Send size={15} /> {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

/** ⭐ O painel de TRANSFERÊNCIA: para outro atendente e/ou outro setor. */
export function PainelDeTransferencia({ destinos, valor, aoMudar, aoConfirmar, aoCancelar, ocupado, erro }) {
  const semDestino = !valor.paraCwUserId && !valor.paraCwTeamId;
  return (
    <div data-transferencia style={{ ...cartao, padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: T.ink }}>
          <ArrowLeftRight size={15} /> Transferir esta conversa
        </strong>
        <button type="button" onClick={aoCancelar} style={botao()}><X size={13} /> Cancelar</button>
      </div>

      {erro ? <Faixa tom="erro" titulo="Não consegui transferir">{erro}</Faixa> : null}
      {destinos?.aviso ? <Faixa tom="aviso" titulo="Atenção">{destinos.aviso}</Faixa> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.78rem', color: T.sec }}>
          Para o atendente
          <select
            value={valor.paraCwUserId || ''}
            onChange={(e) => aoMudar({ ...valor, paraCwUserId: e.target.value ? Number(e.target.value) : null })}
            style={campoEstilo}
          >
            <option value="">— ninguém (deixa na fila do setor) —</option>
            {(destinos?.atendentes || []).map((a) => (
              <option key={a.cwUserId} value={a.cwUserId}>{a.nome}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.78rem', color: T.sec }}>
          Para o setor
          <select
            value={valor.paraCwTeamId || ''}
            onChange={(e) => aoMudar({ ...valor, paraCwTeamId: e.target.value ? Number(e.target.value) : null })}
            style={campoEstilo}
          >
            <option value="">— manter o setor atual —</option>
            {(destinos?.setores || []).map((s) => (
              <option key={s.cwTeamId} value={s.cwTeamId}>{s.nome}</option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: 'grid', gap: 4, fontSize: '0.78rem', color: T.sec }}>
        Motivo (entra no relatório)
        <input
          value={valor.motivo || ''}
          onChange={(e) => aoMudar({ ...valor, motivo: e.target.value })}
          placeholder="ex.: assunto de cobrança"
          style={campoEstilo}
        />
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: '0.78rem', color: T.sec }}>
        Observação para quem receber (vira nota interna dentro da conversa)
        <textarea
          value={valor.notaInterna || ''}
          onChange={(e) => aoMudar({ ...valor, notaInterna: e.target.value })}
          rows={2}
          placeholder="o que a próxima pessoa precisa saber para não começar do zero"
          style={{ ...campoEstilo, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: T.sec, fontSize: '0.78rem', cursor: 'pointer' }}>
        <input
          type="checkbox" checked={valor.avisarCliente === true}
          onChange={(e) => aoMudar({ ...valor, avisarCliente: e.target.checked })}
        />
        Avisar o cliente da transferência
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button" onClick={aoConfirmar} disabled={ocupado || semDestino}
          style={{ ...botao('info', { largo: true }), opacity: (ocupado || semDestino) ? 0.6 : 1 }}
          title={semDestino ? 'Escolha um atendente, um setor, ou os dois' : ''}
        >
          <ArrowLeftRight size={14} /> {ocupado ? 'Transferindo…' : 'Transferir'}
        </button>
      </div>
      <p style={{ margin: 0, color: T.mut, fontSize: '0.72rem' }}>
        Ao transferir, a conversa muda de dono — e some da sua caixa na mesma hora. Sem escolher
        atendente, ela volta para a fila do setor escolhido.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. O PAINEL
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {number} p.cwConversationId  qual conversa abrir
 * @param {Function} p.aoFechar        volta para a lista
 * @param {Function} p.aoMudarConversa avisa a lista que algo mudou (aceite, transferência, envio)
 */
export default function ConversaAberta({ cwConversationId, aoFechar, aoMudarConversa, sinalAoVivo = 0 }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [recado, setRecado] = useState(null);

  const [texto, setTexto] = useState('');
  const [nota, setNota] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [transferindo, setTransferindo] = useState(false);
  const [destinos, setDestinos] = useState(null);
  const [formTransf, setFormTransf] = useState({ paraCwUserId: null, paraCwTeamId: null, motivo: '', notaInterna: '', avisarCliente: false });
  const [erroTransf, setErroTransf] = useState(null);

  const fim = useRef(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const r = await abrirConversa(cwConversationId);
      setDados(r);
    } catch (e) {
      setErro(e.message || 'Não consegui abrir a conversa.');
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [cwConversationId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ⭐ TEMPO REAL (contrato S-TEMPO-REAL, 03/09/2026 — item 4 do doc 35 §6.8): mensagem nova
  // aparece sem F5. O pai incrementa `sinalAoVivo` quando o servidor avisa que ESTA conversa
  // recebeu fala nova; aqui a recarga é SILENCIOSA — trocar a tela por «carregando» a cada
  // mensagem faria o histórico piscar e tiraria o atendente do lugar onde ele estava lendo.
  // O texto que ele está digitando não é tocado: só `dados` é substituído.
  useEffect(() => {
    if (!sinalAoVivo) return;
    carregar(true);
  }, [sinalAoVivo, carregar]);

  // Rola para o fim quando o histórico chega ou cresce. Conversa que abre no topo obriga o
  // atendente a rolar até o presente antes de entender o que está acontecendo.
  useEffect(() => {
    if (fim.current) fim.current.scrollIntoView({ block: 'end' });
  }, [dados?.mensagens?.length]);

  const conversa = dados?.conversa || null;
  const escrita = dados?.escrita || null;

  const aceitar = useCallback(async () => {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await aceitarConversa(cwConversationId, { cwTeamId: conversa?.setor?.id || undefined });
      setRecado(r.plataforma?.aplicada === false
        ? `Conversa aceita. ${r.plataforma.aviso}`
        : 'Conversa aceita — agora é sua, e você já pode responder.');
      await carregar(true);
      aoMudarConversa?.();
    } catch (e) {
      // ⭐ A CORRIDA, do lado de quem perdeu. O servidor manda o nome de quem levou; a tela repete a
      // frase dele em vez de inventar «erro ao aceitar».
      setErro(e.message || 'Não consegui aceitar.');
      if (e.code === 'JA_ACEITA') { await carregar(true); aoMudarConversa?.(); }
    } finally {
      setOcupado(false);
    }
  }, [cwConversationId, conversa, carregar, aoMudarConversa]);

  const assumir = useCallback(async () => {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await assumirConversa(cwConversationId);
      setRecado(r.recado || 'Conversa assumida. O registro ficou na auditoria com o seu nome.');
      await carregar(true);
      aoMudarConversa?.();
    } catch (e) {
      setErro(e.message || 'Não consegui assumir.');
    } finally {
      setOcupado(false);
    }
  }, [cwConversationId, carregar, aoMudarConversa]);

  const enviar = useCallback(async () => {
    const corpo = String(texto || '').trim();
    if (!corpo) return;
    setEnviando(true); setErro(null);
    try {
      await enviarMensagem(cwConversationId, { texto: corpo, privada: nota });
      setTexto('');
      await carregar(true);
      aoMudarConversa?.();
    } catch (e) {
      setErro(e.message || 'Não consegui enviar.');
    } finally {
      setEnviando(false);
    }
  }, [cwConversationId, texto, nota, carregar, aoMudarConversa]);

  const abrirTransferencia = useCallback(async () => {
    setTransferindo(true); setErroTransf(null);
    try { setDestinos(await destinosDeTransferencia()); } catch (e) { setErroTransf(e.message); }
  }, []);

  const confirmarTransferencia = useCallback(async () => {
    setOcupado(true); setErroTransf(null);
    try {
      const r = await transferirConversa(cwConversationId, formTransf);
      setTransferindo(false);
      setRecado(r.recado
        + (r.avisoAoCliente && r.avisoAoCliente.enviado === false
          ? ` (o aviso ao cliente não saiu: ${r.avisoAoCliente.motivo})` : ''));
      aoMudarConversa?.();
      // Depois de transferir, a conversa costuma deixar de ser visível para quem a mandou — e é
      // assim que tem de ser. Voltar para a lista é honesto; deixar o painel aberto mostrando uma
      // conversa que já não é dele seria mentira de tela.
      aoFechar?.(r.recado);
    } catch (e) {
      setErroTransf(e.message || 'Não consegui transferir.');
    } finally {
      setOcupado(false);
    }
  }, [cwConversationId, formTransf, aoMudarConversa, aoFechar]);

  return (
    <div data-conversa-aberta={cwConversationId} style={{ display: 'grid', gap: 10 }}>
      {/* ── cabeçalho ─────────────────────────────────────────────────────────────────────── */}
      <div style={{ ...cartao, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => aoFechar?.()} style={botao()}>← Voltar à fila</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 800, color: T.ink }}>
            {conversa?.contato?.nome || conversa?.contato?.chave || `Conversa #${cwConversationId}`}
          </div>
          <div style={{ color: T.mut, fontSize: '0.75rem' }}>
            {conversa?.protocolo || `#${cwConversationId}`}
            {conversa?.contato?.chave ? ` · ${conversa.contato.chave}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(conversa?.etiquetas || []).map((e) => (
            <Etiqueta key={e.tipo} tom={e.vazia ? 'neutro' : 'info'}>{e.rotulo}</Etiqueta>
          ))}
          {dados?.espiada ? (
            <Etiqueta tom="aviso" titulo="Você está lendo sem ter assumido. Esta abertura ficou registrada.">
              <Eye size={11} style={{ verticalAlign: -1 }} /> só leitura
            </Etiqueta>
          ) : null}
          {escrita?.podeTransferir ? (
            <button type="button" onClick={abrirTransferencia} style={botao('info')}>
              <ArrowLeftRight size={13} /> Transferir
            </button>
          ) : null}
        </div>
      </div>

      {erro ? <Faixa tom="erro" titulo="Não deu certo">{erro}</Faixa> : null}
      {recado ? <Faixa tom="ok" titulo="Pronto">{recado}</Faixa> : null}
      {dados?.espiada ? (
        <Faixa tom="aviso" titulo="Você está espiando esta conversa">
          Está em leitura, e a abertura ficou registrada na auditoria — ver conversa de cliente é ato
          que se registra. Para responder, assuma o atendimento.
        </Faixa>
      ) : null}

      {transferindo ? (
        <PainelDeTransferencia
          destinos={destinos}
          valor={formTransf}
          aoMudar={setFormTransf}
          aoConfirmar={confirmarTransferencia}
          aoCancelar={() => { setTransferindo(false); setErroTransf(null); }}
          ocupado={ocupado}
          erro={erroTransf}
        />
      ) : null}

      {/* ── o histórico ───────────────────────────────────────────────────────────────────── */}
      <div style={{ ...cartao, padding: 12, maxHeight: '52vh', overflowY: 'auto' }}>
        {carregando && !dados ? <Vazio>Carregando a conversa…</Vazio> : null}
        {dados ? (
          <LinhaDoTempo
            mensagens={dados.mensagens || []}
            cwConversationId={cwConversationId}
            aviso={dados.avisoMensagens}
          />
        ) : null}
        <div ref={fim} />
      </div>

      {/* ── ⭐ escrever, ou a explicação de por que não ────────────────────────────────────── */}
      {dados ? (
        <BarraDeEscrita
          escrita={escrita}
          enviando={enviando}
          texto={texto}
          aoDigitar={setTexto}
          aoEnviar={enviar}
          nota={nota}
          aoTrocarNota={setNota}
          aoAceitar={aceitar}
          aoAssumir={assumir}
          ocupado={ocupado}
        />
      ) : null}
    </div>
  );
}
