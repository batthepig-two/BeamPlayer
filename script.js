(function () {
  "use strict";

  /* ═══════════════════════════════════════
     CONSTANTS & STATE
  ═══════════════════════════════════════ */
  const STORAGE_KEY = "yt2_history";
  const SESSION_KEY = "yt2_session";
  const QUEUE_KEY   = "yt2_queue";
  const PREFS_KEY   = "yt2_prefs";
  const MAX_HISTORY = 100;
  const SAVE_DELAY  = 4000;

  let currentSession     = null;
  let progressSaveTimer  = null;
  let progressInterval   = null;
  let ytPlayer           = null;
  let ytApiReady         = false;
  let pendingLoad        = null;
  let currentFilter      = "";
  let currentSort        = "recent";
  let currentView        = "grid";
  let theaterMode        = false;
  let kbHintShown        = false;

  /* ═══════════════════════════════════════
     YOUTUBE IFRAME API — official SDK
     onYouTubeIframeAPIReady is called by youtube.com/iframe_api
     once the script finishes loading.
  ═══════════════════════════════════════ */
  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (pendingLoad) { pendingLoad(); pendingLoad = null; }
  };

  function startProgressPolling() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!ytPlayer || !currentSession) return;
      try {
        const t  = ytPlayer.getCurrentTime();
        const d  = ytPlayer.getDuration();
        const vd = ytPlayer.getVideoData();
        const id = vd && vd.video_id;
        if (id && activeUrlText)
          activeUrlText.textContent = `https://www.youtube.com/watch?v=${id}`;
        if (typeof t === "number" && t > 5) {
          currentSession.seconds = Math.floor(t);
          if (id) currentSession.resumeVideoId = id;
          if (typeof d === "number" && d > 0) currentSession.duration = Math.floor(d);
          scheduleProgressSave();
        }
      } catch (_) {}
    }, 2000);
  }

  function stopProgressPolling() {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  /* ═══════════════════════════════════════
     DOM REFS
  ═══════════════════════════════════════ */
  const urlInput          = document.getElementById("urlInput");
  const loadBtn           = document.getElementById("loadBtn");
  const clearBtn          = document.getElementById("clearBtn");
  const emptyState        = document.getElementById("emptyState");
  const playerWrapper     = document.getElementById("playerWrapper");
  // #playerIframe div is managed by YT.Player (string ID passed at creation)
  const channelTip        = document.getElementById("channelTip");
  const activeUrlBar      = document.getElementById("activeUrlBar");
  const activeUrlText     = document.getElementById("activeUrlText");
  const playerToolbar     = document.getElementById("playerToolbar");
  const theaterBtn        = document.getElementById("theaterBtn");
  const theaterExitBtn    = document.getElementById("theaterExitBtn");
  const queueAddCurrentBtn= document.getElementById("queueAddCurrentBtn");
  const copyUrlBtn        = document.getElementById("copyUrlBtn");
  const historySection    = document.getElementById("historySection");
  const historyGrid       = document.getElementById("historyGrid");
  const historyCount      = document.getElementById("historyCount");
  const historySearch     = document.getElementById("historySearch");
  const historySort       = document.getElementById("historySort");
  const viewGridBtn       = document.getElementById("viewGridBtn");
  const viewListBtn       = document.getElementById("viewListBtn");
  const exportBtn         = document.getElementById("exportBtn");
  const importBtn         = document.getElementById("importBtn");
  const importFile        = document.getElementById("importFile");
  const historyEmptyFilter= document.getElementById("historyEmptyFilter");
  const queueSection      = document.getElementById("queueSection");
  const queueList         = document.getElementById("queueList");
  const queueCountBadge   = document.getElementById("queueCountBadge");
  const playNextBtn       = document.getElementById("playNextBtn");
  const clearQueueBtn     = document.getElementById("clearQueueBtn");
  const queueInput        = document.getElementById("queueInput");
  const queueAddBtn       = document.getElementById("queueAddBtn");
  const kbHint            = document.getElementById("kbHint");
  const kbHintClose       = document.getElementById("kbHintClose");

  /* ═══════════════════════════════════════
     TOAST
  ═══════════════════════════════════════ */
  let toastTimer;
  const toast = document.createElement("div");
  toast.className = "toast";
  document.body.appendChild(toast);

  function showToast(msg, duration) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration || 3500);
  }

  /* ═══════════════════════════════════════
     FORMAT HELPERS
  ═══════════════════════════════════════ */
  function fmtDuration(totalSeconds) {
    const s   = Math.floor(totalSeconds);
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
    return `${m}:${String(sec).padStart(2,"0")}`;
  }

  function formatRelTime(ts) {
    const diff    = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    const hours   = Math.floor(diff / 3600000);
    const days    = Math.floor(diff / 86400000);
    if (minutes < 1)  return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24)   return `${hours}h ago`;
    if (days < 30)    return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  /* ═══════════════════════════════════════
     URL PARSING
  ═══════════════════════════════════════ */
  function parseYouTubeUrl(raw) {
    const url = raw.trim();
    if (!url) return null;
    let p;
    try { p = new URL(url); } catch { return null; }
    const host = p.hostname.replace(/^www\./, "");

    const shorts = p.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    if (shorts) return { type: "video", id: shorts[1] };

    if ((host === "youtube.com" || host === "m.youtube.com") && p.searchParams.has("v")) {
      const id = p.searchParams.get("v");
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return { type: "video", id };
    }

    if (host === "youtu.be") {
      const id = p.pathname.slice(1).split("?")[0].split("/")[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return { type: "video", id };
    }

    const emb = p.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    if (emb) return { type: "video", id: emb[1] };

    const ch = p.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
    if (ch) return { type: "channel", channelId: ch[1], playlistId: "UU" + ch[1].slice(2) };

    if (host === "youtube.com" &&
        (p.pathname.startsWith("/@") || p.pathname.startsWith("/c/") ||
         p.pathname.startsWith("/user/") || /^\/[A-Za-z0-9_-]+$/.test(p.pathname))) {
      return { type: "handle_unsupported", url };
    }
    return null;
  }

  /* ═══════════════════════════════════════
     PROGRESS TRACKING
  ═══════════════════════════════════════ */
  function saveProgress() {
    if (!currentSession || currentSession.seconds < 5) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
    const history = loadHistory();
    const idx = history.findIndex(i => i.url === currentSession.originalUrl);
    if (idx !== -1) {
      history[idx].progress = {
        seconds:       currentSession.seconds,
        duration:      currentSession.duration || 0,
        resumeVideoId: currentSession.resumeVideoId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      renderHistory();
    }
  }

  function scheduleProgressSave() {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(saveProgress, SAVE_DELAY);
  }


  /* ═══════════════════════════════════════
     HANDLE ERROR MODAL
  ═══════════════════════════════════════ */
  function showHandleError() {
    document.getElementById("handleErrorModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "handleErrorModal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-box">
        <button class="modal-close" id="modalClose">✕</button>
        <div class="modal-icon">📋</div>
        <h3 class="modal-title">Channel Handle Can't Be Auto-Resolved</h3>
        <p class="modal-body">Links like <code>youtube.com/Syntac</code> or <code>youtube.com/@Handle</code> require a server to look up the real Channel ID — not possible on a static site.</p>
        <p class="modal-body">To get the embeddable channel link:</p>
        <ol class="modal-steps">
          <li>Go to the channel on YouTube</li>
          <li>Click any video to open it</li>
          <li>Click the <strong>channel name</strong> under the video to go to their channel page</li>
          <li>The URL bar will now show <code>youtube.com/channel/UC…</code></li>
          <li>Copy that full URL and paste it here ✅</li>
        </ol>
        <p class="modal-tip">💡 Some channels show the <code>/channel/UC…</code> URL directly when you tap "Share Channel."</p>
        <button class="modal-btn" id="modalDismiss">Got it</button>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    document.getElementById("modalClose").addEventListener("click", close);
    document.getElementById("modalDismiss").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
  }

  /* ═══════════════════════════════════════
     THEATER MODE
  ═══════════════════════════════════════ */
  function setTheaterMode(on) {
    theaterMode = on;
    document.body.classList.toggle("theater-mode", on);
    theaterExitBtn.style.display = on ? "flex" : "none";
    theaterBtn.textContent = on ? "⛶ Exit Theater" : "⛶ Theater";
    savePrefs();
  }

  /* ═══════════════════════════════════════
     EMBED PLAYER — uses official YT IFrame API
     player.getCurrentTime() is polled every 2 s
     after the SDK calls onYouTubeIframeAPIReady.
  ═══════════════════════════════════════ */
  function embedPlayer(parsed, originalUrl, startSeconds) {
    startSeconds = startSeconds || 0;

    // If the YT SDK hasn't loaded yet, queue the call
    if (!ytApiReady) {
      pendingLoad = () => embedPlayer(parsed, originalUrl, startSeconds);
      return;
    }

    stopProgressPolling();

    // Show player UI
    emptyState.style.display    = "none";
    playerWrapper.style.display = "block";
    playerToolbar.style.display = "flex";
    channelTip.style.display    = parsed.type === "channel" ? "block" : "none";
    activeUrlBar.style.display  = "flex";
    activeUrlText.textContent   = originalUrl;

    const isChannel  = parsed.type === "channel";
    const videoId    = (!isChannel && parsed.id) ? parsed.id : "";
    const playlistId = isChannel ? (parsed.playlistId || "") : "";

    const playerVars = {
      autoplay:       1,
      rel:            0,
      modestbranding: 1,
      enablejsapi:    1,
      origin:         window.location.origin,
    };
    if (startSeconds > 5) playerVars.start = Math.floor(startSeconds);

    const onStateChange = (e) => {
      try {
        const vd = ytPlayer.getVideoData();
        if (vd && vd.video_id && activeUrlText)
          activeUrlText.textContent = `https://www.youtube.com/watch?v=${vd.video_id}`;
      } catch (_) {}
      // Auto-play next queue item when video ends
      if (e.data === 0) {
        const queue = loadQueue();
        if (queue.length > 0) {
          const next = queue.shift();
          saveQueue(queue);
          renderQueue();
          setTimeout(() => loadUrl(next), 800);
        }
      }
    };

    if (ytPlayer) {
      // Reuse existing player instance
      if (isChannel) {
        ytPlayer.loadPlaylist({ listType: "playlist", list: playlistId });
      } else {
        ytPlayer.loadVideoById({ videoId, startSeconds: startSeconds > 5 ? startSeconds : 0 });
      }
      startProgressPolling();
    } else {
      // Create player on the #playerIframe div for the first time
      if (isChannel) {
        playerVars.listType = "playlist";
        playerVars.list     = playlistId;
      }
      ytPlayer = new YT.Player("playerIframe", {
        videoId,
        playerVars,
        host: "https://www.youtube-nocookie.com",
        events: {
          onReady: (e) => {
            if (isChannel)
              e.target.loadPlaylist({ listType: "playlist", list: playlistId });
            startProgressPolling();
          },
          onStateChange,
        },
      });
    }

    currentSession = {
      originalUrl,
      type:          parsed.type,
      playlistId:    playlistId || null,
      resumeVideoId: videoId   || null,
      seconds:       startSeconds,
      duration:      0,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));

    saveHistory(originalUrl, parsed);
    renderHistory();
    urlInput.value = "";
  }

  /* ═══════════════════════════════════════
     LOAD URL (from input)
  ═══════════════════════════════════════ */
  function loadUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = parseYouTubeUrl(trimmed);
    if (!parsed) { showToast("⚠️ Couldn't recognise that URL. Try a YouTube video, Shorts, or /channel/UC… link."); return; }
    if (parsed.type === "handle_unsupported") { showHandleError(); return; }
    embedPlayer(parsed, trimmed, 0);
  }

  /* ═══════════════════════════════════════
     LOAD FROM HISTORY (with resume)
  ═══════════════════════════════════════ */
  function loadFromHistory(item) {
    const p = item.progress;
    if (p && p.seconds > 5 && p.resumeVideoId) {
      embedPlayer({ type: "video", id: p.resumeVideoId }, item.url, p.seconds);
    } else {
      const parsed = parseYouTubeUrl(item.url);
      if (parsed && parsed.type !== "handle_unsupported") embedPlayer(parsed, item.url, 0);
    }
  }

  /* ═══════════════════════════════════════
     LOCAL STORAGE — HISTORY
  ═══════════════════════════════════════ */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }

  function saveHistory(url, parsed) {
    let history  = loadHistory();
    const exists = history.find(i => i.url === url);
    history = history.filter(i => i.url !== url);
    history.unshift({
      url,
      type:       parsed.type,
      videoId:    parsed.id || null,
      timestamp:  exists ? exists.timestamp : Date.now(),
      watchCount: (exists?.watchCount || 0) + 1,
      favorited:  exists?.favorited  || false,
      watched:    exists?.watched    || false,
      progress:   exists?.progress   || null,
    });
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }

  function updateHistoryItem(url, patch) {
    const history = loadHistory();
    const idx = history.findIndex(i => i.url === url);
    if (idx === -1) return;
    Object.assign(history[idx], patch);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    renderHistory();
  }

  function deleteHistoryItem(url) {
    const history = loadHistory().filter(i => i.url !== url);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    if (currentSession?.originalUrl === url) localStorage.removeItem(SESSION_KEY);
    renderHistory();
  }

  function clearHistory() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_KEY);
    currentSession = null;
    renderHistory();
  }

  /* ═══════════════════════════════════════
     LOCAL STORAGE — QUEUE
  ═══════════════════════════════════════ */
  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
  }

  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  function addToQueue(url) {
    const q = loadQueue();
    if (q.includes(url)) { showToast("Already in queue."); return; }
    q.push(url);
    saveQueue(q);
    renderQueue();
    showToast("Added to queue ✓");
  }

  function removeFromQueue(url) {
    saveQueue(loadQueue().filter(u => u !== url));
    renderQueue();
  }

  /* ═══════════════════════════════════════
     LOCAL STORAGE — PREFS
  ═══════════════════════════════════════ */
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: currentSort, view: currentView, theaterMode, kbHintShown }));
  }

  /* ═══════════════════════════════════════
     EXPORT / IMPORT
  ═══════════════════════════════════════ */
  function exportHistory() {
    const history = loadHistory();
    if (!history.length) { showToast("Nothing to export."); return; }
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `beamplayer-history-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(`Exported ${history.length} items ✓`);
  }

  function importHistory(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        const existing = loadHistory();
        const merged   = [...imported];
        existing.forEach(item => {
          if (!merged.find(m => m.url === item.url)) merged.push(item);
        });
        merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.slice(0, MAX_HISTORY)));
        renderHistory();
        showToast(`Imported ${imported.length} items ✓`);
      } catch {
        showToast("Invalid file. Must be a BeamPlayer history export.");
      }
    };
    reader.readAsText(file);
  }

  /* ═══════════════════════════════════════
     COPY URL
  ═══════════════════════════════════════ */
  function copyCurrentUrl() {
    const url = activeUrlText.textContent;
    if (!url) return;
    navigator.clipboard.writeText(url)
      .then(() => showToast("Copied to clipboard ✓"))
      .catch(() => { /* fallback */ });
  }

  /* ═══════════════════════════════════════
     RENDER QUEUE
  ═══════════════════════════════════════ */
  function renderQueue() {
    const q = loadQueue();
    queueSection.style.display    = q.length > 0 ? "block" : "none";
    queueCountBadge.textContent   = q.length > 0 ? `${q.length}` : "";

    queueList.innerHTML = "";
    q.forEach((url, idx) => {
      const row = document.createElement("div");
      row.className = "queue-item";
      const short = url.replace(/^https?:\/\/(www\.)?youtube\.com/, "").replace(/^https?:\/\/youtu\.be/, "/s");
      row.innerHTML = `
        <span class="queue-item-num">${idx + 1}</span>
        <span class="queue-item-url" title="${url}">${short}</span>
        <button class="queue-item-play" data-url="${url}" title="Play now">▶</button>
        <button class="queue-item-remove" data-url="${url}" title="Remove">✕</button>
      `;
      row.querySelector(".queue-item-play").addEventListener("click", () => {
        removeFromQueue(url);
        loadUrl(url);
      });
      row.querySelector(".queue-item-remove").addEventListener("click", () => removeFromQueue(url));
      queueList.appendChild(row);
    });
  }

  /* ═══════════════════════════════════════
     RENDER HISTORY
  ═══════════════════════════════════════ */
  function getSortedFilteredHistory() {
    let history = loadHistory();

    // Filter
    if (currentFilter) {
      const f = currentFilter.toLowerCase();
      history = history.filter(i => i.url.toLowerCase().includes(f));
    }

    // Sort
    switch (currentSort) {
      case "oldest":     history.sort((a,b) => a.timestamp - b.timestamp); break;
      case "watchCount": history.sort((a,b) => (b.watchCount||0) - (a.watchCount||0)); break;
      case "progress":   history.sort((a,b) => ((b.progress?.seconds||0) - (a.progress?.seconds||0))); break;
      case "favorites":  history.sort((a,b) => (b.favorited?1:0) - (a.favorited?1:0)); break;
      default:           history.sort((a,b) => b.timestamp - a.timestamp); break;
    }
    return history;
  }

  function renderHistory() {
    const history = getSortedFilteredHistory();
    const all     = loadHistory();

    if (all.length === 0) {
      historySection.style.display = "none";
      return;
    }

    historySection.style.display = "block";
    historyCount.textContent = `${all.length} item${all.length !== 1 ? "s" : ""}`;

    if (history.length === 0 && currentFilter) {
      historyGrid.innerHTML = "";
      historyEmptyFilter.style.display = "block";
      return;
    }
    historyEmptyFilter.style.display = "none";

    historyGrid.className = currentView === "list" ? "history-grid list-view" : "history-grid";
    historyGrid.innerHTML = "";

    history.forEach(item => {
      const thumb       = item.videoId ? `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg` : null;
      const typeLabel   = item.type === "channel" ? "Channel" : "Video";
      const typeClass   = item.type === "channel" ? "channel" : "video";
      const shortUrl    = item.url
        .replace(/^https?:\/\/(www\.)?youtube\.com/, "")
        .replace(/^https?:\/\/youtu\.be/, "/s");

      const p           = item.progress;
      const hasProgress = p && p.seconds > 5;
      const progressPct = hasProgress && p.duration > 0
        ? Math.min(99, Math.round((p.seconds / p.duration) * 100)) : null;
      const progressLabel = hasProgress ? fmtDuration(p.seconds) : null;

      const card = document.createElement("div");
      card.className = `history-card${item.favorited ? " favorited" : ""}${item.watched ? " watched" : ""}`;

      card.innerHTML = `
        <div class="history-card-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="Thumbnail" loading="lazy"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
               <div class="thumb-fallback" style="display:none">▶</div>`
            : `<div class="thumb-fallback">📺</div>`}
          <div class="history-play-overlay"><div class="history-play-btn">▶</div></div>
          ${progressPct !== null ? `
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width:${progressPct}%"></div>
            </div>` : ""}
          ${item.watched ? `<div class="watched-badge">✓ Watched</div>` : ""}
        </div>
        <div class="history-card-body">
          <div class="history-card-meta-row">
            <span class="history-card-type ${typeClass}">${typeLabel}</span>
            <button class="card-action-btn fav-btn ${item.favorited ? "active" : ""}"
              data-url="${item.url}" title="${item.favorited ? "Unfavorite" : "Favorite"}">★</button>
            <button class="card-action-btn watch-btn ${item.watched ? "active" : ""}"
              data-url="${item.url}" title="${item.watched ? "Unmark watched" : "Mark as watched"}">✓</button>
          </div>
          <div class="history-card-url" title="${item.url}">${shortUrl}</div>
          <div class="history-card-bottom-row">
            ${progressLabel
              ? `<span class="history-card-progress">⏱ ${progressLabel}</span>`
              : `<span class="history-card-time">${formatRelTime(item.timestamp)}</span>`}
            ${item.watchCount > 1 ? `<span class="watch-count">▶ ×${item.watchCount}</span>` : ""}
          </div>
          <div class="card-action-row">
            ${hasProgress ? `<button class="card-link-btn reset-btn" data-url="${item.url}" title="Reset progress">↺ Reset progress</button>` : ""}
            <button class="card-link-btn queue-btn" data-url="${item.url}" title="Add to queue">+ Queue</button>
          </div>
        </div>
        <button class="history-card-delete" data-url="${item.url}" title="Remove from history">✕</button>
      `;

      // Play card
      card.addEventListener("click", e => {
        if (e.target.closest(".card-action-btn") || e.target.closest(".card-link-btn") ||
            e.target.closest(".history-card-delete")) return;
        loadFromHistory(item);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      // Favorite
      card.querySelector(".fav-btn").addEventListener("click", e => {
        e.stopPropagation();
        updateHistoryItem(item.url, { favorited: !item.favorited });
      });

      // Mark watched
      card.querySelector(".watch-btn").addEventListener("click", e => {
        e.stopPropagation();
        updateHistoryItem(item.url, { watched: !item.watched, progress: item.watched ? item.progress : null });
      });

      // Reset progress
      card.querySelector(".reset-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        updateHistoryItem(item.url, { progress: null });
        if (currentSession?.originalUrl === item.url) {
          localStorage.removeItem(SESSION_KEY);
          currentSession.seconds = 0;
        }
        showToast("Progress reset ✓");
      });

      // Add to queue
      card.querySelector(".queue-btn").addEventListener("click", e => {
        e.stopPropagation();
        addToQueue(item.url);
      });

      // Delete
      card.querySelector(".history-card-delete").addEventListener("click", e => {
        e.stopPropagation();
        deleteHistoryItem(item.url);
      });

      historyGrid.appendChild(card);
    });
  }

  /* ═══════════════════════════════════════
     RESTORE SESSION ON PAGE LOAD
  ═══════════════════════════════════════ */
  function restoreSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!s || !s.originalUrl || s.seconds < 5) return;
      const parsed = parseYouTubeUrl(s.originalUrl);
      if (!parsed || parsed.type === "handle_unsupported") return;
      if (s.resumeVideoId && s.seconds > 5) {
        embedPlayer({ type: "video", id: s.resumeVideoId }, s.originalUrl, s.seconds);
      } else {
        embedPlayer(parsed, s.originalUrl, s.seconds);
      }
    } catch (_) {}
  }

  /* ═══════════════════════════════════════
     SAMPLE LINKS
  ═══════════════════════════════════════ */
  document.querySelectorAll(".sample-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const u = link.dataset.url;
      if (u) { urlInput.value = u; loadUrl(u); }
    });
  });

  /* ═══════════════════════════════════════
     KEYBOARD SHORTCUTS
  ═══════════════════════════════════════ */
  document.addEventListener("keydown", e => {
    // Ctrl/Cmd+V anywhere (when not focused in an input) → paste & load
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      const active = document.activeElement;
      const isInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (!isInput) {
        navigator.clipboard.readText().then(text => {
          const t = text.trim();
          if (t.startsWith("http") && t.includes("youtube")) {
            urlInput.value = t;
            loadUrl(t);
          }
        }).catch(() => {});
      }
    }
    // Escape → close any open modal or exit theater
    if (e.key === "Escape") {
      document.querySelector(".modal-overlay")?.remove();
      if (theaterMode) setTheaterMode(false);
    }
  });

  /* ═══════════════════════════════════════
     WIRE UP CONTROLS
  ═══════════════════════════════════════ */

  // Load button
  loadBtn.addEventListener("click", () => {
    if (urlInput.value.trim()) loadUrl(urlInput.value);
    else showToast("Paste a YouTube URL first!");
  });

  urlInput.addEventListener("keydown", e => { if (e.key === "Enter") loadBtn.click(); });

  urlInput.addEventListener("paste", () => {
    setTimeout(() => { const v = urlInput.value.trim(); if (v.startsWith("http")) loadUrl(v); }, 50);
  });

  // Clear history
  clearBtn.addEventListener("click", () => {
    if (!loadHistory().length) return showToast("History is already empty.");
    clearHistory();
    showToast("History cleared.");
  });

  // Theater mode
  theaterBtn.addEventListener("click", () => setTheaterMode(!theaterMode));
  theaterExitBtn.addEventListener("click", () => setTheaterMode(false));

  // Copy URL
  copyUrlBtn.addEventListener("click", copyCurrentUrl);

  // Add current video to queue
  queueAddCurrentBtn.addEventListener("click", () => {
    const url = activeUrlText.textContent;
    if (url && url.startsWith("http")) addToQueue(url);
    else showToast("No video playing yet.");
  });

  // History search
  historySearch.addEventListener("input", () => {
    currentFilter = historySearch.value.trim();
    renderHistory();
  });

  // Sort
  historySort.addEventListener("change", () => {
    currentSort = historySort.value;
    savePrefs();
    renderHistory();
  });

  // View toggle
  viewGridBtn.addEventListener("click", () => {
    currentView = "grid";
    viewGridBtn.classList.add("active");
    viewListBtn.classList.remove("active");
    savePrefs();
    renderHistory();
  });
  viewListBtn.addEventListener("click", () => {
    currentView = "list";
    viewListBtn.classList.add("active");
    viewGridBtn.classList.remove("active");
    savePrefs();
    renderHistory();
  });

  // Export
  exportBtn.addEventListener("click", exportHistory);

  // Import
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", e => {
    if (e.target.files[0]) { importHistory(e.target.files[0]); e.target.value = ""; }
  });

  // Queue controls
  playNextBtn.addEventListener("click", () => {
    const q = loadQueue();
    if (!q.length) return showToast("Queue is empty.");
    const next = q.shift();
    saveQueue(q);
    renderQueue();
    loadUrl(next);
  });

  clearQueueBtn.addEventListener("click", () => {
    saveQueue([]);
    renderQueue();
    showToast("Queue cleared.");
  });

  queueAddBtn.addEventListener("click", () => {
    const v = queueInput.value.trim();
    if (v) { addToQueue(v); queueInput.value = ""; }
  });

  queueInput.addEventListener("keydown", e => { if (e.key === "Enter") queueAddBtn.click(); });

  // KB hint
  kbHintClose?.addEventListener("click", () => {
    kbHint.style.display = "none";
    kbHintShown = true;
    savePrefs();
  });

  // Save progress on tab hide/close
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveProgress();
  });
  window.addEventListener("pagehide", saveProgress);

  /* ═══════════════════════════════════════
     INIT
  ═══════════════════════════════════════ */
  (function init() {
    const prefs = loadPrefs();
    currentSort  = prefs.sort  || "recent";
    currentView  = prefs.view  || "grid";
    kbHintShown  = prefs.kbHintShown || false;

    historySort.value = currentSort;
    if (currentView === "list") {
      viewListBtn.classList.add("active");
      viewGridBtn.classList.remove("active");
    }

    renderHistory();
    renderQueue();
    restoreSession();

    // Show keyboard hint once for new users
    if (!kbHintShown && !loadHistory().length) {
      setTimeout(() => { if (kbHint) kbHint.style.display = "flex"; }, 2000);
    }
  })();

})();
