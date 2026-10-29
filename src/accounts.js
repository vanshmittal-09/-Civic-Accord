// accounts.js — resident accounts (sign up + sign in) and staff profiles.
// Residents register with name, mobile, Gmail, address and a 4-digit PIN.
// PINs are stored only as salted SHA-256 hashes. Officer and supervisor accounts are fixed.
// With Supabase configured, accounts live in the online database (PINs hashed with bcrypt
// on the server) so they work on every device. Without it, they stay in this browser.
import { CLOUD, getSupabase } from "./supabase";

const USERS_KEY = "civicaccord_residents_v1";
let memoryUsers = null; // fallback when browser storage is blocked

// Built-in demo resident (matches the deck's Case #1084). Synthetic data.
export const DEMO_RESIDENT = {
  id: "riya",
  name: "Riya",
  mobile: "9876543210",
  pin: "1111",
  email: "riya.demo@gmail.com",
  address: "House 42, Sector 14",
  city: "Faridabad",
  pincode: "121007",
  createdAt: Date.UTC(2026, 9, 1),
};

// Fixed staff accounts (issued by the municipality). Synthetic data.
export const STAFF_PROFILES = {
  damodar: {
    name: "Officer Damodar",
    role: "Field Officer",
    staffId: "SAN-OFF-014",
    department: "Municipal Corporation",
    zone: "Sectors 14–17",
    email: "damodar.municipal@gmail.com",
  },
  patel: {
    name: "Supervisor Patel",
    role: "Supervisor",
    staffId: "SAN-SUP-003",
    department: "Municipal Corporation",
    zone: "Sectors 14–17",
    email: "patel.municipal@gmail.com",
  },
};

async function hashPin(mobile, pin) {
  const data = new TextEncoder().encode(`civicaccord:${mobile}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadUsers() {
  try {
    const stored = JSON.parse(localStorage.getItem(USERS_KEY) || "null");
    if (Array.isArray(stored)) return (memoryUsers = stored);
  } catch { /* storage blocked */ }
  return memoryUsers || [];
}

function saveUsers(list) {
  memoryUsers = list;
  try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch { /* memory only */ }
}

export const normalizeMobile = (m) => String(m || "").replace(/\D/g, "").slice(-10);
export const isValidMobile = (m) => /^[6-9]\d{9}$/.test(m);
export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());
export const isValidPincode = (p) => /^[1-9]\d{5}$/.test(String(p || ""));

const publicProfile = (u) => ({
  id: u.id, name: u.name, mobile: u.mobile, email: u.email || "", address: u.address || "",
  city: u.city || "", pincode: u.pincode || "", createdAt: u.createdAt || null,
});

// Database errors we raise ourselves are already readable; anything else gets a plain message.
function friendly(error) {
  const msg = (error && error.message) || "";
  if (/registered|valid|Enter |PIN|Too many/.test(msg)) return msg;
  return "Couldn't reach the online database. Check your internet connection and try again.";
}

/** Creates a resident account. Throws a readable Error if it can't. */
export async function registerResident({ name, mobile, pin, email, address, city, pincode }) {
  const cleanName = String(name || "").trim().replace(/\s+/g, " ");
  const m = normalizeMobile(mobile);
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (cleanName.length < 2) throw new Error("Enter your full name.");
  if (!isValidMobile(m)) throw new Error("Enter a valid 10-digit mobile number.");
  if (!isValidEmail(cleanEmail)) throw new Error("Enter a valid email address.");
  if (String(address || "").trim().length < 5) throw new Error("Enter your house number and street.");
  if (String(city || "").trim().length < 2) throw new Error("Enter your city.");
  if (!isValidPincode(pincode)) throw new Error("Enter a valid 6-digit PIN code.");
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be exactly 4 digits.");
  if (CLOUD) {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc("register_resident", {
      p_name: cleanName, p_mobile: m, p_email: cleanEmail, p_address: String(address).trim(),
      p_city: String(city).trim(), p_pincode: String(pincode), p_pin: pin,
    });
    if (error) throw new Error(friendly(error));
    return data;
  }
  const users = loadUsers();
  if (m === DEMO_RESIDENT.mobile || users.some((u) => u.mobile === m)) {
    throw new Error("This mobile number is already registered. Sign in instead.");
  }
  if (cleanEmail === DEMO_RESIDENT.email || users.some((u) => u.email === cleanEmail)) {
    throw new Error("This email is already registered. Sign in instead.");
  }
  const user = {
    id: `r_${m}`,
    name: cleanName,
    mobile: m,
    email: cleanEmail,
    address: String(address).trim(),
    city: String(city).trim(),
    pincode: String(pincode),
    pinHash: await hashPin(m, pin),
    createdAt: Date.now(),
  };
  saveUsers([...users, user]);
  return publicProfile(user);
}

/** Returns the resident if mobile + PIN match, otherwise null. */
export async function verifyResident(mobile, pin) {
  const m = normalizeMobile(mobile);
  if (CLOUD) {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc("verify_resident", { p_mobile: m, p_pin: pin });
    if (error) throw new Error(friendly(error));
    return data || null;
  }
  if (m === DEMO_RESIDENT.mobile) {
    return pin === DEMO_RESIDENT.pin ? publicProfile(DEMO_RESIDENT) : null;
  }
  const user = loadUsers().find((u) => u.mobile === m);
  if (!user) return null;
  return user.pinHash === (await hashPin(m, pin)) ? publicProfile(user) : null;
}

/** Profile details for the signed-in resident (never includes the PIN). */
export function getResident(id) {
  if (id === DEMO_RESIDENT.id) return publicProfile(DEMO_RESIDENT);
  const user = loadUsers().find((u) => u.id === id);
  return user ? publicProfile(user) : null;
}
