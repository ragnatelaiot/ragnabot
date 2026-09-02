// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESPOSTAS RÁPIDAS — a tela (contrato S1, 02/09/2026 · doc 34 §F1.3)
//
// ⚠️ ESTA TELA NÃO CONSTRÓI FUNCIONALIDADE NENHUMA. O recurso existe inteiro desde o contrato C9:
// `services/ragnabot-respostas-rapidas.service.js` decide o que é atalho válido, qual resposta
// ganha o desempate, quais são as onze variáveis e como o texto expande; `routes/…routes.js` isola
// por empresa, audita e traduz erro em HTTP. Os dois estão montados em `servidor.js`. O doc 34
// mediu e escreveu: «Respostas rápidas com conceito pessoal × global — não tem tela nenhuma».
// É só isso que este arquivo faz: dar tela ao que já roda.
//
// ── O QUE EU FUI BUSCAR NO CHAT ATUAL (regra de método do doc 34) ───────────────────────────────
// A forma da tela espelha o que o dono já conhece: uma lista com o atalho em destaque, o escopo
// dito em uma palavra («Só eu» / «Todos») e o texto começando à vista. O vocabulário do formulário
// é o do chat atual, não o do banco: o operador escolhe entre «Só eu» e «Todos»; quem traduz para
// `visibilidade: 'pessoal' | 'empresa'` é a camada de rede.
//
// ── ⛔ DUAS COISAS QUE O CONTRATO PEDIU E QUE EU **NÃO** ENTREGUEI, E O MOTIVO ───────────────────
//   1. **N mensagens por atalho.** O modelo tem UM campo `mensagem String` (schema.prisma linha
//      1422). Uma resposta com várias mensagens exige coluna nova (ou tabela filha) — migração, e
//      migração neste repositório é caminho longo de propósito (as três chaves compostas proíbem
//      `prisma db push`; o certo é `migrate diff` → recortar todo `DROP` → `db execute` →
//      versionar o SQL). Inventar aqui um separador de texto que o servidor não conhece seria pior
//      que não ter: o motor mandaria o separador cru para o cliente.
//   2. **Anexo.** Não há coluna, não há upload, e não há balde definido para isto (a memória da
//      casa registra que anexo do Ragnabot precisa de chave por empresa/ano/mês/dia — decisão que
//      não é desta tela). Fingir um botão de anexo que não anexa é pior que a ausência.
//   As duas ficam DITAS na tela, para quem vier do chat atual não achar que sumiram.
//
// ── O QUE ESTA TELA É, DO PONTO DE VISTA DE TESTE ───────────────────────────────────────────────
// `ListaDeRespostas`, `LinhaDeResposta` e `FormularioDeResposta` são PUROS: recebem tudo por
// propriedade, não buscam nada, não chamam a rede. É o que permite medi-los com `renderToString`
// em `tests/respostas-rapidas.smoke.mjs`, sem navegador e sem servidor. Só o componente de baixo
// (`RespostasRapidas`) conversa com a rede.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, Zap } from 'lucide-react';

import CapaSecao from '../componentes/CapaSecao.jsx';
// ⚠️ Os tijolos visuais moram em `EmpresaFormulario.jsx` porque foi lá que nasceram (contrato
// S4-EMPRESAS). Reusar é a regra da casa — «não reescreva o que já existe, estenda». Quando houver
// uma terceira tela usando-os, eles mudam para `componentes/tijolos.jsx`; mover agora, com duas,
// seria refatoração sem cliente.
import {
  Campo, ErroDoServidor, Etiqueta, Faixa, Modal, Rotulo, T, Vazio, campoEstilo, cartao,
} from './EmpresaFormulario.jsx';
import { atorAtual } from '../lib/api.js';
import {
  ErroDeValidacao, LIMITES, VISIBILIDADES,
  alternarAtiva, atalhoExibido, conferirFormulario, criarResposta, editarResposta, lerOpcoes,
  lerRespostas, podeEscreverDaEmpresa, podeMexerNesta, preverAtalho, preverTexto, removerResposta,
} from '../lib/api-respostas-rapidas.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 0. VOCABULÁRIO DA TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const ESCOPOS = {
  empresa: { rotulo: 'Todos', tom: 'info', ajuda: 'Toda a equipe da empresa usa este atalho.' },
  pessoal: { rotulo: 'Só eu', tom: 'neutro', ajuda: 'Fica na sua gaveta; ninguém mais vê.' },
};

export const FORMULARIO_VAZIO = Object.freeze({
  atalho: '', titulo: '', mensagem: '', visibilidade: 'empresa', ativa: true,
});

/** Corta o texto para a prévia da lista sem cortar palavra no meio — texto picado no meio da
 *  palavra parece defeito de renderização e manda o operador conferir o cadastro à toa. */
export function resumir(texto, teto = 160) {
  const t = String(texto ?? '').replace(/\s+/gu, ' ').trim();
  if (t.length <= teto) return t;
  const corte = t.slice(0, teto);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > teto * 0.6 ? corte.slice(0, espaco) : corte)}…`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. UMA LINHA DA LISTA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export function LinhaDeResposta({ resposta, ator, aoEditar = () => {}, aoAlternar = () => {}, aoRemover = () => {} }) {
  const escopo = ESCOPOS[resposta.visibilidade] || ESCOPOS.empresa;
  const posso = podeMexerNesta(ator, resposta);
  return (
    <div style={{ ...cartao, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code style={{
          background: T.entrada, border: `1px solid ${T.campo}`, borderRadius: 6,
          padding: '2px 8px', fontSize: '0.86rem', fontWeight: 700, color: T.primaria,
        }}>{resposta.atalhoExibido || atalhoExibido(resposta.atalho)}</code>
        <strong style={{ fontSize: '0.9rem' }}>{resposta.titulo}</strong>
        <Etiqueta tom={escopo.tom} titulo={escopo.ajuda}>{escopo.rotulo}</Etiqueta>
        {/* «Desligada» é etiqueta, e não linha apagada: resposta desligada continua existindo e
            continua trancando o atalho no índice único. Escondê-la faria o operador tentar
            cadastrar de novo e levar «já existe» sem entender de onde. */}
        {resposta.ativa === false ? <Etiqueta tom="aviso">Desligada</Etiqueta> : null}
      </div>

      <p style={{ color: T.sec, fontSize: '0.82rem', margin: 0, whiteSpace: 'pre-wrap' }}>
        {resumir(resposta.mensagem)}
      </p>

      {Array.isArray(resposta.variaveis) && resposta.variaveis.length ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {resposta.variaveis.map((v) => <Etiqueta key={v} tom="neutro">{`{{${v}}}`}</Etiqueta>)}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" disabled={!posso}
          title={posso ? undefined : 'Esta resposta é da empresa (ou de outro atendente) — quem decide isso é o servidor.'}
          onClick={() => aoEditar(resposta)}>Editar</button>
        <button type="button" className="btn btn-secondary" disabled={!posso}
          onClick={() => aoAlternar(resposta)}>
          {resposta.ativa === false ? 'Ligar' : 'Desligar'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!posso}
          onClick={() => aoRemover(resposta)}>
          <Trash2 size={14} /> Excluir
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A LISTA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export function ListaDeRespostas({
  respostas = [], busca = '', ator = {}, carregando = false,
  aoCriar = () => {}, aoEditar = () => {}, aoAlternar = () => {}, aoRemover = () => {},
}) {
  if (carregando && !respostas.length) return <Vazio>Consultando as respostas rápidas…</Vazio>;

  if (!respostas.length) {
    // ⚠️ VAZIO DE BUSCA E VAZIO DE CADASTRO DIZEM COISAS DIFERENTES, e confundir os dois é como se
    // faz alguém achar que perdeu dados: «nenhuma cadastrada» com um filtro ligado é mentira.
    return busca ? (
      <Vazio>Nenhuma resposta rápida casa com «{busca}». Limpe a busca para ver todas.</Vazio>
    ) : (
      <Vazio>
        <div style={{ marginBottom: 8 }}>
          Nenhuma resposta rápida cadastrada ainda — e isto é vazio de verdade, não falha de
          carregamento.
        </div>
        <button type="button" className="btn btn-primary" onClick={aoCriar}>
          <Plus size={15} /> Cadastrar a primeira
        </button>
      </Vazio>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {respostas.map((r) => (
        <LinhaDeResposta key={r.id} resposta={r} ator={ator}
          aoEditar={aoEditar} aoAlternar={aoAlternar} aoRemover={aoRemover} />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. O FORMULÁRIO — puro: recebe tudo por propriedade e não fala com ninguém
// ────────────────────────────────────────────────────────────────────────────────────────────────
export function FormularioDeResposta({
  valores, aoMudar, erros = {}, ator = {}, variaveis = [], aoInserirVariavel = null,
  refDaMensagem = null,
}) {
  const podeEmpresa = podeEscreverDaEmpresa(ator);
  const previa = preverAtalho(valores.atalho);
  const usados = String(valores.mensagem ?? '').length;

  return (
    <div>
      <Campo
        rotulo="Atalho"
        dica={previa.ok ? `o atendente digita ${atalhoExibido(previa.valor)}` : 'ex.: /bomdia'}
        valor={valores.atalho}
        aoMudar={(v) => aoMudar({ ...valores, atalho: v })}
        erro={erros.atalho}
        maxLength={LIMITES.atalho + 8}
        placeholder="/bomdia"
      />

      <Campo
        rotulo="Nome"
        dica={`para você achar na lista · ${String(valores.titulo ?? '').length}/${LIMITES.titulo}`}
        valor={valores.titulo}
        aoMudar={(v) => aoMudar({ ...valores, titulo: v })}
        erro={erros.titulo}
        maxLength={LIMITES.titulo}
        placeholder="Saudação de bom dia"
      />

      {/* ── ESCOPO ────────────────────────────────────────────────────────────────────────────
          Botão de opção, e não lista suspensa: são duas escolhas e a diferença entre elas importa
          (uma publica para a empresa inteira). Escolha importante escondida atrás de um clique é
          escolha que se faz sem ler. */}
      <div style={{ marginBottom: 12 }}>
        <Rotulo dica="quem enxerga este atalho">Escopo</Rotulo>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {VISIBILIDADES.map((v) => {
            const bloqueado = v.valor === 'empresa' && !podeEmpresa;
            const marcado = (valores.visibilidade ?? 'empresa') === v.valor;
            return (
              <label key={v.valor} style={{
                flex: '1 1 180px', display: 'flex', gap: 8, alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 8, cursor: bloqueado ? 'not-allowed' : 'pointer',
                background: marcado ? 'var(--bg-elevated)' : T.entrada,
                border: `1px solid ${marcado ? T.primaria : T.campo}`,
                opacity: bloqueado ? 0.55 : 1,
              }}>
                <input type="radio" name="rb-escopo" value={v.valor} checked={marcado} disabled={bloqueado}
                  onChange={() => aoMudar({ ...valores, visibilidade: v.valor })} style={{ marginTop: 3 }} />
                <span>
                  <b style={{ fontSize: '0.86rem' }}>{v.rotulo}</b>
                  <span style={{ display: 'block', fontSize: '0.74rem', color: T.mut }}>{v.apoio}</span>
                </span>
              </label>
            );
          })}
        </div>
        {!podeEmpresa && (
          // Dito, e não escondido: o botão desligado sem explicação vira chamado de suporte.
          <div style={{ marginTop: 6, fontSize: '0.75rem', color: T.mut }}>
            Publicar para toda a empresa é do administrador — a sua fica como «Só eu». Quem recusa
            isto é o servidor, não este aviso.
          </div>
        )}
        {erros.visibilidade ? <div style={{ marginTop: 4, fontSize: '0.75rem', color: T.perigo }}>{erros.visibilidade}</div> : null}
      </div>

      {/* ── MENSAGEM ─────────────────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 12 }}>
        <Rotulo dica={`${usados}/${LIMITES.mensagem} caracteres`}>Mensagem</Rotulo>
        <textarea
          ref={refDaMensagem}
          value={valores.mensagem ?? ''}
          onChange={(ev) => aoMudar({ ...valores, mensagem: ev.target.value })}
          rows={7}
          maxLength={LIMITES.mensagem}
          aria-invalid={erros.mensagem ? 'true' : undefined}
          placeholder="{{greeting}}, {{contactFirstName}}! Aqui é a {{empresa}}. Como posso ajudar?"
          style={{ ...campoEstilo, minHeight: 150, resize: 'vertical', fontFamily: 'var(--font-family)', lineHeight: 1.5,
            borderColor: erros.mensagem ? T.perigo : T.campo }}
        />
        {erros.mensagem ? <div style={{ marginTop: 4, fontSize: '0.75rem', color: T.perigo }}>{erros.mensagem}</div> : null}

        {variaveis.length ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: '0.72rem', color: T.mut, marginBottom: 4 }}>
              Clique para inserir — o motor troca pelo valor da conversa na hora do envio:
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {variaveis.map((v) => (
                <button key={v.nome} type="button" className="btn btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '0.72rem', minHeight: 0 }}
                  title={`${v.rotulo} — ex.: ${v.exemplo}`}
                  onClick={() => (aoInserirVariavel
                    ? aoInserirVariavel(v.nome)
                    : aoMudar({ ...valores, mensagem: `${valores.mensagem ?? ''}{{${v.nome}}}` }))}>
                  {`{{${v.nome}}}`}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.82rem', color: T.sec }}>
        <input type="checkbox" checked={valores.ativa !== false}
          onChange={(ev) => aoMudar({ ...valores, ativa: ev.target.checked })} />
        Ligada — o atendente consegue acionar por atalho
      </label>

      {/* A lacuna dita em voz alta. Ver o cabeçalho do arquivo. */}
      <div style={{ marginTop: 12, fontSize: '0.74rem', color: T.mut, borderTop: `1px solid ${T.borda}`, paddingTop: 8 }}>
        Uma resposta rápida guarda <b>uma</b> mensagem e ainda não aceita anexo. Várias mensagens e
        arquivo exigem mudança no banco — está registrado no plano, e não foi feito por conta própria.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. A PÁGINA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export default function RespostasRapidas() {
  const ator = atorAtual();

  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [recado, setRecado] = useState(null);

  const [busca, setBusca] = useState('');
  const [filtroEscopo, setFiltroEscopo] = useState('');
  const [incluirInativas, setIncluirInativas] = useState(false);

  const [opcoes, setOpcoes] = useState({ variaveis: [] });
  const [editando, setEditando] = useState(null);      // {modo:'novo'|'edicao', id, valores}
  const [errosDoForm, setErrosDoForm] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [previa, setPrevia] = useState(null);
  const [aRemover, setARemover] = useState(null);
  const refMensagem = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await lerRespostas({ busca, visibilidade: filtroEscopo, incluirInativas });
      setItens(Array.isArray(r.itens) ? r.itens : []);
    } catch (e) {
      setErro(e);
      setItens([]);
    } finally {
      setCarregando(false);
    }
  }, [busca, filtroEscopo, incluirInativas]);

  // A busca espera a pessoa parar de digitar. Sem o respiro, cada tecla vira um pedido — e a
  // resposta de uma tecla antiga pode chegar depois da nova e sobrescrever a lista certa.
  useEffect(() => {
    const id = setTimeout(() => { carregar(); }, busca ? 300 : 0);
    return () => clearTimeout(id);
  }, [carregar, busca]);

  // O vocabulário (variáveis, limites) vem do servidor UMA vez. Duas listas iguais em dois lugares
  // divergem no primeiro valor novo, e quem descobre é o usuário.
  useEffect(() => {
    lerOpcoes().then(setOpcoes).catch(() => { /* a tela funciona sem os atalhos de variável */ });
  }, []);

  const abrirNovo = () => {
    // Quem não pode publicar para a empresa começa em «Só eu» — não adianta abrir o formulário já
    // numa escolha que o servidor vai recusar.
    const visibilidade = podeEscreverDaEmpresa(ator) ? 'empresa' : 'pessoal';
    setErrosDoForm({});
    setPrevia(null);
    setEditando({ modo: 'novo', id: null, valores: { ...FORMULARIO_VAZIO, visibilidade } });
  };

  const abrirEdicao = (r) => {
    setErrosDoForm({});
    setPrevia(null);
    setEditando({
      modo: 'edicao',
      id: r.id,
      valores: {
        atalho: r.atalhoExibido || atalhoExibido(r.atalho),
        titulo: r.titulo, mensagem: r.mensagem,
        visibilidade: r.visibilidade, ativa: r.ativa !== false,
      },
    });
  };

  const inserirVariavel = (nome) => {
    setEditando((atual) => {
      if (!atual) return atual;
      const campo = refMensagem.current;
      const texto = String(atual.valores.mensagem ?? '');
      const marca = `{{${nome}}}`;
      // Insere ONDE O CURSOR ESTÁ. Emendar sempre no fim obrigaria a recortar e colar toda vez que
      // a variável for no meio da frase — que é o caso normal («Olá, {{nome}}, tudo bem?»).
      const i = campo && typeof campo.selectionStart === 'number' ? campo.selectionStart : texto.length;
      const j = campo && typeof campo.selectionEnd === 'number' ? campo.selectionEnd : i;
      const novo = texto.slice(0, i) + marca + texto.slice(j);
      if (campo) {
        requestAnimationFrame(() => {
          campo.focus();
          const pos = i + marca.length;
          campo.setSelectionRange(pos, pos);
        });
      }
      return { ...atual, valores: { ...atual.valores, mensagem: novo } };
    });
  };

  const salvar = async () => {
    if (!editando) return;
    const problemas = conferirFormulario(editando.valores);
    setErrosDoForm(problemas);
    if (Object.keys(problemas).length) return;

    setSalvando(true);
    setErro(null);
    try {
      if (editando.modo === 'novo') await criarResposta(editando.valores);
      else await editarResposta(editando.id, editando.valores);
      setEditando(null);
      setRecado({ tom: 'ok', texto: editando.modo === 'novo' ? 'Resposta rápida criada.' : 'Resposta rápida alterada.' });
      await carregar();
    } catch (e) {
      if (e instanceof ErroDeValidacao) setErrosDoForm(e.erros);
      else setErro(e);
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (r) => {
    setErro(null);
    try {
      await alternarAtiva(r.id, r.ativa === false);
      await carregar();
    } catch (e) { setErro(e); }
  };

  const remover = async () => {
    if (!aRemover) return;
    setSalvando(true);
    setErro(null);
    try {
      await removerResposta(aRemover.id);
      setARemover(null);
      setRecado({ tom: 'ok', texto: `Resposta ${atalhoExibido(aRemover.atalho)} removida.` });
      await carregar();
    } catch (e) { setErro(e); }
    finally { setSalvando(false); }
  };

  const verPrevia = async () => {
    if (!editando) return;
    try {
      const r = await preverTexto(editando.valores.mensagem || '');
      setPrevia(r);
    } catch (e) { setErro(e); }
  };

  // A contagem por escopo é do que está NA TELA — o servidor já aplicou o filtro, e recontar aqui
  // com outra regra daria dois números diferentes para a mesma coisa.
  const contagem = useMemo(() => ({
    total: itens.length,
    empresa: itens.filter((i) => i.visibilidade === 'empresa').length,
    pessoal: itens.filter((i) => i.visibilidade === 'pessoal').length,
  }), [itens]);

  const modeloAusente = erro?.code === 'MODELO_AUSENTE';

  return (
    <div>
      <CapaSecao
        secao="clientes"
        olho="Atendimento"
        titulo="Respostas rápidas"
        apoio="Os atalhos de texto que a equipe repete o dia inteiro. O atendente digita /bomdia na conversa e o texto sai pronto, já com o nome do cliente e o protocolo trocados."
        acoes={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => carregar()} disabled={carregando}>
              {carregando ? 'Consultando…' : 'Atualizar'}
            </button>
            <button type="button" className="btn btn-primary" onClick={abrirNovo}>
              <Plus size={15} /> Nova resposta
            </button>
          </div>
        )}
      />

      <div style={{ display: 'grid', gap: 12 }}>
        {recado ? <Faixa tom={recado.tom === 'ok' ? 'ok' : 'info'}>{recado.texto}</Faixa> : null}

        {modeloAusente ? (
          <Faixa tom="aviso" titulo="A tabela ainda não está disponível neste processo">
            {erro.message}
          </Faixa>
        ) : <ErroDoServidor erro={erro} />}

        {/* ── Filtros ─────────────────────────────────────────────────────────────────────── */}
        <div style={{ ...cartao, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 240px' }}>
            <Search size={15} style={{ color: T.mut, flexShrink: 0 }} />
            <input
              type="search"
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Procurar por atalho ou nome"
              aria-label="Procurar resposta rápida"
              style={{ ...campoEstilo, minHeight: 36 }}
            />
          </label>

          <select value={filtroEscopo} onChange={(ev) => setFiltroEscopo(ev.target.value)}
            aria-label="Filtrar por escopo"
            style={{ ...campoEstilo, minHeight: 36, width: 'auto', minWidth: 150 }}>
            <option value="">Todos os escopos</option>
            <option value="empresa">Da empresa</option>
            <option value="pessoal">Só minhas</option>
          </select>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', color: T.sec }}>
            <input type="checkbox" checked={incluirInativas} onChange={(ev) => setIncluirInativas(ev.target.checked)} />
            Mostrar desligadas
          </label>

          <span style={{ marginLeft: 'auto', fontSize: '0.76rem', color: T.mut }}>
            <Zap size={13} style={{ verticalAlign: '-2px' }} /> {contagem.total} na lista
            {contagem.total ? ` · ${contagem.empresa} da empresa · ${contagem.pessoal} só minhas` : ''}
          </span>
        </div>

        <ListaDeRespostas
          respostas={itens} busca={busca} ator={ator} carregando={carregando}
          aoCriar={abrirNovo} aoEditar={abrirEdicao} aoAlternar={alternar} aoRemover={setARemover}
        />
      </div>

      {/* ⚠️ As modais ficam na RAIZ da página, fora de qualquer bloco condicional de aba — mesma
          regra escrita no editor de fluxo, e pelo mesmo defeito: dentro de um `{x && …}` a modal
          desmonta no mesmo ciclo em que deveria aparecer. */}
      <Modal
        aberta={Boolean(editando)}
        titulo={editando?.modo === 'edicao' ? 'Editar resposta rápida' : 'Nova resposta rápida'}
        aoFechar={() => { setEditando(null); setPrevia(null); }}
        largura={620}
        rodape={(
          <>
            <button type="button" className="btn btn-secondary" onClick={verPrevia} disabled={salvando}>
              Ver como fica
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditando(null)} disabled={salvando}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando}
              aria-busy={salvando ? 'true' : 'false'}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </>
        )}
      >
        {editando ? (
          <>
            <FormularioDeResposta
              valores={editando.valores}
              aoMudar={(v) => setEditando({ ...editando, valores: v })}
              erros={errosDoForm}
              ator={ator}
              variaveis={opcoes.variaveis || []}
              aoInserirVariavel={inserirVariavel}
              refDaMensagem={refMensagem}
            />
            {previa ? (
              <div style={{ marginTop: 12 }}>
                <Faixa tom="info" titulo="Como o cliente vai receber">
                  <div style={{ whiteSpace: 'pre-wrap', color: T.ink }}>{previa.texto}</div>
                  {previa.desconhecidas?.length ? (
                    <div style={{ marginTop: 6, color: T.aviso }}>
                      Não conheço {previa.desconhecidas.map((v) => `{{${v}}}`).join(', ')} — isso vai
                      sair vazio na mensagem.
                    </div>
                  ) : null}
                </Faixa>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        aberta={Boolean(aRemover)}
        titulo="Excluir resposta rápida"
        aoFechar={() => setARemover(null)}
        largura={460}
        rodape={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setARemover(null)} disabled={salvando}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={remover} disabled={salvando}>
              {salvando ? 'Excluindo…' : 'Excluir'}
            </button>
          </>
        )}
      >
        {aRemover ? (
          <p style={{ fontSize: '0.86rem', color: T.sec }}>
            A resposta <b>{aRemover.atalhoExibido || atalhoExibido(aRemover.atalho)}</b> («{aRemover.titulo}»)
            some da lista de todo mundo que a enxergava. O registro fica na auditoria.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
