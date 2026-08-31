# Como ligar a tela de Empresas

> **Contrato S4-EMPRESAS, 30/08/2026.** A tela existe e compila, mas **ainda não está pendurada em
> lugar nenhum**: `src/main.jsx` renderiza só `FluxosRagnabot`, e `main.jsx` **não é meu** — outro
> agente está mexendo na entrada e na tela de fluxos agora. O que falta é uma decisão do chefe e
> umas dez linhas. Elas estão aqui, prontas.

---

## 0. O que já está pronto

| Arquivo | O que é |
|---|---|
| `src/lib/api-empresas.js` | camada de rede + as regras de validação copiadas do servidor |
| `src/paginas/EmpresaFormulario.jsx` | tijolos visuais + formulário + modal de cadastro |
| `src/paginas/Empresas.jsx` | a página (lista, busca, filtro, ações, modal de 2FA) |
| `tests/empresas.smoke.mjs` | 27 medições, todas passando |

Nada disso toca `main.jsx`, `lib/api.js`, `app/src/**` nem o NOC.

---

## 1. O trecho para `src/main.jsx`

A interface **não tem roteador** (decisão registrada no cabeçalho do próprio `main.jsx`), e trazer
um agora seria decisão do chefe, não minha. O caminho mais barato e coerente com o que já existe é
o **`#hash`** — que é como a tela de fluxos já guarda o fluxo aberto.

```jsx
import FluxosRagnabot from './paginas/FluxosRagnabot.jsx';
import Empresas from './paginas/Empresas.jsx';
import { atorAtual } from './lib/api.js';

/** Qual tela mostrar. `#empresas` abre o cadastro de empresas; qualquer outra coisa, os fluxos.
 *  Escuta `hashchange` para o botão «voltar» do navegador funcionar. */
function useTelaAtual() {
  const [hash, setHash] = useState(() => (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    const aoMudar = () => setHash(window.location.hash);
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);
  return hash.startsWith('#empresas') ? 'empresas' : 'fluxos';
}

function Aplicacao() {
  const versao = versaoDoMotor();
  const tela = useTelaAtual();
  const ator = atorAtual();
  return (
    <div className="pagina">
      <FaixaDeSessao />
      {/* menu mínimo: dois links, e nada mais — menu lateral é outra conversa */}
      <nav style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <a className="btn btn-secondary" href="#fluxos">Fluxos</a>
        <a className="btn btn-secondary" href="#empresas">Empresas</a>
      </nav>
      {tela === 'empresas'
        ? <Empresas ehSuperusuario={!!ator?.isSuperuser} />
        : <FluxosRagnabot />}
      <footer /* … como já está … */ />
    </div>
  );
}
```

### ⚠️ Sobre `ehSuperusuario`
A tela usa essa propriedade **só para DESENHAR**: esconder «Encerrar», «Excluir definitivamente» e
«Abrir painel do cliente» de quem não é super. **Quem tranca é o servidor** (`somenteSuperuser` no
router) — a propriedade não é permissão, é cortesia. Se o chefe preferir não passar nada, a tela
funciona igual: os três botões simplesmente não aparecem para ninguém.

⚠️ **Medido:** `base/auth.js` devolve `isSuperuser: false` para **toda** sessão de cookie
(linha do `usuarioDaSessao`). Só a ponte NOC→Ragnabot (token de serviço + `x-ragnabot-ator-papel:
super`) produz `isSuperuser: true`. Ou seja, com o login da plataforma esses três botões **nunca**
aparecem hoje. É coerente com o servidor — não é defeito da tela.

---

## 2. O trecho para `package.json` (opcional)

O teste **constrói sozinho** o pacote SSR de que precisa, então não depende de script nenhum. Se o
chefe quiser que ele entre no `npm test`:

```json
"test": "npm run test:servir && npm run test:montar && npm run test:empresas",
"test:empresas": "node tests/empresas.smoke.mjs"
```

O pacote de teste sai em `tests/.ssr/empresas/`, **dentro** de `tests/.ssr/`, que o `.gitignore` já
cobre. A subpasta não é capricho: o Vite **esvazia** o `outDir` antes de escrever, e apontar para
`tests/.ssr` apagaria o `_monta-entrada.js` do teste vizinho.

---

## 3. ⛔ O que NÃO adianta ligar antes de resolver

A tela vai aparecer, listar e recusar formulário errado. **Mas nenhuma escrita vai funcionar** até
três peças mudarem de casa. Isto foi **medido** em 30/08/2026, montando
`routes/ragnabot-tenant.routes.js` num Express de teste e batendo nas rotas:

| Quem chama | Rota | Resposta medida |
|---|---|---|
| papel `admin` (o do cookie) | qualquer uma | **500** — `Cannot find module …/services/device.service.js` |
| papel `super` | `GET /planos` | **200** ✅ |
| papel `super` | `GET /tenants` | **200** (aqui deu erro de banco só porque apontei para uma porta morta de propósito) |
| papel `super` | `POST /tenants` sem código | **400** — `Cannot read properties of undefined (reading 'findUnique')` (`prisma.user` é tabela do NOC) |
| papel `super` | `POST /tenants` com código | **400** — `Cannot find module …/services/otp.service.js` |

As três peças (`device.service`, `prisma.user`/identidade e `otp.service`) já estão listadas como
pendência no **doc 33 §8**, com destino decidido: identidade, validação e 2FA **mudam de casa**.
Enquanto não mudam, a tela mostra a mensagem do servidor **e explica a causa embaixo dela** — em vez
de dizer «erro 500». Ver `diagnosticar()` em `lib/api-empresas.js`.
