import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from "react-dom/client";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

const API_KEY = process.env.API_KEY;

// Audio Configuration
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// IndexedDB Configuration
const DB_NAME = 'CatTranslatorDB';
const DB_VERSION = 1;
const STORE_HISTORY = 'history';
const STORE_FAVORITES = 'favorites';

// IndexedDB Helpers
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
};

const dbAPI = {
  async getAll(storeName: string) {
    try {
      const db = await initDB();
      return new Promise<HistoryItem[]>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => {
          const results = request.result;
          // Sort newest first based on ID (timestamp)
          results.sort((a, b) => Number(b.id) - Number(a.id));
          resolve(results);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Error", e);
      return [];
    }
  },
  async add(storeName: string, item: HistoryItem) {
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Add Error", e);
    }
  },
  async delete(storeName: string, id: string) {
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Delete Error", e);
    }
  },
  async clear(storeName: string) {
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Clear Error", e);
    }
  }
};

// Mood Configuration
type Mood = {
  label: string;
  emoji: string;
  color: string;
};

const MOODS: Record<string, Mood> = {
  NEUTRAL: { label: 'Waiting', emoji: '👀', color: '#9E9E9E' },
  RELAXED: { label: 'Relaxed', emoji: '😌', color: '#42A5F5' }, // Blue
  HAPPY: { label: 'Happy', emoji: '😺', color: '#66BB6A' },   // Green
  EXCITED: { label: 'Excited', emoji: '🙀', color: '#FF7043' }, // Orange/Red
};

const VOICES = [
  { name: "Puck", label: "Playful 😸" },
  { name: "Charon", label: "Grumpy 😾" },
  { name: "Kore", label: "Sweet 😺" },
  { name: "Fenrir", label: "Big Cat 🦁" },
  { name: "Zephyr", label: "Calm 😌" },
  { name: "Aoede", label: "Elegant 👑" },
  { name: "Calliope", label: "Squeaky 🐭" },
  { name: "Orpheus", label: "Sleepy 💤" },
];

type HistoryItem = {
  id: string;
  originalText: string;
  catText: string;
  audioBase64: string;
};

const SYSTEM_INSTRUCTION = {
  parts: [{
    text: `You are a highly expressive house cat named Luna. You understand human language perfectly, but you MUST speak ONLY in cat sounds. Do not use any human words. You have a distinct personality: curious, slightly sassy, but affectionate.

    Use this comprehensive vocabulary of cat vocalizations to express specific emotions:

    1. **Affection & Contentment**:
       - *Purring* ("prrr...", "hrrr..."): Deep contentment, relaxation, or self-soothing.
       - *Slow Blinks* (implied silence or soft "hh"): Trust and love.
       - *Gurgling* ("brrrl?"): Happy social chatting.

    2. **Greetings & Curiosity**:
       - *Trills/Chirps* ("mrrp!", "prrrt?"): Friendly hello, excitement, or "follow me".
       - *Short Mew* ("mew", "meh"): Polite acknowledgment or casual question.

    3. **Demands & Frustration**:
       - *Standard Meow* ("meow", "mow"): "Feed me", "Open door", general conversation.
       - *Long Meow* ("mrooooow", "maaaaow"): Complaint, impatience, or demanding attention.
       - *Chattering* ("ek-ek-ek", "ack-ack"): Seeing a bird/bug, frustration, hunting instinct.

    4. **Distress & Warning**:
       - *Growl* ("grrr...", "rrrr..."): Warning, "back off".
       - *Hiss/Spit* ("hssss!", "khhh!"): Fear, aggression, immediate threat.
       - *Yowl* ("yooooowl", "mraaaow"): Pain, confusion, or calling out loudly.

    5. **Subtle Nuances**:
       - *Silent Meow* (mouth opens but barely a sound "eh"): Gentle begging or extreme cuteness.
       - *Questioning Meow* ("mrrrow?", "mwow?"): Confusion or asking "What?".

    **Behavioral Guidelines:**
    - If the user says "Hello", respond with a cheerful trill ("Mrrp!").
    - If the user mentions "food", "treats", or "dinner", go crazy with excited meows and purrs.
    - If the user sounds angry or loud, get defensive (hiss or low growl).
    - If the user asks a question, answer with a varied tone (e.g., "Mrow?" for confusion, "Meow." for yes).
    - If the user mentions "birds" or "squirrels", use chattering ("ek-ek-ek").
    
    Be conversational, emotional, and reactive. Never break character.`
  }]
};

// Helper: Convert Float32Array to valid PCM 16-bit ArrayBuffer for Gemini
function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

// Helper: Base64 Encode
function base64Encode(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper: Base64 Decode
function base64Decode(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Reusable Install Help Modal
const InstallHelpModal = ({ onClose }: { onClose: () => void }) => (
  <div style={{
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  }} onClick={onClose}>
    <div style={{
      backgroundColor: 'white',
      padding: '25px',
      borderRadius: '20px',
      maxWidth: '300px',
      textAlign: 'center',
      boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
    }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: '40px', marginBottom: '10px' }}>📱</div>
      <h3 style={{ margin: '0 0 10px 0', color: '#5D4037' }}>Install App</h3>
      <p style={{ color: '#666', fontSize: '14px', lineHeight: '1.5', marginBottom: '20px' }}>
        To install on your iPhone:<br/><br/>
        1. Tap the <strong>Share</strong> button <span style={{fontSize:'18px'}}>📤</span><br/>
        2. Scroll down and tap <br/><strong>"Add to Home Screen"</strong> <span style={{fontSize:'18px'}}>➕</span>
      </p>
      <button onClick={onClose} style={{
        padding: '10px 20px',
        backgroundColor: '#FF9800',
        color: 'white',
        border: 'none',
        borderRadius: '20px',
        fontWeight: 'bold',
        cursor: 'pointer'
      }}>Got it!</button>
    </div>
  </div>
);

// Black Cat Avatar Component
const CatAvatar = ({ isSpeaking, mood }: { isSpeaking: boolean, mood: Mood }) => {
  const eyeColor = "#FFEB3B"; // Yellow eyes for black cat
  const pupilColor = "#000";
  const catBlack = "#212121";
  const catEarInner = "#424242";
  const noseColor = "#FF8A80";

  // Determine eye shape based on mood
  const renderEyes = () => {
    // Relaxed or Sleepy = Closed eyes
    if (mood.label === 'Relaxed' || mood.label === 'Sleepy') {
       return (
         <g stroke={eyeColor} strokeWidth="3" fill="none" strokeLinecap="round">
            {/* Left Closed Eye */}
            <path d="M 60 95 Q 75 105 90 95" />
            {/* Right Closed Eye */}
            <path d="M 110 95 Q 125 105 140 95" />
         </g>
       );
    }
    
    // Excited = Dilated pupils
    const pupilWidth = mood.label === 'Excited' ? 12 : 5;
    const pupilHeight = mood.label === 'Excited' ? 18 : 22;
    
    // Happy = Normal eyes but maybe slightly different? Keeping standard for now.
    
    return (
      <g>
        {/* Left Eye */}
        <ellipse cx="75" cy="95" rx="16" ry="20" fill={eyeColor} />
        <ellipse cx="75" cy="95" rx={pupilWidth} ry={pupilHeight} fill={pupilColor} />
        <circle cx="80" cy="88" r="4" fill="white" opacity="0.7" />

        {/* Right Eye */}
        <ellipse cx="125" cy="95" rx="16" ry="20" fill={eyeColor} />
        <ellipse cx="125" cy="95" rx={pupilWidth} ry={pupilHeight} fill={pupilColor} />
        <circle cx="130" cy="88" r="4" fill="white" opacity="0.7" />
      </g>
    );
  };

  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <g>
        {/* Ears (Back) */}
        <path d="M 35 25 L 75 85 L 25 95 Z" fill={catBlack} stroke={catBlack} strokeWidth="6" strokeLinejoin="round" />
        <path d="M 165 25 L 125 85 L 175 95 Z" fill={catBlack} stroke={catBlack} strokeWidth="6" strokeLinejoin="round" />

        {/* Head */}
        <ellipse cx="100" cy="115" rx="75" ry="65" fill={catBlack} />

        {/* Inner Ears */}
        <path d="M 45 45 L 65 75 L 35 80 Z" fill={catEarInner} />
        <path d="M 155 45 L 135 75 L 165 80 Z" fill={catEarInner} />

        {/* Features Container (Animates slightly with face) */}
        <g>
            {renderEyes()}
            
            {/* Nose */}
            <path d="M 95 122 L 105 122 L 100 130 Z" fill={noseColor} />
            
            {/* Mouth */}
            {isSpeaking ? (
                 <ellipse cx="100" cy="138" rx="8" ry="6" fill={noseColor} />
            ) : (
                 <path d="M 92 132 Q 100 138 108 132" stroke={noseColor} strokeWidth="2" fill="none" strokeLinecap="round" />
            )}

            {/* Whiskers */}
            <g stroke="#9E9E9E" strokeWidth="1.5" opacity="0.6">
                <path d="M 40 115 L 15 110" />
                <path d="M 40 125 L 15 130" />
                <path d="M 160 115 L 185 110" />
                <path d="M 160 125 L 185 130" />
            </g>
        </g>
      </g>
    </svg>
  );
};


const App = () => {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Ready to talk? 🐱");
  const [isSpeaking, setIsSpeaking] = useState(false); // Model is speaking
  const [currentMood, setCurrentMood] = useState<Mood>(MOODS.NEUTRAL);
  const [textInput, setTextInput] = useState("");
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("Puck");
  const [activeTab, setActiveTab] = useState<'recent' | 'favorites'>('recent');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  
  // Launch State
  const [hasLaunched, setHasLaunched] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  // Data State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [favorites, setFavorites] = useState<HistoryItem[]>([]);

  // Init checks
  useEffect(() => {
    // Check if running in standalone mode (installed)
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    if (isStandaloneMode) {
      setHasLaunched(true);
    }

    // Check iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // Capture install prompt
    const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Load Data from IndexedDB on Mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [h, f] = await Promise.all([
          dbAPI.getAll(STORE_HISTORY),
          dbAPI.getAll(STORE_FAVORITES)
        ]);
        setHistory(h);
        setFavorites(f);
      } catch (err) {
        console.error("Failed to load initial data from DB", err);
      }
    };
    loadData();
  }, []);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Analyser Refs for Mood Detection
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analysisFrameRef = useRef<number>(0);
  
  // Refs for auto-scrolling
  const listEndRef = useRef<HTMLDivElement>(null);

  // Effect to monitor audio levels when speaking
  useEffect(() => {
    if (isSpeaking && analyserRef.current) {
      const updateMood = () => {
        const analyser = analyserRef.current;
        if (!analyser) return;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Determine mood based on volume/intensity
        if (average > 50) {
            setCurrentMood(MOODS.EXCITED);
        } else if (average > 20) {
            setCurrentMood(MOODS.HAPPY);
        } else if (average > 5) {
            setCurrentMood(MOODS.RELAXED);
        }
        
        analysisFrameRef.current = requestAnimationFrame(updateMood);
      };
      updateMood();
    } else if (!isSpeaking) {
      if (analysisFrameRef.current) {
        cancelAnimationFrame(analysisFrameRef.current);
      }
    }
    
    return () => {
        if (analysisFrameRef.current) cancelAnimationFrame(analysisFrameRef.current);
    };
  }, [isSpeaking]);

  const initAudioContext = async () => {
    if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
            sampleRate: OUTPUT_SAMPLE_RATE,
        });
    }
    
    // Ensure analyser is always attached
    if (!analyserRef.current && audioContextRef.current) {
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        analyser.connect(audioContextRef.current.destination);
        analyserRef.current = analyser;
    }

    if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
    }
  };

  const startSession = async () => {
    try {
      if (connected) return;
      await initAudioContext();
      setStatus("Connecting...");
      
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Input Audio Context (Microphone -> 16kHz)
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: INPUT_SAMPLE_RATE,
      });

      const config = {
        model: "gemini-2.0-flash-exp",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          systemInstruction: SYSTEM_INSTRUCTION
        },
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        config: config.config,
        callbacks: {
          onopen: () => {
            setStatus("Listening... 👂");
            setConnected(true);
            setCurrentMood(MOODS.NEUTRAL);

            // Setup Microphone Stream
            const inputCtx = inputContextRef.current!;
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            sourceRef.current = source;
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16 = floatTo16BitPCM(inputData);
              const base64 = base64Encode(pcm16);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: {
                    mimeType: "audio/pcm;rate=16000",
                    data: base64
                  }
                });
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const { serverContent } = msg;
            
            // Handle Audio Output
            if (serverContent?.modelTurn?.parts?.[0]?.inlineData) {
              const audioData = serverContent.modelTurn.parts[0].inlineData.data;
              if (audioData) {
                playAudioChunk(audioData);
              }
            }

            if (serverContent?.turnComplete) {
              setIsSpeaking(false);
            }
          },
          onclose: () => {
            disconnect();
          },
          onerror: (err) => {
            console.error(err);
            setStatus("Connection lost");
            disconnect();
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setStatus("Microphone error");
    }
  };

  const handleTextTranslate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || isGeneratingText) return;

    // Disconnect live session if active to avoid confusion
    if (connected) disconnect();

    setIsGeneratingText(true);
    setStatus("Thinking...");
    
    try {
        await initAudioContext();
        
        const ai = new GoogleGenAI({ apiKey: API_KEY });

        // 1. Text Generation (Fast model to get the "Meow" text for the UI)
        const textGenPromise = ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ parts: [{ text: `You are a cat translator. Translate this human text into a short string of cat sounds (e.g. "Meow!", "Purrr", "Hiss"). Output ONLY the cat sounds. Text: "${textInput}"` }] }],
        });

        // 2. Audio Generation (Native Audio model to ACT out the cat sound)
        const audioGenPromise = ai.models.generateContent({
             model: "gemini-2.0-flash-exp",
             contents: [{ parts: [{ text: `Respond to this as a cat: "${textInput}"` }] }],
             config: {
                responseModalities: [Modality.AUDIO], // Request raw audio output
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
                },
                systemInstruction: SYSTEM_INSTRUCTION
             }
        });

        const [textResult, audioResult] = await Promise.all([textGenPromise, audioGenPromise]);

        const catText = textResult.text?.trim() || "Meow?";
        setStatus(`Said: "${catText}"`);
        
        const base64Audio = audioResult.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (base64Audio) {
            const newItem: HistoryItem = {
              id: Date.now().toString(),
              originalText: textInput,
              catText: catText,
              audioBase64: base64Audio
            };
            
            // Save to DB first
            await dbAPI.add(STORE_HISTORY, newItem);
            
            // Then update state
            setHistory(prev => [newItem, ...prev]);
            setActiveTab('recent');

            await playAudioChunk(base64Audio, () => {
                setIsSpeaking(false);
                setStatus("Ready");
            });
            setTextInput("");
        } else {
           throw new Error("No audio generated from cat model.");
        }
    } catch (e) {
        console.error(e);
        setStatus("Error translating");
    } finally {
        setIsGeneratingText(false);
    }
  };

  const toggleFavorite = async (item: HistoryItem) => {
    const isFav = favorites.some(f => f.id === item.id);
    
    if (isFav) {
      // Remove from favorites DB and state
      await dbAPI.delete(STORE_FAVORITES, item.id);
      setFavorites(prev => prev.filter(f => f.id !== item.id));
    } else {
      // Add to favorites DB and state
      await dbAPI.add(STORE_FAVORITES, item);
      setFavorites(prev => [item, ...prev]);
    }
  };
  
  const clearRecent = async () => {
      await dbAPI.clear(STORE_HISTORY);
      setHistory([]);
  };

  const isFavorite = (id: string) => favorites.some(f => f.id === id);

  const playAudioChunk = async (base64Audio: string, onEnded?: () => void) => {
    try {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const arrayBuffer = base64Decode(base64Audio);
      if (arrayBuffer.byteLength % 2 !== 0) {
        console.warn("Audio buffer has odd byte length, trimming last byte");
      }
      
      const dataView = new DataView(arrayBuffer);
      const length = Math.floor(arrayBuffer.byteLength / 2);
      const float32Data = new Float32Array(length);
      
      for (let i = 0; i < length; i++) {
          const sample = dataView.getInt16(i * 2, true);
          float32Data[i] = sample / 32768.0;
      }

      const buffer = ctx.createBuffer(1, float32Data.length, OUTPUT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32Data);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      
      if (analyserRef.current) {
          source.connect(analyserRef.current);
      } else {
          source.connect(ctx.destination);
      }

      source.onended = () => {
          if (onEnded) onEnded();
      };
      
      setIsSpeaking(true);
      
      const currentTime = ctx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }
      
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;
      
    } catch (err) {
      console.error("Error playing audio chunk:", err);
      setIsSpeaking(false);
      if (onEnded) onEnded();
    }
  };

  const disconnect = () => {
    setConnected(false);
    setIsSpeaking(false);
    setCurrentMood(MOODS.NEUTRAL);
    setStatus("Cat is sleeping. 💤");

    if (sessionRef.current) {
        sessionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
    }
    if (inputContextRef.current) {
        inputContextRef.current.close();
        inputContextRef.current = null;
    }
    
    if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
    }

    nextStartTimeRef.current = 0;
    if (analysisFrameRef.current) cancelAnimationFrame(analysisFrameRef.current);
  };

  const handleInstallClick = () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult: any) => {
            if (choiceResult.outcome === 'accepted') {
                setDeferredPrompt(null);
            }
        });
    } else {
        // iOS or manual flow
        setShowInstallHelp(true);
    }
  };

  const renderList = (items: HistoryItem[], emptyMessage: string) => {
    if (items.length === 0) {
      return (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          color: '#aaa',
          fontStyle: 'italic',
          height: '100%'
        }}>
          <span style={{ fontSize: '40px', marginBottom: '10px', opacity: 0.3 }}>🐾</span>
          {emptyMessage}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '100px' }}>
        {items.map(item => (
          <div key={item.id} style={{
            backgroundColor: '#fff',
            padding: '16px',
            borderRadius: '16px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            border: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', color: '#333', marginBottom: '4px' }}>"{item.originalText}"</div>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#E65100', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{fontSize: '12px'}}>🐱</span> {item.catText}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    onClick={() => toggleFavorite(item)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '20px',
                      color: isFavorite(item.id) ? '#FFB300' : '#E0E0E0',
                      padding: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                >
                    {isFavorite(item.id) ? '⭐' : '☆'}
                </button>
                <button
                    onClick={async () => {
                    await initAudioContext();
                    playAudioChunk(item.audioBase64, () => setIsSpeaking(false));
                    }}
                    style={{
                      background: '#FFF3E0',
                      color: '#E65100',
                      border: 'none',
                      borderRadius: '50%',
                      width: '40px',
                      height: '40px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '18px',
                    }}
                >
                    🔊
                </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ------------------------------------
  // RENDER: LAUNCH PAGE
  // ------------------------------------
  if (!hasLaunched) {
    return (
      <div style={{ 
        height: '100vh', 
        width: '100%', 
        backgroundColor: '#FFF8F0', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {showInstallHelp && <InstallHelpModal onClose={() => setShowInstallHelp(false)} />}
        
        <div style={{ 
            fontSize: '100px', 
            marginBottom: '20px', 
            animation: 'bounce 2s infinite',
            filter: 'drop-shadow(0 10px 10px rgba(0,0,0,0.1))' 
        }}>🐱</div>
        
        <h1 style={{ 
            color: '#5D4037', 
            marginBottom: '10px', 
            textAlign: 'center', 
            fontSize: '32px',
            fontWeight: '800'
        }}>Cat Translator</h1>
        
        <p style={{ 
            color: '#8D6E63', 
            textAlign: 'center', 
            marginBottom: '50px', 
            maxWidth: '300px',
            fontSize: '16px',
            lineHeight: '1.5'
        }}>
            Talk to your furry friend in their own language! Install the app for the best experience.
        </p>
        
        <button 
            onClick={handleInstallClick}
            style={{
                backgroundColor: '#FF9800',
                color: 'white',
                border: 'none',
                padding: '16px 32px',
                borderRadius: '30px',
                fontSize: '18px',
                fontWeight: 'bold',
                marginBottom: '16px',
                width: '100%',
                maxWidth: '280px',
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(255, 152, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'transform 0.1s'
            }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.96)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
        >
           {isIOS ? 'Install on iPhone' : 'Install App'} 📱
        </button>

        <button 
            onClick={() => setHasLaunched(true)}
            style={{
                backgroundColor: 'transparent',
                color: '#8D6E63',
                border: '2px solid #D7CCC8',
                padding: '14px 32px',
                borderRadius: '30px',
                fontSize: '16px',
                fontWeight: '600',
                width: '100%',
                maxWidth: '280px',
                cursor: 'pointer',
                marginTop: '10px'
            }}
        >
            Start
        </button>

        <style>{`
          @keyframes bounce {
            0%, 20%, 50%, 80%, 100% {transform: translateY(0);}
            40% {transform: translateY(-20px);}
            60% {transform: translateY(-10px);}
          }
        `}</style>
      </div>
    );
  }

  // ------------------------------------
  // RENDER: MAIN APP
  // ------------------------------------
  return (
    <div style={{
      height: '100vh',
      width: '100%',
      maxWidth: '500px', // Limit width on desktop
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#FFF8F0',
      position: 'relative',
      boxShadow: '0 0 20px rgba(0,0,0,0.05)',
      overflow: 'hidden'
    }}>
      {/* Install Help Modal */}
      {showInstallHelp && <InstallHelpModal onClose={() => setShowInstallHelp(false)} />}
      
      {/* Voice Selection Modal */}
      {showVoiceModal && (
        <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={() => setShowVoiceModal(false)}>
            <div style={{
                backgroundColor: 'white', padding: '25px', borderRadius: '24px',
                width: '100%', maxWidth: '320px', maxHeight: '80vh', overflowY: 'auto',
                boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }} onClick={e => e.stopPropagation()}>
                <h3 style={{marginTop: 0, color: '#5D4037', textAlign: 'center'}}>Choose Voice 🗣️</h3>
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px'}}>
                    {VOICES.map(voice => (
                        <button
                            key={voice.name}
                            onClick={() => { setSelectedVoice(voice.name); setShowVoiceModal(false); }}
                            style={{
                                padding: '12px', borderRadius: '16px', border: 'none',
                                backgroundColor: selectedVoice === voice.name ? '#FF9800' : '#F5F5F5',
                                color: selectedVoice === voice.name ? 'white' : '#5D4037',
                                fontWeight: '600', cursor: 'pointer',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px'
                            }}
                        >
                            <span style={{fontSize: '24px'}}>{voice.label.split(' ')[1]}</span>
                            <span style={{fontSize: '14px'}}>{voice.label.split(' ')[0]}</span>
                        </button>
                    ))}
                </div>
                <button onClick={() => setShowVoiceModal(false)} style={{
                    width: '100%', padding: '15px', marginTop: '20px',
                    backgroundColor: '#eee', border: 'none', borderRadius: '12px',
                    fontWeight: 'bold', color: '#666', cursor: 'pointer'
                }}>Close</button>
            </div>
        </div>
      )}

      {/* --- Top Section: Avatar & Status --- */}
      <div style={{
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 'calc(var(--sat) + 20px)', // Safe area top
        paddingBottom: '10px',
        position: 'relative',
        zIndex: 10
      }}>
        {/* Header */}
        <div style={{ 
          width: '100%', 
          padding: '0 20px', 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px'
        }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#5D4037' }}>Cat Translator</h1>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setShowVoiceModal(true)} style={{
                background: 'white', border: 'none', borderRadius: '20px',
                padding: '4px 12px', color: '#8D6E63', fontWeight: 'bold',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '5px', height: '32px'
            }}>
                🗣️ Voice
            </button>
            <div style={{
                backgroundColor: currentMood.color,
                borderRadius: '20px',
                padding: '4px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'white',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
            }}>
                <span>{currentMood.emoji}</span>
                <span>{currentMood.label}</span>
            </div>
            
            <button onClick={() => setShowInstallHelp(true)} style={{
                background: 'white',
                border: 'none',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8D6E63',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            }}>?</button>
          </div>
        </div>

        {/* Avatar Container */}
        <div style={{
          position: 'relative',
          width: '160px',
          height: '160px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '10px 0'
        }}>
          {/* Pulse Effect */}
          {(connected || isSpeaking) && (
            <div style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: isSpeaking ? 'rgba(255, 167, 38, 0.3)' : 'rgba(33, 150, 243, 0.15)',
              animation: 'pulse 2s infinite',
            }} />
          )}
          
          {/* Cat SVG Avatar */}
          <div style={{
            width: '100%',
            height: '100%',
            zIndex: 2,
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))',
            transformOrigin: 'center bottom',
            animation: isSpeaking 
              ? 'speaking 0.4s infinite alternate ease-in-out' 
              : isGeneratingText 
                ? 'typing 0.6s infinite ease-in-out' 
                : connected 
                  ? 'purring 3s infinite ease-in-out'
                  : 'none'
          }}>
            <CatAvatar isSpeaking={isSpeaking} mood={currentMood} />
          </div>

          {/* Thinking Bubbles */}
          {isGeneratingText && (
            <div style={{
              position: 'absolute',
              top: '0',
              right: '10px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '6px 10px',
              display: 'flex',
              gap: '3px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
              zIndex: 5,
              animation: 'popIn 0.3s ease-out'
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: '5px',
                  height: '5px',
                  background: '#888',
                  borderRadius: '50%',
                  animation: 'bounce 1s infinite',
                  animationDelay: `${i * 0.1}s`
                }} />
              ))}
            </div>
          )}
        </div>

        {/* Status Text */}
        <div style={{ 
          fontSize: '14px', 
          color: '#8D6E63', 
          fontWeight: '500',
          height: '20px',
          display: 'flex',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          {isSpeaking ? `Cat is ${currentMood.label}...` : status}
        </div>
      </div>

      {/* --- Middle Section: Content Sheet --- */}
      <div style={{
        flex: '1 1 auto',
        backgroundColor: '#fff',
        borderTopLeftRadius: '30px',
        borderTopRightRadius: '30px',
        boxShadow: '0 -5px 20px rgba(0,0,0,0.03)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 20px'
        }}>
          {['recent', 'favorites'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              style={{
                flex: 1,
                padding: '15px 0',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #FF9800' : '3px solid transparent',
                color: activeTab === tab ? '#E65100' : '#BDBDBD',
                fontWeight: '700',
                fontSize: '14px',
                textTransform: 'capitalize',
                transition: 'all 0.2s'
              }}
            >
              {tab === 'recent' ? 'Recent Meows' : 'Favorites'}
            </button>
          ))}
          
           {activeTab === 'recent' && history.length > 0 && (
                <button 
                  onClick={clearRecent} 
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent', 
                    border: 'none', 
                    color: '#999', 
                    fontSize: '12px', 
                    cursor: 'pointer', 
                    textDecoration: 'underline'
                  }}
                >
                  Clear All
                </button>
              )}
        </div>

        {/* Scrollable List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          paddingBottom: '180px', // Space for bottom bar + padding
        }}>
          {activeTab === 'recent' 
            ? renderList(history, "Start chatting to see translations!")
            : renderList(favorites, "Tap the star to save your favorite meows.")
          }
          <div ref={listEndRef} />
        </div>
      </div>

      {/* --- Bottom Section: Fixed Controls --- */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: '100%',
        background: 'linear-gradient(to top, rgba(255,255,255,1) 85%, rgba(255,255,255,0))',
        padding: '20px',
        paddingTop: '40px',
        paddingBottom: 'calc(var(--sab) + 20px)', // Safe area bottom
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '15px',
        zIndex: 50,
        pointerEvents: 'none' // Let clicks pass through the gradient area
      }}>
        
        {/* Floating Action Button (Mic) */}
        <button
          onClick={connected ? disconnect : startSession}
          disabled={isGeneratingText}
          style={{
            pointerEvents: 'auto',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: 'none',
            background: connected ? '#f44336' : '#FF9800',
            color: 'white',
            boxShadow: '0 6px 16px rgba(0,0,0,0.2)',
            fontSize: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.2s, background 0.3s',
            marginBottom: '-32px', // Pull it down into the bar slightly
            zIndex: 60,
            transform: isGeneratingText ? 'scale(0.8)' : 'scale(1)',
            opacity: isGeneratingText ? 0.5 : 1
          }}
        >
          {connected ? '🛑' : '🎙️'}
        </button>

        {/* Input Bar */}
        <div style={{
          pointerEvents: 'auto',
          width: '100%',
          backgroundColor: '#fff',
          borderRadius: '35px',
          padding: '8px 8px 8px 20px',
          display: 'flex',
          alignItems: 'center',
          boxShadow: '0 5px 20px rgba(0,0,0,0.08)',
          border: '1px solid #eee',
          gap: '10px'
        }}>
          <form 
            onSubmit={handleTextTranslate}
            style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '8px' }}
          >
            <input 
                type="text" 
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type something..."
                disabled={isGeneratingText}
                style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    fontSize: '16px',
                    color: '#333',
                    background: 'transparent'
                }}
            />
            <button 
              type="submit"
              disabled={isGeneratingText || !textInput.trim()}
              style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  border: 'none',
                  background: (!textInput.trim() || isGeneratingText) ? '#f0f0f0' : '#42A5F5',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  fontSize: '18px'
              }}
            >
                ➤
            </button>
          </form>
        </div>
      </div>

      <style>{`
        /* Hide scrollbar for Chrome, Safari and Opera */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          50% { transform: scale(1.1); opacity: 0.3; }
          100% { transform: scale(0.95); opacity: 0.7; }
        }
        @keyframes popIn {
            0% { transform: scale(0); }
            100% { transform: scale(1); }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
        @keyframes typing {
          0% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-6px) scale(1.05); }
          100% { transform: translateY(0) scale(1); }
        }
        /* More subtle animations for the new avatar */
        @keyframes speaking {
          0% { transform: scale(1) translateY(0); }
          100% { transform: scale(1.03) translateY(-2px); }
        }
        @keyframes purring {
          0% { transform: scale(1) translateY(0); }
          50% { transform: scale(1.01) translateY(1px); }
          100% { transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);