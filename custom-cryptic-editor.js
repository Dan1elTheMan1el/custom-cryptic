(function () {
  if (document.getElementById("custom-cryptic-editor-shell")) {
    document.getElementById("custom-cryptic-editor-shell").remove();
  }

  const today = new Date();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function formatDisplayDate(date) {
    return `${date.getDate()} ${months[date.getMonth()]}, ${date.getFullYear()}`;
  }
  const DEFAULT_DATE = formatDisplayDate(today);
  const DEFAULT_AUTHOR = "";
  const DEFAULT_CLUE = "Hidden starter for a custom link?";
  const DEFAULT_ANSWER = "WORD";
  // Set this to your Cloudflare Worker URL (e.g. "https://my-cryptic.worker.workers.dev").
  // You can also override at runtime by setting `window.CUSTOM_CRYPTIC_WORKER_HOST`.
  const WORKER_HOST = window.CUSTOM_CRYPTIC_WORKER_HOST || "https://custom-cryptic.friedmandaniel111.workers.dev";
  const SHARE_RETENTION_DAYS = 365; // 0x0.st's stated maximum retention
  const STORAGE_KEY = "custom-cryptic-drafts";
  const COMPLETED_STORAGE_KEY = "custom-cryptic-completed";

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const fileId = params.get("p");
  const legacyPayload = fileId ? null : decodeSharedPayload(params.get("c"));

  const shell = document.createElement("section");
  shell.id = "custom-cryptic-editor-shell";
  shell.innerHTML = buildStyles();

  document.body.innerHTML = "";
  document.body.style.margin = "0";
  document.body.appendChild(shell);

  if (view === "library") {
    renderLibraryMode(shell, params.get("q") || "", params.get("cursor") || "");
  } else if (fileId) {
    renderLoadingState(shell);
    (async () => {
      try {
        const payload = await fetchSharedPayloadById(fileId);
        console.log('Loaded puzzle payload:', payload);
        // Replace loading UI with the worker-provided styles, then render
        shell.innerHTML = buildStyles();
        renderPlayMode(shell, normalizePayload({ ...payload, id: payload.id || fileId }));
      } catch (err) {
        console.error('Failed to load puzzle:', err);
        renderLoadError(shell);
        // If possible, show a short error message in the UI
        try {
          const label = shell.querySelector('.label');
          if (label) label.textContent = "Couldn't load this puzzle.";
        } catch (e) { }
      }
    })();
  } else if (legacyPayload) {
    renderPlayMode(shell, normalizePayload(legacyPayload));
  } else {
    renderCreateMode(shell, createDraftFromParams(params));
  }

  function createDraftFromParams(searchParams) {
    const clue = stripCountForLoad(decodeURIComponent(searchParams.get("clue") || DEFAULT_CLUE));
    const answer = normalizeAnswer(searchParams.get("answer") || DEFAULT_ANSWER);
    const hints = parseHints(searchParams.get("hints"));
    return {
      mode: "create",
      date: DEFAULT_DATE,
      author: searchParams.get("author") || searchParams.get("byline") || DEFAULT_AUTHOR,
      clue,
      answer,
      hints: hints.length ? hints : [{ id: makeId(), text: "", type: "indicator", words: [] }],
      selectedAnswerIndex: Math.max(answer.replace(/\s/g, "").length - 1, 0),
      selectedHintId: null,
      par: Math.max(countAnswerLetters(answer) + hints.length, 1),
      activeHintMenu: false,
      shareId: null,
      editKey: null,
    };
  }

  function normalizePayload(payload) {
    const clue = stripCountForLoad(payload?.clue || DEFAULT_CLUE);
    const answer = normalizeAnswer(payload?.answer || DEFAULT_ANSWER);
    const hints = Array.isArray(payload?.hints) && payload.hints.length
      ? payload.hints.map((hint) => ({
        id: hint.id || makeId(),
        text: String(hint.text || ""),
        type: ["indicator", "fodder", "definition"].includes(hint.type) ? hint.type : "indicator",
        words: Array.isArray(hint.words) ? hint.words.map(Number).filter(Number.isInteger) : [],
      }))
      : [{ id: makeId(), text: "", type: "indicator", words: [] }];

    return {
      mode: "play",
      puzzleId: payload?.id || null,
      date: payload?.date || DEFAULT_DATE,
      author: payload?.author || DEFAULT_AUTHOR,
      clue,
      answer,
      hints,
      usedHints: [],
      revealedLetters: [],
      typedGuess: "",
      selectedAnswerIndex: 0,
      feedback: null,
      solved: false, // Tracks the win state
      hintPanelOpen: false,
      highlightedWords: {},
      clueWordLengths: getAnswerWordLengths(answer),
      par: Number.isInteger(payload?.par) && payload.par > 0
        ? payload.par
        : Math.max(countAnswerLetters(answer) + hints.length, 1),
    };
  }

  function buildStyles() {
    return `
      <style>
        @font-face {
          font-family: "Sansita Custom";
          src: url("sansita.otf") format("opentype");
          font-display: swap;
        }

        #custom-cryptic-editor-shell {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          overflow: auto;
          background: #add3ff;
          color: #111111;
          font-family: "SF Pro Display", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        }

        #custom-cryptic-editor-shell * {
          box-sizing: border-box;
        }

        #custom-cryptic-editor-shell .page {
          width: min(100%, 1200px);
          min-height: 100vh;
          margin: 0 auto;
          padding: 14px 16px 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        #custom-cryptic-editor-shell .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          padding-top: 4px;
        }

        #custom-cryptic-editor-shell .topbar-left,
        #custom-cryptic-editor-shell .topbar-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        #custom-cryptic-editor-shell .topbar-left {
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
        }

        #custom-cryptic-editor-shell .date {
          font: 700 20px/1.1 "SF Pro Display", "SF Pro Text", sans-serif;
        }

        #custom-cryptic-editor-shell .expiry-date {
          font: 600 13px/1.2 "SF Pro Text", "Segoe UI", sans-serif;
          color: rgba(17, 17, 17, 0.6);
        }

        #custom-cryptic-editor-shell .author-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        #custom-cryptic-editor-shell .author-prefix {
          font: 500 15px/1.2 "SF Pro Text", "Segoe UI", sans-serif;
        }

        #custom-cryptic-editor-shell .author-input {
          border: none;
          border-bottom: 2px solid rgba(17, 17, 17, 0.35);
          background: transparent;
          padding: 0 2px;
          font: 600 15px/1.2 "SF Pro Text", "Segoe UI", sans-serif;
          min-width: 220px;
          outline: none;
        }

        #custom-cryptic-editor-shell .github-link {
          width: 58px;
          height: 58px;
          border: 4px solid #111111;
          border-radius: 14px;
          background: #f5d1fd;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 4px 4px 0 rgba(17, 17, 17, 0.18);
          color: #111111;
          text-decoration: none;
        }

        #custom-cryptic-editor-shell .nav-link {
          height: 58px;
          border: 4px solid #111111;
          border-radius: 14px;
          background: #ffffff;
          color: #111111;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 14px;
          font: 800 12px/1.1 "SF Pro Text", "Segoe UI", sans-serif;
          text-decoration: none;
          box-shadow: 4px 4px 0 rgba(17, 17, 17, 0.18);
        }

        #custom-cryptic-editor-shell .nav-link.library-link {
          background: #fff8dc;
        }

        #custom-cryptic-editor-shell .content {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        #custom-cryptic-editor-shell .card,
        #custom-cryptic-editor-shell .panel-card {
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.15);
        }

        #custom-cryptic-editor-shell .clue-card {
          padding: 26px 28px;
        }

        #custom-cryptic-editor-shell .card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }

        #custom-cryptic-editor-shell .label {
          font: 700 17px/1.1 "SF Pro Display", "SF Pro Text", sans-serif;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        #custom-cryptic-editor-shell .count-pill,
        #custom-cryptic-editor-shell .guess-result {
          font: 700 15px/1.1 "SF Pro Text", "Segoe UI", sans-serif;
          padding: 8px 12px;
          border: 3px solid #111111;
          border-radius: 999px;
          background: #ffffff;
        }

        #custom-cryptic-editor-shell .clue-input-wrap {
          position: relative;
        }

        #custom-cryptic-editor-shell .clue-input {
          width: 100%;
          min-height: 180px;
          resize: vertical;
          border: 3px solid #111111;
          border-radius: 16px;
          padding: 18px 20px;
          font: 500 22px/1.25 "SF Pro Text", "Segoe UI", sans-serif;
          outline: none;
        }

        #custom-cryptic-editor-shell .clue-count-suffix {
          position: absolute;
          right: 22px;
          bottom: 16px;
          font: 500 22px/1.25 "SF Pro Text", "Segoe UI", sans-serif;
          color: rgba(17, 17, 17, 0.38);
          pointer-events: none;
        }

        #custom-cryptic-editor-shell .play-clue {
          border: 3px solid #111111;
          border-radius: 16px;
          background: #ffffff;
          padding: 20px;
          min-height: 180px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          font-size: clamp(2rem, 4vw, 4.3rem);
          line-height: 1.18;
          letter-spacing: -0.04em;
        }

        #custom-cryptic-editor-shell .clue-text-wrap {
          display: block;
          width: 100%;
        }

        #custom-cryptic-editor-shell .clue-lengths {
          margin-left: 10px;
          font: 700 clamp(1.4rem, 2vw, 2.1rem)/1.1 "SF Pro Text", "Segoe UI", sans-serif;
          color: rgba(17, 17, 17, 0.5);
          white-space: nowrap;
        }

        #custom-cryptic-editor-shell .highlighted-word {
          padding: 0 6px;
          border-radius: 10px;
        }
        
        #custom-cryptic-editor-shell .highlighted-word.indicator { background: #f5d1fd; }
        #custom-cryptic-editor-shell .highlighted-word.fodder { background: #fff2a8; }
        #custom-cryptic-editor-shell .highlighted-word.definition { background: #add3ff; }

        #custom-cryptic-editor-shell .answer-card {
          padding: 26px 28px 30px;
        }

        #custom-cryptic-editor-shell .answer-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0;
          padding: 4px 0 18px;
        }

        #custom-cryptic-editor-shell .answer-group {
          display: inline-flex;
          align-items: stretch;
        }

        #custom-cryptic-editor-shell .answer-gap {
          width: 14px;
          flex: 0 0 14px;
        }

        #custom-cryptic-editor-shell .tile {
          width: 56px;
          height: 56px;
          border: 3px solid #111111;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font: 700 30px/1 "SF Pro Text", "Segoe UI", sans-serif;
          background: #ffffff;
          color: #111111;
          cursor: pointer;
          padding: 0;
          text-align: center;
          outline: none;
        }
        
        /* Overlap adjacent boxes */
        #custom-cryptic-editor-shell .tile + .tile {
          margin-left: -3px; 
        }
        
        #custom-cryptic-editor-shell input.tile {
          cursor: text;
        }

        #custom-cryptic-editor-shell .tile.selected,
        #custom-cryptic-editor-shell .tile:focus {
          background: #f5d1fd;
          position: relative; /* Bring focused tile to front to show full border */
          z-index: 2;
        }

        #custom-cryptic-editor-shell .tile.revealed {
          background: #e6f0ff;
        }

        #custom-cryptic-editor-shell .answer-input-wrap {
          width: min(100%, 560px);
          margin: 0 auto;
        }

        #custom-cryptic-editor-shell .answer-input {
          width: 100%;
          border: 3px solid #111111;
          border-radius: 999px;
          background: #ffffff;
          padding: 14px 18px;
          font: 600 18px/1.2 "SF Pro Text", "Segoe UI", sans-serif;
          outline: none;
          text-align: center;
        }

        #custom-cryptic-editor-shell .answer-helper {
          margin-top: 10px;
          text-align: center;
          font: 600 13px/1.4 "SF Pro Text", "Segoe UI", sans-serif;
          color: rgba(17, 17, 17, 0.72);
        }

        #custom-cryptic-editor-shell .par-block,
        #custom-cryptic-editor-shell .play-meter {
          margin-top: 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        #custom-cryptic-editor-shell .par-circles,
        #custom-cryptic-editor-shell .meter-dots {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: center;
        }

        #custom-cryptic-editor-shell .par-circle,
        #custom-cryptic-editor-shell .meter-dot {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 3px solid rgba(17, 17, 17, 0.25);
          background: rgba(255, 255, 255, 0.55);
          padding: 0;
          cursor: pointer;
        }

        #custom-cryptic-editor-shell .par-circle.active,
        #custom-cryptic-editor-shell .meter-dot.active {
          border-color: #111111;
          background: transparent;
        }

        #custom-cryptic-editor-shell .par-label,
        #custom-cryptic-editor-shell .meter-label {
          font: 700 28px/1 "Sansita Custom", serif;
          font-style: italic;
        }

        #custom-cryptic-editor-shell .controls {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          justify-content: center;
        }

        #custom-cryptic-editor-shell .button,
        #custom-cryptic-editor-shell .chip,
        #custom-cryptic-editor-shell .action-button,
        #custom-cryptic-editor-shell .add-hint-button,
        #custom-cryptic-editor-shell .guess-button,
        #custom-cryptic-editor-shell .hint-toggle,
        #custom-cryptic-editor-shell .share-button,
        #custom-cryptic-editor-shell .hint-choice {
          border: 3px solid #111111;
          border-radius: 999px;
          background: #ffffff;
          font: 700 14px/1.2 "SF Pro Text", "Segoe UI", sans-serif;
          padding: 8px 12px;
          cursor: pointer;
        }
        
        #custom-cryptic-editor-shell .guess-button:disabled,
        #custom-cryptic-editor-shell .hint-toggle:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        #custom-cryptic-editor-shell .hint-toggle,
        #custom-cryptic-editor-shell .guess-button {
          min-width: 170px;
          height: 56px;
          font-size: 22px;
        }

        #custom-cryptic-editor-shell .guess-button.good {
          animation: goodPulse 420ms ease;
        }

        #custom-cryptic-editor-shell .guess-button.bad {
          animation: badShake 420ms ease;
        }

        #custom-cryptic-editor-shell .guess-feedback {
          min-height: 24px;
          font: 700 15px/1.4 "SF Pro Text", "Segoe UI", sans-serif;
        }

        /* Stacked hints UI */
        #custom-cryptic-editor-shell .stacked-hints {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: min(100%, 560px);
          margin: 16px auto 0;
        }

        #custom-cryptic-editor-shell .stacked-hint {
          border: 3px solid #111111;
          border-radius: 12px;
          padding: 10px 14px;
          font: 600 15px/1.4 "SF Pro Text", "Segoe UI", sans-serif;
          text-align: left;
        }

        #custom-cryptic-editor-shell .stacked-hint.indicator { background: #f5d1fd; }
        #custom-cryptic-editor-shell .stacked-hint.fodder { background: #fff2a8; }
        #custom-cryptic-editor-shell .stacked-hint.definition { background: #add3ff; }
        #custom-cryptic-editor-shell .stacked-hint.random { background: #ffffff; }

        #custom-cryptic-editor-shell .lower-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
          gap: 18px;
        }

        #custom-cryptic-editor-shell .panel-card {
          background: #fff8dc;
          border: 4px solid #111111;
          box-shadow: 0 4px 0 rgba(0, 0, 0, 0.2);
          padding: 20px;
        }

        #custom-cryptic-editor-shell .panel-title {
          margin: 0 0 16px;
          font: 700 18px/1.1 "SF Pro Display", "SF Pro Text", sans-serif;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        #custom-cryptic-editor-shell .hint-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        #custom-cryptic-editor-shell .hint-card {
          border: 4px solid #111111;
          border-radius: 20px;
          padding: 16px;
          background: #ffffff;
          display: grid;
          gap: 12px;
        }

        #custom-cryptic-editor-shell .hint-card.indicator { background: #f5d1fd; }
        #custom-cryptic-editor-shell .hint-card.fodder { background: #fff2a8; }
        #custom-cryptic-editor-shell .hint-card.definition { background: #add3ff; }

        #custom-cryptic-editor-shell .hint-top {
          display: flex;
          gap: 10px;
          justify-content: space-between;
          align-items: start;
        }

        #custom-cryptic-editor-shell .hint-text {
          width: 100%;
          min-height: 72px;
          resize: vertical;
          border: 3px solid #111111;
          border-radius: 14px;
          padding: 12px 14px;
          font: 600 16px/1.35 "SF Pro Text", "Segoe UI", sans-serif;
          background: rgba(255,255,255,0.75);
        }

        #custom-cryptic-editor-shell .hint-type-row,
        #custom-cryptic-editor-shell .hint-actions,
        #custom-cryptic-editor-shell .hint-words {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        #custom-cryptic-editor-shell .type-button.active.indicator,
        #custom-cryptic-editor-shell .chip.active.indicator,
        #custom-cryptic-editor-shell .hint-choice.indicator { background: #f5d1fd; }
        #custom-cryptic-editor-shell .type-button.active.fodder,
        #custom-cryptic-editor-shell .chip.active.fodder,
        #custom-cryptic-editor-shell .hint-choice.fodder { background: #fff2a8; }
        #custom-cryptic-editor-shell .type-button.active.definition,
        #custom-cryptic-editor-shell .chip.active.definition,
        #custom-cryptic-editor-shell .hint-choice.definition { background: #add3ff; }

        #custom-cryptic-editor-shell .add-hint-button {
          width: 100%;
          background: #ffffff;
          font: 700 16px/1.2 "SF Pro Text", "Segoe UI", sans-serif;
          margin-bottom: 14px;
        }

        #custom-cryptic-editor-shell .stats {
          display: grid;
          gap: 12px;
        }

        #custom-cryptic-editor-shell .stat-row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font: 600 15px/1.35 "SF Pro Text", "Segoe UI", sans-serif;
        }

        #custom-cryptic-editor-shell .legend {
          display: grid;
          gap: 10px;
          margin-top: 8px;
        }

        #custom-cryptic-editor-shell .legend-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        #custom-cryptic-editor-shell .legend-swatch {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 3px solid #111111;
          flex: 0 0 auto;
        }

        #custom-cryptic-editor-shell .legend-swatch.indicator { background: #f5d1fd; }
        #custom-cryptic-editor-shell .legend-swatch.fodder { background: #fff2a8; }
        #custom-cryptic-editor-shell .legend-swatch.definition { background: #add3ff; }

        #custom-cryptic-editor-shell .play-grid {
          display: grid;
          gap: 18px;
        }

        #custom-cryptic-editor-shell .play-clue-wrap {
          display: grid;
          gap: 12px;
        }

        #custom-cryptic-editor-shell .play-clue-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        #custom-cryptic-editor-shell .play-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: center;
        }

        #custom-cryptic-editor-shell .hint-menu {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }

        #custom-cryptic-editor-shell .hint-panel {
          display: none;
          margin-top: 16px;
          border: 4px solid #111111;
          border-radius: 16px;
          background: rgba(255,255,255,0.88);
          padding: 14px;
        }

        #custom-cryptic-editor-shell .hint-panel.open {
          display: block;
        }

        #custom-cryptic-editor-shell .guess-button.right {
          animation: goodPulse 420ms ease;
          background: #c7f5c7;
        }

        #custom-cryptic-editor-shell .guess-button.wrong {
          animation: badShake 420ms ease;
          background: #ffced6;
        }

        @keyframes goodPulse {
          0% { transform: scale(1); }
          45% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }

        @keyframes badShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        @media (max-width: 980px) {
          #custom-cryptic-editor-shell .lower-grid {
            grid-template-columns: 1fr;
          }

          #custom-cryptic-editor-shell .author-input {
            min-width: 180px;
          }
        }

        @media (max-width: 640px) {
          #custom-cryptic-editor-shell .page {
            padding: 12px 12px 20px;
          }

          #custom-cryptic-editor-shell .topbar {
            flex-direction: column;
            gap: 10px;
          }

          #custom-cryptic-editor-shell .clue-card,
          #custom-cryptic-editor-shell .answer-card,
          #custom-cryptic-editor-shell .panel-card {
            padding: 18px;
          }

          #custom-cryptic-editor-shell .tile {
            width: 48px;
            height: 48px;
            font-size: 24px;
          }

          #custom-cryptic-editor-shell .par-circle,
          #custom-cryptic-editor-shell .meter-dot {
            width: 16px;
            height: 16px;
          }
        }
      </style>
    `;
  }

  function renderCreateMode(root, draft) {
    root.innerHTML += `
      <div class="page">
        <div class="topbar">
          <div class="topbar-left">
            <div class="date">${escapeHtml(draft.date)}</div>
            <div class="author-row">
              <span class="author-prefix">By</span>
              <input id="author-input" class="author-input" value="${escapeHtml(draft.author)}" aria-label="Author name" placeholder="Your name" required>
            </div>
          </div>
          <div class="topbar-right">
            <a class="nav-link library-link" href="?view=library" aria-label="Open library">Library</a>
            <a class="github-link" href="https://github.com/Dan1elTheMan1el" target="_blank" rel="noreferrer" aria-label="GitHub profile">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.58 2 12.25C2 16.78 4.865 20.61 8.84 21.97C9.34 22.06 9.52 21.75 9.52 21.49C9.52 21.26 9.51 20.54 9.51 19.69C6.73 20.31 6.14 18.47 6.14 18.47C5.69 17.28 5.04 16.97 5.04 16.97C4.13 16.33 5.11 16.34 5.11 16.34C6.12 16.42 6.65 17.41 6.65 17.41C7.54 18.98 8.99 18.53 9.57 18.28C9.66 17.62 9.92 17.17 10.21 16.92C7.99 16.66 5.66 15.77 5.66 11.84C5.66 10.72 6.05 9.81 6.7 9.1C6.59 8.84 6.24 7.82 6.8 6.44C6.8 6.44 7.63 6.17 9.5 7.48C10.28 7.26 11.11 7.15 11.94 7.15C12.77 7.15 13.6 7.26 14.38 7.48C16.25 6.17 17.08 6.44 17.08 6.44C17.64 7.82 17.29 8.84 17.18 9.1C17.84 9.81 18.22 10.72 18.22 11.84C18.22 15.79 15.88 16.65 13.65 16.91C14.01 17.22 14.34 17.83 14.34 18.76C14.34 20.1 14.33 21.18 14.33 21.49C14.33 21.75 14.51 22.07 15.02 21.97C18.99 20.61 21.85 16.78 21.85 12.25C21.85 6.58 17.52 2 12 2Z" fill="currentColor"></path>
              </svg>
            </a>
          </div>
        </div>

        <div class="content">
          <section class="card clue-card">
            <div class="card-head">
              <div class="label">Clue</div>
            </div>
            <div class="clue-input-wrap">
              <textarea id="clue-input" class="clue-input" aria-label="Clue text">${escapeHtml(draft.clue)}</textarea>
              <div class="clue-count-suffix" id="clue-length-pill" aria-hidden="true"></div>
            </div>
          </section>

          <section class="card answer-card">
            <div class="card-head" style="width: 100%;">
              <div class="label">Answer</div>
              <div class="count-pill" id="answer-length-pill">${countAnswerLetters(draft.answer)} letters</div>
            </div>
            <div class="answer-row" id="answer-tiles" aria-label="Answer boxes"></div>
            <div class="answer-input-wrap">
              <input id="answer-input" class="answer-input" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(draft.answer)}" aria-label="Answer text">
              <div class="answer-helper">Type letters to add boxes. Click a box to select it.</div>
            </div>
            <div class="par-block">
              <div class="par-circles" id="par-circles"></div>
              <div class="par-label" id="create-par-label">par</div>
            </div>
          </section>

          <div class="lower-grid">
            <section class="panel-card">
              <div class="panel-title">Hints</div>
              <button class="add-hint-button" id="add-hint-button" type="button">Add hint</button>
              <div class="hint-list" id="hint-list"></div>
            </section>

            <section class="panel-card">
              <div class="panel-title">Share link</div>
              <div class="stats">
                <div class="stat-row"><span>Letters</span><strong id="stat-letters">${countAnswerLetters(draft.answer)}</strong></div>
                <div class="stat-row"><span>Hints</span><strong id="stat-hints">${draft.hints.length}</strong></div>
                <div class="stat-row"><span>Target par</span><strong id="stat-target">${draft.par}</strong></div>
              </div>
              <div class="share-url-wrap" style="margin-top: 14px;">
                <div class="share-url" id="share-url" style="display:block;padding:14px;border-radius:16px;background:#111111;color:#f8f4e8;overflow:auto;font:500 13px/1.5 SFMono-Regular,Consolas,\"Liberation Mono\",Menlo,monospace;white-space:pre-wrap;word-break:break-word;">Click Share to generate a link</div>
                <button class="share-button" id="share-button" type="button" style="margin-top:12px;">Share</button>
              </div>
              <div class="legend">
                <div class="legend-row"><span class="legend-swatch indicator"></span><strong>Indicator</strong></div>
                <div class="legend-row"><span class="legend-swatch fodder"></span><strong>Fodder</strong></div>
                <div class="legend-row"><span class="legend-swatch definition"></span><strong>Definition</strong></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    const authorInput = root.querySelector("#author-input");
    const clueInput = root.querySelector("#clue-input");
    const clueLengthPill = root.querySelector("#clue-length-pill");
    const answerInput = root.querySelector("#answer-input");
    const answerTiles = root.querySelector("#answer-tiles");
    const answerLengthPill = root.querySelector("#answer-length-pill");
    const parCircles = root.querySelector("#par-circles");
    const createParLabel = root.querySelector("#create-par-label");
    const hintList = root.querySelector("#hint-list");
    const addHintButton = root.querySelector("#add-hint-button");
    const shareUrlEl = root.querySelector("#share-url");
    const shareButton = root.querySelector("#share-button");
    const statLetters = root.querySelector("#stat-letters");
    const statHints = root.querySelector("#stat-hints");
    const statTarget = root.querySelector("#stat-target");

    const render = () => {
      const answerLengths = getWordLengths(draft.answer);
      clueLengthPill.textContent = answerLengths.length ? `(${answerLengths.join(", ")})` : "";
      answerInput.value = draft.answer;
      answerLengthPill.textContent = `${countAnswerLetters(draft.answer)} letters`;
      statLetters.textContent = String(countAnswerLetters(draft.answer));
      statHints.textContent = String(draft.hints.length);

      const maxPar = Math.max(countAnswerLetters(draft.answer) + draft.hints.length, 1);
      if (draft.par > maxPar) {
        draft.par = maxPar;
      }

      statTarget.textContent = String(draft.par);
      renderAnswerTiles(root, draft, answerTiles, true);
      renderParCircles(root, draft, parCircles, createParLabel);
      renderHintEditorList(root, draft, hintList, () => render());

      const hasAuthor = Boolean(String(draft.author || "").trim());
      shareButton.disabled = !hasAuthor;
      shareButton.textContent = hasAuthor ? (draft.shareId ? "Update" : "Share") : "Enter author";
    };

    authorInput.addEventListener("input", (event) => {
      draft.author = event.target.value;
      render();
    });

    clueInput.addEventListener("input", (event) => {
      draft.clue = stripCount(event.target.value);
      clueInput.value = draft.clue;
      render();
    });

    answerInput.addEventListener("input", (event) => {
      draft.answer = normalizeAnswer(event.target.value);
      draft.selectedAnswerIndex = Math.max(countAnswerLetters(draft.answer) - 1, 0);
      render();
    });

    answerTiles.addEventListener("click", (event) => {
      const button = event.target.closest("[data-answer-index]");
      if (!button) {
        return;
      }
      draft.selectedAnswerIndex = Number(button.getAttribute("data-answer-index"));
      render();
    });

    addHintButton.addEventListener("click", () => {
      draft.hints.push({ id: makeId(), text: "", type: "indicator", words: [] });
      render();
    });

    shareButton.addEventListener("click", async () => {
      if (!String(draft.author || "").trim()) {
        shareUrlEl.textContent = "Enter an author name before sharing.";
        return;
      }

      shareButton.disabled = true;
      shareButton.textContent = "Uploading…";
      shareUrlEl.textContent = "Uploading puzzle…";
      try {
        const shareUrl = await buildAndUploadShareUrl(draft);
        shareUrlEl.textContent = shareUrl;
        try {
          await navigator.clipboard.writeText(shareUrl);
          shareButton.textContent = "Copied";
        } catch (clipboardError) {
          window.prompt("Copy this link", shareUrl);
          shareButton.textContent = "Share";
        }
      } catch (error) {
        shareUrlEl.textContent = "Couldn't upload this puzzle. Check your connection and try again.";
      } finally {
        shareButton.disabled = false;
        window.setTimeout(() => {
          shareButton.textContent = String(draft.author || "").trim() ? (draft.shareId ? "Update" : "Share") : "Enter author";
        }, 1500);
      }
    });

    render();
  }

  function renderPlayMode(root, playState) {
    root.innerHTML += `
      <div class="page">
        <div class="topbar">
          <div class="topbar-left" style="gap: 3px;">
            <div class="date">${escapeHtml(playState.date)}</div>
            <div class="author-row"><span class="author-prefix">By</span><span style="font: 600 15px/1.2 'SF Pro Text', 'Segoe UI', sans-serif;">${escapeHtml(playState.author)}</span></div>
          </div>
          <div class="topbar-right">
            <a class="nav-link library-link" href="?view=library" aria-label="Open library">Library</a>
            <a class="github-link" href="https://dan1eltheman1el.github.io/custom-cryptic" rel="noreferrer" aria-label="Create your own puzzle" title="Create your own puzzle" style="width: 58px; height: 58px; margin-right: 8px; background: #fff2a8; text-decoration: none; font: 700 12px/1.1 'SF Pro Text', 'Segoe UI', sans-serif; text-align: center; padding: 8px; display: inline-flex; align-items: center; justify-content: center;">Create</a>
            <a class="github-link" href="https://github.com/Dan1elTheMan1el" target="_blank" rel="noreferrer" aria-label="GitHub profile">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.58 2 12.25C2 16.78 4.865 20.61 8.84 21.97C9.34 22.06 9.52 21.75 9.52 21.49C9.52 21.26 9.51 20.54 9.51 19.69C6.73 20.31 6.14 18.47 6.14 18.47C5.69 17.28 5.04 16.97 5.04 16.97C4.13 16.33 5.11 16.34 5.11 16.34C6.12 16.42 6.65 17.41 6.65 17.41C7.54 18.98 8.99 18.53 9.57 18.28C9.66 17.62 9.92 17.17 10.21 16.92C7.99 16.66 5.66 15.77 5.66 11.84C5.66 10.72 6.05 9.81 6.7 9.1C6.59 8.84 6.24 7.82 6.8 6.44C6.8 6.44 7.63 6.17 9.5 7.48C10.28 7.26 11.11 7.15 11.94 7.15C12.77 7.15 13.6 7.26 14.38 7.48C16.25 6.17 17.08 6.44 17.08 6.44C17.64 7.82 17.29 8.84 17.18 9.1C17.84 9.81 18.22 10.72 18.22 11.84C18.22 15.79 15.88 16.65 13.65 16.91C14.01 17.22 14.34 17.83 14.34 18.76C14.34 20.1 14.33 21.18 14.33 21.49C14.33 21.75 14.51 22.07 15.02 21.97C18.99 20.61 21.85 16.78 21.85 12.25C21.85 6.58 17.52 2 12 2Z" fill="currentColor"></path>
              </svg>
            </a>
          </div>
        </div>

        <div class="play-grid">
          <section class="card clue-card play-clue-wrap">
            <div class="play-clue-header">
              <div class="label">Clue</div>
            </div>
            <div id="play-clue" class="play-clue"></div>
          </section>

          <section class="card answer-card">
            <div class="play-clue-header" style="width: 100%;">
              <div class="label">Answer</div>
            </div>
            <div class="answer-row" id="play-answer-tiles" aria-label="Answer boxes"></div>
            
            <div class="play-controls">
              <button class="hint-toggle" id="hint-toggle" type="button">Hint</button>
              <button class="guess-button" id="guess-button" type="button">Guess</button>
            </div>
            <div class="guess-feedback" id="guess-feedback"></div>
            
            <div class="stacked-hints" id="stacked-hints"></div>
            
            <div class="play-meter">
              <div class="meter-dots" id="meter-dots"></div>
              <div class="meter-label" id="meter-label">par</div>
            </div>
          </section>

          <section class="panel-card">
            <div class="panel-title">Hints</div>
            <div class="hint-panel" id="hint-panel">
              <div class="hint-menu" id="hint-menu"></div>
            </div>
          </section>
        </div>
      </div>
    `;

    const playClue = root.querySelector("#play-clue");
    const playAnswerTiles = root.querySelector("#play-answer-tiles");
    const meterDots = root.querySelector("#meter-dots");
    const meterLabel = root.querySelector("#meter-label");
    const hintToggle = root.querySelector("#hint-toggle");
    const hintPanel = root.querySelector("#hint-panel");
    const hintMenu = root.querySelector("#hint-menu");
    const guessButton = root.querySelector("#guess-button");
    const guessFeedback = root.querySelector("#guess-feedback");
    const stackedHints = root.querySelector("#stacked-hints");

    const clueWords = tokenizeClue(playState.clue);
    const render = () => {
      playClue.innerHTML = renderPreviewClue(playState.clue, clueWords, playState.highlightedWords, playState.clueWordLengths);
      renderAnswerTiles(root, playState, playAnswerTiles, false);
      renderMeter(playState, meterDots, meterLabel);
      renderHintMenu(playState, hintMenu, () => render());
      renderStackedHints(playState, stackedHints);

      if (playState.solved) {
        hintPanel.classList.remove("open");
        guessButton.disabled = true;
        hintToggle.disabled = true;

        const score = playState.par - playState.usedHints.length;
        let scoreText = "";
        if (score > 0) scoreText = `(${score} under par)`;
        else if (score === 0) scoreText = `(On par)`;
        else scoreText = `(${Math.abs(score)} over par)`;
        guessFeedback.textContent = `Correct! ${scoreText}`;
      } else {
        hintPanel.classList.toggle("open", playState.hintPanelOpen);
        guessFeedback.textContent = playState.feedback || "";
      }
    };

    playAnswerTiles.addEventListener("input", (event) => {
      if (playState.solved) return;
      if (event.target.classList.contains("tile")) {
        const index = Number(event.target.getAttribute("data-answer-index"));
        const val = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
        event.target.value = val;

        const targetLen = countAnswerLetters(playState.answer);
        let guessArr = (playState.typedGuess || "").split("");
        while (guessArr.length < targetLen) guessArr.push(" ");
        guessArr[index] = val || " ";
        playState.typedGuess = guessArr.join("");

        if (val) {
          let next = index + 1;
          while (next < targetLen && playState.revealedLetters.includes(next)) {
            next++;
          }
          const nextInput = playAnswerTiles.querySelector(`[data-answer-index="${next}"]`);
          if (nextInput) nextInput.focus();
        }
      }
    });

    playAnswerTiles.addEventListener("keydown", (event) => {
      if (playState.solved) return;
      if (event.target.classList.contains("tile")) {
        const index = Number(event.target.getAttribute("data-answer-index"));

        if (event.key === "Backspace" && !event.target.value) {
          event.preventDefault();
          let prev = index - 1;
          while (prev >= 0 && playState.revealedLetters.includes(prev)) {
            prev--;
          }
          const prevInput = playAnswerTiles.querySelector(`[data-answer-index="${prev}"]`);
          if (prevInput) {
            prevInput.focus();
            prevInput.value = "";
            let guessArr = (playState.typedGuess || "").split("");
            guessArr[prev] = " ";
            playState.typedGuess = guessArr.join("");
          }
        } else if (event.key === "ArrowLeft") {
          let prev = index - 1;
          const prevInput = playAnswerTiles.querySelector(`[data-answer-index="${prev}"]`);
          if (prevInput) prevInput.focus();
        } else if (event.key === "ArrowRight") {
          let next = index + 1;
          const nextInput = playAnswerTiles.querySelector(`[data-answer-index="${next}"]`);
          if (nextInput) nextInput.focus();
        }
      }
    });

    hintToggle.addEventListener("click", () => {
      if (playState.solved) return;
      playState.hintPanelOpen = !playState.hintPanelOpen;
      render();
    });

    hintMenu.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) {
        return;
      }

      const action = button.getAttribute("data-action");
      if (action === "random-letter") {
        revealRandomLetter(playState);
      } else if (action === "hint") {
        const hintId = button.getAttribute("data-hint-id");
        const hint = playState.hints.find((entry) => entry.id === hintId);
        if (hint) {
          playState.usedHints = [...new Set([...playState.usedHints, hintId])];

          hint.words.forEach(wIndex => {
            playState.highlightedWords[wIndex] = hint.type;
          });
        }
      }

      render();
    });

    guessButton.addEventListener("click", () => {
      const solution = normalizeAnswer(playState.answer).replace(/\s/g, "");
      const typed = (playState.typedGuess || "").split("");
      // Ensure typed array has proper length
      while (typed.length < solution.length) typed.push(" ");

      // Build effective guess by applying revealed letters over typed input
      const combined = Array.from({ length: solution.length }, (_, idx) => {
        if (playState.revealedLetters.includes(idx)) {
          return solution[idx];
        }
        const ch = typed[idx] || " ";
        return ch === " " ? "" : ch;
      }).join("");

      const normalizedGuess = combined.replace(/\s/g, "");
      const normalizedAnswer = solution;

      if (normalizedGuess === normalizedAnswer && normalizedGuess.length === normalizedAnswer.length) {
        playState.solved = true;
        markPuzzleCompleted(playState.puzzleId || fileId || "");
        guessButton.classList.remove("wrong");
        guessButton.classList.add("right");
      } else {
        playState.feedback = "Try again";
        guessButton.classList.remove("right");
        guessButton.classList.add("wrong");
      }

      window.setTimeout(() => {
        guessButton.classList.remove("right", "wrong");
      }, 500);
      render();
    });

    render();
  }

  function renderLibraryMode(root, initialQuery, initialCursor) {
    root.innerHTML += `
      <div class="page">
        <div class="topbar">
          <div class="topbar-left" style="gap: 3px;">
            <div class="date">Puzzle Library</div>
            <div class="expiry-date">Search by clue or author</div>
          </div>
          <div class="topbar-right">
            <a class="nav-link library-link" href="https://dan1eltheman1el.github.io/custom-cryptic" aria-label="Create a puzzle">Create</a>
            <a class="github-link" href="https://github.com/Dan1elTheMan1el" target="_blank" rel="noreferrer" aria-label="GitHub profile">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.58 2 12.25C2 16.78 4.865 20.61 8.84 21.97C9.34 22.06 9.52 21.75 9.52 21.49C9.52 21.26 9.51 20.54 9.51 19.69C6.73 20.31 6.14 18.47 6.14 18.47C5.69 17.28 5.04 16.97 5.04 16.97C4.13 16.33 5.11 16.34 5.11 16.34C6.12 16.42 6.65 17.41 6.65 17.41C7.54 18.98 8.99 18.53 9.57 18.28C9.66 17.62 9.92 17.17 10.21 16.92C7.99 16.66 5.66 15.77 5.66 11.84C5.66 10.72 6.05 9.81 6.7 9.1C6.59 8.84 6.24 7.82 6.8 6.44C6.8 6.44 7.63 6.17 9.5 7.48C10.28 7.26 11.11 7.15 11.94 7.15C12.77 7.15 13.6 7.26 14.38 7.48C16.25 6.17 17.08 6.44 17.08 6.44C17.64 7.82 17.29 8.84 17.18 9.1C17.84 9.81 18.22 10.72 18.22 11.84C18.22 15.79 15.88 16.65 13.65 16.91C14.01 17.22 14.34 17.83 14.34 18.76C14.34 20.1 14.33 21.18 14.33 21.49C14.33 21.75 14.51 22.07 15.02 21.97C18.99 20.61 21.85 16.78 21.85 12.25C21.85 6.58 17.52 2 12 2Z" fill="currentColor"></path>
              </svg>
            </a>
          </div>
        </div>

        <section class="card clue-card" style="padding:20px 20px 16px;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
            <input id="library-search" class="answer-input" type="search" placeholder="Search puzzles by clue or author" value="${escapeHtml(initialQuery)}" style="flex:1 1 320px;text-align:left;">
            <div class="count-pill" id="library-count">Loading…</div>
          </div>
        </section>

        <section class="card answer-card" style="padding:20px;">
          <div id="library-list" style="display:grid;gap:12px;"></div>
          <div style="display:flex;gap:12px;justify-content:space-between;align-items:center;margin-top:18px;flex-wrap:wrap;">
            <button class="share-button" id="library-prev" type="button" disabled>Previous</button>
            <button class="share-button" id="library-next" type="button" disabled>Next</button>
          </div>
        </section>
      </div>
    `;

    const searchInput = root.querySelector("#library-search");
    const listEl = root.querySelector("#library-list");
    const countEl = root.querySelector("#library-count");
    const prevButton = root.querySelector("#library-prev");
    const nextButton = root.querySelector("#library-next");

    const state = {
      query: initialQuery,
      cursor: initialCursor,
      nextCursor: "",
      cursorStack: [],
      loading: false,
      items: [],
      error: "",
    };

    const completedIds = getCompletedPuzzleIds();

    const updateUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "library");
      if (state.query) {
        url.searchParams.set("q", state.query);
      } else {
        url.searchParams.delete("q");
      }
      if (state.cursor) {
        url.searchParams.set("cursor", state.cursor);
      } else {
        url.searchParams.delete("cursor");
      }
      window.history.replaceState(null, "", url.toString());
    };

    const render = () => {
      countEl.textContent = state.loading ? "Loading…" : `${state.items.length} result${state.items.length === 1 ? "" : "s"}`;
      if (state.error) {
        listEl.innerHTML = `<div style="font:600 15px/1.5 'SF Pro Text','Segoe UI',sans-serif;color:rgba(17,17,17,0.72);padding:18px 4px;">${escapeHtml(state.error)}</div>`;
      } else {
        listEl.innerHTML = state.items.length
          ? state.items.map((item) => {
            const completed = completedIds.includes(item.id) ? '<span class="count-pill" style="padding:4px 8px;font-size:12px;background:#c7f5c7;">Completed</span>' : '';
            const dateText = item.date || item.updatedAt || '';
            return `
            <a href="?p=${encodeURIComponent(item.id)}" style="text-decoration:none;color:inherit;display:block;">
              <article class="panel-card" style="padding:16px 16px 14px;background:#fffdf4;">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                  <div style="display:grid;gap:6px;min-width:0;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                      <strong style="font:800 16px/1.2 'SF Pro Text','Segoe UI',sans-serif;">${escapeHtml(item.author || 'Anonymous')}</strong>
                        ${dateText ? `<span style="font:600 13px/1.2 'SF Pro Text','Segoe UI',sans-serif;color:rgba(17,17,17,0.62);">${escapeHtml(dateText)}</span>` : ''}
                      <span class="count-pill" style="padding:4px 8px;font-size:12px;">Par ${escapeHtml(String(item.par || 0))}</span>
                      ${completed}
                    </div>
                    <div style="font:600 15px/1.4 'SF Pro Text','Segoe UI',sans-serif;color:rgba(17,17,17,0.8);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;">${escapeHtml(item.clue || '')}</div>
                  </div>
                </div>
              </article>
            </a>
          `;
          }).join("")
          : `<div style="font:600 15px/1.5 'SF Pro Text','Segoe UI',sans-serif;color:rgba(17,17,17,0.72);padding:18px 4px;">No puzzles found.</div>`;
      }
      prevButton.disabled = state.cursorStack.length === 0 || state.loading;
      nextButton.disabled = !state.nextCursor || state.loading;
      updateUrl();
    };

    const loadPage = async () => {
      state.loading = true;
      render();
      try {
        state.error = "";
        const data = await fetchLibraryPage(state.query, state.cursor);
        state.items = data.items || [];
        state.nextCursor = data.cursor || "";
      } catch (error) {
        state.items = [];
        state.nextCursor = "";
        state.error = error && error.message ? error.message : "Couldn't load library";
      } finally {
        state.loading = false;
        render();
      }
    };

    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      state.query = searchInput.value.trim();
      state.cursor = "";
      state.nextCursor = "";
      state.cursorStack = [];
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadPage(), 250);
    });

    prevButton.addEventListener("click", () => {
      if (!state.cursorStack.length) return;
      state.cursor = state.cursorStack.pop() || "";
      loadPage();
    });

    nextButton.addEventListener("click", () => {
      if (!state.nextCursor) return;
      state.cursorStack.push(state.cursor);
      state.cursor = state.nextCursor;
      loadPage();
    });

    loadPage();
  }

  function renderHintEditorList(root, draft, hintList, onChange) {
    const clueWords = tokenizeClue(draft.clue);
    hintList.innerHTML = draft.hints.map((hint, index) => {
      const tone = hintTone(hint.type);
      const chips = clueWords.map((word, wordIndex) => {
        const active = hint.words.includes(wordIndex) ? `active ${tone}` : "";
        return `<button type="button" class="chip ${active}" data-hint-id="${hint.id}" data-word-index="${wordIndex}">${escapeHtml(word)}</button>`;
      }).join("");

      return `
        <section class="hint-card ${tone}" data-hint-id="${hint.id}">
          <div class="hint-top">
            <div class="hint-type-row">
              ${["indicator", "fodder", "definition"].map((type) => `<button type="button" class="type-button ${hint.type === type ? `active ${type}` : ""}" data-hint-type="${type}" data-hint-id="${hint.id}">${type}</button>`).join("")}
            </div>
            <div class="hint-actions">
              <button type="button" class="action-button" data-hint-action="up" data-hint-id="${hint.id}" ${index === 0 ? "disabled" : ""}>Up</button>
              <button type="button" class="action-button" data-hint-action="down" data-hint-id="${hint.id}" ${index === draft.hints.length - 1 ? "disabled" : ""}>Down</button>
              <button type="button" class="action-button" data-hint-action="delete" data-hint-id="${hint.id}">Delete</button>
            </div>
          </div>
          <textarea class="hint-text" data-hint-id="${hint.id}" placeholder="Enter hint text">${escapeHtml(hint.text)}</textarea>
          <div class="hint-words">${chips}</div>
        </section>
      `;
    }).join("");

    hintList.querySelectorAll(".hint-text").forEach((textarea) => {
      textarea.addEventListener("input", (event) => {
        const hint = draft.hints.find((entry) => entry.id === textarea.getAttribute("data-hint-id"));
        if (hint) {
          hint.text = event.target.value;
        }
      });
    });

    if (hintList.dataset.wired === "true") {
      return;
    }
    hintList.dataset.wired = "true";

    hintList.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) {
        return;
      }

      const hintId = button.getAttribute("data-hint-id");
      const hint = draft.hints.find((entry) => entry.id === hintId);
      if (!hint) {
        return;
      }

      if (button.hasAttribute("data-hint-type")) {
        hint.type = button.getAttribute("data-hint-type");
        onChange();
        return;
      }

      const action = button.getAttribute("data-hint-action");
      if (action === "delete") {
        draft.hints = draft.hints.filter((entry) => entry.id !== hintId);
        if (!draft.hints.length) {
          draft.hints = [{ id: makeId(), text: "", type: "indicator", words: [] }];
        }
        onChange();
        return;
      }

      if (action === "up") {
        const index = draft.hints.findIndex((entry) => entry.id === hintId);
        if (index > 0) {
          const [item] = draft.hints.splice(index, 1);
          draft.hints.splice(index - 1, 0, item);
          onChange();
        }
        return;
      }

      if (action === "down") {
        const index = draft.hints.findIndex((entry) => entry.id === hintId);
        if (index < draft.hints.length - 1) {
          const [item] = draft.hints.splice(index, 1);
          draft.hints.splice(index + 1, 0, item);
          onChange();
        }
        return;
      }

      const wordIndex = button.getAttribute("data-word-index");
      if (wordIndex !== null) {
        const indexNumber = Number(wordIndex);
        hint.words = hint.words.includes(indexNumber)
          ? hint.words.filter((value) => value !== indexNumber)
          : [...hint.words, indexNumber].sort((left, right) => left - right);
        onChange();
      }
    });
  }

  function renderPreviewClue(clue, words, highlightedWords, lengths) {
    const tokens = tokenizeClue(clue);
    const clueText = tokens.map((word, index) => {
      const tone = highlightedWords[index];
      return `<span class="${tone ? `highlighted-word ${tone}` : ""}">${escapeHtml(word)}</span>`;
    }).join(" ");
    const lengthText = Array.isArray(lengths) && lengths.length ? ` <span class="clue-lengths">(${escapeHtml(lengths.join(", "))})</span>` : "";
    return `<span class="clue-text-wrap">${clueText}${lengthText}</span>`;
  }

  function renderAnswerTiles(root, data, container, isCreateMode) {
    const normalized = normalizeAnswer(data.answer).trim();
    const groups = normalized ? normalized.split(/\s+/).filter(Boolean) : [""];
    const letters = groups.join("").split("");
    // typedGuess is stored as an array-like string where each position maps to a letter index
    let guessArr = [];
    if (isCreateMode) {
      guessArr = letters.slice();
    } else {
      guessArr = (data.typedGuess || "").split("");
      while (guessArr.length < letters.length) guessArr.push(" ");
    }
    const totalLetters = letters.length;
    const isSolved = !isCreateMode && data.solved;

    let letterIndex = 0;
    const groupHtml = groups.map((group, groupIndex) => {
      const tiles = group.split("").map((letter) => {
        const index = letterIndex++;
        const revealed = !isCreateMode && data.revealedLetters.includes(index);
        const locked = revealed || isSolved;
        const shown = isCreateMode
          ? letter
          : (guessArr[index] && guessArr[index] !== " " ? guessArr[index] : (revealed ? letter : ""));

        if (isCreateMode) {
          const selected = index === data.selectedAnswerIndex ? "selected" : "";
          return `<button type="button" class="tile ${selected}" data-answer-index="${index}" aria-label="Letter ${index + 1} of ${totalLetters}">${escapeHtml(shown)}</button>`;
        } else {
          const lockClass = locked ? "revealed" : "";
          const finalShown = isSolved ? letter : shown;
          return `<input type="text" maxlength="1" class="tile ${lockClass}" data-answer-index="${index}" aria-label="Letter ${index + 1} of ${totalLetters}" value="${escapeHtml(finalShown)}" ${locked ? 'readonly tabindex="-1"' : ''}>`;
        }
      }).join("");
      return `<span class="answer-group">${tiles}</span>`;
    }).join('<span class="answer-gap" aria-hidden="true"></span>');

    container.innerHTML = groupHtml;
  }

  function renderParCircles(root, data, container, label) {
    const total = Math.max(countAnswerLetters(data.answer) + data.hints.length, 1);
    container.innerHTML = Array.from({ length: total }, (_, index) => {
      const active = index + 1 === data.par ? "active" : "";
      return `<button type="button" class="par-circle ${active}" data-par="${index + 1}" aria-label="Set par to ${index + 1}"></button>`;
    }).join("");

    if (label) {
      label.textContent = `par ${data.par}`;
    }

    container.querySelectorAll("[data-par]").forEach((button) => {
      button.addEventListener("click", () => {
        data.par = Number(button.getAttribute("data-par"));
        renderParCircles(root, data, container, label);
      });
    });
  }

  function renderMeter(data, dotsContainer, label) {
    const used = data.usedHints.length;
    const total = Math.max(data.par, countAnswerLetters(data.answer) + data.hints.length, 1);
    dotsContainer.innerHTML = Array.from({ length: total }, (_, index) => `<span class="meter-dot ${index < used ? "active" : ""}" aria-hidden="true"></span>`).join("");
    if (label) {
      label.textContent = `par ${data.par}`;
    }
  }

  function renderStackedHints(data, container) {
    if (!container) return;
    if (data.usedHints.length === 0 && !data.solved) {
      container.innerHTML = "";
      return;
    }

    const counts = countHintsByType(data.hints);
    const getHintLabel = (hint) => {
      const typeCap = hint.type.charAt(0).toUpperCase() + hint.type.slice(1);
      if (counts[hint.type].length > 1) {
        const index = counts[hint.type].indexOf(hint) + 1;
        return `${typeCap} ${index}`;
      }
      return typeCap;
    };

    let html = "";

    // Display used hints first
    data.usedHints.forEach(hintId => {
      if (String(hintId).startsWith("letter-")) {
        const idx = parseInt(hintId.split("-")[1], 10);
        html += `<div class="stacked-hint random"><strong>Random letter</strong>: Revealed letter ${idx + 1}</div>`;
      } else {
        const hint = data.hints.find(h => h.id === hintId);
        if (hint) {
          const text = hint.text || `${hint.type} hint revealed`;
          html += `<div class="stacked-hint ${hintTone(hint.type)}"><strong>${escapeHtml(getHintLabel(hint))}</strong>: ${escapeHtml(text)}</div>`;
        }
      }
    });

    // Display any remaining unrevealed hints if solved
    if (data.solved) {
      data.hints.forEach(hint => {
        if (!data.usedHints.includes(hint.id)) {
          const text = hint.text || `${hint.type} hint revealed`;
          html += `<div class="stacked-hint ${hintTone(hint.type)}"><strong>${escapeHtml(getHintLabel(hint))}</strong>: ${escapeHtml(text)}</div>`;
        }
      });
    }

    container.innerHTML = html;
  }

  function renderHintMenu(data, container, onChange) {
    if (!data.hintPanelOpen) {
      container.innerHTML = "";
      return;
    }

    const counts = countHintsByType(data.hints);
    const labelFor = (hint) => {
      const typeCap = hint.type.charAt(0).toUpperCase() + hint.type.slice(1);
      if (counts[hint.type].length > 1) {
        const index = counts[hint.type].indexOf(hint) + 1;
        return `${typeCap} ${index}`;
      }
      return typeCap;
    };

    container.innerHTML = `
      <button class="hint-choice random" data-action="random-letter" type="button">Reveal random letter</button>
      ${data.hints.map((hint) => {
      const used = data.usedHints.includes(hint.id);
      const revealedIndicator = used ? ` (Used)` : "";
      return `<button class="hint-choice ${hintTone(hint.type)}" data-action="hint" data-hint-id="${hint.id}" type="button">${escapeHtml(labelFor(hint))}${revealedIndicator}</button>`;
    }).join("")}
    `;
  }

  function countHintsByType(hints) {
    return hints.reduce((accumulator, hint) => {
      if (!accumulator[hint.type]) {
        accumulator[hint.type] = [];
      }
      accumulator[hint.type].push(hint);
      return accumulator;
    }, { indicator: [], fodder: [], definition: [] });
  }

  function revealRandomLetter(data) {
    const solution = normalizeAnswer(data.answer).replace(/\s/g, "");
    const unrevealed = solution.split("").map((letter, index) => index).filter((index) => !data.revealedLetters.includes(index));
    if (!unrevealed.length) {
      return;
    }

    const chosenIndex = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    data.revealedLetters = [...data.revealedLetters, chosenIndex];
    data.usedHints = [...new Set([...data.usedHints, `letter-${chosenIndex}`])];
    data.feedback = ""; // Feedback handled visually via stacking now

    // Do NOT modify `typedGuess` here — mark the letter as revealed so it
    // appears permanently in the UI, but avoid injecting the character into
    // the user's typed guess or other positions.
  }

  function hintTone(type) {
    return ["indicator", "fodder", "definition"].includes(type) ? type : "indicator";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function stripCount(value) {
    return String(value || "").replace(/\s*\(\d+\)\s*$/, "");
  }

  function stripCountForLoad(value) {
    return stripCount(value).trim();
  }

  function normalizeAnswer(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ");
  }

  function countAnswerLetters(value) {
    return normalizeAnswer(value).replace(/\s/g, "").length;
  }

  function tokenizeClue(value) {
    return String(value || "").trim().split(/\s+/).filter(Boolean);
  }

  function parseHints(value) {
    if (!value) {
      return [];
    }

    return String(value)
      .split("|")
      .map((hint) => hint.trim())
      .filter(Boolean)
      .map((text) => ({ id: makeId(), text, type: "indicator", words: [] }));
  }

  function buildSharePayload(draft) {
    return {
      id: draft.shareId || null,
      date: draft.date,
      author: draft.author,
      clue: draft.clue.trim(),
      answer: draft.answer,
      hints: draft.hints,
      par: draft.par,
      editKey: draft.editKey || null,
    };
  }

  // Cloudflare Worker-backed storage functions.
  // The worker exposes:
  //  - POST /p       -> create puzzle, returns { id }
  //  - GET  /p/:id    -> fetch puzzle JSON
  async function uploadSharedPayload(payload) {
    const base = WORKER_HOST.replace(/\/$/, "");
    const url = payload.editKey ? `${base}/p/${encodeURIComponent(payload.id)}` : `${base}/p`;
    const bodyText = JSON.stringify(payload);
    // Client-side safeguard: don't try to upload extremely large payloads
    const MAX_BODY = 200 * 1024; // 200KB
    if (bodyText.length > MAX_BODY) {
      throw new Error("Payload too large");
    }

    const response = await fetch(url, {
      method: payload.editKey ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Upload failed (${response.status}) ${text}`);
    }

    const data = await response.json();
    if (!data || !data.id || !data.editKey) throw new Error("Unexpected response from worker");
    return data;
  }

  async function buildAndUploadShareUrl(draft) {
    const payload = buildSharePayload(draft);
    const result = await uploadSharedPayload(payload);
    draft.shareId = result.id;
    draft.editKey = result.editKey;
    saveDraftRecord(result.id, result.editKey);
    const url = new URL(window.location.href);
    url.search = `?p=${encodeURIComponent(result.id)}`;
    url.hash = "";
    return url.toString();
  }

  async function fetchSharedPayloadById(fileId) {
    const url = `${WORKER_HOST.replace(/\/$/, "")}/p/${encodeURIComponent(fileId)}`;
    const controller = new AbortController();
    const timeoutMs = 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, { method: "GET", signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw new Error('Network error while fetching puzzle');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Fetch failed (${response.status}) ${text}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      throw new Error(`Unexpected response content-type: ${contentType} ${text}`);
    }

    try {
      return await response.json();
    } catch (err) {
      throw new Error('Failed to parse puzzle JSON');
    }
  }

  function renderLoadingState(root) {
    root.innerHTML += `
      <div class="page">
        <div class="content">
          <section class="card clue-card" style="text-align:center;padding:60px 28px;">
            <div class="label">Loading puzzle…</div>
          </section>
        </div>
      </div>
    `;
  }

  function getStoredDraftRecords() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveDraftRecord(id, editKey) {
    if (!id || !editKey) {
      return;
    }

    const records = getStoredDraftRecords();
    const next = [
      { id, editKey, updatedAt: new Date().toISOString() },
      ...records.filter((entry) => entry.id !== id),
    ];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 25)));
    } catch (error) {
      // Ignore storage quota failures.
    }
  }

  function getCompletedPuzzleIds() {
    try {
      const raw = window.localStorage.getItem(COMPLETED_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function markPuzzleCompleted(id) {
    if (!id) {
      return;
    }

    const ids = new Set(getCompletedPuzzleIds());
    ids.add(id);

    try {
      window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(0, 1000)));
    } catch (error) {
      // Ignore storage quota failures.
    }
  }

  async function fetchLibraryPage(query, cursor) {
    const url = new URL(`${WORKER_HOST.replace(/\/$/, "")}/library`);
    if (query) {
      url.searchParams.set("q", query);
    }
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    url.searchParams.set("limit", "18");

    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Library fetch failed (${response.status}) ${text}`);
    }
    return response.json();
  }

  function getAnswerWordLengths(answer) {
    return getWordLengths(answer);
  }

  function getWordLengths(text) {
    return tokenizeClue(text).map((word) => word.length);
  }

  function renderLoadError(root) {
    root.innerHTML = buildStyles();
    root.innerHTML += `
      <div class="page">
        <div class="content">
          <section class="card clue-card" style="text-align:center;padding:60px 28px;">
            <div class="label" style="margin-bottom:12px;">Couldn't load this puzzle</div>
            <div style="font:600 15px/1.5 'SF Pro Text','Segoe UI',sans-serif;color:rgba(17,17,17,0.7);margin-bottom:20px;">
              The link may have expired, been mistyped, or your browser may be blocking the request.
            </div>
            <a href="${window.location.origin}${window.location.pathname}" style="display:inline-block;border:3px solid #111111;border-radius:999px;padding:10px 20px;font:700 15px/1.2 'SF Pro Text','Segoe UI',sans-serif;text-decoration:none;color:#111111;">Start a new puzzle</a>
          </section>
        </div>
      </div>
    `;
  }

  // Legacy format (?c=<base64 JSON>) — kept so previously shared links still open.
  function decodeSharedPayload(value) {
    if (!value) {
      return null;
    }

    try {
      let base64 = value.replace(/-/g, "+").replace(/_/g, "/");

      while (base64.length % 4 !== 0) {
        base64 += "=";
      }

      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      return null;
    }
  }

  function makeId() {
    return `hint-${Math.random().toString(36).slice(2, 10)}`;
  }
})();