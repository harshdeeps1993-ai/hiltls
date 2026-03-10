(function () {
  "use strict";

  let allEpisodes = [];
  let fuse = null;
  let activeTags = new Set();
  let currentSort = "newest";

  // DOM refs
  const searchInput = document.getElementById("search-input");
  const sortSelect = document.getElementById("sort-select");
  const tagCloud = document.getElementById("tag-cloud");
  const episodesList = document.getElementById("episodes-list");
  const resultsCount = document.getElementById("results-count");

  // ── Data loading ──────────────────────────────────────────────────

  async function init() {
    try {
      const res = await fetch("data/episodes.json");
      allEpisodes = await res.json();
    } catch (e) {
      episodesList.innerHTML =
        '<p>Failed to load episode data. Make sure <code>data/episodes.json</code> exists.</p>';
      return;
    }

    fuse = new Fuse(allEpisodes, {
      keys: [
        { name: "title", weight: 0.25 },
        { name: "guest", weight: 0.2 },
        { name: "summary", weight: 0.1 },
        { name: "keyQuestions", weight: 0.1 },
        { name: "keyAnswers", weight: 0.1 },
        { name: "tags", weight: 0.12 },
        { name: "actionableTakeaways", weight: 0.05 },
        { name: "sourcesAndReferences", weight: 0.08 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    });

    buildTagCloud();
    render();

    // Event listeners
    searchInput.addEventListener("input", debounce(render, 200));
    sortSelect.addEventListener("change", function () {
      currentSort = this.value;
      render();
    });
  }

  // ── Tag cloud ─────────────────────────────────────────────────────

  function buildTagCloud() {
    const counts = {};
    for (const ep of allEpisodes) {
      for (const tag of ep.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }

    // Sort tags by frequency descending, take top 25
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);

    tagCloud.innerHTML = "";
    for (const [tag, count] of sorted) {
      const pill = document.createElement("span");
      pill.className = "tag-pill";
      pill.textContent = tag + " (" + count + ")";
      pill.dataset.tag = tag;
      pill.addEventListener("click", function () {
        if (activeTags.has(tag)) {
          activeTags.delete(tag);
          pill.classList.remove("active");
        } else {
          activeTags.add(tag);
          pill.classList.add("active");
        }
        render();
      });
      tagCloud.appendChild(pill);
    }
  }

  // ── Filtering & sorting ───────────────────────────────────────────

  function getFilteredEpisodes() {
    const query = searchInput.value.trim();
    let results;

    if (query.length > 0) {
      results = fuse.search(query).map(function (r) {
        return r.item;
      });
    } else {
      results = allEpisodes.slice();
    }

    // Tag filter (AND logic)
    if (activeTags.size > 0) {
      results = results.filter(function (ep) {
        for (const tag of activeTags) {
          if (ep.tags.indexOf(tag) === -1) return false;
        }
        return true;
      });
    }

    // Sort
    results.sort(function (a, b) {
      switch (currentSort) {
        case "newest":
          return b.date.localeCompare(a.date);
        case "oldest":
          return a.date.localeCompare(b.date);
        case "longest":
          return b.durationSeconds - a.durationSeconds;
        case "shortest":
          return a.durationSeconds - b.durationSeconds;
        case "alpha":
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

    return results;
  }

  // ── Rendering ─────────────────────────────────────────────────────

  function render() {
    const episodes = getFilteredEpisodes();
    resultsCount.textContent =
      "Showing " + episodes.length + " of " + allEpisodes.length + " episodes";

    episodesList.innerHTML = "";
    for (const ep of episodes) {
      episodesList.appendChild(createCard(ep));
    }
  }

  function createCard(ep) {
    const card = document.createElement("article");
    card.className = "episode-card";

    const dateStr = formatDate(ep.date);

    card.innerHTML =
      '<div class="episode-header">' +
      "  <div>" +
      '    <h3>' + escapeHtml(ep.title) + "</h3>" +
      '    <div class="episode-meta">' +
      "      <span>" + escapeHtml(ep.guest) + "</span>" +
      "      <span>" + dateStr + "</span>" +
      "      <span>" + escapeHtml(ep.duration) + "</span>" +
      "    </div>" +
      '    <div class="episode-tags">' +
      ep.tags
        .map(function (t) {
          return '<span class="episode-tag">' + escapeHtml(t) + "</span>";
        })
        .join("") +
      "    </div>" +
      "  </div>" +
      '  <span class="episode-number">#' + ep.id + "</span>" +
      "</div>" +
      (ep.summary ? '<p class="episode-summary">' + escapeHtml(ep.summary) + "</p>" : "") +
      '<div class="expand-indicator">Click to expand</div>' +
      '<div class="episode-detail">' +
      buildDetailHTML(ep) +
      "</div>";

    card.addEventListener("click", function (e) {
      // Don't collapse if clicking a link
      if (e.target.tagName === "A") return;
      card.classList.toggle("expanded");
    });

    return card;
  }

  function buildDetailHTML(ep) {
    var html = "";

    if (ep.keyQuestions && ep.keyQuestions.length) {
      html += '<div class="detail-section">';
      html += "<h4>Key Questions</h4><ul>";
      for (var i = 0; i < ep.keyQuestions.length; i++) {
        html += "<li>" + escapeHtml(ep.keyQuestions[i]) + "</li>";
      }
      html += "</ul></div>";
    }

    if (ep.keyAnswers && ep.keyAnswers.length) {
      html += '<div class="detail-section">';
      html += "<h4>Key Answers &amp; Claims</h4><ul>";
      for (var i = 0; i < ep.keyAnswers.length; i++) {
        html += "<li>" + escapeHtml(ep.keyAnswers[i]) + "</li>";
      }
      html += "</ul></div>";
    }

    if (ep.sourcesAndReferences && ep.sourcesAndReferences.length) {
      html += '<div class="detail-section">';
      html += "<h4>Sources &amp; References</h4><ul>";
      for (var i = 0; i < ep.sourcesAndReferences.length; i++) {
        html += "<li>" + escapeHtml(ep.sourcesAndReferences[i]) + "</li>";
      }
      html += "</ul></div>";
    }

    if (ep.actionableTakeaways && ep.actionableTakeaways.length) {
      html += '<div class="detail-section">';
      html += "<h4>Actionable Takeaways</h4><ul>";
      for (var i = 0; i < ep.actionableTakeaways.length; i++) {
        html += "<li>" + escapeHtml(ep.actionableTakeaways[i]) + "</li>";
      }
      html += "</ul></div>";
    }

    html +=
      '<a class="episode-link" href="' +
      escapeHtml(ep.url) +
      '" target="_blank" rel="noopener">Listen on Buzzsprout &rarr;</a>';

    return html;
  }

  // ── Utilities ─────────────────────────────────────────────────────

  function formatDate(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    var months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  // ── Start ─────────────────────────────────────────────────────────

  init();
})();
