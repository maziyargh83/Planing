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
claude mcp add gaam --scope user -- node --disable-warning=ExperimentalWarning --env-file-if-exists=$PWD/.env $PWD/src/transports/mcp/stdio.ts
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

## افزونه‌ی کروم: گام در تب جدید

پوشه‌ی `extension/` یک افزونه‌ی Manifest V3 است که صفحه‌ی تب جدید کروم را با نسخه‌ی سبک گام عوض می‌کند. در ستون اصلی قدم بعدی (انجام، تمرکز، بعداً)، نیت امروز، یک خط ثبت سریع (با همان پارسر `web/src/capture.ts`) و مسیر امروز است؛ با ☆ هر کار را به برنامه‌ی امروز اضافه می‌کنی. ستون کناری نشان می‌دهد دور و برت چه می‌گذرد: یادآوری‌های کوچینگ، خلاصه‌ی صبح، جلسه‌های امروز، سؤال ایجنت‌ها، کارهای در جریان با ستون جیرا، مرج‌ریکوئست‌های باز (GitLab/GitHub) و پیگیری‌ها، که با یک کلیک بسته می‌شوند. هر کارت فقط وقتی دیده می‌شود که چیزی برای گفتن داشته باشد. کلیدها مثل صفحه‌ی «اکنون» است: `D` انجام، `F` تمرکز، `L` بعداً و `/` برای ثبت سریع.

داده را زنده از سرور محلی روی `127.0.0.1:4777` می‌خواند و اگر سرور خاموش باشد، یک پیام آرام نشان می‌دهد و خودش دوباره وصل می‌شود. لینک‌ها وقتی `pnpm dev` روشن است به رابط Vite روی 4778 می‌روند و در غیر این صورت به 4777؛ لینک هر کار با `#/now?task=KEY` همان کار را در گام باز می‌کند.

۱. افزونه را بساز (فایل‌های `extension/lib` و فونت را تولید می‌کند):

```bash
pnpm extension
```

۲. در کروم `chrome://extensions` را باز کن، «Developer mode» را روشن کن، «Load unpacked» را بزن و پوشه‌ی `extension/` را انتخاب کن.

۳. سرور فقط به صفحه‌های محلی اجازه می‌دهد؛ برای این افزونه باید شناسه‌اش را صریحاً در `.env` بنویسی. کلید ثابت در `manifest.json` باعث می‌شود شناسه همیشه همین باشد:

```bash
GAAM_EXTENSION_ORIGIN=chrome-extension://koooklfhdmodkbadchkeaddcpcomjafp
```

بعد `pnpm dev` (یا `pnpm start`) را دوباره اجرا کن و یک تب جدید باز کن. اگر شناسه را اشتباه نوشته باشی، خود صفحه خط درست را نشان می‌دهد. چند شناسه را می‌توانی با ویرگول جدا کنی.

بعد از هر تغییر در `extension/src/newtab.ts` یا `web/src/capture.ts` دوباره `pnpm extension` را بزن و افزونه را در `chrome://extensions` رفرش کن.

## مستندات برای ایجنت‌ها

- [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md): راهنمای «استفاده» از گام برای هر ایجنت. شامل مدل داده، چرخه‌ی پروژه، مقیاس ICE، کِی سؤال بپرسد، چه چیزی را به خاطر بسپارد و روال روزانه و هفتگی. همین سند از طریق MCP هم با ابزار `gaam_guide` و منبع `gaam://guide` در دسترس است.
- [AGENTS.md](AGENTS.md) (و `CLAUDE.md` که به آن لینک است): راهنمای «توسعه‌ی» کد گام، برای ایجنتی که روی همین ریپو کار می‌کند.

## ChatGPT و Codex

در `~/.codex/config.toml` بخش `[mcp_servers.gaam]` اضافه شده است، پس Codex (هم اپ دسکتاپ و هم CLI) گام را می‌بیند. ChatGPT در وب و اپ فقط به سرورهای MCP روی آدرس عمومی HTTPS وصل می‌شود، نه localhost. برای آن باید `pnpm start` را با یک تونل (مثل cloudflared) بیرون ببری و حتماً `GAAM_TOKEN` بگذاری.

## ساختار

```
src/domain/         مدل دامنه و قواعد Planner، همراه با سرویس‌های برنامه‌ریزی
src/storage/        SQLite، مایگریشن‌ها و جست‌وجوی تمام‌متن
src/ai/             دستیار، پروتکل گفتگو و اتصال مدل‌ها
src/retrieval/      بازیابی ترکیبی متن و بردار
src/integrations/   اتصال‌های Jira، Git و سرویس حافظه
src/transports/     ورودی‌های HTTP و MCP؛ رابط‌های برنامه با دامنه
web/                رابط SolidJS با ساختار RTL
extension/          افزونه‌ی کروم برای تب جدید (نسخه‌ی سبک)
web/            رابط کاربری SolidJS، راست‌به‌چپ
```

همه‌ی نوشتن‌ها از `Planner` می‌گذرد، پس UI و هر ایجنتی (stdio یا HTTP) قانون‌ها و لاگ فعالیت یکسانی دارند. UI با SSE هر تغییری را — حتی از یک پروسه‌ی MCP جدا — زنده نشان می‌دهد.

```bash
pnpm test        # تست end-to-end ابزارهای MCP
pnpm typecheck
```


## حافظه و جستجوی معنایی

از منوی «بیشتر»، «از سابقه‌ام پیدا کن» را باز کن: جستجوی ترکیبی در سندها و تصمیم‌ها، پاسخ با منبع، بازبینی حافظه و گردش‌کارهای آماده‌سازی جلسه، مرور هفته و تبدیل ایده به برنامه.

LanceDB نمایهٔ محلی را نگه می‌دارد و Ollama بردارها را می‌سازد؛ بدون مدل، جستجوی متنی کار می‌کند. اتصال اختیاری Mem0، Graphiti و Langfuse و دستورهای ارزیابی Promptfoo در [راهنمای حافظه و بازیابی](docs/AI_MEMORY.md) توضیح داده شده‌اند.
