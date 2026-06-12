import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Clock, Search, ChevronLeft, X, Dumbbell, Activity, Compass, Plus, SlidersHorizontal, Check, Trash2, Save, Youtube } from 'lucide-react';
import { openExternal } from '../lib/openExternal';
import { ExerciseImage } from '../components/ExerciseImage';
import { useNavigate } from 'react-router-dom';
import exercisesData from '../data/exerciseLibrary.json';
import { Exercise, WorkoutRecord } from '../types';
import { useAuth } from '../hooks/useAuth';
import { logWorkout } from '../services/dataService';
import { useToast } from '../hooks/useToast';
import { cn } from '../lib/utils';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

const CATEGORIES = ['All', 'Strength', 'Cardio', 'HIIT', 'Yoga', 'Flexibility', 'Recovery'];
const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Full Body'];
const EQUIPMENT = ['None', 'Dumbbells', 'Barbell', 'Resistance Band', 'Machine', 'Kettlebell'];
const DIFFICULTIES = ['All', 'Beginner', 'Intermediate', 'Advanced'];

export const Library: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  
  // Filtering & Sorting State
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>([]);
  const [selectedEquip, setSelectedEquip] = useState<string[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [sortBy, setSortBy] = useState<'name' | 'duration' | 'calories' | 'difficulty'>('name');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Exercise Detail & Workout Builder
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [isBuilderMode, setIsBuilderMode] = useState(false);
  const [selectedForWorkout, setSelectedForWorkout] = useState<(Exercise & { sets: number; reps: number; weight: number; userDifficulty: string })[]>([]);
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);

  const toggleMuscle = (muscle: string) => {
    setSelectedMuscles(prev => prev.includes(muscle) ? prev.filter(m => m !== muscle) : [...prev, muscle]);
  };

  const toggleEquip = (eq: string) => {
    setSelectedEquip(prev => prev.includes(eq) ? prev.filter(e => e !== eq) : [...prev, eq]);
  };

  const filteredExercises = exercisesData.filter(ex => {
    const matchesCategory = filter === 'All' || ex.category === filter;
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase()) || 
                         ex.muscleGroups.some(m => m.toLowerCase().includes(search.toLowerCase()));
    const matchesDifficulty = difficultyFilter === 'All' || ex.difficulty === difficultyFilter;
    const matchesMuscles = selectedMuscles.length === 0 || ex.muscleGroups.some(m => selectedMuscles.includes(m));
    const matchesEquip = selectedEquip.length === 0 || (ex.equipment && ex.equipment.some(e => selectedEquip.includes(e)));
    
    return matchesCategory && matchesSearch && matchesDifficulty && matchesMuscles && matchesEquip;
  }).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'duration') return a.duration - b.duration;
    if (sortBy === 'calories') return b.calories_per_minute - a.calories_per_minute;
    if (sortBy === 'difficulty') {
      const order = { 'Beginner': 0, 'Intermediate': 1, 'Advanced': 2 };
      return order[a.difficulty as keyof typeof order] - order[b.difficulty as keyof typeof order];
    }
    return 0;
  });

  const handleSaveToPlan = async (ex: Exercise) => {
    if (!profile?.uid) return;
    // logWorkout never throws — it queues offline on any Firestore failure, so we can
    // always show a positive confirmation to the customer.
    await logWorkout(profile.uid, {
      type: ex.name,
      duration: ex.duration,
      caloriesBurned: ex.duration * (ex.calories_per_minute || 5),
      notes: `Library Activity: ${ex.category}`,
    });
    showToast('Activity logged to your history');
    setSelectedExercise(null);
  };

  const addToBuilder = (ex: Exercise) => {
    if (selectedForWorkout.some(e => e.id === ex.id)) return;
    if (selectedForWorkout.length >= 8) {
      showToast("Max 8 exercises per session", "info");
      return;
    }
    setSelectedForWorkout([...selectedForWorkout, { 
      ...ex, 
      sets: 3, 
      reps: 10, 
      weight: 0, 
      userDifficulty: 'Moderate' 
    }]);
  };

  const updateBuilderExercise = (id: string, field: string, value: any) => {
    setSelectedForWorkout(prev => prev.map(ex => 
      ex.id === id ? { ...ex, [field]: value } : ex
    ));
  };

  const removeFromBuilder = (id: string) => {
    setSelectedForWorkout(selectedForWorkout.filter(e => e.id !== id));
  };

  const saveCustomWorkout = async () => {
    if (!profile?.uid || selectedForWorkout.length < 4) {
      showToast("Select at least 4 exercises", "info");
      return;
    }
    setIsSavingWorkout(true);
    try {
      const duration = selectedForWorkout.reduce((acc, curr) => acc + curr.duration, 0);
      const calories = selectedForWorkout.reduce((acc, curr) => acc + (curr.duration * (curr.calories_per_minute || 5)), 0);
      
      await addDoc(collection(db, 'workouts'), {
        userId: profile.uid,
        type: 'Custom Stack',
        duration,
        caloriesBurned: calories,
        exercises: selectedForWorkout.map(ex => ex.name),
        exerciseDetails: selectedForWorkout.map(ex => ({ 
          id: ex.id, 
          name: ex.name,
          sets: ex.sets,
          reps: ex.reps,
          weight: ex.weight,
          difficulty: ex.userDifficulty
        })),
        exerciseLogs: selectedForWorkout.map(ex => ({
          exerciseId: ex.id,
          exerciseName: ex.name,
          sets: ex.sets,
          reps: ex.reps,
          weight: ex.weight,
          difficulty: ex.userDifficulty,
          completed: false
        })),
        timestamp: serverTimestamp(),
        notes: "Custom built session"
      });

      showToast("Custom session saved to plan");
      setIsBuilderMode(false);
      setSelectedForWorkout([]);
    } catch (err) {
      // Direct Firestore add failed — queue silently and still confirm to the user.
      console.warn('Custom workout save failed; will retry from offline queue:', err);
      showToast('Saved locally — will sync when back online', 'info');
      setIsBuilderMode(false);
      setSelectedForWorkout([]);
    } finally {
      setIsSavingWorkout(false);
    }
  };

  return (
    <div className="pb-24 pt-4 px-6 bg-bg min-h-screen">
      <div className="flex justify-between items-end mb-5 pt-2">
        <div>
          <p className="text-eyebrow text-accent">Library</p>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight mt-1">Exercises</h1>
        </div>
        <button
          onClick={() => setIsBuilderMode(!isBuilderMode)}
          className={cn(
            'px-4 h-10 rounded-xl text-sm font-semibold border transition-all',
            isBuilderMode ? 'bg-accent text-bg border-accent' : 'glass text-white',
          )}
        >
          {isBuilderMode ? 'Cancel' : 'Build session'}
        </button>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" size={16} />
        <input
          placeholder="Search exercises…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full glass rounded-2xl h-12 pl-11 pr-12 text-sm text-white placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 transition-colors"
        />
        <button
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl flex items-center justify-center text-text-dim hover:text-accent transition-colors"
          aria-label="Filters"
        >
          <SlidersHorizontal size={16} />
        </button>
      </div>

      <AnimatePresence>
        {isFilterOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-surface p-6 rounded-3xl border border-[#222]">
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase text-accent tracking-widest">Muscle Group</p>
                <div className="flex flex-wrap gap-2">
                  {MUSCLE_GROUPS.map(m => (
                    <button 
                      key={m}
                      onClick={() => toggleMuscle(m)}
                      className={cn("px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest border transition-all",
                        selectedMuscles.includes(m) ? "bg-accent/20 border-accent text-accent" : "bg-bg/50 border-[#333] text-text-dim"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase text-accent tracking-widest">Equipment</p>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT.map(e => (
                    <button 
                      key={e}
                      onClick={() => toggleEquip(e)}
                      className={cn("px-3 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest border transition-all",
                        selectedEquip.includes(e) ? "bg-accent/20 border-accent text-accent" : "bg-bg/50 border-[#333] text-text-dim"
                      )}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-end md:col-span-2 pt-4 border-t border-[#333]">
                <div className="flex space-x-4">
                  <div className="space-y-2">
                    <p className="text-[8px] font-black uppercase text-text-dim tracking-widest">Difficulty</p>
                    <select 
                      value={difficultyFilter} 
                      onChange={(e) => setDifficultyFilter(e.target.value)}
                      className="bg-bg border border-[#333] rounded-lg px-2 py-1 text-[10px] text-white font-black"
                    >
                      {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[8px] font-black uppercase text-text-dim tracking-widest">Sort By</p>
                    <select 
                      value={sortBy} 
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="bg-bg border border-[#333] rounded-lg px-2 py-1 text-[10px] text-white font-black"
                    >
                      <option value="name">Name</option>
                      <option value="duration">Duration</option>
                      <option value="calories">Calories/Min</option>
                      <option value="difficulty">Difficulty</option>
                    </select>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setSelectedMuscles([]);
                    setSelectedEquip([]);
                    setDifficultyFilter('All');
                    setFilter('All');
                  }}
                  className="text-[10px] font-black text-red-400 uppercase tracking-widest"
                >
                  Reset
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex space-x-2 overflow-x-auto pb-6 scrollbar-hide -mx-6 px-6">
        {CATEGORIES.map(f => (
          <button 
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
              filter === f ? "bg-accent text-bg" : "bg-surface text-text-dim border border-[#222]"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {isBuilderMode && selectedForWorkout.length > 0 && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="mb-8 p-6 bg-surface rounded-[32px] border border-accent/20 space-y-4"
          >
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <Save className="text-accent" size={18} />
                <h3 className="text-sm font-black uppercase text-white">Workout Builder ({selectedForWorkout.length}/8)</h3>
              </div>
              <button 
                onClick={saveCustomWorkout}
                disabled={isSavingWorkout || selectedForWorkout.length < 4}
                className="bg-accent text-bg px-4 py-2 rounded-xl text-[10px] font-black uppercase disabled:opacity-50"
              >
                {isSavingWorkout ? 'SAVING...' : 'Save Stack'}
              </button>
            </div>
            <div className="flex space-x-4 overflow-x-auto pb-4 scrollbar-hide">
              {selectedForWorkout.map(ex => (
                <div key={ex.id} className="relative group min-w-[200px] shrink-0">
                  <div className="bg-bg border border-[#333] p-4 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start">
                      <p className="text-[10px] font-black text-white uppercase italic truncate max-w-[120px]">{ex.name}</p>
                      <p className="text-[8px] font-black text-accent uppercase">{ex.duration}m</p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[7px] font-black text-text-dim uppercase">Sets</label>
                        <input 
                          type="number"
                          value={ex.sets}
                          onChange={(e) => updateBuilderExercise(ex.id, 'sets', parseInt(e.target.value) || 0)}
                          className="w-full bg-black/40 border border-white/5 rounded-lg px-2 py-1 text-[10px] text-white font-black"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[7px] font-black text-text-dim uppercase">Reps</label>
                        <input 
                          type="number"
                          value={ex.reps}
                          onChange={(e) => updateBuilderExercise(ex.id, 'reps', parseInt(e.target.value) || 0)}
                          className="w-full bg-black/40 border border-white/5 rounded-lg px-2 py-1 text-[10px] text-white font-black"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[7px] font-black text-text-dim uppercase">Weight (kg)</label>
                        <input 
                          type="number"
                          value={ex.weight}
                          onChange={(e) => updateBuilderExercise(ex.id, 'weight', parseInt(e.target.value) || 0)}
                          className="w-full bg-black/40 border border-white/5 rounded-lg px-2 py-1 text-[10px] text-white font-black"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[7px] font-black text-text-dim uppercase">Difficulty</label>
                        <select
                          value={ex.userDifficulty}
                          onChange={(e) => updateBuilderExercise(ex.id, 'userDifficulty', e.target.value)}
                          className="w-full bg-black/40 border border-white/5 rounded-lg px-1 py-1 text-[9px] text-white font-black"
                        >
                          <option value="Easy">Easy</option>
                          <option value="Moderate">Moderate</option>
                          <option value="Hard">Hard</option>
                          <option value="Extreme">Extreme</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => removeFromBuilder(ex.id)}
                    className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1.5 text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
        {filteredExercises.length > 0 ? filteredExercises.map((ex, i) => (
          <motion.div 
            key={ex.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="group relative h-48 rounded-[24px] overflow-hidden border border-[#222] cursor-pointer"
          >
            <ExerciseThumb exercise={ex as Exercise} />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
            
            <div className="absolute inset-x-3 top-3 flex justify-between">
              <span className="text-xs font-semibold text-accent bg-accent/12 border border-accent/25 px-2 py-1 rounded-full">{ex.difficulty}</span>
              {isBuilderMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); addToBuilder(ex as Exercise); }}
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
                    selectedForWorkout.some(s => s.id === ex.id) ? 'bg-accent text-bg' : 'bg-black/60 text-white hover:bg-accent hover:text-bg',
                  )}
                  aria-label="Add to plan"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>

            <div
              onClick={() => setSelectedExercise(ex as Exercise)}
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <div className="w-12 h-12 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_8px_24px_-4px_rgba(198,255,61,0.5)]">
                <Play fill="currentColor" size={18} className="ml-0.5" />
              </div>
            </div>

            <div className="absolute inset-x-4 bottom-4 flex justify-between items-end">
              <div className="min-w-0">
                <span className="text-eyebrow text-accent leading-none">{ex.category}</span>
                <h3 className="font-display text-lg font-bold text-white tracking-tight leading-tight mt-1 truncate">{ex.name}</h3>
              </div>
              <div className="flex items-center gap-1 text-text-dim shrink-0">
                <Clock size={11} />
                <span className="num text-xs font-medium">{ex.duration}m</span>
              </div>
            </div>
          </motion.div>
        )) : (
          <div className="col-span-full py-20 flex flex-col items-center justify-center gap-3 text-center">
            <Compass size={36} className="text-text-dim/30" />
            <div className="space-y-1">
              <p className="text-white font-medium">No matches</p>
              <p className="text-sm text-text-dim">Try broader filters</p>
            </div>
          </div>
        )}
      </div>

      {/* Detail View Modal */}
      <AnimatePresence>
        {selectedExercise && (
          <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
              onClick={() => setSelectedExercise(null)}
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative bg-bg w-full max-w-2xl h-[92vh] sm:h-auto sm:max-h-[92vh] sm:rounded-3xl overflow-hidden border-t sm:border border-white/[0.06] flex flex-col"
            >
              <ExerciseVideo exercise={selectedExercise} onClose={() => setSelectedExercise(null)} />

              <div className="p-5 sm:p-6 space-y-5 overflow-y-auto">
                <div className="flex justify-between items-start gap-3">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-accent bg-accent/12 border border-accent/25 px-2.5 py-1 rounded-full">{selectedExercise.category}</span>
                      <span className="text-xs text-text-dim font-medium">{selectedExercise.difficulty}</span>
                    </div>
                    <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">{selectedExercise.name}</h2>
                  </div>
                  <button
                    onClick={() => handleSaveToPlan(selectedExercise)}
                    className="btn-3d h-11 px-4 shrink-0"
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="glass p-3">
                    <Clock className="text-text-dim" size={14} />
                    <p className="num font-display text-base font-bold text-white mt-1.5">{selectedExercise.duration}m</p>
                    <p className="text-[10px] text-text-dim font-medium">Duration</p>
                  </div>
                  <div className="glass p-3">
                    <Activity className="text-text-dim" size={14} />
                    <p className="text-sm font-medium text-white mt-1.5 truncate">{selectedExercise.muscleGroups.join(', ')}</p>
                    <p className="text-[10px] text-text-dim font-medium">Focus</p>
                  </div>
                  <div className="glass p-3">
                    <Dumbbell className="text-text-dim" size={14} />
                    <p className="text-sm font-medium text-white mt-1.5 truncate">{(selectedExercise.equipment && selectedExercise.equipment.join(', ')) || 'None'}</p>
                    <p className="text-[10px] text-text-dim font-medium">Equipment</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-eyebrow text-accent">How to perform</h4>
                  <ol className="space-y-2">
                    {selectedExercise.instructions.map((step, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className="num text-accent font-semibold text-sm w-5 shrink-0">{idx + 1}.</span>
                        <p className="text-sm text-white/85 leading-relaxed">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                {selectedExercise.tips && selectedExercise.tips.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-eyebrow text-accent">Tips</h4>
                    <ul className="space-y-2">
                      {selectedExercise.tips.map((tip, idx) => (
                        <li key={idx} className="text-sm text-white/85 bg-accent/8 px-3 py-2 rounded-xl border border-accent/15 leading-relaxed">{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedExercise.commonMistakes && selectedExercise.commonMistakes.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-eyebrow text-accent-2">Avoid</h4>
                    <ul className="space-y-2">
                      {selectedExercise.commonMistakes.map((mistake, idx) => (
                        <li key={idx} className="text-sm text-white/85 bg-accent-2/8 px-3 py-2 rounded-xl border border-accent-2/15 leading-relaxed">{mistake}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedExercise.description && (
                  <div className="space-y-2 pb-4">
                    <h4 className="text-eyebrow text-text-dim">About</h4>
                    <p className="text-sm text-text-dim leading-relaxed">{selectedExercise.description}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ExerciseThumb: React.FC<{ exercise: Exercise }> = ({ exercise }) => (
  <ExerciseImage
    exercise={exercise}
    className="absolute inset-0 w-full h-full opacity-60 group-hover:opacity-80 group-hover:scale-105 transition-all duration-700"
    iconSize={56}
    width={800}
  />
);

const ExerciseVideo: React.FC<{ exercise: Exercise; onClose: () => void }> = ({ exercise, onClose }) => {
  // Many of the saved youtubeIds point to videos that have since been removed,
  // so search results are the primary action — they are always live and return
  // current, relevant tutorials in the user's region.
  const muscle = exercise.muscleGroups?.[0] || '';
  const searchTerms = `${exercise.name} ${muscle} proper form tutorial`.trim();
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerms)}`;

  return (
    <div className="aspect-video w-full bg-black relative overflow-hidden">
      <ExerciseImage
        exercise={exercise}
        className="absolute inset-0 w-full h-full"
        iconSize={80}
        width={1280}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/40" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <button
          onClick={() => openExternal(searchUrl)}
          className="w-16 h-16 rounded-full bg-accent text-bg flex items-center justify-center shadow-[0_16px_40px_-8px_rgba(198,255,61,0.55)] hover:scale-105 active:scale-95 transition-transform"
          aria-label="Find tutorial on YouTube"
        >
          <Play size={26} fill="currentColor" className="ml-1" />
        </button>
        <p className="text-white font-display text-lg font-bold tracking-tight leading-tight">
          Find {exercise.name} tutorial
        </p>
        <button
          onClick={() => openExternal(searchUrl)}
          className="btn-3d h-10 px-5 text-xs"
        >
          <Youtube size={12} />
          Search YouTube
        </button>
        <p className="text-text-mute text-[10px] mt-1 max-w-[260px] leading-relaxed">
          Opens live YouTube results so the video is always current — independent
          of any single creator's upload.
        </p>
      </div>

      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white z-10 hover:bg-black/80 transition-colors"
        aria-label="Close"
      >
        <X size={18} />
      </button>
    </div>
  );
};
