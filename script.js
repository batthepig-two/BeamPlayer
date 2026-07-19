(function () {
  "use strict";

  /* ═══════════════════════════════════════
     CONSTANTS & STATE
  ═══════════════════════════════════════ */
  const STORAGE_KEY    = "yt2_history";
  const SESSION_KEY    = "yt2_session";
  const QUEUE_KEY      = "yt2_queue";
  const PREFS_KEY      = "yt2_prefs";
  const PLAYLISTS_KEY  = "yt2_playlists";
  const TITLES_KEY     = "yt2_titles";
  const TITLE_TTL      = 7 * 24 * 60 * 60 * 1000; // 7 days
  const MAX_HISTORY    = 100;
  const SAVE_DELAY     = 4000;

  const YT_API_KEY_STORAGE = "yt2_api_key";
  const YT_SEARCH_URL      = "https://www.googleapis.com/youtube/v3/search";

  function getApiKey() { return localStorage.getItem(YT_API_KEY_STORAGE) || ""; }
  function saveApiKey(k) { localStorage.setItem(YT_API_KEY_STORAGE, k.trim()); }

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
  let currentPlaylistId  = null;
  let saveToPlaylistUrl  = null;
  let saveToPlaylistVid  = null;
  let importUrlsTarget   = null;  // playlist id for pending import

  /* ═══════════════════════════════════════
     YOUTUBE IFRAME API
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
  const urlInput           = document.getElementById("urlInput");
  const loadBtn            = document.getElementById("loadBtn");
  const clearBtn           = document.getElementById("clearBtn");
  const emptyState         = document.getElementById("emptyState");
  const playerWrapper      = document.getElementById("playerWrapper");
  const channelTip         = document.getElementById("channelTip");
  const activeUrlBar       = document.getElementById("activeUrlBar");
  const activeUrlText      = document.getElementById("activeUrlText");
  const playerToolbar      = document.getElementById("playerToolbar");
  const theaterBtn         = document.getElementById("theaterBtn");
  const theaterExitBtn     = document.getElementById("theaterExitBtn");
  const queueAddCurrentBtn = document.getElementById("queueAddCurrentBtn");
  const watchLaterBtn      = document.getElementById("watchLaterBtn");
  const saveToPlaylistBtn  = document.getElementById("saveToPlaylistBtn");
  const copyUrlBtn         = document.getElementById("copyUrlBtn");
  const historySection     = document.getElementById("historySection");
  const historyGrid        = document.getElementById("historyGrid");
  const historyCount       = document.getElementById("historyCount");
  const historySearch      = document.getElementById("historySearch");
  const historySort        = document.getElementById("historySort");
  const historyEmptyFilter = document.getElementById("historyEmptyFilter");
  const viewGridBtn        = document.getElementById("viewGridBtn");
  const viewListBtn        = document.getElementById("viewListBtn");
  const exportBtn          = document.getElementById("exportBtn");
  const importBtn          = document.getElementById("importBtn");
  const importFile         = document.getElementById("importFile");
  const queueSection       = document.getElementById("queueSection");
  const queueList          = document.getElementById("queueList");
  const queueCountBadge    = document.getElementById("queueCountBadge");
  const playNextBtn        = document.getElementById("playNextBtn");
  const clearQueueBtn      = document.getElementById("clearQueueBtn");
  const queueInput         = document.getElementById("queueInput");
  const queueAddBtn        = document.getElementById("queueAddBtn");
  const kbHint             = document.getElementById("kbHint");
  const kbHintClose        = document.getElementById("kbHintClose");
  const searchPanel        = document.getElementById("searchPanel");
  const searchBackdrop     = document.getElementById("searchBackdrop");
  const searchQueryLabel   = document.getElementById("searchQueryLabel");
  const searchResultsList  = document.getElementById("searchResultsList");
  const searchPanelClose   = document.getElementById("searchPanelClose");
  const toast              = (() => {
    const el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
    return el;
  })();
  let toastTimer = null;

  // Playlists DOM
  const playlistsNavBtn       = document.getElementById("playlistsNavBtn");
  const playlistsSection      = document.getElementById("playlistsSection");
  const playlistsGrid         = document.getElementById("playlistsGrid");
  const createPlaylistBtn     = document.getElementById("createPlaylistBtn");
  const playlistDetailSection = document.getElementById("playlistDetailSection");
  const playlistDetailTitle   = document.getElementById("playlistDetailTitle");
  const playlistDetailCount   = document.getElementById("playlistDetailCount");
  const playlistDetailList    = document.getElementById("playlistDetailList");
  const playlistBackBtn       = document.getElementById("playlistBackBtn");
  const playlistImportBtn     = document.getElementById("playlistImportBtn");
  const playlistPlayAllBtn    = document.getElementById("playlistPlayAllBtn");
  const playlistDeleteBtn     = document.getElementById("playlistDeleteBtn");

  // Modals
  const confirmClearModal    = document.getElementById("confirmClearModal");
  const confirmClearConfirm  = document.getElementById("confirmClearConfirm");
  const confirmClearCancel   = document.getElementById("confirmClearCancel");
  const saveToPlaylistModal  = document.getElementById("saveToPlaylistModal");
  const saveToPlaylistClose  = document.getElementById("saveToPlaylistClose");
  const saveToPlaylistList   = document.getElementById("saveToPlaylistList");
  const saveToPlaylistNew    = document.getElementById("saveToPlaylistNew");
  const importUrlsModal      = document.getElementById("importUrlsModal");
  const importUrlsClose      = document.getElementById("importUrlsClose");
  const importUrlsTextarea   = document.getElementById("importUrlsTextarea");
  const importUrlsConfirm    = document.getElementById("importUrlsConfirm");
  const createPlaylistModal  = document.getElementById("createPlaylistModal");
  const createPlaylistClose  = document.getElementById("createPlaylistClose");
  const createPlaylistName   = document.getElementById("createPlaylistName");
  const createPlaylistConfirm= document.getElementById("createPlaylistConfirm");

  /* ═══════════════════════════════════════
     TOAST
  ═══════════════════════════════════════ */
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
     SEARCH — YouTube Data API v3
  ═══════════════════════════════════════ */
  function fmtSeconds(s) {
    if (!s || s < 0) return "LIVE";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
    return `${m}:${String(sec).padStart(2,"0")}`;
  }

  function fmtViews(n) {
    if (!n) return "";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B views";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M views";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K views";
    return n + " views";
  }

  function openSearchPanel(items, query) {
    searchQueryLabel.textContent = query;
    searchResultsList.innerHTML  = "";

    const relevant = (items || []).filter(i => i.type === "stream" || i.type === "channel").slice(0, 25);
    if (!relevant.length) {
      searchResultsList.innerHTML = `<div class="search-status">No results found for "<strong>${query}</strong>".</div>`;
    } else {
      relevant.forEach(item => {
        const itemUrl = `https://www.youtube.com${item.url}`;
        const el = document.createElement("div");

        if (item.type === "channel") {
          el.className = "search-result search-result--channel";
          const subs   = item.subscribers > 0 ? fmtViews(item.subscribers).replace(" views", " subscribers") : "";
          const videos = item.videos > 0 ? `${item.videos} videos` : "";
          el.innerHTML = `
            <div class="search-result-thumb-wrap search-result-thumb-wrap--avatar">
              <img class="search-result-thumb search-result-thumb--avatar" src="${item.thumbnail || ""}" alt="" loading="lazy" />
            </div>
            <div class="search-result-info">
              <div class="search-result-badge">📺 Channel</div>
              <div class="search-result-title">${item.name || ""}</div>
              <div class="search-result-meta">
                ${subs   ? `<span>${subs}</span>`   : ""}
                ${videos ? `<span>${videos}</span>` : ""}
              </div>
              ${item.description ? `<div class="search-result-desc">${item.description.slice(0, 120)}…</div>` : ""}
            </div>`;
        } else {
          el.className = "search-result";
          el.innerHTML = `
            <div class="search-result-thumb-wrap">
              <img class="search-result-thumb" src="${item.thumbnail || ""}" alt="" loading="lazy" />
              <span class="search-result-dur">${fmtSeconds(item.duration)}</span>
            </div>
            <div class="search-result-info">
              <div class="search-result-title">${item.title || ""}</div>
              <div class="search-result-meta">
                <span class="search-result-channel">${item.uploaderName || ""}</span>
                ${item.views      ? `<span>${fmtViews(item.views)}</span>` : ""}
                ${item.uploadedDate ? `<span>${item.uploadedDate}</span>` : ""}
              </div>
              ${item.shortDescription
                ? `<div class="search-result-desc">${item.shortDescription.slice(0, 120)}…</div>`
                : ""}
            </div>`;
        }

        el.addEventListener("click", () => { closeSearchPanel(); loadUrl(itemUrl); });
        searchResultsList.appendChild(el);
      });
    }

    searchPanel.style.display    = "block";
    searchBackdrop.style.display = "block";
  }

  function closeSearchPanel() {
    searchPanel.style.display    = "none";
    searchBackdrop.style.display = "none";
  }

  function showApiKeyPrompt(query) {
    searchQueryLabel.textContent = query || "";
    const existingKey = getApiKey();
    searchResultsList.innerHTML = existingKey
      ? `<div class="search-status">
           <p style="margin-bottom:12px;color:var(--gray-300);">API key is already saved.</p>
           <button class="apikey-reenter-btn" id="reenterKeyBtn">Re-enter API key</button>
         </div>`
      : `<div style="padding:20px 16px;">
           <p style="font-size:13px;color:var(--gray-300);margin-bottom:14px;">
             YouTube search requires a free API key from Google Cloud Console.
           </p>
           <input class="apikey-input" id="apikeyInput" type="password" placeholder="Paste your YouTube Data API v3 key…" />
           <button class="apikey-save-btn" id="apikeySave" style="margin-top:10px;width:100%">Save &amp; Search</button>
           <p class="apikey-note" style="margin-top:10px;">
             <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Get a free API key →</a>
           </p>
         </div>`;

    searchPanel.style.display    = "block";
    searchBackdrop.style.display = "block";

    document.getElementById("reenterKeyBtn")?.addEventListener("click", () => {
      localStorage.removeItem(YT_API_KEY_STORAGE);
      showApiKeyPrompt(query);
    });

    const input = document.getElementById("apikeyInput");
    const save  = document.getElementById("apikeySave");
    if (!input || !save) return;
    save.addEventListener("click", () => {
      const k = input.value.trim();
      if (!k.startsWith("AIza")) { input.classList.add("apikey-input--error"); return; }
      input.classList.remove("apikey-input--error");
      saveApiKey(k);
      if (query) doSearch(query);
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter") save.click(); });
    input.focus();
  }

  async function doSearch(query) {
    const key = getApiKey();
    if (!key) { showApiKeyPrompt(query); return; }

    searchQueryLabel.textContent = query;
    searchResultsList.innerHTML  = `<div class="search-status spinning">Searching…</div>`;
    searchPanel.style.display    = "block";
    searchBackdrop.style.display = "block";

    try {
      const url  = `${YT_SEARCH_URL}?part=snippet&q=${encodeURIComponent(query)}&type=video,channel&maxResults=25&key=${key}`;
      const r    = await fetch(url);
      const data = await r.json();

      if (data.error) {
        const msg   = data.error.message || "API error";
        const isKey = data.error.status === "API_KEY_INVALID" || msg.toLowerCase().includes("key");
        searchResultsList.innerHTML = `
          <div class="search-status">
            ⚠️ ${msg}<br>
            ${isKey ? `<button class="apikey-reenter-btn" id="reenterKeyBtn">Re-enter API key</button>` : ""}
          </div>`;
        document.getElementById("reenterKeyBtn")?.addEventListener("click", () => {
          localStorage.removeItem(YT_API_KEY_STORAGE);
          showApiKeyPrompt(query);
        });
        return;
      }

      const items = (data.items || []).map(item => {
        const s    = item.snippet || {};
        const kind = item.id.kind;
        if (kind === "youtube#video") {
          return {
            type:             "stream",
            url:              `/watch?v=${item.id.videoId}`,
            title:            s.title,
            thumbnail:        s.thumbnails?.medium?.url || s.thumbnails?.default?.url || "",
            uploaderName:     s.channelTitle,
            uploadedDate:     s.publishedAt ? new Date(s.publishedAt).toLocaleDateString() : "",
            views:            0,
            duration:         0,
            shortDescription: s.description,
          };
        }
        if (kind === "youtube#channel") {
          return {
            type:        "channel",
            url:         `/channel/${item.id.channelId}`,
            name:        s.title,
            thumbnail:   s.thumbnails?.medium?.url || s.thumbnails?.default?.url || "",
            description: s.description,
            subscribers: 0,
            videos:      0,
          };
        }
        return null;
      }).filter(Boolean);

      openSearchPanel(items, query);
    } catch (err) {
      searchResultsList.innerHTML =
        `<div class="search-status">⚠️ Search failed. Check your connection and try again.</div>`;
    }
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
  ═══════════════════════════════════════ */
  function embedPlayer(parsed, originalUrl, startSeconds) {
    startSeconds = startSeconds || 0;

    if (!ytApiReady) {
      pendingLoad = () => embedPlayer(parsed, originalUrl, startSeconds);
      return;
    }

    stopProgressPolling();

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
      if (isChannel) {
        ytPlayer.loadPlaylist({ listType: "playlist", list: playlistId });
      } else {
        ytPlayer.loadVideoById({ videoId, startSeconds: startSeconds > 5 ? startSeconds : 0 });
      }
      startProgressPolling();
    } else {
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
    if (!parsed) { doSearch(trimmed); return; }
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
     RESTORE SESSION
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
     LOCAL STORAGE — HISTORY
  ═══════════════════════════════════════ */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }

  function saveHistory(url, parsed) {
    let history  = loadHistory();
    const exists = history.find(i => i.url === url);
    history      = history.filter(i => i.url !== url);
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

  function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

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
     LOCAL STORAGE — PLAYLISTS
  ═══════════════════════════════════════ */
  function loadPlaylists() {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYLISTS_KEY)) || [];
      // Ensure built-in defaults exist
      const defaults = [
        { id: "watch-later",  name: "Watch Later",  builtIn: true },
        { id: "liked-videos", name: "Liked Videos", builtIn: true },
      ];
      defaults.forEach(def => {
        if (!saved.find(p => p.id === def.id)) {
          saved.unshift({ ...def, items: [], createdAt: 0 });
        }
      });
      return saved;
    } catch {
      return [
        { id: "watch-later",  name: "Watch Later",  builtIn: true, items: [], createdAt: 0 },
        { id: "liked-videos", name: "Liked Videos", builtIn: true, items: [], createdAt: 0 },
      ];
    }
  }

  function savePlaylists(playlists) {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  }

  function createPlaylist(name) {
    const playlists = loadPlaylists();
    const id = "pl_" + Date.now();
    playlists.push({ id, name: name.trim(), builtIn: false, items: [], createdAt: Date.now() });
    savePlaylists(playlists);
    return id;
  }

  function deletePlaylist(id) {
    const playlists = loadPlaylists().filter(p => p.id !== id || p.builtIn);
    savePlaylists(playlists);
  }

  function addToPlaylist(playlistId, url, videoId) {
    const playlists = loadPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return false;
    if (pl.items.find(i => i.url === url)) return false;
    pl.items.push({ url, videoId: videoId || null, addedAt: Date.now() });
    savePlaylists(playlists);
    return true;
  }

  function removeFromPlaylist(playlistId, url) {
    const playlists = loadPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    pl.items = pl.items.filter(i => i.url !== url);
    savePlaylists(playlists);
  }

  function importUrlsToPlaylist(playlistId, urls) {
    const playlists = loadPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return 0;
    let added = 0;
    urls.forEach(url => {
      const trimmed = url.trim();
      if (!trimmed) return;
      const parsed = parseYouTubeUrl(trimmed);
      if (parsed && parsed.type !== "handle_unsupported") {
        if (!pl.items.find(i => i.url === trimmed)) {
          pl.items.push({ url: trimmed, videoId: parsed.id || null, addedAt: Date.now() });
          added++;
        }
      }
    });
    savePlaylists(playlists);
    return added;
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
     TITLE CACHE  (YouTube oEmbed, no API key)
  ═══════════════════════════════════════ */
  function loadTitleCache() {
    try { return JSON.parse(localStorage.getItem(TITLES_KEY)) || {}; } catch { return {}; }
  }
  function saveTitleCache(cache) {
    try { localStorage.setItem(TITLES_KEY, JSON.stringify(cache)); } catch {}
  }
  function getCachedTitle(videoId) {
    if (!videoId) return null;
    const entry = loadTitleCache()[videoId];
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > TITLE_TTL) return null;
    return entry;
  }
  async function fetchVideoTitle(videoId) {
    if (!videoId) return null;
    const cached = getCachedTitle(videoId);
    if (cached) return cached;
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        "https://www.youtube.com/watch?v=" + videoId)}&format=json`;
      const r = await fetch(oembedUrl);
      if (!r.ok) return null;
      const data = await r.json();
      const entry = { title: data.title || null, author: data.author_name || null, fetchedAt: Date.now() };
      const cache = loadTitleCache();
      cache[videoId] = entry;
      saveTitleCache(cache);
      return entry;
    } catch { return null; }
  }
  async function fetchPendingTitles() {
    // Collect all data-vid elements without a loaded title
    const wraps = [...document.querySelectorAll("[data-vid]:not([data-title-loaded])")];
    const seen  = new Set();
    const queue = [];
    wraps.forEach(el => {
      const vid = el.dataset.vid;
      if (!vid || seen.has(vid)) return;
      seen.add(vid);
      if (!getCachedTitle(vid)) queue.push({ vid, els: [] });
    });
    // Group elements by vid
    wraps.forEach(el => {
      const vid = el.dataset.vid;
      const entry = queue.find(q => q.vid === vid);
      if (entry) entry.els.push(el);
    });
    // Fetch staggered
    for (let i = 0; i < queue.length; i++) {
      await new Promise(r => setTimeout(r, i * 70));
      const { vid, els } = queue[i];
      fetchVideoTitle(vid).then(info => {
        if (!info?.title) return;
        document.querySelectorAll(`[data-vid="${vid}"]`).forEach(wrap => {
          wrap.dataset.titleLoaded = "1";
          const t = wrap.querySelector(".history-card-title, .playlist-item-title");
          if (t) t.textContent = info.title;
          if (info.author && !wrap.querySelector(".history-card-author, .playlist-item-author")) {
            const a = document.createElement("div");
            a.className = wrap.querySelector(".history-card-title") ? "history-card-author" : "playlist-item-author";
            a.textContent = info.author;
            wrap.appendChild(a);
          }
        });
      });
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
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
      .catch(() => {});
  }

  /* ═══════════════════════════════════════
     GET CURRENT VIDEO INFO
  ═══════════════════════════════════════ */
  function getCurrentVideoUrl() {
    return (activeUrlText && activeUrlText.textContent) || currentSession?.originalUrl || null;
  }

  function getCurrentVideoId() {
    try {
      const vd = ytPlayer?.getVideoData();
      if (vd?.video_id) return vd.video_id;
    } catch {}
    return currentSession?.resumeVideoId || null;
  }

  /* ═══════════════════════════════════════
     RENDER QUEUE
  ═══════════════════════════════════════ */
  function renderQueue() {
    const q = loadQueue();
    queueSection.style.display  = q.length > 0 ? "block" : "none";
    queueCountBadge.textContent = q.length > 0 ? `${q.length}` : "";

    queueList.innerHTML = "";
    q.forEach((url, idx) => {
      const row   = document.createElement("div");
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
     RENDER PLAYLISTS
  ═══════════════════════════════════════ */
  function renderPlaylists() {
    const playlists = loadPlaylists();
    playlistsGrid.innerHTML = "";

    playlists.forEach(pl => {
      const firstVid = pl.items.find(i => i.videoId);
      const thumb    = firstVid ? `https://img.youtube.com/vi/${firstVid.videoId}/mqdefault.jpg` : null;
      const card     = document.createElement("div");
      card.className = "playlist-card";
      card.innerHTML = `
        <div class="playlist-card-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="" loading="lazy"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
               <div class="thumb-fallback" style="display:none">📋</div>`
            : `<div class="thumb-fallback">📋</div>`}
          <div class="playlist-card-overlay">▶ Play</div>
          <div class="playlist-card-count">${pl.items.length} video${pl.items.length !== 1 ? "s" : ""}</div>
        </div>
        <div class="playlist-card-body">
          <div class="playlist-card-name">${pl.name}</div>
          ${pl.builtIn ? `<span class="playlist-built-in-badge">Default</span>` : ""}
        </div>
      `;
      card.addEventListener("click", () => openPlaylistDetail(pl.id));
      playlistsGrid.appendChild(card);
    });
  }

  function openPlaylistDetail(id) {
    currentPlaylistId = id;
    const playlists   = loadPlaylists();
    const pl          = playlists.find(p => p.id === id);
    if (!pl) return;

    playlistsSection.style.display      = "none";
    playlistDetailSection.style.display = "block";
    playlistDetailTitle.textContent     = pl.name;
    playlistDeleteBtn.style.display     = pl.builtIn ? "none" : "inline-flex";

    refreshPlaylistDetailView();
  }

  function refreshPlaylistDetailView() {
    const playlists = loadPlaylists();
    const pl        = playlists.find(p => p.id === currentPlaylistId);
    if (!pl) return;
    playlistDetailCount.textContent = `${pl.items.length} video${pl.items.length !== 1 ? "s" : ""}`;
    renderPlaylistDetail(pl);
  }

  function renderPlaylistDetail(pl) {
    playlistDetailList.innerHTML = "";

    if (!pl.items.length) {
      playlistDetailList.innerHTML = `
        <div class="playlist-empty">
          No videos yet.<br>
          <span style="color:var(--gray-500);font-size:13px;">
            Add videos from your history using the "+ Playlist" button, or use "Import URLs" above.
          </span>
        </div>`;
      return;
    }

    pl.items.forEach((item, idx) => {
      const thumb   = item.videoId
        ? `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`
        : null;
      const shortUrl = item.url
        .replace(/^https?:\/\/(www\.)?youtube\.com/, "")
        .replace(/^https?:\/\/youtu\.be/, "/s");

      const row = document.createElement("div");
      row.className = "playlist-item";
      row.innerHTML = `
        <span class="playlist-item-num">${idx + 1}</span>
        <div class="playlist-item-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="" loading="lazy"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
               <div class="thumb-fallback" style="display:none;font-size:16px">▶</div>`
            : `<div class="thumb-fallback" style="font-size:16px">▶</div>`}
        </div>
        <div class="playlist-item-info" data-vid="${item.videoId || ''}">
          <div class="playlist-item-title">${(() => { const c = item.videoId ? getCachedTitle(item.videoId) : null; return c?.title ? escapeHtml(c.title) : shortUrl; })()}</div>
          ${(() => { const c = item.videoId ? getCachedTitle(item.videoId) : null; return c?.author ? `<div class="playlist-item-author">${escapeHtml(c.author)}</div>` : ''; })()}
        </div>
        <button class="playlist-item-play" title="Play now">▶</button>
        <button class="playlist-item-remove" title="Remove">✕</button>
      `;

      row.querySelector(".playlist-item-play").addEventListener("click", e => {
        e.stopPropagation();
        loadUrl(item.url);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      row.querySelector(".playlist-item-remove").addEventListener("click", e => {
        e.stopPropagation();
        removeFromPlaylist(currentPlaylistId, item.url);
        refreshPlaylistDetailView();
        renderPlaylists();
      });
      row.addEventListener("click", () => {
        loadUrl(item.url);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      playlistDetailList.appendChild(row);
    });

    fetchPendingTitles();
  }

  function showPlaylistsSection() {
    renderPlaylists();
    playlistDetailSection.style.display = "none";
    playlistsSection.style.display      = "block";
    playlistsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ═══════════════════════════════════════
     SAVE TO PLAYLIST MODAL
  ═══════════════════════════════════════ */
  function showSaveToPlaylistModal(url, videoId) {
    saveToPlaylistUrl = url;
    saveToPlaylistVid = videoId;
    refreshSaveToPlaylistList();
    saveToPlaylistModal.style.display = "flex";
  }

  function refreshSaveToPlaylistList() {
    const playlists = loadPlaylists();
    saveToPlaylistList.innerHTML = "";

    if (!playlists.length) {
      saveToPlaylistList.innerHTML = `<p style="color:var(--gray-500);font-size:13px;padding:8px 0;">No playlists yet. Create one below.</p>`;
      return;
    }

    playlists.forEach(pl => {
      const alreadyIn = pl.items.find(i => i.url === saveToPlaylistUrl);
      const row = document.createElement("div");
      row.className = `save-playlist-row${alreadyIn ? " in-playlist" : ""}`;
      row.innerHTML = `
        <span class="save-playlist-name">${pl.name}</span>
        <span class="save-playlist-count">${pl.items.length}</span>
        ${alreadyIn
          ? `<span class="save-playlist-check">✓ Added</span>`
          : `<button class="save-playlist-add-btn">+ Add</button>`}
      `;
      if (!alreadyIn) {
        row.querySelector(".save-playlist-add-btn").addEventListener("click", () => {
          addToPlaylist(pl.id, saveToPlaylistUrl, saveToPlaylistVid);
          showToast(`Added to "${pl.name}" ✓`);
          refreshSaveToPlaylistList();
          renderPlaylists();
        });
      }
      saveToPlaylistList.appendChild(row);
    });
  }

  /* ═══════════════════════════════════════
     IMPORT URLS MODAL
  ═══════════════════════════════════════ */
  function showImportUrlsModal(playlistId) {
    importUrlsTarget = playlistId;
    importUrlsTextarea.value = "";
    importUrlsModal.style.display = "flex";
    setTimeout(() => importUrlsTextarea.focus(), 80);
  }

  /* ═══════════════════════════════════════
     CREATE PLAYLIST MODAL
  ═══════════════════════════════════════ */
  function showCreatePlaylistModal(onCreated) {
    createPlaylistName.value = "";
    createPlaylistModal.style.display = "flex";
    setTimeout(() => createPlaylistName.focus(), 80);

    // Replace confirm handler to carry onCreated callback
    createPlaylistConfirm.onclick = () => {
      const name = createPlaylistName.value.trim();
      if (!name) { createPlaylistName.focus(); return; }
      const newId = createPlaylist(name);
      createPlaylistModal.style.display = "none";
      renderPlaylists();
      if (onCreated) onCreated(newId);
      else showToast(`Playlist "${name}" created ✓`);
    };

    createPlaylistName.onkeydown = e => {
      if (e.key === "Enter") createPlaylistConfirm.click();
      if (e.key === "Escape") createPlaylistModal.style.display = "none";
    };
  }

  /* ═══════════════════════════════════════
     RENDER HISTORY
  ═══════════════════════════════════════ */
  function getSortedFilteredHistory() {
    let history = loadHistory();
    if (currentFilter) {
      const f = currentFilter.toLowerCase();
      history = history.filter(i => i.url.toLowerCase().includes(f));
    }
    switch (currentSort) {
      case "oldest":     history.sort((a,b) => a.timestamp - b.timestamp); break;
      case "watchCount": history.sort((a,b) => (b.watchCount||0) - (a.watchCount||0)); break;
      case "progress":   history.sort((a,b) => (b.progress?.seconds||0) - (a.progress?.seconds||0)); break;
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
          <div class="history-card-title-wrap" data-vid="${item.videoId || ''}">
            <div class="history-card-title">${(() => { const c = item.videoId ? getCachedTitle(item.videoId) : null; return c?.title ? escapeHtml(c.title) : shortUrl; })()}</div>
            ${(() => { const c = item.videoId ? getCachedTitle(item.videoId) : null; return c?.author ? `<div class="history-card-author">${escapeHtml(c.author)}</div>` : ''; })()}
          </div>
          <div class="history-card-bottom-row">
            ${progressLabel
              ? `<span class="history-card-progress">⏱ ${progressLabel}</span>`
              : `<span class="history-card-time">${formatRelTime(item.timestamp)}</span>`}
            ${item.watchCount > 1 ? `<span class="watch-count">▶ ×${item.watchCount}</span>` : ""}
          </div>
          <div class="card-action-row">
            ${hasProgress ? `<button class="card-link-btn reset-btn" data-url="${item.url}" title="Reset progress">↺ Reset</button>` : ""}
            <button class="card-link-btn queue-btn" data-url="${item.url}" title="Add to queue">+ Queue</button>
            <button class="card-link-btn pl-btn" data-url="${item.url}" data-videoid="${item.videoId || ""}" title="Save to playlist">+ Playlist</button>
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

      // Favorite — also syncs Liked Videos playlist
      card.querySelector(".fav-btn").addEventListener("click", e => {
        e.stopPropagation();
        const newFav = !item.favorited;
        updateHistoryItem(item.url, { favorited: newFav });
        if (newFav) {
          addToPlaylist("liked-videos", item.url, item.videoId);
        } else {
          removeFromPlaylist("liked-videos", item.url);
        }
        renderPlaylists();
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
      });

      // Add to queue
      card.querySelector(".queue-btn").addEventListener("click", e => {
        e.stopPropagation();
        addToQueue(item.url);
      });

      // Add to playlist
      card.querySelector(".pl-btn").addEventListener("click", e => {
        e.stopPropagation();
        showSaveToPlaylistModal(item.url, item.videoId || null);
      });

      // Delete
      card.querySelector(".history-card-delete").addEventListener("click", e => {
        e.stopPropagation();
        deleteHistoryItem(item.url);
      });

      historyGrid.appendChild(card);
    });

    fetchPendingTitles();
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
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      const active  = document.activeElement;
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
    if (e.key === "Escape") {
      document.querySelector(".modal-overlay[style*='flex']")?.style && closeAllModals();
      if (theaterMode) setTheaterMode(false);
    }
  });

  function closeAllModals() {
    [confirmClearModal, saveToPlaylistModal, importUrlsModal, createPlaylistModal]
      .forEach(m => { if (m) m.style.display = "none"; });
  }

  /* ═══════════════════════════════════════
     WIRE UP CONTROLS
  ═══════════════════════════════════════ */

  // Load
  loadBtn.addEventListener("click", () => {
    if (urlInput.value.trim()) loadUrl(urlInput.value);
    else showToast("Type a search term or paste a YouTube URL.");
  });
  urlInput.addEventListener("keydown", e => { if (e.key === "Enter") loadBtn.click(); });
  urlInput.addEventListener("paste", () => {
    setTimeout(() => { const v = urlInput.value.trim(); if (v.startsWith("http")) loadUrl(v); }, 50);
  });

  // Search panel
  searchPanelClose.addEventListener("click", closeSearchPanel);
  searchBackdrop.addEventListener("click",   closeSearchPanel);
  document.getElementById("searchApiKeyBtn").addEventListener("click", () => showApiKeyPrompt(""));

  // Theater
  theaterBtn.addEventListener("click", () => setTheaterMode(!theaterMode));
  theaterExitBtn.addEventListener("click", () => setTheaterMode(false));

  // Queue
  queueAddCurrentBtn.addEventListener("click", () => {
    const url = getCurrentVideoUrl();
    if (!url) return showToast("No video playing.");
    addToQueue(url);
  });
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

  // Copy URL
  copyUrlBtn.addEventListener("click", copyCurrentUrl);

  // Watch Later
  watchLaterBtn.addEventListener("click", () => {
    const url = getCurrentVideoUrl();
    if (!url) return showToast("No video playing.");
    const added = addToPlaylist("watch-later", url, getCurrentVideoId());
    showToast(added ? "Added to Watch Later ✓" : "Already in Watch Later.");
    renderPlaylists();
  });

  // Save to Playlist
  saveToPlaylistBtn.addEventListener("click", () => {
    const url = getCurrentVideoUrl();
    if (!url) return showToast("No video playing.");
    showSaveToPlaylistModal(url, getCurrentVideoId());
  });

  // Save to Playlist modal
  saveToPlaylistClose.addEventListener("click", () => { saveToPlaylistModal.style.display = "none"; });
  saveToPlaylistModal.addEventListener("click", e => {
    if (e.target === saveToPlaylistModal) saveToPlaylistModal.style.display = "none";
  });
  saveToPlaylistNew.addEventListener("click", () => {
    saveToPlaylistModal.style.display = "none";
    showCreatePlaylistModal(newId => {
      showToast("Playlist created ✓");
      // Reopen save modal with new playlist listed
      showSaveToPlaylistModal(saveToPlaylistUrl, saveToPlaylistVid);
    });
  });

  // Import URLs modal
  importUrlsClose.addEventListener("click", () => { importUrlsModal.style.display = "none"; });
  importUrlsModal.addEventListener("click", e => {
    if (e.target === importUrlsModal) importUrlsModal.style.display = "none";
  });
  importUrlsConfirm.addEventListener("click", () => {
    const lines = importUrlsTextarea.value.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) { showToast("Paste at least one URL."); return; }
    const added = importUrlsToPlaylist(importUrlsTarget, lines);
    importUrlsModal.style.display = "none";
    refreshPlaylistDetailView();
    renderPlaylists();
    showToast(`Imported ${added} video${added !== 1 ? "s" : ""} ✓`);
  });

  // Create Playlist modal
  createPlaylistClose.addEventListener("click", () => { createPlaylistModal.style.display = "none"; });
  createPlaylistModal.addEventListener("click", e => {
    if (e.target === createPlaylistModal) createPlaylistModal.style.display = "none";
  });

  // Playlists nav button
  playlistsNavBtn.addEventListener("click", () => {
    currentPlaylistId = null;
    playlistDetailSection.style.display = "none";
    showPlaylistsSection();
  });

  // Create playlist button (inside section)
  createPlaylistBtn.addEventListener("click", () => {
    showCreatePlaylistModal(newId => {
      showToast("Playlist created ✓");
      showPlaylistsSection();
    });
  });

  // Playlist detail back
  playlistBackBtn.addEventListener("click", () => {
    playlistDetailSection.style.display = "none";
    currentPlaylistId = null;
    showPlaylistsSection();
  });

  // Playlist import URLs
  playlistImportBtn.addEventListener("click", () => {
    if (currentPlaylistId) showImportUrlsModal(currentPlaylistId);
  });

  // Playlist play all (enqueue all items)
  playlistPlayAllBtn.addEventListener("click", () => {
    if (!currentPlaylistId) return;
    const pl = loadPlaylists().find(p => p.id === currentPlaylistId);
    if (!pl || !pl.items.length) { showToast("Playlist is empty."); return; }
    const queue = [...pl.items.map(i => i.url)];
    const first = queue.shift();
    saveQueue(queue);
    renderQueue();
    loadUrl(first);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Playing all ${pl.items.length} videos ✓`);
  });

  // Playlist delete
  playlistDeleteBtn.addEventListener("click", () => {
    if (!currentPlaylistId) return;
    const pl = loadPlaylists().find(p => p.id === currentPlaylistId);
    if (!pl || pl.builtIn) return;
    if (!confirm(`Delete playlist "${pl.name}"? This cannot be undone.`)) return;
    deletePlaylist(currentPlaylistId);
    currentPlaylistId = null;
    playlistDetailSection.style.display = "none";
    showPlaylistsSection();
    showToast("Playlist deleted.");
  });

  // Clear history — now with confirmation
  clearBtn.addEventListener("click", () => {
    if (!loadHistory().length) return showToast("History is already empty.");
    confirmClearModal.style.display = "flex";
  });
  confirmClearConfirm.addEventListener("click", () => {
    confirmClearModal.style.display = "none";
    clearHistory();
    showToast("History cleared.");
  });
  confirmClearCancel.addEventListener("click", () => {
    confirmClearModal.style.display = "none";
  });
  confirmClearModal.addEventListener("click", e => {
    if (e.target === confirmClearModal) confirmClearModal.style.display = "none";
  });

  // History controls
  historySearch.addEventListener("input", e => {
    currentFilter = e.target.value.trim();
    renderHistory();
  });
  historySort.addEventListener("change", e => {
    currentSort = e.target.value;
    savePrefs();
    renderHistory();
  });
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
  exportBtn.addEventListener("click", exportHistory);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", e => {
    if (e.target.files[0]) { importHistory(e.target.files[0]); e.target.value = ""; }
  });

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
    currentSort = prefs.sort || "recent";
    currentView = prefs.view || "grid";
    kbHintShown = prefs.kbHintShown || false;

    historySort.value = currentSort;
    if (currentView === "list") {
      viewListBtn.classList.add("active");
      viewGridBtn.classList.remove("active");
    }

    renderHistory();
    renderPlaylists();
    renderQueue();
    restoreSession();

    if (!kbHintShown && !loadHistory().length) {
      setTimeout(() => { if (kbHint) kbHint.style.display = "flex"; }, 2000);
    }
  })();

})();
