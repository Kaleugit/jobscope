# Handoff: descoberta de vagas (Área do Dono)

Estado em 2026-11-20, ao pausar o trabalho. Leia junto com `CONTEXT.md` (glossário) e `docs/adr/`.

## O que é

Painel privado em `#/discovery`, visível só para a conta master. Coleta vagas remotas que aceitam quem mora no Brasil, filtra por regras, pontua pela Natureza do Trabalho com o Gemini e manda e-mail das melhores. Mora no Jobscope, não no portfólio: ver `docs/adr/0001-descoberta-dentro-do-jobscope.md`.

## Em produção (último deploy: `8d9399f`, CI verde)

- **Coleta agendada** às 07:00 e 13:00, de segunda a sexta, America/Sao_Paulo (EventBridge Scheduler → `DiscoveryFn`, 15 min de teto, trava no DynamoDB em `DISC#LOCK`).
- **Fontes:** Himalayas (`/jobs/api/search?country=Brazil`, chave em `HIMALAYAS_API_KEY`), Remotive, Remote OK e os ATS da tabela de empresas (Greenhouse, Lever, Ashby). O **We Work Remotely saiu** em `8d9399f`: ver "Decisões pendentes".
- **Pipeline** (`api/src/handlers/discovery.ts`): coleta → upsert/dedup (`store.ts`, `merge.ts`) → regras (`rules.ts`, vocabulário em `rules-config.ts`) → Gemini em lotes de 8 (`score.ts`, `judge.ts`, `gemini.ts`) → alerta SES (`alerts.ts`).
- **Gemini:** modelo próprio `gemini-3.5-flash-lite`, `thinkingLevel: low`, até 15 chamadas por coleta. A demo usa `gemini-3.6-flash` (20 req/dia no gratuito, por projeto): **nunca calibrar com o modelo da demo**.
- **Retenção (TTL ligado na tabela, atributo `ttl`):** descartada é apagada na hora e deixa só uma Impressão Digital (`DISC#GONE`, ~100 bytes, 30 dias); não decidida expira 30 dias após a publicação; promovida fica para sempre. Nenhuma etapa lê a tabela inteira: tudo passa pelo índice `gsi1` (por data de publicação).
- **Configurações** (DynamoDB `DISC#SETTINGS`, editáveis na aba settings): e-mail do alerta, alerta a partir de 80, Nota Mínima 60, 3 anos de experiência, Perfil de Aderência. O perfil não está no repo (o repo é público).
- **SES:** e-mail do alerta verificado pelo dono. Em sandbox, só envia para endereço verificado.
- **Testes:** 180 no CI (`npm test`), com fixtures reais reduzidas em `api/test/fixtures/`.

## Problema principal em aberto: qualidade das vagas ("slop")

O dono abriu as vagas do painel e a maioria parece lixo:
- **Cadeia de redirecionamento:** o link leva a um agregador, que leva a outro, que manda entrar num portal, procurar a vaga e se cadastrar. Não é a empresa contratando.
- **Vagas velhas.**
- **Ar de suspeita** em geral.

Nada disso foi investigado ainda. Pontos de partida:
- Medir **de onde vêm as vagas que passam** (fonte e domínio do link final). O Himalayas trouxe 80 das ~110 aprovadas na primeira coleta, e o `applicationLink` dele costuma apontar para a página do próprio Himalayas, não para o ATS da empresa.
- Empresas que são **revendedoras de vagas**, não empregadores: Xperteez Technology (várias "AI Trainer" e "Expert" com nota 88-90) e RemoteJobsOne apareceram no topo. Talvez seja preciso uma lista de "empresas que não contratam diretamente", no estilo de `AGENCY_COMPANIES`.
- **Link direto como critério:** priorizar ou exigir vaga com link para um ATS conhecido (greenhouse.io, lever.co, ashbyhq.com, workable, smartrecruiters...) em vez de página de agregador.
- **Idade:** a janela "hoje/24h/48h" usa a data de publicação da fonte. Conferir se a fonte republica vaga velha com data nova.
- As **fontes de ATS diretos** (Coderoad, Arena, Connectly...) não têm esse problema, mas quase nunca aparecem no painel, porque as vagas delas foram publicadas há semanas (o dono decidiu manter a janela pela data de publicação). Ampliar a lista de empresas ATS pode render mais vaga real que os agregadores.

## Decisões pendentes

1. **We Work Remotely.** Saiu das fontes porque a maioria das vagas trava o "Apply" atrás de assinatura paga. O RSS não diz quais, e a página fica atrás de um desafio anti-robô da Cloudflare (403 "Just a moment..." para o fetch do Node; o `curl` passou até ser barrado também). Não contornar o anti-robô. Depois, o dono disse que vaga premium ele mesmo descarta e que o problema seria ela tomar o lugar de outra. Ela não toma: o painel não tem limite de vagas, e o único ponto de disputa é a cota do Gemini, que no máximo atrasaria uma vaga em uma coleta. **Proposta ainda sem resposta:** trazer o WWR de volta com a marca "[wwr: pode exigir premium]" e com as vagas só do WWR por último na fila do Gemini. Reverter `8d9399f` e acrescentar a marca e a prioridade. As vagas do WWR que já estavam no banco **não foram apagadas** (elas expiram sozinhas em 30 dias).
2. **Etapa 7, o Worker de Currículo, não começou.** O desenho está fechado em `docs/adr/0002-worker-local-de-curriculo.md`:
   - worker no PC do dono, modelo pull (busca pedidos na API, sem porta aberta);
   - chat na Candidatura;
   - Claude Code da assinatura rodando dentro de `~/dev/latam-cv-maker`;
   - permissão `deny` de escrita em `base/**`, porque o perfil-mestre nunca é editado;
   - sempre um currículo novo, com a nomenclatura do LATAM CV Maker.

## Fontes candidatas (lista do dono, 2026-11-20, ainda não estudadas)

O dono mandou estes sites para estudar e, depois, decidir se entram na busca. Nada foi pesquisado ainda. A descrição de cada um é a que veio com a lista, não foi verificada.

| # | Site | Como foi descrito | Situação hoje |
|---|---|---|---|
| 1 | Remotar, remotar.com.br | plataforma brasileira só de vagas 100% remotas, com salário declarado | não usado |
| 2 | Wellfound, wellfound.com | vagas em startups, com salário, equity e benefícios visíveis | não usado |
| 3 | Himalayas, himalayas.app | vagas remotas com faixa salarial em USD ou EUR, verificadas | **já é fonte** (maior volume e suspeita de slop) |
| 4 | Remote OK, remoteok.com | filtro por salário mínimo e benefícios | **já é fonte** |
| 5 | We Work Remotely, weworkremotely.com | grande plataforma de vagas remotas com remuneração | **removido** em `8d9399f` (apply travado por premium, anti-robô) |
| 6 | Jobgether, jobgether.com | anúncio completo: salário, modelo, localização, benefícios | não usado |
| 7 | 4 Day Week, 4dayweek.io | semana de 4 dias com 100% do salário, empresas verificadas | não usado |
| 8 | Flexa Careers, flexa.careers | empresas com flexibilidade auditada | não usado |
| 9 | EuropeRemotely, europeremotely.com | vagas europeias, salário em EUR no título | não usado (o foco é quem pode contratar no Brasil) |
| 10 | Otta, otta.com | empresas em crescimento, benefícios declarados | não usado (hoje parte do Welcome to the Jungle, a confirmar) |
| 11 | Cord, cord.co | vagas de tecnologia com salário obrigatório e contato direto com o time | não usado |
| 12 | Just Remote, justremote.co | só vagas 100% remotas | não usado |

**O que estudar em cada um antes de implementar:**
- Tem API pública, RSS ou feed? Exige chave ou conta?
- Os termos permitem uso automatizado? Há proteção anti-robô (como a Cloudflare do WWR)? Não contornar nenhuma.
- O botão de aplicar leva direto ao ATS da empresa, ou passa por cadastro ou assinatura paga? Esse é o filtro que derrubou o WWR.
- Diz se a vaga aceita Brasil/LATAM, em campo estruturado?
- O quanto repete vagas de outras fontes, e o quanto é revenda de vaga ("slop", ver acima).

Ordem sugerida: primeiro as que podem trazer vaga direta e com campo de país (Remotar, Wellfound, Jobgether, 4 Day Week); por último as de foco europeu.

## Como operar

- **Rodar uma coleta agora:** botão "run now" na aba runs, ou `aws lambda invoke --function-name JobscopeStack-DiscoveryFnEFFCFFEF-MvuKpvcsrEjK --payload '{"trigger":"manual"}' --cli-binary-format raw-in-base64-out out.json` (us-east-1).
- **Testar as fontes sem tocar no banco:** `HIMALAYAS_API_KEY=... npx tsx api/scripts/collect-dry-run.ts`.
- **Gravar o perfil ou o e-mail por script:** `TABLE_NAME=... npx tsx api/scripts/put-settings.ts --profile <arquivo fora do repo>`.
- **Chaves locais:** `.env` na raiz (ignorado pelo git). `GEMINI_API_KEY` foi lida da Lambda `AnalyzeFn`.
- **Push na `main` faz deploy** (GitHub Actions + OIDC, com typecheck e testes antes).

## Armadilhas já pagas

- **Escape em scripts Python via heredoc:** `\b` e `\n` dentro de código TS viraram caracteres de controle e quebraram regex e strings. Para trechos com barra invertida, use o Edit ou um script em arquivo, nunca um heredoc.
- **O limite de concorrência da conta AWS é 10:** reserved concurrency é recusado. A trava é no DynamoDB.
- **Faixa "3-5 years"** vira "3 5 years" no texto normalizado. Já tratado e com teste.
- **O Himalayas marca "Senior" em vagas de título neutro.** O dono decidiu: sênior sai.
