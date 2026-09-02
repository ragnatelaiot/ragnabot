// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO DA INTERFACE DO RAGNABOT
// Mesmo ferramental do NOC (Vite + React) de propósito: a Etapa 4 é mudança de casa, e trocar a
// ferramenta na mesma viagem misturaria "quebrou na mudança" com "quebrou na ferramenta nova".
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Normalizado aqui e em `src/lib/prefixo.js` pela MESMA regra (barra na frente e no fim). Duas
// normalizações diferentes dariam `/motor-api` no roteador e `/motor-api/` nos arquivos — e a
// diferença de uma barra é meia tarde de caça.
const prefixo = (() => {
  let p = String(process.env.RAGNABOT_PREFIXO_WEB || '/').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p.replace(/\/{2,}/gu, '/');
})();

export default defineConfig({
  plugins: [react()],

  // ⭐ MUDOU EM 02/09/2026 (contrato S1), e a troca é OBRIGATÓRIA por causa do roteador.
  //
  // Aqui era `base: './'`, para o mesmo pacote servir na raiz ou sob um prefixo. Com caminho
  // relativo, o navegador resolve `./assets/x.js` CONTRA A URL ATUAL — e isso funciona enquanto a
  // URL tem um segmento só. A partir do momento em que existe rota, deixa de funcionar:
  //     /fluxos                  → ./assets/x.js  =  /assets/x.js         ✅
  //     /ragnabot-fluxos/abc-123 → ./assets/x.js  =  /ragnabot-fluxos/assets/x.js   ❌ 404
  // O segundo caso NÃO é hipotético: `tests/servir.smoke.mjs` mede que essa URL antiga devolve a
  // página, e o resultado seria 200 com tela BRANCA — o pior sintoma possível, porque a rede diz
  // que deu certo. Com `base: '/'` o índice pede sempre `/assets/…`, em qualquer profundidade.
  //
  // ⚠️ Caminho ABSOLUTO passa a exigir que se DECLARE onde a interface está pendurada — e é isso
  // que o parágrafo seguinte resolve. (`COMO-SERVIR.md §4` já media metade do problema: `CapaSecao`
  // pede `/capas/…` absoluto, e sob prefixo a capa nascia sem foto. Corrigido junto.)
  //
  // ⭐ E O VALOR É CONFIGURÁVEL (contrato S1): `RAGNABOT_PREFIXO_WEB` decide onde a interface está
  // pendurada, e o Vite grava a escolha em `import.meta.env.BASE_URL`. `src/lib/prefixo.js` é a
  // única leitura desse valor no código da tela — rede, roteador e fotos perguntam lá. Assim o
  // MESMO pacote serve na raiz (padrão) e sob prefixo, sem reescrever uma linha.
  //     npm run build                                   → raiz
  //     RAGNABOT_PREFIXO_WEB=/motor-api/ npm run build   → https://host/motor-api/
  base: prefixo,

  server: {
    port: 5174,   // 5173 é do NOC: as duas rodando juntas na mesma máquina de trabalho não brigam
    proxy: {
      // Em desenvolvimento a tela fala com um motor local. Em produção não há proxy nenhum:
      // a interface é servida pelo próprio motor, mesma origem.
      '/api': 'http://localhost:3100',
      '/interface/configuracao.js': 'http://localhost:3100',
    },
  },

  build: {
    outDir: 'dist',
    target: 'es2022',
    // A tela é UM arquivo de 5.000 linhas: o aviso de tamanho de bloco é esperado, não é defeito.
    chunkSizeWarningLimit: 900,
  },
});
