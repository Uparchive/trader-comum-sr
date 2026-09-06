# Kell Quant Lab V4 — Corpo do trader autônomo

Início oficial: 02/09/2026. A V4 adiciona operação prospectiva DEMO permanente sem alterar a história científica V1/V2/V3.

O Active Mandate é a única autorização operacional. Ele congela Strategy, Capital Policy, Market Selection, mercados, regras, validade e ciclo autorizador. `NO_CHAMPION` significa que a Baseline versionada ocupa o mandato; não significa executor desligado.

O Cloudflare Worker acorda a cada minuto, valida a barreira `DEMO_ONLY`, obtém saldo real da conta DEMO, reconcilia contratos, ranqueia mercados, calcula regiões de suporte/resistência e só envia uma ordem após registrar uma chave idempotente. Durable Object mantém estado serializado, ledger append-only e chaves contra retry duplicado.

Estados normais: `WAITING_SIGNAL`, `EXECUTING`, `MONITORING`, `SETTLING`. Estados de desligamento são exclusivamente técnicos, de corrupção, credencial, reconciliação, kill-switch ou `PLATFORM_REJECTED`.

O ledger operacional é materializado em partições anuais/mensais e resumos diários. A mente lê resumos; a auditoria pode abrir eventos individuais. Correções são novos eventos de reconciliação.

O dashboard mostra saldo/equity, status humano, estratégia/Capital Policy, mercados, PnL, curva e evidências. Engrenagens internas permanecem recolhidas.
