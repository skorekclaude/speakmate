# ALLMA — AI Psychology Coach

**Your personal psychology coach** powered by Claude AI. Seven specialized coaching agents providing therapeutic conversation, self-understanding, and personal growth.

> *"ALLMA" from Portuguese "alma" (soul) — your AI soul companion.*

## What It Does

ALLMA is a multi-agent coaching platform that combines therapeutic frameworks (IFS, ACT, CBT, Schema Therapy, Somatic, Narrative) with persistent memory and auto-routing to provide personalized psychological coaching in 8 languages.

**Not a therapist.** ALLMA is an AI coaching tool — not a replacement for professional mental health care.

## Architecture

```
User (Web Chat / Telegram)
  │
  ├── Auto-Router (keyword classification)
  │
  ├── 🧠 Core Coach      — IFS/ACT/CBT/MI emotional intelligence     [Claude Opus]
  ├── ❤️ Relations        — Attachment, Gottman, NVC, boundaries       [Claude Opus]
  ├── 💼 Career           — Burnout, SDT, Ikigai, work-life balance   [Claude Sonnet]
  ├── 🏃 Body & Fitness   — Training plans, running, strength, recovery [Claude Sonnet]
  ├── 🧘 Mindfulness      — MBSR, meditation, breathwork, sleep       [Claude Sonnet]
  ├── ⚡ Habits            — Atomic Habits, BJ Fogg, procrastination   [Claude Sonnet]
  └── 🪞 Shadow           — Jung, IFS exile work, inner child, trauma  [Claude Opus]
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/) (TypeScript)
- **LLM:** [Anthropic Claude](https://anthropic.com/) — Opus 4 (deep) + Sonnet 4 (balanced), with [Groq](https://console.groq.com/) (Llama 3.3 70B) as free fallback
- **Memory:** [Supabase](https://supabase.com/) (PostgreSQL + vector search)
- **Payments:** [Stripe](https://stripe.com/) (subscription tiers)
- **Email:** [Resend](https://resend.com/) (OTP authentication)
- **Interface:** Web Chat (SSE streaming) + Telegram Bot
- **Languages:** EN, PL, PT, ES, DE, FR, IT, ZH (auto-detected)

## Features

- **7 Specialized Agents** — auto-routed by topic keywords
- **Hybrid LLM Tiers** — Opus for deep work (core/relations/shadow), Sonnet for everyday (career/body/mindfulness/habits)
- **Persistent Memory** — facts, goals, conversation history via Supabase
- **SSE Streaming** — real-time response streaming in web chat
- **Voice Input** — Web Speech API microphone in chat
- **Crisis Detection** — automatic safety responses with local hotlines
- **Self-Learning** — agents study topics between sessions, build knowledge base
- **8-Language Support** — auto-detection + localized UI, disclaimers, crisis resources
- **Onboarding** — 3-question intake protocol before first session

## Quick Start

```bash
# Clone
git clone https://github.com/skore/allma.git
cd allma

# Install dependencies
bun install

# Configure
cp .env.example .env
# Edit .env with your keys (Anthropic, Supabase, Telegram, Stripe, Resend)

# Set up Supabase tables
# Run docs/supabase-schema.sql in your Supabase SQL editor

# Run
bun run dev

# Or with PM2
pm2 start ecosystem.config.cjs
```

## Project Structure

```
allma/
├── prompts/              # Agent system prompts (markdown)
│   ├── allma-coach.md    # 🧠 Core Coach
│   ├── relations.md      # ❤️ Relations Specialist
│   ├── career.md         # 💼 Career Coach
│   ├── body.md           # 🏃 Body & Fitness Coach
│   ├── mindfulness.md    # 🧘 Mindfulness Guide
│   ├── habits.md         # ⚡ Habits Architect
│   └── shadow.md         # 🪞 Shadow Guide
├── config/
│   └── allma-profile.md  # Persona definition + safety protocols
├── data/
│   └── knowledge.md      # Self-learning knowledge base
├── src/
│   ├── agents/
│   │   ├── types.ts      # Core type definitions
│   │   └── registry.ts   # Agent registry + keyword router
│   ├── core/
│   │   ├── llm.ts        # LLM router (Anthropic + Groq fallback)
│   │   ├── memory.ts     # Persistent memory (Supabase)
│   │   ├── agent-loop.ts # ReAct agentic loop
│   │   ├── conversation.ts
│   │   ├── checkin.ts    # Smart check-ins
│   │   ├── safety.ts     # Crisis detection
│   │   ├── self-learning.ts
│   │   └── i18n.ts       # 8-language support
│   ├── integrations/
│   │   ├── telegram.ts   # Telegram bot interface
│   │   ├── webhook-server.ts # Web server + SSE streaming
│   │   ├── email.ts      # Email OTP (Resend)
│   │   └── stripe.ts     # Payment integration
│   ├── tools/
│   │   └── index.ts      # Tool registry
│   └── index.ts          # Entry point
├── web/                  # Web chat frontend
│   ├── index.html        # Landing page
│   ├── chat.html         # Chat interface
│   └── assets/
│       ├── style.css
│       └── chat.js       # SSE streaming + voice input
├── docs/
│   └── supabase-schema.sql
├── .env.example
├── ecosystem.config.cjs  # PM2 config
├── Dockerfile            # Railway deployment
├── package.json
└── tsconfig.json
```

## How It Works

1. **User sends a message** via Web Chat or Telegram
2. **Auto-Router** classifies topic using keyword scoring → selects specialist agent
3. **LLM Call** with appropriate model tier (Opus for deep, Sonnet for balanced)
4. **Agent Loop** (ReAct pattern): prompt + memory + history → LLM → tool calls → repeat
5. **Response** streamed via SSE (web) or sent as message (Telegram)
6. **Memory** persisted — facts, insights, conversation history

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=       # Telegram bot
LLM_BACKEND=anthropic     # "anthropic" or "groq"
ANTHROPIC_API_KEY=         # Claude API key
GROQ_API_KEY=              # Fallback LLM
SUPABASE_URL=              # Database
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ESSENCIAL=
STRIPE_PRICE_PREMIUM=

# Email OTP
RESEND_API_KEY=

# Optional
ANTHROPIC_MODEL_DEEP=claude-opus-4-20250514
ANTHROPIC_MODEL_BALANCED=claude-sonnet-4-20250514
MAX_AGENT_TURNS=5
TOOLS_ENABLED=true
WEBHOOK_PORT=3456
```

## License

MIT
