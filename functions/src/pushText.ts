/**
 * Text the server writes for the user to read without the AI: scheduled push
 * notifications (pushJobs.ts) and the no-AI weekly recap (recaps.ts), in the
 * user's app language.
 *
 * The language is the user doc's `language` (written by Settings, checked by
 * the rules), and it is still treated as untrusted: anything that is not one of
 * the six codes is English. The English entries are the exact sentences these
 * jobs always sent, byte for byte (proof:backend checks them), so an English
 * user sees no change. Placeholders like `{n}` are filled by `pushText`; a
 * translation keeps every placeholder of its English sentence
 * (proof:ailanguage checks that).
 *
 * Pure, no imports.
 */
export type PushLang = "en" | "ms" | "id" | "es" | "pt" | "hi";
export const PUSH_LANGS: readonly PushLang[] = ["en", "ms", "id", "es", "pt", "hi"];

/** The user doc's language, validated: anything unknown is English. */
export const pushLang = (raw: unknown): PushLang =>
  typeof raw === "string" && (PUSH_LANGS as readonly string[]).includes(raw) ? (raw as PushLang) : "en";

type Entry = Record<PushLang, string>;

export const PUSH_TEXT = {
  // --- Workout reminder ---
  "workout.title": {
    en: "Training window opens soon",
    ms: "Waktu latihan anda hampir tiba",
    id: "Waktu latihanmu segera tiba",
    es: "Tu hora de entrenar se acerca",
    pt: "Sua hora de treinar está chegando",
    hi: "आपके वर्कआउट का समय होने वाला है",
  },
  "workout.body": {
    en: "You usually train around {time}. 30 minutes — let's go.",
    ms: "Anda biasanya berlatih sekitar {time}. 30 minit — jom mula.",
    id: "Kamu biasanya latihan sekitar {time}. 30 menit — ayo mulai.",
    es: "Sueles entrenar sobre las {time}. 30 minutos: ¡vamos!",
    pt: "Você costuma treinar por volta das {time}. 30 minutos — bora!",
    hi: "आप आमतौर पर {time} के आसपास वर्कआउट करते हैं। 30 मिनट — चलिए शुरू करें।",
  },
  "workout.inbox": {
    en: "You usually train around {time}.",
    ms: "Anda biasanya berlatih sekitar {time}.",
    id: "Kamu biasanya latihan sekitar {time}.",
    es: "Sueles entrenar sobre las {time}.",
    pt: "Você costuma treinar por volta das {time}.",
    hi: "आप आमतौर पर {time} के आसपास वर्कआउट करते हैं।",
  },

  // --- Trial ending ---
  "trial.title": {
    en: "Your free trial ends tomorrow",
    ms: "Percubaan percuma anda tamat esok",
    id: "Uji coba gratismu berakhir besok",
    es: "Tu prueba gratuita termina mañana",
    pt: "Seu teste grátis termina amanhã",
    hi: "आपका फ्री ट्रायल कल खत्म हो रहा है",
  },
  "trial.body": {
    en: "Keep your AI coach, form check & analytics — subscribe to stay Pro.",
    ms: "Kekalkan jurulatih AI, semakan postur & analitik anda — langgan untuk kekal Pro.",
    id: "Tetap pakai pelatih AI, cek postur & analitikmu — berlangganan agar tetap Pro.",
    es: "Conserva tu coach con IA, la revisión de técnica y tus estadísticas: suscríbete para seguir en Pro.",
    pt: "Mantenha seu coach com IA, a análise de postura e as estatísticas — assine para continuar Pro.",
    hi: "अपना AI कोच, फ़ॉर्म चेक और एनालिटिक्स बनाए रखें — Pro बने रहने के लिए सब्सक्राइब करें।",
  },
  "trial.inbox": {
    en: "Subscribe to keep FitFlow Pro.",
    ms: "Langgan untuk kekalkan FitFlow Pro.",
    id: "Berlangganan untuk tetap memakai FitFlow Pro.",
    es: "Suscríbete para conservar FitFlow Pro.",
    pt: "Assine para manter o FitFlow Pro.",
    hi: "FitFlow Pro बनाए रखने के लिए सब्सक्राइब करें।",
  },

  // --- Streak at risk ---
  "streak.title": {
    en: "🔥 Your {n}-day streak ends at midnight",
    ms: "🔥 Rentetan {n} hari anda tamat tengah malam ini",
    id: "🔥 Streak {n} harimu berakhir tengah malam",
    es: "🔥 Tu racha de {n} días termina a medianoche",
    pt: "🔥 Sua sequência de {n} dias acaba à meia-noite",
    hi: "🔥 आपकी {n} दिन की स्ट्रीक आधी रात को खत्म हो जाएगी",
  },
  "streak.body": {
    en: "Don't lose it now — a quick log keeps your {n}-day streak alive.",
    ms: "Jangan lepaskan sekarang — satu log ringkas mengekalkan rentetan {n} hari anda.",
    id: "Jangan sampai hilang — satu catatan singkat menjaga streak {n} harimu.",
    es: "No la pierdas ahora: un registro rápido mantiene viva tu racha de {n} días.",
    pt: "Não perca agora — um registro rápido mantém viva sua sequência de {n} dias.",
    hi: "इसे अभी मत खोइए — एक छोटा सा लॉग आपकी {n} दिन की स्ट्रीक बचा लेगा।",
  },

  // --- Meal nudge ---
  "meal.title": {
    en: "Haven't logged today?",
    ms: "Belum log hari ini?",
    id: "Belum mencatat hari ini?",
    es: "¿Aún no has registrado nada hoy?",
    pt: "Ainda não registrou nada hoje?",
    hi: "आज अभी तक लॉग नहीं किया?",
  },
  "meal.body": {
    en: "Capture a meal in 2 taps — scan a barcode or just describe it.",
    ms: "Rekod makanan dalam 2 ketikan — imbas kod bar atau terangkan sahaja.",
    id: "Catat makanan dalam 2 ketukan — pindai barcode atau cukup jelaskan.",
    es: "Registra una comida en 2 toques: escanea un código de barras o descríbela.",
    pt: "Registre uma refeição em 2 toques — escaneie um código de barras ou só descreva.",
    hi: "2 टैप में भोजन दर्ज करें — बारकोड स्कैन करें या बस बताइए।",
  },

  // --- Win-back (1/3/7/14/30 days away) ---
  "winback.1.title": {
    en: "Pick up where you left off",
    ms: "Sambung dari tempat anda berhenti",
    id: "Lanjutkan dari terakhir kali",
    es: "Retoma donde lo dejaste",
    pt: "Continue de onde parou",
    hi: "जहाँ छोड़ा था, वहीं से शुरू करें",
  },
  "winback.1.body": {
    en: "A 2-minute log keeps your momentum going. You’ve got this.",
    ms: "Log 2 minit mengekalkan momentum anda. Anda boleh!",
    id: "Catatan 2 menit menjaga momentummu. Kamu pasti bisa.",
    es: "Un registro de 2 minutos mantiene tu impulso. Tú puedes.",
    pt: "Um registro de 2 minutos mantém seu ritmo. Você consegue.",
    hi: "2 मिनट का लॉग आपकी रफ़्तार बनाए रखता है। आप कर सकते हैं।",
  },
  "winback.3.title": {
    en: "Your coach misses you",
    ms: "Jurulatih anda rindukan anda",
    id: "Pelatihmu merindukanmu",
    es: "Tu coach te echa de menos",
    pt: "Seu coach sente sua falta",
    hi: "आपका कोच आपको याद कर रहा है",
  },
  "winback.3.body": {
    en: "Three days off is fine — jump back in and we’ll adjust your plan.",
    ms: "Rehat tiga hari tidak mengapa — kembali semula dan kami akan sesuaikan pelan anda.",
    id: "Libur tiga hari tidak apa-apa — kembali lagi dan kami sesuaikan rencanamu.",
    es: "Tres días de descanso está bien: vuelve y ajustaremos tu plan.",
    pt: "Três dias de pausa tudo bem — volte e a gente ajusta seu plano.",
    hi: "तीन दिन का ब्रेक ठीक है — वापस आइए, हम आपका प्लान बदल देंगे।",
  },
  "winback.7.title": {
    en: "One week — let’s restart",
    ms: "Seminggu — jom mula semula",
    id: "Seminggu — ayo mulai lagi",
    es: "Una semana: volvamos a empezar",
    pt: "Uma semana — vamos recomeçar",
    hi: "एक हफ़्ता — चलिए फिर से शुरू करें",
  },
  "winback.7.body": {
    en: "A fresh week is the perfect reset. Log one thing to get rolling.",
    ms: "Minggu baharu ialah permulaan yang sempurna. Log satu perkara untuk bermula.",
    id: "Minggu baru adalah awal yang sempurna. Catat satu hal untuk memulai.",
    es: "Una semana nueva es el reinicio perfecto. Registra una cosa para arrancar.",
    pt: "Uma semana nova é o recomeço perfeito. Registre uma coisa para engrenar.",
    hi: "नया हफ़्ता नई शुरुआत के लिए एकदम सही है। शुरू करने के लिए एक चीज़ लॉग करें।",
  },
  "winback.14.title": {
    en: "Still here for you",
    ms: "Masih di sini untuk anda",
    id: "Masih di sini untukmu",
    es: "Seguimos aquí para ti",
    pt: "Continuamos aqui por você",
    hi: "हम अब भी आपके साथ हैं",
  },
  "winback.14.body": {
    en: "Two weeks out. Your data’s exactly where you left it — come finish what you started.",
    ms: "Dua minggu berlalu. Data anda masih seperti yang anda tinggalkan — mari habiskan apa yang anda mulakan.",
    id: "Sudah dua minggu. Datamu masih seperti saat kamu tinggalkan — ayo selesaikan yang sudah kamu mulai.",
    es: "Dos semanas fuera. Tus datos están tal como los dejaste: vuelve a terminar lo que empezaste.",
    pt: "Duas semanas fora. Seus dados estão exatamente onde você deixou — volte para terminar o que começou.",
    hi: "दो हफ़्ते हो गए। आपका डेटा वैसा ही है जैसा आपने छोड़ा था — जो शुरू किया था, उसे पूरा कीजिए।",
  },
  "winback.30.title": {
    en: "We saved your spot",
    ms: "Tempat anda masih kami simpan",
    id: "Tempatmu masih kami simpan",
    es: "Te guardamos el sitio",
    pt: "Guardamos o seu lugar",
    hi: "हमने आपकी जगह संभाल रखी है",
  },
  "winback.30.body": {
    en: "A month away happens. One tap brings your whole plan back to life.",
    ms: "Sebulan berehat memang biasa. Satu ketikan menghidupkan semula seluruh pelan anda.",
    id: "Sebulan absen itu wajar. Satu ketukan menghidupkan lagi seluruh rencanamu.",
    es: "Un mes fuera le pasa a cualquiera. Un toque y todo tu plan vuelve a la vida.",
    pt: "Um mês longe acontece. Um toque traz todo o seu plano de volta.",
    hi: "एक महीने का ब्रेक हो जाता है। एक टैप से आपका पूरा प्लान फिर से शुरू हो जाएगा।",
  },

  // --- Weekly recap push + the recap written without the AI ---
  "recap.pushTitle": {
    en: "Your weekly recap is ready",
    ms: "Rumusan mingguan anda sudah sedia",
    id: "Rangkuman mingguanmu sudah siap",
    es: "Tu resumen semanal está listo",
    pt: "Seu resumo semanal está pronto",
    hi: "आपका साप्ताहिक रिकैप तैयार है",
  },
  "recap.headline.strong": {
    en: "A strong week of training.",
    ms: "Minggu latihan yang mantap.",
    id: "Minggu latihan yang kuat.",
    es: "Una semana de entrenamiento sólida.",
    pt: "Uma semana forte de treino.",
    hi: "ट्रेनिंग का एक दमदार हफ़्ता।",
  },
  "recap.headline.moving": {
    en: "You kept moving this week.",
    ms: "Anda terus aktif minggu ini.",
    id: "Kamu tetap bergerak minggu ini.",
    es: "Esta semana seguiste en movimiento.",
    pt: "Você se manteve em movimento esta semana.",
    hi: "इस हफ़्ते आप सक्रिय रहे।",
  },
  "recap.headline.logging": {
    en: "A week of steady logging.",
    ms: "Seminggu mencatat dengan konsisten.",
    id: "Seminggu pencatatan yang konsisten.",
    es: "Una semana de registros constantes.",
    pt: "Uma semana de registros constantes.",
    hi: "लगातार लॉगिंग का एक हफ़्ता।",
  },
  // The highlight is these parts joined with ", " and ended with ".".
  "recap.workouts.one": {
    en: "{n} workout",
    ms: "{n} sesi latihan",
    id: "{n} latihan",
    es: "{n} entrenamiento",
    pt: "{n} treino",
    hi: "{n} वर्कआउट",
  },
  "recap.workouts.other": {
    en: "{n} workouts",
    ms: "{n} sesi latihan",
    id: "{n} latihan",
    es: "{n} entrenamientos",
    pt: "{n} treinos",
    hi: "{n} वर्कआउट",
  },
  "recap.minutes": {
    en: "{n} active minutes",
    ms: "{n} minit aktif",
    id: "{n} menit aktif",
    es: "{n} minutos activos",
    pt: "{n} minutos ativos",
    hi: "{n} सक्रिय मिनट",
  },
  "recap.logged": {
    en: "{energy} logged",
    ms: "{energy} direkodkan",
    id: "{energy} tercatat",
    es: "{energy} registradas",
    pt: "{energy} registradas",
    hi: "{energy} लॉग की गईं",
  },
  "recap.water": {
    en: "{water} of water",
    ms: "{water} air",
    id: "{water} air",
    es: "{water} de agua",
    pt: "{water} de água",
    hi: "{water} पानी",
  },
  "recap.win.streak": {
    en: "A {n}-day streak — consistency is doing the work.",
    ms: "Rentetan {n} hari — konsistensi sedang membuahkan hasil.",
    id: "Streak {n} hari — konsistensi sedang bekerja.",
    es: "Una racha de {n} días: la constancia está haciendo el trabajo.",
    pt: "Uma sequência de {n} dias — a constância está fazendo o trabalho.",
    hi: "{n} दिन की स्ट्रीक — निरंतरता अपना काम कर रही है।",
  },
  "recap.win.logs": {
    en: "Every log this week is data your plan can use.",
    ms: "Setiap log minggu ini ialah data yang boleh digunakan oleh pelan anda.",
    id: "Setiap catatan minggu ini adalah data yang bisa dipakai rencanamu.",
    es: "Cada registro de esta semana es un dato que tu plan puede usar.",
    pt: "Cada registro desta semana é um dado que seu plano pode usar.",
    hi: "इस हफ़्ते का हर लॉग ऐसा डेटा है जिसे आपका प्लान इस्तेमाल कर सकता है।",
  },
  "recap.focus.session": {
    en: "One more session than last week.",
    ms: "Satu sesi lebih daripada minggu lepas.",
    id: "Satu sesi lebih banyak dari minggu lalu.",
    es: "Una sesión más que la semana pasada.",
    pt: "Uma sessão a mais que na semana passada.",
    hi: "पिछले हफ़्ते से एक सेशन ज़्यादा।",
  },
  "recap.focus.waterMetric": {
    en: "Hydration — aim for 2 L a day.",
    ms: "Hidrasi — sasarkan 2 L sehari.",
    id: "Hidrasi — targetkan 2 L sehari.",
    es: "Hidratación: apunta a 2 L al día.",
    pt: "Hidratação — mire em 2 L por dia.",
    hi: "हाइड्रेशन — रोज़ 2 L पानी का लक्ष्य रखें।",
  },
  "recap.focus.waterImperial": {
    en: "Hydration — aim for about 68 fl oz a day.",
    ms: "Hidrasi — sasarkan kira-kira 68 fl oz sehari.",
    id: "Hidrasi — targetkan sekitar 68 fl oz sehari.",
    es: "Hidratación: apunta a unas 68 fl oz al día.",
    pt: "Hidratação — mire em cerca de 68 fl oz por dia.",
    hi: "हाइड्रेशन — रोज़ लगभग 68 fl oz पानी का लक्ष्य रखें।",
  },
  "recap.focus.sleep": {
    en: "Sleep — it is where training turns into progress.",
    ms: "Tidur — di situlah latihan bertukar menjadi kemajuan.",
    id: "Tidur — di sanalah latihan berubah menjadi kemajuan.",
    es: "El sueño: ahí es donde el entrenamiento se convierte en progreso.",
    pt: "Sono — é nele que o treino vira progresso.",
    hi: "नींद — यहीं ट्रेनिंग तरक्की में बदलती है।",
  },
  "recap.next.session": {
    en: "Put a 30-minute session in your calendar for Monday.",
    ms: "Masukkan sesi 30 minit dalam kalendar anda untuk hari Isnin.",
    id: "Masukkan sesi 30 menit ke kalendermu untuk hari Senin.",
    es: "Agenda una sesión de 30 minutos para el lunes.",
    pt: "Coloque uma sessão de 30 minutos na sua agenda para segunda-feira.",
    hi: "सोमवार के लिए अपने कैलेंडर में 30 मिनट का सेशन रखें।",
  },
  "recap.next.breakfast": {
    en: "Log breakfast before 10am on Monday.",
    ms: "Log sarapan sebelum 10 pagi pada hari Isnin.",
    id: "Catat sarapan sebelum jam 10 pagi hari Senin.",
    es: "Registra el desayuno antes de las 10 a. m. del lunes.",
    pt: "Registre o café da manhã antes das 10h na segunda-feira.",
    hi: "सोमवार को सुबह 10 बजे से पहले नाश्ता लॉग करें।",
  },
} satisfies Record<string, Entry>;

export type PushTextKey = keyof typeof PUSH_TEXT;

/** The sentence in the user's language, placeholders filled. An unknown placeholder stays visible. */
export const pushText = (lang: unknown, key: PushTextKey, vars?: Record<string, string | number>): string => {
  const s = PUSH_TEXT[key][pushLang(lang)];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
};
