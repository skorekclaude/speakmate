/**
 * SpeakMate — Internationalization (Polish UI only)
 *
 * The app UI is in Polish. Language learning happens in English/Portuguese.
 */

export type Language = "pl";

export function detectLanguage(_text: string): Language {
  return "pl"; // Always Polish UI
}

interface Translations {
  disclaimer: string;
  session_greeting: string;
  welcome: string;
}

const translations: Translations = {
  disclaimer:
    "Jestem SpeakMate, Twój AI tutor językowy. Pomagam uczyć się angielskiego " +
    "i portugalskiego przez naturalne rozmowy. Nie zastępuję nauczyciela — " +
    "jestem dodatkowym partnerem do ćwiczeń. Rozmawiaj ze mną jak z kolegą!",

  session_greeting: "Hej! Gotowy na naukę? O czym chcesz dziś porozmawiać po angielsku? 🗣️",

  welcome:
    "Witaj w SpeakMate! 👋

" +
    "Jestem Twoim AI tutorem językowym. Mogę pomóc Ci z:
" +
    "🗣️ Swobodna rozmowa po angielsku
" +
    "📝 Ćwiczenia gramatyczne
" +
    "📚 Słownictwo i idiomy
" +
    "🎤 Wymowa
" +
    "💼 Angielski biznesowy
" +
    "✈️ Angielski podróżniczy
" +
    "🎬 Slang i pop kultura
" +
    "🇧🇷 Portugalski od zera

" +
    "Napisz cokolwiek po angielsku, a ja odpowiem i poprawię Twoje błędy! 🚀",
};

export function t(key: keyof Translations): string {
  return translations[key];
}
