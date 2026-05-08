import { useState, useEffect, useCallback, useRef, Fragment } from "react";

// ─── Supabase config ──────────────────────────────────────────────────────────
const SB_URL = "https://oefdzhzhjvodfnlnuxli.supabase.co";
const SB_KEY = "sb_publishable_9oTcN6BLmjzHKb5fD7Lpug_JMCJ_apD";

const api = async (path, opts = {}) => {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// DB helpers
const db = {
  getSessions:     () => api("sessions?order=start_time.desc&select=*"),
  getReservations: () => api("reservations?order=start_time.asc&select=*"),
  getConfig:       (key) => api(`config?key=eq.${key}&select=value`).then(r => r?.[0]?.value),
  setConfig:       (key, value) => api(`config?key=eq.${key}`, {
    method: "PATCH", body: JSON.stringify({ value, updated_at: new Date().toISOString() })
  }),
  insertSession:   (s) => api("sessions", { method: "POST", body: JSON.stringify(toDb(s)) }),
  updateSession:   (id, patch) => api(`sessions?id=eq.${id}`, {
    method: "PATCH", body: JSON.stringify(patch), prefer: "return=minimal"
  }),
  insertReservation: (r) => api("reservations", { method: "POST", body: JSON.stringify(toDbRes(r)) }),
  deleteReservation: (id) => api(`reservations?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }),
};

// snake_case ↔ camelCase
const toDb = (s) => ({
  id: s.id, name: s.name, is_phd: s.isPhD, project: s.project,
  priority: s.priority, infra_type: s.infraType, partitions: s.partitions,
  server_id: s.serverId, job_type: s.jobType,
  gpu_count: s.gpuCount ? parseInt(s.gpuCount) : null,
  cpu_count: s.cpuCount ? parseInt(s.cpuCount) : null,
  mem_gb: s.memGB ? parseFloat(s.memGB) : null,
  start_time: s.startTime, planned_end: s.plannedEnd, end_time: s.endTime || null,
  description: s.description || null, slurm_job_id: s.slurmJobId || null,
  node: s.node || null, script_path: s.scriptPath || null, output_dir: s.outputDir || null,
});
const fromDb = (r) => ({
  id: r.id, name: r.name, isPhD: r.is_phd, project: r.project,
  priority: r.priority, infraType: r.infra_type, partitions: r.partitions || [],
  serverId: r.server_id, jobType: r.job_type,
  gpuCount: r.gpu_count, cpuCount: r.cpu_count, memGB: r.mem_gb,
  startTime: r.start_time, plannedEnd: r.planned_end, endTime: r.end_time,
  description: r.description, slurmJobId: r.slurm_job_id,
  node: r.node, scriptPath: r.script_path, outputDir: r.output_dir,
});
const toDbRes = (r) => ({
  id: r.id, name: r.name, is_phd: r.isPhD, project: r.project,
  infra_type: r.infraType, partitions: r.partitions, server_id: r.serverId,
  start_time: r.startTime, end_time: r.endTime,
  gpu_count: r.gpuCount ? parseInt(r.gpuCount) : null,
});
const fromDbRes = (r) => ({
  id: r.id, name: r.name, isPhD: r.is_phd, project: r.project,
  infraType: r.infra_type, partitions: r.partitions || [], serverId: r.server_id,
  startTime: r.start_time, endTime: r.end_time,
  gpuCount: r.gpu_count,
});

// ─── Constants ────────────────────────────────────────────────────────────────
const PHD_DEFAULT   = ["Yiqun Wang","Haoxuan","Xin","Ricky","Zhaowei Han","Dongliang","Adil","Kai","Binghan","Yuhan","Yijue"];
const PROJ_DEFAULT  = ["MAI-T1D","AGI","PanKGraph","GLKB","IGVF","Other"];
const PART_DEFAULT  = [
  {id:"drjieliu-a100",name:"a100",gpuTotal:6,hardware:"V100 32GB",note:"Shares nodes with v100"},
  {id:"drjieliu-h100",name:"h100",gpuTotal:8,hardware:"H100 80GB",note:""},
  {id:"drjieliu-l40s",name:"l40s",gpuTotal:8,hardware:"L40S 48GB",note:""},
  {id:"drjieliu-v100",name:"v100",gpuTotal:6,hardware:"V100 32GB",note:"Shares nodes with a100"},
  {id:"drjieliu-h200",name:"h200",gpuTotal:4,hardware:"H200 141GB",note:""},
];
const SRV_DEFAULT   = [
  {id:"s1",name:"lambda-01",gpu:"GPU 0",spec:"A100 80GB"},
  {id:"s2",name:"lambda-01",gpu:"GPU 1",spec:"A100 80GB"},
  {id:"s3",name:"lambda-01",gpu:"GPU 2",spec:"A100 80GB"},
  {id:"s4",name:"lambda-02",gpu:"GPU 0",spec:"RTX 4090"},
  {id:"s5",name:"lambda-02",gpu:"GPU 1",spec:"RTX 4090"},
  {id:"s6",name:"lambda-03",gpu:"GPU 0",spec:"V100 32GB"},
];

const PRIORITY_META = {
  low:     { label:"Low · can cancel", color:"#639922", bg:"#EAF3DE", text:"#27500A" },
  normal:  { label:"Normal",           color:"#378ADD", bg:"#E6F1FB", text:"#0C447C" },
  urgent:  { label:"Urgent",           color:"#BA7517", bg:"#FAEEDA", text:"#633806" },
  vurgent: { label:"Very urgent",      color:"#E24B4A", bg:"#FCEBEB", text:"#791F1F" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const now   = () => Date.now();
const uid   = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt   = (ts) => ts ? new Date(ts).toLocaleString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
const fmtDur = (ms) => {
  if (!ms || ms < 0) return "0m";
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const matchPhD = (name, roster) =>
  roster.some(r => r.toLowerCase().trim() === name.toLowerCase().trim());

function csvExport(sessions, servers) {
  const smap = Object.fromEntries(servers.map(s=>[s.id,`${s.name}/${s.gpu}`]));
  const rows = [["Name","PhD","Project","Priority","InfraType","Partition(s)","Server","JobType","GPUs","CPUs","MemGB","Start","End","Duration(min)","Description","SlurmJobID","Node"]];
  sessions.forEach(s => {
    const dur = s.endTime ? Math.round((s.endTime-s.startTime)/60000) : "";
    rows.push([s.name,s.isPhD?"Yes":"No",s.project,s.priority,s.infraType,
      (s.partitions||[]).join("+"),smap[s.serverId]||"",s.jobType,
      s.gpuCount||"",s.cpuCount||"",s.memGB||"",
      fmt(s.startTime),s.endTime?fmt(s.endTime):"Active",dur,
      s.description||"",s.slurmJobId||"",s.node||""]);
  });
  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download = `liulab_gpu_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ─── Small shared components ──────────────────────────────────────────────────
const inp = () => ({
  padding:"8px 10px", border:"0.5px solid var(--border)", borderRadius:8,
  background:"var(--bg)", color:"var(--fg)", fontSize:14, fontFamily:"inherit", outline:"none",
});

function Field({ label, children, noMargin }) {
  return (
    <div style={{marginBottom:noMargin?0:14}}>
      <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",
        color:"var(--muted2)",marginBottom:6}}>{label}</div>
      {children}
    </div>
  );
}
function Opt() {
  return <span style={{fontSize:10,fontWeight:400,textTransform:"none",letterSpacing:0,color:"var(--muted2)"}}>opt.</span>;
}
function PhdBadge({ show }) {
  if (!show) return null;
  return <span style={{fontSize:11,fontWeight:500,padding:"2px 7px",borderRadius:20,
    background:"#EEEDFE",color:"#3C3489",whiteSpace:"nowrap"}}>🎓 PhD</span>;
}
function PriBadge({ p }) {
  const m = PRIORITY_META[p]||PRIORITY_META.normal;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:500,
      padding:"2px 8px",borderRadius:20,background:m.bg,color:m.text,whiteSpace:"nowrap"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:m.color,display:"inline-block"}}/>
      {m.label}
    </span>
  );
}
function Spinner() {
  return <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:48,
    color:"var(--muted)",fontSize:13}}>Loading…</div>;
}
function ErrBanner({ msg }) {
  return <div style={{padding:"10px 14px",background:"#FCEBEB",color:"#791F1F",borderRadius:8,
    fontSize:12,marginBottom:16}}>⚠ {msg}</div>;
}

// ─── Check-in Modal ───────────────────────────────────────────────────────────
function CheckInModal({ roster, projects, partitions, servers, prefill, onConfirm, onCancel }) {
  const [name, setName]           = useState("");
  const [project, setProject]     = useState(projects[0]||"");
  const [priority, setPriority]   = useState("normal");
  const [infraType, setInfraType] = useState(prefill?.infraType||"slurm");
  const [selParts, setSelParts]   = useState(prefill?.partitions||[partitions[0]?.id||""]);
  const [serverId, setServerId]   = useState(prefill?.serverId||(servers[0]?.id||""));
  const [jobType, setJobType]     = useState("gpu");
  const [gpuCount, setGpuCount]   = useState(2);
  const [cpuCount, setCpuCount]   = useState("");
  const [memGB, setMemGB]         = useState("");
  const [duration, setDuration]   = useState(5);
  const [description, setDescription] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [slurmJobId, setSlurmJobId] = useState("");
  const [node, setNode]           = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState("");

  const isPhD    = matchPhD(name, roster);
  const pm       = PRIORITY_META[priority];
  const endTime  = now() + duration * 3600000;
  const canSubmit = name.trim() && (infraType==="slurm" ? selParts.length>0 : serverId)
    && (jobType!=="gpu" || (gpuCount>=1));

  const togglePart = (p) =>
    setSelParts(prev => prev.includes(p) ? prev.filter(x=>x!==p) : [...prev,p]);

  const handleConfirm = async () => {
    if (jobType === "gpu" && (!gpuCount || gpuCount < 1)) {
      setErr("GPU count must be at least 1"); return;
    }
    setSaving(true); setErr("");
    try {
      await onConfirm({
        id:uid(), name:name.trim(), isPhD, project, priority,
        infraType, partitions:selParts, serverId, jobType,
        gpuCount:gpuCount||null, cpuCount:cpuCount||null, memGB:memGB||null,
        startTime:now(), plannedEnd:endTime, endTime:null,
        description, slurmJobId, node, scriptPath, outputDir,
      });
    } catch(e) { setErr(e.message); setSaving(false); }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,
      display:"flex",alignItems:"flex-start",justifyContent:"center",
      padding:"24px 16px",overflowY:"auto"}}>
      <div style={{background:"var(--bg)",border:"0.5px solid var(--border)",
        borderRadius:16,padding:28,width:"100%",maxWidth:500}}>
        <div style={{fontSize:17,fontWeight:500,marginBottom:3}}>Check in</div>
        <div style={{fontSize:12,color:"var(--muted2)",marginBottom:14}}>Register your job — takes about 30 seconds</div>

        {err && <ErrBanner msg={err}/>}

        <Field label="Your name">
          <div style={{position:"relative"}}>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Kai Liu"
              style={{width:"100%",paddingRight:isPhD&&name?90:12,...inp()}}/>
            {isPhD && name && <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)"}}><PhdBadge show/></span>}
          </div>
        </Field>

        <Field label="Project">
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
            {projects.map(p=>(
              <button key={p} onClick={()=>setProject(p)} style={{
                padding:"7px 4px",fontSize:12,fontWeight:500,textAlign:"center",borderRadius:8,cursor:"pointer",
                border:`0.5px solid ${project===p?"#AFA9EC":"var(--border)"}`,
                background:project===p?"#EEEDFE":"var(--surface)",
                color:project===p?"#3C3489":"var(--muted)",transition:"all .1s"
              }}>{p}</button>
            ))}
          </div>
        </Field>

        <Field label="Priority">
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
            {Object.entries(PRIORITY_META).map(([k,m])=>(
              <button key={k} onClick={()=>setPriority(k)} style={{
                padding:"8px 4px",fontSize:11,fontWeight:500,textAlign:"center",lineHeight:1.4,
                borderRadius:8,cursor:"pointer",
                border:`0.5px solid ${priority===k?m.color:"var(--border)"}`,
                background:priority===k?m.bg:"var(--surface)",
                color:priority===k?m.text:"var(--muted)",transition:"all .1s"
              }}>
                <div style={{width:7,height:7,borderRadius:"50%",background:m.color,margin:"0 auto 4px"}}/>
                {k==="vurgent"?"Very urgent":k==="low"?<span>Low<br/><span style={{fontSize:10,fontWeight:400}}>can cancel</span></span>:m.label}
              </button>
            ))}
          </div>
        </Field>

        <div style={{height:1,background:"var(--border)",margin:"16px 0"}}/>

        <Field label="Resource type">
          <div style={{display:"flex",border:"0.5px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
            {["slurm","server"].map((t,i)=>(
              <button key={t} onClick={()=>setInfraType(t)} style={{
                flex:1,padding:"7px 6px",fontSize:12,fontWeight:500,textAlign:"center",cursor:"pointer",
                color:infraType===t?"#085041":"var(--muted)",
                background:infraType===t?"#E1F5EE":"var(--surface)",
                border:"none",borderRight:i===0?"0.5px solid var(--border)":"none",transition:"all .1s",
                fontFamily:"inherit"
              }}>{t==="slurm"?"Slurm cluster":"Independent server"}</button>
            ))}
          </div>
        </Field>

        {infraType==="slurm" ? (
          <Field label={<>Partition <span style={{fontSize:10,fontWeight:400,textTransform:"none",letterSpacing:0}}>(multi-select ok)</span></>}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
              {partitions.map(p=>(
                <button key={p.id} onClick={()=>togglePart(p.id)} style={{
                  padding:"6px 4px",textAlign:"center",fontSize:12,fontWeight:500,
                  fontFamily:"monospace",borderRadius:8,cursor:"pointer",
                  border:`0.5px solid ${selParts.includes(p.id)?"#AFA9EC":"var(--border)"}`,
                  background:selParts.includes(p.id)?"#EEEDFE":"var(--surface)",
                  color:selParts.includes(p.id)?"#3C3489":"var(--muted)",transition:"all .1s"
                }}>{p.name}</button>
              ))}
            </div>
            {selParts.length>0&&<div style={{fontSize:11,color:"var(--muted2)",marginTop:4}}>Selected: {selParts.join(", ")}</div>}
          </Field>
        ) : (
          <Field label="Server / GPU">
            <select value={serverId} onChange={e=>setServerId(e.target.value)} style={{width:"100%",...inp()}}>
              {servers.map(s=><option key={s.id} value={s.id}>{s.name} / {s.gpu} — {s.spec}</option>)}
            </select>
          </Field>
        )}

        <Field label="Job type">
          <div style={{display:"flex",border:"0.5px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
            {["gpu","cpu","memory"].map((t,i)=>(
              <button key={t} onClick={()=>setJobType(t)} style={{
                flex:1,padding:"7px 6px",fontSize:12,fontWeight:500,textAlign:"center",cursor:"pointer",
                color:jobType===t?"#085041":"var(--muted)",
                background:jobType===t?"#E1F5EE":"var(--surface)",
                border:"none",borderRight:i<2?"0.5px solid var(--border)":"none",
                transition:"all .1s",fontFamily:"inherit"
              }}>{t==="gpu"?"GPU":t==="cpu"?"CPU-only":"Memory-heavy"}</button>
            ))}
          </div>
        </Field>

        <div style={{display:"grid",gridTemplateColumns:jobType==="gpu"?"1fr 1fr 1fr":"1fr 1fr",gap:10,marginBottom:14}}>
          {jobType==="gpu"&&(
            <Field label="GPUs" noMargin>
              <input type="number" min={1} max={8} value={gpuCount}
                onChange={e=>setGpuCount(e.target.value)} style={{width:"100%",...inp()}}/>
            </Field>
          )}
          <Field label={<>CPUs {jobType==="gpu"&&<Opt/>}</>} noMargin>
            <input type="number" min={1} value={cpuCount}
              onChange={e=>setCpuCount(e.target.value)} placeholder="—" style={{width:"100%",...inp()}}/>
          </Field>
          <Field label={<>Mem GB {jobType==="gpu"&&<Opt/>}</>} noMargin>
            <input type="number" min={1} value={memGB}
              onChange={e=>setMemGB(e.target.value)} placeholder="—" style={{width:"100%",...inp()}}/>
          </Field>
        </div>

        <div style={{height:1,background:"var(--border)",margin:"16px 0"}}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <Field label="Duration (hrs)" noMargin>
            <input type="number" min={0.5} max={72} step={0.5} value={duration}
              onChange={e=>setDuration(parseFloat(e.target.value)||1)} style={{width:"100%",...inp()}}/>
          </Field>
          <Field label="Expected end" noMargin>
            <input readOnly value={fmt(endTime)}
              style={{width:"100%",...inp(),color:"var(--muted)",background:"var(--surface)"}}/>
          </Field>
        </div>

        <Field label="Description & comments">
          <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3}
            placeholder="What is this job? Notes for others — e.g. will finish early, OK to preempt, deadline context..."
            style={{width:"100%",resize:"vertical",padding:"8px 10px",fontSize:13,
              border:"0.5px solid var(--border)",borderRadius:8,
              background:"var(--bg)",color:"var(--fg)",fontFamily:"inherit",lineHeight:1.5}}/>
        </Field>

        <button onClick={()=>setShowExtra(x=>!x)} style={{
          display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--muted)",
          background:"none",border:"none",cursor:"pointer",padding:0,
          marginBottom:showExtra?12:20,fontFamily:"inherit"
        }}>
          <span style={{fontSize:10,display:"inline-block",transition:"transform .15s",
            transform:showExtra?"rotate(90deg)":"none"}}>▶</span>
          {showExtra?"Hide details":"Add more details"}
        </button>

        {showExtra&&(
          <div style={{marginBottom:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <Field label={<>Slurm job ID <Opt/></>} noMargin>
                <input value={slurmJobId} onChange={e=>setSlurmJobId(e.target.value)}
                  placeholder="e.g. 1048576" style={{width:"100%",...inp(),fontFamily:"monospace"}}/>
              </Field>
              <Field label={<>Node <Opt/></>} noMargin>
                <input value={node} onChange={e=>setNode(e.target.value)}
                  placeholder="e.g. gl3072" style={{width:"100%",...inp(),fontFamily:"monospace"}}/>
              </Field>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Field label={<>Script path <Opt/></>} noMargin>
                <input value={scriptPath} onChange={e=>setScriptPath(e.target.value)}
                  placeholder="/nfs/turbo/…" style={{width:"100%",...inp(),fontFamily:"monospace",fontSize:12}}/>
              </Field>
              <Field label={<>Output dir <Opt/></>} noMargin>
                <input value={outputDir} onChange={e=>setOutputDir(e.target.value)}
                  placeholder="/nfs/turbo/…" style={{width:"100%",...inp(),fontFamily:"monospace",fontSize:12}}/>
              </Field>
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"10px 0",fontSize:13,fontWeight:500,
            borderRadius:8,border:"0.5px solid var(--border)",background:"var(--surface)",
            color:"var(--muted)",cursor:"pointer"}}>Cancel</button>
          <button disabled={!canSubmit||saving} onClick={handleConfirm} style={{
            flex:2,padding:"10px 0",fontSize:13,fontWeight:500,borderRadius:8,
            cursor:canSubmit&&!saving?"pointer":"not-allowed",
            border:`0.5px solid ${canSubmit?pm.color:"var(--border)"}`,
            background:canSubmit?pm.bg:"var(--surface)",
            color:canSubmit?pm.text:"var(--muted)",transition:"all .15s"
          }}>{saving?"Saving…":"Confirm check in"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Conflict detection helpers ──────────────────────────────────────────────
function timeOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function checkConflicts(infraType, selParts, serverId, startTs, endTs, gpuCount, reservations, partitions) {
  const warnings = [];
  if (infraType === "slurm") {
    selParts.forEach(partId => {
      const part = partitions.find(p => p.id === partId);
      const total = part?.gpuTotal || null;
      const overlapping = reservations.filter(r =>
        r.infraType === "slurm" &&
        (r.partitions || []).includes(partId) &&
        timeOverlap(startTs, endTs, r.startTime, r.endTime)
      );
      if (overlapping.length > 0) {
        const reservedGPUs = overlapping.reduce((sum, r) => sum + (parseInt(r.gpuCount) || 0), 0);
        const requested = parseInt(gpuCount) || 0;
        if (total && requested > 0 && reservedGPUs + requested > total) {
          warnings.push(`Partition ${partId}: ${reservedGPUs} GPUs already reserved in this window — adding your ${requested} would exceed the total of ${total}.`);
        } else if (requested === 0) {
          warnings.push(`Partition ${partId}: ${overlapping.length} existing reservation(s) overlap this window. Fill in GPU count for capacity check.`);
        } else {
          warnings.push(`Partition ${partId}: ${overlapping.length} existing reservation(s) overlap — ${reservedGPUs} GPUs already reserved out of ${total||"?"} total.`);
        }
      }
    });
  } else {
    const overlapping = reservations.filter(r =>
      r.infraType === "server" &&
      r.serverId === serverId &&
      timeOverlap(startTs, endTs, r.startTime, r.endTime)
    );
    if (overlapping.length > 0) {
      warnings.push(`This server/GPU already has ${overlapping.length} reservation(s) in this time window: ${overlapping.map(r => r.name).join(", ")}.`);
    }
  }
  return warnings;
}

// ─── Reservation Modal ────────────────────────────────────────────────────────
function ReserveModal({ roster, projects, partitions, servers, reservations, prefill, onConfirm, onCancel }) {
  const [name, setName]           = useState("");
  const [project, setProject]     = useState(projects[0]||"");
  const [infraType, setInfraType] = useState(prefill?.infraType||"slurm");
  const [selParts, setSelParts]   = useState(prefill?.partitions||[partitions[0]?.id||""]);
  const [serverId, setServerId]   = useState(prefill?.serverId||(servers[0]?.id||""));
  const locked = !!prefill?.lockFields;
  const [gpuCount, setGpuCount]   = useState(locked ? (prefill?.gpuCount?.toString()||"1") : "");
  const [dateStr, setDateStr]     = useState(prefill?.startDate || new Date().toISOString().slice(0,10));
  const [timeStr, setTimeStr]     = useState(prefill?.startTime || "09:00");
  const [duration, setDuration]   = useState(locked ? (prefill?.duration||1) : 4);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState("");
  const isPhD   = matchPhD(name, roster);
  const startTs = new Date(`${dateStr}T${timeStr}`).getTime();
  const endTs   = startTs + duration * 3600000;

  const conflicts = (dateStr && timeStr && duration)
    ? checkConflicts(infraType, selParts, serverId, startTs, endTs, gpuCount, reservations, partitions)
    : [];

  const handleConfirm = async () => {
    if (!gpuCount || parseInt(gpuCount) < 1) {
      setErr("GPU count must be at least 1"); return;
    }
    setSaving(true); setErr("");
    try {
      await onConfirm({
        id:uid(), name:name.trim(), isPhD, project, infraType,
        partitions:selParts, serverId, gpuCount: gpuCount || null,
        startTime:startTs, endTime:endTs,
      });
    } catch(e) { setErr(e.message); setSaving(false); }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg)",border:"0.5px solid var(--border)",
        borderRadius:16,padding:28,width:"100%",maxWidth:440}}>
        <div style={{fontSize:17,fontWeight:500,marginBottom:3}}>Reserve slot</div>
        <div style={{fontSize:12,color:"var(--muted2)",marginBottom:22}}>Book a future time slot</div>
        {err&&<ErrBanner msg={err}/>}

        <Field label="Your name">
          <div style={{position:"relative"}}>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Kai Liu"
              style={{width:"100%",paddingRight:isPhD&&name?90:12,...inp()}}/>
            {isPhD&&name&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)"}}><PhdBadge show/></span>}
          </div>
        </Field>
        <Field label="Project">
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
            {projects.map(p=>(
              <button key={p} onClick={()=>setProject(p)} style={{
                padding:"6px 4px",fontSize:12,fontWeight:500,textAlign:"center",borderRadius:8,cursor:"pointer",
                border:`0.5px solid ${project===p?"#AFA9EC":"var(--border)"}`,
                background:project===p?"#EEEDFE":"var(--surface)",
                color:project===p?"#3C3489":"var(--muted)"
              }}>{p}</button>
            ))}
          </div>
        </Field>
        {!locked && (
          <Field label="Resource type">
            <div style={{display:"flex",border:"0.5px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
              {["slurm","server"].map((t,i)=>(
                <button key={t} onClick={()=>setInfraType(t)} style={{
                  flex:1,padding:"7px 6px",fontSize:12,fontWeight:500,textAlign:"center",cursor:"pointer",
                  color:infraType===t?"#085041":"var(--muted)",
                  background:infraType===t?"#E1F5EE":"var(--surface)",
                  border:"none",borderRight:i===0?"0.5px solid var(--border)":"none",fontFamily:"inherit"
                }}>{t==="slurm"?"Slurm cluster":"Independent server"}</button>
              ))}
            </div>
          </Field>
        )}
        {locked ? (
          <Field label="Partition">
            <div style={{
              display:"flex", alignItems:"center", gap:8,
              padding:"8px 12px", borderRadius:8,
              background:"var(--surface)", border:"0.5px solid var(--border)",
            }}>
              <span style={{
                fontSize:13, fontWeight:600, fontFamily:"monospace",
                color: HEATMAP_COLORS[selParts[0]]?.hex || "var(--fg)",
              }}>
                {partitions.find(p=>p.id===selParts[0])?.name || selParts[0]}
              </span>
              <span style={{fontSize:11, color:"var(--muted2)"}}>— from selection</span>
            </div>
          </Field>
        ) : infraType==="slurm" ? (
          <Field label="Partition">
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
              {partitions.map(p=>(
                <button key={p.id} onClick={()=>setSelParts(prev=>prev.includes(p.id)?prev.filter(x=>x!==p.id):[...prev,p.id])} style={{
                  padding:"6px 4px",textAlign:"center",fontSize:12,fontWeight:500,fontFamily:"monospace",
                  borderRadius:8,cursor:"pointer",
                  border:`0.5px solid ${selParts.includes(p.id)?"#AFA9EC":"var(--border)"}`,
                  background:selParts.includes(p.id)?"#EEEDFE":"var(--surface)",
                  color:selParts.includes(p.id)?"#3C3489":"var(--muted)"
                }}>{p.name}</button>
              ))}
            </div>
          </Field>
        ):(
          <Field label="Server / GPU">
            <select value={serverId} onChange={e=>setServerId(e.target.value)} style={{width:"100%",...inp()}}>
              {servers.map(s=><option key={s.id} value={s.id}>{s.name}/{s.gpu} — {s.spec}</option>)}
            </select>
          </Field>
        )}
        <div style={{display:"grid",gridTemplateColumns:"2fr 1.4fr 0.8fr 0.8fr",gap:8}}>
          <Field label="Date" noMargin>
            <input type="date" value={dateStr} min={new Date().toISOString().slice(0,10)}
              onChange={e=>setDateStr(e.target.value)} style={{width:"100%",...inp(),padding:"8px 6px",fontSize:13}}/>
          </Field>
          <Field label="Time" noMargin>
            <input type="time" value={timeStr} onChange={e=>setTimeStr(e.target.value)} style={{width:"100%",...inp(),padding:"8px 6px",fontSize:13}}/>
          </Field>
          <Field label="Hours" noMargin>
            {locked ? (
              <div style={{width:"100%", padding:"8px 6px", fontSize:13, border:"0.5px solid var(--border)", borderRadius:8, background:"var(--surface)", color:"var(--muted2)", textAlign:"center", userSelect:"none", boxSizing:"border-box"}}>{duration} h</div>
            ) : (
              <input type="number" min={0.5} max={48} step={0.5} value={duration}
                onChange={e=>setDuration(parseFloat(e.target.value)||1)} style={{width:"100%",...inp(),padding:"8px 6px",fontSize:13}}/>
            )}
          </Field>
          <Field label="GPU no." noMargin>
            {locked ? (
              <div style={{width:"100%", padding:"8px 6px", fontSize:13, border:"0.5px solid var(--border)", borderRadius:8, background:"var(--surface)", color:"var(--muted2)", textAlign:"center", userSelect:"none", boxSizing:"border-box"}}>{gpuCount}</div>
            ) : (
              <input type="number" min={1} max={64} value={gpuCount}
                onChange={e=>setGpuCount(e.target.value)} placeholder="—" style={{width:"100%",...inp(),padding:"8px 6px",fontSize:13}}/>
            )}
          </Field>
        </div>

        {/* Conflict warnings */}
        {conflicts.length > 0 && (
          <div style={{
            marginTop:14, padding:"10px 14px",
            background:"#FAEEDA", border:"0.5px solid #EF9F27",
            borderRadius:8, display:"flex", flexDirection:"column", gap:6
          }}>
            <div style={{fontSize:12,fontWeight:500,color:"#633806",display:"flex",alignItems:"center",gap:6}}>
              <span>⚠</span> Potential conflict detected
            </div>
            {conflicts.map((w,i)=>(
              <div key={i} style={{fontSize:12,color:"#633806",lineHeight:1.5}}>{w}</div>
            ))}
            <div style={{fontSize:11,color:"#854F0B",marginTop:2}}>
              You can still submit — this system operates on an honor system. Please coordinate with the people listed above.
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:16}}>
          <button onClick={onCancel} style={{flex:1,padding:"9px 0",fontSize:13,fontWeight:500,
            borderRadius:8,border:"0.5px solid var(--border)",background:"var(--surface)",
            color:"var(--muted)",cursor:"pointer"}}>Cancel</button>
          <button disabled={!name.trim()||saving} onClick={handleConfirm} style={{
            flex:2,padding:"9px 0",fontSize:13,fontWeight:500,borderRadius:8,cursor:"pointer",
            border:`0.5px solid ${name.trim() ? (conflicts.length>0 ? "#EF9F27" : "#AFA9EC") : "var(--border)"}`,
            background:name.trim() ? (conflicts.length>0 ? "#FAEEDA" : "#EEEDFE") : "var(--surface)",
            color:name.trim() ? (conflicts.length>0 ? "#633806" : "#3C3489") : "var(--muted)"
          }}>{saving?"Saving…": conflicts.length>0 ? "Reserve anyway" : "Reserve"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Resource card ────────────────────────────────────────────────────────────
// hideCheckin=true  → partition cards: always show Reserve, no Check in
// hideCheckin=false → server cards:   show Check in + Reserve when free (original)
function ResourceCard({ title, titleMono, hardware, note, gpuTotal, status, jobs, upcoming, onCheckin, onReserve, onCheckout, hideCheckin, partitionColor }) {
  const S = {
    free: { dot:"#22c55e", label:"Free",     border:"var(--border)", bg:"var(--bg)" },
    busy: { dot:"#f97316", label:"In use",   border:"#fed7aa",       bg:"#fff7ed"  },
    over: { dot:"#ef4444", label:"Overtime", border:"#fca5a5",       bg:"#fef2f2"  },
  };
  const s = S[status];
  const usedGPU = jobs.reduce((a,j)=>a+(parseInt(j.gpuCount)||0),0);
  const pct = gpuTotal ? Math.min(Math.round((usedGPU/gpuTotal)*100),100) : 0;
  // When a partitionColor is provided, override bg/border with a tinted variant
  const cardBg     = partitionColor && status === "free" ? `${partitionColor}0D` : s.bg;
  const cardBorder = partitionColor ? `${partitionColor}55` : s.border;
  const barColor   = partitionColor || (pct>=100?"#ef4444":pct>=75?"#f97316":"#AFA9EC");

  return (
    <div style={{
      background: cardBg,
      border: `0.5px solid ${cardBorder}`,
      borderLeft: partitionColor ? `3px solid ${partitionColor}` : `0.5px solid ${cardBorder}`,
      borderRadius:12, padding:"14px 16px",
      boxShadow: status==="over" ? "0 0 0 2px #fca5a580" : "none",
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:gpuTotal?6:8}}>
        <div>
          <div style={{fontSize:14,fontWeight:500,fontFamily:titleMono?"monospace":"inherit",color:partitionColor||"var(--fg)"}}>{title}</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3,flexWrap:"wrap"}}>
            {hardware && (
              <span style={{fontFamily:"monospace",background:"var(--surface)",
                border:"0.5px solid var(--border)",borderRadius:4,
                padding:"1px 5px",fontSize:11,color:"var(--muted)"}}>
                {hardware}
              </span>
            )}
          </div>
          {note && (
            <div style={{fontSize:10,color:"var(--muted2)",marginTop:3,fontStyle:"italic"}}>
              {note}
            </div>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:s.dot}}/>
          <span style={{fontSize:11,fontWeight:500,color:s.dot}}>{s.label}</span>
        </div>
      </div>

      {/* GPU usage bar */}
      {gpuTotal!=null && (
        <div style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:11,color:"var(--muted2)"}}>GPU usage</span>
            <span style={{fontSize:11,fontWeight:500,color:"var(--muted)"}}>
              {usedGPU} / {gpuTotal}
            </span>
          </div>
          <div style={{background:"var(--surface)",borderRadius:4,height:5,overflow:"hidden"}}>
            <div style={{
              width:`${pct}%`,height:"100%",borderRadius:4,transition:"width .3s",
              background: barColor
            }}/>
          </div>
        </div>
      )}

      {jobs.map(j=>(
        <div key={j.id} style={{marginBottom:8,padding:"8px 10px",background:"rgba(0,0,0,.04)",borderRadius:8}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:500}}>{j.name}</span>
            <PhdBadge show={j.isPhD}/>
            <PriBadge p={j.priority}/>
          </div>
          <div style={{fontSize:11,color:"var(--muted)"}}>
            {j.project} · {fmtDur(now()-j.startTime)} elapsed
            {j.gpuCount&&` · ${j.gpuCount} GPU`}
          </div>
          {j.plannedEnd&&now()>j.plannedEnd&&(
            <div style={{fontSize:11,color:"#ef4444",marginTop:2}}>
              ⚠ Overtime by {fmtDur(now()-j.plannedEnd)}
            </div>
          )}
          {j.description&&(
            <div style={{fontSize:11,color:"var(--muted2)",marginTop:2,fontStyle:"italic",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:240}}>
              "{j.description}"
            </div>
          )}
          <button onClick={()=>onCheckout(j.id)} style={{
            marginTop:8,padding:"4px 12px",fontSize:11,fontWeight:500,
            background:"#ef4444",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"
          }}>Check out</button>
        </div>
      ))}

      {/* Upcoming reservation notice */}
      {upcoming && jobs.length === 0 && (
        <div style={{fontSize:11,color:"#534AB7",marginBottom:8}}>
          📅 {upcoming.name} at {fmt(upcoming.startTime)}
        </div>
      )}

      {/* Action buttons */}
      {hideCheckin ? (
        // Partition card: always show Reserve
        <button onClick={onReserve} style={{
          width:"100%", padding:"6px 0", fontSize:12, fontWeight:500,
          borderRadius:7, border:"0.5px solid var(--border)",
          background:"var(--surface)", color:"var(--muted)", cursor:"pointer",
          marginTop: jobs.length > 0 ? 8 : 0,
        }}>Reserve</button>
      ) : (
        // Server card: show both when free
        jobs.length === 0 && (
          <div style={{display:"flex",gap:6}}>
            <button onClick={onCheckin} style={{flex:2,padding:"6px 0",fontSize:12,fontWeight:500,
              borderRadius:7,border:"0.5px solid #AFA9EC",background:"#EEEDFE",color:"#3C3489",cursor:"pointer"}}>
              Check in
            </button>
            <button onClick={onReserve} style={{flex:1,padding:"6px 0",fontSize:12,fontWeight:500,
              borderRadius:7,border:"0.5px solid var(--border)",background:"var(--surface)",
              color:"var(--muted)",cursor:"pointer"}}>Reserve</button>
          </div>
        )
      )}
    </div>
  );
}

// ─── Heatmap Calendar ────────────────────────────────────────────────────────
const HEATMAP_COLORS = {
  // full-prefix variants
  "drjieliu-a100": { hex:"#EF4444" },
  "drjieliu-h100": { hex:"#3B82F6" },
  "drjieliu-l40s": { hex:"#F59E0B" },
  "drjieliu-v100": { hex:"#A855F7" },
  "drjieliu-h200": { hex:"#22C55E" },
  // short-name variants (actual DB IDs)
  "a100": { hex:"#EF4444" }, // red
  "h100": { hex:"#3B82F6" }, // blue
  "l40s": { hex:"#F59E0B" }, // amber
  "v100": { hex:"#A855F7" }, // purple
  "h200": { hex:"#22C55E" }, // green
};

function HeatmapCalendar({ reservations, partitions, onDeleteReservation, onReserve }) {
  const [dayOffset, setDayOffset]         = useState(0);
  const [popup, setPopup]                 = useState(null); // { partId, hour, x, y }
  const [cancelConfirm, setCancelConfirm] = useState(null); // { hrs, partId, hour }
  const [drag, setDrag]                   = useState(null); // { partId, startH, startG, curH, curG, x, y, filled }
  const dragRef                            = useRef(null);

  // Drag bounds helper
  const dragBounds = drag ? {
    partId: drag.partId,
    minH: Math.min(drag.startH, drag.curH), maxH: Math.max(drag.startH, drag.curH),
    minG: Math.min(drag.startG, drag.curG), maxG: Math.max(drag.startG, drag.curG),
  } : null;
  const inDragSel = (partId, h, ri) => {
    if (!dragBounds || dragBounds.partId !== partId) return false;
    return h >= dragBounds.minH && h <= dragBounds.maxH && ri >= dragBounds.minG && ri <= dragBounds.maxG;
  };

  const GPU_ROW_H_MIN = 18;
  const PART_LABEL_W  = 78;
  const GPU_LABEL_W   = 30;
  const HOUR_COL_W    = 40;
  const HEADER_H      = 44;

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Close popup on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setPopup(null); setCancelConfirm(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const displayDate = new Date();
  displayDate.setDate(displayDate.getDate() + dayOffset);
  displayDate.setHours(0, 0, 0, 0);
  const dayStart = displayDate.getTime();
  const dayEnd   = dayStart + 86400000;
  const isToday  = dayOffset === 0;
  const dateLabel = `${MONTH_NAMES[displayDate.getMonth()]} ${String(displayDate.getDate()).padStart(2,"0")} ${displayDate.getFullYear()}`;

  // Reservations touching this day (slurm only)
  const dayRes = reservations.filter(r =>
    r.infraType === "slurm" && r.startTime < dayEnd && r.endTime > dayStart
  );

  const getReservedCount = (partId, hour) => {
    const hStart = dayStart + hour * 3600000;
    const hEnd   = hStart + 3600000;
    return dayRes
      .filter(r => (r.partitions||[]).includes(partId) && r.startTime < hEnd && r.endTime > hStart)
      .reduce((sum, r) => sum + (parseInt(r.gpuCount)||0), 0);
  };

  const getHourRes = (partId, hour) => {
    const hStart = dayStart + hour * 3600000;
    const hEnd   = hStart + 3600000;
    return dayRes.filter(r =>
      (r.partitions||[]).includes(partId) && r.startTime < hEnd && r.endTime > hStart
    );
  };

  // Compute absolute grid rows per partition (1-indexed; row 1 = header)
  let rowCursor = 2;
  const partRows = partitions.map(p => {
    const rowStart = rowCursor;
    rowCursor += (p.gpuTotal || 0);
    return { ...p, rowStart, rowEnd: rowCursor };
  });
  const totalDataRows = rowCursor - 2;

  // CSS-only fill: minmax lets rows shrink to GPU_ROW_H_MIN but stretch via 1fr to fill height
  const gridTemplateColumns = `${PART_LABEL_W}px ${GPU_LABEL_W}px repeat(24, ${HOUR_COL_W}px)`;
  const gridTemplateRows    = `${HEADER_H}px repeat(${totalDataRows}, minmax(${GPU_ROW_H_MIN}px, 1fr))`;
  const gridTotalW          = PART_LABEL_W + GPU_LABEL_W + 24 * HOUR_COL_W;

  // Hour range label (24h)
  const fmtHourRange = (h) =>
    `${String(h).padStart(2,"0")}:00 – ${String(h + 1).padStart(2,"0")}:00`;

  const navBtn = (label, fn) => (
    <button onClick={fn} style={{
      padding:"3px 10px", fontSize:14, lineHeight:1, fontWeight:400,
      borderRadius:6, border:"0.5px solid var(--border)",
      background:"var(--bg)", color:"var(--muted)", cursor:"pointer",
      fontFamily:"inherit",
    }}>{label}</button>
  );

  return (
    <div
      style={{
        display:"flex", flexDirection:"column",
        background:"var(--bg)", border:"0.5px solid var(--border)",
        borderRadius:12, overflow:"hidden",
        height:"calc(100vh - 88px)",
      }}
      onClick={() => setPopup(null)}
    >
      {/* ── Title / day navigation ── */}
      <div style={{
        padding:"8px 14px", borderBottom:"0.5px solid var(--border)",
        background:"var(--surface)", flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{fontSize:13, fontWeight:500}}>GPU Reservation Heatmap</div>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          {navBtn("‹", () => setDayOffset(x => x - 1))}
          <div style={{
            fontSize:12, fontWeight:600,
            color: isToday ? "#3C3489" : "var(--fg)",
            minWidth:108, textAlign:"center", userSelect:"none",
            padding:"3px 10px", borderRadius:6,
            background: isToday ? "#EEEDFE" : "transparent",
          }}>{dateLabel}</div>
          {navBtn("›", () => setDayOffset(x => x + 1))}
          {dayOffset !== 0 && (
            <button onClick={() => setDayOffset(0)} style={{
              padding:"3px 9px", fontSize:11, fontWeight:500,
              borderRadius:6, border:"0.5px solid #AFA9EC",
              background:"#EEEDFE", color:"#3C3489", cursor:"pointer",
              fontFamily:"inherit",
            }}>Today</button>
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{
        padding:"6px 14px", borderBottom:"0.5px solid var(--border)",
        background:"var(--surface)", flexShrink:0,
        display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
      }}>
        <span style={{fontSize:10, fontWeight:500, textTransform:"uppercase",
          letterSpacing:".05em", color:"var(--muted2)"}}>Legend</span>
        {partitions.map(p => {
          const c = HEATMAP_COLORS[p.id] || { hex:"#999" };
          return (
            <div key={p.id} style={{display:"flex", alignItems:"center", gap:5}}>
              <div style={{width:12, height:12, borderRadius:2, background:c.hex}}/>
              <span style={{fontSize:11, fontWeight:600, fontFamily:"monospace",
                color:"var(--muted)"}}>{p.name}</span>
              <span style={{fontSize:10, color:"var(--muted2)"}}>×{p.gpuTotal}</span>
            </div>
          );
        })}
        <div style={{
          marginLeft:"auto", display:"flex", alignItems:"center",
          gap:3, fontSize:10, color:"var(--muted2)",
        }}>
          <span>0</span>
          {[0.15, 0.35, 0.6, 0.8, 1.0].map((op, i) => (
            <div key={i} style={{
              width:13, height:13, borderRadius:2,
              background:`rgba(120,120,120,${op})`,
            }}/>
          ))}
          <span>full</span>
        </div>
      </div>

      {/* ── Heatmap grid ── */}
      <div style={{flex:1, overflow:"auto", display:"flex", flexDirection:"column"}}
        onMouseUp={() => {
          if (!dragRef.current) return;
          const { partId, startH, startG, curH, curG } = dragRef.current;
          const minH = Math.min(startH, curH), maxH = Math.max(startH, curH);
          const minG = Math.min(startG, curG), maxG = Math.max(startG, curG);
          dragRef.current = null;
          setDrag(null);

          if (minH === maxH && minG === maxG) {
            // Single click — cell's onClick handles popup
            return;
          }

          // Drag selection → ReserveModal
          const gpuCount = maxG - minG + 1;
          const dur = maxH - minH + 1;
          if (gpuCount < 1 || dur < 1) return;
          const isoDate = new Date(dayStart).toISOString().slice(0, 10);
          const startTime = `${String(minH).padStart(2, "0")}:00`;
          onReserve({ infraType: "slurm", partitions: [partId], startDate: isoDate, startTime, gpuCount, duration: dur, lockFields: true });
        }}
        onMouseLeave={() => { dragRef.current = null; setDrag(null); }}
      >
        <div style={{
          display:"grid",
          gridTemplateColumns,
          gridTemplateRows,
          width: gridTotalW,
          minHeight:"100%",
          flexShrink:0,
          userSelect:"none",
        }}>

          {/* Header: corner cells + 24 hour labels */}
          <div style={{
            gridRow:1, gridColumn:1,
            position:"sticky", top:0, left:0, zIndex:32,
            background:"var(--surface)",
            borderRight:"0.5px solid var(--border)",
            borderBottom:"0.5px solid var(--border)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:9, color:"var(--muted2)", textTransform:"uppercase", letterSpacing:".04em",
          }}>Partition</div>
          <div style={{
            gridRow:1, gridColumn:2,
            position:"sticky", top:0, left:PART_LABEL_W, zIndex:31,
            background:"var(--surface)",
            borderRight:"0.5px solid var(--border)",
            borderBottom:"0.5px solid var(--border)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:9, color:"var(--muted2)", textTransform:"uppercase", letterSpacing:".04em",
          }}>GPU</div>
          {Array.from({length:24}, (_, h) => (
            <div key={h} style={{
              gridRow:1, gridColumn: 3 + h,
              position:"sticky", top:0, zIndex:30,
              background:"var(--surface)",
              borderLeft:"0.5px solid var(--border)",
              borderBottom:"0.5px solid var(--border)",
              display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center",
              fontSize:9, color:"var(--muted2)", lineHeight:1.4, userSelect:"none",
            }}>
              <span style={{fontWeight:700}}>{String(h).padStart(2,"0")}:00</span>
              <span style={{opacity:0.7}}>{h < 12 ? "AM" : "PM"}</span>
            </div>
          ))}

          {/* Data rows */}
          {partRows.flatMap(p => {
            const color   = HEATMAP_COLORS[p.id] || { hex:"#888" };
            const gpuList = Array.from({length: p.gpuTotal || 0}, (_, i) => i);
            const isFirstPart = p.rowStart === 2;
            const partTopBorder = isFirstPart ? "none" : `1.5px solid ${color.hex}66`;

            return [
              // ── Partition label cell (spans all GPU rows for this partition) ──
              <div key={`lbl-${p.id}`} style={{
                gridRow: `${p.rowStart} / ${p.rowEnd}`,
                gridColumn: 1,
                position:"sticky", left:0, zIndex:20,
                background: `${color.hex}14`,
                borderRight:"0.5px solid var(--border)",
                borderTop: partTopBorder,
                display:"flex", flexDirection:"column",
                alignItems:"center", justifyContent:"center", gap:3,
                boxSizing:"border-box",
              }}>
                <div style={{
                  fontSize:11, fontWeight:700, fontFamily:"monospace",
                  color: color.hex, textAlign:"center", lineHeight:1.2,
                }}>{p.name}</div>
                <div style={{
                  fontSize:9, color:"var(--muted2)", textAlign:"center",
                }}>×{p.gpuTotal}</div>
              </div>,

              // ── Per-GPU rows ──
              ...gpuList.flatMap(ri => {
                const isFirstRow = ri === 0;
                const isLastRow  = ri === gpuList.length - 1;
                const absRow     = p.rowStart + ri;
                const rowTopBorder = isFirstRow ? partTopBorder : "0.5px solid rgba(0,0,0,0.05)";
                const rowBotBorder = isLastRow  ? "0.5px solid var(--border)" : "none";

                return [
                  // GPU index label
                  <div key={`gpu-${p.id}-${ri}`} style={{
                    gridRow: absRow, gridColumn: 2,
                    position:"sticky", left: PART_LABEL_W, zIndex:19,
                    background:"var(--surface)",
                    borderRight:"0.5px solid var(--border)",
                    borderTop: rowTopBorder, borderBottom: rowBotBorder,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    boxSizing:"border-box",
                    fontSize:9, color:"var(--muted2)", fontFamily:"monospace",
                  }}>G{ri + 1}</div>,

                  // 24 hour cells
                  ...Array.from({length:24}, (_, h) => {
                    const reserved = getReservedCount(p.id, h);
                    const clamped  = Math.min(reserved, p.gpuTotal);
                    const filled   = ri < clamped;

                    const isSelected = popup?.partId === p.id && popup?.hour === h && popup?.ri === ri;
                    const isDragged  = inDragSel(p.id, h, ri);

                    return (
                      <div
                        key={`cell-${p.id}-${ri}-${h}`}
                        onMouseDown={e => {
                          const d = { partId: p.id, startH: h, startG: ri, curH: h, curG: ri };
                          dragRef.current = d;
                          setDrag(d);
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const popupW = 226;
                          const xPos = rect.right + popupW > window.innerWidth
                            ? rect.left - popupW - 4
                            : rect.right + 4;
                          const yPos = Math.min(rect.top, window.innerHeight - 260);
                          setPopup({ partId: p.id, hour: h, ri, filled, x: xPos, y: yPos });
                        }}
                        onMouseEnter={e => {
                          if (dragRef.current && dragRef.current.partId === p.id) {
                            const d = { ...dragRef.current, curH: h, curG: ri };
                            dragRef.current = d;
                            setDrag(d);
                          }
                        }}
                        style={{
                          gridRow: absRow, gridColumn: 3 + h,
                          boxSizing:"border-box",
                          background: filled ? color.hex : (isDragged ? `${color.hex}33` : "transparent"),
                          opacity: filled ? 0.82 : 1,
                          borderLeft:"0.5px solid rgba(0,0,0,0.05)",
                          borderTop: rowTopBorder,
                          borderBottom: rowBotBorder,
                          cursor: "pointer",
                          transition:"opacity .12s",
                          outline: isSelected ? `2px solid ${color.hex}` : isDragged ? `2px dashed ${color.hex}` : "none",
                          outlineOffset: "-1px",
                          position: "relative",
                          zIndex: (isSelected || isDragged) ? 3 : "auto",
                        }}
                      />
                    );
                  }),
                ];
              }),
            ];
          })}
        </div>
      </div>

      {/* ── Cell popup ── */}
      {popup && (() => {
        const part    = partitions.find(p => p.id === popup.partId);
        const color   = HEATMAP_COLORS[popup.partId] || { hex:"#888" };
        const hrs     = getHourRes(popup.partId, popup.hour);
        const hasRes  = hrs.length > 0;
        // button states: based on whether the clicked cell itself was filled
        const cellFilled = popup.filled;

        const dateStr = (() => {
          const d = new Date(dayStart);
          return `${MONTH_NAMES[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")} ${d.getFullYear()}`;
        })();
        const timeStr = `${String(popup.hour).padStart(2,"0")}:00`;

        return (
          <div onClick={e => e.stopPropagation()} style={{
            position:"fixed", top: popup.y, left: popup.x, width:224,
            background:"var(--bg)", border:"0.5px solid var(--border)",
            borderRadius:12, padding:"12px 14px",
            boxShadow:"0 6px 24px rgba(0,0,0,0.14)", zIndex:300,
          }}>
            {/* Header */}
            <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10}}>
              <div style={{
                width:9, height:9, borderRadius:2, background:color.hex, flexShrink:0,
              }}/>
              <div style={{fontSize:12, fontWeight:700, fontFamily:"monospace", color:color.hex}}>
                {part?.name}
              </div>
              <div style={{fontSize:11, color:"var(--muted2)", marginLeft:"auto", textAlign:"right", lineHeight:1.4}}>
                <div style={{fontWeight:500, color:"var(--fg)"}}>{dateStr}</div>
                <div>{fmtHourRange(popup.hour)}</div>
              </div>
            </div>

            {/* Reservation list */}
            {hasRes ? (
              <div style={{
                background:"var(--surface)", borderRadius:8,
                padding:"8px 10px", marginBottom:10,
              }}>
                {hrs.map((r, i) => (
                  <div key={r.id} style={{
                    marginBottom: i < hrs.length - 1 ? 7 : 0,
                    paddingBottom: i < hrs.length - 1 ? 7 : 0,
                    borderBottom: i < hrs.length - 1 ? "0.5px solid var(--border)" : "none",
                  }}>
                    <div style={{display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:3}}>
                      {r.project && (
                        <span style={{
                          fontSize:10, fontWeight:600, padding:"2px 6px",
                          borderRadius:4, background:`${color.hex}22`,
                          color: color.hex, fontFamily:"monospace", letterSpacing:"0.02em",
                        }}>{r.project}</span>
                      )}
                      <div style={{fontSize:12, fontWeight:500, color:"var(--fg)"}}>
                        {r.name}{r.gpuCount ? <span style={{color:"var(--muted2)", fontWeight:400}}> · {r.gpuCount} GPU</span> : ""}
                      </div>
                    </div>
                    <div style={{fontSize:10, color:"var(--muted2)"}}>
                      {fmt(r.startTime)} – {fmt(r.endTime)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                fontSize:11, color:"var(--muted2)", textAlign:"center",
                padding:"10px 0 14px", fontStyle:"italic",
              }}>Available — no reservations</div>
            )}

            {/* CTA buttons */}
            <div style={{display:"flex", gap:7}}>
              <button
                disabled={!cellFilled}
                onClick={() => {
                  if (!cellFilled) return;
                  setCancelConfirm({ hrs, partId: popup.partId, hour: popup.hour });
                  setPopup(null);
                }}
                style={{
                  flex:1, padding:"7px 0", fontSize:12, fontWeight:500,
                  borderRadius:7, cursor: cellFilled ? "pointer" : "not-allowed",
                  border: cellFilled ? "0.5px solid #fca5a5" : "0.5px solid var(--border)",
                  background: cellFilled ? "#FCEBEB" : "var(--surface)",
                  color: cellFilled ? "#791F1F" : "var(--muted)",
                  opacity: cellFilled ? 1 : 0.45,
                  fontFamily:"inherit",
                }}>Cancel</button>
              <button
                disabled={cellFilled}
                onClick={() => {
                  if (cellFilled) return;
                  setPopup(null);
                  const isoDate = new Date(dayStart).toISOString().slice(0,10);
                  onReserve({ infraType:"slurm", partitions:[popup.partId], startDate: isoDate, startTime: timeStr, gpuCount: 1, duration: 1, lockFields: true });
                }}
                style={{
                  flex:1, padding:"7px 0", fontSize:12, fontWeight:500,
                  borderRadius:7, cursor: !cellFilled ? "pointer" : "not-allowed",
                  border: !cellFilled ? `0.5px solid ${color.hex}88` : "0.5px solid var(--border)",
                  background: !cellFilled ? `${color.hex}18` : "var(--surface)",
                  color: !cellFilled ? color.hex : "var(--muted)",
                  opacity: !cellFilled ? 1 : 0.45,
                  fontFamily:"inherit",
                }}>Reserve</button>
            </div>
          </div>
        );
      })()}

      {/* ── Cancel confirmation modal ── */}
      {cancelConfirm && (() => {
        const part  = partitions.find(p => p.id === cancelConfirm.partId);
        const color = HEATMAP_COLORS[cancelConfirm.partId] || { hex:"#888" };
        const confirmDateLabel = (() => {
          const d = new Date(dayStart);
          return `${MONTH_NAMES[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")} ${d.getFullYear()}`;
        })();
        return (
          <div
            onClick={() => setCancelConfirm(null)}
            style={{
              position:"fixed", inset:0, background:"rgba(0,0,0,.45)",
              zIndex:250, display:"flex", alignItems:"center",
              justifyContent:"center", padding:16,
            }}
          >
            <div onClick={e => e.stopPropagation()} style={{
              background:"var(--bg)", border:"0.5px solid var(--border)",
              borderRadius:16, padding:28, width:"100%", maxWidth:420,
            }}>
              <div style={{fontSize:17, fontWeight:500, marginBottom:4}}>Cancel reservation?</div>
              <div style={{
                display:"flex", alignItems:"center", gap:6,
                fontSize:12, color:"var(--muted2)", marginBottom:20,
              }}>
                <div style={{width:8, height:8, borderRadius:2, background:color.hex, flexShrink:0}}/>
                <span style={{fontFamily:"monospace", fontWeight:600, color:color.hex}}>{part?.name}</span>
                <span>·</span>
                <span style={{fontWeight:500, color:"var(--fg)"}}>{confirmDateLabel}</span>
                <span>·</span>
                <span>{fmtHourRange(cancelConfirm.hour)}</span>
              </div>

              {cancelConfirm.hrs.map(r => (
                <div key={r.id} style={{
                  background:"var(--surface)", borderRadius:10,
                  padding:"12px 14px", marginBottom:10,
                }}>
                  <div style={{
                    display:"flex", justifyContent:"space-between",
                    alignItems:"flex-start", marginBottom:6,
                  }}>
                    <div>
                      <div style={{fontSize:13, fontWeight:500}}>{r.name}</div>
                      <div style={{fontSize:11, color:"var(--muted2)", marginTop:2}}>
                        {r.project}
                      </div>
                    </div>
                    {r.gpuCount && (
                      <div style={{
                        fontSize:11, fontWeight:600, fontFamily:"monospace",
                        background:`${color.hex}18`, color:color.hex,
                        padding:"2px 7px", borderRadius:5,
                      }}>{part?.name} ×{r.gpuCount}</div>
                    )}
                  </div>
                  <div style={{fontSize:11, color:"var(--muted)", marginBottom:10}}>
                    {fmt(r.startTime)} – {fmt(r.endTime)}
                  </div>
                  <button
                    onClick={() => {
                      onDeleteReservation(r.id);
                      const remaining = cancelConfirm.hrs.filter(x => x.id !== r.id);
                      remaining.length > 0
                        ? setCancelConfirm({ ...cancelConfirm, hrs: remaining })
                        : setCancelConfirm(null);
                    }}
                    style={{
                      width:"100%", padding:"8px 0", fontSize:12, fontWeight:500,
                      background:"#FCEBEB", color:"#791F1F",
                      border:"0.5px solid #fca5a5", borderRadius:7,
                      cursor:"pointer", fontFamily:"inherit",
                    }}
                  >Confirm cancel</button>
                </div>
              ))}

              <button onClick={() => setCancelConfirm(null)} style={{
                width:"100%", padding:"9px 0", fontSize:13, fontWeight:500,
                borderRadius:8, border:"0.5px solid var(--border)",
                background:"var(--surface)", color:"var(--muted)",
                cursor:"pointer", marginTop:4,
              }}>Back</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ sessions, reservations, partitions, servers, onCheckin, onCheckout, onReserve, onDeleteReservation }) {
  const [tick, setTick] = useState(0);
  useEffect(()=>{const t=setInterval(()=>setTick(x=>x+1),30000);return()=>clearInterval(t);},[]);

  const activeFor   = (f) => sessions.filter(s=>!s.endTime&&f(s));
  const upcomingFor = (f) => reservations.filter(r=>r.startTime>now()&&f(r)).sort((a,b)=>a.startTime-b.startTime)[0];

  return (
    <div style={{display:"flex", gap:20, alignItems:"flex-start"}}>

      {/* ── LEFT PANEL ───────────────────────────────────────────── */}
      <div style={{flex:"0 0 50%", maxWidth:"50%", minWidth:0}}>

        {/* Top row: label + check in button */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",color:"var(--muted2)"}}>
            Resources
          </div>
          <button onClick={()=>onCheckin(null)} style={{
            padding:"6px 14px",fontSize:12,fontWeight:500,
            borderRadius:7,border:"0.5px solid #AFA9EC",background:"#EEEDFE",color:"#3C3489",cursor:"pointer"
          }}>+ Check in</button>
        </div>

        {/* Registration guidelines */}
        <div style={{background:"var(--bg)",border:"0.5px solid var(--border)",borderRadius:12,padding:"14px 18px",marginBottom:20,fontSize:12,color:"var(--muted)",lineHeight:1.8}}>
          <div style={{fontWeight:500,color:"var(--fg)",marginBottom:8,fontSize:13}}>Registration guidelines</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 20px"}}>
            <div>This system operates on an <span style={{fontWeight:500,color:"var(--fg)"}}>honor system</span> — please fill in your usage honestly and accurately.</div>
            <div><span style={{fontWeight:500,color:"var(--fg)"}}>Great Lakes is the preferred resource</span> for most workloads. Please use it whenever possible and reserve lab GPUs for jobs that specifically require them.</div>
            <div><span style={{fontWeight:500,color:"var(--fg)"}}>PhD students have scheduling priority</span> on shared resources. Please be mindful of others when planning long-running jobs.</div>
            <div><span style={{fontWeight:500,color:"var(--fg)"}}>Trainees:</span> log your GPU usage under your mentor's name, as resource allocation is tracked at the PI/mentor level.</div>
          </div>
          <div style={{marginTop:10,paddingTop:10,borderTop:"0.5px solid var(--border)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:500,padding:"2px 8px",borderRadius:20,background:"#FCEBEB",color:"#791F1F"}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:"#E24B4A",display:"inline-block"}}/>Very Urgent
            </span>
            <span style={{fontSize:12,color:"var(--muted)"}}>If you mark a job as Very Urgent, please email Ricky and cc Kai:</span>
            <a href="mailto:rickyhan@umich.edu?cc=kailiua@umich.edu" style={{fontSize:12,color:"#534AB7",textDecoration:"none",fontWeight:500}}>rickyhan@umich.edu</a>
            <span style={{fontSize:12,color:"var(--muted2)"}}>cc</span>
            <a href="mailto:rickyhan@umich.edu?cc=kailiua@umich.edu" style={{fontSize:12,color:"#534AB7",textDecoration:"none",fontWeight:500}}>kailiua@umich.edu</a>
          </div>
        </div>

        {/* Slurm partitions */}
        <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",
          color:"var(--muted2)",marginBottom:10}}>Slurm partitions</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:20}}>
          {partitions.map(p=>{
            const jobs = activeFor(s=>s.infraType==="slurm"&&(s.partitions||[]).includes(p.id));
            const upcoming = upcomingFor(r=>r.infraType==="slurm"&&(r.partitions||[]).includes(p.id));
            const hasOver  = jobs.some(j=>j.plannedEnd&&now()>j.plannedEnd);
            const status   = jobs.length===0?"free":hasOver?"over":"busy";
            return <ResourceCard key={p.id} title={p.name} titleMono
              hardware={p.hardware||null} note={p.note||null}
              gpuTotal={p.gpuTotal} status={status} jobs={jobs} upcoming={upcoming}
              onCheckin={()=>onCheckin({infraType:"slurm",partitions:[p.id]})}
              onReserve={()=>onReserve({infraType:"slurm",partitions:[p.id]})}
              onCheckout={onCheckout}
              hideCheckin={true}
              partitionColor={HEATMAP_COLORS[p.id]?.hex}/>;
          })}
        </div>

        {/* Independent servers */}
        <div style={{fontSize:11,fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",
          color:"var(--muted2)",marginBottom:10}}>Independent servers</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {servers.map(s=>{
            const jobs = activeFor(j=>j.infraType==="server"&&j.serverId===s.id);
            const upcoming = upcomingFor(r=>r.infraType==="server"&&r.serverId===s.id);
            const hasOver  = jobs.some(j=>j.plannedEnd&&now()>j.plannedEnd);
            const status   = jobs.length===0?"free":hasOver?"over":"busy";
            return <ResourceCard key={s.id} title={`${s.name} / ${s.gpu}`} titleMono
              hardware={s.spec||null} note={null} gpuTotal={null}
              status={status} jobs={jobs} upcoming={upcoming}
              onCheckin={()=>onCheckin({infraType:"server",serverId:s.id})}
              onReserve={()=>onReserve({infraType:"server",serverId:s.id})}
              onCheckout={onCheckout}
              hideCheckin={false}/>;
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL — Calendar ───────────────────────────────── */}
      <div style={{
        flex:"0 0 calc(50% - 20px)", maxWidth:"calc(50% - 20px)", minWidth:0,
        position:"sticky", top:57,
      }}>
        <HeatmapCalendar
          reservations={reservations}
          partitions={partitions}
          onDeleteReservation={onDeleteReservation}
          onReserve={onReserve}
        />
      </div>

    </div>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────
function History({ sessions, servers, onExport }) {
  const [q, setQ]             = useState("");
  const [filterProj, setFP]   = useState("All");
  const [filterPri, setFPri]  = useState("All");
  const smap = Object.fromEntries(servers.map(s=>[s.id,`${s.name}/${s.gpu}`]));
  const projs = ["All",...new Set(sessions.map(s=>s.project).filter(Boolean))];

  const rows = [...sessions].sort((a,b)=>b.startTime-a.startTime).filter(s=>{
    const qok  = !q||s.name.toLowerCase().includes(q.toLowerCase())||(s.description||"").toLowerCase().includes(q.toLowerCase());
    const pok  = filterProj==="All"||s.project===filterProj;
    const priok = filterPri==="All"||s.priority===filterPri;
    return qok&&pok&&priok;
  });

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, description…"
            style={{...inp(),width:220,fontSize:13}}/>
          <select value={filterProj} onChange={e=>setFP(e.target.value)} style={{...inp(),fontSize:12}}>
            {projs.map(p=><option key={p}>{p}</option>)}
          </select>
          <select value={filterPri} onChange={e=>setFPri(e.target.value)} style={{...inp(),fontSize:12}}>
            {["All","low","normal","urgent","vurgent"].map(p=>(
              <option key={p} value={p}>{p==="All"?"All priorities":PRIORITY_META[p]?.label||p}</option>
            ))}
          </select>
        </div>
        <button onClick={onExport} style={{padding:"8px 16px",fontSize:12,fontWeight:500,borderRadius:8,
          border:"0.5px solid #AFA9EC",background:"#EEEDFE",color:"#3C3489",cursor:"pointer"}}>
          ⬇ Export CSV
        </button>
      </div>
      <div style={{overflowX:"auto",borderRadius:12,border:"0.5px solid var(--border)"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:750}}>
          <thead>
            <tr style={{background:"var(--surface)"}}>
              {["Name","Project","Priority","Resource","Type","Start","Duration","Description"].map(h=>(
                <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:11,fontWeight:500,
                  color:"var(--muted2)",textTransform:"uppercase",letterSpacing:.5,
                  borderBottom:"0.5px solid var(--border)",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length===0&&(
              <tr><td colSpan={8} style={{padding:32,textAlign:"center",color:"var(--muted)",fontSize:13}}>
                No sessions found
              </td></tr>
            )}
            {rows.map(s=>(
              <tr key={s.id} style={{borderTop:"0.5px solid var(--border)"}}>
                <td style={{padding:"9px 12px",fontSize:13}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontWeight:500}}>{s.name}</span><PhdBadge show={s.isPhD}/>
                  </div>
                </td>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--muted)"}}>{s.project}</td>
                <td style={{padding:"9px 12px"}}><PriBadge p={s.priority}/></td>
                <td style={{padding:"9px 12px",fontSize:12,fontFamily:"monospace",color:"var(--muted)"}}>
                  {s.infraType==="slurm"?(s.partitions||[]).join("+"):smap[s.serverId]||"—"}
                </td>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--muted)",textTransform:"capitalize"}}>{s.jobType}</td>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--muted)",whiteSpace:"nowrap"}}>{fmt(s.startTime)}</td>
                <td style={{padding:"9px 12px",fontSize:12,whiteSpace:"nowrap"}}>
                  {s.endTime?<span style={{color:"var(--muted)"}}>{fmtDur(s.endTime-s.startTime)}</span>
                    :<span style={{color:"#f97316",fontWeight:500}}>{fmtDur(now()-s.startTime)}*</span>}
                </td>
                <td style={{padding:"9px 12px",fontSize:12,color:"var(--muted2)",fontStyle:"italic",
                  maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {s.description||"—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function Stats({ sessions }) {
  const [range, setRange] = useState("all");
  const cutoff   = range==="week"?now()-7*86400000:range==="month"?now()-30*86400000:0;
  const done     = sessions.filter(s=>s.endTime&&s.startTime>=cutoff);
  const byPerson = {}, byProject = {}, byPart = {};
  done.forEach(s=>{
    const dur = s.endTime-s.startTime;
    if(!byPerson[s.name]) byPerson[s.name]={total:0,count:0,isPhD:s.isPhD};
    byPerson[s.name].total+=dur; byPerson[s.name].count++;
    byProject[s.project||"Other"]=(byProject[s.project||"Other"]||0)+dur;
    (s.partitions||[]).forEach(p=>{byPart[p]=(byPart[p]||0)+dur;});
    if(s.infraType==="server"&&s.serverId) byPart[s.serverId]=(byPart[s.serverId]||0)+dur;
  });
  const pp=Object.entries(byPerson).sort((a,b)=>b[1].total-a[1].total).slice(0,8);
  const pr=Object.entries(byProject).sort((a,b)=>b[1]-a[1]);
  const pa=Object.entries(byPart).sort((a,b)=>b[1]-a[1]);
  const mp=pp[0]?.[1].total||1,mr=pr[0]?.[1]||1,ma=pa[0]?.[1]||1;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:20,fontWeight:500}}>Usage statistics</div>
        <div style={{display:"flex",gap:6}}>
          {["week","month","all"].map(r=>(
            <button key={r} onClick={()=>setRange(r)} style={{
              padding:"5px 12px",fontSize:12,fontWeight:500,borderRadius:20,cursor:"pointer",
              border:`0.5px solid ${range===r?"#AFA9EC":"var(--border)"}`,
              background:range===r?"#EEEDFE":"var(--surface)",
              color:range===r?"#3C3489":"var(--muted)"
            }}>{r==="all"?"All time":r==="week"?"7 days":"30 days"}</button>
          ))}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24}}>
        {[
          ["Sessions",done.length],
          ["GPU-hrs",Math.round(done.reduce((a,s)=>a+(s.gpuCount||1)*(s.endTime-s.startTime)/3600000,0))],
          ["Users",new Set(done.map(s=>s.name)).size],
          ["Active now",sessions.filter(s=>!s.endTime).length],
        ].map(([l,v])=>(
          <div key={l} style={{background:"var(--surface)",borderRadius:8,padding:"14px 16px"}}>
            <div style={{fontSize:11,color:"var(--muted2)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
            <div style={{fontSize:24,fontWeight:500}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
        {[
          {title:"By person",  data:pp.map(([n,d])=>({label:n,val:d.total,max:mp,count:d.count,extra:d.isPhD?"🎓":""})), color:"#AFA9EC"},
          {title:"By project", data:pr.map(([n,v])=>({label:n,val:v,max:mr})), color:"#5DCAA5"},
          {title:"By partition",data:pa.map(([n,v])=>({label:n,val:v,max:ma})), color:"#EF9F27", mono:true},
        ].map(({title,data,color,mono})=>(
          <div key={title} style={{background:"var(--bg)",border:"0.5px solid var(--border)",borderRadius:12,padding:"16px 18px"}}>
            <div style={{fontSize:13,fontWeight:500,marginBottom:14}}>{title}</div>
            {data.length===0&&<div style={{fontSize:12,color:"var(--muted)"}}>No data yet</div>}
            {data.map((d,i)=>(
              <div key={i} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:12,fontWeight:500,fontFamily:mono?"monospace":"inherit",display:"flex",alignItems:"center",gap:4}}>
                    {d.label}{d.extra&&<span style={{fontSize:10}}>{d.extra}</span>}
                  </span>
                  <span style={{fontSize:11,color:"var(--muted)"}}>{fmtDur(d.val)}{d.count?` · ${d.count}x`:""}</span>
                </div>
                <div style={{background:"var(--surface)",borderRadius:4,height:5,overflow:"hidden"}}>
                  <div style={{width:`${Math.round((d.val/d.max)*100)}%`,height:"100%",background:color,borderRadius:4}}/>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Admin password gate ─────────────────────────────────────────────────────
const ADMIN_PASSWORD = "liulab2025";

function AdminGate(props) {
  const [input, setInput]     = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [shake, setShake]     = useState(false);
  const [showPw, setShowPw]   = useState(false);

  const attempt = () => {
    if (input === ADMIN_PASSWORD) {
      setUnlocked(true);
    } else {
      setShake(true);
      setInput("");
      setTimeout(() => setShake(false), 500);
    }
  };

  if (unlocked) return <Admin {...props}/>;

  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:320}}>
      <div style={{
        background:"var(--bg)",border:"0.5px solid var(--border)",
        borderRadius:16,padding:"32px 36px",width:"100%",maxWidth:360,textAlign:"center"
      }}>
        <div style={{
          width:44,height:44,borderRadius:"50%",
          background:"#EEEDFE",border:"0.5px solid #AFA9EC",
          display:"flex",alignItems:"center",justifyContent:"center",
          margin:"0 auto 16px",fontSize:20
        }}>🔒</div>
        <div style={{fontSize:16,fontWeight:500,marginBottom:6}}>Admin access</div>
        <div style={{fontSize:12,color:"var(--muted2)",marginBottom:24}}>Enter the admin password to continue</div>

        <div style={{
          position:"relative",
          animation: shake ? "shake 0.4s ease" : "none",
        }}>
          <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}`}</style>
          <input
            type={showPw ? "text" : "password"}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && attempt()}
            placeholder="Password"
            style={{
              width:"100%", padding:"9px 40px 9px 12px",
              border:`0.5px solid ${shake?"#E24B4A":"var(--border)"}`,
              borderRadius:8, fontSize:14,
              background:"var(--bg)", color:"var(--fg)",
              fontFamily:"inherit", outline:"none",
              transition:"border-color .15s"
            }}
          />
          <button onClick={() => setShowPw(x=>!x)} style={{
            position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
            background:"none", border:"none", cursor:"pointer",
            fontSize:13, color:"var(--muted2)", padding:0, fontFamily:"inherit"
          }}>{showPw ? "hide" : "show"}</button>
        </div>

        {shake && (
          <div style={{fontSize:12,color:"#E24B4A",marginTop:8}}>Incorrect password</div>
        )}

        <button onClick={attempt} style={{
          width:"100%", marginTop:16, padding:"10px 0",
          fontSize:13, fontWeight:500, borderRadius:8, cursor:"pointer",
          border:"0.5px solid #AFA9EC", background:"#EEEDFE", color:"#3C3489",
          fontFamily:"inherit", transition:"opacity .1s"
        }}>Unlock</button>

        <div style={{fontSize:11,color:"var(--muted2)",marginTop:16,lineHeight:1.5}}>
          Contact Kai or Ricky if you need access
        </div>
      </div>
    </div>
  );
}

// ─── Admin ────────────────────────────────────────────────────────────────────
function Admin({ roster, setRoster, projects, setProjects, partitions, setPartitions, servers, setServers }) {
  const [newName,setNN]=useState(""); const [newProj,setNP]=useState("");
  const [newPart,setNPa]=useState({name:"",gpuTotal:8});
  const [newSrv,setNS]=useState({name:"",gpu:"",spec:""});

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      <AdminPanel title="PhD roster" badge={`${roster.length} members`}>
        {roster.map((n,i)=>(
          <ListRow key={i} label={n} onRemove={()=>setRoster(roster.filter((_,j)=>j!==i))}/>
        ))}
        <AddRow value={newName} onChange={setNN} placeholder="Full name"
          onAdd={()=>{if(newName.trim()){setRoster([...roster,newName.trim()]);setNN("");}}}/>
      </AdminPanel>

      <AdminPanel title="Projects" badge={`${projects.length} projects`}>
        {projects.map((p,i)=>(
          <ListRow key={i} label={p} onRemove={()=>setProjects(projects.filter((_,j)=>j!==i))}/>
        ))}
        <AddRow value={newProj} onChange={setNP} placeholder="Project name"
          onAdd={()=>{if(newProj.trim()){setProjects([...projects,newProj.trim()]);setNP("");}}}/>
      </AdminPanel>

      <AdminPanel title="Slurm partitions" badge={`${partitions.length} partitions`}>
        {partitions.map((p,i)=>(
          <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"6px 8px",background:"var(--surface)",borderRadius:7,marginBottom:5}}>
            <span style={{fontSize:12,fontWeight:500,fontFamily:"monospace"}}>{p.name}</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:"var(--muted2)"}}>
                <input type="number" min={1} max={128} value={p.gpuTotal}
                  onChange={e=>setPartitions(partitions.map((x,j)=>j===i?{...x,gpuTotal:parseInt(e.target.value)||1}:x))}
                  style={{width:48,...inp(),padding:"2px 6px",fontSize:12,textAlign:"center"}}/>
                {" "}GPUs
              </span>
              <button onClick={()=>setPartitions(partitions.filter((_,j)=>j!==i))}
                style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14,fontWeight:500}}>×</button>
            </div>
          </div>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"1fr 80px auto",gap:6,marginTop:8}}>
          <input value={newPart.name} onChange={e=>setNPa({...newPart,name:e.target.value})}
            placeholder="partition name" style={{...inp(),fontSize:12,fontFamily:"monospace"}}/>
          <input type="number" value={newPart.gpuTotal} onChange={e=>setNPa({...newPart,gpuTotal:parseInt(e.target.value)||1})}
            placeholder="GPUs" style={{...inp(),fontSize:12,textAlign:"center"}}/>
          <button onClick={()=>{if(newPart.name.trim()){setPartitions([...partitions,{id:newPart.name.trim().toLowerCase(),name:newPart.name.trim().toLowerCase(),gpuTotal:newPart.gpuTotal}]);setNPa({name:"",gpuTotal:8});}}}
            style={{padding:"7px 12px",fontSize:12,fontWeight:500,borderRadius:8,cursor:"pointer",
              border:"0.5px solid #AFA9EC",background:"#EEEDFE",color:"#3C3489"}}>Add</button>
        </div>
      </AdminPanel>

      <AdminPanel title="Independent servers" badge={`${servers.length} GPUs`}>
        {servers.map((s,i)=>(
          <ListRow key={s.id} label={`${s.name} / ${s.gpu}`} sub={s.spec} mono
            onRemove={()=>setServers(servers.filter((_,j)=>j!==i))}/>
        ))}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:6,marginTop:8}}>
          {[["name","server"],["gpu","GPU idx"],["spec","spec"]].map(([k,ph])=>(
            <input key={k} value={newSrv[k]} onChange={e=>setNS({...newSrv,[k]:e.target.value})}
              placeholder={ph} style={{...inp(),fontSize:12,fontFamily:k!=="spec"?"monospace":"inherit"}}/>
          ))}
          <button onClick={()=>{if(newSrv.name&&newSrv.gpu){setServers([...servers,{id:uid(),...newSrv}]);setNS({name:"",gpu:"",spec:""});}}}
            style={{padding:"7px 12px",fontSize:12,fontWeight:500,borderRadius:8,cursor:"pointer",
              border:"0.5px solid #AFA9EC",background:"#EEEDFE",color:"#3C3489"}}>Add</button>
        </div>
      </AdminPanel>
    </div>
  );
}

function AdminPanel({title,badge,children}){
  return(
    <div style={{background:"var(--bg)",border:"0.5px solid var(--border)",borderRadius:12,padding:"16px 18px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:500}}>{title}</div>
        <span style={{fontSize:11,color:"var(--muted)",background:"var(--surface)",
          padding:"2px 8px",borderRadius:20,border:"0.5px solid var(--border)"}}>{badge}</span>
      </div>
      {children}
    </div>
  );
}
function ListRow({label,sub,mono,onRemove}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      padding:"6px 8px",background:"var(--surface)",borderRadius:7,marginBottom:5}}>
      <div>
        <span style={{fontSize:12,fontWeight:500,fontFamily:mono?"monospace":"inherit"}}>{label}</span>
        {sub&&<span style={{fontSize:11,color:"var(--muted2)",marginLeft:6}}>{sub}</span>}
      </div>
      <button onClick={onRemove} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14,fontWeight:500,padding:"0 4px"}}>×</button>
    </div>
  );
}
function AddRow({value,onChange,placeholder,onAdd,mono}){
  return(
    <div style={{display:"flex",gap:6,marginTop:8}}>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        onKeyDown={e=>e.key==="Enter"&&onAdd()}
        style={{flex:1,...inp(),fontSize:12,fontFamily:mono?"monospace":"inherit"}}/>
      <button onClick={onAdd} style={{padding:"7px 12px",fontSize:12,fontWeight:500,borderRadius:8,
        cursor:"pointer",border:"0.5px solid #AFA9EC",background:"#EEEDFE",color:"#3C3489"}}>Add</button>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [sessions, setSessions]         = useState([]);
  const [reservations, setReservations] = useState([]);
  const [partitions, setPartitions]     = useState(PART_DEFAULT);
  const [servers, setServers]           = useState(SRV_DEFAULT);
  const [roster, setRoster]             = useState(PHD_DEFAULT);
  const [projects, setProjects]         = useState(PROJ_DEFAULT);
  const [loading, setLoading]           = useState(true);
  const [err, setErr]                   = useState("");
  const [tab, setTab]                   = useState("dashboard");
  const [checkinPre, setCheckinPre]     = useState(null);
  const [showCheckin, setShowCheckin]   = useState(false);
  const [reservePre, setReservePre]     = useState(null);
  const [showReserve, setShowReserve]   = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [rawS, rawR, parts, srvs, ros, projs] = await Promise.all([
        db.getSessions(), db.getReservations(),
        db.getConfig("partitions"), db.getConfig("servers"),
        db.getConfig("phd_roster"), db.getConfig("projects"),
      ]);
      setSessions((rawS||[]).map(fromDb));
      setReservations((rawR||[]).map(fromDbRes));
      if (parts) setPartitions(parts);
      if (srvs)  setServers(srvs);
      if (ros)   setRoster(ros);
      if (projs) setProjects(projs);
      setErr("");
    } catch(e) { setErr("Connection error: "+e.message); }
    setLoading(false);
  }, []);

  useEffect(()=>{
    load();
    pollRef.current = setInterval(load, 15000);
    return()=>clearInterval(pollRef.current);
  },[load]);

  // Config auto-save helpers
  const savePartitions = useCallback(async (v) => {
    setPartitions(v);
    try { await db.setConfig("partitions", v); } catch{}
  },[]);
  const saveServers = useCallback(async (v) => {
    setServers(v);
    try { await db.setConfig("servers", v); } catch{}
  },[]);
  const saveRoster = useCallback(async (v) => {
    setRoster(v);
    try { await db.setConfig("phd_roster", v); } catch{}
  },[]);
  const saveProjects = useCallback(async (v) => {
    setProjects(v);
    try { await db.setConfig("projects", v); } catch{}
  },[]);

  const handleCheckinConfirm = async (data) => {
    await db.insertSession(data);
    setSessions(s=>[data,...s]);
    setShowCheckin(false);
  };
  const handleCheckout = async (id) => {
    const endTime = now();
    await db.updateSession(id, {end_time: endTime});
    setSessions(s=>s.map(x=>x.id===id?{...x,endTime}:x));
  };
  const handleReserveConfirm = async (data) => {
    await db.insertReservation(data);
    setReservations(r=>[...r,data]);
    setShowReserve(false);
  };
  const handleDeleteReservation = async (id) => {
    await db.deleteReservation(id);
    setReservations(r=>r.filter(x=>x.id!==id));
  };

  const TABS = [{id:"dashboard",label:"Dashboard"},{id:"history",label:"History"},
                {id:"stats",label:"Stats"},{id:"admin",label:"Admin"}];

  return (
    <div style={{
      "--bg":"var(--color-background-primary,#fff)",
      "--surface":"var(--color-background-secondary,#f8f8f6)",
      "--border":"var(--color-border-tertiary,rgba(0,0,0,.12))",
      "--fg":"var(--color-text-primary,#1a1a1a)",
      "--muted":"var(--color-text-secondary,#666)",
      "--muted2":"var(--color-text-tertiary,#999)",
      fontFamily:"var(--font-sans,system-ui,sans-serif)",
      fontSize:14, color:"var(--fg)",
      background:"var(--color-background-tertiary,#f1efe8)",
      minHeight:"100vh",
    }}>
      {/* Nav */}
      <div style={{background:"var(--bg)",borderBottom:"0.5px solid var(--border)",
        padding:"0 24px",display:"flex",alignItems:"center",
        position:"sticky",top:0,zIndex:100}}>
        <div style={{fontSize:14,fontWeight:500,marginRight:24,padding:"14px 0",whiteSpace:"nowrap"}}>
          Liu Lab · GPU Tracker
        </div>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:"14px 16px",fontSize:13,fontWeight:500,cursor:"pointer",
            background:"none",border:"none",
            color:tab===t.id?"var(--fg)":"var(--muted)",
            borderBottom:tab===t.id?"2px solid #534AB7":"2px solid transparent",
            transition:"color .1s",fontFamily:"inherit"
          }}>{t.label}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:err?"#ef4444":"#22c55e"}}/>
          <span style={{fontSize:11,color:"var(--muted2)"}}>{err?"Offline":"Live · 15s"}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{padding:24,maxWidth:1400,margin:"0 auto"}}>
        {err&&!loading&&<ErrBanner msg={err}/>}
        {loading ? <Spinner/> : (
          <>
            {tab==="dashboard"&&<Dashboard sessions={sessions} reservations={reservations}
              partitions={partitions} servers={servers}
              onCheckin={p=>{setCheckinPre(p);setShowCheckin(true);}}
              onCheckout={handleCheckout}
              onReserve={p=>{setReservePre(p);setShowReserve(true);}}
              onDeleteReservation={handleDeleteReservation}/>}
            {tab==="history"&&<History sessions={sessions} servers={servers}
              onExport={()=>csvExport(sessions,servers)}/>}
            {tab==="stats"&&<Stats sessions={sessions}/>}
            {tab==="admin"&&<AdminGate
              roster={roster}     setRoster={saveRoster}
              projects={projects} setProjects={saveProjects}
              partitions={partitions} setPartitions={savePartitions}
              servers={servers}   setServers={saveServers}/>}
          </>
        )}
      </div>

      {showCheckin&&<CheckInModal roster={roster} projects={projects}
        partitions={partitions} servers={servers} prefill={checkinPre}
        onConfirm={handleCheckinConfirm} onCancel={()=>setShowCheckin(false)}/>}
      {showReserve&&<ReserveModal roster={roster} projects={projects}
        partitions={partitions} servers={servers} reservations={reservations} prefill={reservePre}
        onConfirm={handleReserveConfirm} onCancel={()=>setShowReserve(false)}/>}
    </div>
  );
}
