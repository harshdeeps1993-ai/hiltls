(function () {
  "use strict";

  // ── Configuration ───────────────────────────────────────────────
  var WORKER_URL = "https://hiltls-chat.harshdeeps1993.workers.dev";
  // For local development, uncomment:
  // var WORKER_URL = "http://localhost:8787";

  var FUSE_THRESHOLD = 0.45;
  var MAX_EPISODES = 8;
  var MAX_QUESTIONS = 3;
  var MAX_QA_PER_EPISODE = 5;
  var MAX_ANSWER_LENGTH = 300;
  var MAX_HISTORY = 4; // pairs of user/assistant messages

  // ── State ───────────────────────────────────────────────────────
  var allEpisodes = [];
  var allQuestions = [];
  var transcriptMap = {}; // id -> transcript text
  var episodeFuse = null;
  var questionFuse = null;
  var conversationHistory = [];
  var isOpen = false;
  var isLoading = false;

  // ── DOM creation ────────────────────────────────────────────────

  function createChatDOM() {
    // FAB button
    var fab = document.createElement("button");
    fab.id = "chat-fab";
    fab.setAttribute("aria-label", "Open chat");
    fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    document.body.appendChild(fab);

    // Chat panel
    var panel = document.createElement("div");
    panel.id = "chat-panel";
    panel.innerHTML =
      '<div class="chat-header">' +
      '  <span class="chat-title">Ask about HILTLS</span>' +
      '  <button class="chat-close" aria-label="Close chat">&times;</button>' +
      "</div>" +
      '<div class="chat-messages" id="chat-messages"></div>' +
      '<div class="chat-input-row">' +
      '  <input type="text" id="chat-input" placeholder="Ask a question..." maxlength="500" aria-label="Chat message">' +
      '  <button id="chat-send" aria-label="Send message">' +
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>' +
      "  </button>" +
      "</div>";
    document.body.appendChild(panel);

    return { fab: fab, panel: panel };
  }

  // ── Data loading ────────────────────────────────────────────────

  async function loadData() {
    try {
      var epRes = await fetch("data/episodes.json");
      allEpisodes = await epRes.json();
    } catch (e) {
      console.error("Chat: failed to load episodes.json", e);
      return false;
    }

    try {
      var qRes = await fetch("data/questions.json");
      allQuestions = await qRes.json();
    } catch (e) {
      console.warn("Chat: failed to load questions.json", e);
    }

    try {
      var tRes = await fetch("data/transcripts.json");
      var transcripts = await tRes.json();
      for (var i = 0; i < transcripts.length; i++) {
        transcriptMap[transcripts[i].id] = transcripts[i].transcript;
      }
      console.log("Chat: loaded " + transcripts.length + " transcripts");
    } catch (e) {
      console.warn("Chat: failed to load transcripts.json", e);
    }

    episodeFuse = new Fuse(allEpisodes, {
      keys: [
        { name: "title", weight: 0.25 },
        { name: "guest", weight: 0.2 },
        { name: "summary", weight: 0.15 },
        { name: "keyQuestions", weight: 0.15 },
        { name: "keyAnswers", weight: 0.1 },
        { name: "tags", weight: 0.15 },
      ],
      threshold: FUSE_THRESHOLD,
      ignoreLocation: true,
    });

    if (allQuestions.length > 0) {
      questionFuse = new Fuse(allQuestions, {
        keys: [
          { name: "question", weight: 0.4 },
          { name: "answer", weight: 0.3 },
          { name: "tags", weight: 0.3 },
        ],
        threshold: FUSE_THRESHOLD,
        ignoreLocation: true,
      });
    }

    return true;
  }

  // ── Context compression ─────────────────────────────────────────

  function compressEpisode(ep) {
    var qa = [];
    var questions = ep.keyQuestions || [];
    var answers = ep.keyAnswers || [];
    for (var i = 0; i < Math.min(questions.length, MAX_QA_PER_EPISODE); i++) {
      var answer = i < answers.length ? answers[i] : "";
      if (answer.length > MAX_ANSWER_LENGTH) {
        answer = answer.substring(0, MAX_ANSWER_LENGTH) + "...";
      }
      qa.push({ q: questions[i], a: answer });
    }

    var compressed = {
      id: ep.id,
      title: ep.title,
      guest: ep.guest,
      tags: ep.tags,
      summary: ep.summary,
      qa: qa,
    };

    // Include full transcript if available
    var transcript = transcriptMap[ep.id];
    if (transcript) {
      compressed.transcript = transcript;
    }

    return compressed;
  }

  function findRelevantContext(query) {
    var episodes = [];
    var questions = [];

    // Search episodes
    var epResults = episodeFuse.search(query);
    for (var i = 0; i < Math.min(epResults.length, MAX_EPISODES); i++) {
      episodes.push(compressEpisode(epResults[i].item));
    }

    // If no Fuse results, pick a few recent episodes as fallback
    if (episodes.length === 0) {
      var sorted = allEpisodes.slice().sort(function (a, b) {
        return b.id - a.id;
      });
      for (var i = 0; i < Math.min(sorted.length, 4); i++) {
        episodes.push(compressEpisode(sorted[i]));
      }
    }

    // Search synthesized questions
    if (questionFuse) {
      var qResults = questionFuse.search(query);
      for (var i = 0; i < Math.min(qResults.length, MAX_QUESTIONS); i++) {
        questions.push(qResults[i].item);
      }
    }

    return { episodes: episodes, questions: questions };
  }

  // ── Message rendering ───────────────────────────────────────────

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function parseEpisodeCitations(text) {
    // Convert [Episode #N] to clickable links
    return escapeHtml(text).replace(
      /\[Episode #(\d+)\]/g,
      function (match, num) {
        return '<a href="index.html" class="chat-citation" data-episode="' + num + '">[Episode #' + num + "]</a>";
      }
    );
  }

  function formatResponse(text) {
    // Parse citations, then convert double newlines to paragraph breaks
    var html = parseEpisodeCitations(text);
    html = html.replace(/\n\n/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    return "<p>" + html + "</p>";
  }

  function addMessage(container, role, content) {
    var bubble = document.createElement("div");
    bubble.className = "chat-bubble chat-" + role;

    if (role === "assistant") {
      bubble.innerHTML = formatResponse(content);
    } else {
      bubble.textContent = content;
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  function addThinkingIndicator(container) {
    var bubble = document.createElement("div");
    bubble.className = "chat-bubble chat-assistant chat-thinking";
    bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
  }

  function showWelcome(container) {
    var welcome = document.createElement("div");
    welcome.className = "chat-welcome";
    welcome.innerHTML =
      "<p>Hi! I can answer questions about the <strong>How I Learned to Love Shrimp</strong> podcast. I have data from all 64 episodes.</p>" +
      '<div class="chat-starters">' +
      '  <button class="chat-starter">What are the most effective animal advocacy strategies?</button>' +
      '  <button class="chat-starter">Which episodes discuss alternative proteins?</button>' +
      '  <button class="chat-starter">How is animal advocacy growing in the Global South?</button>' +
      "</div>";
    container.appendChild(welcome);

    var starters = welcome.querySelectorAll(".chat-starter");
    for (var i = 0; i < starters.length; i++) {
      starters[i].addEventListener("click", function () {
        var input = document.getElementById("chat-input");
        input.value = this.textContent;
        input.focus();
        handleSend();
      });
    }
  }

  // ── API call ────────────────────────────────────────────────────

  async function sendToWorker(question, episodes, questions, history) {
    var res = await fetch(WORKER_URL + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question,
        episodes: episodes,
        questions: questions,
        history: history,
      }),
    });

    var data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Request failed");
    }

    return data.answer;
  }

  // ── Send handler ────────────────────────────────────────────────

  async function handleSend() {
    if (isLoading) return;

    var input = document.getElementById("chat-input");
    var messages = document.getElementById("chat-messages");
    var question = input.value.trim();

    if (!question) return;

    // Remove welcome message if present
    var welcome = messages.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    // Show user message
    input.value = "";
    addMessage(messages, "user", question);

    // Find relevant context
    var context = findRelevantContext(question);

    // Show thinking indicator
    isLoading = true;
    updateSendButton();
    var thinking = addThinkingIndicator(messages);

    try {
      // Build history for API (last N exchanges)
      var historyForApi = conversationHistory.slice(-MAX_HISTORY * 2);

      var answer = await sendToWorker(
        question,
        context.episodes,
        context.questions,
        historyForApi
      );

      // Remove thinking indicator
      thinking.remove();

      // Show response
      addMessage(messages, "assistant", answer);

      // Update conversation history
      conversationHistory.push({ role: "user", content: question });
      conversationHistory.push({ role: "assistant", content: answer });
    } catch (err) {
      thinking.remove();
      addMessage(messages, "assistant", "Sorry, something went wrong: " + err.message);
    } finally {
      isLoading = false;
      updateSendButton();
      input.focus();
    }
  }

  function updateSendButton() {
    var btn = document.getElementById("chat-send");
    btn.disabled = isLoading;
  }

  // ── Citation click handler ──────────────────────────────────────

  function handleCitationClick(e) {
    var link = e.target.closest(".chat-citation");
    if (!link) return;

    e.preventDefault();
    var episodeNum = link.dataset.episode;

    // If we're on the episodes page, scroll to and expand the episode
    var cards = document.querySelectorAll(".episode-card");
    for (var i = 0; i < cards.length; i++) {
      var numEl = cards[i].querySelector(".episode-number");
      if (numEl && numEl.textContent === "#" + episodeNum) {
        cards[i].classList.add("expanded");
        cards[i].scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    // If episode not found on current page (e.g., filtered out or on questions page),
    // navigate to episodes page
    window.location.href = "index.html#episode-" + episodeNum;
  }

  // ── Init ────────────────────────────────────────────────────────

  async function init() {
    var dom = createChatDOM();
    var fab = dom.fab;
    var panel = dom.panel;
    var input = document.getElementById("chat-input");
    var sendBtn = document.getElementById("chat-send");
    var closeBtn = panel.querySelector(".chat-close");
    var messages = document.getElementById("chat-messages");

    // Toggle panel
    fab.addEventListener("click", function () {
      isOpen = !isOpen;
      panel.classList.toggle("open", isOpen);
      fab.classList.toggle("hidden", isOpen);
      if (isOpen) {
        input.focus();
      }
    });

    closeBtn.addEventListener("click", function () {
      isOpen = false;
      panel.classList.remove("open");
      fab.classList.remove("hidden");
    });

    // Send on Enter
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    sendBtn.addEventListener("click", handleSend);

    // Citation clicks
    messages.addEventListener("click", handleCitationClick);

    // Load data and show welcome
    var loaded = await loadData();
    if (loaded) {
      showWelcome(messages);
    } else {
      addMessage(messages, "assistant", "Failed to load episode data. Chat is unavailable.");
    }
  }

  // ── Start ───────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
