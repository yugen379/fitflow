import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, TrendingUp, Flame, Clock, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  AreaChart, Area,
} from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { PremiumGate } from '../components/PremiumGate';
import exerciseLibrary from '../data/exerciseLibrary.json';
import { StreakHeatmap } from '../components/StreakHeatmap';
import { RetentionCard } from '../components/RetentionCard';

const COLORS = ['#C6FF3D','#7DD3FC','#FF6B6B','#E7FF8C','#FFD38F','#D8B4FE'];
const RADAR_GROUPS = ['Chest','Back','Legs','Shoulders','Arms','Core'];

function normaliseMuscle(raw: string): string | null {
  const r = raw.toLowerCase();
  if (r.includes('chest'))   return 'Chest';
  if (r.includes('back'))    return 'Back';
  if (r.includes('leg') || r.includes('quad') || r.includes('glute') || r.includes('hamstring')) return 'Legs';
  if (r.includes('shoulder'))return 'Shoulders';
  if (r.includes('arm') || r.includes('tricep') || r.includes('bicep')) return 'Arms';
  if (r.includes('core') || r.includes('ab')) return 'Core';
  return null;
}

const Stat3D: React.FC<{ icon: React.ReactNode; label: string; value: string; color?: string }> = ({ icon, label, value, color = 'text-accent' }) => (
  <div className="glass p-4 flex flex-col gap-2">
    <div className="w-8 h-8 ai-gradient-box rounded-lg flex items-center justify-center">{icon}</div>
    <div>
      <p className="text-xs text-text-dim font-medium">{label}</p>
      <p className={`num font-display text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  </div>
);

const chartTooltipStyle = {
  contentStyle: { backgroundColor: '#0E1014', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 },
  itemStyle: { color: '#C6FF3D', fontWeight: 600 },
  labelStyle: { color: '#8B92A3', fontSize: 10 },
};

export const Analytics: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [activityData,  setActivityData]  = useState<any[]>([]);
  const [calorieData,   setCalorieData]   = useState<any[]>([]);
  const [muscleFocus,   setMuscleFocus]   = useState<any[]>([]);
  const [volumeTrend,   setVolumeTrend]   = useState<any[]>([]);
  const [totalWorkouts, setTotalWorkouts] = useState(0);
  const [totalMins,     setTotalMins]     = useState(0);
  const [totalCals,     setTotalCals]     = useState(0);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => { if (profile?.uid) fetchAll(profile.uid); }, [profile?.uid]);

  const fetchAll = async (uid: string) => {
    setLoading(true);
    try {
      const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const q = query(collection(db,'workouts'), where('userId','==',uid), where('timestamp','>=',sixMonthsAgo), orderBy('timestamp','asc'));
      const snap = await getDocs(q);
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      buildActivity(docs); buildCalorie(docs); buildMuscle(docs); buildVolume(docs);
      setTotalWorkouts(docs.length);
      setTotalMins(docs.reduce((s:number,d:any) => s+(d.duration||0),0));
      setTotalCals(docs.reduce((s:number,d:any) => s+(d.caloriesBurned||0),0));
    } catch(e){ console.error(e); } finally { setLoading(false); }
  };

  const buildActivity = (docs: any[]) => {
    const map: Record<string,number> = {};
    for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); map[d.toLocaleDateString('en-US',{weekday:'short'})]=0; }
    docs.forEach(d=>{ const ts=d.timestamp?.toDate?.(); if(!ts)return; const k=ts.toLocaleDateString('en-US',{weekday:'short'}); if(map[k]!==undefined) map[k]+=d.duration||0; });
    setActivityData(Object.entries(map).map(([day,active])=>({day,active})));
  };
  const buildCalorie = (docs: any[]) => {
    const map:Record<string,number>={};
    docs.forEach(d=>{ const t=(d.type as string)||'Other'; map[t]=(map[t]||0)+(d.caloriesBurned||0); });
    const data=Object.entries(map).map(([name,value])=>({name,value})).filter(d=>d.value>0).sort((a,b)=>b.value-a.value);
    setCalorieData(data.length?data:[{name:'No data',value:1}]);
  };
  const buildMuscle = (docs: any[]) => {
    const counts:Record<string,number>=Object.fromEntries(RADAR_GROUPS.map(g=>[g,0]));
    docs.forEach(doc=>{
      (doc.exerciseLogs||[]).forEach((log:any)=>{
        const ex=(exerciseLibrary as any[]).find(e=>e.id===log.exerciseId);
        if(!ex) return;
        (ex.muscleGroups||[]).forEach((mg:string)=>{ const k=normaliseMuscle(mg); if(k&&counts[k]!==undefined)counts[k]++; });
        if((ex.muscleGroups||[]).includes('Full Body')) RADAR_GROUPS.forEach(g=>counts[g]++);
      });
    });
    const max=Math.max(...Object.values(counts),1);
    setMuscleFocus(RADAR_GROUPS.map(subject=>({subject,A:counts[subject],fullMark:max})));
  };
  const buildVolume = (docs: any[]) => {
    const map:Record<string,number>={};
    for(let i=5;i>=0;i--){ const d=new Date(); d.setMonth(d.getMonth()-i); map[d.toLocaleDateString('en-US',{month:'short'})]=0; }
    docs.forEach(doc=>{ const ts=doc.timestamp?.toDate?.(); if(!ts)return; const m=ts.toLocaleDateString('en-US',{month:'short'}); if(map[m]===undefined)return; (doc.exerciseLogs||[]).forEach((log:any)=>{ map[m]+=(log.sets||0)*(log.reps||0)*(log.weight||0); }); });
    setVolumeTrend(Object.entries(map).map(([month,volume])=>({month,volume:Math.round(volume)})));
  };

  return (
    <div className="pb-28 pt-4 px-4 bg-bg min-h-screen space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={()=>navigate('/')} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back"><ChevronLeft size={18}/></button>
          <div>
            <p className="text-eyebrow text-accent">Analytics</p>
            <h1 className="font-display text-2xl font-bold text-white tracking-tight leading-tight">Your performance</h1>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-10 h-10 border-2 border-white/10 border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-text-dim">Crunching your data…</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Stat row */}
          <div className="grid grid-cols-3 gap-3">
            <Stat3D icon={<Zap size={14} className="text-accent"/>}  label="Sessions" value={String(totalWorkouts)} />
            <Stat3D icon={<Clock size={14} className="text-accent"/>} label="Minutes"  value={`${totalMins}`} />
            <Stat3D icon={<Flame size={14} className="text-accent"/>} label="Calories" value={`${totalCals}`} />
          </div>

          {/* Consistency / retention (#4) */}
          <RetentionCard />

          {/* Streak heatmap */}
          <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
            className="glass p-5">
            <StreakHeatmap />
          </motion.div>

          {/* Weekly activity */}
          <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
            className="glass p-5">
            <div className="flex justify-between items-end mb-4">
              <div>
                <p className="text-eyebrow text-accent">Active minutes</p>
                <h3 className="font-display text-lg font-bold text-white tracking-tight mt-1">This week</h3>
              </div>
              <TrendingUp className="text-accent" size={18}/>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData}>
                  <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C6FF3D"/><stop offset="100%" stopColor="#9CFF1F" stopOpacity={0.5}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)"/>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:'#8B92A3',fontSize:10}}/>
                  <YAxis hide/>
                  <Tooltip {...chartTooltipStyle} cursor={{fill:'rgba(255,255,255,0.03)'}}/>
                  <Bar dataKey="active" fill="url(#barGrad)" radius={[8,8,0,0]} name="Mins"/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Premium: Calorie split + Muscle radar */}
          <PremiumGate feature="Calorie & Muscle Analysis">
            <div className="grid grid-cols-1 gap-5">
              <motion.div initial={{opacity:0,scale:0.96}} animate={{opacity:1,scale:1}}
                className="stat-card-3d p-6 rounded-[2rem]">
                <p className="text-[9px] font-black text-accent uppercase tracking-widest mb-1">Exertion Profile</p>
                <h3 className="font-display text-lg font-bold text-white tracking-tight mb-4">Calories by type</h3>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={calorieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value">
                        {calorieData.map((_e,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                      </Pie>
                      <Tooltip {...chartTooltipStyle}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {calorieData.map((d,i)=>(
                    <div key={i} className="flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full" style={{background:COLORS[i%COLORS.length]}}/>
                      <span className="text-[9px] font-black text-text-dim uppercase tracking-widest">{d.name}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div initial={{opacity:0,scale:0.96}} animate={{opacity:1,scale:1}}
                className="stat-card-3d p-6 rounded-[2rem]">
                <p className="text-[9px] font-black text-accent uppercase tracking-widest mb-1">Focus Biometrics</p>
                <h3 className="font-display text-lg font-bold text-white tracking-tight mb-4">Muscle group focus</h3>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="72%" data={muscleFocus}>
                      <defs><radialGradient id="radarGrad"><stop offset="0%" stopColor="#00D1FF" stopOpacity={0.4}/><stop offset="100%" stopColor="#7000FF" stopOpacity={0.1}/></radialGradient></defs>
                      <PolarGrid stroke="rgba(255,255,255,0.06)"/>
                      <PolarAngleAxis dataKey="subject" tick={{fill:'#64748B',fontSize:9,fontWeight:900}}/>
                      <Radar name="Volume" dataKey="A" stroke="#00D1FF" fill="url(#radarGrad)" fillOpacity={1}/>
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>
            </div>
          </PremiumGate>

          {/* Premium: Volume trend */}
          <PremiumGate feature="Volume Trend">
            <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
              className="stat-card-3d p-6 rounded-[2rem]">
              <p className="text-[9px] font-black text-accent uppercase tracking-widest mb-1">Load History</p>
              <h3 className="font-display text-lg font-bold text-white tracking-tight mb-4">Total lifting volume</h3>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volumeTrend}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#00D1FF" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#7000FF" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)"/>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:'#64748B',fontSize:9,fontWeight:900}}/>
                    <Tooltip {...chartTooltipStyle}/>
                    <Area type="monotone" dataKey="volume" stroke="#00D1FF" strokeWidth={2} fillOpacity={1} fill="url(#volGrad)" name="Volume (kg)"/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </PremiumGate>
        </div>
      )}
    </div>
  );
};
