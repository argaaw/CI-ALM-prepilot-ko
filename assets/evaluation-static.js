(() => {
  const DEFAULT_VARIANTS = ["ci_vocoded", "original"];
  const SAVE_DELAY_MS = 650;
  const UI = {
    en: {
      participantIdError: "Enter a participant ID between 1 and 64 characters without control characters.",
      requestFailed: "Request failed",
      notSubmitted: "Not submitted yet",
      submissionTimeUnavailable: "Submission time unavailable",
      lastSubmitted: "Last submitted",
      submit: "Submit current responses",
      resubmit: "Resubmit current responses",
      loadingResponses: "Loading responses…",
      readyToSave: "Ready to save",
      offline: "Offline — saved in this browser",
      required: "Required",
      optional: "Optional",
      requiredSamples: "Required samples",
      optionalSamples: "Optional samples",
      responses: "responses",
      noSamples: "No Include single-audio samples",
      noSamplesTitle: "No samples",
      variants: { original: "Original audio", ci_vocoded: "CI-vocoded audio" },
      play: "play",
      previousNext: "prev/next",
      freeResponse: "Free response",
      optionalNote: "(optional)",
      freeResponsePlaceholder: "If you think a more appropriate answer is not listed among the options, please enter it here.",
      waitingToSave: "Waiting to save",
      saved: "Saved",
      notAnswered: "Not answered yet",
      saving: "Saving…",
      autosaved: "Autosaved",
      saveFailed: "Save failed — kept in this browser",
      preparingSubmission: "Preparing submission…",
      someResponsesFailed: "Some responses could not be saved.",
      submitted: "Submitted",
      submissionFailed: "Submission failed",
      siteLoadFailed: "Could not load the evaluation site",
    },
    ko: {
      participantIdError: "제어 문자를 제외한 1~64자의 참가자 ID를 입력하세요.",
      requestFailed: "요청을 완료하지 못했습니다",
      notSubmitted: "아직 제출하지 않음",
      submissionTimeUnavailable: "제출 시간을 확인할 수 없음",
      lastSubmitted: "마지막 제출",
      submit: "현재 응답 제출",
      resubmit: "현재 응답 다시 제출",
      loadingResponses: "응답을 불러오는 중…",
      readyToSave: "저장할 준비됨",
      offline: "오프라인 — 이 브라우저에 저장됨",
      required: "필수",
      optional: "선택",
      requiredSamples: "필수 음원",
      optionalSamples: "선택 음원",
      responses: "응답",
      noSamples: "포함된 단일 음원이 없습니다",
      noSamplesTitle: "음원이 없습니다",
      variants: { original: "원본 음원", ci_vocoded: "CI 보코딩 음원" },
      play: "재생",
      previousNext: "이전/다음",
      freeResponse: "자유 응답",
      optionalNote: "(선택)",
      freeResponsePlaceholder: "보기 중에 더 적절한 답이 없다고 생각되면 여기에 입력하세요.",
      waitingToSave: "저장 대기 중",
      saved: "저장됨",
      notAnswered: "아직 응답하지 않음",
      saving: "저장 중…",
      autosaved: "자동 저장됨",
      saveFailed: "저장하지 못했습니다 — 이 브라우저에 보관됨",
      preparingSubmission: "제출 준비 중…",
      someResponsesFailed: "일부 응답을 저장하지 못했습니다.",
      submitted: "제출됨",
      submissionFailed: "제출하지 못했습니다",
      siteLoadFailed: "평가 사이트를 불러오지 못했습니다",
    },
  };
  const state = {
    evaluation: null,
    participantId: null,
    answers: new Map(),
    selectedTask: null,
    selectedSampleByTask: new Map(),
    selectedVariantBySample: new Map(),
    saveTimers: new Map(),
    submittedAt: null,
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);

  const answerKey = (task, sampleId, variant) => JSON.stringify([task, sampleId, variant]);
  const participantStorageKey = () => `human-evaluation:${state.evaluation.evaluation_id}:participant`;
  const answerStorageKey = () => (
    `human-evaluation:${state.evaluation.evaluation_id}:${state.participantId}:answers`
  );
  const ui = () => UI[state.evaluation?.language || document.documentElement.lang] || UI.en;
  const variants = () => state.evaluation?.audio_variants || DEFAULT_VARIANTS;
  const taskLabel = (task) => task.label || task.id;

  function normalizeParticipantId(value) {
    const normalized = String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
    if (!normalized || normalized.length > 64 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw new Error(ui().participantIdError);
    }
    return normalized;
  }

  function currentTask() {
    return state.evaluation.tasks.find((task) => task.id === state.selectedTask);
  }

  function currentSample() {
    const task = currentTask();
    const sampleId = state.selectedSampleByTask.get(task?.id);
    return task?.samples.find((sample) => sample.id === sampleId) ?? task?.samples[0] ?? null;
  }

  function currentVariant(sample = currentSample()) {
    return state.selectedVariantBySample.get(sample?.id) || variants()[0];
  }

  function emptyAnswer() {
    return { selected_options: [], comment: "", updated_at: null, pending: false };
  }

  function answerFor(task, sampleId, variant) {
    return state.answers.get(answerKey(task, sampleId, variant)) || emptyAnswer();
  }

  function persistAnswers() {
    if (!state.participantId) return;
    localStorage.setItem(
      answerStorageKey(),
      JSON.stringify(Object.fromEntries(state.answers)),
    );
  }

  function loadLocalAnswers() {
    state.answers.clear();
    try {
      const raw = JSON.parse(localStorage.getItem(answerStorageKey()) || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      Object.entries(raw).forEach(([key, value]) => {
        if (!value || typeof value !== "object") return;
        state.answers.set(key, {
          selected_options: Array.isArray(value.selected_options)
            ? value.selected_options.map(String)
            : [],
          comment: String(value.comment ?? ""),
          updated_at: value.updated_at || null,
          pending: Boolean(value.pending),
        });
      });
    } catch (error) {
      console.warn("Could not restore local evaluation answers", error);
    }
  }

  async function apiRequest(body) {
    const response = await fetch(state.evaluation.api_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        evaluation_id: state.evaluation.evaluation_id,
        participant_id: state.participantId,
      }),
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok) {
      throw new Error(
        state.evaluation?.language === "ko"
          ? ui().requestFailed
          : payload.error || `${ui().requestFailed} (${response.status}).`,
      );
    }
    return payload;
  }

  function setSaveStatus(message, kind = "") {
    const target = document.querySelector("[data-save-status]");
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function formatTimestamp(value) {
    if (!value) return ui().notSubmitted;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return ui().submissionTimeUnavailable;
    return `${ui().lastSubmitted}: ${new Intl.DateTimeFormat(
      state.evaluation?.language === "ko" ? "ko-KR" : "en",
      {
      dateStyle: "medium", timeStyle: "short",
      },
    ).format(date)}`;
  }

  function renderSubmissionState() {
    document.querySelector("[data-submission-state]").textContent = formatTimestamp(
      state.submittedAt,
    );
    document.querySelector("[data-submit]").textContent = state.submittedAt
      ? ui().resubmit
      : ui().submit;
  }

  function mergeServerAnswers(rows) {
    [...state.answers.entries()].forEach(([key, answer]) => {
      if (!answer.pending) state.answers.delete(key);
    });
    rows.forEach((row) => {
      const key = answerKey(row.task, row.sample_id, row.audio_variant);
      const local = state.answers.get(key);
      if (local?.pending) return;
      state.answers.set(key, {
        selected_options: Array.isArray(row.selected_options) ? row.selected_options : [],
        comment: String(row.comment ?? ""),
        updated_at: row.updated_at || null,
        pending: false,
      });
    });
    persistAnswers();
  }

  async function beginSession(participantId) {
    state.participantId = normalizeParticipantId(participantId);
    localStorage.setItem(participantStorageKey(), state.participantId);
    loadLocalAnswers();
    document.querySelector("[data-participant-label]").textContent = state.participantId;
    document.querySelector("[data-identity-error]").hidden = true;
    setSaveStatus(ui().loadingResponses);
    try {
      const payload = await apiRequest({ action: "resume" });
      mergeServerAnswers(payload.answers || []);
      state.submittedAt = payload.submitted_at || null;
      setSaveStatus(ui().readyToSave, "saved");
    } catch (error) {
      console.error(error);
      setSaveStatus(ui().offline, "pending");
    }
    document.querySelector("[data-identity-card]").hidden = true;
    document.querySelector("[data-evaluation-app]").hidden = false;
    document.querySelector("[data-session-actions]").hidden = false;
    renderAll();
  }

  function responseCount(sample, task) {
    return variants().reduce((total, variant) => {
      const answer = answerFor(task, sample.id, variant);
      return total + (answer.selected_options.length || answer.comment.trim() ? 1 : 0);
    }, 0);
  }

  function renderTasks() {
    document.querySelector("[data-task-list]").innerHTML = state.evaluation.tasks.map((task) => {
      const required = task.samples.filter((sample) => sample.required).length;
      const optional = task.samples.length - required;
      return `<button type="button" class="task-toggle${task.id === state.selectedTask ? " is-active" : ""}" data-task="${escapeHtml(task.id)}" aria-pressed="${task.id === state.selectedTask}"><strong>${escapeHtml(taskLabel(task))}</strong><small>${required} ${ui().required} · ${optional} ${ui().optional}</small></button>`;
    }).join("");
  }

  function sampleRows(samples, task, optional) {
    return samples.map((sample) => {
      const active = sample.id === state.selectedSampleByTask.get(task.id);
      const number = task.samples.indexOf(sample) + 1;
      return `<button type="button" class="sample-row${active ? " is-active" : ""}" data-sample-id="${escapeHtml(sample.id)}"><span class="sample-icon">♪</span><span class="sample-main"><strong>${number}</strong><small>${ui().responses} ${responseCount(sample, task.id)}/2</small></span><span class="evaluation-kind${optional ? " optional" : ""}">${optional ? ui().optional : ui().required}</span></button>`;
    }).join("");
  }

  function sampleSection(task, required) {
    const samples = task.samples.filter((sample) => sample.required === required);
    if (!samples.length) return "";
    const label = required ? ui().requiredSamples : ui().optionalSamples;
    return `<section class="evaluation-sample-section${required ? "" : " optional"}"><h3>${label}<span>${samples.length}</span></h3>${sampleRows(samples, task, !required)}</section>`;
  }

  function renderSamples() {
    const task = currentTask();
    const target = document.querySelector("[data-sample-list]");
    const previousScroll = target.scrollTop;
    if (!task?.samples.length) {
      target.innerHTML = `<div class="empty-list"><strong>${ui().noSamples}</strong></div>`;
      renderDetail();
      return;
    }
    if (!task.samples.some((sample) => sample.id === state.selectedSampleByTask.get(task.id))) {
      state.selectedSampleByTask.set(task.id, task.samples[0].id);
    }
    target.innerHTML = `${sampleSection(task, true)}${sampleSection(task, false)}`;
    target.scrollTop = previousScroll;
    renderDetail();
  }


  function optionHtml(option, answer) {
    const checked = answer.selected_options.includes(option);
    return `<label class="evaluation-option"><input type="checkbox" value="${escapeHtml(option)}"${checked ? " checked" : ""}><span>${escapeHtml(option)}</span></label>`;
  }

  function renderDetail() {
    const target = document.querySelector("[data-workspace]");
    const task = currentTask();
    const sample = currentSample();
    if (!task || !sample) {
      target.innerHTML = `<div class="empty-state"><h2>${ui().noSamplesTitle}</h2></div>`;
      return;
    }
    const variant = currentVariant(sample);
    const answer = answerFor(task.id, sample.id, variant);
    const kind = sample.required ? ui().required : ui().optional;
    const number = task.samples.indexOf(sample) + 1;
    target.innerHTML = `<div class="detail-content" data-current-sample="${escapeHtml(sample.id)}">
      <div class="detail-header"><div><p class="eyebrow">${escapeHtml(taskLabel(task))}</p><h2>${number}</h2></div><span class="evaluation-kind evaluation-detail-kind${sample.required ? "" : " optional"}">${kind}</span></div>
      <div class="shared-audio-variant-tabs" role="tablist">${variants().map((item) => `<button type="button" class="shared-audio-variant-tab${variant === item ? " is-active" : ""}" data-variant="${item}" aria-selected="${variant === item}">${ui().variants[item]}</button>`).join("")}</div>
      <section class="audio-card shared-audio-card"><audio id="main-audio" controls preload="metadata" src="${escapeHtml(sample.audio[variant])}"></audio><div class="audio-shortcuts"><span><kbd>Space</kbd> ${ui().play}</span><span><kbd>J</kbd>/<kbd>K</kbd> ${ui().previousNext}</span></div></section>
      <section class="evaluation-question" data-answer-form>
        <p>${escapeHtml(task.question)}</p>
        <div class="evaluation-options">${task.options.map((option) => optionHtml(option, answer)).join("")}</div>
        <label class="evaluation-comment">${ui().freeResponse} <span>${ui().optionalNote}</span><textarea rows="4" maxlength="4000" placeholder="${ui().freeResponsePlaceholder}">${escapeHtml(answer.comment)}</textarea></label>
        <p class="evaluation-response-status${answer.pending ? " is-pending" : answer.updated_at ? " is-saved" : ""}">${answer.pending ? ui().waitingToSave : answer.updated_at ? ui().saved : ui().notAnswered}</p>
      </section>
    </div>`;
  }

  function renderAll() {
    renderTasks();
    renderSamples();
    renderSubmissionState();
  }

  function updateCurrentAnswer() {
    const task = currentTask();
    const sample = currentSample();
    if (!task || !sample) return;
    const variant = currentVariant(sample);
    const form = document.querySelector("[data-answer-form]");
    const selectedOptions = [...form.querySelectorAll('input[type="checkbox"]:checked')]
      .map((input) => input.value);
    const comment = form.querySelector("textarea").value;
    const key = answerKey(task.id, sample.id, variant);
    state.answers.set(key, {
      selected_options: selectedOptions,
      comment,
      updated_at: new Date().toISOString(),
      pending: true,
    });
    persistAnswers();
    setSaveStatus(ui().waitingToSave, "pending");
    const responseStatus = form.querySelector(".evaluation-response-status");
    responseStatus.textContent = ui().waitingToSave;
    responseStatus.className = "evaluation-response-status is-pending";
    scheduleSave(task.id, sample.id, variant);
  }

  function scheduleSave(task, sampleId, variant) {
    const key = answerKey(task, sampleId, variant);
    clearTimeout(state.saveTimers.get(key));
    state.saveTimers.set(key, setTimeout(() => {
      state.saveTimers.delete(key);
      saveAnswer(task, sampleId, variant);
    }, SAVE_DELAY_MS));
  }

  async function saveAnswer(task, sampleId, variant) {
    const key = answerKey(task, sampleId, variant);
    const answer = state.answers.get(key);
    if (!answer?.pending) return true;
    setSaveStatus(ui().saving, "pending");
    try {
      const payload = await apiRequest({
        action: "save",
        task,
        sample_id: sampleId,
        audio_variant: variant,
        selected_options: answer.selected_options,
        comment: answer.comment,
      });
      if (payload.deleted) {
        state.answers.delete(key);
      } else {
        state.answers.set(key, {
          ...answer,
          updated_at: payload.updated_at || new Date().toISOString(),
          pending: false,
        });
      }
      persistAnswers();
      setSaveStatus(ui().autosaved, "saved");
      const visible = currentTask()?.id === task
        && currentSample()?.id === sampleId
        && currentVariant() === variant;
      if (visible) {
        const responseStatus = document.querySelector(".evaluation-response-status");
        if (responseStatus) {
          responseStatus.textContent = payload.deleted ? ui().notAnswered : ui().saved;
          responseStatus.className = payload.deleted
            ? "evaluation-response-status"
            : "evaluation-response-status is-saved";
        }
      }
      return true;
    } catch (error) {
      console.error(error);
      setSaveStatus(ui().saveFailed, "pending");
      return false;
    }
  }

  async function flushPendingAnswers() {
    state.saveTimers.forEach((timer) => clearTimeout(timer));
    state.saveTimers.clear();
    const pending = [...state.answers.entries()]
      .filter(([, answer]) => answer.pending)
      .map(([key]) => JSON.parse(key));
    const results = await Promise.all(
      pending.map(([task, sampleId, variant]) => saveAnswer(task, sampleId, variant)),
    );
    return results.every(Boolean);
  }

  async function submitCurrentAnswers() {
    const button = document.querySelector("[data-submit]");
    button.disabled = true;
    setSaveStatus(ui().preparingSubmission, "pending");
    try {
      if (!await flushPendingAnswers()) throw new Error(ui().someResponsesFailed);
      const payload = await apiRequest({ action: "submit" });
      state.submittedAt = payload.submitted_at;
      setSaveStatus(ui().submitted, "saved");
      renderSubmissionState();
    } catch (error) {
      console.error(error);
      setSaveStatus(`${ui().submissionFailed}: ${error.message}`, "pending");
    } finally {
      button.disabled = false;
    }
  }

  function chooseTask(taskId) {
    state.selectedTask = taskId;
    const task = currentTask();
    if (task?.samples.length && !state.selectedSampleByTask.has(task.id)) {
      state.selectedSampleByTask.set(task.id, task.samples[0].id);
    }
    renderAll();
  }

  function chooseSample(sampleId) {
    state.selectedSampleByTask.set(state.selectedTask, sampleId);
    state.selectedVariantBySample.set(sampleId, variants()[0]);
    renderSamples();
  }

  function switchParticipant() {
    state.saveTimers.forEach((timer) => clearTimeout(timer));
    state.saveTimers.clear();
    localStorage.removeItem(participantStorageKey());
    state.participantId = null;
    state.answers.clear();
    state.submittedAt = null;
    document.querySelector("[data-evaluation-app]").hidden = true;
    document.querySelector("[data-session-actions]").hidden = true;
    document.querySelector("[data-identity-card]").hidden = false;
    const input = document.querySelector('[name="participant_id"]');
    input.value = "";
    input.focus();
  }

  document.addEventListener("click", (event) => {
    const task = event.target.closest("[data-task]");
    if (task) return chooseTask(task.dataset.task);
    const sample = event.target.closest("[data-sample-id]");
    if (sample) return chooseSample(sample.dataset.sampleId);
    const variant = event.target.closest("[data-variant]");
    if (variant) {
      state.selectedVariantBySample.set(currentSample().id, variant.dataset.variant);
      renderDetail();
      return;
    }
    if (event.target.closest("[data-submit]")) return submitCurrentAnswers();
    if (event.target.closest("[data-switch-participant]")) return switchParticipant();
  });

  document.addEventListener("change", (event) => {
    if (event.target.closest('[data-answer-form] input[type="checkbox"]')) updateCurrentAnswer();
  });

  document.addEventListener("input", (event) => {
    if (event.target.closest("[data-answer-form] textarea")) updateCurrentAnswer();
  });

  document.addEventListener("keydown", (event) => {
    if (!state.participantId || event.target.matches("input, textarea, select")) return;
    const audio = document.querySelector("#main-audio");
    if (event.code === "Space" && audio) {
      event.preventDefault();
      audio.paused ? audio.play() : audio.pause();
      return;
    }
    const samples = currentTask()?.samples || [];
    const index = Math.max(0, samples.findIndex((sample) => sample.id === currentSample()?.id));
    if (["ArrowDown", "k", "K"].includes(event.key) && samples[index + 1]) {
      event.preventDefault();
      chooseSample(samples[index + 1].id);
    }
    if (["ArrowUp", "j", "J"].includes(event.key) && samples[index - 1]) {
      event.preventDefault();
      chooseSample(samples[index - 1].id);
    }
  });

  document.querySelector("[data-identity-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorTarget = document.querySelector("[data-identity-error]");
    try {
      await beginSession(new FormData(event.currentTarget).get("participant_id"));
    } catch (error) {
      errorTarget.textContent = error.message;
      errorTarget.hidden = false;
    }
  });

  async function start() {
    const response = await fetch(`data/evaluation.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${ui().siteLoadFailed}: ${response.status}`);
    state.evaluation = await response.json();
    state.selectedTask = state.evaluation.tasks[0]?.id || null;
    state.evaluation.tasks.forEach((task) => {
      if (task.samples[0]) state.selectedSampleByTask.set(task.id, task.samples[0].id);
    });
    const storedParticipant = localStorage.getItem(participantStorageKey());
    if (storedParticipant) {
      document.querySelector('[name="participant_id"]').value = storedParticipant;
      await beginSession(storedParticipant);
    }
  }

  start().catch((error) => {
    console.error(error);
    const target = document.querySelector("[data-identity-error]");
    target.textContent = `${ui().siteLoadFailed}: ${error.message}`;
    target.hidden = false;
  });
})();
