import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { Browser } from "@capacitor/browser"
import { App as CapApp } from "@capacitor/app"
import {
  BRAND, SessionUser, MeResponse, Membership,
  getStoredUser, verifySession, signOut, login, me, openBillingPortal, walletPassUrl, registerPush, unregisterPush,
  googleStartUrl, completeGoogleAuth,
  listResources, getSlots, book, upcomingBookings, BookResource, Slot, UpcomingBooking,
} from "./lib"

type Tab = "home" | "checkin" | "book" | "account"

const money = (c: number | null | undefined) =>
  c == null ? "—" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"

// Inline icons (stroke = currentColor) so they pick up the brand red / muted states.
const Icons: Record<string, JSX.Element> = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>,
  qr: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 22V3" /><path d="M5 4h11l-2 4 2 4H5" /></svg>,
  target: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>,
  wallet: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm-9 9h8v2H8z" /></svg>,
}

function Logo({ big }: { big?: boolean }) {
  return <div className="logo" style={{ fontSize: big ? 28 : 18 }}>BLACK <span className="r">TEE</span></div>
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>("home")
  const [billing, setBilling] = useState(false)

  useEffect(() => {
    ;(async () => {
      const stored = await getStoredUser()
      if (stored) {
        setUser(stored)
        const live = await verifySession()
        if (!live) { await signOut(); setUser(null) }
      }
      setReady(true)
    })()
  }, [])

  useEffect(() => { if (user) registerPush() }, [user])

  // Handle the Google sign-in deep link (theblacktee://auth?token=...)
  useEffect(() => {
    let handle: any
    ;(async () => {
      handle = await CapApp.addListener("appUrlOpen", async ({ url }) => {
        try {
          const q = url.split("?")[1] || ""
          const params = new URLSearchParams(q)
          const token = params.get("token")
          if (token) {
            const su = await completeGoogleAuth(token)
            if (su) setUser(su)
          }
        } catch {}
        try { await Browser.close() } catch {}
      })
    })()
    return () => { if (handle) handle.remove() }
  }, [])

  if (!ready) return <div className="app center" style={{ height: "100%" }}><Logo big /></div>
  if (!user) return <Login onSignedIn={setUser} />

  async function handleSignOut() { await unregisterPush(); await signOut(); setUser(null); setTab("home"); setBilling(false) }
  function go(t: Tab) { setBilling(false); setTab(t) }

  return (
    <div className="app">
      <div className="brandbar">
        <Logo />
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em" }}>{BRAND.tagline}</span>
      </div>
      <div className="content">
        {tab === "home" && <Home user={user} onGo={go} />}
        {tab === "checkin" && <CheckIn />}
        {tab === "book" && <Book />}
        {tab === "account" && !billing && <Account user={user} onSignOut={handleSignOut} onBilling={() => setBilling(true)} />}
        {tab === "account" && billing && <BillingScreen onBack={() => setBilling(false)} />}
      </div>
      <nav className="tabbar safe-bottom">
        <TabBtn t="home" cur={tab} set={go} icon="home" label="Home" />
        <TabBtn t="checkin" cur={tab} set={go} icon="qr" label="Check-In" />
        <TabBtn t="book" cur={tab} set={go} icon="calendar" label="Book" />
        <TabBtn t="account" cur={tab} set={go} icon="user" label="Account" />
      </nav>
    </div>
  )
}

function TabBtn({ t, cur, set, icon, label }: { t: Tab; cur: Tab; set: (t: Tab) => void; icon: string; label: string }) {
  return (
    <button className={"tab" + (cur === t ? " active" : "")} onClick={() => set(t)}>
      <span className="ico">{Icons[icon]}</span>{label}
    </button>
  )
}

function Login({ onSignedIn }: { onSignedIn: (u: SessionUser) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit() {
    setErr(""); setBusy(true)
    try { onSignedIn(await login(email.trim(), password)) }
    catch (e: any) { setErr(e?.message || "Login failed") }
    finally { setBusy(false) }
  }
  return (
    <div className="app center safe-top safe-bottom" style={{ padding: 24, height: "100%" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div className="center" style={{ marginBottom: 28 }}>
          <Logo big />
          <p className="sub" style={{ marginTop: 10, textTransform: "uppercase", letterSpacing: ".16em", fontSize: 11 }}>{BRAND.tagline}</p>
        </div>
        <p className="label">Email</p>
        <input className="input" type="email" autoCapitalize="none" autoCorrect="off"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
        <p className="label">Password</p>
        <input className="input" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        <div className="err">{err}</div>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? "Signing in…" : "Sign In"}</button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => Browser.open({ url: googleStartUrl() })}>Continue with Google</button>
        <p className="center" style={{ marginTop: 18 }}>
          <a className="link" href={`${BRAND.apiBase}/pricing`}>Not a member? Join now</a>
        </p>
      </div>
    </div>
  )
}

function Home({ user, onGo }: { user: SessionUser; onGo: (t: Tab) => void }) {
  const first = (user.name || "Member").split(" ")[0]
  return (
    <div>
      <div className="hero">
        <div className="glow" />
        <div className="kicker">Welcome back</div>
        <h3>Let&rsquo;s tee it up, {first}.</h3>
        <p>Your bay and 450+ courses are ready.</p>
      </div>
      <div className="tiles">
        <div className="tile" role="button" onClick={() => onGo("checkin")}>
          <div className="ic">{Icons.flag}</div>
          <div><div className="t">Check in at the door</div><div className="d">Show your QR pass to get in fast</div></div>
          <span className="chev">›</span>
        </div>
        <div className="tile" role="button" onClick={() => onGo("book")}>
          <div className="ic">{Icons.target}</div>
          <div><div className="t">Reserve a bay</div><div className="d">TrackMan bays · 450+ courses · by the hour</div></div>
          <span className="chev">›</span>
        </div>
        <div className="tile" role="button" onClick={() => onGo("account")}>
          <div className="ic">{Icons.user}</div>
          <div><div className="t">My membership</div><div className="d">Plan, billing & payment method</div></div>
          <span className="chev">›</span>
        </div>
      </div>
    </div>
  )
}

function statusBadge(m: Membership): { label: string; color: string } {
  if (m.isComp) return { label: "Complimentary", color: "#22c55e" }
  switch (m.status) {
    case "active": return { label: "Active", color: "#22c55e" }
    case "trialing": return { label: "Trial", color: "#3b82f6" }
    case "past_due": return { label: "Past due", color: "#f59e0b" }
    case "paused": return { label: "Frozen", color: "#9a9a9a" }
    case "canceled": return { label: "Canceled", color: "#ef4444" }
    default: return { label: m.status || "—", color: "#9a9a9a" }
  }
}

function CheckIn() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<MeResponse | null>(null)
  const [err, setErr] = useState("")
  useEffect(() => { me().then(setData).catch((e) => setErr(e.message)) }, [])
  useEffect(() => {
    const code = data?.user.checkInCode
    if (canvas.current && code) QRCode.toCanvas(canvas.current, code, { width: 250, margin: 1 }, () => {})
  }, [data])
  if (err) return <div className="center"><p className="sub">{err}</p></div>
  if (!data) return <div className="center"><p className="sub">Loading your pass…</p></div>
  const badge = statusBadge(data.membership)
  const code = data.user.checkInCode
  const canEnter = data.membership.status === "active" || data.membership.status === "trialing" || data.membership.isComp
  async function addToWallet() { try { await Browser.open({ url: await walletPassUrl() }) } catch {} }
  return (
    <div className="center" style={{ paddingTop: 6 }}>
      <h1 className="h1">Check-In Pass</h1>
      <span className="pill" style={{ color: badge.color, borderColor: badge.color, marginTop: 4 }}>
        ● {data.membership.planName || "Membership"} · {badge.label}
      </span>
      {code ? (
        <>
          <div className="qrwrap" style={{ marginTop: 18 }}><canvas ref={canvas} /></div>
          <p className="big" style={{ letterSpacing: 4, marginTop: 14 }}>{code}</p>
        </>
      ) : (
        <p className="sub" style={{ marginTop: 20 }}>No check-in code on file yet — the front desk can set one up.</p>
      )}
      <p className="pill" style={{ marginTop: 6 }}>{data.user.name || data.user.email}</p>
      {!canEnter && (
        <p className="sub" style={{ color: "#f59e0b", marginTop: 12, maxWidth: 300 }}>
          Your membership isn't active right now. See the front desk or the Account tab.
        </p>
      )}
      <button className="btn wallet" style={{ maxWidth: 320, marginTop: 24 }} onClick={addToWallet}>{Icons.wallet} Add to Apple Wallet</button>
    </div>
  )
}

const money2 = (c: number | null | undefined) => (c && c > 0 ? "$" + (c / 100).toFixed(0) : "Included")
function isoLocal(d: Date) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
function dayLabel(d: Date) { return d.toLocaleDateString("en-US", { weekday: "short" }) }
function slotLabel(hhmmss: string) {
  const [h, m] = hhmmss.split(":").map(Number)
  const p = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${p}`
}

function Section({ title, items, onPick }: { title: string; items: BookResource[]; onPick: (r: BookResource) => void }) {
  return (
    <>
      <p className="sub" style={{ margin: "10px 0 6px" }}>{title}</p>
      {items.map((r) => (
        <div key={r.id} className="card" role="button" onClick={() => onPick(r)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>{r.name}</div>
            <div className="sub" style={{ margin: 0 }}>{r.rate_member_cents && r.rate_member_cents > 0 ? `${money2(r.rate_member_cents)}${r.duration_minutes ? `/${r.duration_minutes}m` : ''}` : "Included"} ›</div>
          </div>
        </div>
      ))}
    </>
  )
}

function Book() {
  const [resources, setResources] = useState<BookResource[] | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingBooking[]>([])
  const [sel, setSel] = useState<BookResource | null>(null)
  const [date, setDate] = useState<string>(isoLocal(new Date()))
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [err, setErr] = useState("")
  const [msg, setMsg] = useState("")
  const [busy, setBusy] = useState(false)

  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d })

  async function refresh() {
    try {
      const [r, u] = await Promise.all([listResources(), upcomingBookings()])
      setResources(r); setUpcoming(u)
    } catch (e: any) { setErr(e.message); setResources([]) }
  }
  useEffect(() => { refresh() }, [])

  async function loadSlots(r: BookResource, d: string) {
    setSlots(null); setErr(""); setMsg("")
    try { const res = await getSlots(r.id, d); setSlots(res.slots) }
    catch (e: any) { setErr(e.message); setSlots([]) }
  }
  function pick(r: BookResource) { const d = isoLocal(new Date()); setSel(r); setDate(d); loadSlots(r, d) }
  function chooseDate(d: string) { setDate(d); if (sel) loadSlots(sel, d) }

  async function reserve(s: Slot) {
    if (!sel) return
    setBusy(true); setErr(""); setMsg("")
    try {
      const res = await book(sel.id, date, s.start)
      if (res.url) { await Browser.open({ url: res.url }); setMsg("Finish payment in the browser to confirm your booking.") }
      else { setMsg("Booked! See you then."); await refresh() }
      await loadSlots(sel, date)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (sel) {
    const open = slots ? slots.filter((s) => s.available) : []
    return (
      <div>
        <button className="link" onClick={() => { setSel(null); setSlots(null); setMsg("") }} style={{ background: "none", border: 0, padding: 0, marginBottom: 10 }}>‹ Back</button>
        <h1 className="h1">{sel.name}</h1>
        <p className="sub">{sel.rate_member_cents && sel.rate_member_cents > 0 ? `Member rate ${money2(sel.rate_member_cents)} / ${sel.duration_minutes} min` : "Included with your membership"}</p>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
          {days.map((d) => {
            const iso = isoLocal(d); const on = iso === date
            return (
              <button key={iso} onClick={() => chooseDate(iso)}
                style={{ flex: "0 0 auto", border: on ? "1px solid var(--red)" : "1px solid var(--border)", borderRadius: 4, padding: "10px 12px", minWidth: 54,
                  background: on ? "var(--red)" : "#0e0e0e", color: "#fff", fontWeight: 700 }}>
                <div style={{ fontSize: 11, opacity: 0.85 }}>{dayLabel(d)}</div>
                <div style={{ fontSize: 18 }}>{d.getDate()}</div>
              </button>
            )
          })}
        </div>
        {msg && <p className="sub" style={{ color: "#22c55e" }}>{msg}</p>}
        {err && <p className="sub" style={{ color: "#ff6b6b" }}>{err}</p>}
        {!slots ? <p className="sub">Loading times…</p> : open.length === 0 ? (
          <p className="sub">No open times this day.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
            {open.map((s) => (
              <button key={s.start} disabled={busy} onClick={() => reserve(s)}
                style={{ border: "1px solid var(--border)", borderRadius: 4, padding: "14px 0", background: "#0e0e0e", color: "#fff", fontWeight: 700 }}>
                {slotLabel(s.start)}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const golf = (resources || []).filter((r) => r.kind === "golf")
  return (
    <div>
      <h1 className="h1">Reserve a Bay</h1>
      <p className="sub">TrackMan simulator bays — book by the hour.</p>
      {err && <p className="sub" style={{ color: "#ff6b6b" }}>{err}</p>}
      {msg && <p className="sub" style={{ color: "#22c55e" }}>{msg}</p>}
      {upcoming.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 2 }}>Your upcoming</div>
          {upcoming.slice(0, 4).map((b) => (
            <div key={b.id} className="row">
              <span>{b.display_name || b.resource_name || b.booking_type}</span>
              <span className="sub" style={{ margin: 0 }}>{fmtDate(b.booking_date)} · {slotLabel(b.start_time)}</span>
            </div>
          ))}
        </div>
      )}
      {!resources ? <p className="sub">Loading…</p> : golf.length > 0 ? (
        <Section title="⛳ Simulator Bays" items={golf} onPick={pick} />
      ) : (
        <div className="card">
          <div style={{ fontWeight: 800 }}>Bays by phone</div>
          <p className="sub" style={{ margin: "6px 0 0" }}>Call {BRAND.phone.replace("+1", "")} to reserve a simulator bay.</p>
        </div>
      )}
    </div>
  )
}

function Account({ user, onSignOut, onBilling }: { user: SessionUser; onSignOut: () => void; onBilling: () => void }) {
  return (
    <div>
      <h1 className="h1">My Account</h1>
      <div className="card">
        <div className="row"><span className="sub" style={{ margin: 0 }}>Name</span><span>{user.name || "—"}</span></div>
        <div className="row"><span className="sub" style={{ margin: 0 }}>Email</span><span>{user.email}</span></div>
      </div>
      <div className="card" role="button" onClick={onBilling}>
        <div style={{ fontWeight: 800 }}>Membership & billing →</div>
        <p className="sub" style={{ margin: "6px 0 0" }}>Plan, next charge, card on file, update payment.</p>
      </div>
      <a className="card link" href={`tel:${BRAND.phone}`} style={{ display: "block" }}>📞 Call the lounge</a>
      <button className="btn ghost" style={{ marginTop: 10 }} onClick={onSignOut}>Sign out</button>
      <p className="sub center" style={{ marginTop: 20, fontSize: 12 }}>Black Tee Golf Lounge · v1.0.0</p>
    </div>
  )
}

function BillingScreen({ onBack }: { onBack: () => void }) {
  const [d, setD] = useState<MeResponse | null>(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { me().then(setD).catch((e) => setErr(e.message)) }, [])
  async function updateCard() {
    setBusy(true)
    try { await Browser.open({ url: await openBillingPortal() }) }
    catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }
  const Header = (
    <>
      <button className="link" onClick={onBack} style={{ background: "none", border: 0, padding: 0, marginBottom: 10 }}>‹ Back</button>
      <h1 className="h1">Membership & Billing</h1>
    </>
  )
  if (err) return <div>{Header}<p className="sub">{err}</p></div>
  if (!d) return <div>{Header}<p className="sub">Loading…</p></div>
  const m = d.membership, b = d.billing
  const credit = b.accountBalanceCents < 0 ? -b.accountBalanceCents : 0
  return (
    <div>
      {Header}
      <div className="card">
        <div className="row"><span className="sub" style={{ margin: 0 }}>Plan</span><span>{m.planName || "—"}{m.isComp ? " (Comp)" : ""}</span></div>
        <div className="row"><span className="sub" style={{ margin: 0 }}>Status</span><span>{m.status || "—"}</span></div>
        <div className="row"><span className="sub" style={{ margin: 0 }}>Monthly</span><span>{money(m.monthlyPriceCents)}</span></div>
        {m.freezeUntil && <div className="row"><span className="sub" style={{ margin: 0 }}>Frozen until</span><span>{fmtDate(m.freezeUntil)}</span></div>}
        {m.cancelAtPeriodEnd && <div className="row"><span className="sub" style={{ margin: 0 }}>Ends</span><span>{fmtDate(m.currentPeriodEnd)}</span></div>}
      </div>
      <div className="card">
        <div className="row"><span className="sub" style={{ margin: 0 }}>Next charge</span><span>{money(b.nextInvoiceCents)}{b.nextInvoiceAt ? ` · ${fmtDate(b.nextInvoiceAt)}` : ""}</span></div>
        <div className="row"><span className="sub" style={{ margin: 0 }}>Last payment</span><span>{b.lastPayment ? `${money(b.lastPayment.amountCents)} · ${fmtDate(b.lastPayment.at)}` : "—"}</span></div>
        {b.outstandingCents > 0 && <div className="row"><span className="sub" style={{ color: "#f59e0b", margin: 0 }}>Balance due</span><span style={{ color: "#f59e0b" }}>{money(b.outstandingCents)}</span></div>}
        {credit > 0 && <div className="row"><span className="sub" style={{ color: "#22c55e", margin: 0 }}>Account credit</span><span style={{ color: "#22c55e" }}>{money(credit)}</span></div>}
      </div>
      <div className="card">
        <div className="row"><span className="sub" style={{ margin: 0 }}>Card on file</span><span>{b.cardBrand ? `${b.cardBrand.toUpperCase()} •••• ${b.cardLast4}` : "None"}</span></div>
      </div>
      {m.hasBilling
        ? <button className="btn" disabled={busy} onClick={updateCard}>{busy ? "Opening…" : "Update payment method"}</button>
        : <p className="sub center">No billing account on file yet.</p>}
    </div>
  )
}

import ReactDOM from "react-dom/client"
import "./styles.css"
ReactDOM.createRoot(document.getElementById("root")!).render(<App />)
