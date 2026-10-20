const $ = (id) => document.getElementById(id);
let currentUser = null;
let currentProfile = null;
let submissions = [];
let scholars = [];
let editingScholarEmail = null;
let selectedScholarForSubmission = null;
let editingSubmissionId = null;
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const isStaff = () => currentProfile?.role === "Scholarship Staff";
const showNotice = (text, error = false) => {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
};
const statusTag = (value) => `<span class="tag">${escapeHTML(value || "—")}</span>`;

async function startDashboard() {
  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (!data.session?.user) {
      if ($("authView")) {
        $("authView").hidden = false;
        $("appView").hidden = true;
      } else {
        window.location.href = "index.html";
      }
      return;
    }
    currentUser = data.session.user;

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id,full_name,role,is_active")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.is_active) {
      showNotice("No active profile is linked to this account. Ask staff to assign your account.", true);
      await db.auth.signOut();
      return;
    }
    currentProfile = profile;
    if ($("authView")) $("authView").hidden = true;
    if ($("appView")) $("appView").hidden = false;
    $("submitPanel").hidden = isStaff();
    $("recordsPanel").hidden = !isStaff();
    $("scholarsPanel").hidden = true;
    $("auditPanel").hidden = true;
    if (!isStaff()) {
      $("showAudit").hidden = true;
      $("showScholars").hidden = true;
      $("recordsPanel").querySelector("h2").textContent = "My Submissions";
    } else {
      $("submitPanel").hidden = true;
      $("showAcademicSummary").hidden = true;
      $("showSubmit").hidden = true;
      $("showAddSummary").hidden = false;
      $("showScholars").hidden = false;
    }
    await loadPrograms();
    if (isStaff()) {
      await loadScholars();
    }
    await loadSubmissions();
    if (isStaff()) await loadAudit();
  } catch (error) {
    showNotice(error.message || "Could not load your account.", true);
  }
}

async function loadPrograms() {
  try {
    if (isStaff()) {
      const { data, error } = await db
        .from("scholarship_programs")
        .select("id,program_name")
        .order("program_name");
      if (error) throw error;
      setProgramOptions($("scholarProgram"), data || []);
      return;
    }

    const { data: assignments, error: assignmentError } = await db
      .from("scholar_assignments")
      .select("id,scholarship_programs!inner(program_name)")
      .eq("scholar_id", currentUser.id)
      .eq("is_active", true);
    if (assignmentError) throw assignmentError;
    const activeAssignments = assignments || [];
    $("program").innerHTML = '<option value="">Select your assigned program</option>' + activeAssignments.map((assignment) =>
      `<option value="${escapeHTML(assignment.id)}">${escapeHTML(assignment.scholarship_programs?.program_name || "Scholarship program")}</option>`
    ).join("");
    if (!activeAssignments.length) {
      showNotice("Wala pay active scholarship assignment sa imong account. Palihog kontaka ang Scholarship Staff aron ma-assign ka una sa pag-submit.", true);
      $("submissionForm").querySelector('button[type="submit"]').disabled = true;
    } else {
      $("submissionForm").querySelector('button[type="submit"]').disabled = false;
    }
  } catch (error) {
    showNotice(`Dili ma-load ang scholarship program: ${error.message}`, true);
    if (!isStaff()) $("submissionForm").querySelector('button[type="submit"]').disabled = true;
  }
}

function setProgramOptions(select, programs) {
  select.innerHTML = '<option value="">Select a program</option>' + programs.map((program) =>
    `<option value="${escapeHTML(program.program_name)}">${escapeHTML(program.program_name)}</option>`
  ).join("");
}

async function loadScholars() {
  if (!isStaff()) return;
  $("scholarsBody").innerHTML = '<tr><td colspan="6">Loading scholars...</td></tr>';
  const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }] = await Promise.all([
    db.from("profiles")
      .select("id,student_id,full_name,email,is_active")
      .eq("role", "Scholar")
      .order("full_name"),
    db.from("scholar_assignments")
      .select("scholar_id,is_active,scholarship_programs!scholar_assignments_program_id_fkey(program_name)")
      .eq("is_active", true),
  ]);
  if (profileError || assignmentError) {
    const error = profileError || assignmentError;
    $("scholarsBody").innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
    showNotice(`Could not load scholars: ${error.message}`, true);
    return;
  }
  const activePrograms = new Map((assignments || []).map((assignment) => [
    assignment.scholar_id,
    assignment.scholarship_programs?.program_name || "",
  ]));
  scholars = (profiles || []).map((scholar) => ({
    ...scholar,
    program: activePrograms.get(scholar.id) || "",
  }));
  renderScholars();
}

function renderScholars() {
  if (!scholars.length) {
    $("scholarsBody").innerHTML = '<tr><td colspan="6">No scholars found. Add a scholar account to get started.</td></tr>';
    return;
  }
  $("scholarsBody").innerHTML = scholars.map((scholar) => `<tr>
    <td>${escapeHTML(scholar.student_id || "—")}</td>
    <td>${escapeHTML(scholar.full_name || "—")}</td>
    <td>${escapeHTML(scholar.email || "—")}</td>
    <td>${escapeHTML(scholar.program || "Not assigned")}</td>
    <td>${scholar.is_active ? "Active" : "Inactive"}</td>
    <td><button class="small-button" type="button" data-edit-scholar="${escapeHTML(scholar.id)}">Edit</button></td>
  </tr>`).join("");
}

function resetScholarForm() {
  editingScholarEmail = null;
  $("scholarForm").reset();
  $("scholarDialog").close();
  $("scholarEmail").readOnly = false;
  $("scholarFormHeading").textContent = "Add scholar";
  $("saveScholarBtn").textContent = "Add Scholar";
  $("scholarFormHint").textContent = "Register the scholar account first using this email, then add the student details and assign a program here. This form does not set passwords.";
  $("scholarFormMessage").textContent = "";
  $("scholarFormMessage").classList.remove("error");
}

function editScholar(id) {
  const scholar = scholars.find((item) => item.id === id);
  if (!scholar || !isStaff()) return;
  $("scholarForm").reset();
  editingScholarEmail = scholar.email;
  $("studentId").value = scholar.student_id || "";
  $("fullName").value = scholar.full_name || "";
  $("scholarEmail").value = scholar.email || "";
  $("scholarEmail").readOnly = true;
  $("scholarProgram").value = scholar.program;
  $("scholarFormHeading").textContent = `Edit scholar: ${scholar.full_name}`;
  $("saveScholarBtn").textContent = "Save Changes";
  $("scholarFormHint").textContent = "Update the student ID, full name, or program. The account email is fixed for this edit.";
  $("scholarFormMessage").textContent = "";
  $("scholarFormMessage").classList.remove("error");
  $("scholarDialog").showModal();
  $("studentId").focus();
}

async function saveScholar(event) {
  event.preventDefault();
  if (!isStaff()) return;
  const studentId = $("studentId").value.trim();
  const fullName = $("fullName").value.trim();
  const email = $("scholarEmail").value.trim();
  const programName = $("scholarProgram").value;
  if (!studentId || !fullName || !email || !programName) {
    showNotice("Complete all scholar details before saving.", true);
    return;
  }
  const button = $("saveScholarBtn");
  button.disabled = true;
  showNotice(editingScholarEmail ? "Saving scholar changes..." : "Adding scholar and assigning program...");
  try {
    const { error } = await db.rpc("staff_register_scholar", {
      p_student_id: studentId,
      p_full_name: fullName,
      p_email: email,
      p_program_name: programName,
    });
    if (error) {
      if (error.code === "PGRST202" || /staff_register_scholar/i.test(error.message)) {
        throw new Error("Wala pa ma-install ang scholar management function. Padagana ang pinakabag-ong supabase/schema.sql sa Supabase SQL Editor.");
      }
      if (error.code === "23505") {
        throw new Error("Gigamit na ang Student ID. Pagsulod og lahi nga Student ID.");
      }
      if (/Create the scholar Auth account first/i.test(error.message)) {
        throw new Error("Wala pa ang account niini nga email sa Supabase Auth. Pa-registera una ang scholar, o paghimo og account sa Supabase Authentication, unya sulayi pag-usab.");
      }
      throw error;
    }
    showNotice(editingScholarEmail ? "Scholar details updated and program assigned." : "Scholar added and program assigned.");
    resetScholarForm();
    await loadScholars();
    await loadSubmissions();
    await loadAudit();
  } catch (error) {
    $("scholarFormMessage").textContent = error.message;
    $("scholarFormMessage").classList.add("error");
    showNotice(`Could not save scholar: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function submitAcademicSummary(event) {
  event.preventDefault();
  if (!currentUser || isStaff()) return;
  const submitButton = $("submissionForm").querySelector('button[type="submit"]');
  if (submitButton.disabled) return;

  const values = {
    gwa: Number($("gwa").value),
    units: Number($("units").value),
    failed: Number($("failed").value),
    incomplete: Number($("incomplete").value),
    dropped: Number($("dropped").value),
  };
  if (!Number.isFinite(values.gwa) || values.gwa < 1 || values.gwa > 5 ||
      !Number.isInteger(values.units) || values.units < 0 ||
      !Number.isInteger(values.failed) || values.failed < 0 ||
      !Number.isInteger(values.incomplete) || values.incomplete < 0 ||
      !Number.isInteger(values.dropped) || values.dropped < 0) {
    showNotice("Check the GWA, enrolled units, and subject counts.", true);
    return;
  }

  submitButton.disabled = true;
  showNotice("Submitting academic summary...");
  try {
    const { error } = await db.rpc("scholar_submit_academic_summary", {
      p_assignment_id: $("program").value,
      p_academic_year: $("schoolYear").value.trim(),
      p_semester: $("semester").value,
      p_gwa: values.gwa,
      p_enrolled_units: values.units,
      p_failed_count: values.failed,
      p_incomplete_count: values.incomplete,
      p_dropped_count: values.dropped,
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("Naa nay submission para sa school year ug semester nga imong gipili.");
      }
      if (error.code === "42501" || /row-level security|policy/i.test(error.message)) {
        throw new Error("Gidumilian sa database ang submission. Siguroha nga naa kay active assignment ug gipadagan ang pinakabag-ong supabase/schema.sql.");
      }
      if (error.code === "PGRST202" || /function .*scholar_submit_academic_summary/i.test(error.message)) {
        throw new Error("Wala pa ma-install ang submission function. Padagana ang pinakabag-ong supabase/schema.sql sa Supabase SQL Editor.");
      }
      throw error;
    }
    $("submissionForm").reset();
    showNotice("Academic summary submitted. It is pending verification.");
    await loadSubmissions();
  } catch (error) {
    showNotice(`Submission failed: ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
  }
}

async function loadSubmissions() {
  const { data, error } = await db.from("semester_submissions").select(`
    id,assignment_id,academic_year,semester,gwa,enrolled_units,failed_count,
    incomplete_count,dropped_count,submitted_at,verification,
    verification_reason,compliance,compliance_reasons,renewal,decision_note,
    scholar_assignments!semester_submissions_assignment_id_fkey(
      scholar_id,profiles!scholar_assignments_scholar_id_fkey(full_name,student_id),
      scholarship_programs!scholar_assignments_program_id_fkey(program_name)
    )
  `).order("submitted_at", { ascending: false });

  if (error) {
    showNotice(`Could not load submissions: ${error.message}`, true);
    $("recordsBody").innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  submissions = data || [];
  renderSubmissions();
}

function renderSubmissions() {
  const term = $("searchInput").value.trim().toLowerCase();
  const submissionsByScholar = new Map();
  submissions.forEach((record) => {
    const scholarId = record.scholar_assignments?.scholar_id;
    if (scholarId) submissionsByScholar.set(scholarId, (submissionsByScholar.get(scholarId) || 0) + 1);
  });
  const rosterRows = isStaff() ? scholars.map((scholar) => ({
      id: `roster-${scholar.id}`,
      isRosterOnly: true,
      priorSubmissionCount: submissionsByScholar.get(scholar.id) || 0,
      scholar_assignments: {
        scholar_id: scholar.id,
        profiles: { full_name: scholar.full_name, student_id: scholar.student_id },
        scholarship_programs: { program_name: scholar.program },
      },
    })) : [];
  const filtered = [...submissions, ...rosterRows].filter((record) => {
    const assignment = record.scholar_assignments || {};
    const text = [
      assignment.profiles?.full_name,
      assignment.profiles?.student_id,
      assignment.scholarship_programs?.program_name,
      record.verification, record.compliance, record.renewal,
      record.academic_year, record.semester,
    ].join(" ").toLowerCase();
    return text.includes(term);
  });

  if (!filtered.length) {
    $("recordsBody").innerHTML = '<tr><td colspan="6">No submissions found.</td></tr>';
    return;
  }
  $("recordsBody").innerHTML = filtered.map((record) => {
    const assignment = record.scholar_assignments || {};
    if (record.isRosterOnly) {
      return `<tr>
        <td><strong>${escapeHTML(assignment.profiles?.full_name || "Scholar")}</strong><br>
          ${escapeHTML(assignment.scholarship_programs?.program_name || "Not assigned")}<br>
          <small>${escapeHTML(assignment.profiles?.student_id || "")}</small></td>
        <td>${record.priorSubmissionCount ? `${record.priorSubmissionCount} previous submission(s)` : "No submission yet"}</td>
        <td>—</td><td>—</td><td>—</td><td>—</td>
      </tr>`;
    }
    const reasons = (record.compliance_reasons || []).map(escapeHTML).join("; ");
    const actions = isStaff() ? `
      <button class="small-button" data-action="approve" data-id="${escapeHTML(record.id)}"
        ${record.renewal === "Approved" ? "disabled" : ""}>Approve</button>
      <button class="small-button secondary" data-action="edit" data-id="${escapeHTML(record.id)}">Edit</button>` : "—";
    return `<tr>
      <td><strong>${escapeHTML(assignment.profiles?.full_name || "Scholar")}</strong><br>
        ${escapeHTML(assignment.scholarship_programs?.program_name || "")}<br>
        <small>${escapeHTML(record.semester)} · ${escapeHTML(record.academic_year)}</small></td>
      <td>GWA: ${escapeHTML(record.gwa)}<br>Units: ${escapeHTML(record.enrolled_units)}<br>
        Failed: ${escapeHTML(record.failed_count)} · Incomplete: ${escapeHTML(record.incomplete_count)} · Dropped: ${escapeHTML(record.dropped_count)}</td>
      <td>${statusTag(record.verification)}<br><small>${escapeHTML(record.verification_reason)}</small></td>
      <td>${statusTag(record.compliance)}<br><small>${reasons}</small></td>
      <td>${statusTag(record.renewal)}<br><small>${escapeHTML(record.decision_note)}</small></td>
      <td>${actions}</td></tr>`;
  }).join("");
}

async function staffAction(action, id) {
  const record = submissions.find((item) => item.id === id);
  if (!record || !isStaff()) return;
  if (action === "edit") {
    editingSubmissionId = id;
    selectedScholarForSubmission = {
      id: record.scholar_assignments?.scholar_id,
      full_name: record.scholar_assignments?.profiles?.full_name || "Scholar",
      student_id: record.scholar_assignments?.profiles?.student_id || "",
      program: record.scholar_assignments?.scholarship_programs?.program_name || "",
    };
    populateStaffScholarSelect(selectedScholarForSubmission.id);
    $("staffSubmissionForm").reset();
    $("staffScholarSelect").value = selectedScholarForSubmission.id;
    $("staffSubmissionHeading").textContent = "Edit Academic Summary";
    $("staffSchoolYear").value = record.academic_year;
    $("staffSemester").value = record.semester;
    $("staffGwa").value = record.gwa;
    $("staffUnits").value = record.enrolled_units;
    $("staffFailed").value = record.failed_count;
    $("staffIncomplete").value = record.incomplete_count;
    $("staffDropped").value = record.dropped_count;
    $("saveStaffSubmission").textContent = "Save Changes";
    $("staffSubmissionMessage").textContent = "";
    $("staffSubmissionMessage").classList.remove("error");
    $("staffSubmissionDialog").showModal();
    return;
  }

  if (action !== "approve") return;
  if (!window.confirm(`Approve the academic summary for ${record.scholar_assignments?.profiles?.full_name || "this scholar"} (${record.academic_year}, ${record.semester})?`)) return;
  try {
    const { error } = await db.rpc("staff_approve_submission", { p_submission_id: id });
    if (error) {
      if (error.code === "PGRST202" || /staff_approve_submission/i.test(error.message)) {
        throw new Error("Wala pa ma-install ang approval function. Padagana ang pinakabag-ong supabase/schema.sql.");
      }
      throw error;
    }
    showNotice("Academic summary approved.");
    await loadSubmissions();
    await loadAudit();
  } catch (error) {
    showNotice(`Dili ma-approve ang academic summary: ${error.message}`, true);
  }
}

function populateStaffScholarSelect(selectedId = "") {
  $("staffScholarSelect").innerHTML = '<option value="">Select a scholar</option>' + scholars.map((scholar) =>
    `<option value="${escapeHTML(scholar.id)}" ${!scholar.is_active || !scholar.program ? "disabled" : ""}>${escapeHTML(`${scholar.full_name} · ${scholar.student_id} · ${scholar.program || "No active program"}${!scholar.is_active ? " · Inactive" : ""}`)}</option>`
  ).join("");
  $("staffScholarSelect").value = selectedId;
}

function staffSubmissionValues() {
  return {
    academicYear: $("staffSchoolYear").value.trim(),
    semester: $("staffSemester").value,
    gwa: Number($("staffGwa").value),
    units: Number($("staffUnits").value),
    failed: Number($("staffFailed").value),
    incomplete: Number($("staffIncomplete").value),
    dropped: Number($("staffDropped").value),
  };
}

async function saveStaffSubmission(event) {
  event.preventDefault();
  if (!isStaff() || !selectedScholarForSubmission) return;
  const values = staffSubmissionValues();
  if (!Number.isInteger(values.units) || !Number.isInteger(values.failed) ||
      !Number.isInteger(values.incomplete) || !Number.isInteger(values.dropped)) {
    $("staffSubmissionMessage").textContent = "Units and subject counts must be whole numbers.";
    $("staffSubmissionMessage").classList.add("error");
    return;
  }
  const saveButton = $("saveStaffSubmission");
  saveButton.disabled = true;
  $("staffSubmissionMessage").textContent = editingSubmissionId ? "Saving changes..." : "Saving academic summary...";
  $("staffSubmissionMessage").classList.remove("error");
  const rpcName = editingSubmissionId ? "staff_edit_academic_summary" : "staff_submit_academic_summary";
  const params = editingSubmissionId
    ? {
        p_submission_id: editingSubmissionId,
        p_academic_year: values.academicYear,
        p_semester: values.semester,
        p_gwa: values.gwa,
        p_enrolled_units: values.units,
        p_failed_count: values.failed,
        p_incomplete_count: values.incomplete,
        p_dropped_count: values.dropped,
      }
    : {
        p_scholar_id: selectedScholarForSubmission.id,
        p_academic_year: values.academicYear,
        p_semester: values.semester,
        p_gwa: values.gwa,
        p_enrolled_units: values.units,
        p_failed_count: values.failed,
        p_incomplete_count: values.incomplete,
        p_dropped_count: values.dropped,
      };
  try {
    const { error } = await db.rpc(rpcName, params);
    if (error) {
      if (error.code === "23505") throw new Error("Naa na ang summary para ani nga scholar, school year, ug semester.");
      if (error.code === "PGRST202" || new RegExp(rpcName, "i").test(error.message)) {
        throw new Error("Wala pa ma-install ang submission function. Padagana ang pinakabag-ong supabase/schema.sql.");
      }
      throw error;
    }
    $("staffSubmissionDialog").close();
    showNotice(editingSubmissionId ? "Academic summary updated. Review statuses reset; please approve it again." : `Academic summary para kang ${selectedScholarForSubmission.full_name} na-save na.`);
    editingSubmissionId = null;
    selectedScholarForSubmission = null;
    $("staffSubmissionHeading").textContent = "Add Academic Summary";
    $("saveStaffSubmission").textContent = "Save Summary";
    await loadSubmissions();
    await loadAudit();
  } catch (error) {
    $("staffSubmissionMessage").textContent = error.message;
    $("staffSubmissionMessage").classList.add("error");
  } finally {
    saveButton.disabled = false;
  }
}

async function loadAudit() {
  if (!isStaff()) return;
  const { data, error } = await db.from("audit_logs")
    .select("id,actor_id,action,module,record_id,description,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    $("auditBody").innerHTML = `<tr><td colspan="4">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  $("auditBody").innerHTML = (data || []).map((log) => `
    <tr><td>${escapeHTML(new Date(log.created_at).toLocaleString())}</td>
    <td>${escapeHTML(log.actor_id || "System")}</td><td>${escapeHTML(log.action)}</td>
    <td>${escapeHTML(`${log.module}: ${log.description}`)}</td></tr>
  `).join("") || '<tr><td colspan="4">No audit records yet.</td></tr>';
}

$("submissionForm").addEventListener("submit", submitAcademicSummary);
$("searchInput").addEventListener("input", renderSubmissions);
$("showSubmit").addEventListener("click", () => {
  $("submitPanel").hidden = false; $("recordsPanel").hidden = true; $("scholarsPanel").hidden = true; $("auditPanel").hidden = true;
});
$("showAcademicSummary").addEventListener("click", () => {
  $("submitPanel").hidden = false; $("recordsPanel").hidden = true; $("scholarsPanel").hidden = true; $("auditPanel").hidden = true;
});
$("showRecords").addEventListener("click", () => {
  $("submitPanel").hidden = true; $("recordsPanel").hidden = false; $("scholarsPanel").hidden = true; $("auditPanel").hidden = true;
});
$("showAudit").addEventListener("click", () => {
  if (!isStaff()) return;
  $("submitPanel").hidden = true; $("recordsPanel").hidden = true; $("scholarsPanel").hidden = true; $("auditPanel").hidden = false;
});
$("showScholars").addEventListener("click", () => {
  if (!isStaff()) return;
  $("submitPanel").hidden = true; $("recordsPanel").hidden = true; $("scholarsPanel").hidden = false; $("auditPanel").hidden = true;
  loadScholars();
});
$("scholarForm").addEventListener("submit", saveScholar);
$("newScholarBtn").addEventListener("click", () => {
  resetScholarForm();
  showNotice("Complete the scholar details in the form, then click Add Scholar.");
  $("scholarDialog").showModal();
  $("studentId").focus();
});
$("cancelScholarEdit").addEventListener("click", resetScholarForm);
$("scholarsBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-edit-scholar]");
  if (button) editScholar(button.dataset.editScholar);
});
$("recordsBody").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) staffAction(button.dataset.action, button.dataset.id);
});
$("showAddSummary").addEventListener("click", () => {
  if (!isStaff()) return;
  const availableScholars = scholars.filter((scholar) => scholar.is_active && scholar.program);
  if (!availableScholars.length) {
    showNotice("Walay active scholar nga naay assigned program. I-assign una ang scholarship program.", true);
    return;
  }
  $("submitPanel").hidden = true;
  $("recordsPanel").hidden = false;
  $("scholarsPanel").hidden = true;
  $("auditPanel").hidden = true;
  editingSubmissionId = null;
  selectedScholarForSubmission = null;
  populateStaffScholarSelect();
  $("staffSubmissionHeading").textContent = "Add Academic Summary";
  $("saveStaffSubmission").textContent = "Save Summary";
  $("staffSubmissionForm").reset();
  $("staffScholarSelect").value = "";
  $("staffSubmissionMessage").textContent = "";
  $("staffSubmissionMessage").classList.remove("error");
  $("staffSubmissionDialog").showModal();
});
$("staffScholarSelect").addEventListener("change", () => {
  selectedScholarForSubmission = scholars.find((scholar) => scholar.id === $("staffScholarSelect").value) || null;
});
$("cancelStaffSubmission").addEventListener("click", () => {
  $("staffSubmissionDialog").close();
  editingSubmissionId = null;
  selectedScholarForSubmission = null;
  $("staffScholarSelect").value = "";
  $("staffSubmissionHeading").textContent = "Add Academic Summary";
  $("saveStaffSubmission").textContent = "Save Summary";
});
$("staffSubmissionForm").addEventListener("submit", saveStaffSubmission);
$("logoutBtn").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();
  if (error) showNotice(error.message, true);
  else window.location.href = "index.html";
});

startDashboard();
