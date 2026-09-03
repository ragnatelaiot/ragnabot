// ════════════════════════════════════════════════════════════════════════════════════════════════
// A TELA DO FORNECEDOR, DENTRO DA NOSSA CASCA (contrato S-CASCA, 02/09/2026 · doc 34, Fase 10)
//
// O DESTINO, dito uma vez: um painel só. A nossa casca por fora, com o menu completo à esquerda; as
// telas que ainda são do fornecedor abrindo AQUI dentro. Conforme substituirmos tela por tela, o
// item de menu perde o campo `embutido` em `lib/navegacao.js` e passa a apontar para a nossa — e o
// menu não muda, a URL não muda, e o usuário não reaprende nada.
//
// ── ⭐ A MEDIÇÃO QUE AUTORIZOU ISTO (02/09/2026, feita ANTES de escrever qualquer linha) ─────────
// Medido de fora, pelo proxy, com `--resolve` (nunca de dentro do NOC, que sofre de hairpin NAT):
//   · `/`, `/app/login` e `/app/accounts/1/dashboard`  →  `X-Frame-Options: SAMEORIGIN`
//   · `Content-Security-Policy` (e portanto `frame-ancestors`)  →  AUSENTE nos três
//   · nenhum «quebra-quadro» nos 24 pacotes JavaScript que a tela do painel carrega
//     (a única ocorrência de `frameElement` é a biblioteca de posicionamento dele, que SABE
//      trabalhar dentro de um quadro — o oposto de barrar)
//   · a sessão dele é um cookie `SameSite=Lax`, e o quadro é da MESMA ORIGEM: o cookie viaja.
// Conclusão: `SAMEORIGIN` PERMITE, porque a nossa casca mora no mesmo host
// (`bot.ragnatela.com.br/painel/`). ⛔ Nada foi desligado no fornecedor para isto caber, e nada
// pode ser: a lei do contrato é explícita.
//
// ⛔ MOVER A CASCA PARA SUBDOMÍNIO PRÓPRIO QUEBRA TUDO ISTO DE UMA VEZ. Se um dia a interface for
// para `painel.ragnatela.com.br`, o `SAMEORIGIN` passa a barrar o quadro e TODAS as telas embutidas
// somem juntas — com o quadro em branco e nenhuma mensagem, porque o navegador barra em silêncio.
// Está escrito também em `lib/navegacao.js`, de propósito, porque é decisão de infraestrutura.
//
// ── ⛔ O QUE ESTA TELA NÃO FAZ, E NÃO PODE PASSAR A FAZER ───────────────────────────────────────
// Ela NÃO injeta script no painel do fornecedor, não reescreve o HTML dele, não substitui função
// dele e não aplica `sandbox` (que quebraria a aplicação dele). O remendo por JavaScript já quebrou
// o painel DUAS VEZES em 31/08/2026. A casca ENVOLVE; ela não remenda.
//
// A ÚNICA coisa que lemos do quadro é `contentWindow.location.pathname`, e só para saber se ele
// acabou parando na tela de entrada dele. É LEITURA, é permitida por serem a mesma origem, está
// dentro de `try/catch`, e o pior caso é não mostrar um aviso. Nada é escrito lá dentro.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { contaAtual } from '../lib/api.js';
import { enderecoEmbutido } from '../lib/navegacao.js';

/**
 * Recado quando não dá para montar o endereço — quase sempre «a sessão ainda não sabe a conta».
 * Tela vazia sem explicação é o que faz a pessoa concluir que o produto quebrou.
 */
function SemEndereco({ rotulo }) {
  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 'var(--peso-titulo)' }}>{rotulo}</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
        Esta tela ainda é do painel de atendimento e precisa saber em qual empresa você está — e a
        sua sessão não trouxe essa informação. Saia e entre de novo; se continuar, avise o suporte
        da Ragnatela, porque o problema é do cadastro da conta, não seu.
      </p>
    </div>
  );
}

/**
 * @param {{item: object}} props  o item do catálogo (`lib/navegacao.js`) que pediu esta tela
 */
export default function PainelDoFornecedor({ item }) {
  const conta = contaAtual();
  const endereco = enderecoEmbutido(item, conta);

  const quadro = useRef(null);
  const [carregando, setCarregando] = useState(true);
  // Estado separado do «carregando» porque são coisas diferentes: uma é espera, a outra é
  // diagnóstico. Misturar as duas daria uma tela que fica «carregando» para sempre quando falha.
  const [pediuEntrada, setPediuEntrada] = useState(false);
  // Muda a cada «recarregar» e força o React a criar um quadro NOVO. Mexer em `contentWindow.
  // location` para recarregar seria escrever no lado dele — justamente o que não fazemos aqui.
  const [tentativa, setTentativa] = useState(0);

  // Cada troca de tela é um quadro novo: o estado da anterior não pode vazar para a seguinte.
  useEffect(() => { setCarregando(true); setPediuEntrada(false); }, [endereco, tentativa]);

  const aoCarregar = useCallback(() => {
    setCarregando(false);
    try {
      // LEITURA, mesma origem, dentro de `try`. Se um dia isto passar a lançar, quer dizer que a
      // origem mudou — e aí o quadro inteiro já não funcionaria, com ou sem esta linha.
      const onde = quadro.current?.contentWindow?.location?.pathname || '';
      setPediuEntrada(onde.includes('/app/login') || onde.includes('/app/auth'));
    } catch {
      // Não sabemos onde ele parou. Não inventamos: sem aviso é melhor que aviso errado.
      setPediuEntrada(false);
    }
  }, []);

  if (!endereco) return <SemEndereco rotulo={item?.rotulo || 'Painel de atendimento'} />;

  return (
    <div className="embutido">
      <div className="embutido__barra">
        <span className="embutido__origem">
          Tela do painel de atendimento, aberta aqui dentro
        </span>
        <button type="button" className="btn btn-secondary" onClick={() => setTentativa((n) => n + 1)}>
          <RefreshCw size={14} /> Recarregar
        </button>
        {/* ⚠️ `rel="noopener"`: mesmo sendo a mesma origem, abrir aba com acesso ao nosso
            `window.opener` não serve para nada aqui e é hábito ruim de carregar. */}
        <a className="btn btn-secondary" href={endereco} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> Abrir em outra aba
        </a>
      </div>

      {pediuEntrada && (
        <p role="status" className="embutido__aviso">
          O painel de atendimento pediu entrada de novo — a sessão dele venceu. Saia do Ragnabot e
          entre outra vez: a sua entrada aqui vale para os dois lados.
        </p>
      )}

      <div className="embutido__moldura">
        {carregando && <div className="embutido__espera" role="status">Abrindo a tela…</div>}
        <iframe
          key={`${endereco}#${tentativa}`}
          ref={quadro}
          className="embutido__quadro"
          src={endereco}
          title={item?.rotulo || 'Painel de atendimento'}
          onLoad={aoCarregar}
          // Permissões que a tela dele usa de verdade (anexo, chamada, notificação). Lista curta e
          // declarada: o padrão do navegador já é negar o que não está aqui.
          allow="clipboard-read; clipboard-write; microphone; camera; fullscreen"
        />
      </div>
    </div>
  );
}
