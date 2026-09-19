/* src/App.js */
import React, { useState, useEffect, useRef, useCallback } from "react";
import "./app.css";

const API = "http://localhost:3001";

const EMOTIONS = ["angry","cheerful","happy","neutral","serious","shy"];

const SOURCE_LABELS = {
  database:     "Database",
  suggestion:   "Suggestion",
  gemini:       "AI Assist",
  rate_limited: "Throttled",
  error:        "Error",
  filter:       "Filtered",
  none:         "No Match",
};

const SOURCE_STATUS = {
  database:     "Searching database...",
  suggestion:   "Finding closest matches...",
  gemini:       "Asking assistant...",
  rate_limited: "Assistant is busy",
  error:        "Assistant unavailable",
  filter:       "Inappropriate content",
  none:         "No match found",
};

function useProgress(active) {
  const [pct, setPct] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);

  useEffect(() => {
    if (active) {
      setPct(0);
      startRef.current = Date.now();
      const SLOW_TARGET = 80;
      const SLOW_MS = 8000;

      const tick = () => {
        const elapsed = Date.now() - startRef.current;
        const p = Math.min(SLOW_TARGET, (elapsed / SLOW_MS) * SLOW_TARGET);
        setPct(p);
        if (p < SLOW_TARGET) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
      setPct((prev) => {
        if (prev > 0) {
          setTimeout(() => setPct(0), 400);
          return 100;
        }
        return 0;
      });
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);

  return pct;
}

function TypingText({ text, speed = 18, onDone }) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed("");
    const tick = () => {
      indexRef.current += 1;
      setDisplayed(text.slice(0, indexRef.current));
      if (indexRef.current < text.length) {
        timerRef.current = setTimeout(tick, speed);
      } else {
        if (onDone) onDone();
      }
    };
    timerRef.current = setTimeout(tick, speed);
    return () => clearTimeout(timerRef.current);
  }, [text, speed, onDone]);

  const done = displayed.length === text.length;
  return (
    <span>
      {displayed}
      {!done && <span className="typing-cursor" aria-hidden="true" />}
    </span>
  );
}

function EmotionAvatar({ emotion }) {
  const src = `/src/assets/${emotion}.svg`;
  return (
    <div className="emotion-avatar">
      <img src={src} alt={emotion} />
    </div>
  );
}

function SourceBadge({ source }) {
  return (
    <span className={`source-badge badge-${source}`}>
      {SOURCE_LABELS[source] || source}
    </span>
  );
}

function StatusIndicator({ source }) {
  if (!source) return null;
  return (
    <span className={`status-indicator status-${source}`}>
      <span aria-hidden="true">●</span>
      {SOURCE_STATUS[source] || source}
    </span>
  );
}

export default function App({ theme, toggleTheme }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [typingDone, setTypingDone] = useState(true);
  const [pendingSource, setPendingSource] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const progress = useProgress(loading);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const preloadEmotions = useCallback(() => {
    EMOTIONS.forEach((e) => {
      const img = new Image();
      img.src = `/src/assets/${e}.svg`;
    });
  }, []);

  useEffect(() => { preloadEmotions(); }, [preloadEmotions]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !typingDone) return;

    const userMsg = { role: "user", text, id: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setTypingDone(false);
    setPendingSource(null);

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setPendingSource(data.source);
      const botMsg = {
        role: "bot",
        text: data.response,
        emotion: data.emotion || "neutral",
        source: data.source,
        score: data.score,
        id: Date.now() + 1,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setPendingSource("error");
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: "Maaf, terjadi kesalahan koneksi. Coba lagi sebentar.",
          emotion: "shy",
          source: "error",
          id: Date.now() + 1,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, typingDone]);

  const onKey = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const disabled = loading || !typingDone;

  return (
    <div className="chat-root">
      {/* progress bar */}
      {(loading || progress > 0) && (
        <div className="progress-bar-wrap" role="progressbar" aria-label="Loading">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* top-right controls */}
      <div className="chat-admin-link">
        <button
          className="btn-theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle tema"
          title={theme === "dark" ? "Switch to Light" : "Switch to Dark"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <a href="#/admin" className="btn-admin-nav" aria-label="Buka admin panel">
          ADMIN
        </a>
      </div>

      {/* chat area */}
      <div className="chat-area" role="log" aria-label="Percakapan">
        <div className="chat-area-inner">
          {messages.length === 0 && (
            <div className="chat-welcome">
              <img
                src="/chat_p.png"
                alt="Chatbot Mentoring UMN"
                className="chat-welcome-logo"
              />
              <h1 className="chat-welcome-title">Halo, Maba UMN! 👋</h1>
              <p className="chat-welcome-sub">
                Tanyakan apa saja seputar kegiatan mentoring, jadwal, dan info
                kampus. Saya siap membantu.
              </p>
            </div>
          )}

          {messages.map((msg, idx) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="msg-row user">
                  <div className="bubble-user">{msg.text}</div>
                </div>
              );
            }

            const isLast = idx === messages.length - 1;
            return (
              <div key={msg.id} className="msg-row bot">
                <EmotionAvatar emotion={msg.emotion} />
                <div className="bot-content">
                  <div className="bubble-bot">
                    {isLast && !typingDone ? (
                      <TypingText
                        text={msg.text}
                        speed={18}
                        onDone={() => {
                          setTypingDone(true);
                          setPendingSource(null);
                          setTimeout(() => inputRef.current?.focus(), 50);
                        }}
                      />
                    ) : (
                      msg.text
                    )}
                  </div>
                  <div className="bubble-meta">
                    <SourceBadge source={msg.source} />
                    {msg.score != null && msg.score > 0 && (
                      <span className="score-text">
                        {(msg.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* loading bubble */}
          {loading && (
            <div className="msg-row bot">
              <EmotionAvatar emotion="neutral" />
              <div className="bot-content">
                <div className="bubble-bot">
                  <div className="loading-dots" aria-label="Memproses...">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* input area */}
      <div className="chat-input-wrap">
        <div className="chat-input-inner">
          <div className="chat-status-bar">
            {(loading || (pendingSource && !typingDone)) && (
              <StatusIndicator source={loading ? null : pendingSource} />
            )}
            {loading && (
              <StatusIndicator source="database" />
            )}
          </div>
          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Tulis pertanyaanmu di sini..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={disabled}
              rows={1}
              aria-label="Input pesan"
            />
            <button
              className="chat-send-btn"
              onClick={send}
              disabled={disabled || !input.trim()}
              aria-label="Kirim pesan"
              title="Kirim (Enter)"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}