// Food catalog expansion, batch 3: Malaysia — node scripts/expand-foods-3.mjs [--write]
//
// Open Food Facts is thin for Malaysia, and nothing online knows what a plate
// at the mamak or the pasar malam holds. This batch is for the offline list:
// more hawker and kopitiam dishes, lauk for nasi campur by the scoop, kuih,
// mamak drinks in their kosong / kurang manis forms, festive food, and the
// local fast-food chains.
//
// Same rules as batch 2: a serving in the name, aliases for how people type it,
// and the macro sanity gate. Values are typical servings from published
// Malaysian food-composition references and chain menus, rounded. They are
// estimates for logging; replace any of them when a real label is to hand.
//
// After running with --write, run: npx tsx scripts/dedupe-foods.mjs --write

import { readFileSync, writeFileSync } from 'node:fs';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const FILE = stripDrive(new URL('../', import.meta.url).pathname) + 'scripts/data/common-foods.json';
const WRITE = process.argv.includes('--write');

const F = (name, calories, protein, carbs, fats, aliases = [], brand) => ({
  name, calories, protein, carbs, fats,
  ...(aliases.length ? { aliases } : {}),
  ...(brand ? { brand } : {}),
});

const NEW = [
  // ── Lauk for nasi campur, by the scoop ────────────────────────────────────
  F('Ayam Masak Lemak Cili Api (1 piece)', 310, 24, 5, 22, ['ayam masak lemak', 'masak lemak ayam', 'gulai lemak ayam']),
  F('Ayam Rendang (1 piece)', 330, 25, 7, 23, ['rendang ayam', 'chicken rendang']),
  F('Ayam Masak Kari Kentang (1 serving)', 320, 24, 14, 19, ['kari ayam kentang']),
  F('Ayam Paprik (1 serving)', 290, 26, 12, 15, ['paprik ayam']),
  F('Ayam Goreng Kunyit (1 serving)', 300, 26, 8, 18, ['ayam kunyit', 'turmeric chicken']),
  F('Ayam Bakar (1 piece)', 250, 28, 4, 13, ['grilled chicken malay', 'ayam panggang madu']),
  F('Ayam Sambal (1 piece)', 310, 24, 10, 19, ['sambal ayam', 'ayam masak sambal']),
  F('Daging Masak Hitam (1 serving)', 320, 26, 12, 18, ['daging hitam', 'daging masak kicap']),
  F('Daging Dendeng (1 serving)', 340, 28, 14, 19, ['dendeng daging']),
  F('Daging Goreng Kunyit (1 serving)', 300, 27, 6, 19, ['daging kunyit']),
  F('Gulai Daging (1 serving)', 330, 25, 8, 22, ['kari daging', 'beef curry']),
  F('Sup Daging (1 bowl)', 190, 20, 8, 9, ['sup tulang', 'beef soup', 'sup gearbox']),
  F('Sup Kambing (1 bowl)', 250, 22, 8, 14, ['mutton soup', 'sup kambing mamak']),
  F('Kambing Masak Kurma (1 serving)', 360, 24, 10, 25, ['kurma kambing', 'mutton kurma']),
  F('Ikan Masak Asam Pedas (1 piece)', 210, 24, 8, 9, ['asam pedas', 'asam pedas ikan pari', 'ikan asam pedas']),
  F('Ikan Masak Lemak (1 piece)', 270, 23, 5, 18, ['gulai ikan masak lemak', 'ikan masak lemak cili api']),
  F('Ikan Tiga Rasa (1 serving)', 330, 26, 22, 15, ['ikan 3 rasa', 'ikan siakap tiga rasa']),
  F('Ikan Siakap Stim Limau (1 serving)', 220, 32, 5, 8, ['siakap stim', 'siakap steam limau']),
  F('Ikan Keli Goreng (1 fish)', 290, 24, 4, 20, ['keli goreng', 'pecel lele', 'fried catfish']),
  F('Ikan Pari Bakar (1 serving)', 210, 30, 3, 9, ['pari bakar', 'grilled stingray']),
  F('Ikan Masin Goreng (20g)', 60, 9, 0, 3, ['ikan masin', 'salted fish']),
  F('Sambal Sotong (1 serving)', 240, 20, 12, 12, ['sotong sambal', 'sotong masak sambal']),
  F('Udang Goreng Kunyit (1 serving)', 230, 22, 6, 13, ['udang kunyit']),
  F('Udang Masak Lemak (1 serving)', 280, 20, 6, 20, ['udang masak lemak nenas']),
  F('Kerang Rebus (1 plate)', 120, 18, 6, 2, ['kerang', 'cockles', 'kerang bakar']),
  F('Telur Masak Kicap (1 egg)', 130, 7, 5, 9, ['telur kicap']),
  F('Telur Bungkus (1 serving)', 280, 16, 8, 20, ['telur bungkus daging']),
  F('Telur Masin (1 egg)', 130, 9, 1, 10, ['salted egg', 'telur asin']),
  F('Sambal Telur (1 egg)', 150, 7, 6, 11, ['telur sambal', 'sambal tumis telur']),
  F('Tauhu Sumbat (2 pieces)', 190, 9, 12, 12, ['stuffed tofu']),
  F('Tempe Goreng Sambal (1 serving)', 240, 13, 14, 15, ['sambal tempe', 'tempe sambal', 'sambal goreng tempe']),
  F('Sambal Petai Udang (1 serving)', 260, 17, 14, 15, ['petai', 'sambal petai', 'udang petai']),
  F('Sayur Kailan Ikan Masin (1 serving)', 150, 8, 8, 10, ['kailan ikan masin', 'kailan']),
  F('Sayur Bayam Masak Air (1 serving)', 60, 4, 6, 2, ['bayam', 'sup bayam', 'spinach soup malay']),
  F('Pucuk Ubi Masak Lemak (1 serving)', 170, 5, 10, 13, ['pucuk ubi', 'masak lemak pucuk ubi']),
  F('Terung Sambal (1 serving)', 150, 2, 12, 11, ['sambal terung', 'terung goreng sambal']),
  F('Kobis Goreng (1 serving)', 110, 3, 9, 7, ['kubis goreng', 'fried cabbage']),
  F('Kacang Panjang Goreng (1 serving)', 110, 4, 9, 7, ['kacang panjang goreng telur']),
  F('Ulam with Sambal Belacan (1 serving)', 60, 3, 9, 2, ['ulam', 'ulam raja', 'ulam ulaman']),
  F('Acar Timun (1 serving)', 60, 1, 12, 1, ['acar', 'acar rampai', 'pickled cucumber']),
  F('Budu (1 tbsp)', 15, 2, 1, 0, ['sos budu']),
  F('Tempoyak (1 tbsp)', 30, 0, 6, 1, ['sambal tempoyak']),
  F('Serunding Daging (2 tbsp)', 110, 8, 6, 6, ['serunding', 'meat floss']),
  F('Rendang Tok (1 serving)', 420, 28, 8, 31, ['rendang tok perak']),

  // ── Rice and noodle plates ────────────────────────────────────────────────
  F('Nasi Ayam Goreng Kunyit', 690, 30, 84, 26, ['nasi ayam kunyit', 'nasi goreng kunyit ayam']),
  F('Nasi Ayam Madu', 700, 30, 88, 25, ['nasi ayam bakar', 'nasi ayam panggang']),
  F('Nasi Bujang', 480, 14, 78, 12, ['nasi telur kicap', 'nasi telur mata']),
  F('Nasi Goreng Cina', 590, 18, 80, 22, ['nasi goreng cina ayam', 'chinese fried rice malay']),
  F('Nasi Goreng Tomyam', 660, 22, 86, 25, ['nasi goreng tom yam']),
  F('Nasi Goreng Ikan Masin', 640, 20, 84, 25, ['nasi goreng ikan bilis', 'salted fish fried rice']),
  F('Nasi Goreng Belacan', 650, 20, 84, 26, ['nasi goreng sambal belacan']),
  F('Nasi Goreng Daging', 720, 30, 86, 28, ['nasi goreng daging merah', 'beef fried rice']),
  F('Nasi Goreng Seafood', 680, 26, 86, 25, ['nasi goreng udang', 'seafood fried rice']),
  F('Nasi Hujan Panas', 560, 12, 88, 17, ['nasi minyak', 'nasi hujan panas kenduri']),
  F('Nasi Minyak with Ayam Masak Merah', 780, 32, 92, 31, ['nasi minyak ayam', 'nasi kenduri']),
  F('Nasi Ambeng (1 portion)', 820, 34, 96, 33, ['nasi ambang']),
  F('Nasi Ulam', 420, 12, 70, 10, ['nasi ulam kelantan']),
  F('Nasi Tumpang', 520, 20, 74, 16),
  F('Nasi Dalca', 640, 22, 88, 22, ['nasi dalcha', 'dalca']),
  F('Nasi Kak Wok', 700, 28, 84, 28, ['nasi kak wok kelantan']),
  F('Nasi Berlauk', 560, 22, 72, 20, ['nasi berlauk ayam', 'nasi berlauk ikan']),
  F('Nasi Lemak Sotong', 760, 28, 86, 33, ['nasi lemak sambal sotong']),
  F('Nasi Lemak Telur Goreng', 520, 15, 62, 23, ['nasi lemak telur', 'nasi lemak telur mata']),
  F('Nasi Kerabu with Ayam Bakar', 700, 34, 82, 26, ['nasi kerabu ayam']),
  F('Bubur Lambuk (1 bowl)', 280, 12, 40, 8, ['bubur lambuk ramadan']),
  F('Bubur Nasi with Ikan Bilis (1 bowl)', 220, 10, 34, 5, ['bubur ikan bilis', 'bubur berlauk']),
  F('Mee Kari Ayam', 620, 26, 64, 29, ['mee kari', 'kari mee ayam']),
  F('Mee Sup Ayam', 390, 20, 54, 10, ['mee sup', 'mi sup']),
  F('Mee Goreng Basah', 560, 18, 74, 21, ['mi goreng basah']),
  F('Mee Udang (1 bowl)', 540, 26, 64, 20, ['mee udang banjir', 'mi udang']),
  F('Mee Celup', 430, 18, 58, 14, ['mee celup kelantan']),
  F('Mee Kolok', 480, 20, 62, 17, ['kolo mee', 'mee kolo', 'sarawak kolo mee']),
  F('Laksa Sarawak', 560, 24, 58, 26, ['sarawak laksa']),
  F('Laksa Kedah', 420, 18, 62, 11, ['laksa utara', 'laksa perlis']),
  F('Laksam', 430, 16, 58, 15, ['laksam kelantan']),
  F('Kuey Teow Sup Ayam', 360, 20, 50, 9, ['kuey teow sup', 'koay teow sup ayam']),
  F('Kuey Teow Goreng Basah', 600, 20, 76, 24, ['kuey teow basah', 'kuetiau goreng basah']),
  F('Kuey Teow Kerang', 680, 22, 78, 31, ['char kuey teow kerang', 'kuetiau kerang']),
  F('Bihun Sup', 300, 16, 44, 7, ['bihun sup ayam', 'mee hoon soup malay']),
  F('Bihun Goreng Singapore', 480, 16, 70, 15, ['bihun singapore', 'singapore noodles']),
  F('Bihun Tomyam', 420, 20, 56, 13, ['bihun tom yam', 'mee hoon tomyam']),
  F('Mee Tomyam', 480, 22, 60, 17, ['mee tom yam', 'mi tomyam']),
  F('Maggi Goreng Mamak with Egg', 640, 20, 76, 28, ['maggi goreng telur', 'maggi goreng telur mata']),
  F('Maggi Sup Telur', 430, 14, 54, 17, ['maggi sup telur', 'maggi kuah telur']),
  F('Indomie Goreng Telur (stall)', 520, 16, 62, 23, ['indomie goreng telur', 'indomie telur']),
  F('Yee Mee Sup', 450, 18, 56, 17, ['yee mee', 'claypot yee mee']),
  F('Loh Shu Fun (claypot)', 520, 20, 62, 21, ['lou shu fun', 'rat noodles']),
  F('Hakka Mee', 460, 20, 60, 15, ['hakka noodles']),
  F('Curry Chee Cheong Fun', 380, 9, 54, 14, ['chee cheong fun kari']),
  F('Lontong Kuah Lodeh', 480, 13, 58, 22, ['lontong sayur', 'lontong kering']),
  F('Soto Ayam with Nasi Impit', 420, 24, 48, 14, ['soto nasi impit', 'soto ayam nasi impit']),

  // ── Mamak, roti and breakfast ─────────────────────────────────────────────
  F('Roti Canai Telur Bawang (1 piece)', 440, 13, 44, 23, ['roti telur bawang']),
  F('Roti Pisang (1 piece)', 420, 7, 60, 17, ['roti banana']),
  F('Roti Milo (1 piece)', 440, 8, 60, 19),
  F('Roti Cheese (1 piece)', 430, 12, 42, 23, ['roti canai cheese', 'roti keju']),
  F('Roti Kaya (1 piece)', 400, 7, 58, 15, ['roti canai kaya']),
  F('Roti Jala with Kari Ayam (1 serving)', 420, 18, 44, 19, ['roti jala']),
  F('Roti Arab with Dhal (1 piece)', 360, 10, 56, 10, ['roti nan', 'roti naan dhal']),
  F('Naan with Tandoori Chicken (set)', 620, 40, 58, 24, ['naan tandoori', 'nan tandoori', 'roti nan tandoori']),
  F('Tosai Telur (1 piece)', 260, 11, 32, 10, ['thosai telur', 'egg dosa']),
  F('Tosai Rawa (1 piece)', 230, 5, 36, 7, ['rava dosa', 'thosai rawa']),
  F('Mee Goreng Mamak with Egg', 720, 24, 84, 31, ['mee goreng telur', 'mee goreng mamak telur']),
  F('Nasi Goreng Mamak', 680, 22, 86, 27),
  F('Pasembur (1 plate)', 520, 16, 62, 23, ['rojak mamak', 'rojak pasembor']),
  F('Lempeng (1 piece)', 180, 4, 30, 5, ['lempeng kelapa', 'lempeng pisang']),
  F('Cekodok Pisang (4 pieces)', 260, 3, 42, 9, ['cekodok', 'jemput jemput', 'kuih kodok', 'jemput pisang']),
  F('Cucur Bawang (4 pieces)', 240, 4, 32, 11, ['cucur', 'cucur ikan bilis', 'jemput bawang']),
  F('Nasi Lemak Kukus Ayam Goreng', 860, 34, 90, 40, ['nasi lemak kukus', 'nasi lemak ayam goreng berempah']),
  F('Roti Bakar with Half-Boiled Eggs (set)', 380, 18, 34, 19, ['set roti bakar', 'kopitiam breakfast set', 'roti bakar telur separuh masak']),
  F('Roti Kahwin (1 set)', 300, 6, 38, 14, ['roti kahwin butter kaya']),
  F('Chee Cheong Fun with Sweet Sauce (1 plate)', 260, 6, 50, 4, ['ccf', 'chee cheong fun penang']),
  F('Yau Char Kwai with Soy Milk (set)', 330, 10, 42, 14, ['youtiao soy milk', 'cakoi air soya']),

  // ── Kuih, snacks and pasar malam ──────────────────────────────────────────
  F('Kuih Koci (1 piece)', 140, 2, 26, 3, ['koci', 'kuih koci pulut hitam']),
  F('Kuih Talam (1 piece)', 150, 2, 26, 4, ['talam', 'kuih talam pandan']),
  F('Kuih Cara Berlauk (3 pieces)', 150, 5, 18, 6, ['cara berlauk']),
  F('Kuih Cara Manis (3 pieces)', 140, 2, 24, 4, ['cara manis']),
  F('Kuih Keria (1 piece)', 160, 2, 28, 5, ['keria', 'keria gula melaka']),
  F('Kuih Lopes (1 piece)', 180, 2, 36, 3, ['lopes', 'lupis']),
  F('Kuih Bingka Ubi (1 piece)', 190, 2, 32, 6, ['bingka ubi', 'bingka']),
  F('Kuih Bakar (1 piece)', 170, 3, 26, 6, ['kuih bakar pandan']),
  F('Kuih Apam (2 pieces)', 150, 3, 30, 2, ['apam', 'apam gula hangus', 'apam beras']),
  F('Kuih Putu Piring (2 pieces)', 190, 2, 40, 2, ['putu piring']),
  F('Kuih Putu Bambu (2 pieces)', 180, 2, 36, 3, ['putu bambu', 'putu buluh']),
  F('Kuih Kasui (2 pieces)', 130, 1, 28, 2, ['kasui', 'kosui']),
  F('Kuih Tepung Pelita (2 pieces)', 150, 1, 24, 6, ['tepung pelita']),
  F('Pulut Panggang (1 piece)', 190, 5, 30, 6, ['pulut panggang', 'rempah udang']),
  F('Pulut Inti (1 piece)', 200, 3, 38, 4, ['pulut inti']),
  F('Pulut Kuning with Rendang (1 serving)', 520, 20, 62, 21, ['pulut kuning', 'pulut kuning rendang']),
  F('Dodol (2 pieces)', 150, 1, 30, 3, ['dodol durian']),
  F('Wajik (1 piece)', 190, 2, 40, 3, ['wajid']),
  F('Bahulu Kemboja (1 piece)', 140, 3, 20, 5, ['kuih kemboja']),
  F('Kuih Kapit (5 pieces)', 110, 2, 18, 4, ['love letters', 'kuih kapit raya']),
  F('Kuih Makmur (2 pieces)', 160, 2, 18, 9, ['makmur', 'biskut makmur']),
  F('Biskut Raya (3 pieces)', 150, 2, 18, 8, ['biskut raya', 'kuih raya', 'biskut mazola', 'biskut suji']),
  F('Lemang with Rendang (1 serving)', 560, 24, 46, 31, ['lemang rendang']),
  F('Ketupat Palas (2 pieces)', 280, 5, 54, 5, ['ketupat palas', 'ketupat daun palas']),
  F('Ketupat with Kuah Kacang (1 serving)', 360, 9, 52, 13, ['ketupat kuah kacang', 'nasi impit kuah kacang']),
  F('Satay Kajang with Kuah Kacang (10 sticks)', 720, 54, 30, 43, ['satay kajang', 'sate kajang']),
  F('Ayam Golek (quarter)', 310, 32, 4, 18, ['ayam golek pasar malam']),
  F('Ayam Percik Kelantan (quarter)', 380, 32, 12, 23, ['ayam percik kelantan']),
  F('Murtabak Ayam (1 piece)', 520, 26, 50, 24, ['murtabak ayam', 'martabak ayam']),
  F('Murtabak Daging (1 piece)', 580, 28, 50, 30, ['murtabak daging']),
  F('Apam Balik Nipis (1 piece)', 180, 3, 30, 6, ['apam balik rangup', 'apam balik crispy']),
  F('Putu Mayam with Gula Merah (1 serving)', 260, 3, 54, 4, ['putu mayam gula merah']),
  F('Takoyaki Pasar Malam (6 pieces)', 300, 9, 36, 13, ['takoyaki pasar malam']),
  F('Sosej Goreng Cheese (1 stick)', 220, 8, 14, 15, ['sosej cheese', 'sosej pasar malam', 'cheese sausage stick']),
  F('Ayam Gunting (1 piece)', 480, 26, 32, 28, ['ayam gunting', 'uncle bob', 'crispy chicken cutlet pasar malam']),
  F('Keropok Lekor Goreng (5 pieces)', 250, 9, 32, 10, ['lekor goreng', 'keropok lekor losong']),
  F('Lok Lok (5 sticks)', 220, 14, 16, 11, ['lok lok', 'steamboat sticks']),
  F('Pisang Goreng Cheese (1 serving)', 420, 7, 56, 19, ['pisang cheese', 'pisang goreng coklat cheese']),
  F('Durian Crepe (1 piece)', 190, 2, 20, 11, ['crepe durian']),
  F('Cendol Pulut (1 bowl)', 380, 5, 64, 12, ['cendol pulut', 'cendol durian']),
  F('ABC Special (1 bowl)', 340, 5, 66, 7, ['abc special', 'ais kacang special']),
  F('Bubur Kacang Hijau (1 bowl)', 230, 8, 38, 5, ['bubur kacang', 'green bean porridge']),
  F('Bubur Pulut Hitam (1 bowl)', 260, 5, 46, 7, ['pulut hitam', 'black glutinous rice porridge']),
  F('Pengat Pisang (1 bowl)', 280, 2, 48, 9, ['pengat', 'serawa pisang']),
  F('Sago Gula Melaka (1 serving)', 240, 1, 44, 7, ['sago gula melaka', 'sagu gula melaka']),
  F('Leng Chee Kang (1 bowl)', 180, 2, 42, 1, ['leng chee kang', 'lin chee kang']),
  F('Tong Sui Red Bean (1 bowl)', 200, 7, 40, 1, ['red bean soup', 'tong sui']),
  F('Rojak Buah (1 plate)', 280, 5, 48, 8, ['rojak buah', 'fruit rojak']),
  F('Asam Boi (5 pieces)', 30, 0, 7, 0, ['asam boi', 'preserved plum']),

  // ── Drinks, the way they are ordered ──────────────────────────────────────
  F('Teh Tarik Kurang Manis (1 glass)', 90, 3, 12, 4, ['teh tarik kurang manis', 'teh kurang manis']),
  F('Teh O Ais (1 glass)', 80, 0, 20, 0, ['teh o ais', 'iced tea', 'teh o ais manis']),
  F('Teh O Ais Kosong (1 glass)', 3, 0, 1, 0, ['teh o ais kosong', 'teh o kosong ais']),
  F('Teh C Ais (1 glass)', 130, 3, 20, 4, ['teh c ais', 'teh c peng']),
  F('Teh C Kosong (1 cup)', 40, 2, 3, 2, ['teh c kosong']),
  F('Teh Ais Kurang Manis (1 glass)', 110, 3, 16, 4, ['teh ais kurang manis']),
  F('Teh Halia (1 glass)', 130, 3, 20, 4, ['teh halia', 'ginger tea', 'teh tarik halia']),
  F('Teh Limau Ais (1 glass)', 90, 0, 23, 0, ['teh limau', 'teh o limau', 'lemon tea ais']),
  F('Kopi O Ais (1 glass)', 70, 0, 18, 0, ['kopi o ais', 'kopi o peng']),
  F('Kopi O Kosong (1 cup)', 5, 0, 1, 0, ['kopi kosong', 'black coffee kosong']),
  F('Kopi Kurang Manis (1 cup)', 100, 3, 14, 4, ['kopi kurang manis', 'kopi susu kurang manis']),
  F('Kopi C Ais (1 glass)', 130, 3, 20, 4, ['kopi c ais', 'kopi c peng']),
  F('Nescafe Ais (1 glass)', 150, 3, 25, 4, ['nescafe ais', 'nescafe tarik', 'nes ais']),
  F('Neslo Ais (1 glass)', 210, 5, 34, 6, ['neslo', 'neslo ais']),
  F('Milo Panas (1 cup)', 150, 5, 24, 4, ['milo panas', 'hot milo', 'milo o']),
  F('Milo Ais Kurang Manis (1 glass)', 160, 5, 26, 5, ['milo kurang manis', 'milo ais kurang manis']),
  F('Milo Kosong (1 cup)', 90, 4, 14, 2, ['milo kosong', 'milo o kosong']),
  F('Horlicks Panas (1 cup)', 150, 5, 26, 3, ['horlicks', 'horlicks ais']),
  F('Cham Ais (1 glass)', 150, 3, 25, 4, ['cham', 'cham peng', 'kopi cham']),
  F('Sirap Limau Ais (1 glass)', 110, 0, 28, 0, ['sirap limau', 'sirap limau ais']),
  F('Air Kacang Soya Kurang Manis (1 glass)', 90, 6, 9, 4, ['soya kurang manis', 'air soya kurang manis']),
  F('Air Jagung (1 glass)', 170, 3, 34, 3, ['air jagung', 'corn drink']),
  F('Air Katira (1 glass)', 220, 4, 38, 6, ['katira', 'air katira ramadan']),
  F('Air Asam Jawa (1 glass)', 100, 0, 26, 0, ['asam jawa', 'air asam']),
  F('Air Kelapa Muda with Flesh (1 coconut)', 140, 2, 24, 4, ['kelapa muda', 'young coconut']),
  F('Cincau Ais (1 glass)', 110, 0, 28, 0, ['cincau', 'air cincau', 'grass jelly drink']),
  F('Limau Kasturi Ais (1 glass)', 90, 0, 23, 0, ['kasturi ais', 'calamansi juice']),
  F('Jus Tembikai (1 glass)', 110, 1, 27, 0, ['jus tembikai', 'watermelon juice']),
  F('Jus Oren (1 glass)', 130, 1, 31, 0, ['jus oren', 'fresh orange juice']),
  F('Jus Epal Susu (1 glass)', 190, 3, 36, 4, ['jus epal susu', 'apple milk juice']),
  F('Jus Lobak Susu (1 glass)', 180, 3, 32, 4, ['jus lobak susu', 'carrot milk juice', 'carrot susu']),
  F('Jus Mangga Susu (1 glass)', 210, 3, 40, 4, ['jus mangga susu', 'mango milk juice']),
  F('Teh Ais Boba (1 cup)', 300, 3, 60, 5, ['teh boba', 'milk tea boba medium', 'tealive', 'chatime']),
  F('Brown Sugar Boba Milk (1 cup)', 380, 6, 64, 11, ['brown sugar milk tea', 'gula apong boba', 'tiger sugar']),
  F('Kopi Kenangan Latte (regular)', 180, 5, 26, 6, ['kopi kenangan', 'kenangan latte'], 'Kopi Kenangan'),
  F('ZUS Spanish Latte (regular)', 210, 6, 30, 7, ['zus coffee', 'spanish latte', 'zus spanish latte'], 'ZUS Coffee'),

  // ── Local fast food and chains ────────────────────────────────────────────
  F('Marrybrown Fried Chicken (1 piece)', 310, 20, 12, 20, ['marrybrown chicken', 'mb chicken'], 'Marrybrown'),
  F('Marrybrown Hotouch Burger', 470, 22, 44, 23, ['hotouch burger', 'marrybrown burger'], 'Marrybrown'),
  F('Texas Chicken Original (1 piece)', 320, 21, 13, 21, ['texas chicken', 'texas fried chicken'], 'Texas Chicken'),
  F('Texas Honey-Butter Biscuit (1)', 230, 3, 26, 12, ['texas biscuit', 'honey butter biscuit'], 'Texas Chicken'),
  F('Nando\'s Quarter Chicken (leg)', 330, 34, 2, 20, ['nandos quarter chicken', 'nandos peri peri chicken'], "Nando's"),
  F('The Chicken Rice Shop Set (roasted)', 660, 32, 78, 24, ['chicken rice shop', 'tcrs'], 'The Chicken Rice Shop'),
  F('Secret Recipe Chocolate Indulgence (1 slice)', 420, 6, 46, 24, ['secret recipe cake', 'chocolate indulgence'], 'Secret Recipe'),
  F('OldTown White Coffee (1 cup)', 150, 2, 24, 5, ['oldtown white coffee', 'white coffee', 'ipoh white coffee'], 'OldTown'),
  F('OldTown Nasi Lemak with Fried Chicken', 780, 30, 88, 34, ['oldtown nasi lemak'], 'OldTown'),
  F('PappaRich Roti Canai with Curry Chicken', 560, 24, 54, 27, ['papparich roti canai'], 'PappaRich'),
  F('myBurgerLab Classic Beef Burger', 620, 32, 44, 35, ['myburgerlab', 'burger lab'], 'myBurgerLab'),
  F('Domino\'s Pepperoni Pizza (2 slices, regular)', 420, 18, 48, 17, ['dominos pepperoni', 'dominos pizza'], "Domino's"),
  F('Pizza Hut Hawaiian Chicken (2 slices, pan)', 480, 20, 56, 19, ['pizza hut hawaiian', 'pizza hut'], 'Pizza Hut'),
  F('A&W Coney Dog', 340, 12, 30, 19, ['coney dog', 'a&w coney', 'aw coney'], 'A&W'),
  F('A&W Root Beer Float', 290, 3, 54, 7, ['rb float', 'root beer float', 'a&w float'], 'A&W'),
  F('KFC Dinner Plate (2 pieces)', 780, 44, 62, 39, ['kfc dinner plate', 'kfc 2 piece combo'], 'KFC'),
  F('KFC Snack Plate (2 pieces)', 620, 40, 36, 35, ['kfc snack plate'], 'KFC'),
  F('McD Nasi Lemak', 520, 18, 62, 22, ['mcd nasi lemak', 'mcdonalds nasi lemak'], "McDonald's"),
  F('McD Spicy Chicken McDeluxe', 530, 24, 46, 28, ['spicy chicken mcdeluxe', 'mcdeluxe'], "McDonald's"),
  F('McD Ayam Goreng Spicy (2 pieces)', 660, 44, 24, 44, ['ayam goreng mcd 2 ketul', 'mcd ayam goreng spicy'], "McDonald's"),
  F('Subway Chicken Slice Sub (6 inch)', 300, 20, 42, 6, ['subway chicken slice'], 'Subway'),
  F('Sushi King Salmon Sushi (2 pieces)', 120, 6, 17, 3, ['sushi king', 'sushi king salmon'], 'Sushi King'),
  F('Family Mart Oden (5 pieces)', 220, 16, 22, 8, ['oden', 'familymart oden'], 'FamilyMart'),
  F('Family Mart Sofuto Ice Cream (1 cone)', 190, 4, 28, 7, ['sofuto', 'familymart ice cream'], 'FamilyMart'),
  F('7-Eleven Onigiri Tuna Mayo (1)', 210, 6, 36, 5, ['onigiri tuna mayo', '7 eleven onigiri'], '7-Eleven'),
  F('Gardenia Twiggies (1 pack)', 160, 2, 24, 6, ['twiggies'], 'Gardenia'),
  F('Gardenia Butterscotch Bread (2 slices)', 180, 5, 32, 4, ['gardenia butterscotch', 'roti butterscotch'], 'Gardenia'),
  F('Massimo Wheat Germ Bread (2 slices)', 150, 6, 28, 2, ['massimo bread', 'roti massimo'], 'Massimo'),
  F('High 5 Wholemeal Bread (2 slices)', 140, 6, 24, 2, ['high 5 bread', 'roti high 5'], 'High 5'),
  F('Munchy\'s Lexus Sandwich Biscuit (1 pack)', 190, 3, 24, 9, ['lexus biscuit', 'munchys lexus'], "Munchy's"),
  F('Julie\'s Peanut Butter Sandwich (1 pack)', 140, 3, 16, 7, ['julies biscuit', 'julies peanut butter'], "Julie's"),
  F('Mamee Monster (1 pack)', 110, 2, 16, 4, ['mamee', 'mamee monster'], 'Mamee'),
  F('Mister Potato Chips (1 small pack)', 150, 2, 16, 9, ['mister potato'], 'Mister Potato'),
  F('Super Ring (1 small pack)', 160, 2, 17, 9, ['super ring', 'cheese rings'], 'Oriental'),
  F('Yeo\'s Chrysanthemum Tea (250ml)', 80, 0, 20, 0, ['teh bunga', 'chrysanthemum tea', 'yeos chrysanthemum'], "Yeo's"),
  F('Yeo\'s Soya Bean Drink (250ml)', 130, 5, 20, 3, ['yeos soya', 'soya kotak'], "Yeo's"),
  F('Dutch Lady Chocolate Milk (200ml)', 150, 6, 20, 5, ['dutch lady coklat', 'susu coklat kotak'], 'Dutch Lady'),
  F('Dutch Lady Full Cream Milk (200ml)', 130, 7, 10, 7, ['dutch lady', 'susu kotak', 'susu full cream'], 'Dutch Lady'),
  F('Farm Fresh Fresh Milk (200ml)', 130, 7, 10, 7, ['farm fresh', 'farm fresh milk'], 'Farm Fresh'),
  F('Vitagen (125ml)', 70, 1, 16, 0, ['vitagen less sugar'], 'Vitagen'),
  F('Nescafe Original Can (240ml)', 110, 2, 20, 2, ['nescafe tin', 'nescafe can'], 'Nescafe'),
  F('Wonda Kopi Tarik (240ml can)', 130, 2, 22, 3, ['wonda', 'wonda coffee'], 'Wonda'),
  F('F&N Orange (325ml can)', 150, 0, 38, 0, ['f&n oren', 'fn orange', 'oren tin'], 'F&N'),
  F('Sprite (325ml can)', 130, 0, 33, 0, ['sprite can', '7up'], 'Sprite'),
  F('Kickapoo (325ml can)', 150, 0, 38, 0, ['kickapoo'], 'Kickapoo'),
  F('Sarsi (325ml can)', 150, 0, 38, 0, ['sarsi', 'root beer can'], 'F&N'),
  F('Ribena (200ml packet)', 100, 0, 25, 0, ['ribena'], 'Ribena'),
  F('Spritzer Tinge (500ml)', 60, 0, 15, 0, ['tinge', 'flavoured water'], 'Spritzer'),
];

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const seen = new Set(data.map((f) => String(f.name).trim().toLowerCase()));
const added = [];
const skipped = [];
for (const f of NEW) {
  const key = f.name.trim().toLowerCase();
  if (seen.has(key)) { skipped.push(f.name); continue; }
  seen.add(key);
  added.push(f);
}

const implied = (f) => f.protein * 4 + f.carbs * 4 + f.fats * 9;
const suspect = added.filter((f) =>
  Math.abs(implied(f) - f.calories) > Math.max(120, f.calories * 0.30) || implied(f) > f.calories * 1.5 + 50);

const merged = [...data, ...added].sort((a, b) => a.name.localeCompare(b.name));
console.log(`foods: ${data.length} → ${merged.length}  (+${added.length}, ${skipped.length} already present)`);
if (suspect.length) {
  console.log(`\n  MACRO MISMATCH — review before writing:`);
  for (const f of suspect) console.log(`    ${f.name}: stated ${f.calories} kcal, macros imply ${implied(f)}`);
}
if (WRITE) {
  if (suspect.length) { console.log('\nrefusing to write while macros disagree.'); process.exit(1); }
  writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log('written.');
} else {
  console.log('\ndry run — pass --write to apply.');
}
