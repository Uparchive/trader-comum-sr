# Protocolo de contexto V4

**Recuperação progressiva é obrigatória. A mente acorda três vezes; o executor continua.**

1. Leia somente `state/current.json`.
2. Abra o Active Mandate apontado e valide seu hash.
3. Abra a versão exata da Strategy, Capital Policy e Market Selection.
4. Leia o resumo operacional diário/recente, nunca o ledger completo.
5. Leia a pesquisa ativa e o índice das evidências recentes.
6. Use índices por data, mercado, estratégia, hipótese, ciclo ou decisão.
7. Abra evidência original somente quando a decisão exigir.
8. Produza evidência imutável e um diagnóstico explícito.
9. Para mudar Strategy, Capital Policy ou mercados, crie versão e novo Active Mandate.
10. `NO_CHAMPION` seleciona a Baseline; não desliga o executor.
11. Somente estados técnicos extraordinários ou `PLATFORM_REJECTED` desligam o executor.
12. Nunca invente saldo, trade, Champion ou edge.
13. Execute o materializer para IDs, schemas, hashes, índices, projeções e ponteiros.
14. Preserve V1/V2/V3 e não reescreva eventos ou runs anteriores.

Sequência A/B/C: estado → mandato → resumo operacional → pesquisa ativa → evidência necessária → decisão → versão/mandato (se houver mudança) → materialização → dormir.

A IA decide ciência. Código organiza memória, execução, idempotência e reconciliação.
