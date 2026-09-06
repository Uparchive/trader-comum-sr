# Kell Quant Lab v3

Plataforma autônoma de pesquisa quantitativa com execução exclusivamente em **Deriv Demo**.

## Marco zero

A arquitetura v2 começa prospectivamente em **29/08/2026**, registrado como **Dia 1** de um novo horizonte de 90 dias. A pesquisa de 28/08 foi preservada como **piloto pré-arquitetura** e não conta para as métricas nem para as conclusões do programa v2.

## Missão

Investigar sistematicamente um universo de mercados e descobrir se existe alguma vantagem estatística reproduzível que sobreviva a descoberta, validação histórica, teste prospectivo e execução DEMO. O projeto não tem obrigação de encontrar edge.

## Arquitetura científica

`Market Registry -> Market Discovery Engine -> Research Engine -> Hypothesis Registry -> Experiment Engine -> Scientific Auditor -> Shadow Prospective -> DEMO Executor -> Audit`

### Separação de responsabilidades

- **Código** executa força bruta estatística e processamento de dados.
- **IA** formula perguntas, interpreta evidência e decide cientificamente.
- **GitHub** é a fonte única de verdade e memória versionada.
- **Site** é a interface de consulta da pesquisa.
- **Executor** é determinístico e só executa estratégias promovidas.

## Cadência

- `08:00 A — Discovery`: universo, dados, características de mercado, pesquisa externa e poucas hipóteses de alto valor.
- `14:00 B — Adversarial Validation`: OOS, walk-forward, controles, bootstrap/Monte Carlo quando aplicável, sensibilidade e auditoria de vieses.
- `20:00 C — Audit`: consolidação, estados, Shadow/DEMO, kill-switches e próximo passo pré-registrado.

## Registros estruturados

- `config/research_program.json` — contrato científico v2.
- `data/markets.json` — registro do universo de mercados.
- `data/hypotheses.json` — registro global de hipóteses e orçamento de busca.
- `data/experiments.json` — experimentos, Shadow e DEMO.
- `data/research.json` — diário prospectivo v2 por dia/subciclo.
- `data/research_legacy.json` — piloto de 28/08 preservado fora das métricas v2.
- `research/ARCHITECTURE_V2.md` — especificação metodológica.

## Governança científica

Toda hipótese recebe ID global e registra origem, mercado, família, parâmetros, número de variantes e destino. Quanto maior o espaço de busca, maior o ônus de prova. Resultados negativos e inconclusivos permanecem no histórico. Parâmetros não podem ser ajustados depois de observar OOS sem criar uma nova versão/hipótese.

Uma estratégia historicamente aprovada **não vai direto para DEMO**. Primeiro entra em **Shadow prospectivo**, congelada e sem apostar. Só depois de critérios prospectivos pré-definidos pode ser promovida.

## Gates mínimos iniciais

- sem look-ahead ou leakage;
- train/OOS cronológico;
- walk-forward em múltiplas janelas;
- pelo menos 200 trades OOS agregados antes de alegação inicial de edge;
- expectativa líquida OOS > 0;
- profit factor > 1.05;
- pelo menos 60% das janelas walk-forward positivas;
- intervalo de confiança/bootstrap reportado;
- controles aleatórios e baseline;
- payout/preço de contrato realista;
- Shadow prospectivo obrigatório;
- kill-switch quantitativo congelado antes da execução.

## Executor e segurança

O Cloudflare Worker em `worker/index.js` continua como executor planejado. A arquitetura de execução não foi relaxada.

- `DEMO_ONLY` obrigatório.
- `real_money_allowed=false`.
- Fail-closed em qualquer dúvida de ambiente, conta, endpoint ou configuração.
- Nenhuma migração automática para dinheiro real.
- Nenhum martingale.
- Nenhum segredo, token ou OTP é registrado no repositório.
- A configuração v2 começa com **nenhuma estratégia promovida** e `execution_enabled=false` / `research_approved=false`.

## Site

O dashboard agora possui áreas separadas para:

- visão geral do programa;
- universo de mercados;
- mapa global de hipóteses;
- esteira de experimentos;
- diário científico pesquisável;
- método e governança.

## Princípio central

A pergunta do projeto não é mais “uma SMA funciona em um gráfico?”. A pergunta é:

> **Existe informação previsível e economicamente explorável em algum mercado do universo estudado que sobreviva à descoberta, validação e observação prospectiva?**

Se a resposta final for não, isso também é um resultado científico válido.
## Arquitetura V3

O GitHub é a memória científica permanente; `state/current.json` é a memória operacional pequena; o site é uma janela de consulta. Runs são imutáveis e particionados, o event store é mensal, datasets possuem manifestos SHA-256 e o histórico é acessado por índices e snapshots.

A escrita continua barata para o agente: `data/write_intent.json` → materialização determinística → ledger → projeções → V3. Os agregadores V2 permanecem temporariamente para compatibilidade, mas não são o arquivo histórico canônico.

- HOT: 90 dias no carregamento inicial;
- WARM: até 180 dias, sob demanda;
- COLD: preservado e fora do carregamento normal;
- migração: `python scripts/migrate_v2_to_v3.py`;
- validação: `python scripts/validate_v3.py`;
- protocolo do agente: `docs/AGENT_CONTEXT_PROTOCOL.md`.

O executor permanece `DEMO_ONLY`, fail-closed e sem Champion.

