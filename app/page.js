"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { supabase } from "../lib/supabase";
import { sendEmail } from "../lib/email";

// ─── CONSTANTS ───
const DEPARTMENTS = ["Engineering","Sales","HR","Finance","Operations","IT","Marketing","Quality","Logistics","Maintenance"];
const STATUS = {
  pending:  { bg:"#FEF9C3", fg:"#854D0E", border:"#EAB308" },
  approved: { bg:"#DCFCE7", fg:"#166534", border:"#22C55E" },
  rejected: { bg:"#FEE2E2", fg:"#991B1B", border:"#EF4444" },
};
const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#F97316","#6366F1","#84CC16"];

// ─── HELPERS ───
const fmt = d => { if (!d) return "—"; return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); };
const fmtShort = d => { if (!d) return "—"; return new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short"}); };
const fmtTime = d => { if (!d) return ""; return new Date(d).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}); };

function downloadCSV(filename, headers, rows) {
  const bom = "\uFEFF";
  const csv = bom + [headers.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ─── EMAIL CONFIG (stored in localStorage since it's admin-only config) ───
function getEmailConfig() {
  try { return JSON.parse(localStorage.getItem("ot_email_config")) || { enabled:false, serviceId:"", templateId:"", publicKey:"", notifyManagerOnSubmit:true, notifyEmployeeOnReview:true }; } catch { return { enabled:false, serviceId:"", templateId:"", publicKey:"", notifyManagerOnSubmit:true, notifyEmployeeOnReview:true }; }
}
function setEmailConfigStorage(cfg) { localStorage.setItem("ot_email_config", JSON.stringify(cfg)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN APP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null); // { role, profile_id }
  const [view, setView] = useState("login");
  const [toast, setToast] = useState(null);

  // Data
  const [managers, setManagers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [emailConfig, setEmailConfig] = useState({ enabled:false });

  const flash = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null), 3200); };

  // ─── AUTH ───
  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}}) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else { setProfile(null); setView("login"); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    const { data } = await supabase.from("user_profiles").select("*").eq("id", userId).single();
    if (data) {
      setProfile(data);
      setView(data.role);
      await loadData(data.role, data.profile_id);
    }
    setReady(true);
  };

  const loadData = async (role, profileId) => {
    // Load managers (everyone can read)
    const { data: mgrs } = await supabase.from("managers").select("*").order("name");
    setManagers(mgrs || []);

    if (role === "admin") {
      const { data: emps } = await supabase.from("employees").select("*").order("name");
      setEmployees(emps || []);
      const { data: reqs } = await supabase.from("overtime_requests").select("*").order("created_at", { ascending: false });
      setRequests(reqs || []);
    } else if (role === "manager") {
      const { data: emps } = await supabase.from("employees").select("*").eq("manager_id", profileId).order("name");
      setEmployees(emps || []);
      const empIds = (emps || []).map(e => e.id);
      if (empIds.length > 0) {
        const { data: reqs } = await supabase.from("overtime_requests").select("*").in("employee_id", empIds).order("created_at", { ascending: false });
        setRequests(reqs || []);
      }
    } else if (role === "employee") {
      // Load own record
      const { data: emps } = await supabase.from("employees").select("*").eq("id", profileId);
      setEmployees(emps || []);
      const { data: reqs } = await supabase.from("overtime_requests").select("*").eq("employee_id", profileId).order("created_at", { ascending: false });
      setRequests(reqs || []);
    }
    setEmailConfig(getEmailConfig());
  };

  const handleLogin = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true };
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null); setProfile(null); setView("login");
    setManagers([]); setEmployees([]); setRequests([]);
  };

  // ─── CRUD ───
  const addRequest = async (reqData) => {
    const emp = employees.find(e => e.id === reqData.employee_id);
    const mgr = managers.find(m => m.id === emp?.manager_id);

    const { data, error } = await supabase.from("overtime_requests").insert({
      employee_id: reqData.employee_id,
      date: reqData.date,
      hours: reqData.hours,
      reason: reqData.reason,
      status: "pending",
    }).select().single();

    if (error) { flash("Error: " + error.message, "error"); return; }
    setRequests(prev => [data, ...prev]);
    flash("Overtime logged successfully");

    // Email manager
    if (emailConfig.notifyManagerOnSubmit && mgr?.email) {
      const appUrl = window.location.origin;
      sendEmail(emailConfig, mgr.email, mgr.name,
        `New Overtime Request from ${emp?.name}`,
        `Hello ${mgr.name},\n\n${emp?.name} (${emp?.department}) submitted overtime:\n\nDate: ${fmt(reqData.date)}\nHours: ${reqData.hours}\nLocation: ${reqData.location || "Not specified"}\nReason: ${reqData.reason}\n\nReview it here: ${appUrl}\n\n— Overtime Manager, Al Manaber`
      ).then(r => { if(r.success) flash("Email sent to manager","info"); });
    }
  };

  const updateRequest = async (id, status, note) => {
    const { data, error } = await supabase.from("overtime_requests").update({
      status, manager_note: note, reviewed_at: new Date().toISOString(),
    }).eq("id", id).select().single();

    if (error) { flash("Error: " + error.message, "error"); return; }
    setRequests(prev => prev.map(r => r.id === id ? data : r));
    flash(`Request ${status}`);
  };

  const bulkUpdate = async (ids, status) => {
    const { error } = await supabase.from("overtime_requests").update({
      status, reviewed_at: new Date().toISOString(),
    }).in("id", ids);

    if (error) { flash("Error: " + error.message, "error"); return; }
    setRequests(prev => prev.map(r => ids.includes(r.id) ? { ...r, status, reviewed_at: new Date().toISOString() } : r));
    flash(`${ids.length} requests ${status}`);
  };

  // Admin CRUD
  const addEmployee = async (emp) => {
    const { data, error } = await supabase.from("employees").insert(emp).select().single();
    if (error) { flash("Error: " + error.message, "error"); return; }
    setEmployees(prev => [...prev, data]); flash("Employee added");
  };

  const editEmployee = async (id, updates) => {
    const { data, error } = await supabase.from("employees").update(updates).eq("id", id).select().single();
    if (error) { flash("Error: " + error.message, "error"); return; }
    setEmployees(prev => prev.map(e => e.id === id ? data : e)); flash("Employee updated");
  };

  const deleteEmployee = async (id) => {
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) { flash("Error: " + error.message, "error"); return; }
    setEmployees(prev => prev.filter(e => e.id !== id)); flash("Employee removed");
  };

  const addManager = async (mgr) => {
    const { data, error } = await supabase.from("managers").insert(mgr).select().single();
    if (error) { flash("Error: " + error.message, "error"); return; }
    setManagers(prev => [...prev, data]); flash("Manager added");
  };

  const editManager = async (id, updates) => {
    const { data, error } = await supabase.from("managers").update(updates).eq("id", id).select().single();
    if (error) { flash("Error: " + error.message, "error"); return; }
    setManagers(prev => prev.map(m => m.id === id ? data : m)); flash("Manager updated");
  };

  const deleteManager = async (id) => {
    const { error } = await supabase.from("managers").delete().eq("id", id);
    if (error) { flash("Error: " + error.message, "error"); return; }
    setManagers(prev => prev.filter(m => m.id !== id)); flash("Manager removed");
  };

  const updateEmailCfg = (cfg) => { setEmailConfig(cfg); setEmailConfigStorage(cfg); flash("Email settings saved"); };

  const changePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { flash("Error: " + error.message, "error"); return false; }
    flash("Password updated successfully");
    return true;
  };

  // ─── RENDER ───
  if (!ready) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
        <p className="mt-4 text-slate-400">Loading...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {toast && <div className="animate-slide-in" style={{ position:"fixed",top:12,right:12,color:"#fff",padding:"10px 20px",borderRadius:10,fontSize:14,fontWeight:600,zIndex:999,boxShadow:"0 8px 24px rgba(0,0,0,0.2)",background:toast.type==="success"?"#059669":toast.type==="error"?"#DC2626":"#3B82F6" }}>{toast.msg}</div>}

      {/* Header */}
      <header style={{ background:"#0F172A",color:"#fff",position:"sticky",top:0,zIndex:50,borderBottom:"1px solid #1E293B" }}>
        <div style={{ maxWidth:1060,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 20px",height:56 }}>
          <div style={{ display:"flex",alignItems:"center",gap:14 }}>
            <div style={{ width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#3B82F6,#06B6D4)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:800,letterSpacing:1 }}>OT</div>
            <div><h1 style={{ fontSize:15,fontWeight:700,margin:0 }}>Overtime Manager</h1><p style={{ fontSize:11,color:"#64748B",margin:0 }}>Al Manaber</p></div>
          </div>
          {session && (
            <div style={{ display:"flex",alignItems:"center",gap:12 }}>
              <span style={{ color:"#94A3B8",fontSize:13 }}>{session.user.email}</span>
              <button onClick={handleLogout} style={{ background:"none",border:"1px solid #334155",color:"#94A3B8",padding:"5px 14px",borderRadius:6,fontSize:13,cursor:"pointer" }}>Sign Out</button>
            </div>
          )}
        </div>
      </header>

      <main style={{ maxWidth:1060,margin:"0 auto",padding:"24px 20px 60px" }}>
        {view === "login" && <LoginForm onLogin={handleLogin} />}
        {view === "employee" && <EmpView profile={profile} employees={employees} managers={managers} requests={requests} onSubmit={addRequest} onChangePassword={changePassword} />}
        {view === "manager" && <MgrView profile={profile} employees={employees} managers={managers} requests={requests} onUpdate={updateRequest} onBulk={bulkUpdate} onChangePassword={changePassword} />}
        {view === "admin" && <AdminView managers={managers} employees={employees} requests={requests} onAddEmployee={addEmployee} onEditEmployee={editEmployee} onDeleteEmployee={deleteEmployee} onAddManager={addManager} onEditManager={editManager} onDeleteManager={deleteManager} emailConfig={emailConfig} onUpdateEmailConfig={updateEmailCfg} />}
      </main>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOGIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function LoginForm({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true); setError("");
    const result = await onLogin(email, password);
    if (!result.success) setError(result.error);
    setLoading(false);
  };

  return (
    <div style={{ display:"flex",justifyContent:"center",paddingTop:60 }}>
      <div style={{ width:"100%",maxWidth:440,background:"#fff",borderRadius:20,padding:"36px 32px",boxShadow:"0 8px 32px rgba(0,0,0,0.08)" }}>
        <div style={{ textAlign:"center",marginBottom:28 }}>
          <h2 style={{ fontSize:24,fontWeight:700,margin:"0 0 6px" }}>Sign In</h2>
          <p style={{ fontSize:14,color:"#64748B" }}>Enter your email and password</p>
        </div>

        <Field label="Email">
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); }} placeholder="you@almanaber.com" style={S.inp} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
        </Field>

        <Field label="Password">
          <div style={{ position:"relative" }}>
            <input type={showPw ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setError(""); }} placeholder="Enter your password" style={S.inp} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
            <button onClick={() => setShowPw(!showPw)} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#94A3B8",fontWeight:600 }}>{showPw ? "Hide" : "Show"}</button>
          </div>
        </Field>

        {error && <p style={{ color:"#DC2626",fontSize:13,fontWeight:600,marginBottom:8,padding:"8px 12px",background:"#FEF2F2",borderRadius:8,border:"1px solid #FECACA" }}>{error}</p>}

        <button onClick={handleSubmit} disabled={!email || !password || loading} style={{ ...S.btnPrimary, width:"100%", opacity: (!email || !password || loading) ? 0.45 : 1, marginTop:4 }}>
          {loading ? "Signing in..." : "Sign In →"}
        </button>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMPLOYEE VIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function EmpView({ profile, employees, managers, requests, onSubmit, onChangePassword }) {
  const emp = employees.find(e => e.id === profile.profile_id);
  const mgr = managers.find(m => m.id === emp?.manager_id);
  const mine = useMemo(() => requests.filter(r => r.employee_id === profile.profile_id).sort((a,b) => b.created_at?.localeCompare(a.created_at)), [requests, profile.profile_id]);

  const [form, setForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("Office");
  const [showPwChange, setShowPwChange] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const submit = () => {
    if (!date || !hours || !reason.trim()) return;
    onSubmit({ employee_id: profile.profile_id, date, hours: parseFloat(hours), reason: reason.trim(), location });
    setHours(""); setReason(""); setLocation("Office"); setForm(false);
  };

  const totalApproved = mine.filter(r => r.status === "approved").reduce((s,r) => s + Number(r.hours), 0);

  return (
    <div>
      <div style={S.topBar}>
        <div><h2 style={S.pageName}>{emp?.name || "Employee"}</h2><p style={S.pageMeta}>{emp?.department} · Reports to {mgr?.name || "—"}</p></div>
        <button onClick={() => setForm(!form)} style={form ? S.btnGhost : S.btnPrimary}>{form ? "✕ Cancel" : "+ Log Overtime"}</button>
      </div>

      <div style={S.stats3}>
        <StatBox value={totalApproved} unit="hrs" label="Approved Hours" color="#059669" />
        <StatBox value={mine.filter(r => r.status === "pending").length} label="Pending" color="#EAB308" />
        <StatBox value={mine.length} label="Total Requests" color="#6366F1" />
      </div>

      {form && (
        <div className="animate-fade-up" style={S.card}>
          <h3 style={S.cardTitle}>Log Overtime Hours</h3>
          <div style={S.g2}>
            <Field label="Date Worked"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.inp} /></Field>
            <Field label="Hours"><input type="number" step="0.5" min="0.5" max="16" value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. 2.5" style={S.inp} /></Field>
          </div>
          <div style={S.g2}>
            <Field label="Location">
              <select value={location} onChange={e => setLocation(e.target.value)} style={{...S.sel,marginBottom:0}}>
                <option value="Office">Office</option>
                <option value="Home">Home</option>
              </select>
            </Field>
            <div />
          </div>
          <Field label="Reason / Task"><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe what you worked on..." rows={3} style={{ ...S.inp, resize:"vertical" }} /></Field>
          <button onClick={submit} disabled={!date||!hours||!reason.trim()} style={{ ...S.btnPrimary, opacity:(!date||!hours||!reason.trim())?0.45:1 }}>Submit Request</button>
        </div>
      )}

      <h3 style={S.secTitle}>My Requests ({mine.length})</h3>
      {mine.length === 0 ? <Empty text="No overtime requests yet" /> : (
        <div style={S.stack}>
          {mine.map((r,i) => (
            <div key={r.id} className="animate-fade-up" style={{ ...S.card, borderLeft:`4px solid ${STATUS[r.status].border}`, animationDelay:`${i*0.04}s` }}>
              <div style={S.rowBetween}><span style={S.dateLabel}>{fmt(r.date)}</span><Badge status={r.status} /></div>
              <p style={S.hoursLabel}>{r.hours} hours {r.location && <span style={{fontWeight:400,fontSize:13,color:"#64748B"}}>· {r.location}</span>}</p>
              <p style={S.reasonText}>{r.reason}</p>
              {r.manager_note && <p style={S.noteText}>{r.manager_note}</p>}
              <p style={S.metaText}>Submitted {fmtShort(r.created_at)} {fmtTime(r.created_at)} {r.reviewed_at ? ` · Reviewed ${fmtShort(r.reviewed_at)}` : ""}</p>
            </div>
          ))}
        </div>
      )}

      <h3 style={S.secTitle}>Account</h3>
      <div style={S.card}>
        <div style={S.rowBetween}>
          <div><strong style={{fontSize:14}}>Change Password</strong><p style={{fontSize:13,color:"#64748B",margin:"2px 0 0"}}>Update your login password</p></div>
          <button onClick={()=>setShowPwChange(!showPwChange)} style={S.btnGhost}>{showPwChange ? "Cancel" : "Change"}</button>
        </div>
        {showPwChange && (
          <div style={{marginTop:16}}>
            <div style={S.g2}>
              <Field label="New Password"><input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Min 6 characters" style={S.inp} /></Field>
              <Field label="Confirm Password"><input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} placeholder="Re-enter password" style={S.inp} /></Field>
            </div>
            {newPw && confirmPw && newPw !== confirmPw && <p style={{color:"#DC2626",fontSize:13,marginBottom:8}}>Passwords do not match</p>}
            <button onClick={async ()=>{ if(newPw.length<6){alert("Password must be at least 6 characters");return;} if(newPw!==confirmPw){alert("Passwords do not match");return;} const ok=await onChangePassword(newPw); if(ok){setNewPw("");setConfirmPw("");setShowPwChange(false);} }} disabled={!newPw||newPw.length<6||newPw!==confirmPw} style={{...S.btnPrimary,opacity:(!newPw||newPw.length<6||newPw!==confirmPw)?0.45:1}}>Update Password</button>
          </div>
        )}
      </div>
    </div>
  );
}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function MgrView({ profile, employees, managers, requests, onUpdate, onBulk, onChangePassword }) {
  const mgr = managers.find(m => m.id === profile.profile_id);
  const team = employees.filter(e => e.manager_id === profile.profile_id);
  const teamReqs = useMemo(() => requests.sort((a,b) => b.created_at?.localeCompare(a.created_at)), [requests]);
  const pending = teamReqs.filter(r => r.status === "pending");

  const [tab, setTab] = useState("pending");
  const [notes, setNotes] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState("");
  const [showPwChange, setShowPwChange] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const shown = (tab==="pending"?pending : tab==="approved"?teamReqs.filter(r=>r.status==="approved") : tab==="rejected"?teamReqs.filter(r=>r.status==="rejected") : teamReqs)
    .filter(r => { if(!search) return true; const emp = employees.find(e=>e.id===r.employee_id); return emp?.name.toLowerCase().includes(search.toLowerCase()) || r.reason.toLowerCase().includes(search.toLowerCase()); });

  const toggleSel = id => { const s = new Set(selected); s.has(id)?s.delete(id):s.add(id); setSelected(s); };

  return (
    <div>
      <div style={S.topBar}>
        <div><h2 style={S.pageName}>{mgr?.name || "Manager"}</h2><p style={S.pageMeta}>{mgr?.department} Manager · {team.length} direct reports</p></div>
        {pending.length > 0 && <div className="animate-pulse-soft" style={S.alertPill}>{pending.length} awaiting review</div>}
      </div>

      <div style={S.stats3}>
        <StatBox value={pending.length} label="Pending" color="#EAB308" />
        <StatBox value={teamReqs.filter(r=>r.status==="approved").reduce((s,r)=>s+Number(r.hours),0)} unit="hrs" label="Approved Hours" color="#059669" />
        <StatBox value={team.length} label="Team Size" color="#6366F1" />
      </div>

      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or reason..." style={{...S.inp,marginBottom:12}} />
      <div style={S.tabBar}>
        {[["pending","Pending"],["approved","Approved"],["rejected","Rejected"],["all","All"]].map(([k,l]) => (
          <button key={k} onClick={()=>{setTab(k);setSelected(new Set());}} style={{...S.tabBtn,...(tab===k?S.tabOn:{})}}>{l}{k==="pending"&&pending.length>0?` (${pending.length})`:""}</button>
        ))}
      </div>

      {selected.size > 0 && (
        <div style={S.bulkBar}>
          <span style={{fontSize:13,fontWeight:600}}>{selected.size} selected</span>
          <button onClick={()=>{onBulk([...selected],"approved");setSelected(new Set());}} style={S.btnApprove}>✓ Approve All</button>
          <button onClick={()=>{onBulk([...selected],"rejected");setSelected(new Set());}} style={S.btnReject}>✕ Reject All</button>
        </div>
      )}

      {shown.length === 0 ? <Empty text={`No ${tab} requests`} /> : (
        <div style={S.stack}>
          {shown.map((r,i) => {
            const emp = employees.find(e => e.id === r.employee_id);
            return (
              <div key={r.id} className="animate-fade-up" style={{...S.card, borderLeft:`4px solid ${STATUS[r.status].border}`, animationDelay:`${i*0.03}s`}}>
                <div style={S.rowBetween}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    {r.status==="pending" && <input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleSel(r.id)} />}
                    <div><span style={S.empNameText}>{emp?.name}</span><span style={S.deptTag}>{emp?.department}</span></div>
                  </div>
                  <Badge status={r.status} />
                </div>
                <div style={{display:"flex",gap:16,margin:"8px 0",fontSize:14}}>
                  <span style={{fontWeight:600}}>{fmt(r.date)}</span>
                  <span style={{fontWeight:700,color:"#0F172A"}}>{r.hours} hrs</span>
                  {r.location && <span style={{color:"#64748B"}}>{r.location}</span>}
                </div>
                <p style={S.reasonText}>{r.reason}</p>
                {r.status === "pending" && (
                  <div style={S.actionRow}>
                    <input value={notes[r.id]||""} onChange={e=>setNotes({...notes,[r.id]:e.target.value})} placeholder="Note (optional)" style={{...S.inp,flex:1}} />
                    <button onClick={()=>onUpdate(r.id,"approved",notes[r.id]||"")} style={S.btnApprove}>✓ Approve</button>
                    <button onClick={()=>onUpdate(r.id,"rejected",notes[r.id]||"")} style={S.btnReject}>✕ Reject</button>
                  </div>
                )}
                {r.manager_note && r.status !== "pending" && <p style={S.noteText}>{r.manager_note}</p>}
                <p style={S.metaText}>Submitted {fmtShort(r.created_at)} {fmtTime(r.created_at)}</p>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={S.secTitle}>Account</h3>
      <div style={S.card}>
        <div style={S.rowBetween}>
          <div><strong style={{fontSize:14}}>Change Password</strong><p style={{fontSize:13,color:"#64748B",margin:"2px 0 0"}}>Update your login password</p></div>
          <button onClick={()=>setShowPwChange(!showPwChange)} style={S.btnGhost}>{showPwChange ? "Cancel" : "Change"}</button>
        </div>
        {showPwChange && (
          <div style={{marginTop:16}}>
            <div style={S.g2}>
              <Field label="New Password"><input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Min 6 characters" style={S.inp} /></Field>
              <Field label="Confirm Password"><input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} placeholder="Re-enter password" style={S.inp} /></Field>
            </div>
            {newPw && confirmPw && newPw !== confirmPw && <p style={{color:"#DC2626",fontSize:13,marginBottom:8}}>Passwords do not match</p>}
            <button onClick={async ()=>{ if(newPw.length<6){alert("Password must be at least 6 characters");return;} if(newPw!==confirmPw){alert("Passwords do not match");return;} const ok=await onChangePassword(newPw); if(ok){setNewPw("");setConfirmPw("");setShowPwChange(false);} }} disabled={!newPw||newPw.length<6||newPw!==confirmPw} style={{...S.btnPrimary,opacity:(!newPw||newPw.length<6||newPw!==confirmPw)?0.45:1}}>Update Password</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADMIN VIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AdminView({ managers, employees, requests, onAddEmployee, onEditEmployee, onDeleteEmployee, onAddManager, onEditManager, onDeleteManager, emailConfig, onUpdateEmailConfig }) {
  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showAddMgr, setShowAddMgr] = useState(false);
  const [newEmp, setNewEmp] = useState({name:"",email:"",manager_id:"",department:""});
  const [newMgr, setNewMgr] = useState({name:"",email:"",department:""});
  const [editingEmp, setEditingEmp] = useState(null);
  const [editEmpData, setEditEmpData] = useState({});
  const [editingMgr, setEditingMgr] = useState(null);
  const [editMgrData, setEditMgrData] = useState({});
  const [empSearch, setEmpSearch] = useState("");
  const [mgrSearch, setMgrSearch] = useState("");

  const approved = requests.filter(r => r.status === "approved");
  const monthReqs = approved.filter(r => r.date?.startsWith(month));

  const hoursSummary = useMemo(() => {
    const map = {};
    monthReqs.forEach(r => { if(!map[r.employee_id]) map[r.employee_id]={hours:0,count:0}; map[r.employee_id].hours += Number(r.hours); map[r.employee_id].count += 1; });
    return Object.entries(map).map(([eid,d]) => {
      const emp = employees.find(e=>e.id===eid); const mgr = managers.find(m=>m.id===emp?.manager_id);
      return { eid, name:emp?.name||"—", dept:emp?.department||"—", manager:mgr?.name||"—", ...d };
    }).sort((a,b) => b.hours - a.hours);
  }, [monthReqs, employees, managers]);

  const totalH = hoursSummary.reduce((s,r)=>s+r.hours, 0);

  const deptChart = useMemo(() => {
    const m = {}; monthReqs.forEach(r => { const emp = employees.find(e=>e.id===r.employee_id); const d=emp?.department||"Other"; m[d]=(m[d]||0)+Number(r.hours); });
    return Object.entries(m).map(([name,hours])=>({name,hours})).sort((a,b)=>b.hours-a.hours);
  }, [monthReqs, employees]);

  const statusChart = useMemo(() => {
    const m = requests.filter(r=>r.date?.startsWith(month));
    return [{name:"Approved",value:m.filter(r=>r.status==="approved").length},{name:"Pending",value:m.filter(r=>r.status==="pending").length},{name:"Rejected",value:m.filter(r=>r.status==="rejected").length}].filter(d=>d.value>0);
  }, [requests, month]);

  const exportHours = () => { downloadCSV(`overtime-hours-${month}.csv`,["Employee","Department","Manager","OT Hours","Requests"],[...hoursSummary.map(r=>[r.name,r.dept,r.manager,r.hours,r.count]),["TOTAL","","",totalH,hoursSummary.reduce((s,r)=>s+r.count,0)]]); };
  const exportAll = () => { downloadCSV(`overtime-all.csv`,["Employee","Department","Manager","Date","Hours","Location","Reason","Status","Manager Note","Submitted","Reviewed"],requests.map(r=>{const emp=employees.find(e=>e.id===r.employee_id);const mgr=managers.find(m=>m.id===emp?.manager_id);return[emp?.name,emp?.department,mgr?.name,r.date,r.hours,r.location||"",r.reason,r.status,r.manager_note,r.created_at,r.reviewed_at||""];})); };

  const handleAddEmp = () => { if(!newEmp.name||!newEmp.email||!newEmp.manager_id||!newEmp.department) return; onAddEmployee(newEmp); setNewEmp({name:"",email:"",manager_id:"",department:""}); setShowAddEmp(false); };
  const handleAddMgr = () => { if(!newMgr.name||!newMgr.email) return; onAddManager(newMgr); setNewMgr({name:"",email:"",department:""}); setShowAddMgr(false); };

  const openEditEmp = (e) => { setEditingEmp(e.id); setEditEmpData({name:e.name,email:e.email||"",department:e.department,manager_id:e.manager_id}); };
  const saveEditEmp = () => { if(!editEmpData.name||!editEmpData.manager_id) return; onEditEmployee(editingEmp, editEmpData); setEditingEmp(null); };
  const openEditMgr = (m) => { setEditingMgr(m.id); setEditMgrData({name:m.name,email:m.email,department:m.department}); };
  const saveEditMgr = () => { if(!editMgrData.name||!editMgrData.email) return; onEditManager(editingMgr, editMgrData); setEditingMgr(null); };

  const filteredEmps = employees.filter(e => !empSearch || e.name?.toLowerCase().includes(empSearch.toLowerCase()));
  const filteredMgrs = managers.filter(m => !mgrSearch || m.name?.toLowerCase().includes(mgrSearch.toLowerCase()));

  return (
    <div>
      {/* Edit Employee Modal */}
      {editingEmp && <EditModal title="Edit Employee" onClose={()=>setEditingEmp(null)}>
        <div style={S.g2}>
          <Field label="Name"><input value={editEmpData.name} onChange={e=>setEditEmpData({...editEmpData,name:e.target.value})} style={S.inp} /></Field>
          <Field label="Email"><input type="email" value={editEmpData.email||""} onChange={e=>setEditEmpData({...editEmpData,email:e.target.value})} style={S.inp} /></Field>
        </div>
        <div style={S.g2}>
          <Field label="Department"><select value={editEmpData.department} onChange={e=>setEditEmpData({...editEmpData,department:e.target.value})} style={{...S.sel,marginBottom:0}}><option value="">Select...</option>{DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Field>
          <Field label="Manager"><select value={editEmpData.manager_id} onChange={e=>setEditEmpData({...editEmpData,manager_id:e.target.value})} style={{...S.sel,marginBottom:0}}><option value="">Select...</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        </div>
        <div style={{display:"flex",gap:10,marginTop:20}}><button onClick={saveEditEmp} style={S.btnPrimary}>Save</button><button onClick={()=>setEditingEmp(null)} style={S.btnGhost}>Cancel</button></div>
      </EditModal>}

      {editingMgr && <EditModal title="Edit Manager" onClose={()=>setEditingMgr(null)}>
        <div style={S.g2}>
          <Field label="Name"><input value={editMgrData.name} onChange={e=>setEditMgrData({...editMgrData,name:e.target.value})} style={S.inp} /></Field>
          <Field label="Email"><input value={editMgrData.email} onChange={e=>setEditMgrData({...editMgrData,email:e.target.value})} style={S.inp} /></Field>
        </div>
        <Field label="Department"><select value={editMgrData.department} onChange={e=>setEditMgrData({...editMgrData,department:e.target.value})} style={{...S.sel,marginBottom:0}}><option value="">Select...</option>{DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Field>
        <div style={{display:"flex",gap:10,marginTop:20}}><button onClick={saveEditMgr} style={S.btnPrimary}>Save</button><button onClick={()=>setEditingMgr(null)} style={S.btnGhost}>Cancel</button></div>
      </EditModal>}

      <div style={S.topBar}>
        <div><h2 style={S.pageName}>Admin Dashboard</h2><p style={S.pageMeta}>{employees.length} employees · {managers.length} managers</p></div>
      </div>

      <div style={S.stats4}>
        <StatBox value={requests.filter(r=>r.status==="pending").length} label="Pending Now" color="#EAB308" />
        <StatBox value={totalH} unit="hrs" label={`Approved (${month.slice(5)}/${month.slice(0,4)})`} color="#059669" />
        <StatBox value={hoursSummary.length} label="Employees w/ OT" color="#3B82F6" />
        <StatBox value={employees.length} label="Total Employees" color="#6366F1" />
      </div>

      <div style={S.tabBar}>
        {[["dashboard","Dashboard"],["hours","Hours Report"],["people","People"],["all","All Requests"],["settings","Settings"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{...S.tabBtn,...(tab===k?S.tabOn:{})}}>{l}</button>
        ))}
      </div>

      {tab === "dashboard" && <div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}><label style={S.lbl}>Period:</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...S.inp,width:200}} /></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
          <div style={S.card}><h4 style={S.cardTitle}>Hours by Department</h4>{deptChart.length===0?<Empty text="No data"/>:<ResponsiveContainer width="100%" height={220}><BarChart data={deptChart}><XAxis dataKey="name" tick={{fontSize:11}} /><YAxis tick={{fontSize:11}} /><Tooltip formatter={v=>`${v} hrs`} /><Bar dataKey="hours" radius={[6,6,0,0]}>{deptChart.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer>}</div>
          <div style={S.card}><h4 style={S.cardTitle}>Status Breakdown</h4>{statusChart.length===0?<Empty text="No data"/>:<ResponsiveContainer width="100%" height={220}><PieChart><Pie data={statusChart} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" label={({name,value})=>`${name}: ${value}`}>{statusChart.map((d,i)=><Cell key={i} fill={d.name==="Approved"?"#22C55E":d.name==="Pending"?"#EAB308":"#EF4444"}/>)}</Pie><Legend/></PieChart></ResponsiveContainer>}</div>
        </div>
        <div style={S.card}><h4 style={S.cardTitle}>Top Overtime Employees</h4>{hoursSummary.slice(0,5).map((r,i)=>(<div key={r.eid} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:i<4?"1px solid #F1F5F9":"none"}}><span style={{width:28,height:28,borderRadius:"50%",background:COLORS[i],color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</span><span style={{flex:1,fontWeight:600}}>{r.name}</span><span style={{color:"#64748B",fontSize:13}}>{r.dept}</span><span style={{fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{r.hours} hrs</span></div>))}</div>
      </div>}

      {tab === "hours" && <div>
        <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
          <label style={S.lbl}>Month:</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{...S.inp,width:200}} />
          <button onClick={exportHours} style={{...S.btnPrimary,background:"#059669"}}>Hours Summary</button>
          <button onClick={exportAll} style={S.btnGhost}>All Requests</button>
        </div>
        {hoursSummary.length===0?<Empty text="No approved overtime"/>:<div style={S.tblWrap}><table style={S.tbl}><thead><tr>{["Employee","Department","Manager","OT Hours","Requests"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead><tbody>{hoursSummary.map(r=>(<tr key={r.eid}><td style={S.td}><strong>{r.name}</strong></td><td style={S.td}>{r.dept}</td><td style={S.td}>{r.manager}</td><td style={{...S.td,fontWeight:700,textAlign:"center"}}>{r.hours}</td><td style={{...S.td,textAlign:"center"}}>{r.count}</td></tr>))}<tr style={{background:"#F1F5F9"}}><td colSpan={3} style={{...S.td,fontWeight:800}}>TOTAL</td><td style={{...S.td,fontWeight:800,textAlign:"center",color:"#059669"}}>{totalH} hrs</td><td style={{...S.td,fontWeight:700,textAlign:"center"}}>{hoursSummary.reduce((s,r)=>s+r.count,0)}</td></tr></tbody></table></div>}
      </div>}

      {tab === "people" && <div>
        <div style={{display:"flex",gap:10,marginBottom:20}}><button onClick={()=>{setShowAddEmp(!showAddEmp);setShowAddMgr(false);}} style={S.btnPrimary}>+ Add Employee</button><button onClick={()=>{setShowAddMgr(!showAddMgr);setShowAddEmp(false);}} style={{...S.btnPrimary,background:"#6366F1"}}>+ Add Manager</button></div>
        {showAddMgr && <div className="animate-fade-up" style={{...S.card,marginBottom:20}}><h3 style={S.cardTitle}>New Manager</h3><div style={S.g2}><Field label="Name"><input value={newMgr.name} onChange={e=>setNewMgr({...newMgr,name:e.target.value})} style={S.inp} placeholder="Full name"/></Field><Field label="Email"><input value={newMgr.email} onChange={e=>setNewMgr({...newMgr,email:e.target.value})} style={S.inp} placeholder="email@company.com"/></Field></div><Field label="Department"><select value={newMgr.department} onChange={e=>setNewMgr({...newMgr,department:e.target.value})} style={S.sel}><option value="">Select...</option>{DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Field><button onClick={handleAddMgr} style={S.btnPrimary}>Save Manager</button></div>}
        {showAddEmp && <div className="animate-fade-up" style={{...S.card,marginBottom:20}}><h3 style={S.cardTitle}>New Employee</h3><div style={S.g2}><Field label="Name"><input value={newEmp.name} onChange={e=>setNewEmp({...newEmp,name:e.target.value})} style={S.inp} placeholder="Full name"/></Field><Field label="Email"><input type="email" value={newEmp.email} onChange={e=>setNewEmp({...newEmp,email:e.target.value})} style={S.inp} placeholder="email@company.com"/></Field></div><div style={S.g2}><Field label="Department"><select value={newEmp.department} onChange={e=>setNewEmp({...newEmp,department:e.target.value})} style={S.sel}><option value="">Select...</option>{DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Field><Field label="Manager"><select value={newEmp.manager_id} onChange={e=>setNewEmp({...newEmp,manager_id:e.target.value})} style={S.sel}><option value="">Select...</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field></div><button onClick={handleAddEmp} style={S.btnPrimary}>Save Employee</button></div>}

        <h3 style={S.secTitle}>Managers ({managers.length})</h3>
        <input value={mgrSearch} onChange={e=>setMgrSearch(e.target.value)} placeholder="Search..." style={{...S.inp,marginBottom:10}} />
        <div style={S.tblWrap}><table style={S.tbl}><thead><tr>{["Name","Email","Department","Team","Actions"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead><tbody>{filteredMgrs.map(m=>(<tr key={m.id}><td style={S.td}><strong>{m.name}</strong></td><td style={S.td}>{m.email}</td><td style={S.td}>{m.department}</td><td style={{...S.td,textAlign:"center"}}>{employees.filter(e=>e.manager_id===m.id).length}</td><td style={{...S.td,textAlign:"center"}}><button onClick={()=>openEditMgr(m)} style={S.editBtn}>Edit</button><button onClick={()=>{if(confirm(`Remove ${m.name}?`))onDeleteManager(m.id);}} style={S.delBtn}>Remove</button></td></tr>))}</tbody></table></div>

        <h3 style={{...S.secTitle,marginTop:28}}>Employees ({employees.length})</h3>
        <input value={empSearch} onChange={e=>setEmpSearch(e.target.value)} placeholder="Search..." style={{...S.inp,marginBottom:10}} />
        <div style={S.tblWrap}><table style={S.tbl}><thead><tr>{["Name","Email","Department","Manager","Actions"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead><tbody>{filteredEmps.map(e=>{const mgr=managers.find(m=>m.id===e.manager_id);return(<tr key={e.id}><td style={S.td}><strong>{e.name}</strong></td><td style={S.td}>{e.email||"—"}</td><td style={S.td}>{e.department}</td><td style={S.td}>{mgr?.name||"—"}</td><td style={{...S.td,textAlign:"center"}}><button onClick={()=>openEditEmp(e)} style={S.editBtn}>Edit</button><button onClick={()=>{if(confirm(`Remove ${e.name}?`))onDeleteEmployee(e.id);}} style={S.delBtn}>Remove</button></td></tr>);})}</tbody></table></div>
      </div>}

      {tab === "all" && <div>
        <div style={{marginBottom:16}}><button onClick={exportAll} style={{...S.btnPrimary,background:"#059669"}}>Export CSV</button></div>
        <div style={S.tblWrap}><table style={S.tbl}><thead><tr>{["Employee","Dept","Manager","Date","Hours","Location","Reason","Status","Reviewed"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead><tbody>{requests.sort((a,b)=>b.created_at?.localeCompare(a.created_at)).map(r=>{const emp=employees.find(e=>e.id===r.employee_id);const mgr=managers.find(m=>m.id===emp?.manager_id);return(<tr key={r.id}><td style={S.td}><strong>{emp?.name}</strong></td><td style={S.td}>{emp?.department}</td><td style={S.td}>{mgr?.name}</td><td style={S.td}>{fmtShort(r.date)}</td><td style={{...S.td,fontWeight:700,textAlign:"center"}}>{r.hours}</td><td style={S.td}>{r.location||"—"}</td><td style={{...S.td,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.reason}</td><td style={S.td}><Badge status={r.status}/></td><td style={S.td}>{r.reviewed_at?fmtShort(r.reviewed_at):"—"}</td></tr>);})}</tbody></table></div>
      </div>}

      {tab === "settings" && <div>
        <div style={{...S.card,borderLeft:"4px solid #3B82F6"}}>
          <h3 style={S.cardTitle}>Email Notifications</h3>
          <p style={{fontSize:13,color:"#64748B",marginBottom:16}}>Send emails to managers when overtime is submitted. Uses EmailJS (free: 200/month).</p>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,padding:"12px 16px",background:emailConfig.enabled?"#DCFCE7":"#FEF2F2",borderRadius:10}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:14,fontWeight:600,color:emailConfig.enabled?"#166534":"#991B1B"}}>
              <input type="checkbox" checked={emailConfig.enabled} onChange={e=>onUpdateEmailConfig({...emailConfig,enabled:e.target.checked})} />
              {emailConfig.enabled?"Emails ON":"Emails OFF"}
            </label>
          </div>
          <div style={S.g3}>
            <Field label="Service ID"><input value={emailConfig.serviceId||""} onChange={e=>onUpdateEmailConfig({...emailConfig,serviceId:e.target.value})} placeholder="service_xxx" style={S.inp}/></Field>
            <Field label="Template ID"><input value={emailConfig.templateId||""} onChange={e=>onUpdateEmailConfig({...emailConfig,templateId:e.target.value})} placeholder="template_xxx" style={S.inp}/></Field>
            <Field label="Public Key"><input value={emailConfig.publicKey||""} onChange={e=>onUpdateEmailConfig({...emailConfig,publicKey:e.target.value})} placeholder="your_key" style={S.inp}/></Field>
          </div>
          <div style={{display:"flex",gap:20,marginBottom:16}}>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer"}}><input type="checkbox" checked={emailConfig.notifyManagerOnSubmit!==false} onChange={e=>onUpdateEmailConfig({...emailConfig,notifyManagerOnSubmit:e.target.checked})} /> Notify manager on new OT</label>
            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer"}}><input type="checkbox" checked={emailConfig.notifyEmployeeOnReview!==false} onChange={e=>onUpdateEmailConfig({...emailConfig,notifyEmployeeOnReview:e.target.checked})} /> Notify employee on review</label>
          </div>
          <div style={{marginTop:16,padding:16,background:"#F8FAFC",borderRadius:10,border:"1px solid #E2E8F0"}}>
            <h4 style={{fontSize:14,fontWeight:700,marginBottom:10}}>Setup Guide</h4>
            <div style={{fontSize:13,color:"#475569",lineHeight:1.8}}>
              <p><strong>1.</strong> Go to emailjs.com → create free account</p>
              <p><strong>2.</strong> Email Services → Add New → connect Gmail/Outlook → copy <strong>Service ID</strong></p>
              <p><strong>3.</strong> Email Templates → Create → use variables: {"{{to_email}}"}, {"{{subject}}"}, {"{{message}}"}, {"{{from_name}}"}</p>
              <p><strong>4.</strong> Copy <strong>Template ID</strong></p>
              <p><strong>5.</strong> Account → API Keys → copy <strong>Public Key</strong></p>
              <p><strong>6.</strong> Paste above and enable!</p>
            </div>
          </div>
        </div>
      </div>}
    </div>
  );
}

// ━━━━━ SHARED COMPONENTS ━━━━━
function Badge({ status }) { const s=STATUS[status]; return <span style={{background:s.bg,color:s.fg,border:`1px solid ${s.border}`,padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6,whiteSpace:"nowrap"}}>{status}</span>; }
function StatBox({ value, label, color, unit }) { return <div style={S.statCard}><span style={{fontSize:28,fontWeight:800,color,lineHeight:1,fontFamily:"'JetBrains Mono',monospace"}}>{value}{unit&&<span style={{fontSize:14,fontWeight:600,marginLeft:2}}>{unit}</span>}</span><span style={S.statLabel}>{label}</span></div>; }
function Field({ label, children }) { return <div style={{marginBottom:14}}><label style={S.lbl}>{label}</label>{children}</div>; }
function Empty({ text }) { return <p style={{color:"#94A3B8",fontSize:14,textAlign:"center",padding:"40px 20px"}}>{text}</p>; }
function EditModal({ title, children, onClose }) { return <div style={S.modalOverlay} onClick={onClose}><div style={S.modalBox} onClick={e=>e.stopPropagation()}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h3 style={{fontSize:18,fontWeight:700}}>{title}</h3><button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94A3B8"}}>✕</button></div><div style={{marginTop:20}}>{children}</div></div></div>; }

// ━━━━━ STYLES ━━━━━
const S = {
  inp:{width:"100%",padding:"9px 12px",border:"2px solid #E2E8F0",borderRadius:8,fontSize:14,background:"#fff",color:"#0F172A",boxSizing:"border-box"},
  sel:{width:"100%",padding:"9px 12px",border:"2px solid #E2E8F0",borderRadius:8,fontSize:14,background:"#fff",color:"#0F172A",marginBottom:16},
  lbl:{display:"block",fontSize:11,fontWeight:700,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:0.6},
  btnPrimary:{background:"#3B82F6",color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:14,fontWeight:600,cursor:"pointer"},
  btnGhost:{background:"#fff",color:"#475569",border:"2px solid #E2E8F0",borderRadius:8,padding:"9px 20px",fontSize:14,fontWeight:600,cursor:"pointer"},
  btnApprove:{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"},
  btnReject:{background:"#DC2626",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"},
  editBtn:{background:"none",border:"none",color:"#3B82F6",fontSize:12,fontWeight:600,cursor:"pointer",marginRight:8},
  delBtn:{background:"none",border:"none",color:"#EF4444",fontSize:12,fontWeight:600,cursor:"pointer"},
  topBar:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12},
  pageName:{fontSize:22,fontWeight:700,margin:0},
  pageMeta:{fontSize:13,color:"#64748B",margin:"2px 0 0"},
  alertPill:{background:"#FEF3C7",color:"#92400E",padding:"6px 16px",borderRadius:20,fontWeight:700,fontSize:13},
  stats3:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24},
  stats4:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24},
  statCard:{background:"#fff",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 4px rgba(0,0,0,0.05)",display:"flex",flexDirection:"column",alignItems:"center",gap:4},
  statLabel:{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:0.5,fontWeight:600,textAlign:"center"},
  tabBar:{display:"flex",gap:2,marginBottom:20,borderBottom:"2px solid #E2E8F0",flexWrap:"wrap"},
  tabBtn:{background:"none",border:"none",borderBottom:"2px solid transparent",padding:"10px 16px",fontSize:13,fontWeight:600,cursor:"pointer",color:"#64748B",marginBottom:-2},
  tabOn:{color:"#1D4ED8",borderBottomColor:"#3B82F6"},
  card:{background:"#fff",borderRadius:14,padding:"20px 24px",boxShadow:"0 1px 6px rgba(0,0,0,0.05)",marginBottom:12},
  cardTitle:{fontSize:15,fontWeight:700,margin:"0 0 16px"},
  secTitle:{fontSize:16,fontWeight:700,margin:"24px 0 12px"},
  stack:{display:"flex",flexDirection:"column",gap:10},
  rowBetween:{display:"flex",justifyContent:"space-between",alignItems:"center"},
  dateLabel:{fontSize:14,fontWeight:600,color:"#334155"},
  hoursLabel:{fontSize:16,fontWeight:700,color:"#0F172A",margin:"4px 0"},
  reasonText:{fontSize:13,color:"#475569",lineHeight:1.5,margin:"4px 0"},
  noteText:{fontSize:12,color:"#6366F1",fontStyle:"italic",margin:"6px 0 0"},
  metaText:{fontSize:11,color:"#94A3B8",marginTop:8},
  empNameText:{fontWeight:700,fontSize:15,marginRight:8},
  deptTag:{fontSize:11,color:"#64748B",background:"#F1F5F9",padding:"2px 8px",borderRadius:4},
  actionRow:{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"},
  bulkBar:{display:"flex",gap:10,alignItems:"center",padding:"10px 16px",background:"#EFF6FF",borderRadius:10,marginBottom:12},
  g2:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16},
  g3:{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16},
  tblWrap:{overflowX:"auto",borderRadius:12,boxShadow:"0 1px 6px rgba(0,0,0,0.05)"},
  tbl:{width:"100%",borderCollapse:"collapse",background:"#fff",fontSize:13},
  th:{textAlign:"left",padding:"10px 14px",background:"#F1F5F9",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:0.5,color:"#475569",borderBottom:"2px solid #E2E8F0"},
  td:{padding:"10px 14px",borderBottom:"1px solid #F8FAFC",fontSize:13},
  modalOverlay:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:20},
  modalBox:{background:"#fff",borderRadius:20,padding:"28px 32px",maxWidth:560,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)",maxHeight:"90vh",overflowY:"auto"},
};
