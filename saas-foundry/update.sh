#!/usr/bin/env bash
# Atualiza o clone local com o que foi entregue no branch e recompila.
# Uso: ./update.sh  (depois: npm run dev --workspace=@foundry/factory-shell)
set -euo pipefail
cd "$(dirname "$0")"

git checkout claude/saas-foundry-engine-core-6lsg9k
git pull origin claude/saas-foundry-engine-core-6lsg9k
npm install
npm run build

echo ""
echo "✔ Atualizado para: $(git log --oneline -1)"
echo "→ Agora rode: npm run dev --workspace=@foundry/factory-shell"
echo "→ E no navegador: Cmd+Shift+R em http://localhost:5173"
