// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO DA INTERFACE DO RAGNABOT
// Mesmo ferramental do NOC (Vite + React) de propósito: a Etapa 4 é mudança de casa, e trocar a
// ferramenta na mesma viagem misturaria "quebrou na mudança" com "quebrou na ferramenta nova".
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // ⚠️ CAMINHO RELATIVO, e esta é a diferença que importa em relação ao NOC. O motor pode servir a
  // interface na raiz OU sob um prefixo (`/interface`), e com `base: '/'` o HTML pediria
  // `/assets/…` — 404 no segundo caso, tela branca sem erro visível. Com './', o mesmo pacote
  // construído funciona nos dois lugares, e a decisão de onde montar continua sendo do chefe.
  base: './',

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
