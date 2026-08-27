// Repair placeholder instructions — node scripts/fix-thin-exercises.mjs [--write]
//
// Twelve exercises shipped with one-line stubs in the field the user reads to
// learn the movement: "Kneel and fold.", "Lift hips while lying on back.",
// "Rotate side to side." They are not wrong, they are simply not instructions,
// and an app that claims to coach form cannot hand someone that.
//
// `npm run proof:library` now requires at least three steps, so a stub cannot
// return unnoticed.

import { readFileSync, writeFileSync } from 'node:fs';

const stripDrive = (p) => p.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = stripDrive(new URL('../', import.meta.url).pathname);
const FILE = ROOT + 'src/data/exerciseLibrary.json';
const WRITE = process.argv.includes('--write');

const FIX = {
  'Box Jumps': {
    instructions: [
      'Stand an arm\'s length from a stable box, feet hip-width apart.',
      'Dip into a quarter squat and swing your arms back.',
      'Drive up explosively and land softly on top of the box with both feet.',
      'Stand tall, then step — do not jump — back down.',
    ],
    tips: ['Step down every rep; jumping down is where ankles get hurt', 'Land quietly with the knees tracking over the toes'],
    commonMistakes: ['Choosing a box height that forces a deep tuck to clear', 'Landing with straight, stiff legs'],
  },
  'Cat-Cow Stretch': {
    instructions: [
      'Start on hands and knees, wrists under shoulders and knees under hips.',
      'Inhale and drop the belly, lifting the chest and tailbone into the cow position.',
      'Exhale and round the spine, tucking the chin and tailbone into the cat position.',
      'Move slowly between the two, one shape per breath.',
    ],
    tips: ['Let the breath set the pace, not the other way round', 'Move the whole spine, not just the lower back'],
    commonMistakes: ['Rushing through without breathing', 'Bending only at the lumbar spine'],
  },
  "Child's Pose": {
    instructions: [
      'Kneel on the floor with the big toes together and knees apart.',
      'Sit your hips back toward your heels.',
      'Walk your hands forward and let your forehead rest on the mat.',
      'Breathe into the back of the ribs and hold.',
    ],
    tips: ['Widen the knees if the belly gets in the way', 'A cushion under the hips helps if the heels are far away'],
    commonMistakes: ['Holding tension in the shoulders', 'Lifting the hips instead of letting them settle'],
  },
  'Dead Bug': {
    instructions: [
      'Lie on your back with arms straight up and knees bent above the hips.',
      'Press your lower back firmly into the floor and brace your abs.',
      'Slowly lower one arm overhead and the opposite leg toward the floor.',
      'Return to the start and repeat on the other side, keeping the back flat.',
    ],
    tips: ['Stop lowering the moment the lower back lifts', 'Exhale as the limbs extend'],
    commonMistakes: ['Letting the lower back arch away from the floor', 'Moving fast enough that momentum takes over'],
  },
  'Glute Bridges': {
    instructions: [
      'Lie on your back with knees bent and feet flat, heels near your glutes.',
      'Press through your heels and squeeze your glutes.',
      'Lift your hips until your body forms a straight line from knees to shoulders.',
      'Pause at the top, then lower under control.',
    ],
    tips: ['Finish the rep with a hard glute squeeze, not a lower-back arch', 'Keep the ribs down as the hips rise'],
    commonMistakes: ['Overextending the lower back at the top', 'Pushing through the toes instead of the heels'],
  },
  'Hamstring Stretch': {
    instructions: [
      'Sit on the floor with one leg extended and the other bent inward.',
      'Sit tall and lengthen your spine first.',
      'Hinge forward from the hips over the straight leg.',
      'Hold where you feel a stretch, breathe, then switch sides.',
    ],
    tips: ['Fold from the hips, not by rounding the back', 'A small bend in the knee is fine and often better'],
    commonMistakes: ['Rounding the spine to reach the toes', 'Bouncing at the end of the range'],
  },
  'High Knees': {
    instructions: [
      'Stand tall with your feet hip-width apart.',
      'Drive one knee up toward your chest, at least to hip height.',
      'Switch legs quickly, staying on the balls of your feet.',
      'Pump the arms in time with the legs.',
    ],
    tips: ['Stay tall — do not lean back as you tire', 'Quick, light contacts beat big slow ones'],
    commonMistakes: ['Letting the knees drop below hip height', 'Landing heavily on the heels'],
  },
  'Jump Jacks': {
    instructions: [
      'Stand upright with your feet together and arms at your sides.',
      'Jump your feet out wide while sweeping your arms overhead.',
      'Jump your feet back together and bring the arms down.',
      'Keep a steady rhythm and land softly through the mid-foot.',
    ],
    tips: ['Soft knees on every landing', 'Step out instead of jumping for a low-impact version'],
    commonMistakes: ['Landing flat-footed and heavily', 'Only half-raising the arms as fatigue sets in'],
  },
  'Russian Twist': {
    instructions: [
      'Sit on the floor with your knees bent and heels lightly touching down.',
      'Lean your torso back to about 45 degrees and brace your abs.',
      'Rotate your shoulders and hands to one side.',
      'Rotate smoothly to the other side, keeping the chest lifted.',
    ],
    tips: ['Rotate the ribcage, not just the arms', 'Lift the heels to make it harder'],
    commonMistakes: ['Swinging the hands while the torso stays still', 'Letting the back round as you tire'],
  },
  'Shoulder Stretch': {
    instructions: [
      'Stand or sit tall with your shoulders relaxed and down.',
      'Bring one arm straight across your chest at shoulder height.',
      'Use the opposite hand on the upper arm to draw it closer.',
      'Hold, breathe, then repeat on the other side.',
    ],
    tips: ['Keep the stretched shoulder pressed down, not shrugged', 'Pull on the upper arm, never on the elbow joint'],
    commonMistakes: ['Shrugging the shoulder toward the ear', 'Rotating the torso to increase the stretch'],
  },
  'Tree Pose': {
    instructions: [
      'Stand tall and shift your weight onto one foot.',
      'Place the sole of the other foot on the inner calf or inner thigh — never the knee.',
      'Press the foot and leg into each other and find your balance.',
      'Bring the hands to the chest or overhead, and hold while breathing steadily.',
    ],
    tips: ['Fix your eyes on a still point ahead', 'Toes of the lifted foot can rest on the floor while you build balance'],
    commonMistakes: ['Resting the foot directly against the knee joint', 'Letting the standing hip push out to the side'],
  },
  'Warrior 2': {
    instructions: [
      'Step your feet wide apart and turn the front foot out 90 degrees.',
      'Line up the front heel with the arch of the back foot.',
      'Bend the front knee until it is stacked over the ankle.',
      'Extend the arms out at shoulder height and gaze over the front hand.',
    ],
    tips: ['Front knee tracks over the second toe', 'Keep the torso stacked over the hips, not leaning forward'],
    commonMistakes: ['Letting the front knee collapse inward', 'Leaning the torso out over the front leg'],
  },
};

const data = JSON.parse(readFileSync(FILE, 'utf8'));
let fixed = 0;
const missing = [];

for (const ex of data) {
  const patch = FIX[ex.name];
  if (!patch) continue;
  ex.instructions = patch.instructions;
  if (patch.tips) ex.tips = patch.tips;
  if (patch.commonMistakes) ex.commonMistakes = patch.commonMistakes;
  fixed++;
}
for (const name of Object.keys(FIX)) {
  if (!data.some((e) => e.name === name)) missing.push(name);
}

const stillThin = data.filter((e) => (e.instructions || []).length < 3);
console.log(`repaired ${fixed} of ${Object.keys(FIX).length} targets`);
if (missing.length) console.log(`  not found in the library: ${missing.join(', ')}`);
console.log(`  entries still under 3 steps: ${stillThin.length}` +
  (stillThin.length ? ` (${stillThin.map((e) => e.name).join(', ')})` : ''));

if (WRITE) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('written.');
} else {
  console.log('dry run — pass --write to apply.');
}
