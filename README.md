# IOSMusic 🎵

Seu "Spotify" pessoal, **sem servidor, sem PC ligado e sem cartão de crédito**.
Cole um link, o GitHub baixa o áudio com **yt-dlp**, a música vai para o **Supabase** e você
ouve no iPhone como um app, inclusive com a tela bloqueada e offline.

```
 iPhone (app)  ──cola link──►  Supabase (fila)  ──avisa──►  GitHub Actions (yt-dlp + ffmpeg)
      ▲                              ▲                                │
      └────── toca direto ◄──────────┴──── música + capa ◄────────────┘
 App hospedado de graça no GitHub Pages
```

| Serviço | Para quê | Grátis | Cartão? |
|---|---|---|---|
| **GitHub** | site do app + baixador | sim | não |
| **Supabase** | músicas, biblioteca, login | 1 GB (~250 músicas) | não |

Tempo de configuração: uns 20 minutos, uma vez só. Siga na ordem.

---

## 1. GitHub: criar o repositório

1. Crie uma conta em <https://github.com>.
2. Crie um repositório **público** chamado `iosmusic`. Ele precisa ser público para o GitHub
   Pages ser grátis. Só o código fica público: as músicas, senhas e chaves não ficam lá.
3. Envie esta pasta para o repositório. O jeito mais fácil é o **GitHub Desktop**: *Add existing
   repository* → escolha esta pasta → *Publish*. Pelo terminal:

```bash
git init
git add .
git commit -m "IOSMusic"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/iosmusic.git
git push -u origin main
```

## 2. Supabase: banco e armazenamento

1. Crie uma conta em <https://supabase.com>. Dá para entrar com a conta do GitHub.
2. **New project**: escolha um nome, crie uma senha do banco (guarde) e a região **South America (São Paulo)**.
3. Abra **SQL Editor** → **New query**, cole **todo** o conteúdo de [`supabase/setup.sql`](supabase/setup.sql)
   e clique em **Run**.
4. Crie seu login: **Authentication → Users → Add user → Create new user**. Use seu e-mail,
   uma senha e marque **Auto Confirm User**.
5. **Bloqueie novos cadastros**, para ninguém mais criar conta no seu app:
   **Authentication → Sign In / Providers** → desative **Allow new users to sign up** → Save.
6. Pegue as chaves em **Project Settings → API Keys**:
   - **Project URL**, tipo `https://abcdxyz.supabase.co` (fica em *Project Settings → Data API*, ou no botão *Connect*)
   - chave **publishable** (`sb_publishable_...`) ou **anon**: é pública, vai no app
   - chave **secret** (`sb_secret_...`) ou **service_role**: ⚠️ **secreta**, vai só no GitHub

## 3. GitHub: ligar o baixador

**a) Segredos do baixador**: no repositório, abra **Settings → Secrets and variables → Actions →
New repository secret** e crie:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SERVICE_KEY` | chave **secret** / service_role |

**b) Token para o Supabase avisar o GitHub:**
1. Na sua foto (canto superior direito) → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Nome: `iosmusic`. Expiração: a maior disponível (ou *No expiration*).
3. **Repository access → Only select repositories →** `iosmusic`.
4. **Permissions → Repository permissions → Actions → Read and write**.
5. Gere e copie o token (`github_pat_...`).
6. Volte ao Supabase, em **SQL Editor**, e rode, trocando pelos seus dados:

```sql
insert into private.config (key, value) values
  ('github_repo',  'SEU-USUARIO/iosmusic'),
  ('github_token', 'github_pat_COLE_AQUI')
on conflict (key) do update set value = excluded.value;
```

## 4. Publicar o app (GitHub Pages)

1. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Edite o arquivo [`frontend/config.js`](frontend/config.js) direto no GitHub (ícone do lápis) e
   preencha a URL e a chave **publishable/anon**. Clique em *Commit changes*.
   Se pular este passo, o app pergunta esses dados na tela de login.
3. Em **Actions**, o workflow **Publicar app** roda sozinho. Em ~1 minuto o app fica em
   `https://SEU-USUARIO.github.io/iosmusic/`.

## 5. Instalar no iPhone

1. Abra `https://SEU-USUARIO.github.io/iosmusic/` no **Safari**.
2. Entre com o e-mail e a senha do passo 2.4.
3. **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início**.
4. Abra pelo ícone. Pronto!

**Teste:** em *Adicionar*, cole um link do YouTube. Em ~1 a 2 minutos a música aparece. Dá para
acompanhar no GitHub, na aba **Actions → Baixar músicas**.

Para ouvir sem internet, abra a música e toque em **Baixar no iPhone**, ou use o `•••` da
playlist → *Baixar todas no iPhone*.

---

## Problemas comuns

**O download fica em "na fila" para sempre**
- Confira o passo 3b: token com permissão **Actions: Read and write** e o nome do repositório certo.
- Veja se o workflow aparece em **Actions** (às vezes o GitHub pede para clicar em *"I understand
  my workflows, go ahead and enable them"*).
- Dá para forçar: **Actions → Baixar músicas → Run workflow**.
- Mesmo sem o aviso, o GitHub processa a fila sozinho a cada 6 horas.

**"O YouTube bloqueou o GitHub"**

O YouTube às vezes bloqueia servidores. A solução é passar cookies de uma conta Google:
1. No PC, instale a extensão **"Get cookies.txt LOCALLY"** (Chrome ou Firefox).
2. **Use uma conta Google secundária**, não a principal. Abra o youtube.com logado nela e exporte os cookies.
3. No GitHub: **Settings → Secrets → Actions → New secret** com o nome `YT_COOKIES` e o conteúdo do arquivo.

Os cookies vencem de tempos em tempos. Se o erro voltar, repita.

**O app diz que o projeto está pausado / não carrega a biblioteca**

O Supabase grátis **pausa projetos sem uso por ~1 semana**. Entre em <https://supabase.com>, abra o
projeto e clique em **Restore**. As músicas salvas no iPhone continuam tocando mesmo assim.

**"Arquivo maior que 50 MB"**

O Supabase grátis aceita até 50 MB por arquivo (uns 40 minutos de áudio). Vídeos muito longos,
como mixes de horas, não cabem.

**Espaço acabou (1 GB)**

Apague músicas que não ouve mais (`•••` → *Apagar da nuvem*). Uma música de 4 minutos ocupa uns 4 MB.

---

## Atalho do iPhone: compartilhar → baixar

1. App **Atalhos** → **+** → nos detalhes, ative **Mostrar na Planilha de Compartilhamento** (aceita URLs).
2. Adicione a ação **Abrir URLs** com:
   `https://SEU-USUARIO.github.io/iosmusic/?add=` + **Entrada do Atalho**
3. No YouTube: **Compartilhar → seu atalho**. O app abre e já manda baixar.

## Estrutura

- `frontend/`: o app (HTML/CSS/JS, PWA). Fala direto com o Supabase.
- `worker/worker.py`: o baixador (yt-dlp), roda no GitHub Actions.
- `.github/workflows/download.yml`: dispara o baixador.
- `.github/workflows/pages.yml`: publica o app no GitHub Pages.
- `supabase/setup.sql`: tabelas, armazenamento, segurança e o gatilho que avisa o GitHub.
- `tools/make_icons.py`: gera os ícones.

## Limitações

- **iPhone em segundo plano:** toca com a tela bloqueada e mostra os controles na Central de
  Controle. Em alguns iOS, o app da tela de início pode pausar depois de muito tempo; dê play pela
  tela bloqueada.
- **Offline:** o iOS pode apagar os arquivos offline se o app ficar semanas sem ser aberto.
  Eles continuam na nuvem.
- Uso pessoal apenas. Baixar do YouTube vai contra os termos dele.
