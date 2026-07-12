/* ============================================================
   VIBBY DASHBOARD
   Liste des projets + tableau de bord d'analytique par projet
   (KPIs, graphique d'activité, produits populaires, flux en direct).
   Toutes les données viennent de Supabase (table "projects" / "events").
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  let currentProject = null;
  let activityChart = null;
  let realtimeChannel = null;

  function client() {
    return window.VibbyAuth && window.VibbyAuth.getClient();
  }

  /* ---------------- PROJECT LIST ---------------- */
  async function showProjectList() {
    const loading = $("#projectsLoading");
    const grid = $("#projectsGrid");
    const empty = $("#projectsEmpty");
    loading.classList.remove("hidden");
    grid.classList.add("hidden");
    empty.classList.add("hidden");
    grid.innerHTML = "";

    const user = window.VibbyAuth.getUser();
    if (!user) return;

    const { data: projects, error } = await client()
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    loading.classList.add("hidden");

    if (error) {
      grid.classList.remove("hidden");
      grid.innerHTML = `<div class="empty-mini">Erreur de chargement : ${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!projects || !projects.length) {
      empty.classList.remove("hidden");
      return;
    }

    // aggregate event counts (last 30 days) for all projects in one query
    const ids = projects.map((p) => p.id);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    let counts = {};
    try {
      const { data: events } = await client()
        .from("events")
        .select("project_id, type")
        .in("project_id", ids)
        .gte("created_at", since);
      (events || []).forEach((e) => {
        counts[e.project_id] = counts[e.project_id] || { view: 0, add_to_cart: 0, checkout: 0 };
        counts[e.project_id][e.type] = (counts[e.project_id][e.type] || 0) + 1;
      });
    } catch (e) {
      counts = {};
    }

    grid.classList.remove("hidden");
    grid.innerHTML = projects
      .map((p) => {
        const c = counts[p.id] || { view: 0, add_to_cart: 0, checkout: 0 };
        return `
        <div class="pcard" data-id="${p.id}">
          <div class="pcard-top">
            <div>
              <div class="pcard-name">${escapeHtml(p.name || "Site sans nom")}</div>
              <div class="pcard-date">${formatDate(p.updated_at)}</div>
            </div>
            <span class="pcard-badge">${(p.options && p.options.stripe && p.pub_key) ? "Stripe actif" : "Configuration"}</span>
          </div>
          <div class="pcard-stats">
            <div class="pcard-stat"><b>${c.view}</b><span>Visites</span></div>
            <div class="pcard-stat"><b>${c.add_to_cart}</b><span>Paniers</span></div>
            <div class="pcard-stat"><b>${c.checkout}</b><span>Paiements</span></div>
          </div>
          <div class="pcard-actions">
            <button class="btn btn-g btn-sm" data-action="view" data-id="${p.id}" style="flex:1;">📊 Tableau de bord</button>
            <button class="btn btn-out btn-sm" data-action="edit" data-id="${p.id}">✎</button>
          </div>
        </div>`;
      })
      .join("");

    grid.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = projects.find((x) => x.id === btn.dataset.id);
        showDashboard(p);
      });
    });
    grid.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = projects.find((x) => x.id === btn.dataset.id);
        if (window.VibbyWizard) window.VibbyWizard.editProject(p);
      });
    });
  }

  /* ---------------- SINGLE DASHBOARD ---------------- */
  async function showDashboard(project) {
    currentProject = project;
    window.VibbyAuth.showScreen("screen-dashboard");
    $("#dashProjectName").textContent = project.name || "Site sans nom";

    $("#dashEditBtn").onclick = () => {
      if (window.VibbyWizard) window.VibbyWizard.editProject(project);
    };
    $("#dashDownloadBtn").onclick = () => {
      const blob = new Blob([project.html_generated || ""], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (project.name || "site") + ".html";
      a.click();
    };

    await loadDashboardData(project.id);
    subscribeRealtime(project.id);
  }

  async function loadDashboardData(projectId) {
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const since14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

    const { data: events30 } = await client()
      .from("events")
      .select("*")
      .eq("project_id", projectId)
      .gte("created_at", since30)
      .order("created_at", { ascending: false });

    renderKpis(events30 || []);
    renderChart((events30 || []).filter((e) => e.created_at >= since14));
    renderTopProducts(events30 || []);
    renderFeed((events30 || []).slice(0, 20));
  }

  function renderKpis(events) {
    const views = events.filter((e) => e.type === "view").length;
    const carts = events.filter((e) => e.type === "add_to_cart").length;
    const checkouts = events.filter((e) => e.type === "checkout");
    const conv = views ? ((checkouts.length / views) * 100).toFixed(1) : "0.0";

    const products = (currentProject.products || []);
    let revenue = 0;
    checkouts.forEach((c) => {
      const ids = (c.payload && c.payload.ids) || [];
      ids.forEach((id) => {
        const p = products.find((x) => x.id === id);
        if (p) revenue += parsePrice(p.priceDisplay) || 0;
      });
    });

    $("#kpiRevenue").textContent = "$" + revenue.toFixed(2);
    $("#kpiOrders").textContent = checkouts.length;
    $("#kpiVisits").textContent = views;
    $("#kpiConversion").textContent = conv + "%";

    setTrend("kpiRevenueTrend", revenue > 0 ? "Estimé, paiements lancés" : "Aucune donnée");
    setTrend("kpiOrdersTrend", checkouts.length ? "30 derniers jours" : "Aucune donnée");
    setTrend("kpiVisitsTrend", views ? "30 derniers jours" : "Aucune donnée");
    setTrend("kpiConversionTrend", views ? "visites → paiement" : "—");
  }

  function setTrend(id, text) {
    const el = $("#" + id);
    el.textContent = text;
    el.className = "kpi-trend flat";
  }

  function parsePrice(display) {
    if (!display) return null;
    const n = String(display).replace(/[^\d.,]/g, "").replace(",", ".");
    const f = parseFloat(n);
    return isNaN(f) ? null : f;
  }

  function renderChart(events) {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      days.push(d.toISOString().slice(0, 10));
    }
    const viewsByDay = days.map((d) => events.filter((e) => e.type === "view" && e.created_at.startsWith(d)).length);
    const checkoutByDay = days.map((d) => events.filter((e) => e.type === "checkout" && e.created_at.startsWith(d)).length);
    const labels = days.map((d) => {
      const dt = new Date(d + "T00:00:00");
      return dt.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
    });

    const ctx = document.getElementById("activityChart");
    if (!ctx || !window.Chart) return;
    if (activityChart) activityChart.destroy();

    activityChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Visites",
            data: viewsByDay,
            borderColor: "#00C27C",
            backgroundColor: "rgba(0,194,124,.10)",
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2.5,
          },
          {
            label: "Paiements lancés",
            data: checkoutByDay,
            borderColor: "#09110a",
            backgroundColor: "rgba(9,17,10,.05)",
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 8, usePointStyle: true, font: { size: 11 } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: "#e6ece7" }, ticks: { font: { size: 10 }, precision: 0 } },
        },
      },
    });
  }

  function renderTopProducts(events) {
    const counts = {};
    events
      .filter((e) => e.type === "add_to_cart")
      .forEach((e) => {
        const id = e.payload && e.payload.id;
        if (!id) return;
        counts[id] = (counts[id] || 0) + 1;
      });
    const products = currentProject.products || [];
    const ranked = Object.keys(counts)
      .map((id) => {
        const p = products.find((x) => x.id === id);
        return { name: p ? p.name : id, count: counts[id] };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const el = $("#topProductsList");
    if (!ranked.length) {
      el.innerHTML = '<div class="empty-mini">Pas encore de données.</div>';
      return;
    }
    const max = ranked[0].count;
    el.innerHTML = ranked
      .map(
        (r, i) => `
      <div class="top-product-row">
        <div class="tp-rank">${i + 1}</div>
        <div class="tp-name">${escapeHtml(r.name)}</div>
        <div class="tp-bar-wrap"><div class="tp-bar" style="width:${Math.max(8, (r.count / max) * 100)}%"></div></div>
        <div class="tp-count">${r.count}</div>
      </div>`
      )
      .join("");
  }

  function renderFeed(events) {
    const el = $("#activityFeed");
    if (!events.length) {
      el.innerHTML = '<div class="empty-mini">Pas encore d\'activité — partage le lien de ton site pour commencer à voir des visites ici.</div>';
      return;
    }
    const products = currentProject.products || [];
    el.innerHTML = events
      .map((e) => {
        let icon = "👀",
          cls = "view",
          text = "Nouvelle visite";
        if (e.type === "add_to_cart") {
          icon = "🛒";
          cls = "cart";
          const p = products.find((x) => x.id === (e.payload && e.payload.id));
          text = `Ajout au panier — <b>${escapeHtml(p ? p.name : "produit")}</b>`;
        } else if (e.type === "checkout") {
          icon = "💳";
          cls = "pay";
          const n = (e.payload && e.payload.ids && e.payload.ids.length) || 1;
          text = `Paiement lancé — <b>${n} article${n > 1 ? "s" : ""}</b>`;
        }
        return `
        <div class="feed-row">
          <div class="feed-ic ${cls}">${icon}</div>
          <div class="feed-txt">${text}</div>
          <div class="feed-time">${timeAgo(e.created_at)}</div>
        </div>`;
      })
      .join("");
  }

  function subscribeRealtime(projectId) {
    if (realtimeChannel) {
      client().removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    try {
      realtimeChannel = client()
        .channel("events-" + projectId)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "events", filter: "project_id=eq." + projectId },
          () => {
            loadDashboardData(projectId);
            flashLiveTag();
          }
        )
        .subscribe();
    } catch (e) {
      /* realtime optional — dashboard still works via manual reload */
    }
  }

  function flashLiveTag() {
    const tag = $("#feedLiveTag");
    if (!tag) return;
    tag.textContent = "nouvelle activité ✨";
    tag.style.color = "#009960";
    setTimeout(() => {
      tag.textContent = "en direct";
      tag.style.color = "";
    }, 2000);
  }

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return Math.floor(s / 60) + " min";
    if (s < 86400) return Math.floor(s / 3600) + " h";
    return Math.floor(s / 86400) + " j";
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.VibbyDashboard = {
    showProjectList,
    showDashboard,
  };
})();
