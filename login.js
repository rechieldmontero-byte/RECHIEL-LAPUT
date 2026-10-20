const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");

if (!loginForm || !loginMessage) {
  console.error("Login form or message element is missing.");
} else {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const submitButton = loginForm.querySelector('button[type="submit"]');

    const email = emailInput?.value.trim() ?? "";
    const password = passwordInput?.value ?? "";

    if (!email || !password) {
      loginMessage.classList.remove("error");
      loginMessage.textContent = "Please enter your email and password.";
      return;
    }

    loginMessage.classList.remove("error");
    loginMessage.textContent = "Signing in…";

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const { error } = await db.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      window.location.href = "dashboard.html";
    } catch (error) {
      loginMessage.textContent = error?.message || "Sign in failed.";
      loginMessage.classList.add("error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}
