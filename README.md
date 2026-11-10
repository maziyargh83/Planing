# گام · Gaam

یک پلنر شخصی و «مغز دوم» که ایجنت‌های AI از طریق **MCP** به آن وصل می‌شوند و همراه تو پلن می‌کنند: ایده را به دیسکاوری، نقشه‌ی ذهنی، لیست اسکوپ، تسک‌های اولویت‌بندی‌شده، سؤال‌های لازم و گزارش پیشرفت تبدیل می‌کنند، و در طول زمان یاد می‌گیرند تو چطور کار می‌کنی.

A personal planner and second brain that AI agents drive over MCP. Node 24 + built-in `node:sqlite` (zero native deps), Hono, MCP SDK, SolidJS. The whole UI is ~25 KB gzipped.

## راه‌اندازی

```bash
pnpm install
pnpm start          # http://localhost:4777  (MCP: http://localhost:4777/mcp)
```

برای توسعه: `pnpm dev` (سرور با watch و Vite روی 4778).
یک دیتابیس نمونه برای دیدن همه‌چیز: `GAAM_DB=~/.gaam/demo.db pnpm seed` و بعد `GAAM_DB=~/.gaam/demo.db pnpm start`.

داده‌ها در `~/.gaam/gaam.db` است (یک فایل SQLite؛ بکاپ = کپی فایل).

## وصل کردن ایجنت‌ها

Claude Code (stdio؛ نیازی نیست سرور روشن باشد):

```bash
claude mcp add gaam --scope user -- node --disable-warning=ExperimentalWarning --env-file-if-exists=$PWD/.env $PWD/src/mcp/stdio.ts
```

HTTP (Cursor، Codex، ایجنت‌های دستان؛ وقتی `pnpm start` روشن است):

```bash
claude mcp add --transport http gaam "http://localhost:4777/mcp?as=claude-code"
```

صفحه‌ی «اتصال» در UI همین‌ها را با مسیر درست برای کپی نشان می‌دهد.

## ایجنت چه کارهایی می‌تواند بکند

| ابزار | کار |
| --- | --- |
| `gaam_context` | اول هر گفتگو: پروفایل، اهداف، برنامه‌ی امروز، کارهای در جریان، سؤال‌های باز، توصیه‌های مربی |
| `project_save`, `project_get` | پروژه از ایده تا تحویل: مسئله، فرضیه، معیار موفقیت، مرحله |
| `mindmap_add`, `mindmap_edit` | نقشه‌ی ذهنی دیسکاوری: سؤال، ریسک، داده، گزینه، تصمیم؛ تبدیل گره به تسک |
| `task_create`, `task_update`, `task_score`, `scope_set` | تسک و زیرتسک، اولویت‌بندی ICE، لیست اسکوپ (داخل / بعداً / خارج) |
| `ask_user`, `asks_list` | سؤال یا درخواست داده از تو؛ در UI جواب می‌دهی و ایجنت می‌خواند |
| `comment_add` | توضیح استدلال روی پروژه، تسک یا گره؛ تو جواب می‌دهی |
| `day_plan`, `journal_add`, `focus` | سه کار مهم روز، چک‌این انرژی و حال، تایمر تمرکز، ژورنال |
| `memory_save`, `memory_list` | چیزهایی که درباره‌ی تو یاد می‌گیرد؛ هر ایجنت جدید اول این‌ها را می‌خواند |
| `insights` | آینه‌ی صادق: خروجی، تمرکز، دقت تخمین، هم‌راستایی با اهداف، انرژی |
| `jira_search`, `jira_pull`, `jira_import` (read-only) | جیرا Cloud و Server |
| `git_activity`, `git_reviews`, `git_sync`, `task_branch` | کامیت‌ها، MRهای GitLab و PRهای GitHub، لینک خودکار با کلید تسک |
| `search`, `activity` | جستجوی تمام‌متن فارسی/انگلیسی، لاگ همه‌ی تغییرات |

پرامپت‌های آماده (در Claude Code: `/mcp__gaam__…`): `idea_to_plan`، `discovery`، `plan_my_day`، `close_my_day`، `weekly_review`، `break_down`، `standup`.

مثلاً: `/mcp__gaam__idea_to_plan سرچ و دیسکاوری اسنپ‌فود را بهتر کنم`

## یکپارچه‌سازی‌ها

`.env.example` را به `.env` کپی کن. جیرا: `JIRA_URL` + `JIRA_TOKEN` (و برای Cloud، `JIRA_EMAIL`). گیت: `GAAM_REPOS` یا فیلد `repo_path` روی پروژه. GitLab: `GITLAB_URL` + `GITLAB_TOKEN`.
اگر کلید تسک (مثل `SRCH-4`) یا کلید جیرا را در اسم برنچ یا پیام کامیت بیاوری، `git_sync` آن را به تسک وصل می‌کند.

## مستندات برای ایجنت‌ها

- [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md): راهنمای «استفاده» از گام برای هر ایجنت. شامل مدل داده، چرخه‌ی پروژه، مقیاس ICE، کِی سؤال بپرسد، چه چیزی را به خاطر بسپارد و روال روزانه و هفتگی. همین سند از طریق MCP هم با ابزار `gaam_guide` و منبع `gaam://guide` در دسترس است.
- [AGENTS.md](AGENTS.md) (و `CLAUDE.md` که به آن لینک است): راهنمای «توسعه‌ی» کد گام، برای ایجنتی که روی همین ریپو کار می‌کند.

## ChatGPT و Codex

در `~/.codex/config.toml` بخش `[mcp_servers.gaam]` اضافه شده است، پس Codex (هم اپ دسکتاپ و هم CLI) گام را می‌بیند. ChatGPT در وب و اپ فقط به سرورهای MCP روی آدرس عمومی HTTPS وصل می‌شود، نه localhost. برای آن باید `pnpm start` را با یک تونل (مثل cloudflared) بیرون ببری و حتماً `GAAM_TOKEN` بگذاری.

## ساختار

```
src/core/       دیتابیس، مدل دامنه (Planner)، مربی و بینش‌ها
src/mcp/        سرور MCP: ابزارها، منابع، پرامپت‌ها، stdio
src/server/     HTTP: UI، /api/rpc، /api/stream (SSE زنده)، /mcp
src/integrations/  Jira، git، GitLab، GitHub
web/            رابط کاربری SolidJS، راست‌به‌چپ
```

همه‌ی نوشتن‌ها از `Planner` می‌گذرد، پس UI و هر ایجنتی (stdio یا HTTP) قانون‌ها و لاگ فعالیت یکسانی دارند. UI با SSE هر تغییری را — حتی از یک پروسه‌ی MCP جدا — زنده نشان می‌دهد.

```bash
pnpm test        # تست end-to-end ابزارهای MCP
pnpm typecheck
```
