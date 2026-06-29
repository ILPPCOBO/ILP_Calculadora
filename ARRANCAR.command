#!/bin/zsh
# Arranca la Calculadora Inteligente de Honorarios y abre el navegador.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
echo "Iniciando en http://localhost:3000 ..."
( sleep 2; open http://localhost:3000 ) &
node backend/server.ts
