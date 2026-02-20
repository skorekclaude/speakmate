/**
 * SpeakMate i18n — PL (main) + EN + PT
 */

const translations: Record<string, Record<string, string>> = {
  pl: {
    welcome: "Witaj w SpeakMate! Wybierz tutora i zacznij mówić.",
    send: "Wyślij",
    speak: "Przytrzymaj, żeby mówić",
    listening: "Słucham...",
    thinking: "Myślę...",
    correction: "Korekta",
    vocabulary: "Słownictwo",
    play: "Odtwórz",
    stop: "Stop",
    clear: "Wyczyść czat",
    agents: "Tutorzy",
    noCorrections: "Idealnie! Brak poprawek.",
    login: "Zaloguj się",
    startLearning: "Zacznij naukę",
    enterEmail: "Wpisz swój email...",
  },
  en: {
    welcome: "Welcome to SpeakMate! Choose a tutor and start speaking.",
    send: "Send",
    speak: "Hold to Talk",
    listening: "Listening...",
    thinking: "Thinking...",
    correction: "Correction",
    vocabulary: "Vocabulary",
    play: "Play",
    stop: "Stop",
    clear: "Clear Chat",
    agents: "Tutors",
    noCorrections: "Perfect! No corrections needed.",
    login: "Log in",
    startLearning: "Start Learning",
    enterEmail: "Enter your email...",
  },
  pt: {
    welcome: "Bem-vindo ao SpeakMate! Escolha um tutor e comece a falar.",
    send: "Enviar",
    speak: "Segure para Falar",
    listening: "Ouvindo...",
    thinking: "Pensando...",
    correction: "Correção",
    vocabulary: "Vocabulário",
    play: "Ouvir",
    stop: "Parar",
    clear: "Limpar Chat",
    agents: "Tutores",
    noCorrections: "Perfeito! Nenhuma correção necessária.",
    login: "Entrar",
    startLearning: "Começar a aprender",
    enterEmail: "Digite seu email...",
  },
};

export function t(key: string, lang: string = "en"): string {
  return translations[lang]?.[key] || translations["en"]?.[key] || key;
}
