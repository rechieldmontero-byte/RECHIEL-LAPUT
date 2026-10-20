const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const registrationMessage = sessionStorage.getItem("registrationMessage");
if (registrationMessage) {
  loginMessage.textContent = registrationMessage;
  sessionStorage.removeItem("registrationMessage");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.classList.remove("error");
  loginMessage.textContent = "Signing in…";

  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const { error } = await db.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    });
    if (error) throw error;
    window.location.href = "dashboard.html";
  } catch (error) {
    loginMessage.textContent = error.message || "Sign in failed.";
    loginMessage.classList.add("error");
  } finally {
    button.disabled = false;
  }
});
