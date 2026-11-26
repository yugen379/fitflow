/**
 * Every exercise in src/data/exerciseLibrary.json -> the motion family and
 * parameters its 3D demo is generated from.
 *
 * EXPLICIT on purpose: there is no default. An exercise missing from this
 * table has no demo, and `npm run proof:motions` fails on any library id that
 * is not listed here (and on any id listed here that is not in the library).
 *
 * `simplified` is set wherever the rig cannot honestly show the real thing
 * (no water, no machine drawn, single-segment spine...). The UI shows it as a
 * "Simplified demo" badge with the note, so nothing pretends to be exact.
 *
 * Data only: this module is imported by the Library / Workout screens to
 * decide whether to offer "See it in 3D", so it must stay tiny and free of
 * three.js and of the family generators.
 */

import type { ExerciseMotionSpec } from './families';
import { msg } from '../i18n/i18n';

const BW: ExerciseMotionSpec['equipment'] = ['bodyweight'];

export const EXERCISE_MOTIONS: Readonly<Record<string, ExerciseMotionSpec>> = {
  // --- Squat pattern ---------------------------------------------------
  squats: { family: 'squat', params: { variant: 'bodyweight' }, equipment: BW },
  tabata_squats: { family: 'squat', params: { variant: 'bodyweight', depth: 0.85 }, equipment: BW },
  front_squat: { family: 'squat', params: { variant: 'front' }, equipment: ['barbell'] },
  goblet_squat: { family: 'squat', params: { variant: 'goblet' }, equipment: ['kettlebell', 'dumbbell'] },
  hack_squat: { family: 'squat', params: { variant: 'hack', depth: 0.9 }, equipment: ['machine'], simplified: msg('Hack-squat sled is not drawn; shown as a supported upright squat.') },
  leg_press: { family: 'squat', params: { variant: 'legpress' }, equipment: ['machine'], simplified: msg('Foot plate and sled are not drawn.') },
  wall_sit: { family: 'squat', params: { variant: 'wallsit' }, equipment: BW },
  jump_squat: { family: 'squat', params: { variant: 'jump' }, equipment: BW },
  tuck_jump: { family: 'squat', params: { variant: 'tuck' }, equipment: BW },
  thruster: { family: 'squat', params: { variant: 'thruster' }, equipment: ['dumbbell', 'barbell'] },

  // --- Hinge -------------------------------------------------------------
  deadlift_straight: { family: 'hinge', params: { variant: 'deadlift' }, equipment: ['barbell'] },
  romanian_deadlift: { family: 'hinge', params: { variant: 'rdl' }, equipment: ['barbell', 'dumbbell'] },
  deadlift_stiff: { family: 'hinge', params: { variant: 'sldl' }, equipment: ['barbell', 'dumbbell'] },
  sumo_deadlift: { family: 'hinge', params: { variant: 'sumo' }, equipment: ['barbell'] },
  kb_swings: { family: 'hinge', params: { variant: 'swing' }, equipment: ['kettlebell'] },
  back_extension: { family: 'hinge', params: { variant: 'goodmorning' }, equipment: ['bodyweight', 'machine'], simplified: msg('Shown as a standing hip hinge; the back-extension bench is not drawn.') },

  // --- Lunge / split stance ---------------------------------------------
  lunges_db: { family: 'lunge', params: { variant: 'lunge' }, equipment: ['bodyweight', 'dumbbell'] },
  walking_lunge: { family: 'lunge', params: { variant: 'walking' }, equipment: ['bodyweight', 'dumbbell'], simplified: msg('Shown as a stationary lunge; the forward walk between reps is omitted.') },
  bulgarian_split_squat: { family: 'lunge', params: { variant: 'bulgarian' }, equipment: ['dumbbell', 'bodyweight'] },
  step_up: { family: 'lunge', params: { variant: 'stepup' }, equipment: ['bodyweight', 'dumbbell'] },
  hip_flexor_stretch: { family: 'lunge', params: { variant: 'hipflexor' }, equipment: BW },
  couch_stretch: { family: 'lunge', params: { variant: 'couch' }, equipment: BW },
  warrior_1: { family: 'lunge', params: { variant: 'warrior1' }, equipment: BW, simplified: msg('Back foot is shown pointing forward rather than turned out.') },

  // --- Push-up -----------------------------------------------------------
  pushups: { family: 'pushup', params: { variant: 'standard' }, equipment: BW },
  decline_pushup: { family: 'pushup', params: { variant: 'decline' }, equipment: BW },
  pike_pushup: { family: 'pushup', params: { variant: 'pike' }, equipment: BW },

  // --- Bench & forward press ---------------------------------------------
  bench_press: { family: 'benchPress', params: { variant: 'barbell' }, equipment: ['barbell'] },
  close_grip_bench: { family: 'benchPress', params: { variant: 'closegrip' }, equipment: ['barbell'] },
  db_bench_press: { family: 'benchPress', params: { variant: 'db' }, equipment: ['dumbbell'] },
  incline_press: { family: 'benchPress', params: { variant: 'incline' }, equipment: ['barbell'] },
  incline_db_press: { family: 'benchPress', params: { variant: 'inclinedb' }, equipment: ['dumbbell'] },
  svend_press: { family: 'benchPress', params: { variant: 'svend' }, equipment: BW },
  pallof_press: { family: 'benchPress', params: { variant: 'pallof' }, equipment: ['cable', 'band'] },

  // --- Overhead press -----------------------------------------------------
  bb_overhead_press: { family: 'overheadPress', params: { variant: 'barbell' }, equipment: ['barbell'] },
  shoulder_press_db: { family: 'overheadPress', params: { variant: 'db' }, equipment: ['dumbbell'] },
  arnold_press: { family: 'overheadPress', params: { variant: 'arnold' }, equipment: ['dumbbell'], simplified: msg('Forearm rotation (palms turning out) is approximated by opening the elbows.') },
  kb_clean_press: { family: 'overheadPress', params: { variant: 'kbcleanpress' }, equipment: ['kettlebell'] },

  // --- Rows ----------------------------------------------------------------
  barbell_row: { family: 'row', params: { variant: 'barbell' }, equipment: ['barbell'] },
  dumbbell_row: { family: 'row', params: { variant: 'db' }, equipment: ['dumbbell'] },
  single_arm_row: { family: 'row', params: { variant: 'single' }, equipment: ['dumbbell'] },
  cable_row: { family: 'row', params: { variant: 'seated' }, equipment: ['cable', 'machine'] },
  seated_cable_row: { family: 'row', params: { variant: 'seated' }, equipment: ['cable', 'machine'] },
  face_pulls: { family: 'row', params: { variant: 'facepull' }, equipment: ['cable'] },
  face_pull_band: { family: 'row', params: { variant: 'facepull' }, equipment: ['band'] },
  upright_row: { family: 'row', params: { variant: 'upright' }, equipment: ['barbell', 'dumbbell'] },
  inverted_row: { family: 'row', params: { variant: 'inverted' }, equipment: BW },
  shrugs: { family: 'row', params: { variant: 'shrug' }, equipment: ['dumbbell'], simplified: msg('The rig has no shoulder-blade elevation, so the shrug itself is barely visible.') },
  rowing_machine: { family: 'row', params: { variant: 'rowmachine' }, equipment: ['machine'], simplified: msg('Rowing machine (rail, seat, handle) is not drawn.') },

  // --- Vertical pull --------------------------------------------------------
  pullups: { family: 'verticalPull', params: { variant: 'pullup' }, equipment: BW },
  chin_ups: { family: 'verticalPull', params: { variant: 'chinup' }, equipment: BW },
  lat_pulldown: { family: 'verticalPull', params: { variant: 'pulldown' }, equipment: ['cable', 'machine'] },
  straight_arm_pulldown: { family: 'verticalPull', params: { variant: 'straightarm' }, equipment: ['cable'] },

  // --- Curls ---------------------------------------------------------------
  bb_curl: { family: 'curl', params: { variant: 'standard' }, equipment: ['barbell'] },
  bicep_curls: { family: 'curl', params: { variant: 'standard' }, equipment: ['dumbbell'] },
  hammer_curl: { family: 'curl', params: { variant: 'hammer' }, equipment: ['dumbbell'] },
  band_curl: { family: 'curl', params: { variant: 'band' }, equipment: ['band'] },
  preacher_curl: { family: 'curl', params: { variant: 'preacher' }, equipment: ['dumbbell'] },
  concentration_curl: { family: 'curl', params: { variant: 'concentration' }, equipment: ['dumbbell'] },

  // --- Triceps -------------------------------------------------------------
  overhead_tricep_ext: { family: 'triceps', params: { variant: 'overhead' }, equipment: ['dumbbell'] },
  tricep_pushdown: { family: 'triceps', params: { variant: 'pushdown' }, equipment: ['cable'] },
  band_tricep_ext: { family: 'triceps', params: { variant: 'pushdown' }, equipment: ['band'] },
  tricep_kickback: { family: 'triceps', params: { variant: 'kickback' }, equipment: ['dumbbell'] },
  skullcrusher: { family: 'triceps', params: { variant: 'skull' }, equipment: ['dumbbell'] },
  tricep_extension: { family: 'triceps', params: { variant: 'dip' }, equipment: BW, simplified: msg('Shown on parallel bars; a bench dip uses a bench behind you with the feet on the floor.') },
  chest_dips: { family: 'triceps', params: { variant: 'chestdip' }, equipment: BW },

  // --- Raises & flyes ------------------------------------------------------
  lateral_raise: { family: 'raise', params: { variant: 'lateral' }, equipment: ['dumbbell'] },
  front_raise: { family: 'raise', params: { variant: 'front' }, equipment: ['dumbbell'] },
  rear_delt_fly: { family: 'raise', params: { variant: 'rear' }, equipment: ['dumbbell'] },
  chest_fly_db: { family: 'raise', params: { variant: 'fly' }, equipment: ['dumbbell'] },
  cable_crossover: { family: 'raise', params: { variant: 'crossover' }, equipment: ['cable'], simplified: msg('Only the right-hand cable is drawn; a crossover uses a pulley on each side.') },

  // --- Core ----------------------------------------------------------------
  toe_touch_crunch: { family: 'core', params: { variant: 'toetouch' }, equipment: BW, simplified: msg('The spine is one rigid segment, so the curl is shown as a trunk lift.') },
  cable_crunch: { family: 'core', params: { variant: 'cablecrunch' }, equipment: ['cable'], simplified: msg('The spine is one rigid segment, so the crunch is shown as a trunk lift.') },
  russian_twist_v2: { family: 'core', params: { variant: 'russian' }, equipment: BW },
  dead_bug_v2: { family: 'core', params: { variant: 'deadbug' }, equipment: BW },
  flutter_kicks: { family: 'core', params: { variant: 'flutter' }, equipment: BW },
  lying_leg_raise: { family: 'core', params: { variant: 'legraise' }, equipment: BW },
  leg_raise: { family: 'core', params: { variant: 'hanginglegraise' }, equipment: BW },
  v_ups: { family: 'core', params: { variant: 'vup' }, equipment: BW },
  hollow_hold: { family: 'core', params: { variant: 'hollow' }, equipment: BW },
  side_bend: { family: 'core', params: { variant: 'sidebend' }, equipment: ['dumbbell'] },

  // --- Plank & quadruped ----------------------------------------------------
  plank: { family: 'plank', params: { variant: 'plank' }, equipment: BW },
  side_plank: { family: 'plank', params: { variant: 'side' }, equipment: BW },
  bird_dog: { family: 'plank', params: { variant: 'birddog' }, equipment: BW },
  bear_crawl: { family: 'plank', params: { variant: 'bear' }, equipment: BW, simplified: msg('Crawl is shown in place; the forward travel is omitted.') },
  plank_rotation: { family: 'plank', params: { variant: 'rotation' }, equipment: BW, simplified: msg('Rotation is partial (about 40 degrees) rather than a full side plank.') },
  ab_wheel: { family: 'plank', params: { variant: 'abwheel' }, equipment: BW, simplified: msg('The wheel itself is not drawn.') },
  cat_cow_v2: { family: 'plank', params: { variant: 'catcow' }, equipment: BW, simplified: msg('The spine is one rigid segment; arching is shown as pelvis tilt and head movement.') },
  thoracic_rotation: { family: 'plank', params: { variant: 'thoracic' }, equipment: BW },

  // --- Bridge -----------------------------------------------------------------
  glute_bridges_v2: { family: 'bridge', params: { variant: 'glute' }, equipment: BW },
  hip_thrust: { family: 'bridge', params: { variant: 'hipthrust' }, equipment: ['barbell', 'bodyweight'] },
  bridge_pose: { family: 'bridge', params: { variant: 'pose' }, equipment: BW },

  // --- Jumps & plyometrics -----------------------------------------------------
  jump_jacks_v2: { family: 'jump', params: { variant: 'jack' }, equipment: BW },
  jump_rope: { family: 'jump', params: { variant: 'rope' }, equipment: BW, simplified: msg('The rope is not drawn.') },
  box_jumps_v2: { family: 'jump', params: { variant: 'box' }, equipment: BW },
  burpees: { family: 'jump', params: { variant: 'burpee' }, equipment: BW },
  burpees_pushup: { family: 'jump', params: { variant: 'burpeePushup' }, equipment: BW },
  devil_press: { family: 'jump', params: { variant: 'devil' }, equipment: ['dumbbell'], simplified: msg('Shown as a burpee with push-up; the dumbbell swing to overhead is omitted.') },

  // --- Cardio -------------------------------------------------------------------
  outdoor_run: { family: 'cardio', params: { variant: 'run' }, equipment: BW, simplified: msg('Running is shown in place (treadmill view).') },
  treadmill_run: { family: 'cardio', params: { variant: 'run' }, equipment: ['machine'], simplified: msg('Treadmill belt is not drawn.') },
  sprint_intervals: { family: 'cardio', params: { variant: 'sprint' }, equipment: BW, simplified: msg('Sprinting is shown in place (treadmill view).') },
  shuttle_run: { family: 'cardio', params: { variant: 'sprint' }, equipment: BW, simplified: msg('Shown as running in place; the turns between cones are omitted.') },
  incline_walk: { family: 'cardio', params: { variant: 'walk' }, equipment: ['machine'], simplified: msg('Shown on flat ground; the treadmill incline is not drawn.') },
  stair_climber: { family: 'cardio', params: { variant: 'stair' }, equipment: ['machine'], simplified: msg('Steps are not drawn; shown as high stepping in place.') },
  high_knees_v2: { family: 'cardio', params: { variant: 'highknees' }, equipment: BW },
  mountain_climbers: { family: 'cardio', params: { variant: 'mountain' }, equipment: BW },
  cycling: { family: 'cardio', params: { variant: 'cycle' }, equipment: BW, simplified: msg('Only the saddle is drawn; pedals and frame are omitted.') },
  assault_bike: { family: 'cardio', params: { variant: 'assault' }, equipment: ['machine'], simplified: msg('Only the saddle is drawn; the fan bike and handles are omitted.') },
  elliptical: { family: 'cardio', params: { variant: 'elliptical' }, equipment: ['machine'], simplified: msg('Elliptical machine is not drawn; feet trace the pedal path.') },
  swimming: { family: 'cardio', params: { variant: 'swim' }, equipment: BW, simplified: msg('Freestyle stroke without water; body roll and kick are approximate.') },
  battle_ropes: { family: 'cardio', params: { variant: 'battle' }, equipment: BW, simplified: msg('Ropes are not drawn.') },
  sled_push: { family: 'cardio', params: { variant: 'sled' }, equipment: BW, simplified: msg('The sled is not drawn; driving steps are shown in place.') },

  // --- Calf & ankle --------------------------------------------------------------
  calf_raises: { family: 'calf', params: { variant: 'standing' }, equipment: BW },
  seated_calf_raise: { family: 'calf', params: { variant: 'seated' }, equipment: ['machine'] },
  ankle_mobility: { family: 'calf', params: { variant: 'ankle' }, equipment: BW },
  calf_stretch: { family: 'calf', params: { variant: 'stretch' }, equipment: BW },

  // --- Leg machines / knee isolation -----------------------------------------------
  leg_extension: { family: 'legMachine', params: { variant: 'extension' }, equipment: ['machine'], simplified: msg('Shin pad and lever arm are not drawn.') },
  leg_curl: { family: 'legMachine', params: { variant: 'curl' }, equipment: ['machine'], simplified: msg('Shown as a lying curl on a pad; the lever arm is not drawn.') },
  nordic_curl: { family: 'legMachine', params: { variant: 'nordic' }, equipment: BW },

  // --- Stretches, yoga, mobility, recovery -------------------------------------------
  hamstring_stretch: { family: 'stretch', params: { variant: 'hamstring' }, equipment: BW },
  quad_stretch: { family: 'stretch', params: { variant: 'quad' }, equipment: BW },
  shoulder_stretch: { family: 'stretch', params: { variant: 'shoulder' }, equipment: BW },
  chest_opener: { family: 'stretch', params: { variant: 'chest' }, equipment: BW },
  doorway_chest_stretch: { family: 'stretch', params: { variant: 'doorway' }, equipment: BW },
  neck_release: { family: 'stretch', params: { variant: 'neck' }, equipment: BW, simplified: msg('The neck only nods forward/back; side tilts are not modelled.') },
  seated_forward_fold: { family: 'stretch', params: { variant: 'forwardfold' }, equipment: BW },
  '90_90_hip_stretch': { family: 'stretch', params: { variant: 'seated9090' }, equipment: BW, simplified: msg('Leg rotation is approximate; shins are not exactly at 90/90.') },
  pigeon_pose: { family: 'stretch', params: { variant: 'pigeon' }, equipment: BW, simplified: msg('Front-shin rotation is approximate.') },
  child_pose_v2: { family: 'stretch', params: { variant: 'child' }, equipment: BW },
  downward_dog: { family: 'stretch', params: { variant: 'downdog' }, equipment: BW },
  cobra_pose: { family: 'stretch', params: { variant: 'cobra' }, equipment: BW },
  sun_salutation: { family: 'stretch', params: { variant: 'sun' }, equipment: BW, simplified: msg('Abbreviated flow (6 of the usual 12 positions).') },
  tree_pose: { family: 'stretch', params: { variant: 'tree' }, equipment: BW },
  triangle_pose: { family: 'stretch', params: { variant: 'triangle' }, equipment: BW, simplified: msg('Feet point forward rather than the front foot turning out.') },
  warrior_2: { family: 'stretch', params: { variant: 'warrior2' }, equipment: BW, simplified: msg('Feet point forward rather than the front foot turning out.') },
  corpse_pose: { family: 'stretch', params: { variant: 'corpse' }, equipment: BW },
  foam_roll_quads: { family: 'stretch', params: { variant: 'foamquads' }, equipment: BW, simplified: msg('Roller is drawn as a simple cylinder; contact is approximate.') },
  foam_roll_back: { family: 'stretch', params: { variant: 'foamback' }, equipment: BW, simplified: msg('Roller is drawn as a simple cylinder; contact is approximate.') },
};

export const hasExerciseMotion = (exerciseId: string | null | undefined): boolean =>
  !!exerciseId && Object.prototype.hasOwnProperty.call(EXERCISE_MOTIONS, exerciseId);

/** Simplified-demo note for an exercise, or null when the demo is a faithful one. */
export const exerciseMotionNote = (exerciseId: string | null | undefined): string | null =>
  (exerciseId && EXERCISE_MOTIONS[exerciseId]?.simplified) || null;
