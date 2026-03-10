(function () {
  "use strict";

  let allQuestions = [];
  let allEpisodes = [];
  let fuse = null;
  let activeTags = new Set();

  const searchInput = document.getElementById("search-input");
  const tagCloud = document.getElementById("tag-cloud");
  const questionsList = document.getElementById("questions-list");
  const resultsCount = document.getElementById("results-count");

  async function init() {
    try {
      const [qRes, eRes] = await Promise.all([
        fetch("data/questions.json"),
        fetch("data/episodes.json"),
      ]);
      allQuestions = await qRes.json();
      allEpisodes = await eRes.json();
    } catch (e) {
      questionsList.innerHTML =
        "<p>Failed to load data. Make sure <code>data/questions.json</code> and <code>data/episodes.json</code> exist.</p>";
      return;
    }

    fuse = new Fuse(allQuestions, {
      keys: [
        { name: "question", weight: 0.35 },
        { name: "answer", weight: 0.35 },
        { name: "tags", weight: 0.3 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    });

    buildTagCloud();
    render();

    searchInput.addEventListener("input", debounce(render, 200));
  }

  function buildTagCloud() {
    var counts = {};
    for (var i = 0; i < allQuestions.length; i++) {
      var tags = allQuestions[i].tags;
      for (var j = 0; j < tags.length; j++) {
        counts[tags[j]] = (counts[tags[j]] || 0) + 1;
      }
    }

    var sorted = Object.entries(counts)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 20);

    tagCloud.innerHTML = "";
    for (var i = 0; i < sorted.length; i++) {
      var tag = sorted[i][0];
      var count = sorted[i][1];
      var pill = document.createElement("span");
      pill.className = "tag-pill";
      pill.textContent = tag + " (" + count + ")";
      pill.dataset.tag = tag;
      pill.addEventListener("click", (function (t, el) {
        return function () {
          if (activeTags.has(t)) {
            activeTags.delete(t);
            el.classList.remove("active");
          } else {
            activeTags.add(t);
            el.classList.add("active");
          }
          render();
        };
      })(tag, pill));
      tagCloud.appendChild(pill);
    }
  }

  function getFiltered() {
    var query = searchInput.value.trim();
    var results;

    if (query.length > 0) {
      results = fuse.search(query).map(function (r) { return r.item; });
    } else {
      results = allQuestions.slice();
    }

    if (activeTags.size > 0) {
      results = results.filter(function (q) {
        for (var tag of activeTags) {
          if (q.tags.indexOf(tag) === -1) return false;
        }
        return true;
      });
    }

    return results;
  }

  function render() {
    var questions = getFiltered();
    resultsCount.textContent =
      "Showing " + questions.length + " of " + allQuestions.length + " questions";

    questionsList.innerHTML = "";
    for (var i = 0; i < questions.length; i++) {
      questionsList.appendChild(createCard(questions[i]));
    }
  }

  function createCard(q) {
    var card = document.createElement("article");
    card.className = "qa-card";

    var tagsHtml = q.tags
      .map(function (t) {
        return '<span class="episode-tag">' + escapeHtml(t) + "</span>";
      })
      .join("");

    var episodeLinks = q.relatedEpisodes
      .map(function (epId) {
        var ep = allEpisodes.find(function (e) { return e.id === epId; });
        if (!ep) return '<span class="ep-link">#' + epId + "</span>";
        return '<a class="ep-link" href="index.html?ep=' + epId + '" title="' + escapeHtml(ep.title) + '">#' + epId + "</a>";
      })
      .join(" ");

    card.innerHTML =
      '<div class="qa-header">' +
      '  <h3 class="qa-question">' + escapeHtml(q.question) + "</h3>" +
      '  <span class="qa-toggle">+</span>' +
      "</div>" +
      '<div class="qa-body">' +
      '  <p class="qa-answer">' + escapeHtml(q.answer) + "</p>" +
      '  <div class="qa-meta">' +
      '    <div class="qa-episodes"><strong>Related episodes:</strong> ' + episodeLinks + "</div>" +
      '    <div class="episode-tags">' + tagsHtml + "</div>" +
      "  </div>" +
      "</div>";

    card.addEventListener("click", function (e) {
      if (e.target.tagName === "A") return;
      card.classList.toggle("expanded");
      var toggle = card.querySelector(".qa-toggle");
      toggle.textContent = card.classList.contains("expanded") ? "\u2212" : "+";
    });

    return card;
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

  init();
})();
