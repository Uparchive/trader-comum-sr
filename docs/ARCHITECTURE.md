# Kell Quant Lab V3 — Arquitetura de longa duração

## Diagnóstico da V2

A V2 já separava intenção, materialização e projeção por meio de `data/write_intent.json`, `engine/state_core.py`, ledger imutável e arquivos de dashboard. O executor já era fail-closed e somente DEMO. Os pontos de crescimento eram os agregadores `data/*.json`, o diário plano e a ausência de uma relação formal entre a falha 2B e seu reteste.

## Fonte da verdade

- mutações: `ledger/transactions/YYYY/MM/`;
- execução científica imutável: `research/YYYY/MM/YYYY-MM-DD/cycle-X/RUN-*/run.json`;
- evidência narrativa: `report.md` ao lado do run;
- memória de trabalho: `state/current.json`;
- dados V2: projeções operacionais/compatibilidade, não histórico canônico infinito.

O fluxo normal permanece: intenção científica → materializador determinístico → ledger → projeções V2 → materializador V3 → índices/snapshots/site.

## Fluxo

Entrada → pesquisa → registro imutável → índices → página HOT → consulta por índice. O Worker permanece separado, dedicado ao gateway de dados e ao executor DEMO.

## Camadas

HOT (90 dias configuráveis) participa do carregamento inicial. WARM (91–180 dias) é consultado por índice. COLD (>180 dias) permanece particionado e versionado, fora do carregamento normal. `scripts/archive_v3.py` recalcula temperatura e páginas sem apagar evidência.

## Frontend

A Home lê `state/current.json`; o Diário lê uma página de `indexes/recent/`; busca por ID/data abre apenas o índice correspondente; dossiês usam `indexes/hypotheses/` e `indexes/experiments/`. O event store nunca é baixado.

## Cloudflare e executor

`worker/index.js` e `wrangler.toml` foram preservados. Não foi criado backend adicional: os índices estáticos atendem a consulta com menos CPU/requests. `DEMO_ONLY`, `fail_closed`, limites, cooldown, kill-switch lógico e `max_open_positions` permanecem intactos. Nenhuma operação foi enviada.

