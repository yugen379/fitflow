// Reference nutrition PER 100 g (cooked weight where it is normally eaten
// cooked; liquids per 100 ml). The meal pipeline looks ingredients up here
// first, then the bundled food list (when its serving states grams), then USDA.
// Values follow USDA FoodData Central / the Malaysian Food Composition
// Database, rounded. `calories` is kcal per 100 g.
//
// Pure data. The USDA-built table (ingredientsUsda.ts) is appended after the
// hand entries below, so a hand entry wins on any conflict.

import { INGREDIENTS_USDA } from './ingredientsUsda';

export interface Per100Food {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  aliases?: string[];
  /** Grams in one item as sold (restaurant-chain entries only, from the USDA portion). */
  servingG?: number;
}

const f = (name: string, calories: number, protein: number, carbs: number, fats: number, aliases: string[] = []): Per100Food =>
  ({ name, calories, protein, carbs, fats, aliases });

export const INGREDIENTS_HAND: Per100Food[] = [
  // --- Grains and starches (cooked) -------------------------------------
  f('White rice', 130, 2.7, 28, 0.3, ['rice', 'steamed rice', 'jasmine rice', 'nasi putih', 'basmati rice', 'cooked rice']),
  f('Brown rice', 112, 2.3, 24, 0.8, ['brown rice cooked']),
  f('Coconut rice', 190, 3, 30, 6.5, ['nasi lemak rice', 'santan rice', 'rice cooked in coconut milk']),
  f('Fried rice', 168, 4.5, 24, 6, ['nasi goreng', 'egg fried rice']),
  f('Glutinous rice', 97, 2, 21, 0.2, ['sticky rice', 'pulut']),
  f('Rice porridge', 46, 1, 10, 0.1, ['congee', 'bubur', 'porridge rice']),
  f('Yellow noodles', 138, 4.5, 25, 2, ['mee', 'mee kuning', 'egg noodles', 'hokkien noodles', 'noodles']),
  f('Flat rice noodles', 109, 1.8, 25, 0.2, ['kuey teow', 'kway teow', 'rice noodles', 'ho fun', 'pho noodles']),
  f('Rice vermicelli', 109, 1, 24, 0.2, ['bihun', 'mee hoon', 'vermicelli']),
  f('Instant noodles', 188, 4, 26, 7, ['maggi', 'ramen noodles instant', 'cup noodles']),
  f('Ramen noodles', 138, 5, 26, 1.5, ['ramen', 'wheat noodles']),
  f('Pasta', 158, 5.8, 31, 0.9, ['spaghetti', 'penne', 'macaroni', 'fettuccine']),
  f('White bread', 265, 9, 49, 3.2, ['bread', 'toast', 'roti putih', 'sandwich bread']),
  f('Wholemeal bread', 247, 13, 41, 3.4, ['whole wheat bread', 'brown bread', 'wholegrain bread']),
  f('Burger bun', 279, 9, 50, 4, ['bun', 'hamburger bun']),
  f('Roti canai', 320, 7, 45, 12, ['roti prata', 'paratha', 'prata']),
  f('Chapati', 297, 11, 46, 7, ['roti chapati', 'chapatti']),
  f('Naan', 290, 9, 50, 5.6, ['nan bread']),
  f('Tortilla', 310, 8, 52, 8, ['wrap', 'flour tortilla']),
  f('Potato', 87, 1.9, 20, 0.1, ['boiled potato', 'potatoes']),
  f('Mashed potato', 113, 2, 17, 4.2, ['mashed potatoes']),
  f('French fries', 312, 3.4, 41, 15, ['fries', 'chips', 'kentang goreng']),
  f('Sweet potato', 76, 1.4, 18, 0.1, ['ubi keledek']),
  f('Oats', 389, 17, 66, 7, ['rolled oats dry', 'oat flakes']),
  f('Oatmeal', 71, 2.5, 12, 1.5, ['porridge', 'cooked oats']),
  f('Corn', 96, 3.4, 21, 1.5, ['sweet corn', 'jagung']),
  f('Cornflakes', 357, 7.5, 84, 0.4, ['cereal', 'corn flakes']),

  // --- Protein --------------------------------------------------------------
  f('Chicken breast', 165, 31, 0, 3.6, ['grilled chicken', 'chicken', 'chicken fillet', 'dada ayam']),
  f('Chicken thigh', 209, 26, 0, 10.9, ['chicken leg', 'peha ayam']),
  f('Chicken with skin', 239, 27, 0, 14, ['roast chicken', 'steamed chicken', 'ayam rebus']),
  f('Fried chicken', 260, 22, 9, 15, ['ayam goreng', 'chicken drumstick fried', 'fried chicken drumstick', 'fried chicken thigh', 'crispy chicken']),
  f('Egg', 155, 13, 1.1, 10.6, ['boiled egg', 'hard boiled egg', 'eggs', 'telur rebus', 'poached egg']),
  f('Fried egg', 196, 13.6, 0.8, 14.8, ['telur mata', 'sunny side up egg', 'telur goreng']),
  f('Scrambled egg', 149, 10, 1.6, 11, ['scrambled eggs']),
  f('Omelette', 154, 10.6, 0.6, 12, ['omelet', 'telur dadar']),
  f('Beef', 250, 26, 0, 15, ['steak', 'beef steak', 'daging lembu', 'sirloin']),
  f('Ground beef', 254, 26, 0, 17, ['minced beef', 'beef mince', 'beef patty']),
  f('Beef rendang', 200, 18, 5, 12, ['rendang', 'rendang daging']),
  f('Lamb', 294, 25, 0, 21, ['mutton', 'kambing']),
  f('Pork', 242, 27, 0, 14, ['pork chop', 'char siu']),
  f('Salmon', 206, 22, 0, 12, ['grilled salmon']),
  f('White fish', 128, 26, 0, 2.7, ['fish', 'tilapia', 'ikan', 'cod', 'steamed fish', 'grilled fish', 'ikan bakar']),
  f('Fried fish', 232, 20, 8, 13, ['ikan goreng', 'battered fish']),
  f('Fried anchovies', 410, 40, 2, 27, ['ikan bilis', 'ikan bilis goreng', 'anchovies']),
  f('Prawns', 99, 24, 0.2, 0.3, ['shrimp', 'udang']),
  f('Squid', 92, 15.6, 3, 1.4, ['sotong', 'calamari']),
  f('Tuna', 116, 26, 0, 1, ['canned tuna', 'tuna in water']),
  f('Firm tofu', 144, 17, 3, 9, ['tofu', 'tauhu']),
  f('Fried tofu', 271, 17, 10, 20, ['tauhu goreng', 'tofu puff']),
  f('Tempeh', 192, 20, 8, 11, ['tempe']),
  f('Sausage', 280, 12, 3, 24, ['hot dog', 'frankfurter', 'chicken sausage']),
  f('Fish ball', 110, 11, 12, 1.5, ['fishball', 'bebola ikan']),
  f('Cheddar cheese', 403, 25, 1.3, 33, ['cheese', 'cheese slice']),
  f('Paneer', 296, 21, 3.6, 22),
  f('Lentils', 116, 9, 20, 0.4, ['dhal', 'dal', 'dhal curry']),
  f('Chickpeas', 164, 8.9, 27, 2.6, ['chana', 'garbanzo']),
  f('Peanuts', 585, 24, 21, 50, ['kacang', 'roasted peanuts', 'groundnuts']),

  // --- Vegetables -----------------------------------------------------------
  f('Cucumber', 15, 0.7, 3.6, 0.1, ['timun']),
  f('Tomato', 18, 0.9, 3.9, 0.2, ['tomatoes']),
  f('Lettuce', 15, 1.4, 2.9, 0.2, ['salad greens', 'mixed greens', 'salad leaves']),
  f('Broccoli', 35, 2.4, 7, 0.4),
  f('Leafy greens', 23, 2.6, 3.6, 0.4, ['spinach', 'kangkung', 'water spinach', 'bok choy', 'choy sum', 'sayur']),
  f('Mixed vegetables', 65, 2.9, 13, 0.2, ['vegetables', 'veggies', 'stir fried vegetables']),
  f('Cabbage', 25, 1.3, 6, 0.1, ['kobis']),
  f('Carrot', 41, 0.9, 10, 0.2, ['carrots']),
  f('Green peas', 81, 5.4, 14, 0.4, ['peas', 'pea', 'garden peas', 'frozen peas']),
  f('Spring onion', 32, 1.8, 7.3, 0.2, ['scallion', 'scallions', 'green onion', 'daun bawang']),
  f('Garlic', 149, 6.4, 33, 0.5, ['bawang putih']),
  f('Spinach', 23, 2.9, 3.6, 0.4, ['bayam']),
  f('Mushroom', 22, 3.1, 3.3, 0.3, ['mushrooms', 'cendawan']),
  f('Bell pepper', 26, 1, 6, 0.3, ['capsicum', 'peppers']),
  f('Onion', 40, 1.1, 9.3, 0.1, ['onions', 'bawang', 'shallots']),
  f('Bean sprouts', 30, 3, 6, 0.2, ['taugeh']),
  f('Long beans', 47, 2.8, 8, 0.4, ['kacang panjang', 'green beans']),
  f('Mushrooms', 22, 3.1, 3.3, 0.3, ['mushroom']),
  f('Avocado', 160, 2, 8.5, 14.7),

  // --- Fruit ----------------------------------------------------------------
  f('Banana', 89, 1.1, 23, 0.3, ['pisang']),
  f('Apple', 52, 0.3, 14, 0.2),
  f('Orange', 47, 0.9, 12, 0.1, ['oren']),
  f('Mango', 60, 0.8, 15, 0.4),
  f('Papaya', 43, 0.5, 11, 0.3),
  f('Watermelon', 30, 0.6, 7.6, 0.2, ['tembikai']),
  f('Grapes', 69, 0.7, 18, 0.2),
  f('Pineapple', 50, 0.5, 13, 0.1, ['nanas']),
  f('Durian', 147, 1.5, 27, 5.3),
  f('Berries', 57, 0.7, 14, 0.3, ['blueberries', 'strawberries']),

  // --- Mixed dishes the model names whole (meat + gravy / noodles + oil) ------
  f('Chicken curry', 150, 13, 4, 9, ['kari ayam', 'curry chicken', 'chicken curry with gravy']),
  f('Fish curry', 110, 12, 3, 6, ['kari ikan', 'curry fish', 'fish head curry']),
  f('Fried noodles', 165, 5, 23, 6, ['mee goreng', 'bihun goreng', 'fried mee', 'fried bee hoon']),
  f('Char kuey teow', 190, 6, 22, 9, ['fried kuey teow', 'char kway teow']),
  f('Chicken satay', 220, 22, 6, 12, ['satay', 'satay ayam']),

  // --- Sauces, gravies and broths --------------------------------------------
  f('Sambal', 170, 2, 12, 13, ['chili paste', 'chilli paste', 'sambal tumis', 'sambal belacan', 'sambal oelek', 'belacan']),
  f('Curry gravy', 120, 1.5, 5, 10, ['curry sauce', 'kuah kari', 'curry']),
  f('Peanut sauce', 250, 9, 17, 17, ['kuah kacang', 'satay sauce']),
  f('Laksa broth', 90, 2, 5, 7, ['curry laksa broth', 'coconut curry broth']),
  f('Clear soup', 10, 1, 1, 0.3, ['broth', 'soup', 'noodle soup broth', 'sup']),
  f('Ramen broth', 60, 3, 3, 4, ['tonkotsu broth', 'pork broth']),
  f('Soy sauce', 53, 8, 4.9, 0.6, ['kicap', 'soya sauce']),
  f('Ketchup', 101, 1, 27, 0.1, ['tomato sauce', 'sos tomato']),
  f('Mayonnaise', 680, 1, 0.6, 75, ['mayo']),
  f('Coconut milk', 230, 2.3, 6, 24, ['santan']),

  // --- Fats (also used by the cooking-oil adjustment) ------------------------
  f('Cooking oil', 884, 0, 0, 100, ['oil', 'vegetable oil', 'palm oil', 'olive oil', 'minyak']),
  f('Butter', 717, 0.9, 0.1, 81),
  f('Ghee', 900, 0, 0, 100, ['minyak sapi']),
  f('Margarine', 717, 0.2, 0.7, 80),

  // --- Drinks, dairy and sweet things (per 100 ml / 100 g) -------------------
  f('Milk', 61, 3.2, 4.8, 3.3, ['whole milk', 'full cream milk', 'susu']),
  f('Low fat milk', 42, 3.4, 5, 1, ['skim milk', 'skimmed milk']),
  f('Teh tarik', 60, 1.2, 10, 1.6, ['milk tea', 'teh susu', 'pulled tea']),
  f('Kopi with condensed milk', 55, 1, 9, 1.5, ['kopi', 'kopi susu', 'white coffee']),
  f('Black coffee', 2, 0.3, 0, 0, ['kopi o kosong', 'americano', 'espresso']),
  f('Sweetened condensed milk', 321, 7.9, 54, 8.7, ['condensed milk', 'susu pekat']),
  f('Sugar', 387, 0, 100, 0, ['gula']),
  f('Honey', 304, 0.3, 82, 0, ['madu']),
  f('Soft drink', 41, 0, 10.6, 0, ['soda', 'cola', 'fizzy drink']),
  f('Orange juice', 45, 0.7, 10, 0.2, ['juice', 'fruit juice']),
  f('Plain yogurt', 61, 3.5, 4.7, 3.3, ['yogurt', 'yoghurt']),
  f('Greek yogurt', 73, 10, 3.9, 2),
  f('Chocolate', 546, 4.9, 61, 31),
  f('Cream crackers', 440, 9.5, 68, 14, ['crackers', 'biscuits plain']),
  f('Cookies', 488, 5, 64, 24, ['biscuits', 'cookie']),
];

/** Lookup table: hand entries first (they win), then the USDA-built list. */
export const INGREDIENTS_100G: Per100Food[] = [...INGREDIENTS_HAND, ...INGREDIENTS_USDA];
