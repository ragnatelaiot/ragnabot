// Entrada usada só pelo `monta.smoke.mjs`: renderiza a tela fora do navegador para provar que ela
// MONTA. Não vai para a imagem — é artefato de teste.
import React from 'react';
import { renderToString } from 'react-dom/server';
import FluxosRagnabot from '../src/paginas/FluxosRagnabot.jsx';

export function renderizar() {
  return renderToString(React.createElement(FluxosRagnabot));
}
