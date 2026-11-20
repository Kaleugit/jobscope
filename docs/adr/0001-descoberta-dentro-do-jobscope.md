# Descoberta de vagas dentro do Jobscope, não no portfólio

A descoberta diária de vagas remotas LATAM foi pedida originalmente como painel admin no site do portfólio (kaleu.dev). Ela foi construída dentro do Jobscope, porque o portfólio é um site estático na Vercel, sem banco, sem auth e sem jobs, e o Jobscope já tinha tudo o que a descoberta precisa: DynamoDB, contas com uma conta mestre (`isMaster`), Gemini, agendamento pela AWS e o ciclo de vida de Candidatura para onde uma vaga descoberta é promovida. A Área do Dono é restrita à conta mestre e invisível para a conta demo pública.

## Consequences

- O repo continua público, porque é evidência de portfólio. Por isso tudo que é pessoal (Perfil de Aderência, e-mail do Alerta, limites) fica no DynamoDB, editável na Área do Dono, e nunca no código.
- O Gemini segue no Jobscope: as funções da conta demo dependem dele.
