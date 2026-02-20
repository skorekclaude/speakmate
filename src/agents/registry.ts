/**
 * ALLMA Coaching Team — Agent Registry
 *
 * 8 Specialized Coaching Agents, each with deep academic expertise.
 * Core agent is the default — auto-routing delegates to specialists.
 *
 * Architecture:
 *   Core (Default Coach) — IFS/ACT/CBT/MI/Schema/Somatic/Narrative
 *   Relations — Attachment/Gottman/NVC/Family Systems/Boundaries
 *   Career — Burnout/SDT/Ikigai/Career Theory/ACT for Work
 *   Body — Exercise Physiology/Running/Strength/Movement/Recovery
 *   Mindfulness — MBSR/Meditation/Breathwork/Yoga/Sleep/Polyvagal
 *   Habits — Atomic Habits/BJ Fogg/Procrastination/Chronobiology/GTD
 *   Shadow — Jung/IFS Exile Work/Inner Child/Schema Therapy/Trauma
 *   Nutrition — Dietetics/Macros/Cultural Diets/Gut Health/Food Tracking
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { AgentConfig } from "./types.ts";

// Prompts directory — relative to project root
const PROMPTS_DIR = join(import.meta.dir, "../../prompts");

// ============================================================
// Agent Definitions
// ============================================================

export const AGENTS: Record<string, AgentConfig> = {
  core: {
    id: "core",
    name: "ALLMA Coach",
    emoji: "🧠",
    model: "deep",
    description: "Main coach — emotional intelligence, self-understanding, therapeutic conversation",
    promptFile: join(PROMPTS_DIR, "allma-coach.md"),
    commands: ["core", "coach", "c"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  relations: {
    id: "relations",
    name: "Relations Specialist",
    emoji: "❤️",
    model: "deep",
    description: "Relationships, attachment patterns, communication, boundaries",
    promptFile: join(PROMPTS_DIR, "relations.md"),
    commands: ["relations", "rel", "r"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  career: {
    id: "career",
    name: "Career Coach",
    emoji: "💼",
    model: "balanced",
    description: "Career decisions, burnout, purpose, work-life integration",
    promptFile: join(PROMPTS_DIR, "career.md"),
    commands: ["career", "work", "w"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  body: {
    id: "body",
    name: "Body & Fitness Coach",
    emoji: "🏃",
    model: "balanced",
    description: "Physical health, training plans, running, strength, movement, recovery",
    promptFile: join(PROMPTS_DIR, "body.md"),
    commands: ["body", "fitness", "f"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  mindfulness: {
    id: "mindfulness",
    name: "Mindfulness Guide",
    emoji: "🧘",
    model: "balanced",
    description: "Meditation, breathwork, yoga, sleep, stress management, nervous system",
    promptFile: join(PROMPTS_DIR, "mindfulness.md"),
    commands: ["mindfulness", "mind", "m"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  habits: {
    id: "habits",
    name: "Habits Architect",
    emoji: "⚡",
    model: "balanced",
    description: "Habit building, productivity, procrastination, routines, systems",
    promptFile: join(PROMPTS_DIR, "habits.md"),
    commands: ["habits", "hab", "h"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  shadow: {
    id: "shadow",
    name: "Shadow Guide",
    emoji: "🪞",
    model: "deep",
    description: "Deep inner work — unconscious patterns, wounds, projections, parts work",
    promptFile: join(PROMPTS_DIR, "shadow.md"),
    commands: ["shadow", "sh", "s"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },

  nutrition: {
    id: "nutrition",
    name: "Nutrition Specialist",
    emoji: "🥗",
    model: "balanced",
    description: "Nutrition, diets, meal planning, calorie tracking, supplements, gut health",
    promptFile: join(PROMPTS_DIR, "nutrition.md"),
    commands: ["nutrition", "diet", "n"],
    allowedTools: ["search_memory", "add_fact", "memory_read"],
    maxTurns: 3,
  },
};

// ============================================================
// Prompt Cache — load prompts once, reuse
// ============================================================

const promptCache = new Map<string, string>();

/** Load agent system prompt from file (cached) */
export async function getAgentPrompt(agentId: string): Promise<string> {
  const cached = promptCache.get(agentId);
  if (cached) return cached;

  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  try {
    const content = await readFile(agent.promptFile, "utf-8");
    promptCache.set(agentId, content);
    return content;
  } catch (e) {
    console.error(`[Registry] Failed to load prompt for ${agentId}:`, e);
    return `You are ALLMA ${agent.name}. ${agent.description}. Be warm, professional, and Socratic.`;
  }
}

// ============================================================
// Auto-Routing — classify message topic → pick agent
// ============================================================

/** Topic keywords mapped to agent IDs */
const ROUTING_KEYWORDS: Record<string, string[]> = {
  relations: [
    // EN
    "relationship", "partner", "boyfriend", "girlfriend", "husband", "wife", "marriage",
    "dating", "breakup", "divorce", "attachment", "jealous", "cheating", "trust",
    "communication", "conflict", "boundary", "boundaries", "family", "parent", "mother",
    "father", "sibling", "friend", "friendship", "love", "intimacy", "lonely", "loneliness",
    "codepend", "toxic", "abuse", "narciss", "dumped", "broke up",
    // PL (stems + infinitives + conjugated)
    "związek", "związk", "partner", "chłopak", "dziewczyn", "mąż", "żona", "małżeńst",
    "randka", "rozstanie", "rozsta", "rozwód", "przywiązanie", "zazdrość", "zdrada",
    "zaufanie", "komunikacja", "kłótnia", "granice", "rodzina", "matka", "ojciec",
    "mama", "tata", "brat", "siostra", "przyjaźń", "miłość", "intymność", "samotność",
    "toksycz", "rzuci", "porzuci", "zdradzi", "kocha",
    // PT
    "relacionamento", "namorado", "namorada", "marido", "esposa", "casamento",
    "término", "divórcio", "apego", "ciúme", "traição", "confiança",
    "comunicação", "briga", "limites", "família", "mãe", "pai", "amizade", "amor",
    "intimidade", "solidão",
  ],

  career: [
    // EN
    "work", "job", "career", "boss", "manager", "coworker", "colleague", "office",
    "burnout", "promotion", "salary", "fired", "quit", "resign", "interview",
    "resume", "cv", "purpose", "calling", "profession", "business", "startup",
    "freelance", "remote", "meeting", "deadline", "project", "corporate",
    // PL (stems + common forms)
    "praca", "pracuj", "kariera", "szef", "menedżer", "kolega", "biuro", "wypalenie",
    "wypalon", "przepalon", "przepaleni", "awans", "pensja", "zwolnion", "rezygnac",
    "rozmowa kwalifikacyjna", "cel zawodowy", "firma", "projekt", "deadline", "spotkanie",
    // PT
    "trabalho", "carreira", "chefe", "colega", "escritório", "burnout",
    "promoção", "salário", "demitido", "entrevista", "currículo", "profissão",
    "empresa", "reunião", "prazo",
  ],

  body: [
    // EN
    "exercise", "workout", "training", "gym", "run", "running", "weight", "muscle",
    "strength", "cardio", "fitness", "sport", "stretch", "mobility", "injury",
    "pain", "back pain", "posture", "walk", "steps",
    "recovery", "rest day", "marathon", "pushup", "squat", "deadlift",
    "coach", "plan treningowy", "training plan",
    // PL (stems + infinitives + conjugated)
    "ćwicz", "trening", "trenowa", "siłownia", "biegać", "bieganie", "biegam", "bieg",
    "waga", "mięśni", "siła", "kardio", "fitness", "sport", "rozciąga", "mobilność",
    "kontuzja", "ból", "plecy", "postawa", "spacer", "kroki",
    "regenerac", "maraton", "kondycj", "wytrzymał",
    "coacha", "coacz", "trener", "fizyczn", "kalistenika", "rozgrzewk",
    // PT
    "exercício", "treino", "treinar", "academia", "corrida", "correr", "peso", "músculo",
    "força", "esporte", "alongamento", "lesão", "dor", "postura", "caminhada",
    "passos", "recuperação", "maratona",
  ],

  mindfulness: [
    // EN
    "meditat", "mindful", "breath", "breathing", "yoga", "calm", "relax",
    "anxiety", "stress", "panic", "nervous", "overwhelm", "grounding", "present",
    "awareness", "mantra", "chakra", "zen", "sleep", "insomnia", "rest",
    "nervous system", "polyvagal", "vagus", "body scan", "progressive muscle",
    // PL (stems + common forms)
    "medytac", "medytowa", "uważność", "oddech", "oddychanie", "joga", "spokój", "relaks",
    "lęk", "stres", "panika", "nerwow", "przytłocz", "uziemienie", "obecność",
    "świadomość", "sen", "snem", "spanie", "bezsenność", "bezsenn", "układ nerwowy",
    "spać", "zasypia", "zasnąć", "budzę się", "nie śpię",
    // PT
    "meditaç", "mindful", "respiração", "yoga", "calma", "relaxa",
    "ansiedade", "estresse", "pânico", "nervos", "sobrecarreg", "aterramento",
    "presença", "consciência", "sono", "insônia", "sistema nervoso",
  ],

  habits: [
    // EN
    "habit", "routine", "morning routine", "productivity", "procrastinat",
    "discipline", "lazy", "motivated", "motivation", "consistency", "goal",
    "schedule", "planner", "todo", "to-do", "time management", "focus",
    "distract", "phone", "social media", "addiction", "screen time",
    "track", "streak", "system", "organize",
    // PL (stems + common forms)
    "nawyk", "nawykam", "rutyna", "poranna rutyna", "produktywność", "prokrastynad",
    "dyscyplina", "dyscyplin", "leniw", "motywac", "konsekwenc", "cel", "plan dnia",
    "harmonogram", "zarządzanie czasem", "skupienie", "rozproszenie",
    "telefon", "media społecznościowe", "uzależnieni", "organizac",
    // PT
    "hábito", "rotina", "produtividade", "procrastin",
    "disciplina", "preguiç", "motivação", "consistência", "objetivo",
    "agenda", "foco", "distração", "celular", "redes sociais", "vício",
  ],

  shadow: [
    // EN
    "shadow", "unconscious", "projection", "repress", "wound", "trauma",
    "inner child", "shame", "toxic shame", "abandonment", "defective",
    "unlovable", "dream", "nightmare", "archetype", "persona", "mask",
    "dissociat", "trigger", "flashback", "ptsd", "abuse", "neglect",
    "inner critic", "protector", "exile",
    // PL
    "cień", "nieświadom", "projekcja", "wypieranie", "rana", "trauma",
    "wewnętrzne dziecko", "wstyd", "toksyczny wstyd", "porzucenie",
    "wadliwy", "niekochany", "sen", "koszmar", "archetyp", "maska",
    "dysocjac", "wyzwalacz", "flashback",
    "wewnętrzny krytyk", "protektor",
    // PT
    "sombra", "inconsciente", "projeção", "reprimido", "ferida", "trauma",
    "criança interior", "vergonha", "abandono", "defeituoso",
    "sonho", "pesadelo", "arquétipo", "máscara", "dissociaç",
    "gatilho", "crítico interior",
  ],

  nutrition: [
    // EN
    "nutrition", "diet", "calorie", "calories", "kcal", "macro", "macros", "meal plan",
    "meal prep", "eating", "food", "cook", "cooking", "recipe", "breakfast", "lunch",
    "dinner", "snack", "hungry", "appetite", "overeat", "binge eating", "fasting",
    "intermittent fasting", "keto", "vegan", "vegetarian", "paleo", "carnivore",
    "gluten", "lactose", "allergy", "intolerance", "gut health", "microbiome",
    "probiotic", "prebiotic", "supplement", "vitamin", "mineral", "omega",
    "fiber", "carbs", "carbohydrate", "fat", "protein", "cholesterol",
    "blood sugar", "insulin", "metabol", "weight loss", "weight gain", "bulk", "cut",
    "food diary", "food log", "what i ate", "what should i eat", "meal",
    // PL — food verbs (with and without Polish diacritics)
    "dieta", "diety", "kalorie", "kcal", "makro", "makroskładnik", "plan żywieniowy",
    "jedzenie", "jeść", "jesc", "jem", "jadłem", "jadlem", "jadłam", "jadlam",
    "zjadłem", "zjadlem", "zjadłam", "zjadlam", "zjem", "jemy",
    "piłem", "pilem", "piłam", "pilam", "piję", "pije",
    "gotować", "gotowac", "gotowanie", "przepis",
    "śniadanie", "sniadanie", "obiad", "kolacja", "przekąska", "przekaska",
    "głód", "glod", "głodny", "glodny", "apetyt",
    "objadanie", "post", "głodówka", "glodowka", "keto", "wegan", "wegetarian",
    "gluten", "laktoza", "alergia", "nietolerancja", "jelita", "mikrobiom",
    "probiotyk", "suplementy", "witamina", "minerał", "mineral", "omega",
    "błonnik", "blonnik", "węglowodan", "weglowodan", "tłuszcz", "tluszcz",
    "białko", "bialko", "cholesterol",
    "cukier we krwi", "insulina", "metabolizm", "odchudzanie", "przytyć", "przytyc",
    "dziennik jedzenia", "co jadłem", "co jadlem", "co jeść", "co jesc", "posiłek", "posilek",
    "odżywianie", "odzywanie", "żywienie", "zywienie", "dietetyk",
    // PL — common food names (trigger nutrition on food mentions)
    "musli", "müsli", "crusli", "krusli", "crunchy", "granola", "płatki", "platki",
    "kefir", "kefirem", "jogurt", "jogurtem", "mleko", "mlekiem", "ser", "serem",
    "jajko", "jajka", "jajkiem", "jajecznica", "jajecznice",
    "chleb", "chlebem", "kanapka", "kanapki", "kanapkę", "tosty", "tost",
    "ryż", "ryz", "makaron", "makaronem", "kurczak", "kurczaki", "kurczakiem",
    "mięso", "mieso", "mięsem", "wołowina", "wolowina", "wieprzowina",
    "ryba", "rybę", "ryby", "łosoś", "losos", "tuńczyk", "tunczyk",
    "warzywa", "warzywami", "owoce", "owocami", "sałatka", "salatka", "sałatkę",
    "zupa", "zupę", "zupą", "kasza", "kaszę", "kaszą", "owsianka", "owsianke", "owsianką",
    "herbata", "herbatę", "herbatą", "kawa", "kawę", "kawą", "sok", "sokiem", "woda", "wodę", "wodą",
    "pizza", "pizzę", "burger", "burgera", "hamburgera", "frytki", "frytkami",
    "chipsy", "chipsów", "słodycze", "slodycze", "słodyczy",
    "czekolada", "czekolade", "czekoladę", "ciasto", "ciastko", "ciastka", "lody", "lodów", "baton", "batonik",
    "masło", "maslo", "masłem", "oliwa", "oliwą", "olej", "olejem",
    "orzechy", "orzechów", "orzechami", "migdały", "migdaly", "migdałów",
    "banan", "banana", "banany", "jabłko", "jablko", "jabłka", "jabłkiem",
    "pomarańcza", "pomarancza", "pomarańczę", "truskawki", "truskawek", "maliny", "borówki", "borowki",
    // PL — Polish dishes & common meals
    "pierogi", "pierogów", "pierogami", "bigos", "bigosem", "schabowy", "schabowego",
    "kotlet", "kotleta", "kotletem", "rosół", "rosol", "rosołem", "żurek", "zurek",
    "barszcz", "barszczem", "gołąbki", "golabki", "placki", "placków", "naleśniki", "nalesniki",
    "kiełbasa", "kielbasa", "kiełbasą", "parówki", "parowki", "parówką",
    "mizeria", "mizerią", "surówka", "surowka", "surówką", "kompot", "kompotem",
    "racuchy", "kluski", "kluskami", "kopytka", "kopytek", "pyzy", "pyzów",
    "flaki", "flaków", "żeberka", "zeberka", "gulasz", "gulaszem",
    // PL — snacks, drinks, extras
    "smoothie", "koktajl", "koktajlem", "shake", "protein shake",
    "budyń", "budyn", "budyniem", "kisiel", "kisel", "galaretka", "galaretką",
    "paluszki", "krakersy", "ciasteczka", "wafel", "waflem", "pączek", "paczek", "pączki",
    "kebab", "kebabem", "sushi", "ramen", "pad thai",
    "piwo", "piwem", "wino", "winem", "wódka", "wodka", "wódką",
    "cola", "pepsi", "sprite", "napój", "napoj", "napojem",
    // PL — more ingredients
    "pomidor", "pomidorem", "pomidory", "ogórek", "ogorek", "ogórkiem",
    "cebula", "cebulą", "czosnek", "czosnkiem", "papryka", "papryką",
    "marchew", "marchewką", "ziemniak", "ziemniaki", "ziemniakiem",
    "brokuł", "brokul", "brokuły", "szpinak", "szpinakiem",
    "groch", "groszek", "groszkiem", "fasola", "fasolą", "fasolką",
    "soczewica", "soczewicą", "ciecierzyca", "ciecierzycą", "hummus",
    "tofu", "tempeh", "awokado", "awokadek",
    "twaróg", "twarog", "twarożek", "twarozek", "śmietana", "smietana",
    "masło orzechowe", "maslo orzechowe", "dżem", "dzem", "miód", "miod", "miodem",
    // PT — food verbs & phrases
    "nutrição", "dieta", "caloria", "calorias", "macro", "plano alimentar",
    "alimentação", "comer", "comi", "cozinhar", "cozinhei", "receita",
    "café da manhã", "almoço", "almocei", "jantar", "jantei",
    "lanche", "lanchei", "fome", "apetite", "compulsão alimentar", "jejum",
    "jejum intermitente", "keto", "vegano", "vegetariano",
    "glúten", "lactose", "alergia", "intolerância", "saúde intestinal", "microbioma",
    "probiótico", "suplemento", "vitamina", "mineral",
    "fibra", "carboidrato", "gordura", "proteína", "colesterol",
    "açúcar no sangue", "insulina", "metabolismo", "emagrecer", "engordar",
    "diário alimentar", "o que comi", "o que comer", "refeição",
    // PT — common Brazilian food names
    "arroz", "feijão", "feijao", "feijoada", "farofa", "mandioca",
    "açaí", "acai", "tapioca", "pão de queijo", "pao de queijo",
    "coxinha", "pastel", "brigadeiro", "paçoca", "pacoca",
    "picanha", "churrasco", "linguiça", "linguica", "frango", "carne",
    "peixe", "camarão", "camarao", "salmão", "salmao", "atum",
    "ovo", "ovos", "queijo", "iogurte", "leite", "manteiga", "azeite",
    "banana", "manga", "abacaxi", "maracujá", "maracuja", "goiaba",
    "laranja", "limão", "limao", "morango", "uva", "melancia",
    "tomate", "alface", "cenoura", "batata", "batata doce", "abóbora", "abobora",
    "brócolis", "brocolis", "espinafre", "couve", "pepino", "cebola", "alho",
    "milho", "soja", "grão de bico", "grao de bico", "lentilha",
    "aveia", "granola", "pão integral", "pao integral", "biscoito", "bolacha",
    "bolo", "sorvete", "chocolate", "doce", "sobremesa",
    "suco", "vitamina de", "smoothie", "água", "agua", "chá", "cha", "café", "cafe",
    "cerveja", "vinho", "cachaça", "cachaca", "refrigerante",
    // PT — meal tracking phrases
    "tomei café", "tomei cafe", "bebi", "comi hoje", "almocei hoje",
    "jantei hoje", "o que comer", "quanto tem de caloria",
    // ES
    "nutrición", "calorías", "plan de comidas", "alimentación",
    "desayuno", "almuerzo", "cena", "merienda", "hambre", "ayuno",
    "suplemento", "vitamina", "fibra", "carbohidrato", "grasa",
    // DE
    "ernährung", "kalorien", "mahlzeit", "frühstück", "mittagessen", "abendessen",
    "fasten", "nahrungsergänzung", "vitamine", "ballaststoffe",
    // FR
    "alimentation", "calorie", "repas", "petit-déjeuner", "déjeuner", "dîner",
    "jeûne", "complément alimentaire", "vitamine", "fibre",
  ],
};

/**
 * Normalize Polish diacritics to ASCII equivalents for fuzzy matching.
 * "zjadłem" → "zjadlem", "śniadanie" → "sniadanie", etc.
 */
function normalizePolish(text: string): string {
  const map: Record<string, string> = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
    'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  };
  return text.replace(/[ąćęłńóśźż]/gi, (ch) => map[ch.toLowerCase()] || ch);
}

/**
 * Classify a user message to determine which specialist agent should handle it.
 * Returns "core" if no strong match — Core is the default generalist.
 *
 * Uses keyword matching with scoring. Agent with most keyword matches wins.
 * Minimum threshold: 1 match required for specialist routing.
 * Normalizes Polish diacritics for better matching (ą→a, ł→l, etc.)
 */
export function classifyMessage(text: string): string {
  const lower = text.toLowerCase();
  const normalized = normalizePolish(lower); // Also match without Polish diacritics
  const scores: Record<string, number> = {};

  for (const [agentId, keywords] of Object.entries(ROUTING_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const kwNorm = normalizePolish(kw);
      // Match against both original and normalized text (handles ą→a, ł→l etc.)
      if (lower.includes(kw) || normalized.includes(kwNorm)) {
        // Longer keywords = stronger signal. 4+ chars = 2 points, multi-word = 3 points
        score += kw.includes(" ") ? 3 : kw.length >= 4 ? 2 : 1;
      }
    }
    if (score > 0) {
      scores[agentId] = score;
    }
  }

  // No matches → default to core
  if (Object.keys(scores).length === 0) return "core";

  // Return agent with highest score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestAgent, bestScore] = sorted[0];

  // Minimum threshold — need at least score 2 for specialist routing
  // This prevents single-word false positives
  if (bestScore < 2) return "core";

  console.log(`[Router] Classified → ${bestAgent} (score: ${bestScore}) | runners-up: ${sorted.slice(1, 3).map(([a, s]) => `${a}:${s}`).join(", ") || "none"}`);
  return bestAgent;
}

// ============================================================
// Helper Functions
// ============================================================

/** Get agent config by ID (throws if not found) */
export function getAgent(id: string): AgentConfig {
  const agent = AGENTS[id];
  if (!agent) throw new Error(`Unknown agent: ${id}`);
  return agent;
}

/** Find agent by command name (e.g., "relations" → AGENTS.relations) */
export function getAgentByCommand(cmd: string): AgentConfig | undefined {
  return Object.values(AGENTS).find((a) => a.commands.includes(cmd.toLowerCase()));
}

/** Get all agents as array */
export function getAllAgents(): AgentConfig[] {
  return Object.values(AGENTS);
}

/** Get available commands for display */
export function getCommandsList(): string {
  return getAllAgents()
    .map((a) => `${a.emoji} /${a.commands[0]} — ${a.description}`)
    .join("\n");
}

/** Default agent (Core Coach) */
export const DEFAULT_AGENT = AGENTS.core;
