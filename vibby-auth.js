/* ============================================================
   VIBBY AUTH + ROUTER
   Gère les comptes (courriel/mdp, Google, mot de passe oublié)
   via Supabase Auth, et décide quel écran afficher.
   ============================================================ */
(function () {
  "use strict";

  const cfg = window.VIBBY_CONFIG || {};
  let client = null;
  let currentUser = null;
  let authMode = "login"; // 'login' | 'signup'

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function isConfigured() {
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  function getClient() {
    if (!client && isConfigured() && window.supabase) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
    return client;
  }

  /* ---------------- SCREEN ROUTER ---------------- */
  const SCREENS = ["screen-config", "screen-auth", "screen-projects", "screen-dashboard", "screen-wizard"];

  function showScreen(name) {
    SCREENS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("hidden", id !== name);
    });
    window.scrollTo({ top: 0 });
  }

  /* ---------------- NAV ---------------- */
  function updateNav() {
    const loginBtn = $("#navLoginBtn");
    const userChip = $("#navUserChip");
    const projectsLink = $("#navProjectsLink");
    if (currentUser) {
      loginBtn.classList.add("hidden");
      userChip.classList.remove("hidden");
      projectsLink.classList.remove("hidden");
      const email = currentUser.email || "";
      $("#navEmail").textContent = email.length > 22 ? email.slice(0, 20) + "…" : email;
      $("#navMenuEmail").textContent = email;
      $("#navAvatar").textContent = (email[0] || "?").toUpperCase();
    } else {
      loginBtn.classList.remove("hidden");
      userChip.classList.add("hidden");
      projectsLink.classList.add("hidden");
      $("#navMenu").classList.add("hidden");
    }
  }

  function initNav() {
    $("#navLoginBtn").addEventListener("click", (e) => {
      e.preventDefault();
      showAuthScreen("login");
    });
    $("#navUserChip").addEventListener("click", () => {
      $("#navMenu").classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#navUserChip") && !e.target.closest("#navMenu")) {
        $("#navMenu").classList.add("hidden");
      }
    });
    $("#navProjectsLink").addEventListener("click", (e) => {
      e.preventDefault();
      goToProjects();
    });
    $("#navMenuProjects").addEventListener("click", () => {
      $("#navMenu").classList.add("hidden");
      goToProjects();
    });
    $("#navMenuLogout").addEventListener("click", async () => {
      $("#navMenu").classList.add("hidden");
      await getClient().auth.signOut();
    });
  }

  function goToProjects() {
    showScreen("screen-projects");
    if (window.VibbyDashboard) window.VibbyDashboard.showProjectList();
  }

  /* ---------------- AUTH SCREEN UI ---------------- */
  function setAuthMsg(text, type) {
    const el = $("#authMsg");
    if (!text) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div class="auth-msg ${type === "err" ? "err" : "ok"}">${text}</div>`;
  }

  function clearFieldErrors() {
    $all(".field-err").forEach((e) => (e.textContent = ""));
  }

  function showAuthScreen(mode) {
    authMode = mode || "login";
    setAuthMsg("");
    clearFieldErrors();
    $("#authFormWrap").classList.remove("hidden");
    $("#forgotFormWrap").classList.add("hidden");
    $("#resetFormWrap").classList.add("hidden");
    renderAuthMode();
    showScreen("screen-auth");
  }

  function renderAuthMode() {
    $all(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.authtab === authMode));
    if (authMode === "login") {
      $("#authTitle").textContent = "Content de te revoir";
      $("#authSub").textContent = "Connecte-toi pour retrouver tes sites";
      $("#authSubmitBtn").textContent = "Se connecter";
      $("#authPassword").setAttribute("autocomplete", "current-password");
      $("#authSwitchLine").innerHTML = 'Pas encore de compte ? <a href="#" id="switchToSignup">Crée-en un</a>';
    } else {
      $("#authTitle").textContent = "Crée ton compte";
      $("#authSub").textContent = "Gratuit — commence à vendre en quelques minutes";
      $("#authSubmitBtn").textContent = "Créer mon compte";
      $("#authPassword").setAttribute("autocomplete", "new-password");
      $("#authSwitchLine").innerHTML = 'Déjà un compte ? <a href="#" id="switchToLogin">Se connecter</a>';
    }
    const s1 = $("#switchToSignup");
    if (s1) s1.addEventListener("click", (e) => { e.preventDefault(); showAuthScreen("signup"); });
    const s2 = $("#switchToLogin");
    if (s2) s2.addEventListener("click", (e) => { e.preventDefault(); showAuthScreen("login"); });
  }

  function initAuthForms() {
    $all(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => showAuthScreen(tab.dataset.authtab));
    });

    $("#googleBtn").addEventListener("click", async () => {
      if (!cfg.GOOGLE_ENABLED) {
        setAuthMsg("La connexion Google n'est pas activée sur cette instance de Vibby.", "err");
        return;
      }
      setAuthMsg("");
      const { error } = await getClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) setAuthMsg(error.message, "err");
    });

    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFieldErrors();
      setAuthMsg("");
      const email = $("#authEmail").value.trim();
      const password = $("#authPassword").value;
      const btn = $("#authSubmitBtn");
      const original = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';

      try {
        if (authMode === "login") {
          const { error } = await getClient().auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          if (password.length < 6) {
            $("#authPassword").nextElementSibling.textContent = "6 caractères minimum.";
            throw new Error("__silent__");
          }
          const { error, data } = await getClient().auth.signUp({ email, password });
          if (error) throw error;
          if (data && data.user && !data.session) {
            setAuthMsg("Compte créé ! Vérifie ta boîte courriel pour confirmer ton adresse avant de te connecter.", "ok");
            btn.disabled = false;
            btn.textContent = original;
            return;
          }
        }
      } catch (err) {
        if (err.message !== "__silent__") setAuthMsg(translateAuthError(err.message), "err");
        btn.disabled = false;
        btn.textContent = original;
      }
    });

    $("#forgotLink").addEventListener("click", (e) => {
      e.preventDefault();
      setAuthMsg("");
      clearFieldErrors();
      $("#authFormWrap").classList.add("hidden");
      $("#forgotFormWrap").classList.remove("hidden");
    });
    $("#backToLogin").addEventListener("click", (e) => {
      e.preventDefault();
      showAuthScreen("login");
    });

    $("#forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#forgotEmail").value.trim();
      const btn = $("#forgotSubmitBtn");
      btn.disabled = true;
      const { error } = await getClient().auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      btn.disabled = false;
      if (error) {
        $("#forgotEmail").nextElementSibling.textContent = error.message;
        return;
      }
      $("#forgotFormWrap").innerHTML =
        '<div class="auth-title">Courriel envoyé ✓</div><div class="auth-sub">Si un compte existe pour cette adresse, un lien de réinitialisation vient d\'être envoyé. Vérifie aussi tes courriels indésirables.</div><div class="auth-switch" style="margin-top:20px;"><a href="#" id="backToLogin2">← Retour à la connexion</a></div>';
      $("#backToLogin2").addEventListener("click", (e2) => {
        e2.preventDefault();
        showAuthScreen("login");
      });
    });

    $("#resetForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = $("#resetPassword").value;
      const btn = $("#resetSubmitBtn");
      btn.disabled = true;
      const { error } = await getClient().auth.updateUser({ password: pw });
      btn.disabled = false;
      if (error) {
        $("#resetPassword").nextElementSibling.textContent = error.message;
        return;
      }
      $("#resetFormWrap").innerHTML =
        '<div class="auth-title">Mot de passe mis à jour ✓</div><div class="auth-sub">Tu peux continuer.</div>';
      setTimeout(() => goToProjects(), 900);
    });
  }

  function translateAuthError(msg) {
    if (!msg) return "Une erreur est survenue.";
    const m = msg.toLowerCase();
    if (m.includes("invalid login credentials")) return "Courriel ou mot de passe incorrect.";
    if (m.includes("user already registered")) return "Un compte existe déjà avec ce courriel — essaie de te connecter.";
    if (m.includes("password should be at least")) return "Mot de passe trop court (6 caractères minimum).";
    if (m.includes("email not confirmed")) return "Confirme d'abord ton adresse courriel (lien envoyé à l'inscription).";
    return msg;
  }

  function showResetPasswordForm() {
    $("#authFormWrap").classList.add("hidden");
    $("#forgotFormWrap").classList.add("hidden");
    $("#resetFormWrap").classList.remove("hidden");
    showScreen("screen-auth");
  }

  /* ---------------- SESSION / ROUTING ---------------- */
  function handleAuthedRoute() {
    // default landing after login: project list
    goToProjects();
  }

  async function init() {
    initNav();

    if (!isConfigured()) {
      showScreen("screen-config");
      return;
    }

    initAuthForms();

    const supa = getClient();

    supa.auth.onAuthStateChange((event, session) => {
      currentUser = session ? session.user : null;
      updateNav();
      if (event === "PASSWORD_RECOVERY") {
        showResetPasswordForm();
        return;
      }
      if (event === "SIGNED_IN" && !document.getElementById("screen-wizard").classList.contains("hidden")) {
        // don't yank the user out of the wizard on token refresh etc.
        return;
      }
      if (currentUser && (document.getElementById("screen-auth") && !document.getElementById("screen-auth").classList.contains("hidden"))) {
        handleAuthedRoute();
      }
      if (!currentUser) {
        showAuthScreen("login");
      }
    });

    const { data } = await supa.auth.getSession();
    currentUser = data && data.session ? data.session.user : null;
    updateNav();

    if (currentUser) {
      handleAuthedRoute();
    } else {
      showAuthScreen("login");
    }
  }

  window.VibbyAuth = {
    getClient,
    getUser: () => currentUser,
    isConfigured,
    showScreen,
    showAuthScreen,
    goToProjects,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
