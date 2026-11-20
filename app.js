const $ = id => document.getElementById(id);
const dateInput = $("dateInput"), matchesList = $("matchesList");
let partidos = [];
let currentController = null;

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prettyDate(v) {
  return new Date(`${v}T12:00:00`).toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

function statusInfo(c, elapsed) {
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(c)) {
    const min = c === "HT" ? "ET" : (elapsed ? `${elapsed}'` : "");
    return [`EN VIVO ${min}`.trim(), "live", "live"];
  }
  if (["FT", "AET", "PEN", "AWD", "WO"].includes(c)) {
    return ["FINALIZADO", "finished", "finished"];
  }
  if (["PST", "CANC", "ABD"].includes(c)) {
    return [c === "PST" ? "APLAZADO" : c === "CANC" ? "CANCELADO" : "ABANDONADO", "other", "other"];
  }
  return ["PROGRAMADO", "scheduled", "scheduled"];
}

function safe(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Llena dinámicamente el <select id="leagueFilter"> con las ligas del día
function populateLeagues(lista) {
  const select = $("leagueFilter");
  if (!select) return;
  const previousValue = select.value;
  const ligasMap = new Map();

  lista.forEach(p => {
    if (p.league?.id && p.league?.name) {
      const label = p.league.country ? `${p.league.country} - ${p.league.name}` : p.league.name;
      ligasMap.set(String(p.league.id), label);
    }
  });

  // Ordenar ligas alfabéticamente
  const ordenadas = [...ligasMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  select.innerHTML = `<option value="all">Todas las ligas (${ordenadas.length})</option>`;
  ordenadas.forEach(([id, label]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    select.appendChild(opt);
  });

  // Mantener selección si la liga sigue existiendo en la nueva fecha
  if (ligasMap.has(previousValue)) {
    select.value = previousValue;
  }
}

function render() {
  const sf = $("statusFilter").value;
  const lf = $("leagueFilter") ? $("leagueFilter").value : "all";
  const q = $("searchInput").value.trim().toLowerCase();

  // Ordenar partidos cronológicamente por hora de inicio
  const sorted = [...partidos].sort((a, b) => new Date(a.fixture?.date) - new Date(b.fixture?.date));

  const filtered = sorted.filter(p => {
    const [, , key] = statusInfo(p.fixture?.status?.short);
    const leagueId = String(p.league?.id || "");
    const names = [p.teams?.home?.name, p.teams?.away?.name, p.league?.name, p.league?.country].join(" ").toLowerCase();
    
    const matchStatus = sf === "all" || sf === key;
    const matchLeague = lf === "all" || lf === leagueId;
    const matchQuery = !q || names.includes(q);
    
    return matchStatus && matchLeague && matchQuery;
  });

  matchesList.innerHTML = "";
  $("message").hidden = filtered.length > 0;
  $("message").textContent = partidos.length
    ? "No hay partidos que coincidan con los filtros."
    : "No hay partidos programados para esta fecha.";

  filtered.forEach(p => {
    const f = p.fixture || {}, l = p.league || {}, t = p.teams || {}, g = p.goals || {}, h = t.home || {}, a = t.away || {};
    const [label, cls] = statusInfo(f.status?.short, f.status?.elapsed);
    
    let time = "--:--";
    try {
      time = new Date(f.date).toLocaleTimeString("es-AR", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires"
      });
    } catch (e) {}

    const score = (g.home === null || g.home === undefined) ? "-" : g.home;
    const away = (g.away === null || g.away === undefined) ? "-" : g.away;

    const card = document.createElement("article");
    card.className = "match-card";
    card.innerHTML = `
      <div class="league">
        <div class="league-name">${safe(l.name || "Competición")}</div>
        <div class="league-country">${safe(l.country || "")}</div>
      </div>
      <div class="teams">
        <div class="team">${h.logo ? `<img src="${safe(h.logo)}" alt="" loading="lazy">` : ""}<span class="team-name">${safe(h.name || "Local")}</span></div>
        <div class="score">${score} - ${away}</div>
        <div class="team">${a.logo ? `<img src="${safe(a.logo)}" alt="" loading="lazy">` : ""}<span class="team-name">${safe(a.name || "Visitante")}</span></div>
      </div>
      <div class="match-time"><strong>${time} hs</strong><span class="state ${cls}">${label}</span></div>
    `;
    matchesList.appendChild(card);
  });

  $("totalMatches").textContent = partidos.length;
  $("liveMatches").textContent = partidos.filter(p => statusInfo(p.fixture?.status?.short)[2] === "live").length;
  $("finishedMatches").textContent = partidos.filter(p => statusInfo(p.fixture?.status?.short)[2] === "finished").length;
}

async function loadMatches(force = false) {
  if (currentController) currentController.abort();
  currentController = new AbortController();

  const fecha = dateInput.value;
  $("dateLabel").textContent = prettyDate(fecha);
  $("message").hidden = false;
  $("message").className = "message";
  $("message").textContent = "Buscando partidos...";

  try {
    const r = await fetch(`/api/partidos?fecha=${encodeURIComponent(fecha)}${force ? "&actualizar=1" : ""}`, {
      signal: currentController.signal
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || "No se pudieron cargar los partidos.");
    
    partidos = Array.isArray(data.partidos) ? data.partidos : [];
    populateLeagues(partidos);
    render();
  } catch (e) {
    if (e.name === "AbortError") return;
    partidos = [];
    matchesList.innerHTML = "";
    $("totalMatches").textContent = "—";
    $("liveMatches").textContent = "—";
    $("finishedMatches").textContent = "—";
    $("message").hidden = false;
    $("message").className = "message error";
    $("message").textContent = e.message;
  }
}

function shiftDate(n) {
  const d = new Date(`${dateInput.value}T12:00:00`);
  d.setDate(d.getDate() + n);
  dateInput.value = localDateString(d);
  loadMatches();
}

// Inicialización y eventos
dateInput.value = localDateString();
loadMatches();

$("prevDay").addEventListener("click", () => shiftDate(-1));
$("nextDay").addEventListener("click", () => shiftDate(1));
$("todayButton").addEventListener("click", () => { dateInput.value = localDateString(); loadMatches(); });
$("refreshButton").addEventListener("click", () => loadMatches(true));
dateInput.addEventListener("change", () => loadMatches());
$("statusFilter").addEventListener("change", render);
if ($("leagueFilter")) $("leagueFilter").addEventListener("change", render);
$("searchInput").addEventListener("input", render);