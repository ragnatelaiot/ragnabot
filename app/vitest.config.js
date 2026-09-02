// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DO CORREDOR DE TESTES (vitest)
//
// POR QUE ESTE ARQUIVO PASSOU A EXISTIR (02/09/2026): esta casa tem DOIS tipos de teste, de
// propósito —
//   · `tests/**/*.test.js`      → rodados pelo vitest (`npm run test:unit`);
//   · `tests/**/*.test.mjs` e
//     `src/base/testes/*.mjs`   → programas AUTÔNOMOS, rodados à mão com `node arquivo.mjs`.
//     Eles imprimem o próprio relatório, alguns pedem banco de verdade e outros só rodam com uma
//     variável de ambiente ligada (`RAGNABOT_FLUXO_E2E=1`).
//
// O cabeçalho de `tests/ragnabot-fluxo-blocos.test.mjs` já registrava a intenção: *"FORA DO GLOB DO
// VITEST DE PROPÓSITO: o corredor varre só `tests/**/*.test.js`"*. Só que o padrão do vitest 4
// inclui `.mjs` também (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) — então ele passou a abrir os 13
// programas autônomos e a reprovar todos com *"No test suite found in file"*. O `npm run test:unit`
// ficava vermelho sem nenhum defeito de código, que é o pior tipo de vermelho: o que ensina a
// ignorar vermelho.
//
// Aqui o glob volta a ser o DECLARADO. Quem quiser rodar os autônomos continua fazendo o que
// sempre fez: `node tests/ragnabot-<assunto>.test.mjs`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Os autônomos ficam de fora por extensão, mas a exclusão explícita documenta a intenção para
    // quem for mexer nisto depois — e protege contra uma futura mudança de padrão do corredor.
    exclude: ['**/node_modules/**', '**/dist/**', 'web/**', '**/*.test.mjs'],
  },
});
