const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("message");

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerMessage.classList.remove("error");

  const fullName = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const button = registerForm.querySelector('button[type="submit"]');

  if (fullName.length < 2) {
    registerMessage.textContent = "Please enter your full name.";
    registerMessage.classList.add("error");
    return;
  }

  button.disabled = true;
  registerMessage.textContent = "Creating account…";
  try {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;

    if (data.session) {
      registerMessage.textContent =
        "Account created. A staff member must assign your scholarship before you can submit grades.";
      window.setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 1200);
    } else {
      registerMessage.textContent =
        "Registration successful. Check your email to confirm the account, then sign in. A staff member must assign your scholarship.";
    }
  } catch (error) {
    registerMessage.textContent = error.message || "Registration failed.";
    registerMessage.classList.add("error");
  } finally {
    button.disabled = false;
  }
});
