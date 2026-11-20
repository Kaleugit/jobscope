# Pedido de Currículo atendido por um worker local na assinatura do Claude Code

Os currículos são gerados por um Worker de Currículo rodando no PC do dono. Ele busca Pedidos na API do Jobscope (pull, nenhuma porta aberta) e conversa com o dono por um chat na Candidatura, executando o Claude Code da assinatura dele dentro do LATAM CV Maker. A alternativa óbvia era a Lambda chamar uma API de modelo. Ela foi rejeitada por dois motivos: a assinatura não pode servir de backend, e o LATAM CV Maker (perfil-mestre, skill `/gerar-cv`, `build.mjs` com o Chrome local) já é o gerador certo e vive no PC. O preço é que um Pedido só anda com o PC ligado. Enquanto isso, ele espera na fila.

## Consequences

- "Nunca edita o perfil-mestre" é garantido por regras de permissão do Claude Code (deny de escrita em `base/**`), não só pelo prompt.
- Coleta, filtros e nota não dependem do PC: rodam na Lambda com o Gemini.
