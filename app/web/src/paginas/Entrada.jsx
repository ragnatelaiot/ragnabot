// ════════════════════════════════════════════════════════════════════════════════════════════════
// A ENTRADA — a tela de login do Ragnabot, e o portão que decide o que a página mostra.
//
// Contrato S4-AUTH (30/08/2026). Antes desta tela, a interface não tinha entrada: o motor injetava
// o token de serviço no navegador e QUEM ALCANÇASSE A URL entrava — com papel escolhido por
// cabeçalho, inclusive `super`. Agora a pessoa entra com a conta DELA da plataforma, o motor
// confere com o Chatwoot e devolve um cookie assinado. Nada é guardado aqui.
//
// ⛔ O QUE ESTA TELA NÃO FAZ, e não pode passar a fazer:
//   · não guarda senha, nem em estado que sobreviva ao envio (o campo é limpo no sucesso);
//   · não guarda token em `localStorage` — o cookie é HttpOnly justamente para script não o ler;
//   · não decide permissão. Ela mostra o que o servidor disse; quem tranca é o motor.
//
// SEGUNDO FATOR: o Chatwoot responde 206 quando a conta tem verificação em duas etapas. O motor
// traduz isso em `MFA_NECESSARIO` e esta tela abre o campo do código. O `mfa_token` (5 min) NUNCA
// chega aqui — ele nasce e morre dentro do motor, no mesmo pedido.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useState } from 'react';
import {
  EVENTO_SESSAO_EXPIRADA, adotarSessao, atorAtual, carregarSessao, entrar, sair,
} from '../lib/api.js';

const cartao = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--sh2)',
  padding: 'var(--space-xl)',
  width: 'min(420px, 100%)',
};

const campo = {
  width: '100%',
  padding: 'var(--space-sm) var(--space-md)',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-campo)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-family)',
  fontSize: '0.9rem',
};

const rotulo = {
  display: 'block',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  fontWeight: 'var(--peso-forte)',
  color: 'var(--text-secondary)',
  marginBottom: 'var(--space-xs)',
};

export function TelaDeEntrada({ aoEntrar, aviso }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pedeCodigo, setPedeCodigo] = useState(false);
  const [contas, setContas] = useState(null);      // 409 ESCOLHA_CONTA
  const [contaId, setContaId] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const s = await entrar({ email, senha, codigo, contaId: contaId || undefined });
      // A senha sai da memória da tela assim que serviu. Não é criptografia — é higiene: menos
      // um lugar onde ela existe se alguém abrir o inspetor no computador do atendente.
      setSenha('');
      setCodigo('');
      aoEntrar?.(s);
    } catch (err) {
      if (err.code === 'MFA_NECESSARIO' || err.code === 'MFA_INVALIDO') {
        setPedeCodigo(true);
      } else if (err.code === 'ESCOLHA_CONTA' && Array.isArray(err.dados?.contas)) {
        setContas(err.dados.contas);
      }
      setErro(err.message || 'Não consegui entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-lg)' }}>
      <form onSubmit={enviar} style={cartao} noValidate>
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ fontSize: '0.625rem', letterSpacing: '1.5px', textTransform: 'uppercase',
            fontWeight: 'var(--peso-forte)', color: 'var(--primary)' }}>Ragnabot</div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 'var(--peso-titulo)', margin: '4px 0 0' }}>Entrar</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: 6, lineHeight: 1.5 }}>
            Use a mesma conta da plataforma de atendimento. Não há senha separada aqui.
          </p>
        </div>

        {aviso && (
          <div role="status" style={{ background: 'var(--warning-dim)', border: '1px solid var(--warning)',
            borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)',
            marginBottom: 'var(--space-md)', fontSize: '0.82rem' }}>{aviso}</div>
        )}

        <div style={{ marginBottom: 'var(--space-md)' }}>
          <label style={rotulo} htmlFor="rb-email">E-mail</label>
          <input id="rb-email" style={campo} type="email" autoComplete="username" required
            value={email} onChange={(ev) => setEmail(ev.target.value)} disabled={enviando} />
        </div>

        <div style={{ marginBottom: 'var(--space-md)' }}>
          <label style={rotulo} htmlFor="rb-senha">Senha</label>
          <input id="rb-senha" style={campo} type="password" autoComplete="current-password" required
            value={senha} onChange={(ev) => setSenha(ev.target.value)} disabled={enviando} />
        </div>

        {pedeCodigo && (
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={rotulo} htmlFor="rb-codigo">Código de verificação</label>
            <input id="rb-codigo" style={campo} inputMode="numeric" autoComplete="one-time-code"
              placeholder="6 dígitos do aplicativo (ou um código de recuperação)"
              value={codigo} onChange={(ev) => setCodigo(ev.target.value)} disabled={enviando} />
          </div>
        )}

        {contas && (
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={rotulo} htmlFor="rb-conta">Empresa</label>
            <select id="rb-conta" style={campo} value={contaId} onChange={(ev) => setContaId(ev.target.value)} disabled={enviando}>
              <option value="">Escolha…</option>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome || `conta ${c.id}`}</option>)}
            </select>
          </div>
        )}

        {erro && (
          // `aria-live` porque quem usa leitor de tela precisa ouvir a recusa; sem isso o campo
          // simplesmente não avança e a pessoa não sabe por quê.
          <div role="alert" aria-live="assertive" style={{ background: 'var(--danger-dim)',
            border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)',
            padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)', fontSize: '0.82rem' }}>
            {erro}
          </div>
        )}

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}
          disabled={enviando} aria-busy={enviando ? 'true' : 'false'}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

/**
 * O aviso da sessão, para quem estiver desenhando a casca.
 *
 * ⭐ MUDOU EM 02/09/2026 (contrato S1). Antes o portão desenhava ele mesmo uma `BarraDaSessao` com
 * o nome de quem entrou e o botão «Sair». Agora quem desenha isso é o CABEÇALHO da casca
 * (`componentes/Casca.jsx`), porque a interface deixou de ser uma tela só. O aviso ("sua conta
 * ainda não está cadastrada no Ragnabot", "sua sessão terminou") continua nascendo aqui — ele é do
 * portão —, e viaja por este contexto em vez de por uma propriedade que atravessaria o roteador
 * inteiro. Sem provedor, o valor é `null`: um componente montado fora do portão (um teste, por
 * exemplo) não quebra, só não tem aviso.
 */
export const ContextoDaSessao = React.createContext({ aviso: null });

/**
 * O portão. Enquanto não souber quem é, não desenha o editor — e não desenha nada "por otimismo",
 * porque um editor montado sem sessão pediria dados, tomaria 401 e voltaria para cá piscando.
 *
 * `rodape` é opcional e só aparece nas telas de FORA (verificando, entrada, falha). Dentro, quem
 * põe o rodapé é a casca — e ela também é quem sabe a empresa. Passar o mesmo rodapé duas vezes
 * daria dois rodapés na mesma página em qualquer descuido.
 */
export function PortaoDeSessao({ children, rodape = null }) {
  const [estado, setEstado] = useState('verificando'); // verificando|fora|dentro|indisponivel|semRede
  const [detalhe, setDetalhe] = useState(null);
  const [aviso, setAviso] = useState(null);

  const conferir = useCallback(async () => {
    setEstado('verificando');
    try {
      let s = await carregarSessao();
      // ⭐ UMA ENTRADA SÓ (contrato S-CLAREZA, 03/09/2026). Antes desta linha, quem já estava
      // autenticado na plataforma de atendimento abria o nosso painel e levava a NOSSA tela de
      // login — a mesma senha, dois formulários. Foi o relato do dono: «por que tem outra
      // autenticação para acessar esse /painel».
      //
      // Agora, quando não há sessão nossa, PERGUNTAMOS ao motor se dá para aproveitar a que a
      // pessoa já tem lá. Quem confere é o servidor, com a plataforma; a tela só pergunta.
      //
      // ⚠️ UMA tentativa, e só quando não há sessão: adotar não é caminho de retentativa. Se não
      // der, o formulário aparece — que é exatamente o que aparecia antes.
      if (!s) s = await adotarSessao();
      setEstado(s ? 'dentro' : 'fora');
      setAviso(s?.aviso || null);
    } catch (e) {
      setDetalhe(e.message);
      setEstado(e.status === 503 ? 'indisponivel' : 'semRede');
    }
  }, []);

  useEffect(() => { conferir(); }, [conferir]);

  useEffect(() => {
    const aoCair = () => { setAviso('Sua sessão terminou. Entre de novo para continuar.'); setEstado('fora'); };
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoCair);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoCair);
  }, []);

  // As telas de FORA vêm embrulhadas em `.pagina` aqui dentro, e não no `main.jsx`: dentro da
  // sessão quem dá o respiro é a casca (que põe `.pagina` na coluna de conteúdo, ao lado do menu).
  // Embrulhar nos dois lugares daria padding em dobro, e a capa nasceria com faixa nas laterais.
  if (estado === 'verificando') {
    return (
      <div className="pagina">
        <div style={{ padding: 'var(--space-2xl)', color: 'var(--text-secondary)' }}>Verificando a sessão…</div>
        {rodape}
      </div>
    );
  }
  if (estado === 'indisponivel' || estado === 'semRede') {
    return (
      <div className="pagina">
        <div style={{ padding: 'var(--space-xl)' }}>
          <div role="alert" style={{ ...cartao, width: 'min(560px, 100%)', background: 'var(--danger-dim)', borderColor: 'var(--danger)' }}>
            <b style={{ color: 'var(--danger)' }}>Não consigo abrir a entrada.</b>
            <p style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{detalhe}</p>
            <button type="button" className="btn btn-secondary" onClick={conferir}>Tentar de novo</button>
          </div>
        </div>
        {rodape}
      </div>
    );
  }
  if (estado === 'fora') {
    return (
      <div className="pagina">
        <TelaDeEntrada aviso={aviso} aoEntrar={(s) => { setAviso(s?.aviso || null); setEstado('dentro'); }} />
        {rodape}
      </div>
    );
  }
  return (
    <ContextoDaSessao.Provider value={{ aviso }}>
      {children}
    </ContextoDaSessao.Provider>
  );
}

/**
 * Quem está logado e o botão de sair — a versão SEM casca.
 *
 * ⚠️ Continua exportada, e não é sobra: quem monta a interface fora da casca (um teste de
 * renderização, ou uma tela isolada) ainda precisa de um jeito de sair. Dentro da casca, quem
 * desenha isto é o `Cabecalho`, e os dois não aparecem juntos.
 */
export function BarraDaSessao({ aviso }) {
  const ator = atorAtual();
  const [saindo, setSaindo] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap',
      justifyContent: 'flex-end', marginBottom: 'var(--space-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
      {aviso && (
        <span role="status" style={{ marginRight: 'auto', color: 'var(--warning)' }}>{aviso}</span>
      )}
      <span>
        {ator.nome || 'você'}
        {ator.papel === 'admin' ? ' · administrador' : ' · atendente'}
      </span>
      <button type="button" className="btn btn-secondary" disabled={saindo}
        onClick={async () => {
          setSaindo(true);
          await sair();
          // Recarregar em vez de trocar de estado: garante que nada do editor (rascunho em
          // memória, temporizador de teste) sobreviva à troca de pessoa na mesma máquina.
          window.location.reload();
        }}>
        {saindo ? 'Saindo…' : 'Sair'}
      </button>
    </div>
  );
}

export default PortaoDeSessao;
