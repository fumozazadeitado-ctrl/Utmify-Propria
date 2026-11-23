# Roteiro para o Claude: montar o painel de rastreamento do usuário

Você (Claude) está num repositório-modelo de um **painel de rastreamento de Facebook Ads** (no estilo UTMify): cruza o gasto do Meta Ads com as vendas que chegam pelos webhooks das plataformas (Kiwify, Hotmart, Eduzz, Perfect Pay, Cakto, Braip etc.) e mostra lucro, ROAS e CPA por campanha, conjunto e anúncio.

Seu trabalho é entregar ao usuário **o painel dele, com a marca dele, rodando**. O usuário normalmente **não é programador**: fale em português simples, um passo por vez, e faça você mesmo tudo que der para fazer pelo terminal.

---

## Regras que você não pode quebrar

1. **Nunca suba para o GitHub** a pasta `data/` (banco com vendas, clientes e tokens), arquivos `.env` ou qualquer token. O `.gitignore` já bloqueia; não force.
2. **Nunca escreva tokens no código.** Token do Meta, token da API de Conversões e URL pública são colados pelo usuário **dentro do painel** (Integrações / Configurações), e ficam só no banco.
3. **Não adicione dependências npm.** O app usa só o Node.js (incluindo o SQLite embutido `node:sqlite`). Isso é proposital: roda com dois cliques, sem `npm install`.
4. **Personalização de marca é só no `marca.json`.** Não espalhe o nome do painel pelo código.
5. **Não apague nem recrie tabelas do banco.** Se precisar de coluna nova, use `ALTER TABLE ... ADD COLUMN` dentro de um `try` em `lib/db.js`.
6. Senha da VPS, login do GitHub e tokens: **o usuário digita**. Você nunca pede para ele colar senha no chat. Para comandos interativos, peça para ele rodar com `!` na frente (ex.: `! gh auth login`).
7. Depois de qualquer mudança no código, rode `npm run verificar` e suba o servidor para testar antes de dizer que está pronto.

---

## Passo a passo

### 1. Preparar a pasta
- Se você ainda não está dentro do repositório, clone-o: `git clone <url> <pasta>`. Sem git instalado, baixe o ZIP do GitHub (`<url>/archive/refs/heads/main.zip`) e extraia.
- Confira o Node.js: `node -v`. Precisa ser **22.13 ou mais novo**. Se não tiver, mande o usuário instalar a versão LTS em https://nodejs.org (no Windows também dá: `winget install OpenJS.NodeJS.LTS`) e reabrir o terminal.
- Rode `npm run verificar`.

### 2. Entrevista rápida (pergunte tudo de uma vez, numa mensagem só)
1. **Nome do painel** (até ~20 caracteres). Ex.: "LucroTrack", "Rastreio do João". Se ele não souber, sugira 3 nomes.
2. **Cor principal** (pode ser nome de cor: "verde", "laranja", "roxo"). Você converte para hex.
3. **Frase curta** que aparece embaixo do nome (padrão: "rastreamento de anúncios").
4. **Onde vai rodar**: só no PC dele (para testar), numa **VPS** (recomendado para vendas reais, ~R$ 25-40/mês: Hostinger, Contabo, DigitalOcean, Vultr) ou Railway/Render.
5. Tem **domínio** próprio? (opcional; ex.: `track.meusite.com`)
6. Quer que **outras pessoas** criem conta no painel dele? (padrão: não, só ele)

### 3. Personalizar o `marca.json`
```json
{
  "nome": "LucroTrack",
  "id": "lucrotrack",
  "slogan": "rastreamento de anúncios",
  "titulo_login": "Saiba exatamente quais anúncios dão lucro.",
  "texto_login": "Conecte suas contas de anúncio e suas plataformas de venda e veja o resultado real de cada criativo.",
  "cor_principal": "#16a34a",
  "cor_secundaria": "#0ea5e9",
  "cadastro_aberto": false,
  "porta": 3000
}
```
- `id`: nome técnico (minúsculas, números e hífen). Vira o nome do serviço e da pasta na VPS (`/opt/<id>`).
- `cor_principal`: botões, gráficos, destaques. Prefira cores médias/fortes (o fundo do painel é escuro). `cor_secundaria`: forma o degradê do logo com a principal.
- `cadastro_aberto: false`: só a **primeira** conta pode ser criada (a dele). Com `true`, qualquer pessoa com o link cria conta (cada conta vê só os próprios dados).
- Se o usuário pedir mudanças de texto além dessas (ex.: lista de vantagens da tela de login), edite `public/app.js` na função `renderAuth`.

### 4. Rodar e mostrar
- Windows: `INICIAR.bat` (abre o navegador sozinho). Qualquer sistema: `npm start` e abrir `http://localhost:3000`.
- Ele cria a conta dele. Para ver o painel cheio antes de conectar contas reais: **Configurações → Carregar demonstração** (depois **Limpar demonstração**).

### 5. Colocar online (para receber vendas de verdade)
As plataformas precisam de um endereço público para mandar os webhooks.

**VPS (recomendado).** Ubuntu 22.04/24.04. Do PC do usuário, dentro da pasta do projeto (PowerShell):
```powershell
.\deploy\enviar-para-vps.ps1 -Ip IP_DA_VPS                          # acesso por http://IP
.\deploy\enviar-para-vps.ps1 -Ip IP_DA_VPS -Dominio track.site.com   # HTTPS automático
```
- O próprio `ssh` pede a senha: **o usuário digita** (sugira ele rodar com `!` na frente).
- Com domínio: antes, crie no DNS um registro **A** de `track` apontando para o IP da VPS.
- O script instala Node 22 + Caddy (HTTPS), cria o serviço `<id>` e mantém os dados ao reinstalar. Para atualizar depois, é só rodar de novo.
- Mac/Linux: `scp -r . root@IP:/tmp/painel && ssh -t root@IP "sudo bash /tmp/painel/deploy/instalar-vps.sh DOMINIO"` (sem enviar a pasta `data/`).

**Railway / Render.** Suba o repositório dele, comando de start `npm start`, variável `DATA_DIR=/data` e um **volume persistente** montado em `/data` (sem volume, as vendas somem a cada deploy).

**Só para teste no PC:** `cloudflared tunnel --url http://localhost:3000` (o PC precisa ficar ligado; o endereço muda a cada vez).

Depois, no painel: **Configurações → URL pública** = endereço final (ex.: `https://track.site.com`).

### 6. Conectar as contas (guie o usuário, tela por tela)
Detalhes em `docs/CONECTAR-CONTAS.md`. Resumo:
1. **Meta Ads**: Integrações → Meta Ads → Conectar perfil → colar token com `ads_read`, `ads_management`, `business_management` (de preferência de um **Usuário do sistema** do Business Manager, que não expira). Ativar as contas de anúncio.
2. **Plataformas de venda**: Integrações → Nova integração → escolher a plataforma → copiar a URL do webhook → colar no painel da plataforma (eventos de venda aprovada, pendente, reembolso, chargeback).
3. **UTMs**: página UTMs do painel → copiar os parâmetros e colar em **todos** os anúncios (campo "Parâmetros de URL") → colar o script `utms.js` no `<head>` da página de vendas.
4. **Taxas e Custos**: imposto, taxa de cada gateway, custo de cada produto e despesas.
5. (Opcional) **API de Conversões**: Configurações → ID do Pixel + token da CAPI.

### 7. Repositório próprio do usuário (opcional, mas recomendado)
Para ele guardar a versão personalizada:
- `gh` instalado? (`winget install GitHub.cli`). Login: peça para ele rodar `! gh auth login`.
- Crie um repositório **privado**: `gh repo create <id> --private --source . --push` (confira antes com `git status` que `data/` não aparece).
- Sem `gh`: oriente a criar um repositório privado no site do GitHub e arrastar os arquivos (sem a pasta `data/`).

### 8. Entrega
Termine com um resumo curto: endereço do painel, onde está a pasta, como abrir/atualizar, e o que ainda falta ele fazer (ex.: colar webhook na Hotmart).

---

## Mapa do código (para personalizações além da marca)

| Arquivo | O que faz |
|---|---|
| `marca.json` | Nome, cores, textos, cadastro aberto/fechado, porta |
| `server.js` | Servidor HTTP, rotas da API, webhooks (`POST /webhook/:token`), API de pedidos (`POST /api/v1/orders`), injeção da marca no `index.html`, sync do Meta a cada 15 min |
| `lib/marca.js` | Lê e valida o `marca.json` |
| `lib/db.js` | Banco SQLite (`data/painel.db`), tabelas e configurações padrão |
| `lib/meta.js` | Graph API do Meta: perfis, contas, insights, liga/desliga, orçamento |
| `lib/parsers.js` | Converte o webhook de cada plataforma para um pedido padrão. **Plataforma nova: adicione em `PLATFORMS` e escreva o parser aqui** |
| `lib/orders.js` | Grava/atualiza pedidos e envia compra aprovada para a API de Conversões |
| `lib/metrics.js` | Cálculos do resumo e das campanhas (faturamento, lucro, ROAS, CPA, ROI) |
| `lib/demo.js` | Dados de demonstração |
| `public/app.js` | Todo o front (SPA sem framework): telas, gráficos, filtros |
| `public/app.css` | Visual (tema escuro). A cor da marca entra pela variável `--blue` |
| `public/utms.js` | Script que vai na página de vendas e repassa as UTMs para o checkout |
| `deploy/` | Instalação na VPS (Caddy + systemd) |
| `scripts/` | `nova-senha.js` (trocar senha esquecida) e `verificar.js` |

Valores em dinheiro ficam em **centavos** (inteiros) no banco. Datas em ISO UTC; o fuso do usuário vem da configuração `tz_offset` (padrão -3, Brasília).

### Problemas comuns
- **Esqueceu a senha**: `npm run senha -- email@dele.com NovaSenha123` (na VPS: `cd /opt/<id> && sudo -u <id> DATA_DIR=/opt/<id>/data node scripts/nova-senha.js email NovaSenha`).
- **Porta em uso**: o painel já está aberto em outra janela, ou mude `porta` no `marca.json`.
- **Webhook não chega**: confira a URL pública em Configurações, teste abrindo a URL do webhook no navegador (deve responder `{"ok":true}`) e veja `journalctl -u <id> -f` na VPS.
- **Vendas sem campanha**: faltam os parâmetros de URL no anúncio ou o `utms.js` na página.
- **Token do Meta expirou**: gere um de Usuário do sistema e reconecte o perfil.
