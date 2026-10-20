import { CapacitorHttp } from "@capacitor/core"
import { Preferences } from "@capacitor/preferences"

// ---- Brand (TB Fit Club) ----
export const BRAND = {
  name: "Black Tee Golf Lounge",
  tagline: "Premium indoor golf · OKC",
  primary: "#C41E3A",
  bg: "#0a0a0a",
  apiBase: "https://tbfitclub.com",
  phone: "+14058499173",
}

const TOKEN_KEY = "auth-token"
const USER_KEY = "auth-user"

export type SessionUser = { id: string; email: string; name: string | null }

export async function getToken(): Promise<string | null> {
  return (await Preferences.get({ key: TOKEN_KEY })).value
}
export async function getStoredUser(): Promise<SessionUser | null> {
  const v = (await Preferences.get({ key: USER_KEY })).value
  return v ? (JSON.parse(v) as SessionUser) : null
}
async function store(token: string, user: SessionUser) {
  await Preferences.set({ key: TOKEN_KEY, value: token })
  await Preferences.set({ key: USER_KEY, value: JSON.stringify(user) })
}
export async function signOut() {
  await Preferences.remove({ key: TOKEN_KEY })
  await Preferences.remove({ key: USER_KEY })
}
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  return token ? { Cookie: `auth-token=${token}` } : {}
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const res = await CapacitorHttp.post({
    url: `${BRAND.apiBase}/api/mobile/login`,
    headers: { "Content-Type": "application/json" },
    data: { email, password },
  })
  if (res.status >= 400) throw new Error((res.data && res.data.error) || "Login failed")
  const { token, user } = res.data as { token: string; user: SessionUser }
  await store(token, user)
  return user
}

export async function verifySession(): Promise<SessionUser | null> {
  try {
    const res = await CapacitorHttp.get({ url: `${BRAND.apiBase}/api/auth/session`, headers: await authHeaders() })
    const u = res.data && res.data.user
    return u ? (u as SessionUser) : null
  } catch {
    return null
  }
}

export type Membership = {
  status: string | null; planCode: string | null; planName: string | null
  monthlyPriceCents: number | null; isComp: boolean; currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean; freezeUntil: string | null; hasBilling: boolean
}
export type Billing = {
  lastPayment: { amountCents: number; at: string } | null
  outstandingCents: number; accountBalanceCents: number
  cardBrand: string | null; cardLast4: string | null
  nextInvoiceCents: number | null; nextInvoiceAt: string | null
}
export type MeResponse = {
  user: { id: string; name: string | null; email: string; phone: string | null; checkInCode: string | null; avatar: string | null }
  membership: Membership
  billing: Billing
}

export async function me(): Promise<MeResponse> {
  const res = await CapacitorHttp.get({ url: `${BRAND.apiBase}/api/mobile/me`, headers: await authHeaders() })
  if (res.status >= 400) throw new Error((res.data && res.data.error) || "Could not load your account")
  return res.data as MeResponse
}
export async function openBillingPortal(): Promise<string> {
  const res = await CapacitorHttp.post({
    url: `${BRAND.apiBase}/api/mobile/billing-portal`,
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    data: {},
  })
  if (res.status >= 400) throw new Error((res.data && res.data.error) || "Could not open billing")
  return (res.data as { url: string }).url
}
export async function walletPassUrl(): Promise<string> {
  const token = await getToken()
  return `${BRAND.apiBase}/api/mobile/wallet-pass?token=${encodeURIComponent(token || "")}`
}

// ---- Booking (/api/book) ----
export type BookResource = {
  id: number; kind: string; name: string; capacity: number | null
  duration_minutes: number; rate_member_cents: number | null; rate_public_cents: number | null
}
export type Slot = { start: string; end: string; available: boolean }
export type UpcomingBooking = {
  id: number; resource_name: string | null; display_name?: string | null
  booking_type: string; booking_date: string; start_time: string; end_time: string; status: string
}

export async function listResources(): Promise<BookResource[]> {
  const res = await CapacitorHttp.get({ url: `${BRAND.apiBase}/api/book`, headers: await authHeaders() })
  if (res.status >= 400) throw new Error("Could not load booking options")
  return (res.data?.resources || []) as BookResource[]
}
export async function getSlots(resourceId: number, date: string): Promise<{ resource: BookResource; slots: Slot[] }> {
  const res = await CapacitorHttp.get({
    url: `${BRAND.apiBase}/api/book?resourceId=${resourceId}&date=${date}`,
    headers: await authHeaders(),
  })
  if (res.status >= 400) throw new Error((res.data && res.data.error) || "Could not load times")
  return res.data as { resource: BookResource; slots: Slot[] }
}
export async function book(resourceId: number, date: string, startTime: string): Promise<{ booked?: boolean; url?: string; id?: number }> {
  const res = await CapacitorHttp.post({
    url: `${BRAND.apiBase}/api/book`,
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    data: { resourceId: String(resourceId), date, startTime },
  })
  if (res.status >= 400) throw new Error((res.data && res.data.error) || "Could not book")
  return res.data as { booked?: boolean; url?: string; id?: number }
}
export async function upcomingBookings(): Promise<UpcomingBooking[]> {
  try {
    const res = await CapacitorHttp.get({ url: `${BRAND.apiBase}/api/bookings?upcoming=true`, headers: await authHeaders() })
    if (res.status >= 400) return []
    return (res.data?.bookings || []) as UpcomingBooking[]
  } catch { return [] }
}

// ---- Push notifications (iOS APNs) ----
// Registers the device with APNs, then hands the device token to our server so
// staff broadcasts can reach this phone. Safe to call on every launch; it only
// prompts the first time. No-ops cleanly on web / when the plugin is absent.
export async function registerPush(): Promise<void> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications")
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== "granted") return

    PushNotifications.removeAllListeners()
    PushNotifications.addListener("registration", async (t) => {
      try {
        await Preferences.set({ key: "push-token", value: t.value })
        await CapacitorHttp.post({
          url: `${BRAND.apiBase}/api/mobile/register-push`,
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          data: { token: t.value, platform: "ios" },
        })
      } catch {}
    })
    PushNotifications.addListener("registrationError", () => {})
    await PushNotifications.register()
  } catch {
    // plugin not available (e.g. web build) — ignore
  }
}

// Tells the server to stop sending to this device (called on sign-out).
export async function unregisterPush(): Promise<void> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications")
    const token = (await Preferences.get({ key: "push-token" })).value
    if (token) {
      await CapacitorHttp.request({
        method: "DELETE",
        url: `${BRAND.apiBase}/api/mobile/register-push`,
        headers: { "Content-Type": "application/json" },
        data: { token },
      })
    }
    await PushNotifications.removeAllListeners()
  } catch {}
}
