# Modelo de dados V3

## Run imutável

Campos centrais: `run_id`, data, dia, subciclo, revisão, `record_status`, `canonical`, hipóteses, experimentos, manifesto, commit, decisão, relatório, `supersedes`, `superseded_by`, falha, auditoria, resumo e próximo passo.

Estados formais: `OFFICIAL`, `SUPERSEDED`, `PRESERVED_OBSOLETE`, `FAILED_TECHNICAL`, `INCONCLUSIVE` e `LEGACY`. A disposição histórica pode ser preservada separadamente do estado da tentativa.

## Reteste 2B

`RUN-20260830-02B-R1` é `FAILED_TECHNICAL`, não canônico e aponta para R2. `RUN-20260830-02B-R2` é `OFFICIAL`, canônico e aponta para R1 por `supersedes`. Nenhum deles é sobrescrito.

## Índices

- `indexes/recent/`: páginas HOT;
- `indexes/days/YYYY-MM.json`: localização temporal;
- `indexes/search/YYYY-MM.json`: texto materializado por mês;
- `indexes/hypotheses/H*.json`: dossiê e timeline;
- `indexes/experiments/E*.json`: desenho, runs e datasets;
- `indexes/markets/`, `decisions/`, `activity/`: consultas específicas.

## Event store

`events/YYYY/MM/events-YYYY-MM.jsonl` é append-only por partição mensal. Frontend e agentes não devem carregá-lo integralmente.

## Dataset manifest

Registra ID, origem, símbolos, período, contagem, SHA-256, aquisição, commit, localização, runs consumidores, validação e retenção. O local pode mudar no futuro sem mudar a identidade científica.

## Snapshots

Semanal, mensal e anual consolidam estado, contagens, decisões, falhas, promoção/rejeição e manifestos. Eles são atalhos de leitura, não substitutos da evidência original.

