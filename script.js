(function () {
  "use strict";

  var BATCH_SIZE = 11;
  var STORAGE_KEY = window.QUIZ_STORAGE_KEY || "texasPcStudyGuideProgress_v6_essential";
  var questions = Array.isArray(window.QUIZ_QUESTIONS) ? window.QUIZ_QUESTIONS : [];
  var questionById = {};

  questions.forEach(function (question) {
    questionById[String(question.id)] = question;
  });

  var progressEl = document.getElementById("progress");
  var quizPanel = document.getElementById("quizPanel");
  var summaryPanel = document.getElementById("summaryPanel");
  var sectionLabelEl = document.getElementById("sectionLabel");
  var questionTextEl = document.getElementById("questionText");
  var feedbackEl = document.getElementById("feedback");
  var nextButton = document.getElementById("nextButton");
  var repeatButton = document.getElementById("repeatButton");
  var choicesEl = document.getElementById("choices");
  var batchNavEl = document.getElementById("batchNav");
  var summaryEl = document.getElementById("summary");
  var restartBatchButton = document.getElementById("restartBatch");
  var resetProgressButton = document.getElementById("resetProgress");

  if (new URLSearchParams(window.location.search).get("mode") === "phone") {
    document.body.classList.add("phoneMode");
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.setTimeout(function () {
      window.scrollTo(0, 0);
    }, 0);
  }

  var state = loadState();
  normalizeState();
  render();

  choicesEl.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-choice]");
    if (!button || state.currentResult || state.finished) {
      return;
    }
    answerCurrentQuestion(button.getAttribute("data-choice"));
  });

  nextButton.addEventListener("click", function () {
    if (!state.currentResult || state.finished) {
      return;
    }
    moveNext();
  });

  repeatButton.addEventListener("click", function () {
    repeatCurrentQuestion();
  });

  restartBatchButton.addEventListener("click", function () {
    restartCurrentBatch();
  });

  resetProgressButton.addEventListener("click", function () {
    if (window.confirm("Reset all saved practice exam progress?")) {
      state = freshState();
      saveState();
      render();
    }
  });

  batchNavEl.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-batch-index]");
    if (!button) {
      return;
    }
    jumpToBatch(Number(button.getAttribute("data-batch-index")));
  });

  summaryEl.addEventListener("click", function (event) {
    if (event.target.closest("#reviewMostMissed")) {
      startMostMissedReview();
    }
  });

  function freshState() {
    return {
      currentBatchIndex: 0,
      currentQuestionIndex: 0,
      mode: "batch",
      reviewPile: [],
      reviewQueue: [],
      finalReviewQueue: [],
      missedQuestionIds: [],
      repeatQuestionIds: [],
      firstTryCorrectIds: [],
      firstTryCorrectCount: 0,
      missCounts: {},
      currentResult: null,
      finished: questions.length === 0
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && typeof saved === "object" ? Object.assign(freshState(), saved) : freshState();
    } catch (error) {
      return freshState();
    }
  }

  function saveState() {
    state.firstTryCorrectCount = state.firstTryCorrectIds.length;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function normalizeState() {
    state.currentBatchIndex = clampNumber(state.currentBatchIndex, 0, Math.max(getTotalBatches() - 1, 0));
    state.currentQuestionIndex = clampNumber(state.currentQuestionIndex, 0, Number.MAX_SAFE_INTEGER);
    state.mode = ["batch", "review", "finalReview"].indexOf(state.mode) !== -1 ? state.mode : "batch";
    state.reviewPile = cleanIdArray(state.reviewPile);
    state.reviewQueue = cleanIdArray(state.reviewQueue).filter(function (id) {
      return state.reviewPile.indexOf(id) !== -1;
    });
    state.finalReviewQueue = cleanIdArray(state.finalReviewQueue);
    state.missedQuestionIds = cleanIdArray(state.missedQuestionIds);
    state.repeatQuestionIds = cleanIdArray(state.repeatQuestionIds);
    state.firstTryCorrectIds = cleanIdArray(state.firstTryCorrectIds);
    state.firstTryCorrectCount = state.firstTryCorrectIds.length;
    state.missCounts = cleanMissCounts(state.missCounts);

    if (state.mode === "review" && state.reviewQueue.length === 0 && state.reviewPile.length > 0) {
      state.reviewQueue = shuffle(state.reviewPile.slice());
    }

    var activeQuestions = getActiveQuestions();
    if (state.currentQuestionIndex >= activeQuestions.length) {
      state.currentQuestionIndex = Math.max(activeQuestions.length - 1, 0);
    }

    if (questions.length === 0) {
      state.finished = true;
    }
    saveState();
  }

  function cleanIdArray(value) {
    var seen = {};
    var result = [];
    if (!Array.isArray(value)) {
      return result;
    }
    value.forEach(function (id) {
      var normalizedId = String(id);
      if (questionById[normalizedId] && !seen[normalizedId]) {
        seen[normalizedId] = true;
        result.push(normalizedId);
      }
    });
    return result;
  }

  function cleanMissCounts(value) {
    var result = {};
    if (!value || typeof value !== "object") {
      return result;
    }
    Object.keys(value).forEach(function (id) {
      var normalizedId = String(id);
      var count = Number(value[id]);
      if (questionById[normalizedId] && Number.isFinite(count) && count > 0) {
        result[normalizedId] = Math.floor(count);
      }
    });
    return result;
  }

  function clampNumber(value, min, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(Math.max(Math.floor(number), min), max);
  }

  function getTotalBatches() {
    return Math.ceil(questions.length / BATCH_SIZE);
  }

  function getBatchQuestions(batchIndex) {
    var start = batchIndex * BATCH_SIZE;
    return questions.slice(start, start + BATCH_SIZE);
  }

  function getActiveQuestions() {
    if (state.mode === "review") {
      return state.reviewQueue.map(getQuestionById).filter(Boolean);
    }
    if (state.mode === "finalReview") {
      return state.finalReviewQueue.map(getQuestionById).filter(Boolean);
    }
    return getBatchQuestions(state.currentBatchIndex);
  }

  function getQuestionById(id) {
    return questionById[String(id)] || null;
  }

  function getCurrentQuestion() {
    return getActiveQuestions()[state.currentQuestionIndex] || null;
  }

  function answerCurrentQuestion(selectedLetter) {
    var question = getCurrentQuestion();
    if (!question) {
      return;
    }

    var correctLetter = getAnswerLetter(question.answer);
    var normalizedSelection = selectedLetter.toUpperCase();
    var isCorrect = normalizedSelection === correctLetter;
    var id = String(question.id);

    if (state.mode === "batch") {
      if (isCorrect) {
        if (state.missedQuestionIds.indexOf(id) === -1) {
          addUnique(state.firstTryCorrectIds, id);
        }
      } else {
        recordMiss(id);
        addUnique(state.reviewPile, id);
      }
    } else if (state.mode === "review") {
      if (isCorrect) {
        removeId(state.reviewPile, id);
      } else {
        recordMiss(id);
        addUnique(state.reviewPile, id);
      }
    } else if (state.mode === "finalReview") {
      if (!isCorrect) {
        recordMiss(id);
        addUnique(state.finalReviewQueue, id);
      }
    }

    state.currentResult = {
      selectedLetter: normalizedSelection,
      correctLetter: correctLetter,
      isCorrect: isCorrect
    };
    saveState();
    render();
  }

  function recordMiss(id) {
    addUnique(state.missedQuestionIds, id);
    state.missCounts[id] = (state.missCounts[id] || 0) + 1;
  }

  function repeatCurrentQuestion() {
    var question = getCurrentQuestion();
    if (!question || !state.currentResult) {
      return;
    }

    var id = String(question.id);
    addUnique(state.repeatQuestionIds, id);
    if (state.mode === "finalReview") {
      addUnique(state.finalReviewQueue, id);
    } else {
      addUnique(state.reviewPile, id);
    }
    saveState();
    render();
  }

  function getAnswerLetter(answer) {
    var match = String(answer || "").trim().match(/^[A-Da-d]/);
    return match ? match[0].toUpperCase() : "";
  }

  function addUnique(list, id) {
    id = String(id);
    if (list.indexOf(id) === -1) {
      list.push(id);
    }
  }

  function removeId(list, id) {
    var index = list.indexOf(String(id));
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  function moveNext() {
    if (state.mode === "batch") {
      moveNextFromBatch();
    } else if (state.mode === "review") {
      moveNextFromReview();
    } else {
      moveNextFromFinalReview();
    }

    saveState();
    render();
  }

  function moveNextFromBatch() {
    var batchQuestions = getBatchQuestions(state.currentBatchIndex);
    if (state.currentQuestionIndex + 1 < batchQuestions.length) {
      state.currentQuestionIndex += 1;
      state.currentResult = null;
    } else if (state.reviewPile.length > 0) {
      state.mode = "review";
      state.reviewQueue = shuffle(state.reviewPile.slice());
      state.currentQuestionIndex = 0;
      state.currentResult = null;
    } else {
      advanceBatch();
    }
  }

  function moveNextFromReview() {
    if (state.currentQuestionIndex + 1 < state.reviewQueue.length) {
      state.currentQuestionIndex += 1;
      state.currentResult = null;
    } else if (state.reviewPile.length > 0) {
      state.reviewQueue = shuffle(state.reviewPile.slice());
      state.currentQuestionIndex = 0;
      state.currentResult = null;
    } else {
      advanceBatch();
    }
  }

  function moveNextFromFinalReview() {
    var question = getCurrentQuestion();
    var answeredCorrectly = Boolean(state.currentResult && state.currentResult.isCorrect);
    if (question && answeredCorrectly) {
      removeId(state.finalReviewQueue, question.id);
    }

    if (state.finalReviewQueue.length === 0) {
      state.finished = true;
      state.currentResult = null;
    } else if (answeredCorrectly && state.currentQuestionIndex < state.finalReviewQueue.length) {
      state.currentResult = null;
    } else if (state.currentQuestionIndex + 1 < state.finalReviewQueue.length) {
      state.currentQuestionIndex += 1;
      state.currentResult = null;
    } else {
      state.finalReviewQueue = sortMostMissed(state.finalReviewQueue);
      state.currentQuestionIndex = 0;
      state.currentResult = null;
    }
  }

  function advanceBatch() {
    var nextBatchIndex = state.currentBatchIndex + 1;
    if (nextBatchIndex >= getTotalBatches()) {
      state.finished = true;
      state.currentResult = null;
      return;
    }

    state.currentBatchIndex = nextBatchIndex;
    state.currentQuestionIndex = 0;
    state.mode = "batch";
    state.reviewPile = [];
    state.reviewQueue = [];
    state.currentResult = null;
  }

  function restartCurrentBatch() {
    var batchIds = getBatchQuestions(state.currentBatchIndex).map(function (question) {
      return String(question.id);
    });

    state.firstTryCorrectIds = state.firstTryCorrectIds.filter(function (id) {
      return batchIds.indexOf(id) === -1;
    });
    state.missedQuestionIds = state.missedQuestionIds.filter(function (id) {
      return batchIds.indexOf(id) === -1;
    });
    state.repeatQuestionIds = state.repeatQuestionIds.filter(function (id) {
      return batchIds.indexOf(id) === -1;
    });
    batchIds.forEach(function (id) {
      delete state.missCounts[id];
    });

    state.currentQuestionIndex = 0;
    state.mode = "batch";
    state.reviewPile = [];
    state.reviewQueue = [];
    state.finalReviewQueue = [];
    state.currentResult = null;
    state.finished = false;
    saveState();
    render();
    scrollToPageTop();
  }

  function jumpToBatch(batchIndex) {
    state.currentBatchIndex = clampNumber(batchIndex, 0, Math.max(getTotalBatches() - 1, 0));
    state.currentQuestionIndex = 0;
    state.mode = "batch";
    state.reviewPile = [];
    state.reviewQueue = [];
    state.finalReviewQueue = [];
    state.currentResult = null;
    state.finished = false;
    saveState();
    render();
    scrollToPageTop();
  }

  function startMostMissedReview() {
    var queue = sortMostMissed(state.missedQuestionIds.slice());
    if (queue.length === 0) {
      return;
    }
    state.finished = false;
    state.mode = "finalReview";
    state.finalReviewQueue = queue;
    state.currentQuestionIndex = 0;
    state.currentResult = null;
    saveState();
    render();
  }

  function sortMostMissed(ids) {
    return cleanIdArray(ids).sort(function (left, right) {
      var countDifference = (state.missCounts[right] || 0) - (state.missCounts[left] || 0);
      if (countDifference !== 0) {
        return countDifference;
      }
      return Number(left) - Number(right);
    });
  }

  function shuffle(list) {
    for (var index = list.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(Math.random() * (index + 1));
      var value = list[index];
      list[index] = list[swapIndex];
      list[swapIndex] = value;
    }
    return list;
  }

  function render() {
    if (state.finished) {
      renderSummary();
      return;
    }

    var question = getCurrentQuestion();
    if (!question) {
      renderSummary();
      return;
    }

    quizPanel.classList.remove("hidden");
    summaryPanel.classList.add("hidden");
    quizPanel.classList.toggle("correct", Boolean(state.currentResult && state.currentResult.isCorrect));
    restartBatchButton.disabled = state.mode === "finalReview";
    nextButton.disabled = !state.currentResult;
    repeatButton.disabled = !state.currentResult || isCurrentMarkedForRepeat();

    progressEl.textContent = getProgressText();
    sectionLabelEl.textContent = getSectionLine(question);
    questionTextEl.textContent = question.question;
    renderBatchNav();
    renderChoiceButtons();
    renderFeedback(question);
  }

  function getProgressText() {
    var batchNumber = state.currentBatchIndex + 1;
    var totalBatches = getTotalBatches();
    var activeTotal = getActiveQuestions().length;
    var position = Math.min(state.currentQuestionIndex + 1, activeTotal);

    if (state.mode === "review") {
      return "Batch " + batchNumber + " of " + totalBatches + " / Review " + position + " of " + activeTotal;
    }
    if (state.mode === "finalReview") {
      return "Most-missed review / Question " + position + " of " + activeTotal;
    }
    return "Batch " + batchNumber + " of " + totalBatches + " / Question " + position + " of " + activeTotal;
  }

  function getSectionLine(question) {
    var pieces = [formatSection(question.section), question.subsection].filter(Boolean);
    return pieces.join(" / ");
  }

  function formatSection(section) {
    return String(section || "")
      .replace(/^\d+_/, "")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function isCurrentMarkedForRepeat() {
    var question = getCurrentQuestion();
    if (!question) {
      return false;
    }
    var id = String(question.id);
    if (state.mode === "finalReview") {
      return state.finalReviewQueue.indexOf(id) !== -1 && state.currentResult && !state.currentResult.isCorrect;
    }
    return state.reviewPile.indexOf(id) !== -1;
  }

  function renderChoiceButtons() {
    Array.prototype.forEach.call(choicesEl.querySelectorAll("button[data-choice]"), function (button) {
      var choice = button.getAttribute("data-choice");
      button.disabled = Boolean(state.currentResult);
      button.classList.toggle("selected", Boolean(state.currentResult && state.currentResult.selectedLetter === choice));
    });
  }

  function renderFeedback(question) {
    if (!state.currentResult) {
      feedbackEl.textContent = "";
      return;
    }

    var status = state.currentResult.isCorrect ? "Correct." : "Incorrect.";
    feedbackEl.innerHTML = "";

    var strong = document.createElement("strong");
    strong.textContent = status;
    feedbackEl.appendChild(strong);

    var answer = document.createElement("div");
    answer.textContent = "Correct answer: " + question.answer;
    feedbackEl.appendChild(answer);

    if (question.insight) {
      var insight = document.createElement("div");
      insight.className = "insight";

      var title = document.createElement("span");
      title.className = "insightTitle";
      title.textContent = "Insight";
      insight.appendChild(title);

      var copy = document.createElement("div");
      copy.textContent = question.insight;
      insight.appendChild(copy);
      feedbackEl.appendChild(insight);
    }
  }

  function renderBatchNav() {
    batchNavEl.innerHTML = "";
    for (var index = 0; index < getTotalBatches(); index += 1) {
      var start = index * BATCH_SIZE + 1;
      var end = Math.min(start + BATCH_SIZE - 1, questions.length);
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-batch-index", String(index));
      button.classList.toggle("active", index === state.currentBatchIndex && state.mode !== "finalReview");
      button.textContent = getBatchLabel(index, start, end);
      batchNavEl.appendChild(button);
    }
  }

  function getBatchLabel(batchIndex, start, end) {
    var batchQuestions = getBatchQuestions(batchIndex);
    var firstSection = batchQuestions[0] ? formatSection(batchQuestions[0].section) : "Section";
    var lastSection = batchQuestions[batchQuestions.length - 1] ? formatSection(batchQuestions[batchQuestions.length - 1].section) : firstSection;
    var sectionText = firstSection === lastSection ? firstSection : firstSection + " / " + lastSection;
    var label = "Batch " + (batchIndex + 1) + " (" + start + "-" + end + ")";
    return sectionText ? label + ": " + sectionText : label;
  }

  function renderSummary() {
    state.finished = true;
    saveState();

    quizPanel.classList.add("hidden");
    quizPanel.classList.remove("correct");
    summaryPanel.classList.remove("hidden");
    restartBatchButton.disabled = true;
    progressEl.textContent = "Complete";
    renderBatchNav();

    var missedQuestions = sortMostMissed(state.missedQuestionIds.slice()).map(getQuestionById).filter(Boolean);

    summaryEl.innerHTML = "";
    appendSummaryLine("Total questions", questions.length);
    appendSummaryLine("Total correct on first try", state.firstTryCorrectCount);
    appendSummaryLine("Total missed", missedQuestions.length);
    appendSummaryLine("Marked to repeat", state.repeatQuestionIds.length);

    var actions = document.createElement("div");
    actions.className = "summaryActions";
    var reviewButton = document.createElement("button");
    reviewButton.id = "reviewMostMissed";
    reviewButton.type = "button";
    reviewButton.textContent = "Repeat the ones missed most";
    reviewButton.disabled = missedQuestions.length === 0;
    actions.appendChild(reviewButton);
    summaryEl.appendChild(actions);

    var heading = document.createElement("h3");
    heading.textContent = "Questions missed at least once";
    summaryEl.appendChild(heading);

    if (missedQuestions.length === 0) {
      var none = document.createElement("p");
      none.textContent = "None";
      summaryEl.appendChild(none);
      return;
    }

    var list = document.createElement("ol");
    list.className = "missed-list";
    missedQuestions.forEach(function (question) {
      var item = document.createElement("li");
      var missCount = state.missCounts[String(question.id)] || 0;
      item.textContent = question.question + "\nCorrect answer: " + question.answer + "\nMissed: " + missCount;
      list.appendChild(item);
    });
    summaryEl.appendChild(list);
  }

  function appendSummaryLine(label, value) {
    var line = document.createElement("p");
    line.textContent = label + ": " + value;
    summaryEl.appendChild(line);
  }

  function scrollToPageTop() {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }
}());
