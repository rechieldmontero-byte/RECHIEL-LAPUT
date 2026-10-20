const $ = (id) => document.getElementById(id);
let currentUser = null;
let currentProfile = null;
let submissions = [];

const demoSubmissions = [
  {
    id: "demo-1",
    academic_year: "2026-2027",
    semester: "Semester 1",
    gwa: 1.75,
    enrolled_units: 18,
    failed_count: 0,
    incomplete_count: 0,
    dropped_count: 0,
    evidence_reference: "https://example.com/grades/angel-1.pdf",
    submitted_at: "2026-09-15T09:30:00Z",
    verification: "Verified",
    verification_reason: "Complete and valid academic record.",
    compliance: "Compliant",
    compliance_reasons: ["Met GPA requirement", "No failed subjects"],
    renewal: "Eligible",
    decision_note: "Approved for renewal.",
    scholar_assignments: {
      profiles: { full_name: "Angel Grace R. Dela Cruz" },
      scholarship_programs: { program_name: "Academic Excellence Grant" },
    },
  },
  {
    id: "demo-2",
    academic_year: "2026-2027",
    semester: "Semester 2",
    gwa: 2.15,
    enrolled_units: 17,
    failed_count: 1,
    incomplete_count: 0,
    dropped_count: 1,
    evidence_reference: "https://example.com/grades/joel-2.pdf",
    submitted_at: "2026-10-02T08:15:00Z",
    verification: "Pending",
    verification_reason: "Awaiting review.",
    compliance: "Needs Review",
    compliance_reasons: ["Dropped subject requires explanation"],
    renewal: "Pending",
    decision_note: "Waiting for final evaluation.",
    scholar_assignments: {
      profiles: { full_name: "Joel M. Santos" },
      scholarship_programs: { program_name: "STEM Scholarship" },
    },
  },
  {
    id: "demo-3",
    academic_year: "2025-2026",
    semester: "Semester 1",
    gwa: 3.05,
    enrolled_units: 15,
    failed_count: 2,
    incomplete_count: 1,
    dropped_count: 0,
    evidence_reference: "https://example.com/grades/maria-3.pdf",
    submitted_at: "2026-01-12T14:00:00Z",
    verification: "Returned",
    verification_reason: "Incomplete supporting documents.",
    compliance: "Non-Compliant",
    compliance_reasons: ["GWA below threshold", "Missing proof of incomplete subject"],
    renewal: "Not Eligible",
    decision_note: "Please resubmit with required supporting evidence.",
    scholar_assignments: {
      profiles: { full_name: "Maria Isabel C. Gomez" },
      scholarship_programs: { program_name: "Community Leadership Award" },
    },
  },
  {
    id: "demo-4",
    academic_year: "2026-2027",
    semester: "Summer",
    gwa: 1.9,
    enrolled_units: 9,
    failed_count: 0,
    incomplete_count: 0,
    dropped_count: 0,
    evidence_reference: "https://example.com/grades/renz-4.pdf",
    submitted_at: "2026-08-09T12:40:00Z",
    verification: "Verified",
    verification_reason: "Grades match official transcript.",
    compliance: "Compliant",
    compliance_reasons: ["Passed all courses", "Within unit limit"],
    renewal: "Eligible",
    decision_note: "Eligible for next semester grant.",
    scholar_assignments: {
      profiles: { full_name: "Renz Adrian T. Flores" },
      scholarship_programs: { program_name: "Merit Scholarship" },
    },
  },
  {
    id: "demo-5",
    academic_year: "2026-2027",
    semester: "Semester 2",
    gwa: 2.65,
    enrolled_units: 16,
    failed_count: 1,
    incomplete_count: 0,
    dropped_count: 0,
    evidence_reference: "https://example.com/grades/paul-5.pdf",
    submitted_at: "2026-10-14T10:05:00Z",
    verification: "Pending",
    verification_reason: "Under staff review.",
    compliance: "Reviewing",
    compliance_reasons: ["One failed subject remains under evaluation"],
    renewal: "Pending",
    decision_note: "Monitoring academic standing.",
    scholar_assignments: {
      profiles: { full_name: "Paul Vincent L. Reyes" },
      scholarship_programs: { program_name: "Service Scholarship" },
    },
  },
];

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
      window.location.href = "index.html";
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
    $("userInfo").textContent = profile.full_name || currentUser.email;
    $("roleInfo").textContent = `Role: ${profile.role}`;
    if (!isStaff()) {
      $("showAudit").hidden = true;
      $("recordsPanel").querySelector("h2").textContent = "My Submissions";
    } else {
      $("submitPanel").hidden = true;
      $("showSubmit").hidden = true;
    }
    await loadPrograms();
    await loadSubmissions();
    await loadAudit();
  } catch (error) {
    showNotice(error.message || "Could not load your account.", true);
  }
}

async function loadPrograms() {
  const { data, error } = await db
    .from("scholarship_programs")
    .select("id,program_name")
    .order("program_name");
  if (error) {
    showNotice(`Could not load programs: ${error.message}`, true);
    return;
  }
  $("program").innerHTML = (data || []).map((program) =>
    `<option value="${escapeHTML(program.id)}">${escapeHTML(program.program_name)}</option>`
  ).join("");
}

async function submitAcademicSummary(event) {
  event.preventDefault();
  if (!currentUser || isStaff()) return;

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

  const evidence = $("documentReference").value.trim();
  try {
    const evidenceURL = new URL(evidence);
    if (!["https:", "http:"].includes(evidenceURL.protocol)) throw new Error();
  } catch {
    showNotice("Enter a valid HTTP or HTTPS evidence reference.", true);
    return;
  }

  try {
    const { data: assignment, error: assignmentError } = await db
      .from("scholar_assignments")
      .select("id")
      .eq("scholar_id", currentUser.id)
      .eq("program_id", $("program").value)
      .eq("is_active", true)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) throw new Error("No active assignment exists for that program. Ask staff to assign it.");

    const { error } = await db.from("semester_submissions").insert({
      assignment_id: assignment.id,
      academic_year: $("schoolYear").value.trim(),
      semester: $("semester").value,
      gwa: values.gwa,
      enrolled_units: values.units,
      failed_count: values.failed,
      incomplete_count: values.incomplete,
      dropped_count: values.dropped,
      evidence_reference: evidence,
    });
    if (error) throw error;
    $("submissionForm").reset();
    showNotice("Academic summary submitted. It is pending verification.");
    await loadSubmissions();
  } catch (error) {
    showNotice(`Submission failed: ${error.message}`, true);
  }
}

async function loadSubmissions() {
  const { data, error } = await db.from("semester_submissions").select(`
    id,assignment_id,academic_year,semester,gwa,enrolled_units,failed_count,
    incomplete_count,dropped_count,evidence_reference,submitted_at,verification,
    verification_reason,compliance,compliance_reasons,renewal,decision_note,
    scholar_assignments!semester_submissions_assignment_id_fkey(
      scholar_id,profiles!scholar_assignments_scholar_id_fkey(full_name),
      scholarship_programs!scholar_assignments_program_id_fkey(program_name)
    )
  `).order("submitted_at", { ascending: false });

  if (error) {
    showNotice(`Could not load submissions: ${error.message}`, true);
    $("recordsBody").innerHTML = `<tr><td colspan="7">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  submissions = data && data.length ? data : demoSubmissions;
  renderSubmissions();
}

function renderSubmissions() {
  const term = $("searchInput").value.trim().toLowerCase();
  const filtered = submissions.filter((record) => {
    const assignment = record.scholar_assignments || {};
    const text = [
      assignment.profiles?.full_name,
      assignment.scholarship_programs?.program_name,
      record.verification, record.compliance, record.renewal,
      record.academic_year, record.semester,
    ].join(" ").toLowerCase();
    return text.includes(term);
  });

  if (!filtered.length) {
    $("recordsBody").innerHTML = '<tr><td colspan="7">No submissions found.</td></tr>';
    return;
  }
  $("recordsBody").innerHTML = filtered.map((record) => {
    const assignment = record.scholar_assignments || {};
    const reasons = (record.compliance_reasons || []).map(escapeHTML).join("; ");
    const actions = isStaff() ? `
      <button class="small-button" data-action="verify" data-id="${escapeHTML(record.id)}">Verify</button>
      <button class="small-button" data-action="return" data-id="${escapeHTML(record.id)}">Return</button>
      <button class="small-button" data-action="evaluate" data-id="${escapeHTML(record.id)}">Evaluate</button>
      <button class="small-button" data-action="approve" data-id="${escapeHTML(record.id)}">Approve</button>
      <button class="small-button" data-action="hold" data-id="${escapeHTML(record.id)}">Hold</button>` : "—";
    const evidence = (() => {
      try {
        const url = new URL(record.evidence_reference);
        return ["https:", "http:"].includes(url.protocol)
          ? `<a href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer">Open evidence</a>`
          : "—";
      } catch { return "—"; }
    })();
    return `<tr>
      <td><strong>${escapeHTML(assignment.profiles?.full_name || "Scholar")}</strong><br>
        ${escapeHTML(assignment.scholarship_programs?.program_name || "")}<br>
        <small>${escapeHTML(record.semester)} · ${escapeHTML(record.academic_year)}</small></td>
      <td>GWA: ${escapeHTML(record.gwa)}<br>Units: ${escapeHTML(record.enrolled_units)}<br>
        Failed: ${escapeHTML(record.failed_count)} · Incomplete: ${escapeHTML(record.incomplete_count)} · Dropped: ${escapeHTML(record.dropped_count)}</td>
      <td>${evidence}</td>
      <td>${statusTag(record.verification)}<br><small>${escapeHTML(record.verification_reason)}</small></td>
      <td>${statusTag(record.compliance)}<br><small>${reasons}</small></td>
      <td>${statusTag(record.renewal)}<br><small>${escapeHTML(record.decision_note)}</small></td>
      <td>${actions}</td></tr>`;
  }).join("");
}

async function staffAction(action, id) {
  const record = submissions.find((item) => item.id === id);
  if (!record || !isStaff()) return;
  let result;
  if (action === "verify" || action === "return") {
    const reason = prompt(action === "return" ? "Reason for returning this submission:" : "Verification note (optional):");
    if (reason === null) return;
    if (action === "return" && !reason.trim()) {
      showNotice("A return reason is required.", true);
      return;
    }
    result = await db.rpc("staff_verify_submission", {
      p_submission_id: id,
      p_status: action === "verify" ? "Verified" : "Returned",
      p_reason: reason.trim(),
    });
  } else if (action === "evaluate") {
    result = await db.rpc("staff_evaluate_submission", { p_submission_id: id });
  } else {
    const note = prompt(action === "hold" ? "Reason for holding this renewal:" : "Approval note:");
    if (note === null) return;
    if (!note.trim()) {
      showNotice("A decision note is required.", true);
      return;
    }
    result = await db.rpc("staff_record_renewal", {
      p_submission_id: id,
      p_decision: action === "approve" ? "Approved" : "Held",
      p_note: note.trim(),
    });
  }
  if (result.error) {
    showNotice(result.error.message, true);
    return;
  }
  showNotice("Staff action completed.");
  await loadSubmissions();
  await loadAudit();
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
$("recordsBody").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) await staffAction(button.dataset.action, button.dataset.id);
});
$("showSubmit").addEventListener("click", () => {
  $("submitPanel").hidden = false; $("recordsPanel").hidden = true; $("auditPanel").hidden = true;
});
$("showRecords").addEventListener("click", () => {
  $("submitPanel").hidden = true; $("recordsPanel").hidden = false; $("auditPanel").hidden = true;
});
$("showAudit").addEventListener("click", () => {
  if (!isStaff()) return;
  $("submitPanel").hidden = true; $("recordsPanel").hidden = true; $("auditPanel").hidden = false;
});
$("logoutBtn").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();
  if (error) showNotice(error.message, true);
  else window.location.href = "index.html";
});

startDashboard();
