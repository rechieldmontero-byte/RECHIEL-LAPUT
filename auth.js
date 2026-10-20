const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("message");

if (registerForm && registerMessage) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    registerMessage.classList.remove("error");

    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const scholarshipProgram = document.getElementById("scholarshipProgram").value;
    const studentId = document.getElementById("studentId").value.trim();
    const button = registerForm.querySelector('button[type="submit"]');

    if (!fullName || !studentId || !email || !scholarshipProgram || !password) {
      registerMessage.textContent = "Please complete all required fields.";
      registerMessage.classList.add("error");
      return;
    }

    if (password.length < 8) {
      registerMessage.textContent = "Password must be at least 8 characters.";
      registerMessage.classList.add("error");
      return;
    }

    button.disabled = true;
    registerMessage.textContent = "Creating account…";

    try {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            student_id: studentId,
            scholarship_program: scholarshipProgram,
          },
        },
      });

      if (error) throw error;

      if (data.session) {
        registerMessage.textContent = "Account created. A staff member must assign your scholarship before you can submit grades.";
        window.setTimeout(() => {
          window.location.href = "index.html";
        }, 1200);
      } else {
        registerMessage.textContent = "Registration successful. Check your email to confirm the account, then sign in.";
      }
    } catch (error) {
      registerMessage.textContent = error.message || "Registration failed.";
      registerMessage.classList.add("error");
    } finally {
      button.disabled = false;
    }
  });
}
