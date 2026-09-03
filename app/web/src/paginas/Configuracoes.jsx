// ════════════════════════════════════════════════════════════════════════════════════════════════
// TELA — MENU CONFIGURAÇÕES (contrato S7, 02/09/2026 — doc 34 §F8, painéis 8.1 a 8.13)
//
// ── ⛔ A REGRA QUE ESTA TELA OBEDECE, E NÃO INVENTA ─────────────────────────────────────────────
// Ordem do dono: *"whitelabel, empresas e planos só aparecem na conta que vende o SaaS"*. Esta
// tela NÃO decide isso. Ela chama `GET /api/ragnabot-config/quem-sou` e desenha as abas que o
// SERVIDOR listou. Não há nenhum `if (empresa === 'ragnatela')` aqui — se houvesse, a regra
// viveria em dois lugares e um dia discordariam. E, mesmo que alguém apague este arquivo inteiro,
// a conta de cliente continua levando 403 na API: a trava é `src/base/operador-saas.js`, e está
// medida em `tests/ragnabot-configuracao-visibilidade.test.mjs`.
//
// ── O FORMULÁRIO É GERADO PELO CATÁLOGO ────────────────────────────────────────────────────────
// Cada campo vem do servidor com tipo, rótulo, ajuda, opções e faixa. Ajuste novo aparece aqui
// sozinho, sem tocar nesta tela — que é o outro lado da decisão de ter catálogo em vez de uma
// coluna por caixinha.
//
// ── E ELA DIZ A VERDADE SOBRE O QUE AINDA NÃO FAZ NADA ─────────────────────────────────────────
// Campo com `efeito: 'declarado'` ganha a marca «guardado, ainda sem efeito». Painel cheio de
// interruptor que não faz nada é pior que painel vazio: ensina o operador a desconfiar de todos,
// inclusive dos que funcionam.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import CapaSecao from '../componentes/CapaSecao.jsx';
import {
  quemSou, lerPainel, salvarPainel, lerWhitelabel, salvarWhitelabel,
  lerEmpresasDoSaas, lerPlanosDoSaas, lerPendentesDeDecisao,
} from '../lib/api-configuracoes.js';

const PAINEL_WHITELABEL = 'whitelabel';

/** Abas extras do OPERADOR que não são "painel de ajustes", e sim listas já existentes. Só entram
 *  no menu quando o servidor disser que esta conta é a operadora. */
const ABAS_DO_OPERADOR = [
  { id: '_empresas', rotulo: 'Empresas', doc: '8.4' },
  { id: '_planos', rotulo: 'Planos', doc: '8.5' },
];

function Aviso({ tom = 'info', children }) {
  const cores = {
    info: { fundo: 'var(--surface-2, #f1f5f9)', borda: 'var(--border, #cbd5e1)' },
    erro: { fundo: 'rgba(220,38,38,.08)', borda: 'rgba(220,38,38,.45)' },
    ok: { fundo: 'rgba(16,185,129,.10)', borda: 'rgba(16,185,129,.45)' },
  }[tom];
  return (
    <div style={{
      background: cores.fundo, border: `1px solid ${cores.borda}`, borderRadius: 10,
      padding: '10px 12px', margin: '12px 0', fontSize: '.9rem', lineHeight: 1.45,
    }}>{children}</div>
  );
}

/** Um campo, desenhado pelo TIPO que o servidor declarou. */
function Campo({ item, valor, definido, onMudar, somenteLeitura }) {
  const id = `cfg-${item.chave}`;
  const comum = { id, disabled: somenteLeitura, style: { width: '100%' } };

  let controle = null;
  if (item.tipo === 'bool') {
    controle = (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: somenteLeitura ? 'default' : 'pointer' }}>
        <input type="checkbox" id={id} disabled={somenteLeitura}
          checked={valor === true} onChange={(e) => onMudar(item.chave, e.target.checked)} />
        <span>{valor === true ? 'Ligado' : 'Desligado'}</span>
      </label>
    );
  } else if (item.tipo === 'opcao') {
    controle = (
      <select {...comum} value={valor ?? ''} onChange={(e) => onMudar(item.chave, e.target.value)}>
        {(item.opcoes || []).map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
      </select>
    );
  } else if (item.tipo === 'inteiro') {
    controle = (
      <input {...comum} type="number" value={valor ?? ''}
        min={item.min ?? undefined} max={item.max ?? undefined}
        onChange={(e) => onMudar(item.chave, e.target.value === '' ? null : Number(e.target.value))} />
    );
  } else if (item.tipo === 'cor') {
    controle = (
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="color" id={id} disabled={somenteLeitura} value={valor || '#000000'}
          onChange={(e) => onMudar(item.chave, e.target.value)} style={{ width: 48, height: 32, padding: 0 }} />
        <input type="text" disabled={somenteLeitura} value={valor || ''} style={{ flex: 1 }}
          onChange={(e) => onMudar(item.chave, e.target.value)} placeholder="#RRGGBB" />
      </span>
    );
  } else if (item.tipo === 'segredo') {
    // ⛔ O valor NUNCA chega do servidor. O campo começa vazio; digitar substitui, deixar em branco
    // mantém o que está lá. A impressão digital é o que permite conferir sem poder reconstruir.
    controle = (
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input {...comum} type="password" autoComplete="new-password" value={valor ?? ''}
          placeholder={definido ? '•••••••• (guardado — digite para trocar)' : 'não configurado'}
          onChange={(e) => onMudar(item.chave, e.target.value)} />
      </span>
    );
  } else if ((item.maxLen || 0) > 500) {
    controle = (
      <textarea {...comum} rows={6} value={valor ?? ''} maxLength={item.maxLen || undefined}
        onChange={(e) => onMudar(item.chave, e.target.value)} />
    );
  } else {
    controle = (
      <input {...comum} type={item.tipo === 'url' ? 'url' : 'text'} value={valor ?? ''}
        maxLength={item.maxLen || undefined}
        onChange={(e) => onMudar(item.chave, e.target.value)} />
    );
  }

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
      <label htmlFor={id} style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
        {item.rotulo}
        {item.efeito === 'declarado' && (
          <span title="O ajuste fica gravado e auditado, mas nenhum código do produto o consulta ainda."
            style={{
              marginLeft: 8, fontSize: '.7rem', fontWeight: 500, padding: '2px 6px', borderRadius: 6,
              background: 'rgba(234,179,8,.15)', color: 'var(--text-secondary)',
            }}>guardado, ainda sem efeito</span>
        )}
      </label>
      {controle}
      {item.ajuda && (
        <p style={{ margin: '6px 0 0', fontSize: '.82rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          {item.ajuda}
        </p>
      )}
      {item.tipo === 'segredo' && item.impressaoDigital && (
        <p style={{ margin: '4px 0 0', fontSize: '.78rem', color: 'var(--text-secondary)' }}>
          Impressão digital do que está guardado: <code>{item.impressaoDigital}</code>
        </p>
      )}
      {item.jaExiste && (
        <p style={{ margin: '4px 0 0', fontSize: '.78rem', color: 'var(--text-secondary)', opacity: .85 }}>
          Motor existente: <code>{item.jaExiste}</code>
        </p>
      )}
    </div>
  );
}

/** Um painel de ajustes (empresa ou whitelabel). */
function PainelDeAjustes({ painel, podeEscrever }) {
  const [dados, setDados] = useState(null);
  const [rascunho, setRascunho] = useState({});
  const [erro, setErro] = useState(null);
  const [ok, setOk] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null); setOk(null);
    try {
      const r = painel === PAINEL_WHITELABEL ? await lerWhitelabel() : await lerPainel(painel);
      setDados(r); setRascunho({});
    } catch (e) { setErro(e.message); setDados(null); }
  }, [painel]);

  useEffect(() => { carregar(); }, [carregar]);

  const mudar = (chave, valor) => {
    setOk(null);
    setRascunho((r) => ({ ...r, [chave]: valor }));
  };

  const salvar = async () => {
    setSalvando(true); setErro(null); setOk(null);
    try {
      // Só o que MUDOU vai no corpo. Mandar o painel inteiro faria a auditoria registrar dez
      // «ajustes» quando a pessoa mexeu em um — e auditoria inflada é auditoria que ninguém lê.
      const corpo = { ...rascunho };
      // Segredo em branco significa "não mexi", não "apagar" — apagar é um ato explícito, e a
      // tela não pode apagar a senha de SMTP de alguém porque o campo nasceu vazio.
      for (const [k, v] of Object.entries(corpo)) {
        const def = (dados?.itens || []).find((i) => i.chave === k);
        if (def?.tipo === 'segredo' && (v === '' || v === null)) delete corpo[k];
      }
      if (Object.keys(corpo).length === 0) { setOk('Nada mudou.'); setSalvando(false); return; }
      const r = painel === PAINEL_WHITELABEL ? await salvarWhitelabel(corpo) : await salvarPainel(painel, corpo);
      setDados(r.painelAtual);
      setRascunho({});
      setOk(r.mudancas.length === 0 ? 'Nada mudou.' : `${r.mudancas.length} ajuste(s) salvo(s).`);
    } catch (e) { setErro(e.message); }
    setSalvando(false);
  };

  if (erro && !dados) return <Aviso tom="erro">{erro}</Aviso>;
  if (!dados) return <p style={{ color: 'var(--text-secondary)' }}>Carregando…</p>;

  const pendente = Object.keys(rascunho).length > 0;

  return (
    <div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {ok && <Aviso tom="ok">{ok}</Aviso>}
      {!podeEscrever && (
        <Aviso>Você está vendo os ajustes da sua empresa. Alterar exige perfil de administrador —
          e quem recusa é o servidor, não este aviso.</Aviso>
      )}
      {dados.itens.map((item) => (
        <Campo key={item.chave} item={item}
          valor={item.chave in rascunho ? rascunho[item.chave]
            : (item.tipo === 'segredo' ? '' : item.valor)}
          definido={item.definido}
          somenteLeitura={!podeEscrever}
          onMudar={mudar} />
      ))}
      {podeEscrever && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={salvar} disabled={!pendente || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button className="btn btn-secondary" onClick={carregar} disabled={salvando}>Descartar</button>
        </div>
      )}
    </div>
  );
}

/** Lista de empresas do SaaS — leitura. O cadastro segue na tela de Empresas, que tem 2FA. */
function ListaDeEmpresas() {
  const [estado, setEstado] = useState({ carregando: true });
  useEffect(() => {
    lerEmpresasDoSaas()
      .then((r) => setEstado({ itens: r?.data || r?.itens || r || [] }))
      .catch((e) => setEstado({ erro: e.message }));
  }, []);
  if (estado.erro) return <Aviso tom="erro">{estado.erro}</Aviso>;
  if (estado.carregando) return <p style={{ color: 'var(--text-secondary)' }}>Carregando…</p>;
  const itens = Array.isArray(estado.itens) ? estado.itens : [];
  return (
    <div>
      <Aviso>Leitura. O cadastro, a troca de plano e a exclusão ficam na tela <strong>Empresas</strong>,
        que exige verificação em duas etapas — de propósito: dois caminhos para o mesmo ato é um
        caminho a mais onde a trava pode ficar para trás.</Aviso>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
        <thead><tr style={{ textAlign: 'left' }}>
          <th style={{ padding: 6 }}>Empresa</th><th style={{ padding: 6 }}>Plano</th>
          <th style={{ padding: 6 }}>Situação</th><th style={{ padding: 6 }}>Contato</th>
        </tr></thead>
        <tbody>
          {itens.map((t) => (
            <tr key={t.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
              <td style={{ padding: 6 }}>{t.name}</td>
              <td style={{ padding: 6 }}>{t.plan}</td>
              <td style={{ padding: 6 }}>{t.status}</td>
              <td style={{ padding: 6 }}>{t.contactEmail}</td>
            </tr>
          ))}
          {itens.length === 0 && <tr><td colSpan={4} style={{ padding: 10, color: 'var(--text-secondary)' }}>Nenhuma empresa cadastrada.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Lista de planos comerciais — leitura. A escrita segue em Cobrança. */
function ListaDePlanos() {
  const [estado, setEstado] = useState({ carregando: true });
  useEffect(() => {
    lerPlanosDoSaas()
      .then((r) => setEstado({ itens: r?.itens || [] }))
      .catch((e) => setEstado({ erro: e.message }));
  }, []);
  if (estado.erro) return <Aviso tom="erro">{estado.erro}</Aviso>;
  if (estado.carregando) return <p style={{ color: 'var(--text-secondary)' }}>Carregando…</p>;
  return (
    <div>
      <Aviso>Leitura. Criar e editar plano fica na cobrança, que exige super usuário — é o que
        mexe em dinheiro.</Aviso>
      <ul style={{ paddingLeft: '1.1rem' }}>
        {estado.itens.map((p) => (
          <li key={p.id} style={{ marginBottom: 6 }}>
            <strong>{p.nome || p.name}</strong>
            {p.valorCentavos != null && <> — R$ {(p.valorCentavos / 100).toFixed(2)}</>}
          </li>
        ))}
        {estado.itens.length === 0 && <li style={{ color: 'var(--text-secondary)' }}>Nenhum plano cadastrado.</li>}
      </ul>
    </div>
  );
}

export default function Configuracoes() {
  const [eu, setEu] = useState(null);
  const [erro, setErro] = useState(null);
  const [aba, setAba] = useState(null);
  const [pendentes, setPendentes] = useState([]);

  useEffect(() => {
    quemSou().then((r) => {
      setEu(r);
      setAba((a) => a || r.paineis[0]?.id || null);
    }).catch((e) => setErro(e.message));
    lerPendentesDeDecisao().then((r) => setPendentes(r.itens || [])).catch(() => setPendentes([]));
  }, []);

  const abas = useMemo(() => {
    if (!eu) return [];
    const doServidor = eu.paineis.map((p) => ({ id: p.id, rotulo: p.rotulo, doc: p.doc }));
    // ⛔ As abas do operador só entram porque o SERVIDOR disse que esta conta é a operadora.
    return eu.operadorDoSaas ? [...doServidor, ...ABAS_DO_OPERADOR] : doServidor;
  }, [eu]);

  if (erro) return <div style={{ padding: 'var(--space-xl)' }}><Aviso tom="erro">{erro}</Aviso></div>;
  if (!eu) return <div style={{ padding: 'var(--space-xl)' }}>Carregando…</div>;

  const pendentesDaAba = pendentes.filter((p) => p.painel === aba);

  return (
    <div>
      <CapaSecao
        secao="administracao"
        olho="Ragnabot · Configurações"
        titulo="Configurações"
        apoio="Como o atendimento se comporta na sua empresa: saudação, histórico, horários, avaliações, mensagens automáticas, integrações e IA."
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '16px 0' }}>
        {abas.map((a) => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={aba === a.id ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: '.85rem' }}>{a.rotulo}</button>
        ))}
      </div>

      {!eu.operadorDoSaas && eu.paineisOcultos.length > 0 && (
        <Aviso>
          Os painéis de <strong>marca do sistema, empresas e planos</strong> são da conta que opera
          o serviço. Eles não aparecem aqui — e a conta também não os alcança pela API.
        </Aviso>
      )}

      {pendentesDaAba.length > 0 && (
        <Aviso>
          <strong>Depende de decisão do dono:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: '1.1rem' }}>
            {pendentesDaAba.map((p) => <li key={p.id}>{p.rotulo} — {p.pergunta}</li>)}
          </ul>
        </Aviso>
      )}

      {aba === '_empresas' ? <ListaDeEmpresas />
        : aba === '_planos' ? <ListaDePlanos />
          : aba ? <PainelDeAjustes painel={aba} podeEscrever={eu.podeEscrever} />
            : null}
    </div>
  );
}
