(() => {
  function showMessage(message, isError = true) {
    const element = document.getElementById("auth-message");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    element.classList.toggle("is-success", !isError);
  }

  async function readResponse(response, fallbackMessage) {
    const body = await response.text();
    let result;
    try {
      result = body ? JSON.parse(body) : {};
    } catch {
      if (response.status === 403 || /\bforbidden\b/i.test(body)) {
        throw new Error("The server blocked this request. Start the app with open_app.bat and use http://localhost:3000.");
      }
      throw new Error(`The server returned an unexpected response (${response.status}).`);
    }
    if (!response.ok) throw new Error(result.error || fallbackMessage);
    return result;
  }

  function getLocalAccounts() {
    try {
      return JSON.parse(localStorage.getItem("dgi_local_accounts") || "{}");
    } catch {
      return {};
    }
  }

  function saveLocalAccounts(accounts) {
    try {
      localStorage.setItem("dgi_local_accounts", JSON.stringify(accounts));
    } catch {}
  }

  async function submitCredentials(path, username, password) {
    let authUser = username;
    let loggedIn = false;

    // 1. Server login
    if (["http:", "https:"].includes(window.location.protocol)) {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const result = await readResponse(response, "Authentication failed. Invalid username or password.");
      authUser = result.username || username;
      loggedIn = true;
    } else {
      throw new Error("Authentication requires a connection to the server.");
    }

    if (loggedIn) {
      const sessionData = JSON.stringify({
        username: authUser,
        isPrimary: true,
        loginTime: new Date().toISOString()
      });
      sessionStorage.setItem("dgi_admin_session", sessionData);
      localStorage.setItem("dgi_admin_session", sessionData);
      showMessage("Sign in successful. Redirecting...", false);
      setTimeout(() => {
        window.location.replace("index.html");
      }, 150);
    }
  }

  async function createAdminAccount(username, password) {
    if (["http:", "https:"].includes(window.location.protocol)) {
      try {
        const response = await fetch("/api/auth/setup", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const result = await readResponse(response, "Could not create the administrator account.");
        username = result.username || username;
      } catch (err) {
        console.warn("Could not reach setup endpoint, creating account locally:", err);
      }
    }

    const accounts = getLocalAccounts();
    accounts[username.toLowerCase()] = { username, password, isPrimary: true };
    saveLocalAccounts(accounts);

    setupForm.hidden = true;
    modeSwitch.hidden = false;
    loginForm.hidden = false;
    heading.textContent = "Sign In";
    description.textContent = "Your account is ready. Sign in with your credentials.";
    document.getElementById("login-username").value = username;
    document.getElementById("login-password").value = password;
    showMessage("Administrator account created. Please sign in.", false);
    document.getElementById("login-password").focus();
  }

  window.adminAuth = {
    async logout() {
      try {
        if (["http:", "https:"].includes(window.location.protocol)) {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin"
          });
        }
      } catch (error) {
        console.error("Could not invalidate server session.", error);
      }
      sessionStorage.removeItem("dgi_admin_session");
      localStorage.removeItem("dgi_admin_session");
      window.location.replace("login.html");
    }
  };

  const loginForm = document.getElementById("login-form");
  const setupForm = document.getElementById("setup-form");
  if (!loginForm || !setupForm) return;
  const registerForm = document.getElementById("register-form");
  const forgotForm = document.getElementById("forgot-form");
  const resetForm = document.getElementById("reset-form");
  const modeSwitch = document.getElementById("auth-mode-switch");
  const showSigninButton = document.getElementById("show-signin");
  const showRegisterButton = document.getElementById("show-register");

  const heading = document.getElementById("auth-heading");
  const description = document.getElementById("auth-description");
  let resetToken = new URLSearchParams(window.location.search).get("resetToken") || "";

  async function initializeAuthPage() {
    let serverOk = false;
    let authResult = null;

    if (resetToken && ["http:", "https:"].includes(window.location.protocol)) {
      window.history.replaceState(null, "", window.location.pathname);
      loginForm.hidden = true;
      setupForm.hidden = true;
      registerForm.hidden = true;
      forgotForm.hidden = true;
      resetForm.hidden = false;
      modeSwitch.hidden = true;
      heading.textContent = "Reset password";
      description.textContent = "Choose a new password for your library account.";
      document.getElementById("reset-password")?.focus();
      return;
    }

    // Check server auth status if running on web server
    if (["http:", "https:"].includes(window.location.protocol)) {
      try {
        const response = await fetch("/api/auth/status", { credentials: "same-origin" });
        if (response.ok) {
          authResult = await response.json();
          serverOk = true;
        }
      } catch (err) {
        console.warn("Could not reach auth server, running in local/standalone mode:", err);
      }
    }

    if (serverOk && authResult) {
      if (authResult.authenticated) {
        const sessionData = JSON.stringify({ username: authResult.username || "admin", isPrimary: Boolean(authResult.isPrimaryAccount) });
        sessionStorage.setItem("dgi_admin_session", sessionData);
        localStorage.setItem("dgi_admin_session", sessionData);
        window.location.replace("index.html");
        return;
      }
      if (authResult.setupRequired) {
        loginForm.hidden = true;
        setupForm.hidden = false;
        registerForm.hidden = true;
        modeSwitch.hidden = true;
        heading.textContent = "Create Admin Account";
        description.textContent = "Set up the administrator account for this library.";
        return;
      }
    } else {
      // Local check: check if valid session already exists
      try {
        const raw = sessionStorage.getItem("dgi_admin_session") || localStorage.getItem("dgi_admin_session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s && s.username) {
            window.location.replace("index.html");
            return;
          }
        }
      } catch (e) {}
    }

    // Always ensure login form is shown and accessible
    loginForm.hidden = false;
    setupForm.hidden = true;
    registerForm.hidden = true;
    modeSwitch.hidden = false;
    heading.textContent = "Sign In";
    description.textContent = "Enter your username and password to access your library.";

    if (new URLSearchParams(window.location.search).get("passwordChanged") === "1") {
      showMessage("Password updated. Sign in with your new password.", false);
    }
  }

  setupForm.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(setupForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmation = String(formData.get("confirm-password") || "");
    if (!/^[A-Za-z0-9_.@ -]{3,40}$/.test(username)) {
      showMessage("Username must be 3-40 characters using letters, numbers, spaces, dots, underscores, hyphens, or @.");
      document.getElementById("setup-username").focus();
      return;
    }
    if (password.length < 8 || password.length > 128) {
      showMessage("Password must contain 8-128 characters.");
      document.getElementById("setup-password").focus();
      return;
    }
    if (password !== confirmation) {
      showMessage("Passwords do not match. Enter the same password in both password fields.");
      document.getElementById("setup-confirm-password").focus();
      return;
    }
    try {
      await createAdminAccount(username, password);
    } catch (error) {
      showMessage(error.message);
    }
  });

  function showAuthMode(mode) {
    const registering = mode === "register";
    loginForm.hidden = registering;
    registerForm.hidden = !registering;
    showSigninButton.classList.toggle("is-active", !registering);
    showRegisterButton.classList.toggle("is-active", registering);
    heading.textContent = registering ? "Create Account" : "Sign In";
    description.textContent = registering
      ? "Create a new account with its own separate library database."
      : "Enter your username and password to access your library.";
    showMessage("");
  }

  showSigninButton.addEventListener("click", () => showAuthMode("signin"));
  showRegisterButton.addEventListener("click", () => showAuthMode("register"));

  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const field = document.getElementById(button.dataset.passwordToggle);
      if (!field) return;
      const show = field.type === "password";
      field.type = show ? "text" : "password";
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute("aria-label", `${show ? "Hide" : "Show"} password`);
      button.setAttribute("aria-pressed", String(show));
    });
  });

  document.getElementById("show-forgot")?.addEventListener("click", () => {
    loginForm.hidden = true;
    registerForm.hidden = true;
    setupForm.hidden = true;
    resetForm.hidden = true;
    forgotForm.hidden = false;
    modeSwitch.hidden = true;
    heading.textContent = "Forgot password?";
    description.textContent = "Request a secure, one-time reset link.";
    document.getElementById("forgot-username").value = document.getElementById("login-username").value.trim();
    showMessage("");
  });

  document.getElementById("back-to-signin")?.addEventListener("click", () => {
    forgotForm.hidden = true;
    loginForm.hidden = false;
    modeSwitch.hidden = false;
    showSigninButton.classList.add("is-active");
    showRegisterButton.classList.remove("is-active");
    heading.textContent = "Sign In";
    description.textContent = "Enter your administrator credentials to continue.";
    showMessage("");
  });

  forgotForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const username = String(new FormData(forgotForm).get("username") || "").trim();
    try {
      if (["http:", "https:"].includes(window.location.protocol)) {
        const response = await fetch("/api/auth/forgot-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username })
        });
        const result = await readResponse(response, "Could not request a password reset.");
        showMessage(result.message || "If the account exists, a reset link will be sent to the library recovery inbox.", false);
      } else {
        showMessage("Default password for 'admin' is 'admin123'.", false);
      }
    } catch (error) {
      showMessage(error.message);
    }
  });

  resetForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(resetForm);
    const password = String(formData.get("password") || "");
    const confirmation = String(formData.get("confirm-password") || "");
    if (password.length < 8 || password.length > 128) {
      showMessage("Password must contain 8-128 characters.");
      document.getElementById("reset-password").focus();
      return;
    }
    if (password !== confirmation) {
      showMessage("Passwords do not match. Enter the same password in both fields.");
      document.getElementById("reset-confirm-password").focus();
      return;
    }
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password })
      });
      const result = await readResponse(response, "Could not reset the password.");
      resetToken = "";
      resetForm.reset();
      resetForm.hidden = true;
      loginForm.hidden = false;
      modeSwitch.hidden = false;
      heading.textContent = "Sign In";
      description.textContent = "Your password was updated. Sign in with your new password.";
      showMessage(result.message || "Password updated. Sign in with your new password.", false);
      document.getElementById("login-username").focus();
    } catch (error) {
      showMessage(error.message);
    }
  });

  registerForm.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmation = String(formData.get("confirm-password") || "");
    if (!/^[A-Za-z0-9_.@ -]{3,40}$/.test(username)) {
      showMessage("Username must be 3-40 characters using letters, numbers, spaces, dots, underscores, hyphens, or @.");
      document.getElementById("register-username").focus();
      return;
    }
    if (password.length < 8 || password.length > 128) {
      showMessage("Password must contain 8-128 characters.");
      document.getElementById("register-password").focus();
      return;
    }
    if (password !== confirmation) {
      showMessage("Passwords do not match. Enter the same password in both password fields.");
      document.getElementById("register-confirm-password").focus();
      return;
    }
    try {
      await submitCredentials("/api/auth/register", username, password);
    } catch (error) {
      showMessage(error.message);
    }
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    try {
      await submitCredentials(
        "/api/auth/login",
        String(formData.get("username") || "").trim(),
        String(formData.get("password") || "")
      );
    } catch (error) {
      showMessage(error.message);
    }
  });

  initializeAuthPage();
})();
