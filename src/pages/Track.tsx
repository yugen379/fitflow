import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Camera, CameraOff, Sparkles, X, Loader2, ScanBarcode, Image as ImageIcon, Aperture, Pencil, Settings, ChefHat, Trash2 } from 'lucide-react';
import { canOpenAppSettings, openAppSettings } from '../lib/appSettings';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../hooks/useAuth';
import { logMeal, updateMeal, deleteMeal } from '../services/dataService';
import { analyzeNutritionLabel } from '../services/geminiService';
import { analyzeMealText, analyzeMealPhoto, analyzeSingleItem, type MealAnalysis } from '../services/mealPipeline';
import {
  lineMacros, mealTotals, servingLine, needsOilChoice, suggestedOil, oilBaseGrams, oilGrams, oilMacros,
  needsHint, cleanHint, diaryName, clampGrams, type ReviewLine, type OilLevel,
} from '../lib/mealMath';
import { searchFood, lookupBarcode, resolveLocalFood } from '../services/foodService';
import { lookupCatalog } from '../services/foodCatalogService';
import { searchBrandedFoods, fetchProductServing } from '../services/remoteFoodSearch';
import { cn } from '../lib/utils';
import { checkAndAwardBadge } from '../services/badgeService';
import { MealRecord } from '../types';
import { db, safeUnsubscribe } from '../lib/firestore';
import { LoadingBar } from '../components/LoadingBar';
import { collection, query, where, orderBy, onSnapshot, getDocs, limit } from 'firebase/firestore';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useToast } from '../hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { computeDailyTargets } from '../lib/nutritionTargets';
import { useBackHandler } from '../lib/backButton';
import { MacroMatrix } from '../components/3d/MacroMatrix';
import { useTabVisible } from '../components/layout/DockTabs';

const downscaleToJpegBase64 = async (file: File, maxSide: number): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
};

const SOURCE_LABEL: Record<ReviewLine['source'], string> = {
  table: '', bundled: '', usda: 'USDA', ai_density: 'estimate', serving: 'per serving', none: 'not found',
};

export const Track: React.FC = () => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // This tab stays alive while you use the others (DockTabs). A scanner left
  // open must not keep the camera streaming in the background — close it the
  // moment the tab is hidden, which stops the stream via the effect below.
  const tabVisible = useTabVisible();
  useEffect(() => {
    if (!tabVisible) setScanOpen(false);
  }, [tabVisible]);
  const [aiInput, setAiInput] = useState('');
  // Review list: every row carries its grams and per-100 g values; totals are
  // computed in mealMath, never taken from the AI.
  const [aiReview, setAiReview] = useState<ReviewLine[] | null>(null);
  const [oilLevel, setOilLevel] = useState<OilLevel>('none');
  // Low-confidence fallback: one 2-4 word hint per meal, then decomposition re-runs.
  const [askHint, setAskHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [hintText, setHintText] = useState('');
  const [lastMeal, setLastMeal] = useState<{ text?: string; b64?: string } | null>(null);
  const [addText, setAddText] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  // Edit / delete a logged meal (there was no way to fix a typo or an AI misread).
  const [editMeal, setEditMeal] = useState<MealRecord | null>(null);
  const [editForm, setEditForm] = useState({ name: '', calories: 0, protein: 0, carbs: 0, fats: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const openEdit = (m: MealRecord) => {
    setEditMeal(m); setConfirmDelete(false);
    setEditForm({ name: m.name, calories: m.calories || 0, protein: m.protein || 0, carbs: m.carbs || 0, fats: m.fats || 0 });
  };
  const saveEdit = async () => {
    if (!editMeal?.id || !editForm.name.trim()) return;
    setEditBusy(true);
    try { await updateMeal(editMeal.id, editForm); showToast('Meal updated', 'success'); setEditMeal(null); }
    catch { showToast('Could not save. Try again.', 'error'); }
    finally { setEditBusy(false); }
  };
  const removeMeal = async () => {
    if (!editMeal?.id) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setEditBusy(true);
    try { await deleteMeal(editMeal.id); showToast(`Removed ${editMeal.name}`, 'success'); setEditMeal(null); }
    catch { showToast('Could not delete. Try again.', 'error'); }
    finally { setEditBusy(false); }
  };
  useEffect(() => { if (!aiOpen) setAiReview(null); }, [aiOpen]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [meals, setMeals] = useState<MealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [scannedProduct, setScannedProduct] = useState<any>(null);
  const [portionSize, setPortionSize] = useState(100);
  const fileRef = useRef<HTMLInputElement>(null);
  const barcodeFileRef = useRef<HTMLInputElement>(null);
  const qrInstanceRef = useRef<Html5Qrcode | null>(null);
  const scannedRef = useRef(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [scanBlocked, setScanBlocked] = useState(false);
  const gestureStreamRef = useRef<MediaStream | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  // Android Back closes the open sheet instead of the app.
  useBackHandler(aiOpen || scanOpen || manualOpen || !!editMeal, () => {
    if (editMeal) setEditMeal(null);
    else if (aiReview || askHint) { setAiReview(null); setAskHint(false); }
    else if (manualOpen) setManualOpen(false);
    else if (scanOpen) setScanOpen(false);
    else setAiOpen(false);
  });
  const [manualName, setManualName] = useState('');
  const [manualCals, setManualCals] = useState(0);
  const [manualP, setManualP] = useState(0);
  const [manualC, setManualC] = useState(0);
  const [manualF, setManualF] = useState(0);
  // Set when the sheet was opened from a packaged product: Open Food Facts
  // gives values per 100 g, so the sheet shows an amount field that rescales
  // them. Cleared whenever the sheet closes, so a plain manual entry never
  // inherits it.
  const [manualBase, setManualBase] = useState<null | { name: string; calories: number; protein: number; carbs: number; fats: number }>(null);
  const [manualGrams, setManualGrams] = useState(100);
  // One serving of that product, when its pack states one (looked up by barcode
  // after the sheet opens; the search results only carry per-100 g values).
  const [manualServing, setManualServing] = useState<null | { grams: number; label: string }>(null);
  const servingFor = useRef('');
  useEffect(() => { if (!manualOpen) { setManualBase(null); setManualServing(null); servingFor.current = ''; } }, [manualOpen]);
  const setAmount = (grams: number) => {
    setManualGrams(grams);
    if (!manualBase) return;
    const k = grams / 100;
    setManualName(`${manualBase.name} (${grams}g)`);
    setManualCals(Math.round(manualBase.calories * k));
    setManualP(Math.round(manualBase.protein * k));
    setManualC(Math.round(manualBase.carbs * k));
    setManualF(Math.round(manualBase.fats * k));
  };
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [aiSearching, setAiSearching] = useState(false);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);

  useEffect(() => {
    if (!profile?.uid) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const q = query(collection(db, 'meals'),
      where('userId', '==', profile.uid),
      where('timestamp', '>=', today),
      orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q,
      snap => { setMeals(snap.docs.map(d => ({ id: d.id, ...d.data() } as MealRecord))); setLoading(false); },
      () => setLoading(false),
    );
    return () => safeUnsubscribe(unsub);
  }, [profile?.uid]);

  useEffect(() => {
    if (!scanOpen || scannedProduct || scanBlocked) return;
    scannedRef.current = false;
    setScanError(null);
    let cancelled = false;
    let startPromise: Promise<void> | null = null;

    // Secure-context guard — getUserMedia silently fails over plain http on LAN IPs.
    if (typeof window !== 'undefined' && !window.isSecureContext && location.hostname !== 'localhost') {
      setScanError('Camera requires HTTPS. Use the upload button to scan a photo of the barcode instead.');
      return;
    }

    // Wait past the modal's scale animation (Framer Motion spring settles ~250ms)
    // before we ask Html5Qrcode to measure the host element. Initializing during
    // the scale transform produces a 0×0 video on some mobile browsers.
    const timer = setTimeout(() => {
      if (cancelled) return;
      const host = document.getElementById('ff-reader');
      if (!host) return;
      // Release the gesture-acquired probe stream right before html5-qrcode
      // re-acquires the camera. Permission is already granted at this point, so
      // its internal getUserMedia succeeds instantly with no second prompt.
      if (gestureStreamRef.current) {
        gestureStreamRef.current.getTracks().forEach(t => t.stop());
        gestureStreamRef.current = null;
      }
      const qr = new Html5Qrcode('ff-reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.ITF,
        ],
        // Use the browser-native BarcodeDetector when available — way faster
        // and works on Android Chrome even when the JS decoder struggles.
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      } as any);
      qrInstanceRef.current = qr;
      const onScan = (text: string) => {
        if (scannedRef.current) return;
        scannedRef.current = true;
        // Grab the current frame BEFORE stopping — if the DB lookup misses we
        // hand this image to the AI label reader instead of failing.
        const frame = grabFrameBase64();
        qr.stop().catch(() => {});
        resolveAndShow(text, frame);
      };
      const baseConfig = { fps: 10, qrbox: { width: 260, height: 140 }, aspectRatio: 1 };

      // Route everything through `videoConstraints` — Html5Qrcode's strict
      // first-arg validator rejects `{facingMode:{ideal:…}}` and has shipped
      // false-positive failures on some Android builds even for plain string
      // facingMode. The `videoConstraints` field bypasses that validator and
      // forwards directly to getUserMedia.
      const startWith = (vc: MediaTrackConstraints) =>
        qr.start(
          { facingMode: 'environment' }, // truthy dummy; ignored when videoConstraints is valid
          { ...baseConfig, videoConstraints: vc } as any,
          onScan,
          () => {},
        );

      const startOnce = async () => {
        let cams: { id: string; label: string }[] = [];
        try { cams = await Html5Qrcode.getCameras(); } catch { /* no perm yet */ }
        // 1. Best: explicit rear-facing deviceId from enumeration.
        if (cams.length) {
          const back = cams.find(c => /back|rear|environment/i.test(c.label)) || cams[cams.length - 1];
          if (back?.id) {
            try { return await startWith({ deviceId: { exact: back.id } } as MediaTrackConstraints); } catch { /* fall through */ }
          }
        }
        // 2. Hint for rear camera; `ideal` lets the browser pick front if there is no rear.
        try { return await startWith({ facingMode: { ideal: 'environment' } }); } catch { /* fall through */ }
        // 3. Last resort: any camera the browser will give us.
        return await startWith({} as MediaTrackConstraints);
      };

      // The catch returns early on some branches, which widened this to
      // Promise<void | null>; the handler is fire-and-forget either way.
      startPromise = startOnce().then(() => undefined).catch((err: any) => {
        const name = (err && (err.name || err.message || err.toString())) || 'Unknown';
        console.warn('[barcode] camera start failed:', name, err);
        if (/NotAllowed|Permission|SecurityError/i.test(name)) {
          setScanError("Camera permission is blocked. Open Settings → Device permissions → Camera to grant access.");
        } else if (/NotReadable|TrackStart|in use/i.test(name)) {
          setScanError("Another app is using the camera. Close other camera apps/tabs, then reopen the scanner.");
        } else if (/NoCameras|NotFound|Overconstrained|DevicesNotFound/i.test(name)) {
          setScanError("No camera available. Upload a photo of the barcode instead.");
        } else if (/transition/i.test(name)) {
          setScanError("Camera is busy starting — tap Retry in a moment.");
        } else if (/secure context|HTTPS/i.test(name)) {
          setScanError("Camera needs HTTPS. Use the upload button to scan a photo.");
        } else {
          setScanError(`Couldn't start the camera (${name}). Upload a photo of the barcode instead.`);
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (gestureStreamRef.current) {
        gestureStreamRef.current.getTracks().forEach(t => t.stop());
        gestureStreamRef.current = null;
      }
      // Wait for start() to settle before stopping — otherwise stop() throws and
      // the camera stays held by the browser, blocking the next open.
      const inst = qrInstanceRef.current;
      qrInstanceRef.current = null;
      Promise.resolve(startPromise).finally(() => {
        inst?.stop().catch(() => {});
        try { inst?.clear(); } catch {}
      });
    };
  }, [scanOpen, scannedProduct, scanAttempt, scanBlocked]);

  // Auto-recover: while the scanner is open, watch the browser's camera-permission
  // state. The moment it flips to "granted" — e.g. the user enabled it in settings
  // and came back — re-open the scanner automatically, so they never have to tap
  // anything again. This is the closest a web app can get to "one click": the user
  // flips ONE toggle and the camera just turns on.
  useEffect(() => {
    if (!scanOpen) return;
    let perm: any = null;
    let active = true;
    const onChange = () => { if (active && perm?.state === 'granted') openScanner(); };
    try {
      (navigator as any).permissions?.query?.({ name: 'camera' as any })
        .then((p: any) => { if (!active) return; perm = p; p.onchange = onChange; })
        .catch(() => {});
    } catch { /* Permissions API unavailable — Retry button still works */ }
    return () => { active = false; if (perm) perm.onchange = null; };
  }, [scanOpen]);

  // Heuristic: are we inside a social-app in-app browser (Instagram, Facebook,
  // TikTok, etc.) or an Android WebView? Those silently block camera access with
  // no prompt — the user has to reopen the link in a real browser.
  const inAppBrowser = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|musical_ly|Snapchat|Pinterest|GSA\/|; wv\)/i.test(navigator.userAgent || '');
  };

  // Open the scanner. CRUCIAL: getUserMedia must run *inside this tap handler*.
  // Mobile browsers (especially iOS Safari) only show the camera prompt when the
  // request is tied to a live user gesture. The old code requested the camera
  // later — inside a setTimeout after the modal's open animation — so the gesture
  // was already gone and the browser rejected with NotAllowedError WITHOUT ever
  // prompting. That is exactly the "it never asks, just says blocked" bug.
  const openScanner = async () => {
    setScannedProduct(null);
    setScanError(null);
    setScanBlocked(false);

    // Secure-context / no-mediaDevices (insecure origin or locked-down WebView).
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setScanBlocked(true);
      setScanError(inAppBrowser()
        ? 'This in-app browser blocks the camera. Tap the ••• menu → "Open in browser", then scan. Or upload a photo of the barcode below.'
        : 'Camera needs a secure (https) page. Upload a photo of the barcode below instead.');
      setScanOpen(true);
      return;
    }

    try {
      // Request the camera NOW, within the tap, so the prompt actually appears.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      gestureStreamRef.current = stream; // released by the live-scan effect right before html5-qrcode re-acquires
      setScanBlocked(false);
      setScanOpen(true);
    } catch (err: any) {
      const name = err?.name || err?.message || String(err);
      console.warn('[barcode] gesture getUserMedia failed:', name);
      setScanBlocked(true);
      if (/NotAllowed|Permission|SecurityError/i.test(name)) {
        setScanError(inAppBrowser()
          ? 'Camera blocked by this in-app browser. Tap ••• → "Open in Safari/Chrome", then try again — or upload a photo of the barcode below.'
          : 'Camera permission was blocked. Tap the lock / "AA" icon by the address bar → Camera → Allow → reload. Meanwhile, upload a photo of the barcode below.');
      } else if (/NotReadable|TrackStart|in use/i.test(name)) {
        setScanError('Another app is using the camera. Close it, then tap Retry — or upload a photo of the barcode below.');
      } else if (/NotFound|Devices|Overconstrained/i.test(name)) {
        setScanError('No usable camera found. Upload a photo of the barcode below instead.');
      } else {
        setScanError(`Couldn't open the camera (${name}). Upload a photo of the barcode below instead.`);
      }
      setScanOpen(true); // open in fallback mode — the photo-upload path still works
    }
  };

  // Grab the current live-camera frame as bare base64 JPEG (no data: prefix),
  // for the AI nutrition-label fallback. Returns null if the video isn't ready.
  const grabFrameBase64 = (): string | null => {
    try {
      const video = document.getElementById('ff-reader')?.querySelector('video') as HTMLVideoElement | null;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || null;
    } catch { return null; }
  };

  const fileToBase64 = (file: Blob): Promise<string | null> =>
    new Promise(res => {
      const r = new FileReader();
      r.onload = () => res((typeof r.result === 'string' ? r.result.split(',')[1] : null) || null);
      r.onerror = () => res(null);
      r.readAsDataURL(file);
    });

  // Map either a FoodProduct (DB) or ScannedNutrition (AI) into the modal shape.
  const showProduct = (p: { name: string; brand?: string; calories: number; protein: number; carbs: number; fats: number; source?: string }) => {
    setScannedProduct({
      name: p.name || 'Scanned product',
      brand: p.brand || '',
      calories100g: Math.round(p.calories) || 0,
      protein100g: Math.round(p.protein) || 0,
      carbs100g: Math.round(p.carbs) || 0,
      fats100g: Math.round(p.fats) || 0,
      source: p.source || 'OFF',
    });
  };

  const fallToManual = (barcode: string | null, msg: string) => {
    showToast(msg, 'info');
    setScanOpen(false);
    setManualName(barcode ? `Barcode ${barcode}` : '');
    setManualCals(0); setManualP(0); setManualC(0); setManualF(0);
    setManualOpen(true);
  };

  // Unified resolver: (1) barcode → DB lookup, (2) AI reads the captured frame's
  // nutrition label, (3) manual entry. Either input may be null — a decoded
  // barcode with no image still works, and an unreadable barcode with a clear
  // label photo still works via the AI tier.
  const resolveAndShow = async (barcode: string | null, imageBase64: string | null) => {
    setIsAnalyzing(true);
    setScanError(null);
    try {
      // 1) Barcode → Open Food Facts / USDA (hardened, multi-variant resolver).
      if (barcode) {
        try {
          const product = await lookupBarcode(barcode);
          if (product && product.calories > 0) { showProduct(product); return; }
        } catch (e) { console.warn('[scan] DB lookup failed', e); }
      }
      // 2) AI nutrition-label fallback on the captured frame.
      if (imageBase64) {
        try {
          const ai = await analyzeNutritionLabel(imageBase64);
          if (ai) { showProduct(ai); return; }
        } catch (e) { console.warn('[scan] AI label read failed', e); }
      }
      // 3) Nothing resolved — hand off to manual with a useful prefill.
      fallToManual(barcode, barcode ? 'Product not found — log it manually' : 'Could not read that — log it manually');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const decodeFile = async (file: File): Promise<string | null> => {
    const tempQr = new Html5Qrcode('ff-reader-file', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.ITF,
      ],
      verbose: false,
    });
    try {
      const result = await tempQr.scanFile(file, true);
      return result;
    } catch {
      return null;
    } finally {
      try { tempQr.clear(); } catch {}
    }
  };

  const handleBarcodeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset
    if (!file) return;
    setIsAnalyzing(true);
    setScanError(null);
    try {
      await qrInstanceRef.current?.stop().catch(() => {});
      scannedRef.current = true;
      const [barcode, base64] = await Promise.all([decodeFile(file), fileToBase64(file)]);
      // Even when no barcode decodes, the AI tier reads the label off the photo.
      await resolveAndShow(barcode, base64);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const captureFromVideo = async () => {
    setIsAnalyzing(true);
    setScanError(null);
    try {
      const reader = document.getElementById('ff-reader');
      const video = reader?.querySelector('video') as HTMLVideoElement | null;
      if (!video || video.readyState < 2) {
        setScanError('Camera not ready yet — wait a moment and try again.');
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.92));
      if (!blob) { setScanError('Could not grab the frame.'); return; }
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      await qrInstanceRef.current?.stop().catch(() => {});
      scannedRef.current = true;
      const [barcode, base64] = await Promise.all([decodeFile(file), fileToBase64(file)]);
      await resolveAndShow(barcode, base64);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const logScanned = async () => {
    if (!profile?.uid || !scannedProduct) return;
    const r = portionSize / 100;
    // logMeal queues offline on any failure — safe to always show success.
    await logMeal(profile.uid, {
      name: scannedProduct.name,
      calories: Math.round(scannedProduct.calories100g * r),
      protein: Math.round(scannedProduct.protein100g * r),
      carbs: Math.round(scannedProduct.carbs100g * r),
      fats: Math.round(scannedProduct.fats100g * r),
      mealType: 'snack',
    });
    try { await checkAndAwardBadge(profile.uid, 'nutrition_master'); } catch {}
    try { await checkAndAwardBadge(profile.uid, 'scanner_pro'); } catch {}
    showToast('Logged', 'success');
    setScanOpen(false); setScannedProduct(null);
  };

  // Natural-language quick-add: "2 eggs, toast and a banana" → multiple logged
  // items in one tap. Fast-paths a shared-catalog hit for the exact phrase (#3),
  // then parses the whole description (multi-item) via parseQuickAdd, which never
  // throws and always returns a valid result.
  // Meal type from the clock instead of tagging everything "snack".
  const mealTypeNow = (d = new Date()) => {
    const h = d.getHours();
    return h >= 5 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 17 && h < 22 ? 'dinner' : 'snack';
  };

  // AI results are shown for review before anything is saved: the AI can
  // misread a phrase (autocorrect turned "teh tarik" into "the tarikn"), and
  // silently writing six items to the diary left no way to catch that.
  // Show an analysis for review. Low confidence asks for a short hint first
  // (once per meal); otherwise the itemised list appears with the cooking-oil
  // choice pre-set from how things were cooked.
  const showAnalysis = (a: MealAnalysis, usedHint: boolean, fallbackName: string) => {
    if (a.decomposed && needsHint(a.lines, a.obscured, usedHint)) {
      setAskHint(true);
      setAiReview(a.lines.length ? a.lines : null);
      setOilLevel(suggestedOil(a.lines));
      return;
    }
    setAskHint(false);
    if (a.lines.length > 0) {
      setAiReview(a.lines);
      setOilLevel(suggestedOil(a.lines));
    } else {
      // Nothing resolved — slide into manual entry, pre-filled with their text.
      setAiReview(null);
      setManualName(fallbackName);
      setManualCals(0); setManualP(0); setManualC(0); setManualF(0);
      setAiOpen(false); setAiInput('');
      setManualOpen(true);
      showToast('Enter the calories yourself', 'info');
    }
  };

  const handleAiAnalyze = async () => {
    if (!aiInput.trim() || !profile?.uid) return;
    setIsAnalyzing(true);
    const phrase = aiInput.trim();
    setHintUsed(false); setHintText(''); setLastMeal({ text: phrase });

    // Fast path: a food someone already resolved exactly — instant, no AI call.
    try {
      // The bundled list first (offline, instant), then the shared catalog.
      const cat = (await resolveLocalFood(phrase)) || (await lookupCatalog(phrase));
      if (cat && cat.calories > 0) {
        setIsAnalyzing(false);
        showAnalysis({ lines: [servingLine(cat, 0.9)], obscured: false, decomposed: false }, false, phrase);
        return;
      }
    } catch { /* fall through to the pipeline */ }

    let a: MealAnalysis = { lines: [], obscured: false, decomposed: false };
    try { a = await analyzeMealText(phrase); } catch { /* manual entry below */ }
    setIsAnalyzing(false);
    showAnalysis(a, false, phrase);
  };

  // Stage 3: re-run decomposition + lookup with the user's 2-4 word hint.
  const submitHint = async () => {
    const hint = cleanHint(hintText);
    if (!hint || !lastMeal) return;
    setIsAnalyzing(true);
    setHintUsed(true);
    let a: MealAnalysis = { lines: [], obscured: false, decomposed: false };
    try {
      a = lastMeal.b64
        ? await analyzeMealPhoto(lastMeal.b64, 'image/jpeg', hint)
        : await analyzeMealText(lastMeal.text || '', hint);
    } catch { /* keep what we had */ }
    setIsAnalyzing(false);
    if (a.lines.length === 0 && aiReview?.length) { setAskHint(false); return; }
    showAnalysis(a, true, lastMeal.text || hint);
  };

  const updateLine = (i: number, patch: Partial<ReviewLine>) =>
    setAiReview((r) => (r ? r.map((l, j) => (j === i ? { ...l, ...patch } : l)) : r));

  const stepLine = (i: number, dir: 1 | -1) => {
    const l = aiReview?.[i];
    if (!l) return;
    if (l.grams != null) {
      const step = l.grams >= 200 ? 25 : 10;
      updateLine(i, { grams: Math.max(step, clampGrams(l.grams + dir * step)) });
    } else {
      updateLine(i, { servings: Math.max(0.5, Math.min(10, l.servings + dir * 0.5)) });
    }
  };

  const addReviewItem = async () => {
    const t = addText.trim();
    if (t.length < 2) return;
    setAddBusy(true);
    const line = await analyzeSingleItem(t).catch(() => null);
    setAddBusy(false);
    if (line) {
      setAiReview((r) => [...(r || []), line]);
      setAddText('');
    } else {
      showToast(`Couldn't find "${t}"`, 'info');
    }
  };

  const confirmAiReview = async () => {
    if (!profile?.uid || !aiReview?.length) return;
    setIsAnalyzing(true);
    const mealType = mealTypeNow();
    // Every number below comes from mealMath (grams x per-100 g), not the AI.
    const rows = aiReview
      .map((l) => ({ name: diaryName(l), ...lineMacros(l) }))
      .filter((r) => r.calories > 0);
    const oilG = oilGrams(oilLevel, oilBaseGrams(aiReview));
    if (oilG > 0) rows.push({ name: `Cooking oil (${oilLevel}, ${oilG} g)`, ...oilMacros(oilLevel, oilBaseGrams(aiReview)) });
    for (const r of rows) {
      await logMeal(profile.uid, {
        name: r.name, calories: r.calories,
        protein: Math.round(r.protein), carbs: Math.round(r.carbs), fats: Math.round(r.fats),
        mealType,
      });
    }
    try { await checkAndAwardBadge(profile.uid, 'nutrition_master'); } catch {}
    showToast(rows.length === 1 ? 'Logged' : `Logged ${rows.length} items`, 'success');
    setAiReview(null); setAiOpen(false); setAiInput(''); setAskHint(false); setOilLevel('none');
    setIsAnalyzing(false);
  };

  const submitManual = async () => {
    if (!profile?.uid || !manualName.trim() || manualCals <= 0) return;
    setIsAnalyzing(true);
    await logMeal(profile.uid, {
      name: manualName.trim(),
      calories: Math.round(manualCals),
      protein: Math.round(manualP),
      carbs: Math.round(manualC),
      fats: Math.round(manualF),
      mealType: 'snack',
    });
    try { await checkAndAwardBadge(profile.uid, 'nutrition_master'); } catch {}
    showToast('Logged', 'success');
    setManualOpen(false);
    setManualName(''); setManualCals(0); setManualP(0); setManualC(0); setManualF(0);
    setIsAnalyzing(false);
  };

  // When search results appear, bring the search field to the top of the screen
  // so the list under it is visible. Only on the change from none to some: once
  // the list is open the user is free to scroll without being pulled back.
  const searchBox = useRef<HTMLDivElement>(null);
  const hadSuggestions = useRef(false);
  useEffect(() => {
    const has = aiSuggestions.length > 0;
    if (has && !hadSuggestions.current) {
      searchBox.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    hadSuggestions.current = has;
  }, [aiSuggestions.length]);

  // Search as the user types: the bundled food list first (offline), then USDA.
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setAiSuggestions([]); return; }
    let cancelled = false;
    setAiSearching(true);
    const t = setTimeout(async () => {
      try {
        const results = (await searchFood(term)).filter(r => r.calories > 0).slice(0, 8);
        if (!cancelled) setAiSuggestions(results);
        // Then branded products (Open Food Facts, via the server). They arrive
        // a moment later and slot in under the best few of our own, so a
        // packaged product is never buried below the fold.
        const branded = await searchBrandedFoods(term);
        if (!cancelled && branded.length) {
          const have = new Set(results.map(r => r.name.toLowerCase()));
          const extra = branded.filter(b => !have.has(b.name.toLowerCase())).slice(0, 5);
          setAiSuggestions([...results.slice(0, 5), ...extra, ...results.slice(5)].slice(0, 10));
        }
      } finally {
        if (!cancelled) setAiSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  // Recent distinct meals for one-tap re-log — the fastest possible logging path.
  // Pulls the last ~40 logged meals, dedupes by name, keeps the 8 most recent.
  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'meals'),
          where('userId', '==', profile.uid),
          orderBy('timestamp', 'desc'),
          limit(40),
        ));
        const seen = new Set<string>();
        const distinct: any[] = [];
        for (const d of snap.docs) {
          const m = d.data() as any;
          const key = (m.name || '').toLowerCase().trim();
          if (!key || seen.has(key) || !(m.calories > 0)) continue;
          seen.add(key);
          distinct.push({ name: m.name, calories: m.calories, protein: m.protein || 0, carbs: m.carbs || 0, fats: m.fats || 0 });
          if (distinct.length >= 8) break;
        }
        if (!cancelled) setRecentLogs(distinct);
      } catch { if (!cancelled) setRecentLogs([]); }
    })();
    return () => { cancelled = true; };
  }, [profile?.uid, meals.length]);

  const reLog = async (m: any) => {
    if (!profile?.uid) return;
    await logMeal(profile.uid, {
      name: m.name,
      calories: Math.round(m.calories),
      protein: Math.round(m.protein || 0),
      carbs: Math.round(m.carbs || 0),
      fats: Math.round(m.fats || 0),
      mealType: 'snack',
    });
    try { await checkAndAwardBadge(profile.uid, 'nutrition_master'); } catch {}
    showToast(`Re-logged ${m.name}`, 'success');
  };

  const logSuggestion = async (s: any) => {
    if (!profile?.uid) return;
    // A packaged product comes per 100 g, and almost nobody eats exactly that.
    // Open the entry sheet with its numbers and an amount to adjust, instead of
    // logging 100 g of chocolate spread on one tap.
    if (s.source === 'OFF') {
      const name = String(s.name).replace(/\s*\(100g\)$/, '');
      setManualBase({ name, calories: s.calories, protein: s.protein, carbs: s.carbs, fats: s.fats });
      setManualGrams(100);
      setManualName(`${name} (100g)`);
      setManualCals(Math.round(s.calories)); setManualP(Math.round(s.protein));
      setManualC(Math.round(s.carbs)); setManualF(Math.round(s.fats));
      setSearch(''); setAiSuggestions([]);
      setManualServing(null);
      setManualOpen(true);
      // Ask for its serving size in the background. The answer is dropped if
      // the sheet has moved on to another product (or closed) by then.
      const code = typeof s.code === 'string' ? s.code : '';
      servingFor.current = code;
      if (code) {
        void fetchProductServing(code).then((serving) => {
          if (serving && servingFor.current === code) setManualServing(serving);
        });
      }
      return;
    }
    await logMeal(profile.uid, {
      name: s.name,
      calories: Math.round(s.calories),
      protein: Math.round(s.protein),
      carbs: Math.round(s.carbs),
      fats: Math.round(s.fats),
      mealType: 'snack',
    });
    try { await checkAndAwardBadge(profile.uid, 'nutrition_master'); } catch {}
    showToast('Logged', 'success');
    setSearch('');
    setAiSuggestions([]);
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile?.uid) return;
    // Photos used to be logged straight away from one AI total. Now they go
    // through the same itemised review as typed meals.
    setAiOpen(true); setAiReview(null); setAskHint(false);
    setHintUsed(false); setHintText('');
    setIsAnalyzing(true);
    let a: MealAnalysis = { lines: [], obscured: false, decomposed: false };
    try {
      // Phone photos are 5-10 MB; sent raw they blew the request limit and
      // came back empty (the ramen bug). 1024px JPEG keeps every detail the
      // model needs at ~150 KB.
      const b64 = await downscaleToJpegBase64(file, 1024);
      setLastMeal({ b64 });
      a = await analyzeMealPhoto(b64, 'image/jpeg');
    } catch { /* manual entry below */ }
    setIsAnalyzing(false);
    showAnalysis(a, false, '');
  };

  const filtered = meals.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const totalCals = meals.reduce((a, m) => a + m.calories, 0);
  const totalProtein = meals.reduce((a, m) => a + (m.protein || 0), 0);
  const totalCarbs = meals.reduce((a, m) => a + (m.carbs || 0), 0);
  const totalFats = meals.reduce((a, m) => a + (m.fats || 0), 0);
  const targets = computeDailyTargets(profile);
  const targetCals = targets.calories;

  return (
    <div className="pb-28 pt-4 px-4 space-y-5">
      <div className="pt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-eyebrow text-accent">Nutrition</p>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight leading-tight mt-1">Today's intake</h1>
        </div>
        {/* The second door to the meal plan. Someone hunting for "meals" comes
            to the Fuel tab first, so the link belongs here as well as on Home. */}
        <button
          onClick={() => navigate('/meal-plan')}
          className="shrink-0 h-11 px-3 rounded-2xl bg-accent-4/12 border border-accent-4/30 text-accent-4 text-[11px] font-semibold inline-flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <ChefHat size={14} aria-hidden="true" />
          Meal plan
        </button>
      </div>

      {/* Fuel gauge + macro orbitals, over what has actually been logged today.
          The 3D spheres are code-split; the numbers paint immediately. */}
      <MacroMatrix
        caloriesConsumed={totalCals}
        calorieTarget={targetCals}
        proteinG={totalProtein}
        proteinTargetG={targets.proteinG}
        carbsG={totalCarbs}
        carbsTargetG={targets.carbsG}
        fatsG={totalFats}
        fatsTargetG={targets.fatsG}
      />

      {/* Search. The field sits low on the page and its results open beneath
          it — which, left alone, is behind the dock, and on a phone behind the
          keyboard. `searchBox` lets the results effect bring the field to the
          top of the screen so the list is in view (scroll-mt keeps it off the
          very edge). */}
      <div className="relative scroll-mt-4" ref={searchBox}>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" size={16} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search foods or today's meals…"
          className="w-full h-12 glass rounded-2xl pl-11 pr-10 text-white text-sm placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 transition-colors"
        />
        {aiSearching && (
          <Loader2 size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-dim animate-spin" />
        )}
        {aiSuggestions.length > 0 && (
          // Up to eight rows now: the list scrolls inside a capped height, so the
          // last results stay reachable above the on-screen keyboard.
          <div className="absolute z-30 left-0 right-0 top-full mt-2 bg-surface border border-white/[0.06] rounded-2xl overflow-y-auto overscroll-contain max-h-[42vh] shadow-2xl">
            <p className="sticky top-0 z-10 bg-surface px-4 py-2 text-eyebrow text-accent border-b border-white/[0.04]">Tap to log instantly</p>
            {aiSuggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => logSuggestion(s)}
                className="w-full px-4 py-3 flex justify-between items-center hover:bg-white/[0.04] transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{s.name}</p>
                  <p className="num text-[10px] text-text-dim mt-0.5 truncate">{s.brand ? `${s.brand} · ` : ''}P{Math.round(s.protein)} · C{Math.round(s.carbs)} · F{Math.round(s.fats)}</p>
                </div>
                <span className="num text-sm text-accent font-semibold shrink-0 ml-2">{Math.round(s.calories)}</span>
              </button>
            ))}
            {/* Required by the Open Database Licence whenever their data is shown. */}
            {aiSuggestions.some(s => s.source === 'OFF') && (
              <p className="px-4 py-2 text-[10px] text-text-dim border-t border-white/[0.04]">
                Packaged products from Open Food Facts (ODbL). Check the label.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Macro card */}
      <div className="glass p-5 space-y-4">
        <div className="flex justify-between items-baseline">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-text-dim">Calories</p>
              {targets.dayType !== 'base' && (
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                  {targets.dayType === 'workout' ? 'Gym day' : 'Rest day'}
                </span>
              )}
            </div>
            <p className="font-display text-3xl font-bold text-white num mt-1">
              {totalCals}<span className="text-base text-text-dim font-medium"> / {targetCals}</span>
            </p>
          </div>
          <button onClick={() => navigate('/nutrition-goals')} className="num text-sm text-accent font-semibold flex items-center gap-1">
            {Math.max(targetCals - totalCals, 0)} left
          </button>
        </div>
        <div className="w-full h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-soft via-accent to-accent-bright rounded-full transition-all"
            style={{ width: `${Math.min((totalCals / targetCals) * 100, 100)}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Macro label="Protein" value={totalProtein} target={targets.proteinG} color="text-accent" />
          <Macro label="Carbs" value={totalCarbs} target={targets.carbsG} color="text-accent-3" />
          <Macro label="Fats" value={totalFats} target={targets.fatsG} color="text-accent-2" />
        </div>
        <button
          onClick={() => navigate('/nutrition-goals')}
          className="w-full text-center text-xs text-text-dim hover:text-white transition-colors pt-1"
        >
          Adjust macro targets →
        </button>
      </div>

      {/* CTA row */}
      <div className="grid grid-cols-4 gap-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setAiOpen(true)}
          className="glass p-3 flex flex-col items-center gap-1.5"
        >
          <div className="w-10 h-10 ai-gradient-box rounded-xl flex items-center justify-center">
            <Sparkles size={18} className="text-accent" />
          </div>
          <span className="text-[11px] font-medium text-white">AI log</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => fileRef.current?.click()}
          className="glass p-3 flex flex-col items-center gap-1.5"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-3/12 border border-accent-3/25 flex items-center justify-center">
            <Camera size={18} className="text-accent-3" />
          </div>
          <span className="text-[11px] font-medium text-white">Photo</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={openScanner}
          className="glass p-3 flex flex-col items-center gap-1.5"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-2/12 border border-accent-2/25 flex items-center justify-center">
            <ScanBarcode size={18} className="text-accent-2" />
          </div>
          <span className="text-[11px] font-medium text-white">Scan</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => { setManualName(''); setManualCals(0); setManualP(0); setManualC(0); setManualF(0); setManualOpen(true); }}
          className="glass p-3 flex flex-col items-center gap-1.5"
        >
          <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/15 flex items-center justify-center">
            <Pencil size={18} className="text-white/85" />
          </div>
          <span className="text-[11px] font-medium text-white">Manual</span>
        </motion.button>
      </div>

      {/* Hidden file input for top photo button — no `capture` so the browser lets the user
          pick camera OR gallery. Phones with denied camera permission can still log via gallery. */}
      <input type="file" ref={fileRef} onChange={handleImage} accept="image/*" className="hidden" />

      {/* One-tap re-log — your recent foods, logged again instantly */}
      {recentLogs.length > 0 && (
        <div className="space-y-2">
          <p className="text-eyebrow text-text-dim px-1">Re-log in one tap</p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {recentLogs.map((m, i) => (
              <motion.button
                key={i}
                whileTap={{ scale: 0.95 }}
                onClick={() => reLog(m)}
                className="glass shrink-0 px-3.5 py-2.5 flex items-center gap-2 rounded-2xl border border-white/[0.06] hover:border-accent/30 transition-colors"
              >
                <Plus size={14} className="text-accent shrink-0" />
                <span className="text-sm font-medium text-white whitespace-nowrap max-w-[150px] truncate">{m.name}</span>
                <span className="num text-[11px] text-text-dim shrink-0">{Math.round(m.calories)}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Meal list */}
      <div className="space-y-3">
        <div className="flex justify-between items-end px-1">
          <h2 className="font-display text-lg font-bold text-white tracking-tight">Logged</h2>
          <span className="num text-xs text-text-dim">{meals.length} {meals.length === 1 ? 'item' : 'items'}</span>
        </div>
        {loading ? (
          <div className="py-10">
            <LoadingBar label="Loading meals" />
          </div>
        ) : filtered.length ? filtered.map((m, i) => (
          <motion.div
            key={m.id || i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="glass p-4 flex justify-between items-center cursor-pointer active:scale-[0.99] transition-transform"
            role="button"
            tabIndex={0}
            aria-label={`Edit ${m.name}`}
            onClick={() => openEdit(m)}
          >
            <div className="min-w-0">
              <p className="text-white font-medium">{m.name}</p>
              <div className="flex gap-3 mt-1 num text-xs text-text-dim">
                <span>P {m.protein || 0}g</span>
                <span>C {m.carbs || 0}g</span>
                <span>F {m.fats || 0}g</span>
              </div>
            </div>
            <span className="flex items-center gap-2 shrink-0">
              <span className="num text-xl font-semibold text-accent">{m.calories}</span>
              <Pencil size={13} className="text-text-mute" aria-hidden />
            </span>
          </motion.div>
        )) : (
          <div className="glass p-10 flex flex-col items-center justify-center text-center gap-3">
            <span className="text-3xl opacity-70">🍽️</span>
            <p className="text-sm text-text-dim">Nothing logged yet today.</p>
            <button onClick={() => setAiOpen(true)} className="btn-primary mt-2 px-4 py-2 text-xs">
              <Sparkles size={12} /> Log with AI
            </button>
          </div>
        )}
      </div>

      {/* FAB */}
      <div className="fixed bottom-24 right-5 z-50">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setAiOpen(true)}
          className="relative w-14 h-14 bg-accent rounded-full flex items-center justify-center text-bg shadow-[0_16px_40px_-8px_rgba(198,255,61,0.5)]"
          aria-label="Add meal"
        >
          <Plus size={26} strokeWidth={2.5} />
        </motion.button>
      </div>

      {/* Barcode scanner */}
      <AnimatePresence>
        {scanOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={() => setScanOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-surface w-full max-w-sm rounded-3xl overflow-hidden border border-white/[0.06]"
            >
              <div className="p-5 border-b border-white/[0.06] flex justify-between items-center">
                <div>
                  <p className="text-eyebrow text-accent">Barcode</p>
                  <p className="text-white font-medium">{scannedProduct ? 'Product found' : 'Aim at barcode'}</p>
                </div>
                <button onClick={() => setScanOpen(false)} className="w-9 h-9 glass rounded-xl flex items-center justify-center text-white" aria-label="Close">
                  <X size={16} />
                </button>
              </div>

              {/* Camera blocked → friendly one-screen recovery (web can't open
                  settings itself, so we guide + auto-detect the re-grant). */}
              {!scannedProduct && scanBlocked && (
                <div className="p-6 space-y-5 text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-accent-2/12 border border-accent-2/25 flex items-center justify-center">
                    <CameraOff size={28} className="text-accent-2" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="font-display text-xl font-bold text-white tracking-tight">Turn the camera on</h3>
                    <p className="text-sm text-text-dim leading-relaxed">
                      {scanError || 'FitFlow needs camera access to scan barcodes.'}
                    </p>
                  </div>
                  {canOpenAppSettings() ? (
                    /* Native app: real one-tap deep-link to the app's settings. */
                    <ol className="text-left text-sm text-white/80 space-y-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                      <li className="flex gap-2.5"><span className="text-accent font-bold num">1</span><span>Tap <span className="font-semibold text-white">Open app settings</span> below.</span></li>
                      <li className="flex gap-2.5"><span className="text-accent font-bold num">2</span><span>Open <span className="font-semibold text-white">Permissions</span> → <span className="font-semibold text-white">Camera</span> → <span className="font-semibold text-white">Allow</span>.</span></li>
                      <li className="flex gap-2.5"><span className="text-accent font-bold num">3</span><span>Come back — the scanner turns on automatically.</span></li>
                    </ol>
                  ) : (
                    /* Web: browsers forbid opening settings, so guide precisely. */
                    <ol className="text-left text-sm text-white/80 space-y-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
                      <li className="flex gap-2.5"><span className="text-accent font-bold num">1</span><span>Tap the <span className="font-semibold text-white">🔒 / ⓘ</span> icon just left of the web address.</span></li>
                      <li className="flex gap-2.5"><span className="text-accent font-bold num">2</span><span>Open <span className="font-semibold text-white">Permissions</span> → <span className="font-semibold text-white">Camera</span>.</span></li>
                      <li className="flex gap-2.5"><span className="text-accent font-bold num">3</span><span>Choose <span className="font-semibold text-white">Allow</span> — the scanner turns on automatically.</span></li>
                    </ol>
                  )}
                  <div className="space-y-2">
                    {canOpenAppSettings() && (
                      <button onClick={() => openAppSettings()} className="btn-3d w-full h-12">
                        <Settings size={16} /> Open app settings
                      </button>
                    )}
                    <button onClick={openScanner} className={canOpenAppSettings() ? 'btn-ghost w-full h-12' : 'btn-3d w-full h-12'}>
                      <Camera size={16} /> Try the camera again
                    </button>
                    <button onClick={() => barcodeFileRef.current?.click()} className="btn-ghost w-full h-12">
                      <ImageIcon size={16} /> Upload a photo of the barcode instead
                    </button>
                  </div>
                  <input ref={barcodeFileRef} type="file" accept="image/*" onChange={handleBarcodeFile} className="hidden" />
                </div>
              )}

              {!scannedProduct && !scanBlocked && (
                <>
                  <div className="relative bg-black" style={{ aspectRatio: '1/1' }}>
                    <div id="ff-reader" className="w-full h-full" />
                    <div id="ff-reader-file" className="hidden" />
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="relative">
                        <div className="border-2 border-accent rounded-xl" style={{ width: 260, height: 140 }} />
                        <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-accent rounded-tl-lg -translate-x-0.5 -translate-y-0.5" />
                        <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-accent rounded-tr-lg translate-x-0.5 -translate-y-0.5" />
                        <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-accent rounded-bl-lg -translate-x-0.5 translate-y-0.5" />
                        <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-accent rounded-br-lg translate-x-0.5 translate-y-0.5" />
                      </div>
                    </div>
                    {isAnalyzing && (
                      <div className="absolute inset-0 bg-bg/85 flex flex-col items-center justify-center gap-2 z-10">
                        <Loader2 className="text-accent animate-spin" size={26} />
                        <span className="text-sm text-white">Identifying…</span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 border-t border-white/[0.06] space-y-3">
                    {scanError && (
                      <div className="text-xs text-accent-2 bg-accent-2/8 border border-accent-2/20 rounded-xl px-3 py-2 leading-snug flex items-start justify-between gap-3">
                        <span className="flex-1">{scanError}</span>
                        <button
                          onClick={openScanner}
                          className="shrink-0 text-accent underline-offset-2 hover:underline font-medium"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={captureFromVideo}
                        disabled={isAnalyzing}
                        className="btn-3d flex-1 h-12 disabled:opacity-50"
                      >
                        <Aperture size={16} />
                        Capture
                      </button>
                      <button
                        onClick={() => barcodeFileRef.current?.click()}
                        disabled={isAnalyzing}
                        className="btn-ghost h-12 px-4 disabled:opacity-50"
                        aria-label="Upload barcode image"
                      >
                        <ImageIcon size={16} />
                      </button>
                    </div>
                    <p className="text-xs text-text-mute text-center">
                      Live scanning runs automatically. Tap Capture to force a read on the current frame, or pick a photo.
                    </p>
                    <input
                      ref={barcodeFileRef}
                      type="file"
                      accept="image/*"
                      onChange={handleBarcodeFile}
                      className="hidden"
                    />
                  </div>
                </>
              )}

              {scannedProduct && (
                <div className="p-6 space-y-5">
                  <div>
                    {scannedProduct.brand && <p className="text-eyebrow text-accent">{scannedProduct.brand}</p>}
                    <p className="font-display text-xl font-bold text-white leading-tight tracking-tight mt-1">{scannedProduct.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className="text-xs text-text-dim">Nutrition per 100g</p>
                      {scannedProduct.source === 'AI' && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent-2 bg-accent-2/10 rounded-full px-2 py-0.5">
                          <Sparkles size={10} /> Read by AI
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <NutritionCell label="kcal" v={scannedProduct.calories100g} />
                    <NutritionCell label="P" v={`${scannedProduct.protein100g}g`} />
                    <NutritionCell label="C" v={`${scannedProduct.carbs100g}g`} />
                    <NutritionCell label="F" v={`${scannedProduct.fats100g}g`} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-text-dim font-medium">Portion (g)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={portionSize}
                        onChange={e => setPortionSize(Number(e.target.value))}
                        className="flex-1 glass rounded-xl h-12 px-3 text-white num focus:outline-none focus:border-accent/40"
                      />
                      <button onClick={logScanned} className="btn-3d px-5 h-12">Log</button>
                    </div>
                    <p className="num text-xs text-text-dim">
                      = {Math.round(scannedProduct.calories100g * portionSize / 100)} kcal for {portionSize}g
                    </p>
                  </div>
                  <button onClick={() => setScannedProduct(null)} className="w-full text-center text-sm text-text-dim hover:text-white transition-colors">
                    ← Scan another
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit / delete a logged meal */}
      <AnimatePresence>
        {editMeal && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setEditMeal(null)} />
            <motion.div
              initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              transition={{ type: 'spring', damping: 28 }}
              className="relative bg-surface w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 space-y-4 border border-white/[0.06] max-h-[92dvh] overflow-y-auto overscroll-contain"
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-eyebrow text-accent">Logged meal</p>
                  <p className="text-white font-medium text-sm">Edit or remove</p>
                </div>
                <button onClick={() => setEditMeal(null)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                maxLength={100}
                aria-label="Meal name"
                className="w-full glass rounded-2xl px-4 py-3 text-white text-sm focus:outline-none"
              />
              <div className="grid grid-cols-4 gap-2">
                {([['kcal', 'calories'], ['P g', 'protein'], ['C g', 'carbs'], ['F g', 'fats']] as const).map(([label, key]) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-text-dim text-center">{label}</span>
                    <input
                      type="number" inputMode="numeric" min={0}
                      value={editForm[key]}
                      onChange={e => setEditForm(f => ({ ...f, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                      className="w-full glass rounded-xl px-2 py-2 text-white num text-center"
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={removeMeal}
                  disabled={editBusy}
                  className={cn('btn-ghost h-12 disabled:opacity-50', confirmDelete && 'border-accent-2/50 text-accent-2')}
                >
                  <Trash2 size={15} /> {confirmDelete ? 'Tap to confirm' : 'Delete'}
                </button>
                <button onClick={saveEdit} disabled={editBusy || !editForm.name.trim()} className="btn-3d h-12 disabled:opacity-50">
                  {editBusy ? <Loader2 className="animate-spin" size={16} /> : 'Save'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI modal */}
      <AnimatePresence>
        {aiOpen && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setAiOpen(false)}
            />
            <motion.div
              initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              transition={{ type: 'spring', damping: 28 }}
              className="relative bg-surface w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 space-y-4 border border-white/[0.06] max-h-[92dvh] overflow-y-auto overscroll-contain"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 ai-gradient-box rounded-xl flex items-center justify-center">
                    <Sparkles size={16} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-eyebrow text-accent">AI nutrition</p>
                    <p className="text-white font-medium text-sm">Describe what you ate</p>
                  </div>
                </div>
                <button onClick={() => setAiOpen(false)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              {askHint ? (
                <div className="space-y-3">
                  <p className="text-sm text-white font-medium">Not sure what's in this one</p>
                  <p className="text-xs text-text-dim">Some of it is hidden or unclear. Name it in a few words and I'll check again.</p>
                  <input
                    value={hintText}
                    onChange={e => setHintText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitHint(); }}
                    maxLength={60}
                    placeholder="e.g. chicken curry with rice"
                    aria-label="What is in the meal"
                    className="w-full glass rounded-2xl px-4 h-12 text-white text-sm placeholder:text-text-dim/50 focus:outline-none"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => { setAskHint(false); if (!aiReview) { setLastMeal(null); } }}
                      disabled={isAnalyzing}
                      className="btn-ghost h-12 disabled:opacity-50"
                    >
                      {aiReview ? 'Skip' : 'Back'}
                    </button>
                    <button onClick={submitHint} disabled={isAnalyzing || !cleanHint(hintText)} className="btn-3d h-12 disabled:opacity-50">
                      {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : 'Check again'}
                    </button>
                  </div>
                </div>
              ) : aiReview ? (() => {
                const totals = mealTotals(aiReview, oilLevel);
                const oilBase = oilBaseGrams(aiReview);
                const oilG = oilGrams(oilLevel, oilBase);
                return (
                <div className="space-y-3">
                  <p className="text-xs text-text-dim">Check before saving. Adjust grams, remove or add items. Calories are worked out from each food's per-100 g value.</p>
                  <ul className="space-y-2" aria-label="Meal items">
                    {aiReview.map((it, i) => {
                      const m = lineMacros(it);
                      const tag = SOURCE_LABEL[it.source];
                      return (
                      <li key={i} className="glass rounded-2xl px-3 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {it.name}
                              {tag && <span className={cn('ml-2 text-[10px] font-normal', it.source === 'none' ? 'text-red-400' : 'text-text-mute')}>{tag}</span>}
                            </p>
                            <p className="num text-[11px] text-text-dim">
                              {it.per100 ? `${Math.round(it.per100.kcal)} kcal/100 g · ` : ''}P {Math.round(m.protein)}g · C {Math.round(m.carbs)}g · F {Math.round(m.fats)}g
                            </p>
                          </div>
                          <span className="num text-accent font-semibold text-sm" data-testid="line-kcal">{m.calories}</span>
                          <button
                            onClick={() => setAiReview(r => (r && r.length > 1 ? r.filter((_, j) => j !== i) : null))}
                            className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-text-dim"
                            aria-label={`Remove ${it.name}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                        {it.source === 'none' ? (
                          <label className="flex items-center gap-2 text-[11px] text-text-dim">
                            Not in the database — kcal for this portion:
                            <input
                              type="number" inputMode="numeric" min={0}
                              aria-label={`Calories for ${it.name}`}
                              className="w-20 h-8 rounded-lg bg-white/[0.04] px-2 text-white num"
                              onBlur={e => {
                                const kcal = Math.round(Number(e.target.value));
                                if (kcal > 0) updateLine(i, { ...servingLine({ name: it.name, calories: kcal, protein: 0, carbs: 0, fats: 0 }, it.confidence), grams: null, name: it.grams ? `${it.name} (${it.grams} g)` : it.name });
                              }}
                            />
                          </label>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button onClick={() => stepLine(i, -1)} className="w-8 h-8 rounded-lg bg-white/[0.04] text-white" aria-label={`Less ${it.name}`}>−</button>
                            {it.grams != null ? (
                              <label className="flex items-center gap-1 text-[11px] text-text-dim">
                                <input
                                  type="number" inputMode="numeric" min={1} max={2000}
                                  value={it.grams}
                                  aria-label={`Grams of ${it.name}`}
                                  onChange={e => updateLine(i, { grams: clampGrams(e.target.value) || 1 })}
                                  className="w-16 h-8 rounded-lg bg-white/[0.04] px-2 text-white num text-center"
                                />
                                g
                              </label>
                            ) : (
                              <span className="num text-[11px] text-text-dim w-16 text-center">×{it.servings} serving</span>
                            )}
                            <button onClick={() => stepLine(i, 1)} className="w-8 h-8 rounded-lg bg-white/[0.04] text-white" aria-label={`More ${it.name}`}>+</button>
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ul>

                  <div className="flex gap-2">
                    <input
                      value={addText}
                      onChange={e => setAddText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addReviewItem(); }}
                      placeholder="Add item, e.g. egg 50g"
                      aria-label="Add an item"
                      className="flex-1 glass rounded-xl px-3 h-10 text-white text-sm placeholder:text-text-dim/50 focus:outline-none"
                    />
                    <button onClick={addReviewItem} disabled={addBusy || addText.trim().length < 2} className="btn-ghost h-10 px-3 disabled:opacity-50" aria-label="Add item">
                      {addBusy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                    </button>
                  </div>

                  {needsOilChoice(aiReview) && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-text-dim">Cooking oil {oilG > 0 ? <span className="num">· +{oilG} g, {oilMacros(oilLevel, oilBase).calories} kcal</span> : null}</p>
                      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Cooking oil">
                        {(['none', 'light', 'heavy'] as OilLevel[]).map(o => (
                          <button
                            key={o}
                            role="radio"
                            aria-checked={oilLevel === o}
                            onClick={() => setOilLevel(o)}
                            className={cn('h-9 rounded-xl text-xs font-semibold capitalize border',
                              oilLevel === o ? 'bg-accent/15 border-accent/50 text-accent' : 'bg-white/[0.03] border-white/[0.06] text-text-dim')}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="num text-[11px] text-text-dim text-right" data-testid="meal-totals">
                    P {Math.round(totals.protein)}g · C {Math.round(totals.carbs)}g · F {Math.round(totals.fats)}g
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { setAiReview(null); setOilLevel('none'); }} disabled={isAnalyzing} className="btn-ghost h-12 disabled:opacity-50">
                      Edit text
                    </button>
                    <button onClick={confirmAiReview} disabled={isAnalyzing || totals.calories <= 0} className="btn-3d h-12 disabled:opacity-50">
                      {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : `Log ${totals.calories} kcal`}
                    </button>
                  </div>
                </div>
                );
              })() : (
              <>
              <textarea
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                disabled={isAnalyzing}
                placeholder="e.g. a bowl of oatmeal with blueberries and honey"
                className="w-full glass rounded-2xl p-4 text-white min-h-[110px] text-sm placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 resize-none"
              />
              {isAnalyzing && (
                <p className="text-xs text-accent flex items-center gap-2" role="status">
                  <Loader2 className="animate-spin" size={12} /> Reading your meal and estimating portions…
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={isAnalyzing}
                  className="btn-ghost h-12 disabled:opacity-50"
                >
                  <Camera size={16} className="text-accent" />
                  Photo
                </button>
                <button
                  onClick={handleAiAnalyze}
                  disabled={isAnalyzing || !aiInput.trim()}
                  className="btn-3d h-12 disabled:opacity-50"
                >
                  {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <><Sparkles size={14} /> Analyse</>}
                </button>
              </div>
              </>
              )}
              <p className="text-center text-xs text-text-mute">
                Gemini names the foods and portions; calories come from nutrition data
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual entry modal */}
      <AnimatePresence>
        {manualOpen && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setManualOpen(false)}
            />
            <motion.div
              initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              transition={{ type: 'spring', damping: 28 }}
              className="relative bg-surface w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-6 space-y-4 border border-white/[0.06] max-h-[92dvh] overflow-y-auto overscroll-contain"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/15 flex items-center justify-center">
                    <Pencil size={16} className="text-white/85" />
                  </div>
                  <div>
                    <p className="text-eyebrow text-accent">{manualBase ? 'Packaged food' : 'Manual log'}</p>
                    <p className="text-white font-medium text-sm">{manualBase ? 'Set how much you had' : 'Type the numbers yourself'}</p>
                  </div>
                </div>
                <button onClick={() => setManualOpen(false)} className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center text-text-dim" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <input
                value={manualName}
                onChange={e => setManualName(e.target.value)}
                placeholder="Food name"
                className="w-full glass rounded-2xl h-12 px-4 text-white text-sm placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
              />
              {manualBase && (
                <div className="space-y-2">
                  <label className="text-xs text-text-dim font-medium ml-1">Amount (g or ml)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Amount in grams"
                    value={manualGrams || ''}
                    onChange={e => setAmount(Math.min(5000, Math.max(0, parseInt(e.target.value) || 0)))}
                    placeholder="100"
                    className="w-full glass rounded-2xl h-12 px-4 num text-lg font-semibold text-white text-center focus:outline-none focus:border-accent/40"
                  />
                  {manualServing && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAmount(manualServing.grams)}
                        className={cn('flex-1 h-10 rounded-xl text-xs font-medium border transition-colors truncate px-2',
                          manualGrams === manualServing.grams ? 'border-accent/50 text-accent bg-accent/10' : 'border-white/[0.08] text-text-dim')}
                      >
                        1 serving · {manualServing.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAmount(100)}
                        className={cn('h-10 px-4 rounded-xl text-xs font-medium border transition-colors',
                          manualGrams === 100 ? 'border-accent/50 text-accent bg-accent/10' : 'border-white/[0.08] text-text-dim')}
                      >
                        100 g
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-text-dim ml-1">
                    {Math.round(manualBase.calories)} kcal per 100 g, from Open Food Facts. Check it against the label.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs text-text-dim font-medium ml-1">Calories (kcal)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={manualCals || ''}
                  onChange={e => setManualCals(parseInt(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full glass rounded-2xl h-14 px-4 num text-2xl font-semibold text-white text-center focus:outline-none focus:border-accent/40"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MacroInput label="Protein (g)" value={manualP} onChange={setManualP} />
                <MacroInput label="Carbs (g)" value={manualC} onChange={setManualC} />
                <MacroInput label="Fats (g)" value={manualF} onChange={setManualF} />
              </div>
              <button
                onClick={submitManual}
                disabled={isAnalyzing || !manualName.trim() || manualCals <= 0}
                className="btn-3d w-full h-12 disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <><Plus size={14} /> Log meal</>}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const MacroInput: React.FC<{ label: string; value: number; onChange: (n: number) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="text-[10px] text-text-dim font-medium ml-1 mb-1 block">{label}</label>
    <input
      type="number"
      inputMode="numeric"
      value={value || ''}
      onChange={e => onChange(parseInt(e.target.value) || 0)}
      placeholder="0"
      className="w-full glass rounded-xl h-12 px-2 num text-base font-semibold text-white text-center focus:outline-none focus:border-accent/40"
    />
  </div>
);

const Macro: React.FC<{ label: string; value: number; target?: number; color: string }> = ({ label, value, target, color }) => (
  <div>
    <p className="text-xs text-text-dim">{label}</p>
    <p className={`num text-lg font-semibold mt-0.5 ${color}`}>
      {value}<span className="text-xs text-text-dim font-medium">{target ? `/${target}g` : 'g'}</span>
    </p>
  </div>
);

const NutritionCell: React.FC<{ label: string; v: any }> = ({ label, v }) => (
  <div className="glass p-2.5 text-center">
    <p className="text-[10px] text-text-dim font-medium">{label}</p>
    <p className="num text-sm font-semibold text-white mt-0.5">{v}</p>
  </div>
);
