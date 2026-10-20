/* Scholarship Monitoring System
   Configure SUPABASE_URL and SUPABASE_ANON_KEY below with your project's public anon key.
   Never use a service-role key in browser code. Database RLS is required for real security. */
const SUPABASE_URL = "https://orwyzyxufctmketnoauh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ma9-SMG9XJ0X7XX9fiiU2Q_g-ILdgC9";
function hasSupabaseConfig(){
 try{
  const url=new URL(SUPABASE_URL);
  return ["https:","http:"].includes(url.protocol)&&Boolean(SUPABASE_ANON_KEY.trim())&&!SUPABASE_ANON_KEY.startsWith("PASTE_");
 }catch{return false;}
}
const db=hasSupabaseConfig()?window.supabase?.createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;
window.smsSupabase=db;

const $ = (id) => document.getElementById(id);
let currentUser = null, profile = null, selectedSubmission = null, currentView = "dashboard";
let editingSubmissionId = null;
const staff = () => profile?.role === "Scholarship Staff";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const message = (txt, error=false) => { $("globalMessage").textContent=txt; $("globalMessage").classList.toggle("error",error); };
function failIfNoConfig(){
 if(!hasSupabaseConfig())throw new Error("Configure SUPABASE_URL and SUPABASE_ANON_KEY in js/app.js first.");
 if(!db)throw new Error("Supabase client failed to load. Check your internet connection and reload the page.");
}
function statusTag(value){const s=String(value||"—");let c="";if(["Verified","Compliant","Approved","Active","Returned"].includes(s))c="good";if(["Pending","Pending verification","Pending Decision","Not Decided","Held","Not Evaluated"].includes(s))c="warn";if(["With Deficiency","Rejected","Overdue"].includes(s))c="bad";return `<span class="tag ${c}">${esc(s)}</span>`;}
function fmtDate(v){return v?new Date(v).toLocaleString("en-PH",{timeZone:"Asia/Manila"}):"—";}
function table(headers,rows){if(!rows.length)return `<div class="empty">No records found.</div>`;return `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;}
async function init(){
 try{failIfNoConfig(); const {data:{session}}=await db.auth.getSession(); if(session) await loadProfile(session.user); else showLogin();
 db.auth.onAuthStateChange((_event,session)=>{setTimeout(async()=>{try{if(session)await loadProfile(session.user);else showLogin();}catch(e){showLogin();$("loginMessage").textContent=e.message;$("loginMessage").classList.add("error");}},0);});
 }catch(e){showLogin();$("loginMessage").textContent=e.message;$("loginMessage").classList.add("error");}
}
function showLogin(){$("loginView").hidden=false;$("appView").hidden=true;}
async function loadProfile(user){
 currentUser=user;
 const {data,error}=await db.from("profiles").select("id,student_id,full_name,role,is_active").eq("id",user.id).single();
 if(error&&error.code!=="PGRST116")throw error;
 if(!data||!data.is_active){await db.auth.signOut();showLogin();$("loginMessage").textContent="No active profile is linked to this account. Ask authorized staff to set up your profile.";return;}
 profile=data; $("loginView").hidden=true;$("appView").hidden=false;
 $("identity").textContent=`${profile.full_name} · ${profile.role}`;
 $("scholarsNav").hidden=!staff();$("auditNav").hidden=!staff();
 $("submitNav").hidden=staff();
 $("submitHeading").textContent=staff()?"Submit Grades (testing only)":"Submit Grades";
 await showView("dashboard");
}
async function showView(name){
 currentView=name;document.querySelectorAll(".view").forEach(v=>v.hidden=true);
 const target=$(name+"View");if(target)target.hidden=false;
 document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
 if(name==="dashboard")await loadDashboard();
 if(name==="submissions")await loadSubmissions();
 if(name==="scholars")await loadPolicies();
 if(name==="audit")await loadAudit();
}
$("logoutBtn").addEventListener("click",async()=>{try{if(db){const {error}=await db.auth.signOut();if(error)throw error;}}catch(e){message(e.message,true);}});
$("nav").addEventListener("click",e=>{const b=e.target.closest("button[data-view]");if(b)showView(b.dataset.view);});
$("refreshBtn").addEventListener("click",()=>loadSubmissions());
$("applyFilters").addEventListener("click",()=>loadDashboard());
$("dashboardSemester").addEventListener("change",()=>loadDashboard());

async function getSubmissionQuery(){
 let q=db.from("semester_submissions").select("*, scholar_assignments!semester_submissions_assignment_id_fkey(id,scholar_id,program_id,is_active,profiles!scholar_assignments_scholar_id_fkey(student_id,full_name),scholarship_programs!scholar_assignments_program_id_fkey(program_name))").order("submitted_at",{ascending:false});
 return q;
}
function programName(r){return r.scholar_assignments?.scholarship_programs?.program_name||"—";}
function scholarName(r){return r.scholar_assignments?.profiles?.full_name||profile.full_name||"—";}
function studentId(r){return r.scholar_assignments?.profiles?.student_id||profile.student_id||"—";}
function submissionRows(records,includeActions=true){
 return records.map(r=>{
 const reasons=(r.compliance_reasons||[]).map(x=>`<li>${esc(x)}</li>`).join("");
 let actions="";
 if(staff()&&includeActions)actions=`<div class="action-row">
 <button data-act="verify" data-id="${r.id}" class="secondary">Verify</button>
 <button data-act="return" data-id="${r.id}" class="secondary">Return</button>
 <button data-act="evaluate" data-id="${r.id}">Evaluate</button>
 <button data-act="approve" data-id="${r.id}" class="secondary">Approve</button>
 <button data-act="hold" data-id="${r.id}" class="secondary">Hold</button></div>`;
 else if(!staff()&&r.verification==="Returned")actions=`<div class="action-row"><button data-act="correct" data-id="${r.id}">Correct &amp; resubmit</button></div>`;
 return `<tr><td><strong>${esc(studentId(r))}</strong><div class="small">${esc(scholarName(r))}</div></td><td>${esc(programName(r))}</td><td>${esc(r.academic_year)} / ${esc(r.semester)}</td><td>${esc(r.gwa)}<div class="small">${esc(r.enrolled_units)} units</div></td><td>${statusTag(r.verification)}</td><td>${statusTag(r.compliance)}${reasons?`<ul class="reason-list">${reasons}</ul>`:""}</td><td>${statusTag(r.renewal||"Not Decided")}</td><td>${fmtDate(r.submitted_at)}${actions}</td></tr>`;
 });
}
const subHeaders=["Scholar","Program","Academic period","GWA / units","Verification","Compliance / reasons","Renewal","Submitted / staff actions"];
async function loadSubmissions(){
 try{const {data,error}=await getSubmissionQuery();if(error)throw error;
 $("submissionsTable").innerHTML=table(subHeaders,submissionRows(data||[]));wireRowActions(data||[]);
 }catch(e){$("submissionsTable").innerHTML=`<p class="message error">${esc(e.message)}</p>`;}
}
async function loadDashboard(){
 try{
 const {data,error}=await getSubmissionQuery();if(error)throw error;
 let rows=data||[];const sem=`Semester ${$("dashboardSemester").value}`;rows=rows.filter(r=>r.semester===sem);
 if(staff()){
 const {count,error:ce}=await db.from("scholar_assignments").select("*",{count:"exact",head:true}).eq("is_active",true);if(ce)throw ce;$("statAssigned").textContent=count;
 }else{
 const {count,error:ae}=await db.from("scholar_assignments").select("*",{count:"exact",head:true}).eq("scholar_id",currentUser.id).eq("is_active",true);if(ae)throw ae;$("statAssigned").textContent=count;
 }
 $("statPending").textContent=rows.filter(r=>r.verification==="Pending").length;
 $("statCompliant").textContent=rows.filter(r=>r.compliance==="Compliant").length;
 $("statDeficiency").textContent=rows.filter(r=>r.compliance==="With Deficiency").length;
 const term=$("searchInput").value.trim().toLowerCase(), prog=$("programFilter").value, comp=$("complianceFilter").value;
 rows=rows.filter(r=>(!term||`${studentId(r)} ${scholarName(r)}`.toLowerCase().includes(term))&&(!prog||programName(r)===prog)&&(!comp||r.compliance===comp));
 $("dashboardTable").innerHTML=table(subHeaders,submissionRows(rows.slice(0,100)));wireRowActions(rows);
 }catch(e){message(e.message,true);}
}
$("submissionForm").addEventListener("submit",async e=>{
 e.preventDefault();try{
 const gwa=Number($("gwa").value),units=Number($("units").value),failed=Number($("failed").value),inc=Number($("incomplete").value),drop=Number($("dropped").value);
 if(!Number.isFinite(gwa)||gwa<1||gwa>5)throw new Error("GWA must be between 1.00 and 5.00.");
 for(const [label,n] of [["Units",units],["Failed subjects",failed],["Incomplete grades",inc],["Dropped subjects",drop]])if(!Number.isInteger(n)||n<0)throw new Error(`${label} must be a nonnegative integer.`);
 const evidence=$("evidence").value.trim();if(!evidence)throw new Error("Enter the grade-document reference.");
 if(editingSubmissionId){
 const {error}=await db.rpc("scholar_resubmit_returned",{p_submission_id:editingSubmissionId,p_gwa: gwa,p_units:units,p_failed:failed,p_incomplete:inc,p_dropped:drop,p_evidence:evidence});if(error)throw error;
 resetSubmissionForm();message("Correction submitted. Verification status is Pending.");await showView("submissions");
 }else{
 const {data:assignment,error:ae}=await db.from("scholar_assignments").select("id").eq("scholar_id",currentUser.id).eq("is_active",true).maybeSingle();if(ae)throw ae;if(!assignment)throw new Error("No active scholarship assignment found.");
 const semester=$("semester").value==="Summer"?"Summer":`Semester ${$("semester").value}`;
 const payload={assignment_id:assignment.id,academic_year:$("academicYear").value.trim(),semester,gwa,enrolled_units:units,failed_count:failed,incomplete_count:inc,dropped_count:drop,evidence_reference:evidence};
 const {error}=await db.from("semester_submissions").insert(payload);if(error){if(error.code==="23505")throw new Error("A submission already exists for this academic year and semester.");throw error;}
 resetSubmissionForm();message("Submission saved. Verification status is Pending.");await showView("submissions");
 }
 }catch(err){message(err.message,true);}
});
function resetSubmissionForm(){
 $("submissionForm").reset();$("academicYear").value="2026-2027";$("semester").value="1";
 $("academicYear").disabled=false;$("semester").disabled=false;editingSubmissionId=null;
 $("submitHeading").textContent="Submit Grades";$("submissionSubmitBtn").textContent="Submit academic summary";
 $("cancelCorrectionBtn").hidden=true;
}
function startCorrection(r){
 editingSubmissionId=r.id;$("academicYear").value=r.academic_year;$("semester").value=r.semester==="Summer"?"Summer":r.semester==="Semester 2"?"2":"1";
 $("academicYear").disabled=true;$("semester").disabled=true;
 $("gwa").value=r.gwa;$("units").value=r.enrolled_units;$("failed").value=r.failed_count;
 $("incomplete").value=r.incomplete_count;$("dropped").value=r.dropped_count;$("evidence").value=r.evidence_reference;
 $("submitHeading").textContent="Correct and resubmit";$("submissionSubmitBtn").textContent="Resubmit correction";
 $("cancelCorrectionBtn").hidden=false;message("");
 showView("submit");
}
$("cancelCorrectionBtn").addEventListener("click",resetSubmissionForm);
async function wireRowActions(records){
 document.querySelectorAll("[data-act]").forEach(btn=>{btn.onclick=()=>{const r=records.find(x=>x.id===btn.dataset.id);if(r){if(btn.dataset.act==="correct")startCorrection(r);else openReview(r,btn.dataset.act);}};});
}
function openReview(r,act){
 selectedSubmission=r;$("reviewNote").value="";$("reviewSummary").textContent=`${studentId(r)} — ${r.academic_year}, ${r.semester}; verification: ${r.verification}; compliance: ${r.compliance}`;
 const actions=$("reviewActions");actions.innerHTML="";
 const make=(label,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=fn;actions.appendChild(b);};
 if(act==="verify"||act==="return"){
 $("reviewTitle").textContent=act==="verify"?"Verify evidence":"Return for correction";
 make(act==="verify"?"Mark Verified":"Return with reason",()=>saveReview(act));
 }else if(act==="evaluate"){
 $("reviewTitle").textContent="Evaluate compliance";make("Evaluate now",()=>saveReview("evaluate"));
 }else{
 $("reviewTitle").textContent=act==="approve"?"Approve renewal":"Hold renewal";
 make(act==="approve"?"Confirm approval":"Confirm hold",()=>saveReview(act));
 }
 $("reviewDialog").showModal();
}
async function saveReview(act){
 try{
 const r=selectedSubmission,note=$("reviewNote").value.trim();
 if(["return","hold"].includes(act)&&!note)throw new Error("A reason / decision note is required.");
 let result;
 if(act==="verify"){
 result=await db.rpc("staff_verify_submission",{p_submission_id:r.id,p_status:"Verified",p_reason:note||"Evidence verified"});
 }else if(act==="return"){
 result=await db.rpc("staff_verify_submission",{p_submission_id:r.id,p_status:"Returned",p_reason:note});
 }else if(act==="evaluate"){
 result=await db.rpc("staff_evaluate_submission",{p_submission_id:r.id});
 }else{
 result=await db.rpc("staff_record_renewal",{p_submission_id:r.id,p_decision:act==="approve"?"Approved":"Held",p_note:note||"Approved after compliant evaluation"});
 }
 if(result.error)throw result.error;
 $("reviewDialog").close();message("Action completed.");await loadSubmissions();await loadDashboard();
 }catch(e){message(e.message,true);}
}
$("scholarForm").addEventListener("submit",async e=>{
 e.preventDefault();try{
 const {error:ue}=await db.rpc("staff_register_scholar",{p_student_id:$("studentId").value.trim(),p_full_name:$("fullName").value.trim(),p_email:$("scholarEmail").value.trim(),p_program_name:$("scholarProgram").value});
 if(ue)throw ue;
 message("Scholar registered and program assigned.");e.target.reset();await loadPolicies();
 }catch(err){message(err.message,true);}
});
async function loadPolicies(){
 try{const {data,error}=await db.from("scholarship_programs").select("*").order("program_name");if(error)throw error;
 $("policyTable").innerHTML=table(["Program","Maximum GWA","Minimum units","Max failed","Max incomplete","Max dropped","Deadline"],(data||[]).map(p=>`<tr><td>${esc(p.program_name)}</td><td>${esc(p.max_gwa)}</td><td>${esc(p.min_enrolled_units)}</td><td>${esc(p.max_failed_count)}</td><td>${esc(p.max_incomplete_count)}</td><td>${esc(p.max_dropped_count)}</td><td>${fmtDate(p.deadline)}</td></tr>`));
 }catch(e){$("policyTable").innerHTML=`<p class="message error">${esc(e.message)}</p>`;}
}
async function loadAudit(){
 try{const {data,error}=await db.from("audit_logs").select("id,action,module,description,created_at,actor_id,record_id").order("created_at",{ascending:false}).limit(200);if(error)throw error;
 $("auditTable").innerHTML=table(["Timestamp","Actor ID","Action","Module","Record ID","Description"],(data||[]).map(a=>`<tr><td>${fmtDate(a.created_at)}</td><td>${esc(a.actor_id)}</td><td>${esc(a.action)}</td><td>${esc(a.module)}</td><td>${esc(a.record_id||"—")}</td><td>${esc(a.description)}</td></tr>`));
 }catch(e){$("auditTable").innerHTML=`<p class="message error">${esc(e.message)}</p>`;}
}
init();
