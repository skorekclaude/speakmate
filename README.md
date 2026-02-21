# SpeakMate — AI Language Tutor

**Learn English and Brazilian Portuguese** through real conversations with AI tutors. Voice-first, real-time corrections, vocabulary tracking.

## What It Does

SpeakMate is a multi-agent language learning platform with 6 specialized tutors. Each tutor has a unique personality, teaching style, and voice. Every response includes structured corrections and vocabulary suggestions — all explained in Polish (student's native language).

## Architecture

```
User (Web App)
  │
  ├── Agent Selector (carousel)
  │
  ├── 🎓 Alex       — General English, grammar, natural phrasing          [Groq Llama]
  ├── 🔥 Zara       — Gen-Z slang, internet language, social media        [Groq Llama]
  ├── 🧪 Dr. Chen   — Academic/scientific English, research writing       [Claude Sonnet]
  ├── 💕 Sam        — British English, dating vocab, social skills        [Groq Llama]
  ├── 🎨 Luna       — Art & philosophy, debates, cultural criticism       [Claude Sonnet]
  └── 🇧🇷 Fernando    — Brazilian Portuguese from zero, carioca culture     [Groq Llama]
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/) (TypeScript)
- **LLM:** [Anthropic Claude](https://anthropic.com/) Sonnet (deep tier) + [Groq](https://console.groq.com/) Llama 3.3 70B (balanced tier, free)
- **TTS:** [Edge TTS](https://github.com/nicosio2/edge-tts-universal) (free Microsoft voices, 6 unique per tutor)
- **Database:** [Supabase](https://supabase.com/) (PostgreSQL — users, messages, vocabulary, progress)
- **Frontend:** 4-page web app (landing, chat, progress, vocabulary)
- **Deployment:** [Railway](https://railway.app/) (Dockerfile)

## Features

- **6 AI Tutors** — each with distinct personality, voice, and teaching specialty
- **Hybrid LLM Routing** — deep-tier tutors (Luna, Dr. Chen) use Claude Sonnet; rest use Groq Llama (free)
- **Structured Corrections** — every response parsed for `[RESPONSE]`, `[CORRECTION]`, `[VOCAB]` tags
- **Text-to-Speech** — per-tutor voices via Edge TTS (American, British, Brazilian)
- **Voice Input** — Web Speech API microphone with auto language switching (en-US / pt-BR)
- **Vocabulary Tracking** — words auto-extracted, saved to DB, mastery toggle, flashcard mode
- **Progress Dashboard** — daily stats, streak, 30-day chart, CEFR level estimate
- **Polish News Integration** — 10 RSS feeds, politics filtered, headlines used as conversation starters
- **3 UI Languages** — Polish, English, Portuguese
- **SSE Streaming** — real-time chat responses
- **Security** — CORS, rate limiting, path traversal protection, IDOR protection

## Quick Start

```bash
# Clone
git clone https://github.com/skorekclaude/speakmate.git
cd speakmate

# Install dependencies
bun install

# Configure
cp .env.example .env
# Edit .env with your keys (Anthropic/Groq, Supabase)

# Run
bun run dev

# Or with PM2
pm2 start ecosystem.config.cjs
```

## Project Structure

```
speakmate/
├── prompts/                # Tutor system prompts (markdown)
│   ├── general.md          # 🎓 Alex — General English
│   ├── youth.md            # 🔥 Zara — Gen-Z Slang
│   ├── chemist.md          # 🧪 Dr. Chen — Science/Academic
│   ├── dating.md           # 💕 Sam — British Dating Coach
│   ├── artist.md           # 🎨 Luna — Art & Philosophy
│   └── brasileiro.md       # 🇧🇷 Fernando — Brazilian Portuguese
├── src/
│   ├── agents/
│   │   ├── types.ts        # Core type definitions
│   │   └── registry.ts     # 6 tutors + keyword routing
│   ├── core/
│   │   ├── llm.ts          # LLM router (Anthropic + Groq)
│   │   ├── memory.ts       # Supabase persistence
│   │   ├── conversation.ts # Conversation engine
│   │   ├── correction-parser.ts
│   │   ├── tts.ts          # Edge TTS with per-tutor voices
│   │   ├── news-fetcher.ts # Polish RSS news integration
│   │   └── i18n.ts         # PL/EN/PT translations
│   ├── integrations/
│   │   └── server.ts       # Bun HTTP server + SSE + REST API
│   └── index.ts            # Entry point
├── web/                    # Frontend (4 pages)
│   ├── index.html          # Landing page
│   ├── app.html            # Chat interface
│   ├── progress.html       # Progress dashboard
│   ├── vocabulary.html     # Vocabulary manager
│   └── assets/
│       ├── style.css       # Dark theme
│       ├── app.js          # Chat UI + SSE + voice
│       └── shared.js       # Auth + utilities
├── .env.example
├── ecosystem.config.cjs    # PM2 config
├── Dockerfile              # Railway deployment
├── package.json
└── tsconfig.json
```

## Environment Variables

```bash
# Required — LLM
LLM_BACKEND=anthropic          # "anthropic" or "groq"
ANTHROPIC_API_KEY=             # Claude API key
GROQ_API_KEY=                  # Free Llama fallback

# Required — Database
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Optional
USER_NAME=Marek
USER_TIMEZONE=America/Sao_Paulo
WEBHOOK_PORT=3478
```

## License

MIT
