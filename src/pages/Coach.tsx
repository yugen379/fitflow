import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Send, Sparkles, Loader2, Volume2, Mic, MicOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { askCoach, CoachChatMessage } from '../services/geminiService';
import { haptic } from '../lib/haptics';
import { LogoMark } from '../components/Logo';
import { useToast } from '../hooks/useToast';

const STORAGE_KEY = (uid: string) => `ff_coach_chat_${uid}`;

const STARTERS = [
  'What should I eat after my workout?',
  'How do I do a proper squat?',
  "I'm too tired — should I train today?",
  'How can I break my plateau?',
  'Build me a 20-minute home workout',
];

export const Coach: React.FC = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);

  const voiceSupported = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Load saved conversation on mount
  useEffect(() => {
    if (!profile?.uid) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY(profile.uid));
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, [profile?.uid]);

  // Persist conversation
  useEffect(() => {
    if (!profile?.uid) return;
    try { localStorage.setItem(STORAGE_KEY(profile.uid), JSON.stringify(messages.slice(-40))); } catch {}
  }, [messages, profile?.uid]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || thinking) return;
    haptic('light');
    const userMsg: CoachChatMessage = { role: 'user', text: message };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setThinking(true);
    try {
      const reply = await askCoach(message, next, {
        goal: profile?.goal,
        weight: profile?.weight,
        age: profile?.age,
      });
      setMessages([...next, { role: 'coach', text: reply }]);
    } catch {
      setMessages([...next, { role: 'coach', text: "Sorry — I hit an error. Try again." }]);
    } finally {
      setThinking(false);
    }
  };

  const speak = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  };

  const handleVoice = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast('Voice input not supported here — try Chrome or Edge', 'info');
      return;
    }
    // If already listening, stop instead of stacking another recognizer.
    if (listening && recRef.current) {
      try { recRef.current.stop(); } catch {}
      setListening(false);
      return;
    }
    haptic('selection');
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = (e: any) => {
      setListening(false);
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        showToast('Microphone blocked — allow it in browser settings', 'error');
      }
    };
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setListening(false);
      send(transcript);
    };
    try { rec.start(); }
    catch { setListening(false); }
  };

  return (
    <div className="flex flex-col h-screen bg-bg relative overflow-hidden">
      {/* Atmospheric backdrop */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-accent/8 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-accent-3/6 blur-[140px] rounded-full pointer-events-none" />

      <header className="px-4 pt-4 pb-3 flex items-center gap-3 relative z-10 border-b border-white/[0.05]">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <p className="text-eyebrow text-accent">AI Coach</p>
          <h1 className="font-display text-xl font-bold text-white tracking-tight leading-tight">Ask anything</h1>
        </div>
        <div className="w-10 h-10 ai-gradient-box rounded-xl flex items-center justify-center">
          <Sparkles size={16} className="text-accent" />
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative z-10">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-5 pt-8">
            <motion.div
              animate={{ rotate: [0, 6, -6, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            >
              <LogoMark size={48} />
            </motion.div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                Your coach is on standby.
              </h2>
              <p className="text-text-dim text-sm mt-2 max-w-xs mx-auto leading-relaxed">
                Ask about training, nutrition, recovery, or motivation. I remember our conversation.
              </p>
            </div>
            <div className="w-full space-y-2 pt-2">
              {STARTERS.map((s, i) => (
                <motion.button
                  key={s}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  onClick={() => send(s)}
                  className="w-full text-left glass px-4 py-3 rounded-2xl text-sm text-white/85 hover:text-white hover:border-accent/30 transition-colors"
                >
                  <span className="text-accent mr-2">›</span>{s}
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 22 }}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {m.role === 'coach' && (
                  <div className="w-7 h-7 shrink-0 rounded-full bg-accent/12 border border-accent/25 flex items-center justify-center mt-1">
                    <Sparkles size={12} className="text-accent" />
                  </div>
                )}
                <div className={`px-4 py-3 rounded-2xl ${
                  m.role === 'user'
                    ? 'bg-accent text-bg rounded-tr-md'
                    : 'glass text-white rounded-tl-md'
                }`}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</p>
                  {m.role === 'coach' && (
                    <button
                      onClick={() => speak(m.text)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-text-dim hover:text-accent transition-colors"
                      aria-label="Read aloud"
                    >
                      <Volume2 size={11} /> Listen
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))
        )}

        <AnimatePresence>
          {thinking && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex gap-2"
            >
              <div className="w-7 h-7 rounded-full bg-accent/12 border border-accent/25 flex items-center justify-center mt-1">
                <Sparkles size={12} className="text-accent" />
              </div>
              <div className="glass px-4 py-3 rounded-2xl rounded-tl-md flex items-center gap-1.5">
                <motion.span
                  className="w-1.5 h-1.5 bg-accent rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                <motion.span
                  className="w-1.5 h-1.5 bg-accent rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                />
                <motion.span
                  className="w-1.5 h-1.5 bg-accent rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-3 pb-3 pt-2 relative z-10 border-t border-white/[0.05] bg-bg/70 backdrop-blur-xl">
        <div className="glass rounded-2xl flex items-end gap-2 p-2">
          <button
            onClick={handleVoice}
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              listening
                ? 'bg-accent-2/15 border border-accent-2/30 text-accent-2'
                : voiceSupported
                  ? 'bg-white/[0.04] hover:bg-white/[0.08] text-text-dim hover:text-accent'
                  : 'bg-white/[0.02] text-text-mute'
            }`}
            aria-label={listening ? 'Stop voice input' : voiceSupported ? 'Voice input' : 'Voice input not supported'}
            aria-pressed={listening}
            title={voiceSupported ? (listening ? 'Listening… tap to stop' : 'Tap to speak') : 'Voice input not supported in this browser'}
          >
            {voiceSupported
              ? (listening
                ? <motion.span
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  ><Mic size={16} /></motion.span>
                : <Mic size={16} />)
              : <MicOff size={16} />}
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            placeholder="Ask your coach…"
            rows={1}
            className="flex-1 bg-transparent text-white text-sm placeholder:text-text-mute resize-none focus:outline-none py-2 max-h-[120px] leading-snug"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || thinking}
            className="w-9 h-9 rounded-xl bg-accent text-bg flex items-center justify-center disabled:opacity-30 shrink-0"
            aria-label="Send"
          >
            {thinking ? <Loader2 className="animate-spin" size={16} /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
};
