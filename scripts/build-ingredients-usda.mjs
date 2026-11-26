// Builds src/data/ingredientsUsda.ts from USDA FoodData Central — real data only.
// Each entry names a search query and a `pick` regex the chosen USDA description
// must match; the first matching hit wins. Energy is read ONLY from nutrientId
// 1008 (kcal); protein 1003, carbs 1005, fat 1004.
//
//   USDA_KEY=... npx tsx scripts/build-ingredients-usda.mjs
//
// Optional: USDA_CACHE=<file.json> caches raw search responses between runs;
// LIST=1 prints every matched entry; REGIONS=1 prints a count per region.
//
// Restaurant-chain entries (chain(...)) also fetch the food's USDA portion
// and store its gram weight as `servingG`, so "1 Big Mac" can become grams.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INGREDIENTS_HAND } from '../src/data/ingredients100g.ts';
import { normalizeText, stem } from '../src/services/foodSearchIndex.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.USDA_KEY;
if (!KEY) { console.error('USDA_KEY is not set'); process.exit(1); }
const CACHE_FILE = process.env.USDA_CACHE || '';
const cache = CACHE_FILE && fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};

const S = 'Foundation,SR Legacy';
const F = 'Survey (FNDDS)';
// e(name, query, pick, aliases, dataType, flags)
//   flags: 'alcohol' | 'diet' -> Atwater exempt (flagged for manual look)
//          'cooked' -> must be < 200 kcal (grain/pasta/noodle), 'legume' -> < 150 kcal
const E = [];
let REGION = 'core';
const region = (r) => { REGION = r; };
const e = (name, query, pick, aliases = [], type = S, flags = '') => E.push({ name, query, pick, aliases, type, flags, region: REGION });
// A named restaurant-chain item (USDA SR Legacy, branded description). Also
// records the USDA portion weight of one item as servingG. `portion` picks the
// USDA portion by its text when the default (first "item / sandwich / slice..."
// portion, medium when sizes are listed) would be wrong; null = store no size.
const L = 'SR Legacy';
const chain = (name, query, pick, aliases = [], portion) => E.push({ name, query, pick, aliases, type: L, flags: '', region: REGION, serving: true, portion });

// --- Grains, breads, starches ------------------------------------------------
e('Corn tortilla', 'tortillas corn', /^Tortillas, ready-to-bake or -fry, corn$/i, ['tortilla corn']);
e('Pita bread', 'pita white', /^Bread, pita, white, enriched/i, ['pita', 'pitta']);
e('Bagel', 'bagels plain', /^Bagels, plain, enriched/i, ['plain bagel']);
e('Croissant', 'croissants butter', /^Croissants, butter/i, ['croissants', 'butter croissant']);
e('English muffin', 'english muffins plain', /^English muffins, plain, enriched/i);
e('Rye bread', 'bread rye', /^Bread, rye$/i);
e('Sourdough bread', 'bread french or vienna sourdough', /^Bread, french or vienna.*sourdough/i, ['sourdough']);
e('Baguette', 'bread french or vienna', /^Bread, french or vienna \(includes sourdough\)$/i, ['french bread', 'french baguette']);
e('Multigrain bread', 'bread multi-grain', /^Bread, multi-grain \(includes whole-grain\)$/i);
e('Dinner roll', 'rolls dinner plain', /^Rolls, dinner, plain, commercially prepared/i, ['bread roll']);
e('Hot dog bun', 'rolls hamburger or hotdog plain', /^Rolls, hamburger or hotdog, plain$/i);
e('Dosa', 'dosa', /^Dosa/i, ['masala dosa', 'thosai'], F);
e('Idli', 'idli', /^Idli/i, ['idly'], F);
e('Puri', 'puri', /^Bread, puri/i, ['poori'], F);
e('Couscous', 'couscous cooked', /^Couscous, cooked/i);
e('Quinoa', 'quinoa cooked', /^Quinoa, cooked/i, ['cooked quinoa'], S, 'cooked');
e('Bulgur', 'bulgur cooked', /^Bulgur, cooked/i, ['bulgur wheat', 'bulghur'], S, 'cooked');
e('Polenta', 'cornmeal grits cooked', /^Cereals, corn grits, white, regular and quick, enriched, cooked with water, without salt/i, ['grits', 'corn grits']);
e('Barley', 'barley pearled cooked', /^Barley, pearled, cooked/i, ['pearl barley'], S, 'cooked');
e('Wild rice', 'wild rice cooked', /^Wild rice, cooked/i, [], S, 'cooked');
e('Millet', 'millet cooked', /^Millet, cooked/i, [], S, 'cooked');
e('Buckwheat groats', 'buckwheat groats roasted cooked', /^Buckwheat groats, roasted, cooked/i, ['kasha', 'buckwheat'], S, 'cooked');
e('Parboiled rice', 'rice white long-grain parboiled cooked', /^Rice, white, long-grain, parboiled, enriched, cooked/i, ['converted rice'], S, 'cooked');
e('Whole wheat pasta', 'pasta whole grain cooked', /^Pasta, whole grain, 51% whole wheat, remaining unenriched semolina, cooked/i, ['wholemeal pasta', 'whole wheat spaghetti'], S, 'cooked');
e('Soba noodles', 'noodles japanese soba cooked', /^Noodles, japanese, soba, cooked/i, ['soba', 'buckwheat noodles'], S, 'cooked');
e('Gnocchi', 'gnocchi', /^Gnocchi, potato$/i, ['potato gnocchi'], F); // was the cheese gnocchi (now 'Cheese gnocchi')
e('Cheese ravioli', 'ravioli cheese filled', /^Ravioli, cheese-filled/i, ['ravioli'], F);
e('Tortellini', 'tortellini cheese', /^Tortellini/i, [], F);
e('Hash browns', 'potatoes hash brown', /^Potatoes, hash brown, home-prepared/i, ['hash brown']);
e('Baked potato', 'potatoes baked flesh and skin', /^Potatoes, baked, flesh and skin, without salt/i, ['jacket potato']);
e('Roast potatoes', 'potato roasted', /^Potato, roasted/i, ['roasted potatoes'], F);
// Removed on review (misleading match, see notes): e('Cassava', 'cassava raw', /^Cassava, raw/i, ['tapioca root', 'ubi kayu', 'yuca']);
e('Taro', 'taro cooked', /^Taro, cooked, without salt/i, ['keladi']);
e('Yam', 'yam cooked boiled', /^Yam, cooked, boiled/i, ['yams']);
e('Plantain', 'plantains cooked', /^Plantains, (yellow|green), (boiled|fried)/i, ['cooked plantain']);
e('Granola', 'granola', /^Cereals ready-to-eat, granola, homemade/i, ['muesli granola']);
e('Muesli', 'muesli', /^Cereals ready-to-eat, FAMILIA/i);
e('Bran flakes', 'bran flakes', /bran flakes/i, ['bran cereal']);
e('Pancake', 'pancakes plain prepared from recipe', /^Pancakes, plain, prepared from recipe/i, ['pancakes', 'hotcakes']);
e('Waffle', 'waffles plain prepared from recipe', /^Waffles, plain, prepared from recipe/i, ['waffles']);
e('French toast', 'french toast prepared from recipe', /^French toast, prepared from recipe/i);
e('Crepe', 'crepe', /^Crepe, plain/i, ['crepes'], F);
e('Rice cake', 'rice cakes brown rice plain', /^Snacks, rice cakes, brown rice, plain, unsalted/i, ['rice cakes', 'puffed rice cake']);
e('Breadcrumbs', 'bread crumbs dry plain', /^Bread, crumbs, dry, grated, plain/i, ['bread crumbs', 'panko']);
e('Wheat flour', 'wheat flour white all-purpose enriched', /^Wheat flour, white, all-purpose, enriched, bleached$/i, ['flour', 'all purpose flour', 'plain flour']);
e('Cornstarch', 'cornstarch', /^Cornstarch$/i, ['corn starch', 'cornflour']);
e('Popcorn', 'popcorn air-popped', /^Snacks, popcorn, air-popped$/i, ['air popped popcorn']);
e('Buttered popcorn', 'popcorn microwave regular butter', /^Snacks, popcorn, microwave, regular \(butter\) flavor/i, ['movie popcorn', 'microwave popcorn']);

// --- Legumes and soy (cooked) -----------------------------------------------
e('Black beans', 'beans black mature seeds cooked boiled without salt', /^Beans, black, mature seeds, cooked, boiled, without salt/i, ['black bean', 'frijoles negros'], S, 'legume');
e('Kidney beans', 'beans kidney red cooked boiled without salt', /^Beans, kidney, red, mature seeds, cooked, boiled, without salt/i, ['red kidney beans', 'rajma'], S, 'legume');
e('Pinto beans', 'beans pinto mature seeds cooked boiled without salt', /^Beans, pinto, mature seeds, cooked, boiled, without salt/i, ['pinto bean'], S, 'legume');
e('Navy beans', 'beans navy cooked boiled without salt', /^Beans, navy, mature seeds, cooked, boiled, without salt/i, ['haricot beans', 'white beans'], S, 'legume');
e('Cannellini beans', 'beans white mature seeds cooked boiled without salt', /^Beans, white, mature seeds, cooked, boiled, without salt/i, [], S, 'legume');
e('Baked beans', 'beans baked canned plain or vegetarian', /^Beans, baked, canned, plain or vegetarian/i, ['beans in tomato sauce', 'beans']); // plain "beans" landed on a bean taco
e('Refried beans', 'refried beans canned traditional', /^Refried beans, canned, traditional/i);
e('Mung beans', 'mung beans mature seeds sprouted cooked', /^Mung beans, mature seeds, cooked, boiled, without salt/i, ['moong', 'green gram', 'kacang hijau'], S, 'legume');
e('Black-eyed peas', 'cowpeas common blackeyes cooked boiled without salt', /^Cowpeas, common \(blackeyes, crowder, southern\), mature seeds, cooked, boiled, without salt/i, ['black eyed peas', 'cowpeas', 'lobia'], S, 'legume');
e('Split peas', 'peas split mature seeds cooked boiled without salt', /^Peas, split, mature seeds, cooked, boiled, without salt/i, ['yellow split peas'], S, 'legume');
e('Lima beans', 'lima beans large mature seeds cooked boiled without salt', /^Lima beans, large, mature seeds, cooked, boiled, without salt/i, ['butter beans'], S, 'legume');
e('Fava beans', 'broadbeans fava beans mature seeds cooked boiled without salt', /^Broadbeans \(fava beans\), mature seeds, cooked, boiled, without salt/i, ['broad beans', 'ful medames'], S, 'legume');
e('Edamame', 'edamame frozen prepared', /^Edamame, frozen, prepared/i, ['soybeans green']);
e('Soybeans', 'soybeans mature cooked boiled without salt', /^Soybeans, mature cooked, boiled, without salt/i, ['soy beans']);
e('Silken tofu', 'tofu soft prepared with calcium sulfate', /^Tofu, soft, prepared with calcium sulfate and magnesium chloride/i, ['soft tofu']);
e('Soy milk', 'soymilk unfortified original', /^Soymilk, original and vanilla, unfortified/i, ['soya milk', 'soymilk']);
e('Falafel', 'falafel home-prepared', /^Falafel, home-prepared/i, ['felafel']);
e('Hummus', 'hummus commercial', /^Hummus, commercial/i, ['houmous', 'hommus']);

// --- Meat (cooked) -----------------------------------------------------------
e('Lean ground beef', 'beef ground 90% lean meat 10% fat pan-browned', /^Beef, ground, 90% lean meat \/ 10% fat, crumbles, cooked, pan-browned/i, ['lean beef mince', 'extra lean mince']);
e('Fatty ground beef', 'beef ground 80% lean meat 20% fat pan-browned', /^Beef, ground, 80% lean meat \/ 20% fat, crumbles, cooked, pan-browned/i, ['regular ground beef']);
e('Ribeye steak', 'beef rib eye steak lean and fat grilled', /^Beef, rib eye steak, bone-in, lip-on, separable lean and fat, trimmed to 1\/8" fat, choice, cooked, grilled/i, ['rib eye', 'ribeye']);
e('Beef tenderloin', 'beef tenderloin steak lean grilled', /^Beef, loin, tenderloin steak, boneless, separable lean and fat, trimmed to 0" fat, choice, cooked, grilled/i, ['filet mignon', 'fillet steak']);
e('T-bone steak', 't-bone steak broiled', /^Beef, short loin, t-bone steak, separable lean only, trimmed to 0" fat, choice, cooked, broiled/i, ['t bone steak']);
e('Beef brisket', 'beef brisket flat half lean and fat braised', /^Beef, brisket, flat half, separable lean and fat, trimmed to 1\/8" fat, all grades, cooked, braised/i, ['brisket']);
e('Beef stew meat', 'beef chuck for stew lean and fat braised', /^Beef, chuck for stew, separable lean and fat, all grades, cooked, braised/i, ['stewing beef', 'beef chunks']);
e('Roast beef', 'beef top round lean roasted', /^Beef, round, top round roast, boneless, separable lean and fat, trimmed to 0" fat, choice, cooked, roasted/i, ['beef roast']);
e('Corned beef', 'beef cured corned beef canned', /^Beef, cured, corned beef, canned/i);
e('Beef jerky', 'snacks beef jerky chopped and formed', /^Snacks, beef jerky, chopped and formed/i, ['jerky']);
e('Beef liver', 'beef variety meats liver cooked pan-fried', /^Beef, variety meats and by-products, liver, cooked, pan-fried/i, ['liver']);
e('Pork loin', 'pork fresh loin whole lean and fat roasted', /^Pork, fresh, loin, whole, separable lean and fat, cooked, roasted/i, ['roast pork']);
e('Pork tenderloin', 'pork fresh tenderloin lean roasted', /^Pork, fresh, loin, tenderloin, separable lean only, cooked, roasted/i);
e('Pulled pork', 'pork shoulder whole lean and fat roasted', /^Pork, fresh, shoulder, whole, separable lean and fat, cooked, roasted/i, ['pork shoulder']);
e('Ground pork', 'pork ground cooked', /^Pork, fresh, ground, cooked/i, ['pork mince', 'minced pork']);
e('Pork ribs', 'pork spareribs braised', /^Pork, fresh, spareribs, separable lean and fat, cooked, braised/i, ['spare ribs', 'spareribs', 'ribs']);
e('Bacon', 'pork cured bacon cooked', /^Pork, cured, bacon, cooked, (pan-fried|baked|microwaved)/i, ['bacon strips', 'streaky bacon']);
e('Ham', 'ham sliced regular', /^Ham, sliced, regular/i, ['sliced ham', 'deli ham', 'cold cuts']);
e('Pepperoni', 'pepperoni pork beef', /^Pepperoni, beef and pork, sliced/i);
e('Salami', 'salami dry or hard pork beef', /^Salami, dry or hard, pork, beef/i);
e('Bologna', 'bologna beef and pork', /^Bologna, beef and pork/i, ['baloney']);
e('Chorizo', 'chorizo pork and beef', /^Sausage, pork, chorizo, link or ground, cooked, pan-fried/i);
e('Pork sausage', 'pork sausage fresh cooked', /^Sausage, pork and beef, fresh, cooked/i, ['breakfast sausage']);
e('Italian sausage', 'sausage italian pork cooked', /^Sausage, Italian, pork, mild, cooked, pan-fried/i);
e('Lamb chop', 'lamb loin lean and fat broiled', /^Lamb, loin, separable lean and fat, trimmed to 1\/4" fat, choice, cooked, broiled/i, ['lamb chops']);
e('Ground lamb', 'lamb ground cooked broiled', /^Lamb, ground, cooked, broiled/i, ['lamb mince', 'minced lamb']);
e('Leg of lamb', 'lamb leg whole lean and fat roasted', /^Lamb, leg, whole \(shank and sirloin\), separable lean and fat, trimmed to 1\/4" fat, choice, cooked, roasted/i, ['roast lamb']);
e('Goat meat', 'goat cooked roasted', /^Game meat, goat, cooked, roasted/i, ['goat', 'chevon']);
e('Turkey breast', 'turkey breast meat only roasted', /^Turkey, (whole|all classes), breast, meat only, cooked, roasted/i, ['roast turkey', 'turkey']);
e('Ground turkey', 'turkey ground cooked', /^Turkey, ground, (93% lean, 7% fat, )?cooked/i, ['turkey mince']);
e('Turkey deli meat', 'turkey sliced deli', /^Turkey, sliced, prepackaged|^Turkey breast, sliced, prepackaged/i, ['sliced turkey']);
e('Duck', 'duck domesticated meat and skin roasted', /^Duck, domesticated, meat and skin, cooked, roasted/i, ['roast duck', 'itik']);
e('Chicken drumstick', 'chicken broiler drumstick meat and skin roasted', /^Chicken, broilers or fryers, drumstick, meat and skin, cooked, roasted/i, ['drumstick', 'chicken drumsticks']);
e('Chicken wings', 'chicken broiler wing meat and skin roasted', /^Chicken, broilers or fryers, wing, meat and skin, cooked, roasted/i, ['wings', 'chicken wing']);
e('Buffalo wings', 'chicken wings buffalo', /^Chicken "wings" with hot sauce/i, ['hot wings'], F);
e('Ground chicken', 'chicken ground crumbles cooked pan-browned', /^Chicken, ground, crumbles, cooked, pan-browned/i, ['chicken mince']);
e('Chicken nuggets', 'chicken nuggets', /^Chicken nuggets(, from fast food)?$/i, ['nuggets'], F);
e('Chicken liver', 'chicken liver all classes cooked simmered', /^Chicken, liver, all classes, cooked, simmered/i, ['chicken livers']);
e('Rotisserie chicken', 'chicken broiler rotisserie bbq', /^Chicken, broiler, rotisserie, BBQ, breast, meat and skin/i);
e('Venison', 'deer cooked roasted', /^Game meat, deer, cooked, roasted/i, ['deer meat']);

// --- Fish and seafood (cooked unless canned) ---------------------------------
e('Tuna steak', 'fish tuna fresh yellowfin cooked dry heat', /^Fish, tuna, (fresh, )?yellowfin.*cooked/i, ['yellowfin tuna', 'seared tuna']);
e('Tuna in oil', 'fish tuna light canned in oil drained', /^Fish, tuna, light, canned in oil, drained solids/i, ['canned tuna in oil']);
e('Haddock', 'fish haddock cooked dry heat', /^Fish, haddock, cooked, dry heat/i);
e('Pollock', 'fish pollock alaska cooked', /^Fish, pollock, Alaska, cooked/i);
e('Catfish', 'fish catfish channel farmed cooked dry heat', /^Fish, catfish, channel, farmed, cooked, dry heat/i, ['keli']);
e('Trout', 'fish trout rainbow farmed cooked dry heat', /^Fish, trout, rainbow, farmed, cooked, dry heat/i, ['rainbow trout']);
e('Halibut', 'fish halibut atlantic and pacific cooked dry heat', /^Fish, halibut, Atlantic and Pacific, cooked, dry heat/i);
e('Sea bass', 'fish sea bass mixed species cooked dry heat', /^Fish, sea bass, mixed species, cooked, dry heat/i, ['seabass', 'siakap']);
e('Snapper', 'fish snapper mixed species cooked dry heat', /^Fish, snapper, mixed species, cooked, dry heat/i, ['red snapper', 'ikan merah']);
e('Mackerel', 'fish mackerel atlantic cooked dry heat', /^Fish, mackerel, Atlantic, cooked, dry heat/i, ['ikan kembung', 'saba']);
e('Sardines', 'fish sardine atlantic canned in oil drained', /^Fish, sardine, Atlantic, canned in oil, drained solids with bone/i, ['sardine', 'canned sardines']);
e('Sardines in tomato sauce', 'fish sardine pacific canned in tomato sauce', /^Fish, sardine, Pacific, canned in tomato sauce, drained solids with bone/i, ['sardin']);
e('Canned salmon', 'fish salmon pink canned drained solids', /^Fish, salmon, pink, canned, drained solids/i, ['tinned salmon']);
e('Smoked salmon', 'fish salmon chinook smoked', /^Fish, salmon, chinook, smoked/i, ['lox']);
e('Herring', 'fish herring atlantic cooked dry heat', /^Fish, herring, Atlantic, cooked, dry heat/i);
e('Swordfish', 'fish swordfish cooked dry heat', /^Fish, swordfish, cooked, dry heat/i);
e('Mahi mahi', 'fish dolphinfish cooked dry heat', /^Fish, mahimahi, cooked, dry heat|^Fish, dolphinfish, cooked, dry heat/i, ['dolphinfish']);
e('Anchovies canned', 'fish anchovy european canned in oil', /^Fish, anchovy, european, canned in oil, drained solids/i, ['anchovy fillets']);
e('Fish sticks', 'fish sticks frozen prepared', /^Fish, fish sticks, frozen, prepared/i, ['fish fingers']);
e('Crab', 'crustaceans crab blue cooked moist heat', /^Crustaceans, crab, blue, cooked, moist heat/i, ['ketam', 'crab meat']);
e('Imitation crab', 'surimi', /^Crustaceans, crab, alaska king, imitation, made from surimi/i, ['crab stick', 'crab sticks', 'kani', 'surimi']);
e('Lobster', 'crustaceans lobster northern cooked moist heat', /^Crustaceans, lobster, northern, cooked, moist heat/i);
e('Scallops', 'scallop cooked steamed', /^Mollusks, scallop, \(bay and sea\), cooked, steamed/i, ['scallop']);
e('Mussels', 'mollusks mussel blue cooked moist heat', /^Mollusks, mussel, blue, cooked, moist heat/i, ['mussel', 'kupang']);
e('Clams', 'mollusks clam mixed species cooked moist heat', /^Mollusks, clam, mixed species, cooked, moist heat/i, ['clam', 'lala']);
e('Oysters', 'mollusks oyster pacific cooked moist heat', /^Mollusks, oyster, Pacific, cooked, moist heat/i, ['oyster', 'tiram']);
e('Octopus', 'mollusks octopus common cooked moist heat', /^Mollusks, octopus, common, cooked, moist heat/i, ['tako']);
e('Fried calamari', 'mollusks squid mixed species cooked fried', /^Mollusks, squid, mixed species, cooked, fried/i, ['calamari rings', 'fried squid']);
e('Crayfish', 'crustaceans crayfish farmed cooked moist heat', /^Crustaceans, crayfish, mixed species, farmed, cooked, moist heat/i, ['crawfish']);
e('Fried shrimp', 'shrimp breaded fried', /^Shrimp, (breaded or battered, )?(fried|coated, fried)/i, ['tempura prawns', 'fried prawns', 'breaded shrimp'], F);

// --- Eggs -------------------------------------------------------------------
e('Egg white', 'egg white raw fresh', /^Egg, white, raw, fresh/i, ['egg whites']);
e('Egg yolk', 'egg yolk raw fresh', /^Egg, yolk, raw, fresh/i, ['egg yolks']);
e('Raw egg', 'egg whole raw fresh', /^Egg, whole, raw, fresh/i, ['whole egg raw']);
e('Duck egg', 'egg duck whole fresh raw', /^Egg, duck, whole, fresh, raw/i, ['salted egg', 'telur itik']);
e('Quail egg', 'egg quail whole fresh raw', /^Egg, quail, whole, fresh, raw/i, ['quail eggs', 'telur puyuh']);

// --- Dairy ------------------------------------------------------------------
e('Reduced fat milk', 'milk reduced fat fluid 2% milkfat with added vitamin a', /^Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D/i, ['2% milk', 'semi skimmed milk']);
e('Chocolate milk', 'milk chocolate fluid commercial reduced fat', /^Milk, chocolate, (fluid, commercial, )?reduced fat/i, ['choc milk']);
e('Buttermilk', 'milk buttermilk fluid cultured lowfat', /^Milk, buttermilk, fluid, cultured, lowfat/i);
e('Goat milk', 'milk goat fluid', /^Milk, goat, fluid/i);
e('Evaporated milk', 'milk canned evaporated', /^Milk, canned, evaporated, with added vitamin D and without added vitamin A/i, ['susu cair']);
e('Milk powder', 'milk dry whole', /^Milk, dry, whole, without added vitamin D/i, ['powdered milk', 'full cream milk powder']);
e('Almond milk', 'almond milk unsweetened', /^Beverages, almond milk, unsweetened, shelf stable/i, ['unsweetened almond milk']);
e('Oat milk', 'oat milk', /^Beverages, oat milk|^Oat milk/i, ['oatmilk'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Rice milk', 'rice milk unsweetened', /^Beverages, rice milk, unsweetened/i);
e('Low fat yogurt', 'yogurt plain low fat', /^Yogurt, plain, low fat/i, ['lowfat yogurt']);
e('Fruit yogurt', 'yogurt fruit low fat', /^Yogurt, fruit, low fat, 9 grams protein/i, ['flavoured yogurt', 'strawberry yogurt']);
e('Nonfat greek yogurt', 'yogurt greek plain nonfat', /^Yogurt, Greek, plain, nonfat/i, ['fat free greek yogurt']);
e('Kefir', 'kefir lowfat plain', /^Kefir, lowfat, plain/i);
e('Mozzarella', 'cheese mozzarella whole milk', /^Cheese, mozzarella, whole milk$/i, ['mozzarella cheese']);
e('Parmesan', 'cheese parmesan hard', /^Cheese, parmesan, hard/i, ['parmesan cheese', 'parmigiano']);
e('Feta', 'cheese feta', /^Cheese, feta$/i, ['feta cheese']);
e('Swiss cheese', 'cheese swiss', /^Cheese, swiss$/i, ['emmental']);
e('Gouda', 'cheese gouda', /^Cheese, gouda$/i, ['gouda cheese']);
e('Brie', 'cheese brie', /^Cheese, brie$/i);
e('Camembert', 'cheese camembert', /^Cheese, camembert$/i);
e('Blue cheese', 'cheese blue', /^Cheese, blue$/i, ['gorgonzola', 'roquefort']);
e('Provolone', 'cheese provolone', /^Cheese, provolone$/i);
e('Monterey Jack', 'cheese monterey', /^Cheese, monterey$/i, ['monterey jack cheese']);
e('Colby cheese', 'cheese colby', /^Cheese, colby$/i);
e('Goat cheese', 'cheese goat soft type', /^Cheese, goat, soft type/i, ['chevre']);
e('Ricotta', 'cheese ricotta whole milk', /^Cheese, ricotta, whole milk/i, ['ricotta cheese']);
e('Cottage cheese', 'cheese cottage creamed large or small curd', /^Cheese, cottage, creamed, large or small curd/i);
e('Cream cheese', 'cheese cream', /^Cheese, cream$/i, ['philadelphia']);
e('Processed cheese', 'cheese pasteurized process american', /^Cheese, pasteurized process, American, (fortified with vitamin D|without added vitamin D|with added vitamin D)/i, ['american cheese', 'cheese singles']);
e('Heavy cream', 'cream fluid heavy whipping', /^Cream, fluid, heavy whipping/i, ['whipping cream', 'double cream']);
e('Light cream', 'cream fluid light coffee cream or table cream', /^Cream, fluid, light \(coffee cream or table cream\)/i, ['single cream', 'coffee cream']);
e('Half and half', 'cream fluid half and half', /^Cream, fluid, half and half/i);
e('Sour cream', 'cream sour cultured', /^Cream, sour, cultured$|^Sour cream, regular/i);
e('Whipped cream', 'cream whipped cream topping pressurized', /^Cream, whipped, cream topping, pressurized/i, ['squirty cream']);
e('Vanilla ice cream', 'ice creams vanilla', /^Ice creams, vanilla$/i, ['ice cream']);
e('Chocolate ice cream', 'ice creams chocolate', /^Ice creams, chocolate$/i);
e('Frozen yogurt', 'frozen yogurts vanilla soft-serve', /^Frozen yogurts, (vanilla|chocolate), soft-serve/i, ['froyo']);
e('Sorbet', 'sherbet orange', /^Sherbet, orange/i, ['sherbet']);
e('Coffee creamer', 'cream substitute powdered', /^Cream substitute, powdered/i, ['non dairy creamer', 'creamer']);

// --- Vegetables -------------------------------------------------------------
e('Zucchini', 'squash summer zucchini includes skin raw', /^Squash, summer, zucchini, includes skin, raw/i, ['courgette']);
e('Eggplant', 'eggplant raw', /^Eggplant, raw/i, ['aubergine', 'terung', 'brinjal']);
e('Cauliflower', 'cauliflower raw', /^Cauliflower, raw/i);
e('Kale', 'kale raw', /^Kale, raw/i);
e('Celery', 'celery raw', /^Celery, raw/i);
e('Asparagus', 'asparagus cooked boiled drained', /^Asparagus, cooked, boiled, drained$/i);
e('Brussels sprouts', 'brussels sprouts cooked boiled drained without salt', /^Brussels sprouts, cooked, boiled, drained, without salt/i);
e('Okra', 'okra cooked boiled drained without salt', /^Okra, cooked, boiled, drained, without salt/i, ['ladies fingers', 'bhindi', 'bendi']);
e('Beetroot', 'beets cooked boiled drained', /^Beets, cooked, boiled, drained$/i, ['beets', 'beet']);
e('Radish', 'radishes raw', /^Radishes, raw/i, ['radishes']);
e('Daikon', 'radishes oriental raw', /^Radishes, oriental, raw/i, ['white radish', 'lobak']);
e('Pumpkin', 'pumpkin cooked boiled drained without salt', /^Pumpkin, cooked, boiled, drained, without salt/i, ['labu']);
e('Butternut squash', 'squash winter butternut cooked baked without salt', /^Squash, winter, butternut, cooked, baked, without salt/i);
e('Red cabbage', 'cabbage red raw', /^Cabbage, red, raw/i);
e('Napa cabbage', 'cabbage chinese pe-tsai raw', /^Cabbage, chinese \(pe-tsai\), raw/i, ['chinese cabbage', 'wombok', 'sawi putih']);
e('Arugula', 'arugula raw', /^Arugula, raw/i, ['rocket']);
e('Romaine lettuce', 'lettuce cos or romaine raw', /^Lettuce, cos or romaine, raw/i, ['romaine', 'cos lettuce']);
e('Iceberg lettuce', 'lettuce iceberg raw', /^Lettuce, iceberg/i, ['iceberg']);
e('Cooked spinach', 'spinach cooked boiled drained without salt', /^Spinach, cooked, boiled, drained, without salt/i, ['sauteed spinach', 'palak']);
e('Leek', 'leeks bulb and lower leaf-portion raw', /^Leeks, \(bulb and lower leaf-portion\), raw/i, ['leeks']);
e('Red onion', 'onions red raw', /^Onions, red, raw/i);
e('Ginger', 'ginger root raw', /^Ginger root, raw/i, ['halia', 'fresh ginger']);
e('Chili pepper', 'peppers hot chili red raw', /^Peppers, hot chili, red, raw/i, ['chili', 'chilli', 'cili', 'red chili']);
e('Jalapeno', 'peppers jalapeno raw', /^Peppers, jalapeno, raw/i, ['jalapenos']);
e('Corn on the cob', 'corn sweet yellow cooked boiled drained without salt', /^Corn, sweet, yellow, cooked, boiled, drained, without salt/i, ['corn cob', 'boiled corn']);
e('Bitter gourd', 'balsam-pear bitter gourd pods cooked', /^Balsam-pear \(bitter gourd\), pods, cooked, boiled, drained, without salt/i, ['bitter melon', 'peria', 'karela']);
e('Chayote', 'chayote fruit cooked boiled', /^Chayote, fruit, cooked, boiled, drained, without salt/i);
e('Snow peas', 'peas edible-podded raw', /^Peas, edible-podded, raw/i, ['sugar snap peas', 'mangetout']);
e('Artichoke', 'artichokes globe or french cooked boiled', /^Artichokes, \(globe or french\), cooked, boiled, drained, without salt/i);
e('Turnip', 'turnips cooked boiled drained without salt', /^Turnips, cooked, boiled, drained, without salt/i);
e('Parsnip', 'parsnips cooked boiled drained without salt', /^Parsnips, cooked, boiled, drained, without salt/i);
e('Fennel', 'fennel bulb raw', /^Fennel, bulb, raw/i);
e('Lotus root', 'lotus root cooked boiled', /^Lotus root, cooked, boiled, drained, without salt/i);
e('Bamboo shoots', 'bamboo shoots canned drained', /^Bamboo shoots, canned, drained solids/i, ['rebung']);
e('Water chestnut', 'waterchestnuts chinese canned', /^Waterchestnuts, chinese, canned/i, ['water chestnuts']);
e('Shiitake mushrooms', 'mushrooms shiitake cooked without salt', /^Mushrooms, shiitake, cooked, without salt/i, ['shiitake', 'cendawan shiitake']);
e('Enoki mushrooms', 'mushrooms enoki raw', /^Mushrooms, enoki, raw/i, ['enoki']);
e('Oyster mushrooms', 'mushrooms oyster raw', /^Mushrooms, oyster, raw/i, ['cendawan tiram']);
e('Portobello mushroom', 'mushrooms portabella grilled', /^Mushrooms, portabella, grilled/i, ['portobello']);
e('Seaweed', 'seaweed wakame raw', /^Seaweed, wakame, raw/i, ['wakame']);
e('Nori', 'seaweed laver raw', /^Seaweed, laver, raw/i, ['laver']);
e('Sauerkraut', 'sauerkraut canned solids and liquids', /^Sauerkraut, canned, solids and liquids/i);
e('Pickles', 'pickles cucumber dill or kosher dill', /^Pickles, cucumber, dill or kosher dill/i, ['pickle', 'dill pickle', 'gherkin']);
e('Olives', 'olives ripe canned small-extra large', /^Olives, ripe, canned \(small-extra large\)/i, ['black olives']);
e('Green olives', 'olives pickled canned or bottled green', /^Olives, pickled, canned or bottled, green/i);
e('Sun-dried tomatoes', 'tomatoes sun-dried', /^Tomatoes, sun-dried$/i, ['sundried tomatoes']);
e('Canned tomatoes', 'tomatoes red ripe canned packed in tomato juice', /^Tomatoes, red, ripe, canned, packed in tomato juice$/i, ['tinned tomatoes', 'chopped tomatoes']);
e('Tomato paste', 'tomato products canned paste without salt added', /^Tomato products, canned, paste, without salt added/i, ['tomato puree']);
e('Cherry tomatoes', 'tomatoes red ripe raw year round average', /^Tomatoes, red, ripe, raw, year round average/i, ['cherry tomato']);
e('Kimchi', 'kimchi', /^Kimchi/i, ['kimchee'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Coleslaw', 'coleslaw', /^Fast foods, coleslaw/i, ['slaw']);
e('Grilled vegetables', 'vegetables mixed frozen cooked boiled', /^Vegetables, mixed, frozen, cooked, boiled, drained, without salt/i, ['boiled vegetables', 'frozen mixed vegetables']);

// --- Fruit (raw) ------------------------------------------------------------
e('Pear', 'pears raw', /^Pears, raw/i, ['pears']);
e('Peach', 'peaches yellow raw', /^Peaches, yellow, raw/i, ['peaches']);
e('Nectarine', 'nectarines raw', /^Nectarines, raw/i);
e('Plum', 'plums raw', /^Plums, raw/i, ['plums']);
e('Apricot', 'apricots raw', /^Apricots, raw/i, ['apricots']);
e('Cherries', 'cherries sweet raw', /^Cherries, sweet, raw/i, ['cherry']);
// Not "Blueberry": the search index stems it to the hand table's "blueberries" (Berries).
e('Raw blueberries', 'blueberries raw', /^Blueberries, raw/i);
e('Raspberries', 'raspberries raw', /^Raspberries, raw/i, ['raspberry']);
e('Blackberries', 'blackberries raw', /^Blackberries, raw/i, ['blackberry']);
e('Cranberries', 'cranberries raw', /^Cranberries, raw/i);
e('Dried cranberries', 'cranberries dried sweetened', /^Cranberries, dried, sweetened/i, ['craisins']);
e('Kiwi', 'kiwifruit green raw', /^Kiwifruit, green, raw/i, ['kiwifruit', 'kiwi fruit']);
e('Lemon', 'lemons raw without peel', /^Lemons, raw, without peel/i, ['lemons']);
e('Lime', 'limes raw', /^Limes, raw/i, ['limau nipis']);
e('Grapefruit', 'grapefruit raw pink and red all areas', /^Grapefruit, raw, pink and red, all areas/i);
e('Mandarin', 'tangerines mandarin oranges raw', /^Tangerines, \(mandarin oranges\), raw/i, ['tangerine', 'clementine', 'limau mandarin']);
e('Cantaloupe', 'melons cantaloupe raw', /^Melons, cantaloupe, raw/i, ['rockmelon', 'muskmelon']);
e('Honeydew', 'melons honeydew raw', /^Melons, honeydew, raw/i, ['honeydew melon']);
e('Pomegranate', 'pomegranates raw', /^Pomegranates, raw/i, ['pomegranate seeds']);
e('Fig', 'figs raw', /^Figs, raw/i, ['figs', 'fresh figs']);
e('Dates', 'dates medjool', /^Dates, medjool/i, ['medjool dates', 'kurma']);
e('Raisins', 'raisins seedless', /^Raisins, (dark, )?seedless/i, ['sultanas']);
e('Prunes', 'plums dried prunes uncooked', /^Plums, dried \(prunes\), uncooked/i, ['dried plums']);
e('Dried apricots', 'apricots dried sulfured uncooked', /^Apricots, dried, sulfured, uncooked/i);
e('Dried mango', 'mango dried sweetened', /^Mango, dried, sweetened/i);
e('Guava', 'guavas common raw', /^Guavas, common, raw/i, ['jambu batu']);
e('Lychee', 'litchis raw', /^Litchis, raw/i, ['litchi', 'laici']);
e('Longan', 'longans raw', /^Longans, raw/i, ['mata kucing']);
// Removed on review (misleading match, see notes): e('Rambutan', 'rambutan canned in syrup', /^Rambutan, canned, syrup pack/i);
e('Jackfruit', 'jackfruit raw', /^Jackfruit, raw/i, ['nangka', 'cempedak']);
// Removed on review (misleading match, see notes): e('Mangosteen', 'mangosteen canned syrup pack', /^Mangosteen, canned, syrup pack/i, ['manggis']);
e('Passion fruit', 'passion-fruit granadilla purple raw', /^Passion-fruit, \(granadilla\), purple, raw/i, ['passionfruit', 'markisa']);
e('Starfruit', 'carambola starfruit raw', /^Carambola, \(starfruit\), raw/i, ['carambola', 'belimbing']);
e('Persimmon', 'persimmons japanese raw', /^Persimmons, japanese, raw/i);
e('Coconut meat', 'nuts coconut meat raw', /^Nuts, coconut meat, raw/i, ['fresh coconut', 'kelapa']);
e('Desiccated coconut', 'nuts coconut meat dried desiccated not sweetened', /^Nuts, coconut meat, dried \(desiccated\), not sweetened/i, ['shredded coconut', 'kerisik']);
e('Coconut water', 'coconut water ready-to-drink unsweetened', /^Beverages, coconut water, ready-to-drink, unsweetened|^Nuts, coconut water/i, ['air kelapa']);
e('Tamarind', 'tamarinds raw', /^Tamarinds, raw/i, ['asam jawa']);
e('Soursop', 'soursop raw', /^Soursop, raw/i, ['durian belanda', 'guanabana']);
e('Sapodilla', 'sapodilla raw', /^Sapodilla, raw/i, ['ciku', 'chiku']);
e('Jujube', 'jujube raw', /^Jujube, raw/i, ['red dates']);
e('Breadfruit', 'breadfruit raw', /^Breadfruit, raw/i);
e('Applesauce', 'applesauce canned unsweetened', /^Applesauce, canned, unsweetened, without added ascorbic acid/i, ['apple sauce']);
e('Fruit cocktail', 'fruit cocktail canned heavy syrup', /^Fruit cocktail, \(peach and pineapple and pear and grape and cherry\), canned, heavy syrup, solids and liquids/i, ['canned fruit']);
e('Canned peaches', 'peaches canned light syrup pack', /^Peaches, canned, light syrup pack, solids and liquids/i);
e('Plantain raw', 'plantains yellow raw', /^Plantains, yellow, raw/i);
e('Quince', 'quinces raw', /^Quinces, raw/i);
e('Gooseberries', 'gooseberries raw', /^Gooseberries, raw/i);
e('Mulberries', 'mulberries raw', /^Mulberries, raw/i);

// --- Nuts and seeds -----------------------------------------------------------
e('Almonds', 'nuts almonds', /^Nuts, almonds$/i, ['almond', 'badam']);
e('Cashews', 'nuts cashew nuts raw', /^Nuts, cashew nuts, raw/i, ['cashew', 'cashew nuts', 'gajus']);
e('Walnuts', 'nuts walnuts english', /^Nuts, walnuts, english$/i, ['walnut']);
e('Pistachios', 'nuts pistachio nuts raw', /^Nuts, pistachio nuts, raw/i, ['pistachio']);
e('Hazelnuts', 'nuts hazelnuts or filberts', /^Nuts, hazelnuts or filberts$/i, ['hazelnut', 'filberts']);
e('Pecans', 'nuts pecans', /^Nuts, pecans$/i, ['pecan']);
e('Macadamia nuts', 'nuts macadamia nuts raw', /^Nuts, macadamia nuts, raw/i, ['macadamia']);
e('Brazil nuts', 'nuts brazilnuts dried unblanched', /^Nuts, brazilnuts, dried, unblanched/i);
e('Pine nuts', 'nuts pine nuts dried', /^Nuts, pine nuts, dried/i);
e('Chestnuts', 'nuts chestnuts european roasted', /^Nuts, chestnuts, european, roasted/i, ['roasted chestnuts']);
e('Mixed nuts', 'nuts mixed nuts dry roasted with peanuts', /^Nuts, mixed nuts, dry roasted, with peanuts, without salt/i, ['trail mix nuts', 'nuts']);
e('Sunflower seeds', 'seeds sunflower seed kernels dried', /^Seeds, sunflower seed kernels, dried/i, ['kuaci']);
e('Pumpkin seeds', 'seeds pumpkin and squash seed kernels dried', /^Seeds, pumpkin and squash seed kernels, dried/i, ['pepitas']);
e('Chia seeds', 'seeds chia seeds dried', /^Seeds, chia seeds, dried/i, ['chia']);
e('Flaxseed', 'seeds flaxseed', /^Seeds, flaxseed$/i, ['linseed', 'flax seeds']);
e('Sesame seeds', 'seeds sesame seeds whole dried', /^Seeds, sesame seeds, whole, dried/i, ['sesame', 'bijan']);
e('Hemp seeds', 'seeds hemp seed hulled', /^Seeds, hemp seed, hulled/i, ['hemp hearts']);
e('Peanut butter', 'peanut butter smooth style without salt', /^Peanut butter, smooth style, without salt/i, ['pb']);
e('Almond butter', 'nuts almond butter plain without salt', /^Nuts, almond butter, plain, without salt/i);
e('Tahini', 'seeds sesame butter tahini', /^Seeds, sesame butter, tahini, from (roasted and toasted|raw and stone ground) kernels/i, ['sesame paste']);
e('Nutella', 'chocolate-flavored hazelnut spread', /hazelnut spread/i, ['chocolate hazelnut spread'], 'Foundation,SR Legacy,Survey (FNDDS)');

// --- Oils and fats ------------------------------------------------------------
e('Coconut oil', 'oil coconut', /^Oil, coconut$/i, ['minyak kelapa']);
e('Sesame oil', 'oil sesame salad or cooking', /^Oil, sesame, salad or cooking/i);
e('Shortening', 'shortening vegetable household composite', /^Shortening, (vegetable, )?household, composite/i, ['vegetable shortening']);
e('Light mayonnaise', 'salad dressing mayonnaise light', /^Salad dressing, mayonnaise, light/i, ['light mayo']);

// --- Sauces, condiments, spreads --------------------------------------------------
e('Oyster sauce', 'sauce oyster ready-to-serve', /^Sauce, oyster, ready-to-serve/i, ['sos tiram']);
e('Fish sauce', 'sauce fish ready-to-serve', /^Sauce, fish, ready-to-serve/i, ['nam pla', 'budu', 'nuoc mam']);
e('Hoisin sauce', 'sauce hoisin ready-to-serve', /^Sauce, hoisin, ready-to-serve/i, ['hoisin']);
e('Teriyaki sauce', 'sauce teriyaki ready-to-serve', /^Sauce, teriyaki, ready-to-serve$/i, ['teriyaki']);
e('Barbecue sauce', 'sauce barbecue', /^Sauce, barbecue$/i, ['bbq sauce']);
e('Sweet and sour sauce', 'sauce sweet and sour ready-to-serve', /^Sauce, sweet and sour, ready-to-serve/i, ['sweet sour sauce']);
e('Hot sauce', 'sauce ready-to-serve pepper tabasco', /^Sauce, ready-to-serve, pepper or hot/i, ['tabasco', 'sriracha']);
e('Mustard', 'mustard prepared yellow', /^Mustard, prepared, yellow/i, ['yellow mustard', 'dijon']);
e('Salsa', 'sauce salsa ready-to-serve', /^Sauce, salsa, ready-to-serve/i, ['pico de gallo', 'tomato salsa']);
e('Guacamole', 'guacamole', /^Guacamole/i, ['guac'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Pesto', 'sauce pesto ready-to-serve', /^Sauce, pesto, ready-to-serve, (refrigerated|shelf stable)/i, ['basil pesto']);
e('Marinara sauce', 'sauce pasta spaghetti marinara ready-to-serve', /^Sauce, pasta, spaghetti\/marinara, ready-to-serve$/i, ['pasta sauce', 'tomato pasta sauce', 'spaghetti sauce']);
e('Alfredo sauce', 'sauce alfredo', /alfredo/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Gravy', 'gravy beef canned ready-to-serve', /^Gravy, beef, canned, ready-to-serve/i, ['brown gravy', 'beef gravy']);
e('Chicken gravy', 'gravy chicken canned ready-to-serve', /^Gravy, chicken, canned/i);
e('Ranch dressing', 'salad dressing ranch dressing regular', /^Salad dressing, ranch dressing, regular/i, ['ranch']);
e('Caesar dressing', 'salad dressing caesar dressing regular', /^Salad dressing, caesar dressing, regular/i);
e('Italian dressing', 'salad dressing italian dressing commercial regular', /^Salad dressing, italian dressing, commercial, regular/i);
e('Vinaigrette', 'salad dressing home recipe vinegar and oil', /^Salad dressing, home recipe, vinegar and oil/i, ['oil and vinegar dressing', 'french dressing']);
e('Thousand island dressing', 'salad dressing thousand island commercial regular', /^Salad dressing, thousand island, commercial, regular/i);
e('Tzatziki', 'tzatziki', /tzatziki/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Miso', 'miso', /^Miso$/i, ['miso paste']);
e('Vinegar', 'vinegar distilled', /^Vinegar, distilled/i, ['white vinegar', 'cuka'], S, 'acid');
e('Balsamic vinegar', 'vinegar balsamic', /^Vinegar, balsamic/i);
e('Jam', 'jams and preserves', /^Jams and preserves$/i, ['jelly', 'preserves', 'jem']);
e('Maple syrup', 'syrups maple', /^Syrups, maple/i);
e('Brown sugar', 'sugars brown', /^Sugars, brown/i);
e('Cocoa powder', 'cocoa dry powder unsweetened', /^Cocoa, dry powder, unsweetened$/i, [], S, 'fiber');
e('Mango chutney', 'chutney', /chutney/i, ['chutney'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Worcestershire sauce', 'sauce worcestershire', /^Sauce, worcestershire/i);

// --- Sweets and snacks ----------------------------------------------------------
e('Milk chocolate', 'candies milk chocolate', /^Candies, milk chocolate$/i);
e('Dark chocolate', 'chocolate dark 70-85% cacao solids', /^Chocolate, dark, 70-85% cacao solids/i, ['70% chocolate']);
e('White chocolate', 'candies white chocolate', /^Candies, white chocolate/i);
e('Chocolate chip cookies', 'cookies chocolate chip commercially prepared regular', /^Cookies, chocolate chip, commercially prepared, regular, (lower fat|higher fat)/i, ['chocolate chip cookie']);
e('Oreo', 'cookies chocolate sandwich with creme filling regular', /^Cookies, chocolate sandwich, with creme filling, regular$/i, ['sandwich cookies', 'oreos']);
e('Shortbread', 'cookies shortbread commercially prepared plain', /^Cookies, shortbread, commercially prepared, plain/i);
e('Oatmeal cookies', 'cookies oatmeal commercially prepared regular', /^Cookies, oatmeal, commercially prepared, regular/i);
e('Digestive biscuits', 'cookies graham crackers plain or honey', /^Cookies, graham crackers, plain or honey/i, ['graham crackers', 'digestives']);
e('Potato chips', 'snacks potato chips plain salted', /^Snacks, potato chips, plain, salted/i, ['crisps', 'potato crisps']);
e('Tortilla chips', 'snacks tortilla chips plain white corn salted', /^Snacks, tortilla chips, plain, white corn, salted/i, ['nachos chips', 'corn chips']);
e('Pretzels', 'snacks pretzels hard plain salted', /^Snacks, pretzels, hard, plain, salted/i, ['pretzel']);
e('Prawn crackers', 'snacks shrimp cracker', /shrimp chips|prawn cracker|shrimp cracker/i, ['keropok', 'shrimp chips'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Saltine crackers', 'crackers saltines', /^Crackers, saltines \(includes oyster, soda, soup\)$/i, ['saltines', 'soda crackers']);
e('Chocolate cake', 'cake chocolate commercially prepared with chocolate frosting', /^Cake, chocolate, commercially prepared with chocolate frosting/i, ['chocolate cake with frosting']);
e('Sponge cake', 'cake sponge commercially prepared', /^Cake, sponge, commercially prepared/i);
e('Cheesecake', 'cheesecake commercially prepared', /^Cake, cheesecake, commercially prepared/i, ['cheese cake']);
e('Pound cake', 'cake pound commercially prepared butter', /^Cake, pound, commercially prepared, butter/i, ['butter cake']);
e('Carrot cake', 'cake carrot', /carrot/i, [], F);
e('Brownie', 'brownies commercially prepared', /^Cookies, brownies, commercially prepared$/i, ['brownies']);
e('Muffin', 'muffins blueberry commercially prepared', /^Muffins, blueberry, commercially prepared/i, ['blueberry muffin', 'muffins']);
e('Doughnut', 'doughnuts yeast-leavened glazed', /^Doughnuts, yeast-leavened, glazed/i, ['donut', 'glazed donut', 'donuts']);
e('Cinnamon roll', 'rolls cinnamon', /^Sweet rolls, cinnamon, commercially prepared with raisins|^Cinnamon bun/i, ['cinnamon bun']);
e('Danish pastry', 'danish pastry fruit', /^Danish pastry, fruit, enriched/i, ['danish']);
e('Apple pie', 'pie apple commercially prepared', /^Pie, apple, commercially prepared/i);
e('Puff pastry', 'puff pastry frozen ready-to-bake baked', /^Puff pastry, frozen, ready-to-bake, baked/i);
e('Custard', 'puddings vanilla ready-to-eat', /^Puddings, vanilla, ready-to-eat/i, ['vanilla pudding', 'pudding']);
e('Rice pudding', 'puddings rice ready-to-eat', /^Puddings, rice, ready-to-eat/i);
e('Jelly dessert', 'gelatin desserts dry mix prepared with water', /^Gelatin desserts, dry mix, prepared with water/i, ['jello', 'agar agar dessert']);
e('Gummy candy', 'candies gumdrops starch jelly pieces', /^Candies, gumdrops, starch jelly pieces/i, ['gummy bears', 'gummies']);
e('Hard candy', 'candies hard', /^Candies, hard$/i, ['candy', 'sweets', 'lollipop']);
e('Marshmallow', 'candies marshmallows', /^Candies, marshmallows/i, ['marshmallows']);
e('Granola bar', 'snacks granola bars hard plain', /^Snacks, granola bars, hard, plain/i, ['cereal bar', 'muesli bar']);
// Removed on review (misleading match, see notes): e('Protein bar', 'protein bar', /^(Snacks, )?(Nutrition|protein|Meal replacement).*bar/i, ['protein bars'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Snickers', 'candies mars snackfood us snickers bar', /SNICKERS Bar/i, ['candy bar', 'chocolate bar']);
e('KitKat', 'candies kit kat wafer bar', /KIT KAT/i, ['kit kat', 'wafer chocolate']);
e('Baklava', 'baklava', /^Baklava/i, [], F);
e('Churros', 'churros', /^Churro/i, ['churro'], F);
e('Tiramisu', 'tiramisu', /tiramisu/i, [], F);
e('Flan', 'flan', /^Flan/i, ['creme caramel', 'caramel custard'], F);

// --- Drinks (per 100 ml) ----------------------------------------------------------
e('Diet cola', 'beverages carbonated cola sugar-free', /^Beverages, carbonated, cola, (without caffeine, )?(sugar-free|diet)|^Beverages, carbonated, low calorie, cola/i, ['coke zero', 'diet coke', 'zero sugar soda'], S, 'diet');
e('Lemon-lime soda', 'beverages carbonated lemon-lime soda', /^Beverages, carbonated, lemon-lime soda, no caffeine/i, ['sprite', '7up', 'lemonade soda']);
e('Root beer', 'beverages carbonated root beer', /^Beverages, carbonated, root beer/i);
e('Ginger ale', 'beverages carbonated ginger ale', /^Beverages, carbonated, ginger ale/i);
e('Tonic water', 'beverages carbonated tonic water', /^Beverages, carbonated, tonic water/i);
e('Energy drink', 'beverages energy drink red bull', /^Beverages, Energy drink, RED BULL$|^Beverages, Energy drink, Citrus/i, ['red bull', 'monster']);
e('Sports drink', 'beverages sports drink gatorade', /^Beverages, (Sports drink|PEPSICO QUAKER, Gatorade|The COCA-COLA company, Powerade|Sports drink)/i, ['gatorade', 'isotonic drink', '100plus']);
e('Lemonade', 'lemonade frozen concentrate white prepared with water', /^Lemonade, frozen concentrate, white, prepared with water/i);
e('Apple juice', 'apple juice canned or bottled unsweetened', /^Apple juice, canned or bottled, unsweetened, without added ascorbic acid/i);
e('Grape juice', 'grape juice canned or bottled unsweetened', /^Grape juice, canned or bottled, unsweetened, without added ascorbic acid/i);
e('Pineapple juice', 'pineapple juice canned unsweetened', /^Pineapple juice, canned( or bottled)?, unsweetened, without added ascorbic acid/i);
e('Cranberry juice', 'cranberry juice cocktail bottled', /^Cranberry juice cocktail, bottled$|^Beverages, cranberry-apple juice drink/i);
e('Tomato juice', 'tomato juice canned without salt added', /^Tomato juice, canned, without salt added/i);
e('Mango juice', 'mango nectar canned', /^Mango nectar, canned/i, ['mango nectar']);
e('Smoothie', 'smoothie fruit', /^(Fruit smoothie|Smoothie)/i, ['fruit smoothie'], F);
e('Beer', 'alcoholic beverage beer regular all', /^Alcoholic beverage, beer, regular, all/i, ['lager', 'pint of beer'], S, 'alcohol');
e('Light beer', 'alcoholic beverage beer light', /^Alcoholic beverage, beer, light$/i, [], S, 'alcohol');
e('Red wine', 'alcoholic beverage wine table red', /^Alcoholic beverage, wine, table, red$/i, ['wine'], S, 'alcohol');
e('White wine', 'alcoholic beverage wine table white', /^Alcoholic beverage, wine, table, white$/i, [], S, 'alcohol');
e('Vodka', 'alcoholic beverage distilled vodka 80 proof', /^Alcoholic beverage, distilled, vodka, 80 proof/i, ['spirits', 'gin', 'whiskey', 'rum'], S, 'alcohol');
// Removed on review (misleading match, see notes): e('Latte', 'coffee latte', /^Coffee, Latte, nonfat$|^Coffee, Latte$/i, ['cafe latte', 'flat white'], F);
e('Cappuccino', 'coffee cappuccino', /^Coffee, cappuccino$|^Coffee, cappuccino, (whole|reduced)/i, [], F);
e('Hot chocolate', 'beverages hot chocolate prepared with milk', /^Hot chocolate \/ Cocoa, ready to drink|^Beverages, cocoa mix, .*prepared with water|^Hot chocolate/i, ['cocoa drink', 'hot cocoa'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Green tea', 'beverages tea green brewed regular', /^Beverages, tea, green, brewed, regular/i, ['tea', 'black tea', 'teh o kosong'], S, 'diet');
e('Sweet iced tea', 'beverages tea ready-to-drink lemon sweetened', /^Beverages, tea, black, ready-to-drink, lemon, sweetened|^Beverages, tea, ready-to-drink, lemon, (sweetened|diet)/i, ['iced lemon tea', 'ice lemon tea']);
e('Bubble tea', 'bubble tea', /^Tea, bubble/i, ['boba tea', 'boba', 'pearl milk tea'], F);
e('Milkshake', 'milk shake vanilla', /^Shake, fast food, vanilla|^Milk shakes, thick vanilla/i, ['vanilla milkshake', 'shake'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Kombucha', 'kombucha', /kombucha/i, [], F);
e('Whey protein powder', 'beverages protein powder whey based', /^Beverages, Protein powder whey based/i, ['whey', 'protein powder', 'whey protein']);

// --- Composite / fast-food dishes (USDA FNDDS) ----------------------------------
e('Cheese pizza', 'pizza cheese from restaurant or fast food medium crust', /^Pizza, cheese, from restaurant or fast food, medium crust/i, ['pizza', 'pizza slice', 'margherita pizza'], F);
e('Pepperoni pizza', 'pizza with pepperoni from restaurant or fast food medium crust', /^Pizza with pepperoni, from restaurant or fast food, +medium crust/i, [], F);
e('Hamburger', 'hamburger single patty plain', /^Hamburger, on white bun, 1 medium patty/i, ['burger', 'beef burger'], F);
e('Cheeseburger', 'cheeseburger single patty plain', /^Cheeseburger, on white bun, 1 medium patty/i, [], F);
e('Chicken sandwich', 'chicken fillet sandwich fried fast food', /^(Chicken fillet|Fried chicken) sandwich/i, ['chicken burger', 'crispy chicken sandwich'], F);
e('Burrito', 'burrito with beef beans and rice', /^Burrito, beef, with beans and rice, cheese/i, ['beef burrito'], F);
e('Bean burrito', 'burrito with beans', /^Burrito, with beans, cheese/i, [], F);
e('Taco', 'taco with beef cheese and lettuce hard shell', /^Taco, corn tortilla, beef, cheese/i, ['tacos', 'beef taco'], F);
e('Quesadilla', 'quesadilla with cheese', /^Quesadilla, cheese only/i, ['cheese quesadilla'], F);
e('Nachos', 'nachos with cheese', /^Nachos, cheese only/i, ['nachos with cheese'], F);
e('Enchilada', 'enchilada with chicken', /^Enchilada, chicken/i, ['enchiladas'], F);
e('Fajita', 'chicken fajitas', /fajita/i, ['fajitas'], F);
e('Sushi roll', 'sushi roll california', /^Sushi roll, California/i, ['california roll', 'sushi', 'maki'], F);
e('Salmon sushi', 'sushi with fish', /^Sushi, (topped|with) .*(fish|salmon)|^Sushi roll, (salmon|fish)/i, ['nigiri', 'salmon nigiri'], F);
e('Pad thai', 'pad thai with chicken', /^Pad Thai/i, ['phad thai'], F);
// The ramen-bowl names moved to the real FNDDS ramen bowls (Asia section); this is the thin instant-noodle soup.
e('Ramen soup', 'ramen soup', /^Soup, ramen noodles, water added/i, ['ramen noodle soup'], F);
e('Pho', 'pho', /^Soup, pho, with meat/i, ['beef pho', 'pho bo'], F);
e('Lo mein', 'lo mein with chicken', /^Lo mein, with chicken$/i, ['chow mein'], F); // no "chicken lo mein": "chicken chop" fuzzy-matched it
e('General Tso chicken', 'general tso chicken', /General Tso/i, ['general tsos chicken'], F); // orange / sweet and sour chicken now have their own FNDDS rows
e('Kung pao chicken', 'kung pao chicken', /kung pao/i, [], F);
e('Beef and broccoli', 'beef and broccoli', /^Beef and broccoli/i, [], F);
e('Spring roll', 'egg rolls spring rolls', /^(Egg roll|Spring roll)/i, ['egg roll', 'popiah goreng', 'spring rolls'], F);
e('Fried dumplings', 'wonton dumpling pot sticker fried', /^Wonton, dumpling or pot sticker, fried$/i, ['dim sum', 'gyoza', 'potstickers', 'jiaozi', 'wontons'], F);
e('Steamed bun', 'pork bun steamed', /^(Steamed (bun|pork)|Pork bun|Bao)/i, ['char siu bao', 'pau', 'bao bun'], F);
e('Miso soup', 'soup miso', /^Soup, miso|^Miso soup/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Chicken noodle soup', 'soup chicken noodle', /^Chicken noodle soup$|^Soup, chicken noodle, canned, prepared with equal volume water/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Tomato soup', 'soup tomato canned prepared with equal volume water', /^Soup, tomato, canned, prepared with equal volume water/i);
e('Lentil soup', 'lentil soup', /^Soup, lentil$/i, [], F);
e('Minestrone', 'minestrone soup', /^Soup, minestrone/i, [], F);
e('Biryani', 'biryani with chicken', /biryani/i, ['chicken biryani', 'nasi briyani'], F);
e('Samosa', 'samosa', /samosa/i, ['samosas'], F);
e('Palak paneer', 'palak paneer', /paneer/i, ['saag paneer'], F);
e('Pakora', 'pakora', /pakora/i, ['bhaji', 'onion bhaji'], F);
e('Shawarma', 'gyro sandwich', /^Gyro sandwich/i, ['doner kebab', 'gyro'], F);
e('Kebab', 'kabob beef', /^(Beef|Lamb|Chicken) (kabob|kebab|shish)/i, ['shish kebab', 'kabob'], F);
e('Tabbouleh', 'tabbouleh', /tabbouleh/i, ['tabouli'], F);
e('Baba ganoush', 'baba ghanoush', /^Eggplant dip/i, ['eggplant dip'], F);
e('Paella', 'paella', /paella/i, [], F);
e('Lasagna', 'lasagna with meat', /^Lasagna with meat$/i, ['lasagne', 'beef lasagna'], F);
e('Mac and cheese', 'macaroni and cheese from restaurant', /^Macaroni (or noodles )?(and|with) cheese/i, ['macaroni and cheese', 'mac n cheese'], F);
e('Meatloaf', 'meat loaf beef', /^Meat loaf|^Beef meat loaf/i, ['meat loaf'], F);
e('Beef stew', 'beef stew with potatoes and vegetables', /^Stew, beef$/i, ['stew'], F);
e('Chili con carne', 'chili con carne with beans', /^Chili with meat and beans$/i, ['chilli con carne', 'beef chili'], F);
e('Shepherds pie', 'shepherds pie', /shepherd/i, ['cottage pie'], F);
e('Chicken pot pie', 'chicken pot pie', /^Pot pie, chicken/i, ['pot pie'], F);
e('Club sandwich', 'club sandwich', /club sandwich/i, [], F);
e('Grilled cheese', 'grilled cheese sandwich', /^Grilled cheese sandwich/i, ['cheese toastie', 'cheese toast'], F);
e('BLT sandwich', 'bacon lettuce and tomato sandwich', /^Bacon, lettuce, tomato sandwich on white/i, ['blt'], F);
e('Tuna sandwich', 'tuna salad sandwich', /^Tuna salad sandwich/i, [], F);
e('Ham sandwich', 'ham sandwich', /^Ham sandwich/i, [], F);
e('Egg sandwich', 'egg salad sandwich', /^Egg salad sandwich/i, ['egg mayo sandwich'], F);
e('Peanut butter and jelly sandwich', 'peanut butter and jelly sandwich', /^Peanut butter and jelly sandwich/i, ['pb and j', 'pbj'], F);
e('Sub sandwich', 'ham sandwich or sub with cheese restaurant', /^Ham sandwich or sub, with cheese, restaurant/i, ['subway sandwich', 'hoagie', 'sub'], F);
e('Breakfast burrito', 'breakfast burrito', /^Egg burrito, with sausage/i, [], F);
// Generic; the brand name now belongs to the real McDonald's entry below.
e('Egg muffin sandwich', 'english muffin with egg cheese and ham', /^Egg sandwich on English muffin, with ham/i, ['breakfast sandwich', 'egg muffin'], F);
e('Caesar salad', 'caesar salad with chicken', /^Caesar salad/i, ['chicken caesar salad'], F);
e('Garden salad', 'lettuce salad with assorted vegetables', /^Lettuce, salad with assorted vegetables/i, ['salad', 'green salad', 'side salad'], F);
e('Greek salad', 'greek salad', /greek salad/i, [], F);
e('Potato salad', 'potato salad with egg', /^Potato salad with egg|^Potato salad, home-prepared/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Chicken salad', 'chicken salad', /^Chicken salad/i, [], F);
e('Tuna salad', 'tuna salad', /^Tuna salad$|^Tuna salad, (made with mayonnaise|NFS)/i, ['tuna mayo'], F);
e('Mozzarella sticks', 'cheese fried mozzarella sticks', /mozzarella stick|fried cheese/i, ['cheese sticks'], F);
e('Garlic bread', 'garlic bread', /^Garlic bread/i, [], F);
e('Fried plantain', 'plantain fried', /^Plantain, (ripe, )?fried|^Plantains, yellow, fried/i, ['tostones', 'maduros', 'pisang goreng'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Rice and beans', 'rice with beans', /^Beans and white rice/i, ['arroz con frijoles', 'gallo pinto'], F);
e('Spanish rice', 'spanish rice', /^(Spanish|Mexican) rice/i, ['mexican rice', 'arroz rojo'], F);
e('Empanada', 'empanada', /^Empanada, beef$/i, ['empanadas', 'beef empanada'], F);
e('Tamale', 'tamale with meat', /^Tamale/i, ['tamales'], F);
// Was "Arepa Dominicana" (a sweet cornmeal cake); the restaurant arepa is the cornmeal bread people mean.
e('Arepa', 'restaurant latino arepa', /^Restaurant, Latino, arepa \(unleavened cornmeal bread\)/i, ['arepas']);
e('Pupusa', 'pupusa', /pupusa/i, [], F);
e('Ceviche', 'ceviche', /ceviche/i, [], F);
e('Bibimbap', 'bibimbap', /bibimbap|Korean rice/i, [], F);
e('Teriyaki chicken', 'chicken teriyaki', /^Chicken or turkey with teriyaki/i, ['chicken teriyaki'], F);
e('Tempura', 'tempura vegetables', /tempura/i, ['vegetable tempura'], F);
e('Croque monsieur', 'ham and cheese sandwich grilled', /^Ham sandwich on white, with cheese/i, ['ham and cheese sandwich', 'toasted ham and cheese'], F);
e('Quiche', 'quiche with meat', /^Quiche/i, ['quiche lorraine'], F);
e('Pierogi', 'pierogi', /pierogi|pirogi/i, [], F);
e('Ratatouille', 'ratatouille', /ratatouille/i, [], F);
e('Moussaka', 'moussaka', /^Eggplant and meat casserole/i, [], F);
e('Chicken parmesan', 'chicken parmigiana', /parmigiana|chicken parmesan/i, ['chicken parm'], F);
e('Pot roast', 'pot roast', /pot roast/i, [], F);
e('Overnight oats', 'oatmeal made with milk', /^Oatmeal, (regular or quick, )?made with milk|^Oatmeal, cooked, made with milk/i, ['oats with milk', 'porridge with milk'], F);
e('Eggs Benedict', 'eggs benedict', /benedict/i, [], F);
e('Dal makhani', 'dal makhani', /makhani|dal|dhal/i, ['dal fry', 'tadka dal', 'lentil curry'], F);
e('Vegetable curry', 'vegetable curry', /^Vegetable curry/i, ['sayur lodeh', 'mixed vegetable curry'], F);
e('Beef curry', 'beef curry', /^Beef curry/i, ['kari daging'], F);
e('Fried chicken wings', 'chicken wings fried', /^Chicken wing(s)?, (fried|coated, fried)/i, ['fried wings'], F);
e('Chicken tenders', 'chicken tenders', /chicken tender|chicken strip/i, ['chicken strips', 'chicken fingers'], F);
e('Fish taco', 'fish taco', /^Taco, fish/i, [], F);
e('Corn dog', 'corn dog', /corn dog/i, ['corndog'], F);
e('Wonton soup', 'wonton soup', /^Soup, wonton/i, [], F);
e('Hot and sour soup', 'hot and sour soup', /^Soup, hot and sour/i, ['suan la tang'], F);
e('Pork dumplings', 'dumpling steamed filled with meat', /^Wonton, dumpling or pot sticker, steamed$/i, ['xiao long bao', 'siu mai', 'shumai'], F);
e('Bread pudding', 'bread pudding', /^Pudding, bread/i, [], F);
e('Pecan pie', 'pie pecan', /^Pie, pecan/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Pumpkin pie', 'pie pumpkin', /^Pie, pumpkin/i, [], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Cupcake', 'cupcake', /^Cake or cupcake, NFS/i, ['cupcakes'], F);
e('Macarons', 'macaroon', /macaroon|macaron/i, ['macaroon'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Eclair', 'cream puff eclair', /^Cream puff, eclair, custard or cream filled, iced/i, ['eclairs', 'cream puff']);
e('Ice cream sandwich', 'ice cream sandwich', /ice cream sandwich/i, [], F);
e('Ice cream cone', 'ice cream cone', /ice cream cone/i, ['soft serve'], F);
e('Trail mix', 'snacks trail mix regular', /^Snacks, trail mix, regular$/i, ['scroggin']);
e('Beef stroganoff', 'beef stroganoff', /^Beef stroganoff$/i, ['stroganoff'], F);
e('Chicken noodle stir fry', 'chicken chow mein', /^Chicken or turkey chow mein or chop suey with noodles/i, ['chicken chow mein', 'chicken lo mein'], F);
e('Fried fish fillet', 'fish fillet battered or breaded fried', /^Fish, cod, fried/i, ['breaded fish'], F);
e('Pizza margherita thin', 'pizza cheese thin crust restaurant', /^Pizza, cheese, from restaurant or fast food, thin crust/i, ['thin crust pizza'], F);
e('Calzone', 'calzone', /calzone/i, [], F);
e('Stuffed peppers', 'stuffed pepper', /stuffed pepper|pepper, stuffed/i, [], F);
e('Chicken soup', 'chicken soup', /^Soup, chicken$/i, ['sup ayam'], F);
e('Mushroom soup', 'cream of mushroom soup', /^Cream of mushroom soup|^Soup, cream of mushroom, canned, prepared with equal volume water/i, ['cream of mushroom'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Pumpkin soup', 'pumpkin soup', /^Soup, pumpkin/i, [], F);
e('French onion soup', 'onion soup', /^Soup, French onion/i, [], F);
e('Gazpacho', 'gazpacho', /gazpacho/i, [], F);
e('Borscht', 'borscht', /borscht/i, ['beet soup'], F);
e('Jambalaya', 'jambalaya', /jambalaya/i, [], F);
e('Gumbo', 'gumbo', /gumbo/i, [], F);
// Not "Biscuit": in the hand table "biscuits" are cookies (UK / Malaysian usage).
e('Buttermilk biscuit', 'biscuits plain or buttermilk prepared from recipe', /^Biscuits, plain or buttermilk, prepared from recipe/i, ['scone']);
e('Pretzel bread', 'soft pretzel', /^Pretzels?, soft/i, ['soft pretzel'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Stuffing', 'bread stuffing', /stuffing/i, ['dressing stuffing'], 'Foundation,SR Legacy,Survey (FNDDS)');
e('Meatballs', 'meatballs with sauce', /^Meatballs, NS as to type of meat, with sauce$/i, ['meatball', 'meatballs in sauce'], F);
e('Fried chicken breast', 'chicken breast fried coated skin eaten', /^Chicken breast, fried, coated, skin \/ coating eaten, from raw$/i, ['breaded chicken breast', 'fried breast'], F);
e('Ice cream sundae', 'ice cream sundae', /^Ice cream sundae, NFS$/i, ['sundae'], F);
e('Chicken fried rice', 'chicken fried rice', /^Rice, fried, with chicken|^Fried rice with chicken|^Chicken fried rice/i, [], F);
e('Shrimp fried rice', 'shrimp fried rice', /shrimp/i, ['prawn fried rice'], F);

// =============================================================================
// Regional dishes, as eaten (USDA FNDDS / SR Legacy restaurant foods).
// FNDDS is queried on its own: a combined dataType list randomly returns 400.
// =============================================================================

// --- India ----------------------------------------------------------------------
region('india');
e('Plain dosa', 'dosa', /^Dosa, plain$/i, ['sada dosa', 'dosa plain'], F);
e('Sambar', 'sambar', /^Sambar/i, ['sambhar'], F);
e('Upma', 'upma', /^Upma$/i, ['uppuma', 'rava upma'], F);
e('Vada', 'vada', /^Vada$/i, ['medu vada', 'vadai'], F);
e('Vegetable biryani', 'biryani', /^Biryani with vegetables$/i, ['veg biryani'], F);
e('Meat biryani', 'biryani', /^Biryani with meat$/i, ['mutton biryani', 'lamb biryani', 'beef biryani'], F);
e('Masala chai', 'tea hot with milk', /^Tea, hot, with milk$/i, ['chai', 'chai tea', 'tea with milk', 'milk chai'], F);
e('Whole wheat paratha', 'paratha', /^Bread, paratha$/i, ['parantha', 'plain paratha'], F);
e('Whole wheat naan', 'bread naan whole wheat', /^Bread, naan, whole wheat, commercially prepared/i, ['wholemeal naan']);
e('Whole wheat chapati', 'bread chapati or roti whole wheat', /^Bread, chapati or roti, whole wheat/i, ['whole wheat roti', 'atta roti', 'phulka']);
e('Papad', 'papad', /^Papad/i, ['papadum', 'poppadom', 'pappadam'], F);
e('Chana saag', 'channa saag', /^Channa Saag/i, ['channa saag', 'chickpea spinach curry'], F);
e('Firni', 'firni indian pudding', /^Firni/i, ['phirni'], F);
e('Barfi', 'barfi burfi', /^Barfi/i, ['burfi'], F);
e('Ladoo', 'ladoo', /^Ladoo/i, ['laddu', 'laddoo'], F);
e('Lentil curry with rice', 'lentil curry with rice', /^Lentil curry with rice$/i, ['dal rice', 'dal chawal', 'dal with rice'], F);
e('Chicken curry with rice', 'chicken curry with rice', /^Chicken curry with rice$/i, ['curry chicken with rice'], F);
e('Vegetable curry with rice', 'vegetable curry with rice', /^Vegetable curry with rice$/i, ['veg curry with rice'], F);
e('Beef curry with rice', 'beef curry with rice', /^Beef curry with rice$/i, ['curry beef with rice'], F);
e('Fish curry with rice', 'fish curry with rice', /^Fish curry with rice$/i, ['curry fish with rice'], F);
e('Rice pilaf', 'rice pilaf', /^Rice pilaf$/i, ['pilaf', 'pilau', 'pulao', 'pulav'], F);
e('Rice with lentils', 'rice white with lentils', /^Rice, white, with lentils, fat added$/i, ['mujadara', 'mujaddara', 'khichdi', 'khichri'], F);

// --- Latin America -----------------------------------------------------------------
region('latin-america');
e('Arroz con pollo', 'restaurant latino chicken and rice', /^Restaurant, Latino, chicken and rice, entree/i, ['chicken and rice']);
e('Black beans and rice', 'black beans and white rice', /^Black beans and white rice$/i, ['rice and black beans', 'moros y cristianos', 'arroz con frijoles negros'], F);
e('Red beans and rice', 'kidney beans and white rice', /^Kidney beans and white rice$/i, ['rice and red beans', 'arroz con habichuelas'], F);
e('Pinto beans and rice', 'pinto beans and white rice', /^Pinto beans and white rice$/i, ['rice and pinto beans'], F);
e('Rice with pigeon peas', 'restaurant latino arroz con grandules', /^Restaurant, Latino, Arroz con grandules/i, ['arroz con gandules', 'arroz con grandules']);
e('Restaurant refried beans', 'refried beans', /^Refried beans, from fast food \/ restaurant$/i, ['refried beans restaurant'], F);
e('Meat tamale', 'tamale', /^Tamale, beef$/i, ['beef tamale', 'chicken tamale', 'pork tamale'], F);
e('Sweet tamale', 'tamale', /^Tamale, sweet$/i, ['tamal dulce'], F);
e('Cheese tamale', 'restaurant mexican cheese tamales', /^Restaurant, Mexican, cheese tamales/i, ['tamales de queso', 'tamale with cheese']);
e('Beef enchilada', 'enchilada', /^Enchilada, beef$/i, ['beef enchiladas'], F);
e('Pork enchilada', 'enchilada', /^Enchilada, pork$/i, ['pork enchiladas'], F);
e('Cheese enchilada', 'restaurant mexican cheese enchilada', /^Restaurant, Mexican, cheese enchilada/i, ['cheese enchiladas', 'enchiladas de queso']);
e('Bean enchilada', 'enchilada', /^Enchilada, no meat$/i, ['vegetarian enchilada', 'veggie enchilada'], F);
e('Chicken quesadilla', 'quesadilla', /^Quesadilla, chicken$/i, ['quesadilla de pollo'], F);
e('Beef quesadilla', 'quesadilla', /^Quesadilla, beef or pork$/i, ['steak quesadilla', 'pork quesadilla'], F);
e('Vegetable quesadilla', 'quesadilla', /^Quesadilla, with vegetables$/i, ['veggie quesadilla'], F);
e('Arepa Dominicana', 'arepa', /^Arepa Dominicana/i, [], F);
e('Chicken empanada', 'empanada', /^Empanada, chicken$/i, ['empanada de pollo'], F);
e('Vegetable empanada', 'empanada', /^Empanada, no meat$/i, ['meatless empanada'], F);
e('Fruit empanada', 'empanada', /^Empanada, fruit$/i, ['sweet empanada'], F);
e('Bean pupusa', 'pupusa', /^Pupusa, with beans$/i, ['pupusa de frijol', 'pupusas con frijoles'], F);
e('Cheese pupusa', 'pupusa', /^Pupusa, cheese only$/i, ['pupusa de queso'], F);
e('Pupusa revuelta', 'pupusa', /^Pupusa, meat, with beans$/i, ['pork and bean pupusa'], F);
e('Plantain chips', 'plantain chips', /^Plantain chips$/i, ['chifles', 'mariquitas'], F);
e('Tortilla soup', 'soup tortilla', /^Soup, tortilla$/i, ['sopa de tortilla'], F);
e('Pozole', 'soup pozole', /^Soup, pozole$/i, ['posole'], F);
e('Chile relleno', 'chiles rellenos', /^Chiles rellenos, cheese-filled$/i, ['chiles rellenos', 'chili relleno'], F);
e('Chicken mole', 'chicken with mole sauce', /^Chicken with mole sauce$/i, ['mole poblano', 'chicken in mole'], F);
e('Mole sauce', 'mole sauce', /^Mole sauce$/i, ['mole'], F);
e('Horchata', 'horchata', /^Horchata, made with water$/i, ['agua de horchata'], F);
e('Carnitas', 'pork carnitas', /^Pork, carnitas$/i, ['pork carnitas'], F);
e('Chimichanga', 'chimichanga', /^Chimichanga, meat$/i, ['beef chimichanga'], F);
e('Chicken chimichanga', 'chimichanga', /^Chimichanga, chicken$/i, [], F);
e('Chicken taquitos', 'taquito', /^Taquito, chicken$/i, ['taquitos', 'flautas', 'taquito'], F);
e('Beef taquitos', 'taquito', /^Taquito, beef or pork$/i, ['beef flautas'], F);
e('Taco salad', 'taco or tostada salad with meat', /^Taco or tostada salad with meat$/i, ['tostada salad', 'taco salad with beef'], F);
e('Chicken burrito bowl', 'burrito bowl chicken with beans and rice', /^Burrito bowl, chicken, with beans and rice$/i, ['burrito bowl'], F);
e('Chicken burrito', 'burrito chicken with beans and rice', /^Burrito, chicken, with beans and rice, cheese$/i, ['chicken burritos'], F);
e('Chicken taco', 'taco corn tortilla chicken', /^Taco, corn tortilla, chicken, cheese$/i, ['chicken tacos'], F);
e('Pork taco', 'taco corn tortilla pork', /^Taco, corn tortilla, pork, cheese$/i, ['carnitas taco', 'pork tacos'], F);
e('Bean taco', 'taco corn tortilla with beans', /^Taco, corn tortilla, with beans, cheese$/i, ['vegetarian taco'], F);
e('Soft beef taco', 'taco flour tortilla beef', /^Taco, flour tortilla, beef, cheese$/i, ['soft taco', 'flour tortilla taco'], F);
e('Chicken nachos', 'nachos chicken', /^Nachos, chicken$/i, [], F);
e('Beef nachos', 'nachos beef or pork', /^Nachos, beef or pork$/i, ['nachos with meat'], F);
e('Sopa de fideo', 'soup sopa de fideo', /^Soup, sopa de fideo/i, ['fideo soup'], F);
e('Caldo de pollo', 'soup sopa or caldo de pollo', /^Soup, sopa or caldo de pollo$/i, ['sopa de pollo'], F);
e('Caldo de res', 'soup sopa or caldo de res', /^Soup, sopa or caldo de res$/i, ['sopa de res'], F);
e('Cooked cassava', 'cassava cooked', /^Cassava, cooked$/i, ['yuca', 'boiled cassava', 'boiled yuca'], F);
e('Pan dulce', 'bread pan dulce', /^Bread, pan dulce/i, ['concha', 'mexican sweet bread']);
e('Black bean soup', 'restaurant latino black bean soup', /^Restaurant, Latino, black bean soup/i, ['sopa de frijoles negros']);
e('Tripe soup', 'restaurant latino tripe soup', /^Restaurant, Latino, tripe soup/i, ['menudo', 'mondongo']);
e('Bunuelos', 'restaurant latino bunuelos', /^Restaurant, Latino, bunuelos/i, ['bunuelo']);
e('Arroz con leche', 'restaurant latino arroz con leche', /^Restaurant, Latino, arroz con leche/i, ['latin rice pudding']);
e('Tres leches cake', 'cake tres leche', /^Cake, tres leche/i, ['tres leches', 'pastel de tres leches'], F);
e('Dulce de leche', 'dulce de leche', /^Dulce de leche$/i, ['cajeta'], F);
e('Cafe con leche', 'coffee cafe con leche', /^Coffee, cafe con leche$/i, ['cafe au lait'], F);
e('Pollo guisado', 'stewed chicken with tomato-based sauce mexican style', /^Stewed chicken with tomato-based sauce, Mexican style/i, ['stewed chicken'], F);
e('Whole wheat tortilla', 'tortilla whole wheat', /^Tortilla, whole wheat$/i, ['wholemeal wrap', 'whole wheat wrap'], F);
e('Black beans with meat', 'black beans with meat', /^Black beans with meat$/i, ['feijoada', 'black bean stew with pork'], F);
e('Rice with stewed beans', 'rice with stewed beans puerto rican style', /^Rice with stewed beans, Puerto Rican style$/i, ['arroz con habichuelas guisadas', 'habichuelas guisadas'], F);
e('Cheese gordita', 'gordita cheese only', /^Gordita, cheese only$/i, ['gordita de queso'], F);
e('Meat gordita', 'gordita meat', /^Gordita, meat$/i, ['gordita', 'gorditas'], F);
e('Chicken taco salad', 'taco or tostada salad with chicken', /^Taco or tostada salad with chicken$/i, ['chicken tostada salad'], F);
e('Buttered corn', 'corn fresh cooked with butter or margarine', /^Corn, fresh, cooked with butter or margarine$/i, ['corn with butter', 'buttered corn on the cob'], F);

// --- Middle East / Mediterranean ---------------------------------------------------
region('middle-east');
e('Falafel sandwich', 'falafel sandwich', /^Falafel sandwich$/i, ['falafel wrap', 'falafel pita'], F);
e('Lamb kebab', 'lamb shish kabob with vegetables', /^Lamb shish kabob with vegetables/i, ['lamb kabob', 'lamb shish kebab', 'lamb skewer'], F);
e('Chicken kebab', 'chicken or turkey shish kabob with vegetables', /^Chicken or turkey shish kabob with vegetables/i, ['chicken kabob', 'chicken shish kebab', 'shish tawook', 'chicken skewer'], F);
e('Shrimp kebab', 'shrimp shish kabob with vegetables', /^Shrimp shish kabob with vegetables/i, ['shrimp skewer', 'prawn kebab'], F);
e('Whole wheat pita', 'bread pita whole wheat', /^Bread, pita, whole-wheat/i, ['wholemeal pita', 'brown pita']);
e('Pita chips', 'pita chips', /^Pita chips$/i, [], F);
e('Stuffed grape leaves', 'grape leaves stuffed with rice', /^Grape leaves stuffed with rice$/i, ['dolma', 'dolmades', 'warak enab', 'vine leaves'], F);
e('Beef dolma', 'stuffed grape leaves with beef and rice', /^Stuffed grape leaves with beef and rice$/i, ['meat dolma'], F);
e('Lamb dolma', 'stuffed grape leaves with lamb and rice', /^Stuffed grape leaves with lamb and rice$/i, [], F);
e('Lentil soup with meat', 'soup lentil with meat', /^Soup, lentil, with meat$/i, [], F);
e('Spanakopita', 'spanakopita', /^Spanakopita$/i, ['spinach pie'], F);
e('Lamb stew', 'stew lamb', /^Stew, lamb$/i, ['mutton stew'], F);
e('Lamb with rice and vegetables', 'lamb or mutton rice and vegetables tomato-based sauce', /^Lamb or mutton, rice, and vegetables including carrots, broccoli, and\/or dark-green leafy; tomato-based sauce/i, ['lamb and rice', 'lamb with rice'], F);
e('Fried eggplant', 'fried eggplant', /^Fried eggplant$/i, ['fried aubergine', 'fried brinjal'], F);
e('Turkish coffee', 'coffee turkish', /^Coffee, Turkish$/i, ['arabic coffee'], F);

// --- Europe ------------------------------------------------------------------------------
region('europe');
e('Fried haddock', 'fish haddock fried', /^Fish, haddock, fried$/i, ['battered haddock', 'haddock and chips'], F);
e('Fish sandwich', 'fish sandwich fried on white bun', /^Fish sandwich, fried, on white bun$/i, ['fried fish sandwich', 'fish burger'], F);
e('Cheese croissant', 'croissant cheese', /^Croissant, cheese$/i, [], F);
e('Chocolate croissant', 'croissant chocolate', /^Croissant, chocolate$/i, ['pain au chocolat'], F);
e('Fruit croissant', 'croissant fruit', /^Croissant, fruit$/i, [], F);
e('Croissant breakfast sandwich', 'egg sandwich on croissant', /^Egg sandwich on croissant$/i, ['egg croissant', 'breakfast croissant'], F);
e('Cheese quiche', 'cheese quiche meatless', /^Cheese quiche, meatless$/i, [], F);
e('Spinach quiche', 'spinach quiche meatless', /^Spinach quiche, meatless$/i, ['quiche florentine'], F);
e('Vegetable lasagna', 'lasagna meatless', /^Lasagna, meatless$/i, ['veggie lasagna', 'meatless lasagna'], F);
e('Chicken lasagna', 'lasagna with chicken or turkey', /^Lasagna with chicken or turkey$/i, ['turkey lasagna'], F);
e('Spinach lasagna', 'lasagna with meat and spinach', /^Lasagna with meat and spinach$/i, [], F);
e('Cheese gnocchi', 'gnocchi cheese', /^Gnocchi, cheese$/i, ['ricotta gnocchi', 'gnudi'], F);
e('Swedish meatballs', 'swedish meatballs with cream or white sauce', /^Swedish meatballs with cream or white sauce$/i, ['kottbullar', 'meatballs in cream sauce'], F);
e('Meatball sandwich', 'meatball sandwich or sub', /^Meatball sandwich or sub$/i, [], F);
e('Chocolate crepe', 'crepe chocolate filled', /^Crepe, chocolate filled$/i, ['nutella crepe'], F);
e('Fruit crepe', 'crepe fruit filled', /^Crepe, fruit filled$/i, ['strawberry crepe'], F);
e('Savory crepe', 'crepe with meat', /^Crepe, with meat$/i, ['ham crepe', 'galette'], F);
e('Bruschetta', 'bruschetta', /^Bruschetta$/i, [], F);
e('Spaghetti bolognese', 'restaurant italian spaghetti with meat sauce', /^Restaurant, Italian, spaghetti with meat sauce/i, ['spaghetti with meat sauce', 'pasta bolognese', 'spag bol']);
e('Spaghetti pomodoro', 'restaurant italian spaghetti with pomodoro sauce', /^Restaurant, Italian, spaghetti with pomodoro sauce/i, ['spaghetti with tomato sauce', 'pasta pomodoro']);
e('Spaghetti and meatballs', 'restaurant family style spaghetti and meatballs', /^Restaurant, family style, spaghetti and meatballs/i, ['spaghetti meatballs']);
e('Ravioli with marinara', 'restaurant italian cheese ravioli with marinara sauce', /^Restaurant, Italian, cheese ravioli with marinara sauce/i, ['ravioli with sauce', 'ravioli marinara']);
e('Yorkshire pudding', 'popover', /^Popover$/i, ['popover', 'popovers'], F);
e('Fruit scone', 'scone with fruit', /^Scone, with fruit$/i, ['currant scone', 'raisin scone'], F);
e('Belgian waffle', 'waffle plain fast food restaurant', /^Waffle, plain, fast food \/ restaurant$/i, ['restaurant waffle'], F);
e('Apple strudel', 'strudel apple', /^Strudel, apple$/i, ['apfelstrudel', 'strudel'], F);
e('Beef bourguignon', 'beef burgundy', /^Beef burgundy$/i, ['boeuf bourguignon', 'beef burgundy'], F);
e('Beef Wellington', 'beef wellington', /^Beef wellington$/i, [], F);
e('Potato pancake', 'potato pancake', /^Potato pancake$/i, ['latke', 'latkes', 'potato pancakes', 'kartoffelpuffer'], F);
e('Stuffed cabbage rolls', 'stuffed cabbage rolls with beef and rice', /^Stuffed cabbage rolls with beef and rice$/i, ['cabbage rolls', 'golabki', 'sarma', 'holubtsi'], F);
e('Paella mixta', 'paella', /^Paella, NFS$/i, ['mixed paella'], F);
e('Bratwurst', 'bratwurst', /^Bratwurst$/i, ['brat', 'bratwurst sausage'], F);
e('Meat tortellini', 'tortellini meat-filled no sauce', /^Tortellini, meat-filled, no sauce$/i, ['tortellini with meat'], F);
e('Spinach tortellini', 'tortellini spinach-filled no sauce', /^Tortellini, spinach-filled, no sauce$/i, [], F);
e('Manicotti', 'manicotti cheese-filled with tomato sauce', /^Manicotti, cheese-filled, with tomato sauce, meatless$/i, ['cheese manicotti'], F);
e('Stuffed shells', 'stuffed shells cheese-filled with tomato sauce', /^Stuffed shells, cheese-filled, with tomato sauce, meatless$/i, ['stuffed pasta shells', 'jumbo shells'], F);
e('Eggplant parmesan', 'eggplant parmesan casserole', /^Eggplant parmesan casserole, regular$/i, ['eggplant parmigiana', 'aubergine parmigiana', 'melanzane'], F);
e('Veal parmigiana', 'veal parmigiana', /^Veal parmigiana$/i, ['veal parmesan', 'veal parm'], F);
e('Veal Marsala', 'veal marsala', /^Veal Marsala$/i, [], F);
e('Veal scallopini', 'veal scallopini', /^Veal scallopini$/i, ['veal scaloppine'], F);
e('Chicken cacciatore', 'chicken or turkey cacciatore', /^Chicken or turkey cacciatore$/i, ['pollo alla cacciatora'], F);
e('Chicken Kiev', 'chicken kiev', /^Chicken kiev$/i, [], F);
e('Bouillabaisse', 'soup bouillabaisse', /^Soup, bouillabaisse$/i, ['fish soup'], F);
e('Focaccia', 'focaccia', /^Focaccia, Italian, plain$/i, [], F);
e('Knish', 'knish', /^Knish$/i, ['potato knish'], F);
e('Cannoli', 'pastry italian with cheese', /^Pastry, Italian, with cheese$/i, ['cannolo'], F);
e('Beef stroganoff with noodles', 'beef stroganoff with noodles', /^Beef stroganoff with noodles$/i, [], F);
e('Veal cordon bleu', 'veal cordon bleu', /^Veal cordon bleu$/i, ['cordon bleu'], F);
e('Breaded pork chop', 'pork chop coated', /^Pork, chop, coated, NS as to fat eaten$/i, ['pork schnitzel', 'pork cutlet', 'breaded pork cutlet', 'tonkatsu'], F);
e('Country fried steak', 'beef steak country fried', /^Beef, steak, country fried$/i, ['chicken fried steak'], F);
// USDA has no "risotto"; this is its cheese/cream rice dish (fat added), which is what risotto is.
e('Creamy cheese rice', 'rice white with cheese or cream based sauce fat added', /^Rice, white, with cheese and\/or cream based sauce, fat added$/i, ['risotto', 'cheese risotto', 'parmesan risotto'], F);

// --- East / Southeast Asia -------------------------------------------------------------
region('asia');
e('Ramen bowl', 'ramen bowl', /^Ramen bowl, NFS$/i, ['ramen bowl with egg', 'restaurant ramen'], F);
e('Tonkotsu ramen', 'ramen bowl with meat and egg', /^Ramen bowl with meat and egg$/i, ['pork ramen'], F);
e('Beef ramen', 'ramen bowl with beef', /^Ramen bowl with beef$/i, [], F);
e('Chicken ramen', 'ramen bowl with chicken', /^Ramen bowl with chicken$/i, [], F);
e('Seafood ramen', 'ramen bowl with fish', /^Ramen bowl with fish$/i, ['fish ramen'], F);
e('Vegetarian ramen', 'ramen bowl vegetarian', /^Ramen bowl, vegetarian$/i, ['veggie ramen'], F);
e('Vegetarian pho', 'soup pho no meat', /^Soup, pho, no meat$/i, ['pho chay', 'veggie pho'], F);
e('Plain bao', 'bao bun no meat', /^Bao bun, no meat$/i, ['mantou', 'veggie bao'], F);
e('Beef chow mein', 'beef chow mein or chop suey with noodles', /^Beef chow mein or chop suey with noodles$/i, ['beef chop suey'], F);
e('Pork chow mein', 'pork chow mein or chop suey with noodles', /^Pork chow mein or chop suey with noodles$/i, ['pork chop suey'], F);
e('Shrimp chow mein', 'shrimp chow mein or chop suey with noodles', /^Shrimp chow mein or chop suey with noodles$/i, ['prawn chow mein'], F);
e('Vegetable chow mein', 'chow mein or chop suey meatless with noodles', /^Chow mein or chop suey, meatless, with noodles$/i, ['veg chow mein', 'vegetable chop suey'], F);
e('Beef lo mein', 'lo mein with beef', /^Lo mein, with beef$/i, [], F);
e('Pork lo mein', 'lo mein with pork', /^Lo mein, with pork$/i, [], F);
e('Shrimp lo mein', 'lo mein with shrimp', /^Lo mein, with shrimp$/i, ['prawn lo mein'], F);
e('Vegetable lo mein', 'lo mein meatless', /^Lo mein, meatless$/i, ['veg lo mein'], F);
e('Steak teriyaki', 'steak teriyaki', /^Steak teriyaki$/i, ['beef teriyaki'], F);
e('Shrimp teriyaki', 'shrimp teriyaki', /^Shrimp teriyaki$/i, ['prawn teriyaki'], F);
e('Tuna roll', 'sushi roll tuna', /^Sushi roll tuna$/i, ['tekka maki', 'tuna maki'], F);
e('Avocado roll', 'sushi roll avocado', /^Sushi roll, avocado$/i, ['avocado maki'], F);
e('Vegetable sushi roll', 'sushi roll vegetable', /^Sushi roll, vegetable$/i, ['veggie roll', 'cucumber roll', 'kappa maki'], F);
e('Eel roll', 'sushi roll eel', /^Sushi roll, eel$/i, ['unagi roll'], F);
e('Shrimp sushi roll', 'sushi roll shrimp', /^Sushi roll, shrimp$/i, ['ebi roll'], F);
e('Tuna nigiri', 'sushi topped with tuna', /^Sushi, topped with tuna$/i, ['maguro nigiri', 'maguro'], F);
e('Eel nigiri', 'sushi topped with eel', /^Sushi, topped with eel$/i, ['unagi nigiri', 'unagi'], F);
e('Tamago sushi', 'sushi topped with egg', /^Sushi, topped with egg$/i, ['tamago', 'tamago nigiri'], F);
e('Adobo with rice', 'adobo with rice', /^Adobo, with rice$/i, ['chicken adobo', 'pork adobo', 'adobo'], F);
e('Adobo with noodles', 'adobo with noodles', /^Adobo, with noodles$/i, [], F);
e('Congee with meat', 'congee with meat poultry or seafood', /^Congee, with meat, poultry, and\/or seafood$/i, ['chicken congee', 'pork congee', 'fish congee'], F);
e('Congee with egg', 'congee with egg', /^Congee, with egg$/i, ['century egg congee'], F);
e('Vegetable congee', 'congee with vegetables', /^Congee, with vegetables$/i, [], F);
e('Orange chicken', 'orange chicken', /^Orange chicken$/i, [], F);
e('Sweet and sour chicken', 'sweet and sour chicken or turkey', /^Sweet and sour chicken or turkey$/i, ['sweet sour chicken'], F);
e('Sweet and sour pork', 'sweet and sour pork', /^Sweet and sour pork$/i, ['sweet sour pork', 'gu lou yuk'], F);
e('Sweet and sour shrimp', 'sweet and sour shrimp', /^Sweet and sour shrimp$/i, ['sweet and sour prawns'], F);
e('Egg drop soup', 'soup egg drop', /^Soup, egg drop$/i, ['egg flower soup'], F);
e('Beef fried rice', 'rice fried with beef', /^Rice, fried, with beef$/i, [], F);
e('Pork fried rice', 'rice fried with pork', /^Rice, fried, with pork$/i, [], F);
e('Vegetable fried rice', 'rice fried meatless', /^Rice, fried, meatless$/i, ['veg fried rice'], F);
e('Moo goo gai pan', 'moo goo gai pan', /^Moo Goo Gai Pan$/i, [], F);
e('Szechuan beef', 'szechuan beef', /^Szechuan beef$/i, ['sichuan beef'], F);
e('Sesame chicken', 'sesame chicken', /^Sesame chicken$/i, [], F);
e('Peking duck', 'duck peking', /^Duck, Peking$/i, [], F);
e('Chinese barbecue pork', 'barbecue pork with sauce', /^Barbecue pork, with sauce$/i, ['chinese bbq pork', 'cha siu'], F);
e('Chinese lemon chicken', 'restaurant chinese lemon chicken', /^Restaurant, Chinese, lemon chicken/i, ['lemon chicken']);
e('Chicken and vegetables stir fry', 'restaurant chinese chicken and vegetables', /^Restaurant, Chinese, chicken and vegetables/i, ['chicken with mixed vegetables', 'chicken vegetable stir fry']);
e('Shrimp and vegetables stir fry', 'restaurant chinese shrimp and vegetables', /^Restaurant, Chinese, shrimp and vegetables/i, ['shrimp with vegetables', 'prawn stir fry']);
e('Tofu stir fry', 'tofu and vegetables including carrots broccoli', /^Tofu and vegetables including carrots, broccoli/i, ['tofu and vegetables', 'tofu with vegetables'], F);
e('Tteokbokki', 'dukboki or tteokbokki', /^Dukboki or Tteokbokki/i, ['dukboki', 'topokki', 'spicy rice cakes'], F);
e('Egg foo young', 'egg foo yung', /^Egg foo yung, NFS$/i, ['egg foo yung', 'shrimp egg foo young'], F);
e('Chicken egg foo young', 'chicken egg foo yung', /^Chicken egg foo yung$/i, [], F);
e('Pork egg roll', 'egg roll with beef or pork', /^Egg roll, with beef and\/or pork$/i, ['pork spring roll', 'lumpia'], F);
e('Shrimp egg roll', 'egg roll with shrimp', /^Egg roll, with shrimp$/i, ['prawn spring roll'], F);
e('Chicken egg roll', 'egg roll with chicken or turkey', /^Egg roll, with chicken or turkey$/i, ['chicken spring roll'], F);
e('Vegetable dumplings', 'dumpling no meat', /^Dumpling, no meat$/i, ['veggie dumplings', 'vegetable dumpling'], F);
e('Seafood pad thai', 'pad thai with seafood', /^Pad Thai with seafood$/i, ['shrimp pad thai', 'prawn pad thai'], F);
e('Vegetarian pad thai', 'pad thai meatless', /^Pad Thai, meatless$/i, ['tofu pad thai', 'veggie pad thai'], F);

// --- US restaurant chains (USDA SR Legacy, branded) ----------------------------
// Per 100 g like everything else; servingG = one item as USDA weighed it.
region('us-chains');
chain("McDonald's Big Mac", 'mcdonalds big mac', /^McDONALD'S, BIG MAC$/i, ['big mac', 'mcdonalds big mac']);
chain("McDonald's Quarter Pounder", 'mcdonalds quarter pounder', /^McDONALD'S, QUARTER POUNDER$/i, ['quarter pounder', 'mcdonalds quarter pounder']);
chain("McDonald's Quarter Pounder with Cheese", 'mcdonalds quarter pounder with cheese', /^McDONALD'S, QUARTER POUNDER with Cheese$/i, ['quarter pounder with cheese', 'qpc']);
chain("McDonald's Double Quarter Pounder with Cheese", 'mcdonalds double quarter pounder with cheese', /^McDONALD'S, DOUBLE QUARTER POUNDER with Cheese$/i, ['double quarter pounder']);
chain("McDonald's Hamburger", 'mcdonalds hamburger', /^McDONALD'S, Hamburger$/i, ['mcdonalds burger']);
chain("McDonald's Cheeseburger", 'mcdonalds cheeseburger', /^McDONALD'S, Cheeseburger$/i, []);
chain("McDonald's Double Cheeseburger", 'mcdonalds double cheeseburger', /^McDONALD'S, Double Cheeseburger$/i, []);
chain("McDonald's McChicken", 'mcdonalds mcchicken sandwich', /^McDONALD'S, McCHICKEN Sandwich$/i, ['mcchicken', 'mcchicken sandwich']);
chain("McDonald's Filet-O-Fish", 'mcdonalds filet-o-fish', /^McDONALD'S, FILET-O-FISH$/i, ['filet o fish', 'fillet o fish']);
chain("McDonald's Chicken McNuggets", 'mcdonalds chicken mcnuggets', /^McDONALD'S, Chicken McNUGGETS$/i, ['mcnuggets', 'chicken mcnuggets', 'mcdonalds nuggets']);
chain("McDonald's french fries", 'mcdonalds french fries', /^McDONALD'S, french fries$/i, ['mcdonalds fries', 'mcfries']);
chain("McDonald's hash brown", 'mcdonalds hash brown', /^McDONALD'S, Hash Brown$/i, []);
chain("McDonald's Egg McMuffin", 'mcdonalds egg mcmuffin', /^McDONALD'S, Egg McMUFFIN$/i, ['egg mcmuffin', 'mcmuffin']);
chain("McDonald's Sausage McMuffin", 'mcdonalds sausage mcmuffin', /^McDONALD'S, Sausage McMUFFIN$/i, ['sausage mcmuffin']);
chain("McDonald's Sausage McMuffin with Egg", 'mcdonalds sausage mcmuffin with egg', /^McDONALD'S, Sausage McMUFFIN with Egg$/i, ['sausage egg mcmuffin', 'sausage and egg mcmuffin']);
chain("McDonald's Sausage Biscuit", 'mcdonalds sausage biscuit', /^McDONALD'S, Sausage Biscuit$/i, []);
chain("McDonald's Bacon Egg and Cheese Biscuit", 'mcdonalds bacon egg cheese biscuit', /^McDONALD'S, Bacon Egg & Cheese Biscuit$/i, ['bacon egg and cheese biscuit']);
chain("McDonald's Sausage McGriddles", 'mcdonalds sausage mcgriddles', /^McDONALD'S, Sausage McGRIDDLES$/i, ['mcgriddle', 'mcgriddles', 'sausage mcgriddle']);
chain("McDonald's Hotcakes", 'mcdonalds hotcakes plain', /^McDONALD'S, Hotcakes \(plain\)$/i, ['mcdonalds pancakes'], /hotcakes/);
chain("McDonald's Big Breakfast", 'mcdonalds big breakfast', /^McDONALD'S, BIG BREAKFAST$/i, ['big breakfast']);
chain("McDonald's Sausage Burrito", 'mcdonalds sausage burrito', /^McDONALD'S, Sausage Burrito$/i, ['mcdonalds breakfast burrito']);
chain("McDonald's McFlurry with Oreo", 'mcdonalds mcflurry oreo', /^McDONALD'S, McFLURRY with OREO cookies$/i, ['mcflurry', 'oreo mcflurry'], /^regular/);
chain("McDonald's Hot Fudge Sundae", 'mcdonalds hot fudge sundae', /^McDONALD'S, Hot Fudge Sundae$/i, ['hot fudge sundae']);
chain("McDonald's Fruit 'n Yogurt Parfait", 'mcdonalds fruit yogurt parfait', /^McDONALD'S, Fruit 'n Yogurt Parfait$/i, ['fruit and yogurt parfait']);
chain("McDonald's Crispy Ranch Snack Wrap", 'mcdonalds ranch snack wrap crispy', /^McDONALD'S, RANCH SNACK WRAP, Crispy$/i, ['snack wrap', 'mcdonalds snack wrap']);
chain("McDonald's Southern Style Chicken Biscuit", 'mcdonalds southern style chicken biscuit', /^McDONALD'S, Southern Style Chicken Biscuit$/i, ['mcdonalds chicken biscuit']);

chain('Burger King Whopper', 'burger king whopper no cheese', /^BURGER KING, WHOPPER, no cheese$/i, ['whopper', 'bk whopper']);
chain('Burger King Whopper with Cheese', 'burger king whopper with cheese', /^BURGER KING, WHOPPER, with cheese$/i, ['whopper with cheese']);
chain('Burger King Double Whopper', 'burger king double whopper no cheese', /^BURGER KING, DOUBLE WHOPPER, no cheese$/i, ['double whopper']);
chain('Burger King Double Whopper with Cheese', 'burger king double whopper with cheese', /^BURGER KING, DOUBLE WHOPPER, with cheese$/i, ['double whopper with cheese']);
chain('Burger King Hamburger', 'burger king hamburger', /^BURGER KING, Hamburger$/i, []);
chain('Burger King Cheeseburger', 'burger king cheeseburger', /^BURGER KING, Cheeseburger$/i, []);
chain('Burger King Original Chicken Sandwich', 'burger king original chicken sandwich', /^BURGER KING, Original Chicken Sandwich$/i, ['bk chicken sandwich']);
chain('Burger King Chicken Strips', 'burger king chicken strips', /^BURGER KING, Chicken Strips$/i, ['bk chicken strips'], /^strip$/);
chain('Burger King french fries', 'burger king french fries', /^BURGER KING, french fries$/i, ['burger king fries', 'bk fries']);
chain('Burger King Onion Rings', 'burger king onion rings', /^BURGER KING, Onion Rings$/i, ['bk onion rings'], /^medium$/);
chain("Burger King Croissan'wich with Sausage Egg and Cheese", 'burger king croissanwich sausage egg cheese', /^BURGER KING, CROISSAN'WICH with Sausage, Egg and Cheese$/i, ['croissanwich', 'sausage egg and cheese croissanwich']);
chain('Burger King French Toast Sticks', 'burger king french toast sticks', /^BURGER KING, french toast sticks$/i, ['french toast sticks'], /^stick$/);
chain('Burger King Premium Fish Sandwich', 'burger king premium fish sandwich', /^BURGER KING, Premium Fish Sandwich$/i, ['bk fish sandwich']);

chain('KFC Original Recipe chicken breast', 'kfc fried chicken original recipe breast', /^KFC, Fried Chicken, ORIGINAL RECIPE, Breast, meat and skin with breading$/i, ['kfc chicken breast', 'kfc original recipe', 'kfc chicken', 'kfc'], /, with skin$/);
chain('KFC Original Recipe drumstick', 'kfc fried chicken original recipe drumstick', /^KFC, Fried Chicken, ORIGINAL RECIPE, Drumstick, meat and skin with breading$/i, ['kfc drumstick'], /, with skin$/);
chain('KFC Original Recipe thigh', 'kfc fried chicken original recipe thigh', /^KFC, Fried Chicken, ORIGINAL RECIPE, Thigh, meat and skin with breading$/i, ['kfc thigh'], /, with skin$/);
chain('KFC Original Recipe wing', 'kfc fried chicken original recipe wing', /^KFC, Fried Chicken, ORIGINAL RECIPE, Wing, meat and skin with breading$/i, ['kfc wing'], /, with skin$/);
chain('KFC Extra Crispy chicken breast', 'kfc fried chicken extra crispy breast', /^KFC, Fried Chicken, EXTRA CRISPY, Breast, meat and skin with breading$/i, ['kfc extra crispy'], /, with skin$/);
chain('KFC Popcorn Chicken', 'kfc popcorn chicken', /^KFC, Popcorn Chicken$/i, ['popcorn chicken'], null);
chain('KFC Crispy Chicken Strips', 'kfc crispy chicken strips', /^KFC, Crispy Chicken Strips$/i, ['kfc strips', 'kfc tenders']);
chain('KFC biscuit', 'kfc biscuit', /^KFC, biscuit$/i, []);
chain('KFC coleslaw', 'kfc coleslaw', /^KFC, Coleslaw$/i, ['kfc slaw'], /^package$/);

chain('Taco Bell Crunchy Taco', 'taco bell original taco beef cheese lettuce', /^TACO BELL, Original Taco with beef, cheese and lettuce$/i, ['crunchy taco', 'taco bell taco']);
chain('Taco Bell Soft Taco', 'taco bell soft taco beef cheese lettuce', /^TACO BELL, Soft Taco with beef, cheese and lettuce$/i, []);
chain('Taco Bell Chicken Soft Taco', 'taco bell soft taco chicken cheese lettuce', /^TACO BELL, Soft Taco with chicken, cheese and lettuce$/i, []);
chain('Taco Bell Bean Burrito', 'taco bell bean burrito', /^TACO BELL, Bean Burrito$/i, []);
chain('Taco Bell Burrito Supreme', 'taco bell burrito supreme beef', /^TACO BELL, BURRITO SUPREME with beef$/i, ['burrito supreme']);
chain('Taco Bell Nachos', 'taco bell nachos', /^TACO BELL, Nachos$/i, []);
chain('Taco Bell Nachos Supreme', 'taco bell nachos supreme', /^TACO BELL, Nachos Supreme$/i, ['nachos supreme']);
chain('Taco Bell Taco Salad', 'taco bell taco salad', /^TACO BELL, Taco Salad$/i, []);

chain('Subway Club sub', 'subway club sub', /^SUBWAY, SUBWAY CLUB sub on white bread/i, ['subway club'], /^inch sub$/);
chain('Subway Meatball Marinara sub', 'subway meatball marinara sub', /^SUBWAY, meatball marinara sub/i, ['meatball sub', 'meatball marinara'], /^inch sub$/);
chain('Subway Tuna sub', 'subway tuna sub', /^SUBWAY, tuna sub/i, ['tuna sub'], /^inch sub$/);
chain('Subway BLT sub', 'subway blt sub', /^SUBWAY, B\.L\.T\. sub/i, ['blt sub'], /^inch sub$/);
chain('Subway Cold Cut sub', 'subway cold cut sub', /^SUBWAY, cold cut sub/i, ['cold cut combo', 'cold cut sub'], /^inch sub$/);
chain('Subway Roast Beef sub', 'subway roast beef sub', /^SUBWAY, roast beef sub/i, ['roast beef sub'], /^inch sub$/);
chain('Subway Turkey Breast sub', 'subway turkey breast sub', /^SUBWAY, turkey breast sub/i, ['turkey sub'], /^inch sub$/);
chain('Subway Black Forest Ham sub', 'subway black forest ham sub', /^SUBWAY, black forest ham sub/i, ['ham sub'], /^inch sub$/);
chain('Subway Oven Roasted Chicken sub', 'subway oven roasted chicken sub', /^SUBWAY, oven roasted chicken sub/i, ['chicken sub'], /^inch sub$/);
chain('Subway Steak and Cheese sub', 'subway steak cheese sub', /^SUBWAY, steak & cheese sub/i, ['steak and cheese sub'], /^inch sub$/);
chain('Subway Sweet Onion Chicken Teriyaki sub', 'subway sweet onion chicken teriyaki sub', /^SUBWAY, sweet onion chicken teriyaki sub/i, ['chicken teriyaki sub'], /^inch sub$/);

chain('Pizza Hut cheese pizza, pan', 'pizza hut 14 cheese pizza pan crust', /^PIZZA HUT 14" Cheese Pizza, Pan Crust$/i, ['pizza hut cheese pizza', 'pizza hut pan pizza']);
chain('Pizza Hut pepperoni pizza, pan', 'pizza hut 14 pepperoni pizza pan crust', /^PIZZA HUT 14" Pepperoni Pizza, Pan Crust$/i, ['pizza hut pepperoni pizza']);
chain("Pizza Hut cheese pizza, Thin 'N Crispy", 'pizza hut 14 cheese pizza thin n crispy crust', /^PIZZA HUT 14" Cheese Pizza, THIN 'N CRISPY Crust$/i, ['pizza hut thin crust']);
chain('Pizza Hut cheese pizza, stuffed crust', 'pizza hut 14 cheese pizza stuffed crust', /^PIZZA HUT 14" Cheese Pizza, Stuffed Crust$/i, ['stuffed crust pizza']);
chain('Pizza Hut Super Supreme pizza', 'pizza hut 14 super supreme pizza hand-tossed', /^PIZZA HUT 14" Super Supreme Pizza, Hand-Tossed Crust$/i, ['super supreme pizza']);
chain('Pizza Hut breadstick', 'pizza hut breadstick parmesan garlic', /^PIZZA HUT, breadstick, parmesan garlic$/i, ['pizza hut breadsticks'], /^breadstick$/);
chain("Domino's cheese pizza, hand-tossed", 'dominos 14 cheese pizza classic hand-tossed', /^DOMINO'S 14" Cheese Pizza, Classic Hand-Tossed Crust$/i, ['dominos cheese pizza', 'dominos pizza']);
chain("Domino's pepperoni pizza, hand-tossed", 'dominos 14 pepperoni pizza classic hand-tossed', /^DOMINO'S 14" Pepperoni Pizza, Classic Hand-Tossed Crust$/i, ['dominos pepperoni pizza']);
chain("Domino's cheese pizza, crunchy thin", 'dominos 14 cheese pizza crunchy thin crust', /^DOMINO'S 14" Cheese Pizza, Crunchy Thin Crust$/i, ['dominos thin crust']);
chain("Domino's ExtravaganZZa pizza", 'dominos extravaganzza feast pizza', /^DOMINO'S 14" EXTRAVAGANZZA FEAST Pizza/i, ['extravaganzza']);
chain('Little Caesars cheese pizza', 'little caesars original round cheese pizza', /^LITTLE CAESARS 14" Original Round Cheese Pizza, Regular Crust$/i, ['little caesars pizza']);
chain('Little Caesars pepperoni pizza', 'little caesars original round pepperoni pizza', /^LITTLE CAESARS 14" Original Round Pepperoni Pizza, Regular Crust$/i, []);
chain("Papa John's cheese pizza", 'papa johns 14 cheese pizza original crust', /^PAPA JOHN'S 14" Cheese Pizza, Original Crust$/i, ['papa johns pizza']);
chain("Papa John's pepperoni pizza", 'papa johns 14 pepperoni pizza original crust', /^PAPA JOHN'S 14" Pepperoni Pizza, Original Crust$/i, []);
chain("Papa John's The Works pizza", 'papa johns the works pizza', /^PAPA JOHN'S 14" The Works Pizza, Original Crust$/i, []);

chain("Wendy's Dave's Single", 'wendys daves hot n juicy single', /^WENDY'S, DAVE'S Hot 'N Juicy 1\/4 LB, single$/i, ['daves single', 'wendys burger']);
chain("Wendy's Double Stack", 'wendys double stack with cheese', /^WENDY'S, Double Stack, with cheese$/i, ['double stack']);
chain("Wendy's Jr. Hamburger", 'wendys jr hamburger without cheese', /^WENDY'S, Jr\. Hamburger, without cheese$/i, ['junior hamburger']);
chain("Wendy's chicken nuggets", 'wendys chicken nuggets', /^WENDY'S, Chicken Nuggets$/i, ['wendys nuggets']);
chain("Wendy's french fries", 'wendys french fries', /^WENDY'S, french fries$/i, ['wendys fries']);
chain("Wendy's Frosty", 'wendys frosty dairy dessert', /^WENDY'S, Frosty Dairy Dessert$/i, ['frosty'], /^small/);
chain("Wendy's Homestyle Chicken Sandwich", 'wendys homestyle chicken fillet sandwich', /^WENDY'S, Homestyle Chicken Fillet Sandwich$/i, []);
chain("Wendy's Grilled Chicken Sandwich", 'wendys ultimate chicken grill sandwich', /^WENDY'S, Ultimate Chicken Grill Sandwich$/i, []);
chain('Chick-fil-A chicken sandwich', 'chick-fil-a chicken sandwich', /^CHICK-FIL-A, chicken sandwich$/i, ['chick fil a sandwich', 'chickfila sandwich']);
chain('Chick-fil-A Chick-n-Strips', 'chick-fil-a chick-n-strips', /^CHICK-FIL-A, Chick-n-Strips$/i, ['chick n strips', 'chick fil a strips'], /^strip$/);
chain('Chick-fil-A hash browns', 'chick-fil-a hash browns', /^CHICK-FIL-A, hash browns$/i, [], /^serving$/);
chain('Popeyes fried chicken breast', 'popeyes fried chicken mild breast', /^POPEYES, Fried Chicken, Mild, Breast, meat and skin with breading$/i, ['popeyes chicken', 'popeyes breast'], /, with skin$/);
chain('Popeyes fried chicken drumstick', 'popeyes fried chicken mild drumstick', /^POPEYES, Fried Chicken, Mild, Drumstick, meat and skin with breading$/i, ['popeyes drumstick'], /, with skin$/);
chain('Popeyes spicy chicken strips', 'popeyes spicy chicken strips', /^POPEYES, Spicy Chicken Strips/i, ['popeyes tenders', 'popeyes strips']);
chain('Popeyes biscuit', 'popeyes biscuit', /^POPEYES, biscuit$/i, []);
chain("Arby's Classic Roast Beef", 'arbys roast beef sandwich classic', /^ARBY'S, roast beef sandwich, classic$/i, ['arbys roast beef']);

// --- Fetch ----------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;
// Save the cache as we go, so an interrupted run (USDA can be slow) keeps what it fetched.
let unsaved = 0;
const remember = () => { if (CACHE_FILE && ++unsaved >= 10) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); unsaved = 0; } };
async function search(query, type) {
  const ck = `${type}|${query}`;
  if (cache[ck]) return cache[ck];
  // A "/" in the query (e.g. "and/or") makes the search API answer HTTP 400 every time.
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query.replace(/\//g, ' '))}&dataType=${encodeURIComponent(type)}&pageSize=25&api_key=${KEY}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastReq + 550 - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    let res;
    try { res = await fetch(url); } catch (err) { res = { ok: false, status: 0 }; }
    if (res.ok) {
      const json = await res.json();
      const foods = (json.foods || []).map((fd) => ({
        fdcId: fd.fdcId, description: fd.description, dataType: fd.dataType,
        n: Object.fromEntries((fd.foodNutrients || []).filter((x) => [1008, 1003, 1005, 1004].includes(x.nutrientId)).map((x) => [x.nutrientId, x.value])),
      }));
      cache[ck] = foods;
      remember();
      return foods;
    }
    if (![0, 400, 429].includes(res.status) && res.status < 500) throw new Error(`HTTP ${res.status} for ${query}`);
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`gave up after retries: ${query}`);
}

// One food's detail record (for its portions). Cached like searches.
async function detail(fdcId) {
  const ck = `food|${fdcId}`;
  if (cache[ck]) return cache[ck];
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${KEY}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastReq + 550 - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    let res;
    try { res = await fetch(url); } catch (err) { res = { ok: false, status: 0 }; }
    if (res.ok) {
      const json = await res.json();
      const portions = (json.foodPortions || []).map((p) => ({ g: p.gramWeight, amount: p.amount || 1, text: [p.portionDescription, p.modifier].filter((x) => x && !/^\d+$/.test(x)).join(' ') }));
      cache[ck] = portions;
      remember();
      return portions;
    }
    if (![0, 400, 429].includes(res.status) && res.status < 500) throw new Error(`HTTP ${res.status} for food ${fdcId}`);
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`gave up after retries: food ${fdcId}`);
}
// The portion that is ONE item as sold (sandwich, piece, slice, order...), not a cup or an ounce.
// USDA writes these as "item 7.6 oz", "sandwich", "1 slice", "order"...
const ITEM = /\b(item|sandwich|burger|serving|slice|piece|pieces|order|burrito|taco|biscuit|muffin|wrap|sundae|strip|strips|breast|thigh|drumstick|wing|sub|container|shake|parfait|platter)\b/i;
// Never a skinless / boneless / kids' portion: the rows are "meat and skin with breading".
const NOT_ITEM = /without skin|skin removed|\bkids?\b|kid's/i;
const pickPortion = (portions, pref) => {
  const ok = portions.filter((p) => p.g > 0);
  let c;
  if (pref) c = ok.filter((p) => pref.test(p.text)).sort((a, b) => a.g - b.g)[0]; // smallest: the 6-inch sub, not the footlong
  else { const m = ok.filter((p) => ITEM.test(p.text) && !NOT_ITEM.test(p.text)); c = m.find((p) => /medium/i.test(p.text)) || m[0]; }
  if (!c) return null;
  // "6 pieces" is counted by the piece ("6 nuggets" = 6 x one piece); everything else is one item as listed.
  const perPiece = c.amount > 1 && /\b(pieces|sticks|strips)\b/i.test(c.text) && !/serving/i.test(c.text);
  return { g: perPiece ? c.g / c.amount : c.g, text: perPiece ? `1 of ${c.amount} ${c.text}` : `${c.amount > 1 ? `${c.amount} ` : ''}${c.text}` };
};

const r1 = (x) => Math.round(x * 10) / 10;
const norm = (s) => s.toLowerCase().trim();
const problems = [];
const flagged = [];
const out = [];

let done = 0;
for (const ent of E) {
  if (++done % 50 === 0) console.error(`... ${done}/${E.length}`);
  let foods;
  try { foods = await search(ent.query, ent.type); } catch (err) { problems.push(`${ent.name}: fetch failed: ${err.message}`); continue; }
  const hit = foods.find((fd) => ent.pick.test(fd.description) && fd.n[1008] != null);
  if (!hit) {
    problems.push(`${ent.name}: no match for ${ent.pick} in [${foods.slice(0, 12).map((fd) => fd.description).join(' | ')}]`);
    continue;
  }
  const kcal = Math.round(hit.n[1008]);
  const p = r1(hit.n[1003] ?? 0), c = r1(hit.n[1005] ?? 0), fat = r1(hit.n[1004] ?? 0);
  const row = { ...ent, kcal, p, c, fat, desc: hit.description, fdcId: hit.fdcId };
  if (ent.serving && ent.portion !== null) {
    try {
      const portion = pickPortion(await detail(hit.fdcId), ent.portion);
      if (portion) { row.servingG = Math.round(portion.g); row.servingText = portion.text; }
      else problems.push(`${ent.name}: no one-item portion in USDA (${hit.fdcId})`);
    } catch (err) { problems.push(`${ent.name}: portion fetch failed: ${err.message}`); }
  }
  out.push(row);
}

// --- Validation ------------------------------------------------------------------
const seen = new Map();
// Also compared the way the search index compares them (punctuation gone,
// plurals stemmed): "samosas" and "samosa" are the same key to the lookup.
const phrase = (s) => normalizeText(s).split(' ').filter(Boolean).map(stem).join(' ');
const seenPhrase = new Map();
for (const h of INGREDIENTS_HAND) for (const k of [h.name, ...(h.aliases || [])]) {
  if (!seen.has(norm(k))) seen.set(norm(k), `hand:${h.name}`);
  if (!seenPhrase.has(phrase(k))) seenPhrase.set(phrase(k), `hand:${h.name}`);
}
for (const o of out) {
  if (o.kcal < 0 || o.kcal > 900) problems.push(`${o.name}: kcal ${o.kcal} out of range`);
  const atw = 4 * o.p + 4 * o.c + 9 * o.fat;
  // Exempt: alcohol (7 kcal/g not in macros), diet/zero drinks, vinegar (acetic
  // acid), high-fibre foods (USDA kcal uses specific factors; fibre counted in
  // carbs). Low-calorie produce (< 60 kcal) with a gap <= 20 kcal is the same
  // fibre effect, so it is flagged, not failed.
  const gap = Math.abs(atw - o.kcal);
  const exempt = ['alcohol', 'diet', 'acid', 'fiber'].includes(o.flags) || (o.kcal < 60 && gap <= 20);
  if (gap > 0.25 * o.kcal) {
    if (exempt) { o.atwaterExempt = true; flagged.push(`${o.name} (${o.flags || 'low-kcal fibre'}): kcal ${o.kcal} vs Atwater ${Math.round(atw)}`); }
    else problems.push(`${o.name}: Atwater ${Math.round(atw)} vs kcal ${o.kcal} [${o.desc}]`);
  }
  if (o.flags === 'cooked' && o.kcal >= 200) problems.push(`${o.name}: cooked grain ${o.kcal} >= 200`);
  if (o.flags === 'legume' && o.kcal >= 150) problems.push(`${o.name}: cooked legume ${o.kcal} >= 150`);
  for (const k of [o.name, ...o.aliases]) {
    const kk = norm(k);
    if (seen.has(kk)) problems.push(`${o.name}: "${k}" collides with ${seen.get(kk)}`);
    else seen.set(kk, `usda:${o.name}`);
    const pk = phrase(k);
    const owner = seenPhrase.get(pk);
    if (owner && owner !== `usda:${o.name}`) problems.push(`${o.name}: "${k}" is the same search phrase as ${owner}`);
    else seenPhrase.set(pk, `usda:${o.name}`);
  }
  if (o.serving && o.servingG != null && !(o.servingG >= 10 && o.servingG <= 1500)) problems.push(`${o.name}: servingG ${o.servingG} out of range`);
}

if (CACHE_FILE) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

console.log(`entries: ${E.length}, matched: ${out.length}`);
if (flagged.length) console.log(`flagged for manual look:\n  ${flagged.join('\n  ')}`);
if (process.env.LIST) for (const o of out) console.log(`${o.name.padEnd(28)} ${String(o.kcal).padStart(4)} P${o.p} C${o.c} F${o.fat}${o.servingG ? ` [${o.servingG} g: ${o.servingText}]` : ''}  <- ${o.desc}`);
if (process.env.REGIONS) {
  const by = {};
  for (const ent of E) (by[ent.region] ||= { listed: 0, matched: 0 }).listed++;
  for (const o of out) by[o.region].matched++;
  for (const [r, v] of Object.entries(by)) console.log(`region ${r.padEnd(14)} listed ${v.listed}, matched ${v.matched}`);
}
if (problems.length) {
  console.error(`\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const body = out.map((o) =>
  `  // ${o.desc.replace(/\*\//g, '* /')} (fdcId ${o.fdcId})${o.servingG ? `; 1 item = ${o.servingG} g (USDA portion: ${o.servingText.replace(/\*\//g, '* /')})` : ''}\n`
  + `  { name: ${q(o.name)}, calories: ${o.kcal}, protein: ${o.p}, carbs: ${o.c}, fats: ${o.fat}, aliases: [${o.aliases.map(q).join(', ')}]${o.servingG ? `, servingG: ${o.servingG}` : ''} },`,
).join('\n');
const flaggedNames = out.filter((o) => o.atwaterExempt).map((o) => q(o.name));
const ts = `// GENERATED by scripts/build-ingredients-usda.mjs from USDA FoodData Central.
// Do not edit by hand: change the entry list in the script and re-run it.
// Per 100 g (per 100 ml for drinks), food as normally eaten. kcal = nutrient 1008.
// servingG (restaurant-chain items only) = grams in one item, from the USDA portion.
import type { Per100Food } from './ingredients100g';

/** Reviewed by hand: alcohol, zero-calorie, vinegar, high-fibre — exempt from the Atwater macro check. */
export const USDA_ATWATER_EXEMPT: string[] = [${flaggedNames.join(', ')}];

export const INGREDIENTS_USDA: Per100Food[] = [
${body}
];
`;
fs.writeFileSync(path.join(ROOT, 'src/data/ingredientsUsda.ts'), ts);
console.log(`wrote src/data/ingredientsUsda.ts (${out.length} entries)`);
