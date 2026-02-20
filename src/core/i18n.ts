/**
 * ALLMA — Multilingual Support
 *
 * Three languages: Portuguese (BR), Polish, English
 * Auto-detects user language from first message.
 */

export type Language = "pt" | "pl" | "en" | "es" | "de" | "fr" | "it" | "zh";

// ============================================================
// Language Detection
// ============================================================

/** Simple heuristic language detection from text */
export function detectLanguage(text: string): Language {
  const lower = text.toLowerCase();

  const langIndicators: { lang: Language; words: string[]; chars?: RegExp }[] = [
    {
      lang: "pl",
      words: ["cześć", "czesc", "hej", "dzień dobry", "dzien dobry", "jak", "jest", "nie", "tak", "dobrze",
        "proszę", "prosze", "dziękuję", "dziekuje", "chcę", "chce", "mogę", "moge", "jestem",
        "potrzebuję", "potrzebuje", "pomóż", "pomoz", "dlaczego", "kiedy", "gdzie", "czy",
        "po polsku", "polsku", "polski"],
      chars: /[ąćęłńóśźż]/i,
    },
    {
      lang: "pt",
      words: ["olá", "oi", "bom dia", "tudo bem", "como", "está", "não", "sim",
        "obrigado", "obrigada", "por favor", "quero", "posso", "preciso",
        "porque", "quando", "onde", "você", "voce"],
      chars: /[ãõçâêô]/i,
    },
    {
      lang: "es",
      words: ["hola", "buenos días", "buenos dias", "cómo estás", "como estas", "gracias",
        "por favor", "quiero", "puedo", "necesito", "porque", "cuándo", "cuando", "dónde", "donde",
        "también", "tambien", "tengo", "estoy", "siento"],
      chars: /[ñ¿¡]/,
    },
    {
      lang: "de",
      words: ["hallo", "guten tag", "guten morgen", "wie geht", "danke", "bitte",
        "ich bin", "ich möchte", "ich brauche", "warum", "wann", "wo",
        "heute", "gefühl", "fühle", "fuhle"],
      chars: /[äöüß]/i,
    },
    {
      lang: "fr",
      words: ["bonjour", "salut", "comment", "merci", "s'il vous plaît", "je suis",
        "je veux", "j'ai besoin", "pourquoi", "quand", "où",
        "aujourd'hui", "sentiment", "je me sens"],
      chars: /[àâçéèêëîïôùûü]/i,
    },
    {
      lang: "it",
      words: ["ciao", "buongiorno", "come stai", "grazie", "per favore",
        "sono", "voglio", "ho bisogno", "perché", "quando", "dove",
        "oggi", "mi sento", "sentimento"],
      chars: /[àèéìíîòóùú]/i,
    },
    {
      lang: "zh",
      words: ["你好", "早上好", "谢谢", "请", "我是", "我想", "我需要",
        "为什么", "什么时候", "哪里", "今天", "感觉", "心情"],
      chars: /[\u4e00-\u9fff]/,
    },
  ];

  // Score each language
  const scores: Partial<Record<Language, number>> = {};
  for (const { lang, words, chars } of langIndicators) {
    let score = 0;
    for (const word of words) {
      if (lower.includes(word)) score += 2;
    }
    if (chars && chars.test(text)) score += 3;
    if (score > 0) scores[lang] = score;
  }

  // Find best match
  let bestLang: Language = "en";
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang as Language;
    }
  }

  return bestScore >= 2 ? bestLang : "en";
}

// ============================================================
// Translations
// ============================================================

interface Translations {
  disclaimer: string;
  onboarding_q1: string;
  onboarding_q2: string;
  onboarding_q3: string;
  crisis_response: string;
  crisis_resources: string;
  session_greeting: string;
  not_a_therapist: string;
}

const translations: Record<Language, Translations> = {
  pt: {
    disclaimer:
      "Sou a ALLMA, uma companheira de autoanálise por IA. Não sou terapeuta nem conselheira. " +
      "Posso te ajudar a explorar seus pensamentos e padrões, mas não substituo cuidados " +
      "profissionais de saúde mental. Se estiver em crise, vou te passar os recursos certos.",

    onboarding_q1:
      "O que te traz aqui? O que você gostaria de explorar sobre si mesmo(a)?",

    onboarding_q2:
      "O que é algo que você NÃO quer ouvir sobre si mesmo(a)? " +
      "(Geralmente é aí que precisamos olhar 👀)",

    onboarding_q3:
      "Como você reage quando alguém toca num ponto sensível? " +
      "Fecha? Fica bravo(a)? Desvia com humor?",

    crisis_response:
      "Eu ouço você. O que você está sentindo é real e importante. " +
      "Eu sou uma IA — posso escutar, mas agora você precisa de uma pessoa real.",

    crisis_resources:
      "🆘 **Recursos de crise:**\n" +
      "- **CVV:** 188 (24h, gratuito) ou chat.cvv.org.br\n" +
      "- **SAMU:** 192\n\n" +
      "Por favor, entre em contato. Eles são treinados para ajudar.",

    session_greeting: "Como você está se sentindo hoje?",

    not_a_therapist:
      "Lembre-se: eu sou uma IA, não uma terapeuta. Para questões sérias de saúde mental, " +
      "procure um profissional qualificado.",
  },

  pl: {
    disclaimer:
      "Jestem ALLMA, towarzyszka samoanalizy oparta na AI. Nie jestem terapeutką ani psychologiem. " +
      "Mogę pomóc Ci zbadać Twoje myśli i wzorce, ale nie zastępuję profesjonalnej opieki " +
      "zdrowia psychicznego. Jeśli jesteś w kryzysie, podam Ci odpowiednie numery.",

    onboarding_q1:
      "Co Cię tu sprowadza? Co chciałbyś/chciałabyś zbadać o sobie?",

    onboarding_q2:
      "Czego NIE chcesz usłyszeć o sobie? " +
      "(Zwykle to właśnie tam trzeba zajrzeć 👀)",

    onboarding_q3:
      "Jak reagujesz, kiedy ktoś trafia w czuły punkt? " +
      "Zamykasz się? Złościsz się? Odcinasz humorem?",

    crisis_response:
      "Słyszę Cię. To co czujesz jest prawdziwe i ważne. " +
      "Jestem AI — mogę słuchać, ale teraz potrzebujesz prawdziwego człowieka.",

    crisis_resources:
      "🆘 **Pomoc w kryzysie:**\n" +
      "- **Telefon Zaufania:** 116 123 (24h)\n" +
      "- **Centrum Wsparcia:** 800 70 2222\n\n" +
      "Proszę, zadzwoń. Są przeszkoleni, żeby pomóc.",

    session_greeting: "Jak się dzisiaj czujesz?",

    not_a_therapist:
      "Pamiętaj: jestem AI, nie terapeutą. W poważnych sprawach zdrowia psychicznego " +
      "szukaj profesjonalnej pomocy.",
  },

  en: {
    disclaimer:
      "I'm ALLMA, an AI self-analysis companion. I'm not a therapist or counselor. " +
      "I can help you explore your thoughts and patterns, but I'm not a substitute " +
      "for professional mental health care. If you're in crisis, I'll provide the right resources.",

    onboarding_q1:
      "What brings you here? What would you like to explore about yourself?",

    onboarding_q2:
      "What's something you DON'T want to hear about yourself? " +
      "(That's usually where we need to look 👀)",

    onboarding_q3:
      "How do you react when someone hits a sore spot? " +
      "Shut down? Get angry? Deflect with humor?",

    crisis_response:
      "I hear you. What you're feeling is real and important. " +
      "I'm an AI — I can listen, but right now you need a real person.",

    crisis_resources:
      "🆘 **Crisis resources:**\n" +
      "- **988 Suicide & Crisis Lifeline:** 988 (US)\n" +
      "- **Crisis Text Line:** Text HOME to 741741\n" +
      "- **International:** findahelpline.com\n\n" +
      "Please reach out. They're trained for exactly this.",

    session_greeting: "How are you feeling today?",

    not_a_therapist:
      "Remember: I'm an AI, not a therapist. For serious mental health concerns, " +
      "please seek qualified professional help.",
  },

  es: {
    disclaimer:
      "Soy ALLMA, una compañera de autoanálisis con IA. No soy terapeuta ni consejera. " +
      "Puedo ayudarte a explorar tus pensamientos y patrones, pero no sustituyo la atención " +
      "profesional de salud mental. Si estás en crisis, te daré los recursos adecuados.",
    onboarding_q1: "¿Qué te trae aquí? ¿Qué te gustaría explorar sobre ti mismo/a?",
    onboarding_q2: "¿Qué es algo que NO quieres escuchar sobre ti? (Generalmente ahí es donde hay que mirar 👀)",
    onboarding_q3: "¿Cómo reaccionas cuando alguien toca un punto sensible? ¿Te cierras? ¿Te enojas? ¿Desvías con humor?",
    crisis_response: "Te escucho. Lo que sientes es real e importante. Soy una IA — puedo escuchar, pero ahora necesitas una persona real.",
    crisis_resources:
      "🆘 **Recursos de crisis:**\n" +
      "- **Teléfono de la Esperanza:** 717 003 717 (España)\n" +
      "- **Internacional:** findahelpline.com\n\n" +
      "Por favor, contacta. Están preparados para ayudar.",
    session_greeting: "¿Cómo te sientes hoy?",
    not_a_therapist: "Recuerda: soy una IA, no terapeuta. Para problemas serios de salud mental, busca ayuda profesional.",
  },

  de: {
    disclaimer:
      "Ich bin ALLMA, eine KI-Begleiterin für Selbstanalyse. Ich bin keine Therapeutin oder Beraterin. " +
      "Ich kann dir helfen, deine Gedanken und Muster zu erkunden, ersetze aber keine professionelle " +
      "psychische Gesundheitsversorgung. Bei einer Krise gebe ich dir die richtigen Ressourcen.",
    onboarding_q1: "Was führt dich her? Was möchtest du über dich selbst erkunden?",
    onboarding_q2: "Was willst du NICHT über dich hören? (Da müssen wir meistens hinschauen 👀)",
    onboarding_q3: "Wie reagierst du, wenn jemand einen wunden Punkt trifft? Machst du zu? Wirst du wütend? Lenkst du mit Humor ab?",
    crisis_response: "Ich höre dich. Was du fühlst, ist real und wichtig. Ich bin eine KI — ich kann zuhören, aber jetzt brauchst du einen echten Menschen.",
    crisis_resources:
      "🆘 **Krisenressourcen:**\n" +
      "- **Telefonseelsorge:** 0800 111 0 111 (24h, kostenlos)\n" +
      "- **International:** findahelpline.com\n\n" +
      "Bitte ruf an. Sie sind dafür ausgebildet.",
    session_greeting: "Wie fühlst du dich heute?",
    not_a_therapist: "Denk daran: Ich bin eine KI, keine Therapeutin. Bei ernsthaften psychischen Problemen such dir professionelle Hilfe.",
  },

  fr: {
    disclaimer:
      "Je suis ALLMA, une compagne d'auto-analyse par IA. Je ne suis ni thérapeute ni conseillère. " +
      "Je peux t'aider à explorer tes pensées et tes schémas, mais je ne remplace pas les soins " +
      "professionnels de santé mentale. En cas de crise, je te donnerai les bonnes ressources.",
    onboarding_q1: "Qu'est-ce qui t'amène ici ? Qu'aimerais-tu explorer sur toi-même ?",
    onboarding_q2: "Qu'est-ce que tu ne veux PAS entendre sur toi ? (C'est généralement là qu'il faut regarder 👀)",
    onboarding_q3: "Comment réagis-tu quand quelqu'un touche un point sensible ? Tu te fermes ? Tu t'énerves ? Tu détournes avec humour ?",
    crisis_response: "Je t'entends. Ce que tu ressens est réel et important. Je suis une IA — je peux écouter, mais tu as besoin d'une vraie personne maintenant.",
    crisis_resources:
      "🆘 **Ressources de crise :**\n" +
      "- **SOS Amitié :** 09 72 39 40 50 (24h)\n" +
      "- **International :** findahelpline.com\n\n" +
      "S'il te plaît, appelle. Ils sont formés pour ça.",
    session_greeting: "Comment tu te sens aujourd'hui ?",
    not_a_therapist: "Rappelle-toi : je suis une IA, pas une thérapeute. Pour des problèmes sérieux de santé mentale, cherche de l'aide professionnelle.",
  },

  it: {
    disclaimer:
      "Sono ALLMA, una compagna di autoanalisi con IA. Non sono una terapeuta né una consulente. " +
      "Posso aiutarti a esplorare i tuoi pensieri e i tuoi schemi, ma non sostituisco l'assistenza " +
      "professionale di salute mentale. In caso di crisi, ti darò le risorse giuste.",
    onboarding_q1: "Cosa ti porta qui? Cosa vorresti esplorare su di te?",
    onboarding_q2: "Cosa NON vuoi sentirti dire su di te? (Di solito è lì che bisogna guardare 👀)",
    onboarding_q3: "Come reagisci quando qualcuno tocca un tasto dolente? Ti chiudi? Ti arrabbi? Devii con l'umorismo?",
    crisis_response: "Ti ascolto. Quello che senti è reale e importante. Sono un'IA — posso ascoltare, ma ora hai bisogno di una persona reale.",
    crisis_resources:
      "🆘 **Risorse di crisi:**\n" +
      "- **Telefono Amico:** 02 2327 2327\n" +
      "- **Internazionale:** findahelpline.com\n\n" +
      "Per favore, chiama. Sono preparati per aiutare.",
    session_greeting: "Come ti senti oggi?",
    not_a_therapist: "Ricorda: sono un'IA, non una terapeuta. Per problemi seri di salute mentale, cerca aiuto professionale.",
  },

  zh: {
    disclaimer:
      "我是ALLMA，一个AI自我分析伙伴。我不是治疗师或咨询师。" +
      "我可以帮助你探索你的想法和模式，但我不能替代专业的心理健康服务。" +
      "如果你处于危机中，我会提供合适的资源。",
    onboarding_q1: "是什么让你来到这里？你想探索关于自己的什么？",
    onboarding_q2: "关于自己，你不想听到什么？（通常那里才是我们需要关注的地方 👀）",
    onboarding_q3: "当别人触碰到你的痛处时，你会怎样反应？封闭自己？生气？用幽默回避？",
    crisis_response: "我听到你了。你的感受是真实的、重要的。我是AI——我可以倾听，但你现在需要一个真实的人。",
    crisis_resources:
      "🆘 **危机资源：**\n" +
      "- **全国心理援助热线：** 400-161-9995\n" +
      "- **北京心理危机研究与干预中心：** 010-82951332\n" +
      "- **国际：** findahelpline.com\n\n" +
      "请拨打电话。他们受过专业训练来帮助你。",
    session_greeting: "你今天感觉怎么样？",
    not_a_therapist: "请记住：我是AI，不是治疗师。对于严重的心理健康问题，请寻求专业帮助。",
  },
};

export function t(lang: Language, key: keyof Translations): string {
  return translations[lang]?.[key] || translations.en[key];
}

export function getAllCrisisResources(): string {
  return [
    "🇧🇷 **Brasil:** CVV 188 (24h) | chat.cvv.org.br",
    "🇵🇱 **Polska:** Telefon Zaufania 116 123 (24h)",
    "🇺🇸 **USA:** 988 Suicide & Crisis Lifeline",
    "🇪🇸 **España:** Teléfono de la Esperanza 717 003 717",
    "🇩🇪 **Deutschland:** Telefonseelsorge 0800 111 0 111 (24h)",
    "🇫🇷 **France:** SOS Amitié 09 72 39 40 50 (24h)",
    "🇮🇹 **Italia:** Telefono Amico 02 2327 2327",
    "🇨🇳 **中国:** 全国心理援助热线 400-161-9995",
    "🌍 **International:** findahelpline.com",
  ].join("\n");
}
