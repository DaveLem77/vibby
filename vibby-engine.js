/* ============================================================
   VIBBY ENGINE
   Runs entirely client-side. Powers the wizard on vibby.html.
   Nothing here is ever sent to a server — parsing, detection,
   code generation all happen in the visitor's own browser.
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- STATE ---------------- */
  const state = {
    step: 1,
    rawHtml: "",
    options: { detect: true, cart: true, stripe: true, analytics: true },
    intentText: "",
    products: [],
    pubKey: "",
    finalHtml: "",
    editingProjectId: null,
    projectName: "",
  };

  const STEPS = [
    { n: 1, label: "Coller" },
    { n: 2, label: "Décrire" },
    { n: 3, label: "Produits & Stripe" },
    { n: 4, label: "Générer" },
  ];

  /* ---------------- SAMPLE SITE (for "Essayer avec un exemple") ---------------- */
  const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Atelier Luma — Bougies artisanales</title>
<style>
body{font-family:sans-serif;background:#faf8f5;color:#2b2b2b;margin:0;padding:0;}
header{padding:24px;text-align:center;border-bottom:1px solid #eee;}
h1{margin:0;font-size:22px;}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:40px;max-width:1000px;margin:0 auto;}
.card{border:1px solid #eee;border-radius:12px;padding:16px;text-align:center;}
.card img{width:100%;border-radius:8px;margin-bottom:12px;}
.card h3{margin:0 0 6px;font-size:16px;}
.price{font-weight:700;color:#a6693b;margin-bottom:12px;}
button{background:#a6693b;color:#fff;border:none;padding:10px 18px;border-radius:8px;cursor:pointer;font-size:14px;}
</style>
</head>
<body>
<header><h1>Atelier Luma</h1><p>Bougies faites main, à Montréal</p></header>
<div class="grid">
  <div class="card">
    <img src="https://images.unsplash.com/photo-1602874801006-4f6b0b9e0b8a?w=300" alt="Bougie Cèdre">
    <h3>Bougie Cèdre &amp; Mousse</h3>
    <div class="price">32,00 $</div>
    <button>Ajouter au panier</button>
  </div>
  <div class="card">
    <img src="https://images.unsplash.com/photo-1603006905003-be475563bc59?w=300" alt="Bougie Vanille">
    <h3>Bougie Vanille Fumée</h3>
    <div class="price">28,00 $</div>
    <button>Ajouter au panier</button>
  </div>
  <div class="card">
    <img src="https://images.unsplash.com/photo-1608181831718-a5b9c1c5f2e2?w=300" alt="Coffret">
    <h3>Coffret découverte (3)</h3>
    <div class="price">79,00 $</div>
    <button>Acheter maintenant</button>
  </div>
</div>
</body>
</html>`;

  /* ---------------- HELPERS ---------------- */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function showToast(msg) {
    const t = $("#copyToast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1800);
  }

  /* ---------------- STEPPER RENDER ---------------- */
  function renderStepper() {
    const el = $("#stepper");
    el.innerHTML = "";
    STEPS.forEach((s, i) => {
      const pill = document.createElement("div");
      pill.className =
        "step-pill" +
        (s.n === state.step ? " active" : "") +
        (s.n < state.step ? " done" : "");
      pill.innerHTML = `<span class="n">${s.n < state.step ? "✓" : s.n}</span>${s.label}`;
      el.appendChild(pill);
      if (i < STEPS.length - 1) {
        const sep = document.createElement("div");
        sep.className = "step-sep";
        el.appendChild(sep);
      }
    });
  }

  function goToStep(n) {
    state.step = n;
    $all(".step-panel").forEach((p) => p.classList.add("hidden"));
    $("#step-" + n).classList.remove("hidden");
    renderStepper();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ============================================================
     DETECTION ENGINE
     ============================================================ */
  const PRICE_RE =
    /(?:\$|€|£|CAD\$|US\$)\s?\d{1,6}(?:[.,]\d{2})?|\d{1,6}(?:[.,]\d{2})?\s?(?:\$|€|£)|\d{1,6}(?:[.,]\d{2})?\s?(?:USD|EUR|CAD)\b/;

  const BUY_KEYWORDS = [
    "buy",
    "add to cart",
    "add to bag",
    "shop now",
    "order now",
    "purchase",
    "buy now",
    "checkout",
    "get it",
    "acheter",
    "ajouter au panier",
    "ajouter",
    "commander",
    "achat",
    "panier",
    "acheter maintenant",
    "je commande",
  ];

  function detectProducts(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const body = doc.body || doc;

    // find text nodes containing a price
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const priceNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.nodeValue.trim();
      if (txt && PRICE_RE.test(txt) && node.parentElement) {
        priceNodes.push(node);
      }
    }

    const cards = new Set();
    priceNodes.forEach((tNode) => {
      let el = tNode.parentElement;
      let best = el;
      let depth = 0;
      while (el && depth < 6) {
        const hasImg = !!el.querySelector && el.querySelector("img");
        const textLen = (el.textContent || "").length;
        if (hasImg && textLen < 700) {
          best = el;
          break;
        }
        best = el;
        el = el.parentElement;
        depth++;
      }
      if (best && best.tagName && !["HTML", "BODY", "MAIN"].includes(best.tagName)) {
        cards.add(best);
      }
    });

    const products = [];
    let idx = 0;
    cards.forEach((card) => {
      if (idx >= 24) return;
      idx++;
      const id = "vibby-p-" + idx;
      card.setAttribute("data-vibby-card", id);

      // find a buy button inside
      let btn = null;
      const clickable = card.querySelectorAll("button, a");
      for (const c of clickable) {
        const t = (c.textContent || "").toLowerCase();
        if (BUY_KEYWORDS.some((k) => t.includes(k))) {
          btn = c;
          break;
        }
      }
      if (!btn && clickable.length) btn = clickable[0];

      let synthesized = false;
      if (!btn) {
        btn = doc.createElement("button");
        btn.textContent = "Ajouter au panier";
        btn.setAttribute("class", "vibby-inject-btn");
        card.appendChild(btn);
        synthesized = true;
      }
      btn.setAttribute("data-vibby-buy", id);

      // name
      let name = "";
      const heading = card.querySelector("h1,h2,h3,h4,h5,h6,strong,b");
      if (heading) name = heading.textContent.trim();
      if (!name) name = "Produit " + idx;
      name = name.slice(0, 80);

      // price
      const priceMatch = (card.textContent.match(PRICE_RE) || [""])[0].trim();

      // image
      const img = card.querySelector("img");
      const image = img ? img.getAttribute("src") || "" : "";

      const confidence = img && !synthesized && priceMatch ? "high" : "med";

      products.push({
        id,
        name,
        priceDisplay: priceMatch || "",
        image,
        include: true,
        paymentLink: "",
        confidence,
      });
    });

    return { doc, products };
  }

  /* ============================================================
     STEP 1 — PASTE
     ============================================================ */
  function initStep1() {
    const area = $("#pasteArea");
    const count = $("#pasteCount");
    const next = $("#toStep2");

    area.addEventListener("input", () => {
      const len = area.value.length;
      count.textContent = len.toLocaleString("fr-CA") + " caractères";
      next.disabled = len < 20;
    });

    $("#loadExampleBtn").addEventListener("click", () => {
      area.value = SAMPLE_HTML;
      area.dispatchEvent(new Event("input"));
      showToast("Exemple chargé");
    });

    next.addEventListener("click", () => {
      state.rawHtml = area.value;
      goToStep(2);
    });
  }

  /* ============================================================
     STEP 2 — INTENT
     ============================================================ */
  function initStep2() {
    $all(".opt").forEach((opt) => {
      const key = opt.getAttribute("data-opt");
      const input = opt.querySelector("input");
      input.addEventListener("change", () => {
        state.options[key] = input.checked;
        opt.classList.toggle("checked", input.checked);
      });
    });

    $("#toStep1b").addEventListener("click", () => goToStep(1));

    $("#toStep3").addEventListener("click", () => {
      state.intentText = $("#intentText").value || "";
      applyIntentKeywords(state.intentText);
      runDetectionAndRender();
      goToStep(3);
    });
  }

  // Very light keyword pass over the free-text box: lets a user
  // nudge behaviour without needing a real AI backend call.
  function applyIntentKeywords(text) {
    const t = text.toLowerCase();
    if (!t) return;
    if (/(pas de panier|sans panier|no cart)/.test(t)) state.options.cart = false;
    if (/(pas de stripe|sans paiement|no payment|no stripe)/.test(t)) state.options.stripe = false;
    if (/(pas de suivi|sans suivi|no analytics|no tracking)/.test(t)) state.options.analytics = false;
  }

  /* ============================================================
     STEP 3 — PRODUCTS + STRIPE
     ============================================================ */
  function runDetectionAndRender() {
    if (state.options.detect) {
      const { products } = detectProducts(state.rawHtml);
      state.products = products;
    } else {
      state.products = [];
    }
    renderProductList();
    $("#stripeSection").classList.toggle("hidden", !state.options.stripe);
  }

  function renderProductList() {
    $("#detectCount").textContent = state.products.length;
    const list = $("#productList");
    list.innerHTML = "";
    $("#noProductsMsg").classList.toggle("hidden", state.products.length !== 0);

    state.products.forEach((p) => {
      const row = document.createElement("div");
      row.className = "pitem" + (p.include ? "" : " excluded");
      row.innerHTML = `
        ${p.image ? `<img class="pimg" src="${escapeAttr(p.image)}" onerror="this.style.opacity=0.2">` : `<div class="pimg-ph">🛍️</div>`}
        <div>
          <div class="pfields">
            <input type="text" class="full" data-f="name" value="${escapeAttr(p.name)}" placeholder="Nom du produit">
            <input type="text" data-f="priceDisplay" value="${escapeAttr(p.priceDisplay)}" placeholder="Prix">
            <span class="pconf ${p.confidence === "high" ? "high" : "med"}">${p.confidence === "high" ? "Fiable" : "À vérifier"}</span>
          </div>
          ${
            state.options.stripe
              ? `<div class="plink-row">
                  <input type="url" data-f="paymentLink" value="${escapeAttr(p.paymentLink)}" placeholder="Lien de paiement Stripe (https://buy.stripe.com/...)">
                </div>`
              : ""
          }
        </div>
        <div class="pactions">
          <label class="toggle-lbl"><input type="checkbox" data-f="include" ${p.include ? "checked" : ""}> inclure</label>
          <button class="icbtn" data-remove="1" title="Retirer">✕</button>
        </div>
      `;
      row.querySelectorAll("[data-f]").forEach((input) => {
        const field = input.getAttribute("data-f");
        const evt = input.type === "checkbox" ? "change" : "input";
        input.addEventListener(evt, () => {
          if (field === "include") {
            p.include = input.checked;
            row.classList.toggle("excluded", !p.include);
          } else {
            p[field] = input.value;
          }
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        state.products = state.products.filter((x) => x.id !== p.id);
        renderProductList();
      });
      list.appendChild(row);
    });
  }

  function escapeAttr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function addManualProduct() {
    const idx = state.products.length + 1;
    state.products.push({
      id: "vibby-manual-" + Date.now() + "-" + idx,
      name: "Nouveau produit",
      priceDisplay: "",
      image: "",
      include: true,
      paymentLink: "",
      confidence: "med",
      manual: true,
    });
    renderProductList();
  }

  function initStep3() {
    $("#addManualBtn").addEventListener("click", addManualProduct);
    $("#pubKeyInput").addEventListener("input", (e) => {
      state.pubKey = e.target.value.trim();
    });
    $("#toStep2b").addEventListener("click", () => goToStep(2));
    $("#toStep4").addEventListener("click", () => {
      generateFinalSite();
      goToStep(4);
    });
  }

  /* ============================================================
     RUNTIME FACTORY — this function's SOURCE (via .toString())
     is what gets injected into the user's final generated site.
     It never runs on vibby.html itself.
     ============================================================ */
  function vibbyRuntimeFactory() {
    var PRODUCTS = window.__VIBBY_PRODUCTS__ || [];
    var OPTIONS = window.__VIBBY_OPTIONS__ || {};
    var CHECKOUT_ENDPOINT = window.__VIBBY_CHECKOUT_ENDPOINT__ || "";
    var PUB_KEY = window.__VIBBY_PUBKEY__ || "";
    var SUPABASE_URL = window.__VIBBY_SUPABASE_URL__ || "";
    var SUPABASE_ANON_KEY = window.__VIBBY_SUPABASE_ANON_KEY__ || "";
    var PROJECT_ID = window.__VIBBY_PROJECT_ID__ || "";

    function parsePrice(display) {
      if (!display) return null;
      var n = display.replace(/[^\d.,]/g, "").replace(",", ".");
      var f = parseFloat(n);
      return isNaN(f) ? null : f;
    }
    PRODUCTS.forEach(function (p) {
      p.priceNumeric = parsePrice(p.priceDisplay);
    });

    /* ---------- analytics ---------- */
    var Analytics = {
      key: "vibby_analytics_v1",
      read: function () {
        try {
          return JSON.parse(localStorage.getItem(this.key)) || { views: [], addToCart: [], checkout: [] };
        } catch (e) {
          return { views: [], addToCart: [], checkout: [] };
        }
      },
      write: function (d) {
        try {
          localStorage.setItem(this.key, JSON.stringify(d));
        } catch (e) {}
      },
      track: function (type, payload) {
        if (!OPTIONS.analytics) return;
        var d = this.read();
        var entry = Object.assign({ ts: Date.now() }, payload || {});
        if (type === "view") d.views.push(entry);
        if (type === "add_to_cart") d.addToCart.push(entry);
        if (type === "checkout") d.checkout.push(entry);
        ["views", "addToCart", "checkout"].forEach(function (k) {
          if (d[k].length > 1000) d[k] = d[k].slice(-1000);
        });
        this.write(d);
        if (SUPABASE_URL && SUPABASE_ANON_KEY && PROJECT_ID) {
          try {
            fetch(SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/events", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_ANON_KEY,
                Authorization: "Bearer " + SUPABASE_ANON_KEY,
                Prefer: "return=minimal",
              },
              body: JSON.stringify({ project_id: PROJECT_ID, type: type, payload: payload || {} }),
              keepalive: true,
            }).catch(function () {});
          } catch (e) {}
        }
      },
    };

    if (OPTIONS.analytics) Analytics.track("view");

    function renderAdminDashboard() {
      var d = Analytics.read();
      var byProduct = {};
      d.addToCart.forEach(function (e) {
        byProduct[e.id] = (byProduct[e.id] || 0) + 1;
      });
      var topProducts = Object.keys(byProduct)
        .map(function (id) {
          var p = PRODUCTS.filter(function (x) {
            return x.id === id;
          })[0];
          return { name: p ? p.name : id, count: byProduct[id] };
        })
        .sort(function (a, b) {
          return b.count - a.count;
        })
        .slice(0, 5);

      var conv = d.views.length ? ((d.checkout.length / d.views.length) * 100).toFixed(1) : "0.0";

      var overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;background:rgba(9,17,10,.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif;";
      overlay.innerHTML =
        '<div style="background:#fff;border-radius:16px;max-width:480px;width:100%;padding:26px;max-height:85vh;overflow:auto;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
        '<div style="font-size:18px;font-weight:800;">📊 Tableau de bord Vibby</div>' +
        '<button id="vibbyCloseAdmin" style="border:none;background:#f6f7f6;width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:14px;">✕</button>' +
        "</div>" +
        '<div style="font-size:11px;color:#8fa898;margin-bottom:14px;">Statistiques locales à cet appareil/navigateur (secours hors-ligne).' +
        (SUPABASE_URL && PROJECT_ID ? " Le vrai tableau de bord Vibby (multi-visiteurs) est aussi actif." : " Connecte ce site à un projet Vibby pour des stats multi-visiteurs.") +
        "</div>" +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">' +
        statBox(d.views.length, "Visites") +
        statBox(d.addToCart.length, "Ajouts panier") +
        statBox(d.checkout.length, "Paiements lancés") +
        statBox(conv + "%", "Conversion") +
        "</div>" +
        '<div style="font-size:12px;font-weight:700;color:#4a5d51;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;">Produits populaires</div>' +
        (topProducts.length
          ? topProducts
              .map(function (t) {
                return (
                  '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e6ece7;font-size:13px;"><span>' +
                  t.name +
                  "</span><b>" +
                  t.count +
                  "</b></div>"
                );
              })
              .join("")
          : '<div style="font-size:12px;color:#8fa898;">Pas encore de données.</div>') +
        '<div style="display:flex;gap:8px;margin-top:18px;">' +
        '<button id="vibbyResetStats" style="flex:1;padding:9px;border-radius:8px;border:1.5px solid #cddacf;background:#fff;cursor:pointer;font-size:12px;font-weight:600;">Réinitialiser</button>' +
        '<button id="vibbyExportStats" style="flex:1;padding:9px;border-radius:8px;border:none;background:#00C27C;color:#fff;cursor:pointer;font-size:12px;font-weight:700;">Exporter CSV</button>' +
        "</div>" +
        "</div>";
      document.body.appendChild(overlay);
      document.getElementById("vibbyCloseAdmin").onclick = function () {
        overlay.remove();
      };
      document.getElementById("vibbyResetStats").onclick = function () {
        localStorage.removeItem(Analytics.key);
        overlay.remove();
        renderAdminDashboard();
      };
      document.getElementById("vibbyExportStats").onclick = function () {
        var rows = [["type", "timestamp", "detail"]];
        d.views.forEach(function (e) {
          rows.push(["view", new Date(e.ts).toISOString(), ""]);
        });
        d.addToCart.forEach(function (e) {
          rows.push(["add_to_cart", new Date(e.ts).toISOString(), e.id || ""]);
        });
        d.checkout.forEach(function (e) {
          rows.push(["checkout", new Date(e.ts).toISOString(), (e.ids || []).join("|")]);
        });
        var csv = rows.map(function (r) { return r.join(","); }).join("\n");
        var blob = new Blob([csv], { type: "text/csv" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vibby-stats.csv";
        a.click();
      };
      function statBox(val, label) {
        return (
          '<div style="border:1px solid #e6ece7;border-radius:10px;padding:10px;text-align:center;background:#f6f7f6;"><div style="font-size:20px;font-weight:800;color:#00C27C;">' +
          val +
          '</div><div style="font-size:10px;color:#4a5d51;font-weight:600;text-transform:uppercase;">' +
          label +
          "</div></div>"
        );
      }
    }

    try {
      if (new URLSearchParams(location.search).get("vibby-admin") === "1") {
        document.addEventListener("DOMContentLoaded", renderAdminDashboard);
      }
    } catch (e) {}

    /* ---------- cart ---------- */
    if (!OPTIONS.cart) return;

    var CART_KEY = "vibby_cart_v1";
    var Cart = {
      items: {},
      load: function () {
        try {
          this.items = JSON.parse(localStorage.getItem(CART_KEY)) || {};
        } catch (e) {
          this.items = {};
        }
      },
      save: function () {
        try {
          localStorage.setItem(CART_KEY, JSON.stringify(this.items));
        } catch (e) {}
      },
      add: function (id) {
        this.items[id] = (this.items[id] || 0) + 1;
        this.save();
        this.render();
        Analytics.track("add_to_cart", { id: id });
        toast("Ajouté au panier");
      },
      setQty: function (id, qty) {
        if (qty <= 0) delete this.items[id];
        else this.items[id] = qty;
        this.save();
        this.render();
      },
      remove: function (id) {
        delete this.items[id];
        this.save();
        this.render();
      },
      count: function () {
        return Object.values(this.items).reduce(function (a, b) { return a + b; }, 0);
      },
      subtotal: function () {
        var total = 0;
        var hasUnknown = false;
        Object.keys(this.items).forEach(function (id) {
          var p = PRODUCTS.filter(function (x) { return x.id === id; })[0];
          if (p && p.priceNumeric != null) total += p.priceNumeric * this.items[id];
          else hasUnknown = true;
        }, this);
        return { total: total, hasUnknown: hasUnknown };
      },
      render: function () {
        var badge = document.getElementById("vibbyCartBadge");
        var count = this.count();
        if (badge) {
          badge.textContent = count;
          badge.style.display = count ? "flex" : "none";
        }
        var panelBody = document.getElementById("vibbyCartBody");
        if (!panelBody) return;
        var self = this;
        var ids = Object.keys(this.items);
        if (!ids.length) {
          panelBody.innerHTML = '<div style="padding:30px 10px;text-align:center;color:#8fa898;font-size:13px;">Ton panier est vide</div>';
        } else {
          panelBody.innerHTML = ids
            .map(function (id) {
              var p = PRODUCTS.filter(function (x) { return x.id === id; })[0] || { name: id, priceDisplay: "" };
              var qty = self.items[id];
              return (
                '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);align-items:center;">' +
                (p.image ? '<img src="' + p.image + '" style="width:42px;height:42px;border-radius:7px;object-fit:cover;">' : '<div style="width:42px;height:42px;border-radius:7px;background:rgba(255,255,255,.06);"></div>') +
                '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + p.name + "</div>" +
                '<div style="font-size:11.5px;color:rgba(255,255,255,.45);">' + (p.priceDisplay || "") + "</div>" +
                '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">' +
                '<button data-qty-dec="' + id + '" style="width:20px;height:20px;border-radius:5px;border:1px solid rgba(255,255,255,.15);background:none;color:#fff;cursor:pointer;">−</button>' +
                '<span style="font-size:12px;color:#fff;">' + qty + "</span>" +
                '<button data-qty-inc="' + id + '" style="width:20px;height:20px;border-radius:5px;border:1px solid rgba(255,255,255,.15);background:none;color:#fff;cursor:pointer;">+</button>' +
                '<button data-remove="' + id + '" style="margin-left:auto;font-size:11px;color:rgba(255,255,255,.4);background:none;border:none;cursor:pointer;">retirer</button>' +
                "</div></div></div>"
              );
            })
            .join("");
          panelBody.querySelectorAll("[data-qty-inc]").forEach(function (b) {
            b.onclick = function () { self.setQty(b.getAttribute("data-qty-inc"), (self.items[b.getAttribute("data-qty-inc")] || 0) + 1); };
          });
          panelBody.querySelectorAll("[data-qty-dec]").forEach(function (b) {
            b.onclick = function () { self.setQty(b.getAttribute("data-qty-dec"), (self.items[b.getAttribute("data-qty-dec")] || 0) - 1); };
          });
          panelBody.querySelectorAll("[data-remove]").forEach(function (b) {
            b.onclick = function () { self.remove(b.getAttribute("data-remove")); };
          });
        }
        var sub = this.subtotal();
        var subEl = document.getElementById("vibbyCartSubtotal");
        if (subEl) subEl.textContent = "$" + sub.total.toFixed(2) + (sub.hasUnknown ? " +" : "");
        renderCheckoutArea(ids);
      },
    };

    function renderCheckoutArea(ids) {
      var area = document.getElementById("vibbyCheckoutArea");
      if (!area) return;
      if (!OPTIONS.stripe || !PUB_KEY) {
        area.innerHTML = '<div style="font-size:11.5px;color:rgba(255,255,255,.4);text-align:center;padding:8px 0;">Paiement non configuré</div>';
        return;
      }
      if (!ids.length) {
        area.innerHTML = "";
        return;
      }
      if (CHECKOUT_ENDPOINT) {
        area.innerHTML = '<button id="vibbyUnifiedCheckout" style="width:100%;padding:13px;border-radius:9px;border:none;background:#00C27C;color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;">Payer maintenant →</button>';
        document.getElementById("vibbyUnifiedCheckout").onclick = function () {
          Analytics.track("checkout", { ids: ids });
          var lineItems = ids.map(function (id) {
            var p = PRODUCTS.filter(function (x) { return x.id === id; })[0];
            return { id: id, name: p ? p.name : id, qty: Cart.items[id] };
          });
          fetch(CHECKOUT_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: lineItems }),
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data && data.url) location.href = data.url;
              else alert("Erreur de paiement — vérifie ta configuration serveur.");
            })
            .catch(function () { alert("Impossible de contacter le serveur de paiement."); });
        };
        return;
      }
      if (ids.length === 1) {
        var p = PRODUCTS.filter(function (x) { return x.id === ids[0]; })[0];
        if (!p || !p.paymentLink) {
          area.innerHTML = '<div style="font-size:11.5px;color:#f5a524;text-align:center;padding:8px 0;">Lien de paiement manquant pour ce produit</div>';
          return;
        }
        area.innerHTML = '<button id="vibbySingleCheckout" style="width:100%;padding:13px;border-radius:9px;border:none;background:#00C27C;color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;">Payer maintenant →</button>';
        document.getElementById("vibbySingleCheckout").onclick = function () {
          Analytics.track("checkout", { ids: ids });
          location.href = p.paymentLink;
        };
        return;
      }
      // multiple distinct products, no unified server: sequential links
      var html = '<div style="font-size:10.5px;color:rgba(255,255,255,.45);margin-bottom:6px;">Paiement en ' + ids.length + " étapes (Stripe sans serveur) :</div>";
      ids.forEach(function (id, i) {
        var pr = PRODUCTS.filter(function (x) { return x.id === id; })[0];
        var link = pr ? pr.paymentLink : "";
        html +=
          '<a href="' + (link || "#") + '" target="_blank" rel="noopener" style="display:block;text-align:center;padding:10px;border-radius:8px;background:' +
          (link ? "#00C27C" : "rgba(255,255,255,.08)") +
          ";color:#fff;font-size:12.5px;font-weight:700;margin-bottom:6px;" +
          (link ? "cursor:pointer;" : "cursor:not-allowed;opacity:.5;") +
          '">' +
          (i + 1) + ". Payer " + (pr ? pr.name : id) + (link ? " →" : " (lien manquant)") +
          "</a>";
      });
      area.innerHTML = html;
      area.querySelectorAll("a").forEach(function (a, i) {
        a.addEventListener("click", function () {
          if (i === 0) Analytics.track("checkout", { ids: ids });
        });
      });
    }

    function toast(msg) {
      var t = document.createElement("div");
      t.textContent = msg;
      t.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#09110a;color:#fff;padding:10px 18px;border-radius:100px;font-size:13px;font-weight:600;z-index:100000;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transition:opacity .2s;";
      document.body.appendChild(t);
      requestAnimationFrame(function () {
        t.style.opacity = "1";
      });
      setTimeout(function () {
        t.style.opacity = "0";
        setTimeout(function () { t.remove(); }, 250);
      }, 1600);
    }

    function buildCartUI() {
      var btn = document.createElement("div");
      btn.id = "vibbyCartToggle";
      btn.style.cssText =
        "position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#00C27C;box-shadow:0 8px 24px rgba(0,194,124,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:99998;";
      btn.innerHTML =
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>' +
        '<div id="vibbyCartBadge" style="position:absolute;top:-4px;right:-4px;background:#09110a;color:#fff;font-size:11px;font-weight:800;min-width:20px;height:20px;border-radius:10px;display:none;align-items:center;justify-content:center;padding:0 5px;">0</div>';

      var panel = document.createElement("div");
      panel.id = "vibbyCartPanel";
      panel.style.cssText =
        "position:fixed;top:0;right:0;bottom:0;width:340px;max-width:92vw;background:#09110a;box-shadow:-10px 0 40px rgba(0,0,0,.25);z-index:99999;transform:translateX(100%);transition:transform .25s cubic-bezier(.16,1,.3,1);display:flex;flex-direction:column;font-family:Inter,sans-serif;";
      panel.innerHTML =
        '<div style="padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="color:#fff;font-weight:800;font-size:15px;">Ton panier</div>' +
        '<button id="vibbyCartClose" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:18px;cursor:pointer;">✕</button>' +
        "</div>" +
        '<div id="vibbyCartBody" style="flex:1;overflow:auto;padding:0 18px;"></div>' +
        '<div style="padding:16px 18px;border-top:1px solid rgba(255,255,255,.08);">' +
        '<div style="display:flex;justify-content:space-between;color:#fff;font-size:13px;margin-bottom:12px;"><span>Sous-total</span><b id="vibbyCartSubtotal">$0.00</b></div>' +
        '<div id="vibbyCheckoutArea"></div>' +
        "</div>";

      document.body.appendChild(btn);
      document.body.appendChild(panel);
      btn.onclick = function () { panel.style.transform = "translateX(0)"; };
      panel.querySelector("#vibbyCartClose").onclick = function () { panel.style.transform = "translateX(100%)"; };
    }

    function wireButtons() {
      document.querySelectorAll("[data-vibby-buy]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          Cart.add(btn.getAttribute("data-vibby-buy"));
        });
      });
    }

    function init() {
      Cart.load();
      buildCartUI();
      wireButtons();
      Cart.render();
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  /* ============================================================
     GENERATE FINAL SITE
     ============================================================ */
  function generateFinalSite(trackingInfo) {
    trackingInfo = trackingInfo || {};
    let workingHtml = state.rawHtml;
    let doc;

    if (state.options.detect && state.products.length) {
      // re-run detection to get a fresh, mutated doc, then reconcile with edited product data
      const detected = detectProducts(state.rawHtml);
      doc = detected.doc;
      // sync edited fields (name/price/link/include) back by id; drop excluded
      const byId = {};
      state.products.forEach((p) => (byId[p.id] = p));
      detected.products.forEach((dp) => {
        const edited = byId[dp.id];
        if (edited && !edited.include) {
          const card = doc.querySelector('[data-vibby-card="' + dp.id + '"]');
          const btn = doc.querySelector('[data-vibby-buy="' + dp.id + '"]');
          if (btn) btn.removeAttribute("data-vibby-buy");
        }
      });
    } else {
      doc = new DOMParser().parseFromString(
        workingHtml.trim().match(/^<!doctype|<html/i) ? workingHtml : `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${workingHtml}</body></html>`,
        "text/html"
      );
    }

    // manual products don't exist in the doc — nothing to tag, they only add to cart via id (no physical button),
    // they still work if user later wires a button manually using data-vibby-buy="id"

    const activeProducts = state.products.filter((p) => p.include);

    if (!doc.querySelector("html")) {
      // extremely defensive fallback
      doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${workingHtml}</body></html>`, "text/html");
    }

    // inject data + runtime script before </body>
    const dataScript = doc.createElement("script");
    dataScript.textContent =
      "window.__VIBBY_PRODUCTS__=" +
      JSON.stringify(
        activeProducts.map((p) => ({
          id: p.id,
          name: p.name,
          priceDisplay: p.priceDisplay,
          image: p.image,
          paymentLink: p.paymentLink,
        }))
      ) +
      ";window.__VIBBY_OPTIONS__=" +
      JSON.stringify(state.options) +
      ';window.__VIBBY_PUBKEY__="' +
      (state.pubKey || "").replace(/"/g, "") +
      '";window.__VIBBY_CHECKOUT_ENDPOINT__="' +
      (trackingInfo.checkoutEndpoint || "").replace(/"/g, "") +
      '";window.__VIBBY_SUPABASE_URL__="' +
      (trackingInfo.supabaseUrl || "").replace(/"/g, "") +
      '";window.__VIBBY_SUPABASE_ANON_KEY__="' +
      (trackingInfo.supabaseAnonKey || "").replace(/"/g, "") +
      '";window.__VIBBY_PROJECT_ID__="' +
      (trackingInfo.projectId || "").replace(/"/g, "") +
      '";';

    const runtimeScript = doc.createElement("script");
    runtimeScript.textContent = "(" + vibbyRuntimeFactory.toString() + ")();";

    const body = doc.body || doc.querySelector("body");
    body.appendChild(dataScript);
    body.appendChild(runtimeScript);

    // minimal injected styles for the synthesized button (if any) — keep unobtrusive
    const style = doc.createElement("style");
    style.textContent = ".vibby-inject-btn{background:#00C27C;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;}";
    (doc.head || doc.querySelector("head") || body).appendChild(style);

    const finalHtml = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    state.finalHtml = finalHtml;

    renderStep4(finalHtml, activeProducts);
  }

  function renderStep4(finalHtml, activeProducts) {
    $("#statProducts").textContent = activeProducts.length;
    $("#statCart").textContent = state.options.cart ? "✓ Actif" : "Désactivé";
    $("#statStripe").textContent = state.options.stripe && state.pubKey ? "✓ Connecté" : state.options.stripe ? "⚠ Clé manquante" : "Désactivé";
    $("#statAnalytics").textContent = state.options.analytics ? "✓ Actif" : "Désactivé";

    const frame = $("#previewFrame");
    frame.srcdoc = finalHtml;
  }

  /* ---------------- STEP 4 actions ---------------- */
  function initStep4() {
    $all(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $all(".tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        ["code", "server"].forEach((k) => $("#tab-" + k).classList.toggle("hidden", k !== tab.dataset.tab));
      });
    });

    $("#downloadBtn").addEventListener("click", () => {
      downloadFile((state.projectName || "mon-site-vibby") + ".html", state.finalHtml, "text/html");
    });

    $("#copyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.finalHtml);
        showToast("Code copié !");
      } catch (e) {
        showToast("Copie impossible — sélectionne manuellement.");
      }
    });

    $("#openPreviewBtn").addEventListener("click", () => {
      const blob = new Blob([state.finalHtml], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
    });

    $("#downloadServerBtn").addEventListener("click", () => {
      downloadFile("vibby-checkout-server.js", SERVER_SNIPPET, "text/javascript");
    });

    $("#projectNameInput").addEventListener("input", (e) => {
      state.projectName = e.target.value;
    });

    $("#saveProjectBtn").addEventListener("click", saveProjectToSupabase);

    $("#toStep3b").addEventListener("click", () => goToStep(3));
    $("#startOverBtn").addEventListener("click", () => {
      if (!confirm("Recommencer depuis le début ? Les changements non enregistrés seront perdus.")) return;
      startNewProject();
    });
  }

  /* ============================================================
     SUPABASE PROJECT PERSISTENCE
     ============================================================ */
  async function saveProjectToSupabase() {
    const btn = $("#saveProjectBtn");
    const auth = window.VibbyAuth;
    if (!auth || !auth.isConfigured()) {
      showToast("Vibby n'est pas connecté à Supabase (voir vibby-config.js).");
      return;
    }
    const user = auth.getUser();
    if (!user) {
      auth.showAuthScreen("login");
      return;
    }

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Enregistrement…';

    const client = auth.getClient();
    const activeProducts = state.products.filter((p) => p.include);
    const row = {
      user_id: user.id,
      name: state.projectName || "Site sans nom",
      html_original: state.rawHtml,
      html_generated: state.finalHtml,
      options: state.options,
      products: activeProducts,
      pub_key: state.pubKey || null,
    };

    try {
      let projectId = state.editingProjectId;
      if (projectId) {
        const { error } = await client.from("projects").update(row).eq("id", projectId);
        if (error) throw error;
      } else {
        const { data, error } = await client.from("projects").insert(row).select("id").single();
        if (error) throw error;
        projectId = data.id;
        state.editingProjectId = projectId;
      }

      // regenerate the final HTML now embedding real tracking config tied to this project id
      const cfg = window.VIBBY_CONFIG || {};
      generateFinalSite({
        supabaseUrl: cfg.SUPABASE_URL || "",
        supabaseAnonKey: cfg.SUPABASE_ANON_KEY || "",
        projectId: projectId,
      });

      const { error: err2 } = await client.from("projects").update({ html_generated: state.finalHtml }).eq("id", projectId);
      if (err2) throw err2;

      btn.innerHTML = "✓ Enregistré";
      showToast("Projet enregistré — le suivi est maintenant actif sur ce site.");
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = original;
      }, 1800);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      showToast("Erreur : " + (err.message || "impossible d'enregistrer."));
    }
  }

  function resetWizardState() {
    state.step = 1;
    state.rawHtml = "";
    state.options = { detect: true, cart: true, stripe: true, analytics: true };
    state.intentText = "";
    state.products = [];
    state.pubKey = "";
    state.finalHtml = "";
    state.editingProjectId = null;
    state.projectName = "";

    const area = $("#pasteArea");
    if (area) {
      area.value = "";
      area.dispatchEvent(new Event("input"));
    }
    const intent = $("#intentText");
    if (intent) intent.value = "";
    const pk = $("#pubKeyInput");
    if (pk) pk.value = "";
    const pn = $("#projectNameInput");
    if (pn) pn.value = "";
    $all(".opt").forEach((opt) => {
      const key = opt.getAttribute("data-opt");
      const input = opt.querySelector("input");
      input.checked = true;
      opt.classList.add("checked");
      state.options[key] = true;
    });
  }

  function startNewProject() {
    resetWizardState();
    goToStep(1);
    if (window.VibbyAuth) window.VibbyAuth.showScreen("screen-wizard");
  }

  function editProject(project) {
    resetWizardState();
    state.editingProjectId = project.id;
    state.projectName = project.name || "";
    state.rawHtml = project.html_original || "";
    state.options = Object.assign({ detect: true, cart: true, stripe: true, analytics: true }, project.options || {});
    state.products = (project.products || []).map((p) => Object.assign({ include: true }, p));
    state.pubKey = project.pub_key || "";

    const area = $("#pasteArea");
    if (area) {
      area.value = state.rawHtml;
      area.dispatchEvent(new Event("input"));
    }
    const pn = $("#projectNameInput");
    if (pn) pn.value = state.projectName;
    const pk = $("#pubKeyInput");
    if (pk) pk.value = state.pubKey;
    $all(".opt").forEach((opt) => {
      const key = opt.getAttribute("data-opt");
      const input = opt.querySelector("input");
      input.checked = !!state.options[key];
      opt.classList.toggle("checked", input.checked);
    });

    if (window.VibbyAuth) window.VibbyAuth.showScreen("screen-wizard");
    goToStep(2);
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }

  /* ---------------- Tier 2 downloadable snippets ---------------- */
  const SERVER_SNIPPET = `// Vibby — serveur de paiement avancé (optionnel)
// Panier unifié multi-produits en UN SEUL paiement Stripe.
// Déploie ceci sur Vercel / Render / Railway. Ta clé secrète Stripe
// reste ici, en variable d'environnement — jamais partagée avec Vibby.
//
// 1) npm install stripe express cors
// 2) Variable d'env: STRIPE_SECRET_KEY=sk_live_...
// 3) Déploie, puis colle l'URL /create-checkout-session dans ton
//    fichier généré: window.__VIBBY_CHECKOUT_ENDPOINT__ = "https://ton-domaine/create-checkout-session"

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(cors());
app.use(express.json());

// Map data-vibby-id -> Stripe Price ID (créés dans ton dashboard Stripe)
const PRICE_MAP = {
  // "vibby-p-1": "price_XXXXXXXXXXXX",
  // "vibby-p-2": "price_YYYYYYYYYYYY",
};

app.post("/create-checkout-session", async (req, res) => {
  try {
    const items = req.body.items || [];
    const line_items = items
      .filter((i) => PRICE_MAP[i.id])
      .map((i) => ({ price: PRICE_MAP[i.id], quantity: i.qty || 1 }));

    if (!line_items.length) {
      return res.status(400).json({ error: "Aucun produit valide (vérifie PRICE_MAP)." });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: req.body.successUrl || "https://ton-site.com/merci",
      cancel_url: req.body.cancelUrl || "https://ton-site.com/",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Vibby checkout server running"));
`;

  /* ---------------- WIZARD ENTRY POINTS (called by router / dashboard) ---------------- */
  function initWizardEntry() {
    const b1 = $("#newProjectBtn");
    const b2 = $("#newProjectBtnEmpty");
    if (b1) b1.addEventListener("click", startNewProject);
    if (b2) b2.addEventListener("click", startNewProject);
  }

  window.VibbyWizard = {
    startNew: startNewProject,
    editProject: editProject,
  };

  /* ---------------- INIT ---------------- */
  document.addEventListener("DOMContentLoaded", () => {
    renderStepper();
    initStep1();
    initStep2();
    initStep3();
    initStep4();
    initWizardEntry();
  });
})();

