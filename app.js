const state = {
  doelen: [],
  doelMap: new Map(),
  bronnen: [],
  filtered: [],
  selectedId: null,
  selection: [],
  userNotes: {},
  detailEditors: {},
  suggestionIndex: null,
  filters: {
    vak: [],
    fase: [],
    domein: [],
    subdomein: [],
    cluster: [],
    doelsoort: [],
  },
  availableOptions: {
    vak: [],
    fase: [],
    domein: [],
    subdomein: [],
    cluster: [],
    doelsoort: [],
  },
};

const NOTES_STORAGE_KEY = "leerdoelen_user_notes_v1";
const NL_STOPWORDS = new Set([
  "de", "het", "een", "en", "van", "in", "op", "te", "met", "voor", "door", "tot", "bij", "aan", "of",
  "als", "dat", "die", "dit", "deze", "zijn", "haar", "hun", "je", "jij", "hij", "zij", "we", "wij",
  "is", "was", "wordt", "kan", "kunnen", "moet", "moeten", "om", "ook", "nog", "niet", "wel", "dan",
  "naar", "uit", "over", "onder", "tussen", "rond", "hier", "nu", "met", "zonder", "leerling", "leerlingen",
  "ondersteuning", "ondersteund", "doel", "doelen"
]);
const NON_CHILD_WORDS = new Set([
  "modeling", "transfer", "expliciete", "begeleide", "denkhandelingen", "differentieer", "zelfstandigheid",
  "inoefening", "contexten", "observeer", "uitvoering", "stapsgewijs", "subdomein", "doelsoort"
]);

const FILTER_DEFS = [
  { key: "vak", prop: "vak", el: "vakFilter", allLabel: "Alle vakken" },
  { key: "fase", prop: "fase", el: "faseFilter", allLabel: "Alle fases" },
  { key: "domein", prop: "domein", el: "domeinFilter", allLabel: "Alle domeinen" },
  { key: "subdomein", prop: "subdomein", el: "subdomeinFilter", allLabel: "Alle subdomeinen" },
  { key: "cluster", prop: "cluster", el: "clusterFilter", allLabel: "Alle clusters" },
  { key: "doelsoort", prop: "doelsoort", el: "doelsoortFilter", allLabel: "Alle doel-soorten" },
];

const els = {
  metaStats: document.getElementById("metaStats"),
  resultCount: document.getElementById("resultCount"),
  resultList: document.getElementById("resultList"),
  detailView: document.getElementById("detailView"),
  activeFilters: document.getElementById("activeFilters"),
  searchInput: document.getElementById("searchInput"),
  resetFilters: document.getElementById("resetFilters"),
  selectedCountTop: document.getElementById("selectedCountTop"),
  clearAllSelectedTopBtn: document.getElementById("clearAllSelectedTopBtn"),
  selectionCount: document.getElementById("selectionCount"),
  selectionList: document.getElementById("selectionList"),
  exportSelectionBtn: document.getElementById("exportSelectionBtn"),
};

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitSentences(text) {
  return String(text || "")
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 18);
}

function pickTopWords(texts, limit = 8) {
  const freq = new Map();
  texts.forEach((text) => {
    String(text || "")
      .toLowerCase()
      .replace(/[^a-zà-ÿ0-9\s-]/gi, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => isChildFriendlyWord(w))
      .forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  });
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function isChildFriendlyWord(word) {
  const w = String(word || "").toLowerCase().trim();
  if (!w) return false;
  if (w.length < 3 || w.length > 10) return false;
  if (NL_STOPWORDS.has(w)) return false;
  if (NON_CHILD_WORDS.has(w)) return false;
  if (/\d/.test(w)) return false;
  if (w.endsWith("heid") || w.endsWith("atie") || w.endsWith("ering") || w.endsWith("isme")) return false;
  return true;
}

function buildSuggestionIndex(doelen) {
  const byVak = new Map();
  const bySubdomein = new Map();
  const byCluster = new Map();
  const byMd = new Map();
  const byNrmd = new Map();
  const byCodeStem = new Map();
  const byClusterSub = new Map();
  doelen.forEach((d) => {
    if (d.vak) {
      if (!byVak.has(d.vak)) byVak.set(d.vak, []);
      byVak.get(d.vak).push(d);
    }
    if (d.subdomein) {
      const key = `${d.vak}::${d.subdomein}`;
      if (!bySubdomein.has(key)) bySubdomein.set(key, []);
      bySubdomein.get(key).push(d);
    }
    if (d.cluster) {
      const key = `${d.vak}::${d.cluster}`;
      if (!byCluster.has(key)) byCluster.set(key, []);
      byCluster.get(key).push(d);
    }
    if (d.md) {
      const key = `${d.vak}::${d.md}`;
      if (!byMd.has(key)) byMd.set(key, []);
      byMd.get(key).push(d);
    }
    if (d.nrmd) {
      const key = `${d.vak}::${d.nrmd}`;
      if (!byNrmd.has(key)) byNrmd.set(key, []);
      byNrmd.get(key).push(d);
    }
    if (d.code) {
      const parts = String(d.code).split(".");
      const stem = parts.length > 1 ? parts.slice(0, -1).join(".") : d.code;
      const key = `${d.vak}::${stem}`;
      if (!byCodeStem.has(key)) byCodeStem.set(key, []);
      byCodeStem.get(key).push(d);
    }
    if (d.cluster || d.subdomein) {
      const key = `${d.vak}::${d.subdomein || ""}::${d.cluster || ""}`;
      if (!byClusterSub.has(key)) byClusterSub.set(key, []);
      byClusterSub.get(key).push(d);
    }
  });
  return { byVak, bySubdomein, byCluster, byMd, byNrmd, byCodeStem, byClusterSub };
}

function similarGoals(goal) {
  if (!state.suggestionIndex) return [];
  const subKey = `${goal.vak}::${goal.subdomein || ""}`;
  const clusterKey = `${goal.vak}::${goal.cluster || ""}`;
  const pool =
    state.suggestionIndex.bySubdomein.get(subKey) ||
    state.suggestionIndex.byCluster.get(clusterKey) ||
    state.suggestionIndex.byVak.get(goal.vak) ||
    [];
  return pool.filter((g) => g.id !== goal.id).slice(0, 50);
}

function generateVoorbeeldenSuggestion(goal) {
  const similars = similarGoals(goal);
  const baseSentences = similars.flatMap((g) => splitSentences(g.voorbeelden)).slice(0, 2);
  const original = (goal.voorbeelden || "").trim();
  const starter = goal.fase
    ? `In fase ${goal.fase.replace(".", "")} kan dit doel zichtbaar worden in herkenbare klas- en leefsituaties.`
    : "Dit doel kan zichtbaar worden in herkenbare klas- en leefsituaties.";
  const derived = baseSentences.length
    ? baseSentences.map((s, i) => `- ${s.trim().replace(/[.]+$/, "")}.`).join("\n")
    : "- Werk met korte, concrete opdrachten in een betekenisvolle context.\n- Laat de leerling verwoorden, tonen of toepassen wat begrepen werd.";

  if (original) {
    return [
      starter,
      "",
      "Originele voorbeelden:",
      original,
      "",
      "Aanvullende voorbeelden:",
      derived,
    ].join("\n");
  }

  return [starter, "", "Aanvullende voorbeelden:", derived].join("\n");
}

function generateToelichtingSuggestion(goal) {
  const similars = similarGoals(goal);
  const textPool = [
    goal.leerplandoel,
    goal.voorbeelden,
    goal.extra_toelichting,
    ...similars.map((g) => g.leerplandoel),
    ...similars.map((g) => g.extra_toelichting),
  ];
  const kern = [
    "Bouw dit doel op in kleine stappen: eerst sterk ondersteunen, daarna samen oefenen, en pas dan zelfstandig laten proberen.",
    "Koppel het doel aan herkenbare klasactiviteiten en observeer telkens wat de leerling al zonder hulp kan.",
    "Plan herhaling op verschillende momenten, zodat het gedrag of inzicht stabieler wordt.",
  ].filter(Boolean);
  const focus = goal.cluster ? `Focus binnen dit cluster: ${goal.cluster}.` : "";
  return `${kern.join(" ")} ${focus}`.trim();
}

function parseVocabList(text) {
  return String(text || "")
    .split(/[,\n;]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => isChildFriendlyWord(w));
}

function normalizedStem(word) {
  let w = String(word || "").toLowerCase().trim();
  if (!w) return "";
  w = w.replace(/[^a-zà-ÿ0-9-]/gi, "");
  if (w.length > 4 && w.endsWith("en")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
  else if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function extractGoalTerms(goal) {
  return pickTopWords([goal.leerplandoel, goal.voorbeelden], 24);
}

function isRelatedToGoal(term, goalTerms) {
  const stem = normalizedStem(term);
  if (!stem) return false;
  return goalTerms.some((t) => {
    const ts = normalizedStem(t);
    return ts && (ts === stem || ts.includes(stem) || stem.includes(ts));
  });
}

function generateWoordenschatSuggestion(goal) {
  const ownVocab = parseVocabList(goal.woordenschat);
  if (ownVocab.length) return uniq(ownVocab).slice(0, 10).join(", ");

  if (!state.suggestionIndex) return "";
  const candidates = [];
  const addFrom = (list) => {
    (list || []).forEach((g) => {
      if (!g || g.id === goal.id) return;
      parseVocabList(g.woordenschat).forEach((w) => {
        if (isChildFriendlyWord(w)) candidates.push(w);
      });
    });
  };

  const mdKey = `${goal.vak}::${goal.md || ""}`;
  const nrmdKey = `${goal.vak}::${goal.nrmd || ""}`;
  const codeParts = String(goal.code || "").split(".");
  const codeStem = codeParts.length > 1 ? codeParts.slice(0, -1).join(".") : String(goal.code || "");
  const codeKey = `${goal.vak}::${codeStem}`;
  const clusterSubKey = `${goal.vak}::${goal.subdomein || ""}::${goal.cluster || ""}`;
  const subKey = `${goal.vak}::${goal.subdomein || ""}`;
  const clusterKey = `${goal.vak}::${goal.cluster || ""}`;

  // Van meest naar minst verwant, allemaal binnen hetzelfde vak.
  addFrom(state.suggestionIndex.byNrmd.get(nrmdKey));
  addFrom(state.suggestionIndex.byMd.get(mdKey));
  addFrom(state.suggestionIndex.byCodeStem.get(codeKey));
  addFrom(state.suggestionIndex.byClusterSub.get(clusterSubKey));
  addFrom(state.suggestionIndex.bySubdomein.get(subKey));
  addFrom(state.suggestionIndex.byCluster.get(clusterKey));

  const merged = uniq(candidates).slice(0, 10);
  if (!merged.length) return "";
  return merged.join(", ");
}

function generateAISuggestion(goal, field) {
  if (field === "voorbeelden") return generateVoorbeeldenSuggestion(goal);
  if (field === "woordenschat") return generateWoordenschatSuggestion(goal);
  return generateToelichtingSuggestion(goal);
}

function getActiveFilters() {
  return {
    q: els.searchInput.value.trim().toLowerCase(),
    vak: [...state.filters.vak],
    fase: [...state.filters.fase],
    domein: [...state.filters.domein],
    subdomein: [...state.filters.subdomein],
    cluster: [...state.filters.cluster],
    doelsoort: [...state.filters.doelsoort],
  };
}

function matchesFilters(d, f, ignoreKey = null) {
  if (ignoreKey !== "vak" && f.vak.length && !f.vak.includes(d.vak)) return false;
  if (ignoreKey !== "fase" && f.fase.length && !f.fase.includes(d.fase)) return false;
  if (ignoreKey !== "domein" && f.domein.length && !f.domein.includes(d.domein)) return false;
  if (ignoreKey !== "subdomein" && f.subdomein.length && !f.subdomein.includes(d.subdomein)) return false;
  if (ignoreKey !== "cluster" && f.cluster.length && !f.cluster.includes(d.cluster)) return false;
  if (ignoreKey !== "doelsoort" && f.doelsoort.length && !f.doelsoort.includes(d.doelsoort)) return false;

  if (f.q) {
    const haystack = [d.code, d.domein, d.subdomein, d.cluster, d.leerplandoel, d.voorbeelden, d.extra_toelichting, d.woordenschat]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(f.q)) return false;
  }

  return true;
}

function dropdownSummary(key, allLabel) {
  const selected = state.filters[key];
  if (!selected.length) return allLabel;
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.length} geselecteerd`;
}

function closeAllDropdowns(exceptKey = null) {
  FILTER_DEFS.forEach((def) => {
    if (def.key === exceptKey) return;
    const root = document.getElementById(def.el);
    root.classList.remove("open");
  });
}

function renderDropdown(def) {
  const root = document.getElementById(def.el);
  const options = state.availableOptions[def.key] || [];
  const selected = state.filters[def.key] || [];

  root.innerHTML = `
    <button type="button" class="dropdown-toggle" aria-haspopup="listbox" aria-expanded="false">
      <span class="dropdown-label">${dropdownSummary(def.key, def.allLabel)}</span>
      <span class="dropdown-arrow">▾</span>
    </button>
    <div class="dropdown-menu" role="listbox" aria-multiselectable="true"></div>
  `;

  const toggle = root.querySelector(".dropdown-toggle");
  const menu = root.querySelector(".dropdown-menu");

  if (!options.length) {
    menu.innerHTML = '<div class="dropdown-empty">Geen opties beschikbaar</div>';
  } else {
    options.forEach((option) => {
      const value = option.value;
      const row = document.createElement("label");
      row.className = "dropdown-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = selected.includes(value);

      const text = document.createElement("span");
      text.textContent = value;

      const count = document.createElement("span");
      count.className = "option-count";
      count.textContent = String(option.count);

      input.addEventListener("change", () => {
        const current = new Set(state.filters[def.key]);
        if (input.checked) current.add(value);
        else current.delete(value);
        state.filters[def.key] = [...current];
        applyFilters();
      });

      row.appendChild(input);
      row.appendChild(text);
      row.appendChild(count);
      menu.appendChild(row);
    });
  }

  toggle.addEventListener("click", () => {
    const willOpen = !root.classList.contains("open");
    closeAllDropdowns(def.key);
    root.classList.toggle("open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
}

function refreshFilterOptions(filters) {
  FILTER_DEFS.forEach((def) => {
    const candidates = state.doelen.filter((d) => matchesFilters(d, filters, def.key));
    const counts = new Map();
    candidates.forEach((d) => {
      const value = d[def.prop];
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    const options = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "nl"))
      .map(([value, count]) => ({ value, count }));

    state.availableOptions[def.key] = options;
    const availableValues = new Set(options.map((o) => o.value));
    state.filters[def.key] = state.filters[def.key].filter((value) => availableValues.has(value));
    renderDropdown(def);
  });
}

function applyFilters() {
  let f = getActiveFilters();
  refreshFilterOptions(f);
  f = getActiveFilters();
  state.filtered = state.doelen.filter((d) => matchesFilters(d, f));

  if (!state.filtered.some((d) => d.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }

  render();
}

function renderFilterChips(filters) {
  els.activeFilters.innerHTML = "";
  const entries = Object.entries(filters).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });

  function makeChip(key, value) {
    const chip = document.createElement("span");
    chip.className = "chip removable";

    const text = document.createElement("span");
    text.textContent = `${key}: ${value}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Filter verwijderen";
    removeBtn.setAttribute("aria-label", "Filter verwijderen");
    removeBtn.addEventListener("click", () => {
      if (key === "q") {
        els.searchInput.value = "";
      } else if (Array.isArray(state.filters[key])) {
        state.filters[key] = state.filters[key].filter((entry) => entry !== value);
      }
      applyFilters();
    });

    chip.appendChild(text);
    chip.appendChild(removeBtn);
    els.activeFilters.appendChild(chip);
  }

  entries.forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        makeChip(key, entry);
      });
    } else {
      makeChip(key, value);
    }
  });
}

function renderResults() {
  els.resultCount.textContent = `${state.filtered.length} resultaten`;
  els.selectedCountTop.textContent = `${state.selection.length} geselecteerd`;
  els.resultList.innerHTML = "";

  const list = state.filtered.slice(0, 400);
  list.forEach((d) => {
    const card = document.createElement("article");
    card.className = `result-item ${d.id === state.selectedId ? "active" : ""}`;
    const isSelected = state.selection.includes(d.id);
    const btnClass = isSelected ? "select-btn selected" : "select-btn";
    const btnLabel = isSelected ? "🗑" : "+";
    const btnTitle = isSelected ? "Verwijder uit selectie" : "Voeg toe aan selectie";
    card.innerHTML = `
      <div class="result-item-head">
        <h3>${d.leerplandoel}</h3>
        <button type="button" class="${btnClass}" title="${btnTitle}" aria-label="${btnTitle}">${btnLabel}</button>
      </div>
      <div class="meta-row">
        <span class="meta-tag">${d.vak}</span>
        <span class="meta-tag">${d.fase || "-"}</span>
        <span class="meta-tag">${d.domein || "-"}</span>
      </div>
    `;

    const selectBtn = card.querySelector(".select-btn");
    selectBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.selection.includes(d.id)) {
        state.selection = state.selection.filter((id) => id !== d.id);
      } else {
        state.selection.push(d.id);
      }
      render();
    });

    card.addEventListener("click", () => {
      state.selectedId = d.id;
      render();
    });
    els.resultList.appendChild(card);
  });

  if (state.filtered.length > 400) {
    const note = document.createElement("p");
    note.className = "placeholder";
    note.textContent = `Eerste 400 van ${state.filtered.length} resultaten getoond. Verfijn je filters.`;
    els.resultList.appendChild(note);
  }
}

function resourcesForVak(vak) {
  return state.bronnen.filter((b) => b.vak === vak);
}

function getOriginalField(goal, field) {
  if (field === "toelichting") return (goal.extra_toelichting || goal.toelichting || "").trim();
  if (field === "woordenschat") return (goal.woordenschat || "").trim();
  return (goal[field] || "").trim();
}

function getEffectiveField(goalId, goal, field) {
  const note = state.userNotes[goalId];
  if (note && Object.prototype.hasOwnProperty.call(note, field)) {
    return String(note[field] ?? "");
  }
  return getOriginalField(goal, field);
}

function getEditorState(goalId, field, effective) {
  if (!state.detailEditors[goalId]) state.detailEditors[goalId] = {};
  if (!state.detailEditors[goalId][field]) {
    state.detailEditors[goalId][field] = { editing: false, draft: effective };
  }
  return state.detailEditors[goalId][field];
}

function isFieldChanged(goalId, goal, field, editing = false) {
  const original = getOriginalField(goal, field);
  if (editing) {
    const draft = state.detailEditors[goalId]?.[field]?.draft || "";
    return draft.trim() !== original;
  }
  return getEffectiveField(goalId, goal, field).trim() !== original;
}

function formatMultiline(value) {
  return escapeHtml(String(value || "")).replaceAll("\n", "<br>");
}

function renderDetail() {
  const item = state.filtered.find((d) => d.id === state.selectedId);
  if (!item) {
    els.detailView.innerHTML = '<p class="placeholder">Geen resultaat voor de huidige filters.</p>';
    return;
  }
  const effectiveVoorbeelden = getEffectiveField(item.id, item, "voorbeelden");
  const effectiveToelichting = getEffectiveField(item.id, item, "toelichting");
  const effectiveWoordenschat = getEffectiveField(item.id, item, "woordenschat");
  const voorbeeldenState = getEditorState(item.id, "voorbeelden", effectiveVoorbeelden);
  const toelichtingState = getEditorState(item.id, "toelichting", effectiveToelichting);
  const woordenschatState = getEditorState(item.id, "woordenschat", effectiveWoordenschat);
  if (!voorbeeldenState.editing) voorbeeldenState.draft = effectiveVoorbeelden;
  if (!toelichtingState.editing) toelichtingState.draft = effectiveToelichting;
  if (!woordenschatState.editing) woordenschatState.draft = effectiveWoordenschat;

  const voorbeeldenChanged = isFieldChanged(item.id, item, "voorbeelden", voorbeeldenState.editing);
  const toelichtingChanged = isFieldChanged(item.id, item, "toelichting", toelichtingState.editing);
  const woordenschatChanged = isFieldChanged(item.id, item, "woordenschat", woordenschatState.editing);
  const voorbeeldenRefreshClass = voorbeeldenChanged ? "mini-icon-btn" : "mini-icon-btn hidden";
  const toelichtingRefreshClass = toelichtingChanged ? "mini-icon-btn" : "mini-icon-btn hidden";
  const woordenschatRefreshClass = woordenschatChanged ? "mini-icon-btn" : "mini-icon-btn hidden";
  const voorbeeldenPrimary = voorbeeldenState.editing ? "💾" : "✏️";
  const toelichtingPrimary = toelichtingState.editing ? "💾" : "✏️";
  const woordenschatPrimary = woordenschatState.editing ? "💾" : "✏️";
  const voorbeeldenPrimaryTitle = voorbeeldenState.editing ? "Bewaar voorbeelden" : "Bewerk voorbeelden";
  const toelichtingPrimaryTitle = toelichtingState.editing ? "Bewaar toelichting" : "Bewerk toelichting";
  const woordenschatPrimaryTitle = woordenschatState.editing ? "Bewaar woordenschat" : "Bewerk woordenschat";

  const resources = resourcesForVak(item.vak);
  const resourceHtml = resources.length
    ? `<ul class="resource-list">${resources
        .map((r) => `<li><a href="${encodeURI(r.url)}" target="_blank" rel="noreferrer">${r.titel}</a> (${r.grootte_kb} KB)</li>`)
        .join("")}</ul>`
    : '<p class="placeholder">Geen gekoppelde PDF-bronnen.</p>';

  els.detailView.innerHTML = `
    <h2>${item.leerplandoel}</h2>
    <div class="meta-row">
      <span class="meta-tag">${item.vak}</span>
      <span class="meta-tag">${item.doelsoort || "-"}</span>
      <span class="meta-tag">${item.fase || "-"}</span>
    </div>

    <section class="detail-block">
      <h4>Structuur</h4>
      <p><strong>Domein:</strong> ${item.domein || "-"}</p>
      <p><strong>Subdomein:</strong> ${item.subdomein || "-"}</p>
      <p><strong>Cluster:</strong> ${item.cluster || "-"}</p>
    </section>

    <section class="detail-block">
      <div class="detail-head">
        <h4>Voorbeelden</h4>
        <div class="detail-actions">
          <button id="toggleVoorbeeldenBtn" class="mini-icon-btn" type="button" title="${voorbeeldenPrimaryTitle}" aria-label="${voorbeeldenPrimaryTitle}">${voorbeeldenPrimary}</button>
          <button id="resetVoorbeeldenBtn" class="${voorbeeldenRefreshClass}" type="button" title="Herstel originele voorbeelden" aria-label="Herstel originele voorbeelden">↻</button>
        </div>
      </div>
      ${
        voorbeeldenState.editing
          ? `<textarea id="editVoorbeelden" class="inline-edit" rows="4" placeholder="Geen voorbeeld opgegeven.">${escapeHtml(voorbeeldenState.draft)}</textarea>`
          : `<p class="rich-text">${formatMultiline(effectiveVoorbeelden || "Geen voorbeeld opgegeven.")}</p>`
      }
    </section>

    <section class="detail-block">
      <div class="detail-head">
        <h4>Extra toelichting (voor leerkracht)</h4>
        <div class="detail-actions">
          <button id="toggleToelichtingBtn" class="mini-icon-btn" type="button" title="${toelichtingPrimaryTitle}" aria-label="${toelichtingPrimaryTitle}">${toelichtingPrimary}</button>
          <button id="resetToelichtingBtn" class="${toelichtingRefreshClass}" type="button" title="Herstel originele toelichting" aria-label="Herstel originele toelichting">↻</button>
        </div>
      </div>
      ${
        toelichtingState.editing
          ? `<textarea id="editToelichting" class="inline-edit" rows="4" placeholder="Geen extra toelichting opgegeven.">${escapeHtml(toelichtingState.draft)}</textarea>`
          : `<p class="rich-text">${formatMultiline(effectiveToelichting || "Geen extra toelichting opgegeven.")}</p>`
      }
    </section>

    <section class="detail-block">
      <div class="detail-head">
        <h4>Woordenschat (voor kinderen)</h4>
        <div class="detail-actions">
          <button id="toggleWoordenschatBtn" class="mini-icon-btn" type="button" title="${woordenschatPrimaryTitle}" aria-label="${woordenschatPrimaryTitle}">${woordenschatPrimary}</button>
          <button id="resetWoordenschatBtn" class="${woordenschatRefreshClass}" type="button" title="Herstel originele woordenschat" aria-label="Herstel originele woordenschat">↻</button>
        </div>
      </div>
      ${
        woordenschatState.editing
          ? `<textarea id="editWoordenschat" class="inline-edit" rows="3" placeholder="Geen woordenschat opgegeven.">${escapeHtml(woordenschatState.draft)}</textarea>`
          : `<p>${escapeHtml(effectiveWoordenschat || "Geen woordenschat opgegeven.")}</p>`
      }
    </section>

    <section class="detail-block">
      <h4>Bronnen en visieteksten (${item.vak})</h4>
      ${resourceHtml}
    </section>
  `;
  bindDetailEditors(item.id);
}

function saveNotesToStorage() {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(state.userNotes));
  } catch (err) {
    console.error("Kon notities niet opslaan", err);
  }
}

function loadNotesFromStorage() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const normalized = {};
      Object.entries(parsed).forEach(([goalId, note]) => {
        if (!note || typeof note !== "object") return;
        const next = {};
        if (Object.prototype.hasOwnProperty.call(note, "voorbeelden")) next.voorbeelden = String(note.voorbeelden ?? "");
        if (Object.prototype.hasOwnProperty.call(note, "toelichting")) next.toelichting = String(note.toelichting ?? "");
        if (Object.prototype.hasOwnProperty.call(note, "woordenschat")) next.woordenschat = String(note.woordenschat ?? "");
        normalized[goalId] = next;
      });
      state.userNotes = normalized;
    }
  } catch (err) {
    console.error("Kon notities niet laden", err);
  }
}

function bindDetailEditors(goalId) {
  const base = state.doelMap.get(goalId);
  if (!base) return;
  const toggleVoorbeeldenBtn = document.getElementById("toggleVoorbeeldenBtn");
  const toggleToelichtingBtn = document.getElementById("toggleToelichtingBtn");
  const toggleWoordenschatBtn = document.getElementById("toggleWoordenschatBtn");
  const resetVoorbeeldenBtn = document.getElementById("resetVoorbeeldenBtn");
  const resetToelichtingBtn = document.getElementById("resetToelichtingBtn");
  const resetWoordenschatBtn = document.getElementById("resetWoordenschatBtn");
  const voorbeeldenEl = document.getElementById("editVoorbeelden");
  const toelichtingEl = document.getElementById("editToelichting");
  const woordenschatEl = document.getElementById("editWoordenschat");

  const setFieldValue = (field, value) => {
    if (!state.userNotes[goalId]) state.userNotes[goalId] = { voorbeelden: "", toelichting: "", woordenschat: "" };
    state.userNotes[goalId][field] = value.trim();
    const note = state.userNotes[goalId];
    const effectiveNote = {
      voorbeelden: Object.prototype.hasOwnProperty.call(note, "voorbeelden")
        ? String(note.voorbeelden ?? "")
        : getOriginalField(base, "voorbeelden"),
      toelichting: Object.prototype.hasOwnProperty.call(note, "toelichting")
        ? String(note.toelichting ?? "")
        : getOriginalField(base, "toelichting"),
      woordenschat: Object.prototype.hasOwnProperty.call(note, "woordenschat")
        ? String(note.woordenschat ?? "")
        : getOriginalField(base, "woordenschat"),
    };
    if (
      effectiveNote.voorbeelden === getOriginalField(base, "voorbeelden") &&
      effectiveNote.toelichting === getOriginalField(base, "toelichting") &&
      effectiveNote.woordenschat === getOriginalField(base, "woordenschat")
    ) {
      delete state.userNotes[goalId];
    }
    saveNotesToStorage();
  };

  if (toggleVoorbeeldenBtn) {
    toggleVoorbeeldenBtn.addEventListener("click", () => {
      const editor = state.detailEditors[goalId].voorbeelden;
      if (!editor.editing) {
        editor.editing = true;
        editor.draft = getEffectiveField(goalId, base, "voorbeelden");
      } else {
        setFieldValue("voorbeelden", editor.draft);
        editor.editing = false;
      }
      renderDetail();
    });
  }

  if (toggleToelichtingBtn) {
    toggleToelichtingBtn.addEventListener("click", () => {
      const editor = state.detailEditors[goalId].toelichting;
      if (!editor.editing) {
        editor.editing = true;
        editor.draft = getEffectiveField(goalId, base, "toelichting");
      } else {
        setFieldValue("toelichting", editor.draft);
        editor.editing = false;
      }
      renderDetail();
    });
  }

  if (toggleWoordenschatBtn) {
    toggleWoordenschatBtn.addEventListener("click", () => {
      const editor = state.detailEditors[goalId].woordenschat;
      if (!editor.editing) {
        editor.editing = true;
        editor.draft = getEffectiveField(goalId, base, "woordenschat");
      } else {
        setFieldValue("woordenschat", editor.draft);
        editor.editing = false;
      }
      renderDetail();
    });
  }

  if (resetVoorbeeldenBtn) {
    resetVoorbeeldenBtn.addEventListener("click", () => {
      const editor = state.detailEditors[goalId].voorbeelden;
      editor.draft = getOriginalField(base, "voorbeelden");
      editor.editing = false;
      if (state.userNotes[goalId]) {
        state.userNotes[goalId].voorbeelden = getOriginalField(base, "voorbeelden");
      }
      setFieldValue("voorbeelden", getOriginalField(base, "voorbeelden"));
      render();
    });
  }

  if (resetToelichtingBtn) {
    resetToelichtingBtn.addEventListener("click", () => {
      const editor = state.detailEditors[goalId].toelichting;
      editor.draft = getOriginalField(base, "toelichting");
      editor.editing = false;
      if (state.userNotes[goalId]) {
        state.userNotes[goalId].toelichting = getOriginalField(base, "toelichting");
      }
      setFieldValue("toelichting", getOriginalField(base, "toelichting"));
      render();
    });
  }

  if (resetWoordenschatBtn) {
    resetWoordenschatBtn.addEventListener("click", () => {
      const editor = state.detailEditors[goalId].woordenschat;
      editor.draft = getOriginalField(base, "woordenschat");
      editor.editing = false;
      if (state.userNotes[goalId]) {
        state.userNotes[goalId].woordenschat = getOriginalField(base, "woordenschat");
      }
      setFieldValue("woordenschat", getOriginalField(base, "woordenschat"));
      render();
    });
  }

  if (voorbeeldenEl) {
    voorbeeldenEl.addEventListener("input", () => {
      state.detailEditors[goalId].voorbeelden.draft = voorbeeldenEl.value;
      const original = getOriginalField(base, "voorbeelden");
      resetVoorbeeldenBtn?.classList.toggle("hidden", voorbeeldenEl.value.trim() === original);
    });
  }

  if (toelichtingEl) {
    toelichtingEl.addEventListener("input", () => {
      state.detailEditors[goalId].toelichting.draft = toelichtingEl.value;
      const original = getOriginalField(base, "toelichting");
      resetToelichtingBtn?.classList.toggle("hidden", toelichtingEl.value.trim() === original);
    });
  }

  if (woordenschatEl) {
    woordenschatEl.addEventListener("input", () => {
      state.detailEditors[goalId].woordenschat.draft = woordenschatEl.value;
      const original = getOriginalField(base, "woordenschat");
      resetWoordenschatBtn?.classList.toggle("hidden", woordenschatEl.value.trim() === original);
    });
  }
}

function renderSelection() {
  els.selectionCount.textContent = `${state.selection.length} items`;
  els.selectionList.innerHTML = "";

  if (!state.selection.length) {
    els.selectionList.innerHTML = '<p class="placeholder">Nog geen doelen toegevoegd aan de selectie.</p>';
    return;
  }

  state.selection.forEach((id) => {
    const goal = state.doelMap.get(id);
    if (!goal) return;

    const row = document.createElement("div");
    row.className = "selection-item";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = goal.leerplandoel;
    openBtn.addEventListener("click", () => {
      state.selectedId = goal.id;
      render();
    });

    const meta = document.createElement("p");
    meta.textContent = `${goal.vak} • ${goal.fase || "-"}`;

    row.appendChild(openBtn);
    row.appendChild(meta);
    els.selectionList.appendChild(row);
  });
}

function exportSelectionToTxt() {
  if (!state.selection.length) return;

  const now = new Date();
  const lines = [
    "Selectie leerdoelen",
    `Aangemaakt op: ${now.toLocaleString("nl-BE")}`,
    "",
  ];

  state.selection.forEach((id, index) => {
    const g = state.doelMap.get(id);
    if (!g) return;
    const own = state.userNotes[g.id];
    const outVoorbeelden =
      own && Object.prototype.hasOwnProperty.call(own, "voorbeelden")
        ? String(own.voorbeelden ?? "")
        : g.voorbeelden || "";
    const outToelichting =
      own && Object.prototype.hasOwnProperty.call(own, "toelichting")
        ? String(own.toelichting ?? "")
        : g.extra_toelichting || g.toelichting || "";
    const outWoordenschat =
      own && Object.prototype.hasOwnProperty.call(own, "woordenschat")
        ? String(own.woordenschat ?? "")
        : g.woordenschat || "";
    lines.push(`${index + 1}. ${g.leerplandoel}`);
    lines.push(`   Vak: ${g.vak}`);
    lines.push(`   Fase: ${g.fase || "-"}`);
    lines.push(`   Domein: ${g.domein || "-"}`);
    lines.push(`   Subdomein: ${g.subdomein || "-"}`);
    lines.push(`   Cluster: ${g.cluster || "-"}`);
    if (outVoorbeelden) lines.push(`   Voorbeelden: ${outVoorbeelden}`);
    if (outToelichting) lines.push(`   Extra toelichting: ${outToelichting}`);
    if (outWoordenschat) lines.push(`   Woordenschat: ${outWoordenschat}`);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leerdoelen-selectie-${now.toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function render() {
  renderFilterChips(getActiveFilters());
  renderResults();
  renderDetail();
  renderSelection();
}

function bindEvents() {
  els.searchInput.addEventListener("input", applyFilters);

  els.resetFilters.addEventListener("click", () => {
    els.searchInput.value = "";
    FILTER_DEFS.forEach((def) => {
      state.filters[def.key] = [];
    });
    applyFilters();
  });

  els.clearAllSelectedTopBtn.addEventListener("click", () => {
    state.selection = [];
    render();
  });

  els.exportSelectionBtn.addEventListener("click", exportSelectionToTxt);

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".multi-dropdown")) {
      closeAllDropdowns();
    }
  });
}

async function init() {
  const goalsRes = await fetch("data/goals.json");
  const data = await goalsRes.json();

  state.doelen = data.doelen;
  state.doelMap = new Map(state.doelen.map((d) => [d.id, d]));
  state.suggestionIndex = buildSuggestionIndex(state.doelen);
  state.bronnen = data.bronnen || [];
  loadNotesFromStorage();

  if (els.metaStats) {
    els.metaStats.innerHTML = `
      <strong>${data.meta.aantal}</strong> doelen<br />
      <span>${data.meta.vakken.join(" • ")}</span>
    `;
  }

  bindEvents();
  applyFilters();
}

init().catch((err) => {
  console.error(err);
  els.resultCount.textContent = "Fout bij laden van data";
  els.detailView.innerHTML = '<p class="placeholder">De data kon niet geladen worden.</p>';
});
