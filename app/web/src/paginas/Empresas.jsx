// ════════════════════════════════════════════════════════════════════════════════════════════════
// CADASTRO DE EMPRESAS — a tela que nunca existiu (contrato S4-EMPRESAS, 30/08/2026)
//
// Cobrança do dono, hoje: «ainda não vi tela para criar empresas». A API de multiempresa existe e
// funciona desde 28/08 — o chefe criou a primeira empresa por ela. Só que sem tela, "cadastrar
// empresa" quer dizer "pedir para o Claude cadastrar", e isso não é produto.
// E vale a ordem geral: «nada fica no NOC, absolutamente nada». A tela nasce AQUI.
//
// ── COMO ESTA TELA CONVERSA COM O SERVIDOR (o que dói, e por quê) ───────────────────────────────
// A API de empresas usa envelope (`{success,data}`) e um APERTO DE MÃO DE DUAS ETAPAS para tudo
// que muda o mundo: o primeiro pedido, sem código, volta 200 com `needs2fa`; o segundo, com código
// e justificativa, executa. Quem tratar "200 = deu certo" mostra «empresa criada» sem ter criado
// nada. Por isso a camada de rede (`lib/api-empresas.js`) devolve `precisaDe2fa` como CAMPO, e a
// modal de ação abaixo tem duas etapas visíveis: preparar → confirmar com o código.
//
// ── ⚠️ TRÊS DEFEITOS DO LADO DO SERVIDOR, MEDIDOS EM 30/08/2026 ─────────────────────────────────
// Montei `routes/ragnabot-tenant.routes.js` num Express de teste e bati nas rotas. O que respondeu:
//   1. ator com papel «admin» (que é o que o cookie da plataforma dá) → **500** em TODAS as rotas:
//      o guarda do router importa `services/device.service.js`, que ficou no NOC (doc 33 §8);
//   2. `POST /tenants` sem código → **400 "Cannot read properties of undefined (reading
//      'findUnique')"**: o passo de 2FA procura `prisma.user`, tabela do NOC que não existe na base
//      do Ragnabot;
//   3. `POST /tenants` com código → **400 "Cannot find module …/otp.service.js"** — o serviço do
//      segundo fator também ficou no NOC.
// Ou seja: HOJE a leitura funciona (com papel de super) e NENHUMA escrita funciona. A tela está
// escrita para o contrato CERTO da API e mostra o diagnóstico exato quando esbarra nisso, em vez
// de dizer "erro 500". Quando as três peças mudarem de casa, esta tela funciona sem tocar em nada.
//
// ── O QUE ESTA TELA NÃO FAZ ─────────────────────────────────────────────────────────────────────
// Não cria caixa de entrada nem convida atendente (a API tem as rotas; são outra tela, e caixa de
// WhatsApp ainda não existe nenhuma no ambiente). Não edita `limitesOverride` nem `retencaoDias` —
// contrato negociado não se digita numa caixinha sem revisão.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Search, ShieldAlert } from 'lucide-react';
import CapaSecao from '../componentes/CapaSecao.jsx';
import {
  Campo, ErroDoServidor, Etiqueta, Faixa, Modal, ModalDeNovaEmpresa, Rotulo, Selecao, T, Vazio,
  campoEstilo, cartao, grade,
} from './EmpresaFormulario.jsx';
import {
  alterarPlano, confirmacaoConfere, criarEmpresa, diagnosticar, encerrarEmpresa,
  excluirDefinitivamente, lerEmpresas, lerPlanos, lerSaude, linkDeAcesso, pedirCodigo,
  reativarEmpresa, suspenderEmpresa,
} from '../lib/api-empresas.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 0. VOCABULÁRIO
// Os cinco estados vêm do schema (`RagnabotTenant.status`). `past_due` existe e é da cobrança —
// aparece aqui porque um estado que a tela não sabe desenhar vira selo em branco na hora errada.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const SITUACOES = {
  trial:     { rotulo: 'Em teste',      tom: 'info',   ajuda: 'Período de avaliação em curso.' },
  active:    { rotulo: 'Ativa',         tom: 'ok',     ajuda: 'Contrato vigente.' },
  past_due:  { rotulo: 'Em atraso',     tom: 'aviso',  ajuda: 'Cobrança vencida — o acesso ainda está de pé.' },
  suspended: { rotulo: 'Suspensa',      tom: 'aviso',  ajuda: 'Ninguém do cliente consegue entrar; os dados estão intactos.' },
  closed:    { rotulo: 'Encerrada',     tom: 'erro',   ajuda: 'Contrato encerrado. Os dados continuam guardados até a exclusão definitiva.' },
};

export function situacaoDe(status) {
  return SITUACOES[status] || { rotulo: status || 'desconhecida', tom: 'neutro', ajuda: 'Estado não previsto por esta tela.' };
}

const fmtData = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return String(v); }
};

const fmtCnpj = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14) return v || null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. O CARTÃO DA EMPRESA — puro: recebe tudo por props e só emite eventos.
//    É o que permite provar a listagem num teste sem navegador e sem servidor.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export function CartaoDeEmpresa({ empresa, ehSuperusuario, aoAgir }) {
  const s = situacaoDe(empresa.status);
  const excluida = !empresa.cwAccountId;

  // Cada botão só aparece quando a ação é POSSÍVEL, e a regra é a MESMA do servidor:
  //   · reativar só de `suspended` (`reativarEmpresa` recusa qualquer outro estado);
  //   · excluir definitivamente só de `closed` (`excluirDefinitivamente` recusa antes de tudo).
  // Botão que existe para dar erro é botão que ensina o operador a desconfiar da tela.
  const podeSuspender = empresa.status !== 'suspended' && empresa.status !== 'closed' && !excluida;
  const podeReativar = empresa.status === 'suspended';
  const podeEncerrar = empresa.status !== 'closed';
  const podeExcluir = empresa.status === 'closed' && !excluida;

  return (
    <div style={{ ...cartao, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: '0.95rem', flex: 1, minWidth: 0 }}>{empresa.nome}</span>
        <Etiqueta tom={s.tom} titulo={s.ajuda}>{s.rotulo}</Etiqueta>
        {excluida ? <Etiqueta tom="erro" titulo="A conta foi excluída da plataforma; resta o registro comercial.">conta excluída</Etiqueta> : null}
      </div>

      <div style={{ fontSize: '0.78rem', color: T.sec, fontFamily: 'ui-monospace, monospace' }}>{empresa.slug}</div>

      <div style={{ fontSize: '0.74rem', color: T.mut, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>plano: <b style={{ color: T.sec }}>{empresa.planoRotulo || empresa.plano}</b></span>
        <span>conta na plataforma: {empresa.cwAccountId ?? '—'}</span>
        <span>criada em {fmtData(empresa.criadoEm)}</span>
      </div>

      <div style={{ fontSize: '0.74rem', color: T.mut, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>{empresa.contato?.nome || '—'}</span>
        <span>{empresa.contato?.email || '—'}</span>
        {empresa.cnpj ? <span>CNPJ {fmtCnpj(empresa.cnpj)}</span> : null}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap', paddingTop: 4 }}>
        <button className="btn btn-secondary" style={{ minHeight: 38 }} onClick={() => aoAgir('plano', empresa)}>
          Trocar plano
        </button>
        {podeSuspender ? (
          <button className="btn btn-secondary" style={{ minHeight: 38 }} onClick={() => aoAgir('suspender', empresa)}>
            Suspender
          </button>
        ) : null}
        {podeReativar ? (
          <button className="btn btn-primary" style={{ minHeight: 38 }} onClick={() => aoAgir('reativar', empresa)}>
            Reativar
          </button>
        ) : null}
        {ehSuperusuario ? (
          <>
            {podeEncerrar ? (
              <button
                className="btn btn-secondary" style={{ minHeight: 38, color: T.perigo, borderColor: T.perigo }}
                onClick={() => aoAgir('encerrar', empresa)}
              >Encerrar</button>
            ) : null}
            {podeExcluir ? (
              <button
                className="btn btn-secondary" style={{ minHeight: 38, color: T.perigo, borderColor: T.perigo }}
                onClick={() => aoAgir('excluir', empresa)}
              >Excluir definitivamente</button>
            ) : null}
            {!excluida ? (
              <button className="btn btn-secondary" style={{ minHeight: 38 }} onClick={() => aoAgir('sso', empresa)}>
                Abrir painel do cliente
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A LISTA — pura também.
 *
 * ⚠️ A LISTA VAZIA TEM DE DIZER QUE ESTÁ VAZIA. Grade em branco sem uma palavra parece defeito, e
 * quem a vê fica procurando o erro que não existe. E os dois vazios são diferentes: «ainda não há
 * nenhuma» pede o botão de cadastrar; «a busca não achou» pede outra busca.
 */
export function ListaDeEmpresas({ empresas = [], busca = '', ehSuperusuario = false, aoCriar, aoAgir }) {
  if (!empresas.length && busca.trim()) {
    return (
      <div style={cartao}>
        <Vazio>
          Nenhuma empresa casa com <b>“{busca.trim()}”</b>. A busca olha o nome e o identificador.
        </Vazio>
      </div>
    );
  }

  if (!empresas.length) {
    return (
      <div style={cartao}>
        <Vazio>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Building2 size={22} style={{ color: T.mut }} />
            <div>
              <b style={{ color: T.sec }}>Nenhuma empresa cadastrada ainda.</b>
              <div style={{ marginTop: 4 }}>
                A lista está vazia de verdade — não é falha de carregamento. Cadastre a primeira: a
                conta na plataforma, o administrador dela e o contrato são criados de uma vez só.
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => aoCriar && aoCriar()}>
              <Plus size={15} /> Cadastrar a primeira empresa
            </button>
          </div>
        </Vazio>
      </div>
    );
  }

  return (
    <div style={grade(330)}>
      {empresas.map((e) => (
        <CartaoDeEmpresa key={e.id || e.slug} empresa={e} ehSuperusuario={ehSuperusuario} aoAgir={aoAgir} />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A MODAL DE AÇÃO — justificativa, confirmação digitada e o aperto de mão de 2FA
//
// Uma modal só para as cinco ações, e não cinco modais parecidas: o que muda entre elas é TEXTO e
// uma regra, e cinco cópias de um fluxo de dois passos divergem na terceira semana.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export function ModalDeAcao({ acao, planos = [], aoFechar, aoConcluir }) {
  const [justificativa, setJustificativa] = useState('');
  const [slugDigitado, setSlugDigitado] = useState('');
  const [plano, setPlano] = useState('');
  const [etapa, setEtapa] = useState('preparar');   // preparar → codigo
  const [canais, setCanais] = useState(null);
  const [dicaDeEmail, setDicaDeEmail] = useState(null);
  const [canal, setCanal] = useState('email');
  const [codigo, setCodigo] = useState('');
  const [recado, setRecado] = useState(null);
  const [ocupada, setOcupada] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!acao) return;
    setJustificativa(''); setSlugDigitado(''); setPlano(acao.empresa?.plano || '');
    setEtapa('preparar'); setCanais(null); setDicaDeEmail(null); setCanal('email');
    setCodigo(''); setRecado(null); setErro(null); setOcupada(false);
  }, [acao]);

  if (!acao) return null;

  const empresa = acao.empresa || {};
  const slugConfere = !acao.exigeSlugDigitado || confirmacaoConfere(empresa.slug, slugDigitado);
  const prontoParaPreparar = justificativa.trim().length >= 3
    && slugConfere
    && (!acao.exigePlano || (plano && plano !== empresa.plano));

  const executar = async (cred) => {
    setOcupada(true); setErro(null);
    try {
      const r = await acao.executar({
        cred, plano, justificativa: justificativa.trim(), confirmacaoSlug: slugDigitado.trim(),
      });
      if (r.precisaDe2fa) {
        if (cred?.otpCode) {
          // Mandamos o código e o servidor pediu o código de novo: alguma coisa está errada no
          // caminho, e dizer isso é melhor do que ficar num laço mudo.
          setErro(Object.assign(new Error('O servidor pediu o código de novo mesmo com o código enviado — não executei a ação.'), { status: 0 }));
          return;
        }
        setCanais(r.canais || {});
        setDicaDeEmail(r.dicaDeEmail || null);
        setCanal(r.canais?.totp && !r.canais?.email ? 'totp' : 'email');
        setEtapa('codigo');
        return;
      }
      aoConcluir(r.dados, acao);
    } catch (e) {
      setErro(e);
    } finally {
      setOcupada(false);
    }
  };

  const solicitarCodigo = async () => {
    setOcupada(true); setErro(null);
    try {
      const r = await pedirCodigo(canal);
      setRecado(r?.sent ? 'Código enviado para o seu e-mail.' : 'Use o código do seu aplicativo autenticador.');
    } catch (e) { setErro(e); } finally { setOcupada(false); }
  };

  const ajuda = diagnosticar(erro);

  return (
    <Modal
      aberta
      titulo={acao.titulo}
      aoFechar={aoFechar}
      largura={520}
      rodape={
        <>
          <button className="btn btn-secondary" onClick={() => aoFechar()}>Cancelar</button>
          {etapa === 'preparar' ? (
            <button
              className="btn btn-primary" disabled={!prontoParaPreparar || ocupada}
              aria-busy={ocupada ? 'true' : undefined}
              onClick={() => executar(null)}
            >{ocupada ? 'Conferindo…' : 'Continuar'}</button>
          ) : (
            <button
              className="btn btn-primary" disabled={!/^\d{6}$/.test(codigo) || ocupada}
              aria-busy={ocupada ? 'true' : undefined}
              onClick={() => executar({ otpChannel: canal, otpCode: codigo })}
            >{ocupada ? 'Executando…' : acao.rotuloConfirmar}</button>
          )}
        </>
      }
    >
      <Faixa tom={acao.perigoso ? 'erro' : 'aviso'} titulo={acao.perigoso ? 'Isto não tem desfazer' : 'Confira antes'}>
        {acao.explicacao}
      </Faixa>

      <div style={{ height: 12 }} />
      <div style={{ fontSize: '0.82rem', color: T.sec }}>
        Empresa: <b style={{ color: T.ink }}>{empresa.nome}</b>{' '}
        <span style={{ fontFamily: 'ui-monospace, monospace', color: T.mut }}>({empresa.slug})</span>
      </div>
      <div style={{ height: 12 }} />

      {acao.exigePlano ? (
        <Selecao
          rotulo="Novo plano" dica={`hoje: ${empresa.planoRotulo || empresa.plano || '—'}`}
          valor={plano} vazio="" aoMudar={setPlano}
          opcoes={planos.map((p) => ({ valor: p.chave, rotulo: `${p.rotulo || p.chave} — ${p.agentes} atendente(s), ${p.caixas} conexão(ões)` }))}
        />
      ) : null}

      <div style={{ marginBottom: 12 }}>
        <Rotulo dica="obrigatória — vai para a auditoria">Justificativa</Rotulo>
        <textarea
          rows={2} value={justificativa}
          onChange={(ev) => setJustificativa(ev.target.value)}
          placeholder="Por que esta ação está sendo feita agora"
          style={{ ...campoEstilo, resize: 'vertical' }}
        />
      </div>

      {acao.exigeSlugDigitado ? (
        <Campo
          rotulo="Digite o identificador para confirmar"
          dica={`exatamente: ${empresa.slug}`}
          valor={slugDigitado} aoMudar={setSlugDigitado}
          erro={slugDigitado && !slugConfere ? 'O identificador digitado não confere.' : null}
          autoCapitalize="none" spellCheck={false}
        />
      ) : null}

      {etapa === 'codigo' ? (
        <div style={{ borderTop: `1px solid ${T.borda}`, paddingTop: 12, marginTop: 4 }}>
          <Faixa tom="info" titulo="Confirmação em duas etapas">
            O servidor pediu o segundo fator para executar. O código confirma que é você, e a
            justificativa acima já está registrada com o seu nome.
          </Faixa>
          <div style={{ height: 12 }} />
          <Selecao
            rotulo="Onde receber o código" valor={canal} vazio="" aoMudar={setCanal}
            opcoes={[
              ...(canais?.email ? [{ valor: 'email', rotulo: `E-mail${dicaDeEmail ? ` (${dicaDeEmail})` : ''}` }] : []),
              ...(canais?.totp ? [{ valor: 'totp', rotulo: 'Aplicativo autenticador' }] : []),
            ]}
          />
          <button className="btn btn-secondary" disabled={ocupada} onClick={() => solicitarCodigo()}>
            {ocupada ? 'Pedindo…' : 'Pedir o código'}
          </button>
          {recado ? <div style={{ marginTop: 8, fontSize: '0.8rem', color: T.ok }}>{recado}</div> : null}
          <div style={{ height: 12 }} />
          <Campo
            rotulo="Código de seis dígitos" valor={codigo}
            aoMudar={(v) => setCodigo(String(v).replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
          />
        </div>
      ) : null}

      {erro ? (
        <div style={{ marginTop: 12 }}>
          <ErroDoServidor
            erro={erro} ajuda={ajuda}
            titulo={erro.code === 'INVALID_2FA' ? 'Código recusado' : undefined}
          />
        </div>
      ) : null}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. AS AÇÕES — texto e regra de cada uma, num lugar só
// ────────────────────────────────────────────────────────────────────────────────────────────────
function montarAcao(chave, empresa) {
  const comum = { chave, empresa };
  switch (chave) {
    case 'plano':
      return {
        ...comum, titulo: 'Trocar o plano', rotuloConfirmar: 'Trocar plano', exigePlano: true,
        explicacao: 'O limite de atendentes e de conexões muda na hora. Se o plano novo for menor '
          + 'que o uso atual, a empresa não perde nada agora — ela para de conseguir crescer.',
        executar: ({ cred, plano, justificativa }) => alterarPlano(empresa.id, plano, { ...cred, justificativa }),
      };
    case 'suspender':
      return {
        ...comum, titulo: 'Suspender a empresa', rotuloConfirmar: 'Suspender', perigoso: true,
        explicacao: 'Todo mundo do cliente perde o acesso na hora — o servidor remove os vínculos de '
          + 'usuário com a conta. Nada é apagado: conversas, contatos e conexões ficam. Reativar '
          + 'recria os mesmos acessos.',
        executar: ({ cred, justificativa }) => suspenderEmpresa(empresa.id, { ...cred, justificativa }),
      };
    case 'reativar':
      return {
        ...comum, titulo: 'Reativar a empresa', rotuloConfirmar: 'Reativar',
        explicacao: 'Os acessos guardados na suspensão voltam. Se a empresa estava em período de '
          + 'teste, ela volta para «em teste» — e não para «ativa», que encerraria o teste na marra.',
        executar: ({ cred, justificativa }) => reativarEmpresa(empresa.id, { ...cred, justificativa }),
      };
    case 'encerrar':
      return {
        ...comum, titulo: 'Encerrar o contrato', rotuloConfirmar: 'Encerrar contrato',
        perigoso: true, exigeSlugDigitado: true,
        explicacao: 'Encerrar suspende o acesso e marca o contrato como encerrado. Os DADOS '
          + 'CONTINUAM guardados — apagar é um segundo ato, deliberado, depois do prazo de retirada '
          + 'dos dados (LGPD).',
        executar: ({ cred, justificativa, confirmacaoSlug }) =>
          encerrarEmpresa(empresa.id, { slugDaEmpresa: empresa.slug, confirmacaoSlug }, { ...cred, justificativa }),
      };
    case 'excluir':
      return {
        ...comum, titulo: 'Excluir definitivamente', rotuloConfirmar: 'Excluir para sempre',
        perigoso: true, exigeSlugDigitado: true,
        explicacao: 'Apaga a conta da empresa na plataforma e leva junto as conversas e os contatos '
          + 'dos clientes DELA. É irreversível: não há lixeira, não há desfazer. Só o registro '
          + 'comercial permanece aqui.',
        executar: ({ cred, justificativa, confirmacaoSlug }) =>
          excluirDefinitivamente(empresa.id, { slugDaEmpresa: empresa.slug, confirmacaoSlug }, { ...cred, justificativa }),
      };
    case 'sso':
      return {
        ...comum, titulo: 'Abrir o painel do cliente', rotuloConfirmar: 'Gerar link de acesso',
        explicacao: 'Isto é acesso a dado de TERCEIRO. O uso é auditado com o seu nome e o motivo, e '
          + 'avisa o dono no WhatsApp. Não existe uso rotineiro deste link: ou é entrega de '
          + 'provisionamento, ou é suporte pedido pelo cliente.',
        executar: ({ cred, justificativa }) => linkDeAcesso(empresa.id, { ...cred, justificativa }),
      };
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. A PÁGINA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export default function Empresas({ ehSuperusuario = false }) {
  const [empresas, setEmpresas] = useState([]);
  const [planos, setPlanos] = useState([]);
  const [saude, setSaude] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modalCriar, setModalCriar] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState(null);
  const [acao, setAcao] = useState(null);
  const [recado, setRecado] = useState(null);
  const [link, setLink] = useState(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    lerEmpresas(filtroStatus || null)
      .then((r) => {
        // O servidor devolve a lista crua (`listarEmpresas` faz `.map(resumirTenant)`); aceitar
        // também `{itens}` custa uma linha e evita quebrar se o envelope mudar.
        setEmpresas(Array.isArray(r) ? r : (r?.itens || []));
        setErroLista(null);
      })
      // Falha NÃO limpa a lista: fica a última leitura boa, com o problema à vista.
      .catch((e) => setErroLista(e))
      .finally(() => setCarregando(false));
  }, [filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    let vivo = true;
    lerPlanos()
      .then((c) => { if (vivo) setPlanos(Array.isArray(c?.planos) ? c.planos : []); })
      .catch(() => { /* o catálogo ausente aparece no seletor do formulário, não numa faixa a mais */ });
    lerSaude()
      .then((s) => { if (vivo) setSaude(s); })
      .catch(() => { /* a falha real da tela é a da lista; duas faixas dizendo o mesmo viram ruído */ });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!recado) return undefined;
    const t = setTimeout(() => setRecado(null), 9000);
    return () => clearTimeout(t);
  }, [recado]);

  // Busca no cliente: a rota de listagem só filtra por `status`, e são poucas empresas. Se um dia
  // forem centenas, o filtro sobe para o servidor — e aí a tela pede, não inventa.
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return empresas;
    return empresas.filter((e) =>
      String(e.nome || '').toLowerCase().includes(q) || String(e.slug || '').toLowerCase().includes(q));
  }, [empresas, busca]);

  const cadastrar = async (valores) => {
    setCriando(true); setErroCriar(null);
    try {
      const r = await criarEmpresa(valores);
      if (r.precisaDe2fa) {
        // O cadastro também passa pelo portão de 2FA. A modal de ação é quem sabe conduzir os dois
        // passos, então o cadastro é reencaminhado para ela com o corpo já validado.
        setModalCriar(false);
        setAcao({
          chave: 'criar',
          titulo: 'Cadastrar empresa',
          rotuloConfirmar: 'Cadastrar empresa',
          empresa: { nome: valores.nome, slug: valores.slug, plano: valores.plano },
          explicacao: 'Cria a conta na plataforma, o administrador dela e o contrato aqui. Se falhar '
            + 'no meio, o servidor desfaz o que criou.',
          executar: ({ cred, justificativa }) => criarEmpresa(valores, { ...cred, justificativa }),
        });
        return;
      }
      setModalCriar(false);
      setRecado({ tom: 'ok', texto: `Empresa "${r.dados?.nome || valores.nome}" cadastrada.` });
      carregar();
    } catch (e) {
      setErroCriar(e);
    } finally {
      setCriando(false);
    }
  };

  const concluir = (dados, oQueFoi) => {
    setAcao(null);
    if (oQueFoi.chave === 'sso' && dados?.url) {
      setLink(dados.url);
      return;
    }
    const nome = oQueFoi.empresa?.nome || 'a empresa';
    const textos = {
      criar: `Empresa "${nome}" cadastrada.`,
      plano: `Plano de "${nome}" alterado.`,
      suspender: `"${nome}" suspensa. Nada foi apagado.`,
      reativar: `"${nome}" reativada.`,
      encerrar: `Contrato de "${nome}" encerrado. Os dados continuam guardados.`,
      excluir: `Conta de "${nome}" excluída definitivamente da plataforma.`,
    };
    setRecado({ tom: oQueFoi.perigoso ? 'aviso' : 'ok', texto: textos[oQueFoi.chave] || 'Feito.' });
    if (Array.isArray(dados?.avisos) && dados.avisos.length) {
      setRecado({ tom: 'aviso', texto: `${textos[oQueFoi.chave] || 'Feito.'} ${dados.avisos.join(' ')}` });
    }
    carregar();
  };

  const ajudaDaLista = diagnosticar(erroLista);
  const pendencias = Array.isArray(saude?.pendencias) ? saude.pendencias : [];

  return (
    <div>
      <CapaSecao
        secao="clientes"
        olho="Ragnabot · SaaS"
        titulo="Empresas"
        apoio="Cadastre a empresa e o administrador dela de uma vez só, acompanhe plano e situação, e conduza suspensão, reativação e encerramento com registro de quem pediu e por quê."
        acoes={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => carregar()} disabled={carregando}>
              {carregando ? 'Consultando…' : 'Atualizar'}
            </button>
            <button className="btn btn-primary" onClick={() => { setErroCriar(null); setModalCriar(true); }}>
              <Plus size={15} /> Nova empresa
            </button>
          </div>
        }
      />

      <div style={{ display: 'grid', gap: 12 }}>
        {recado ? <Faixa tom={recado.tom}>{recado.texto}</Faixa> : null}

        {pendencias.length ? (
          <Faixa tom="aviso" titulo="A integração com a plataforma não está completa">
            Cadastrar empresa vai falhar enquanto isto não for resolvido:
            <ul style={{ margin: '6px 0 0 18px' }}>
              {pendencias.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </Faixa>
        ) : null}

        {erroLista ? (
          <Faixa tom="erro" titulo="Não consegui ler a lista de empresas">
            {erroLista.message}
            {empresas.length ? ' A lista abaixo é a última leitura boa.' : ''}
            {ajudaDaLista ? (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.borda}`, color: T.mut }}>
                <b style={{ color: T.sec }}>Por que isto acontece: </b>{ajudaDaLista}
              </div>
            ) : null}
          </Faixa>
        ) : null}

        <div style={{ ...cartao, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: T.mut }} />
            <input
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Procurar por nome ou identificador…"
              style={{ ...campoEstilo, paddingLeft: 32 }}
            />
          </div>
          <select value={filtroStatus} onChange={(ev) => setFiltroStatus(ev.target.value)} style={{ ...campoEstilo, width: 200 }}>
            <option value="">Todas as situações</option>
            {Object.entries(SITUACOES).map(([chave, s]) => (
              <option key={chave} value={chave}>{s.rotulo}</option>
            ))}
          </select>
        </div>

        {carregando && !empresas.length ? (
          <div style={{ ...cartao, textAlign: 'center', padding: 40, color: T.mut }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Consultando as empresas…
          </div>
        ) : (
          <ListaDeEmpresas
            empresas={visiveis}
            busca={busca}
            ehSuperusuario={ehSuperusuario}
            aoCriar={() => { setErroCriar(null); setModalCriar(true); }}
            aoAgir={(chave, empresa) => setAcao(montarAcao(chave, empresa))}
          />
        )}
      </div>

      {/* ⚠️ MODAIS NA RAIZ — nunca dentro de um `{condição && …}` de aba ou de lista. Foi assim que,
          em versões anteriores deste projeto, a modal deixava de montar no mesmo ciclo em que
          deveria aparecer. */}
      <ModalDeNovaEmpresa
        aberta={modalCriar}
        planos={planos}
        enviando={criando}
        erro={erroCriar}
        ajuda={diagnosticar(erroCriar)}
        aoFechar={() => setModalCriar(false)}
        aoEnviar={cadastrar}
      />

      <ModalDeAcao
        acao={acao}
        planos={planos}
        aoFechar={() => setAcao(null)}
        aoConcluir={concluir}
      />

      <Modal
        aberta={!!link} titulo="Link de acesso ao painel do cliente" largura={520}
        aoFechar={() => setLink(null)}
        rodape={<button className="btn btn-secondary" onClick={() => setLink(null)}>Fechar</button>}
      >
        <Faixa tom="aviso" titulo="Uso único e curto">
          <ShieldAlert size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          A plataforma invalida este link assim que ele for consumido. O uso já foi registrado com o
          seu nome e o motivo que você escreveu.
        </Faixa>
        <div style={{ height: 12 }} />
        <div style={{
          ...campoEstilo, minHeight: 0, wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace',
          fontSize: '0.76rem',
        }}>{link}</div>
      </Modal>
    </div>
  );
}
