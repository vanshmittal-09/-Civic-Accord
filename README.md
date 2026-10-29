# Civic Accord — Team Omniverse

**Transparent Systems. Stronger Communities.**

A civic complaint system where a ticket marked "Resolved" must be **verified by the resident** before it closes.
Officers propose a resolution with photo proof, residents confirm or dispute it, and disputes go to a supervisor
for a binding, reasoned ruling. Every step is recorded in a hash-chained, append-only audit ledger.

## Run it

```bash
npm install
npm run dev
```

Open the URL shown (usually http://localhost:5173).

| Login | How to sign in |
|---|---|
| Resident's login (demo: Riya) | Mobile `9876543210`, PIN `1111`. Or tap **New resident? Create an account** |
| Officer's login (Officer Damodar) | PIN `2222` |
| Supervisor's login (Supervisor Patel) | PIN `3333` |

Without a database the app still works, but accounts and cases stay in that one browser.
To share them across every browser and device, connect Supabase (below).

## Connect the online database (Supabase), about 10 minutes

1. **Create a project.** Go to [supabase.com](https://supabase.com), sign in, click **New project**, pick a name, a database password and the region closest to you (e.g. Mumbai). Wait about 2 minutes while it starts.
2. **Create the tables.** In the project, open **SQL Editor → New query**, paste everything from [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success. No rows returned".
3. **Turn on live updates.** Open **Database → Publications → supabase_realtime** and make sure the **events** table is switched on. (The script tries to do this for you.)
4. **Copy your keys.** Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
5. **Add them to the app.** Copy `.env.example` to a new file named `.env` and paste the two values:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
   Restart `npm run dev`. The `.env` file is ignored by git, so your keys aren't pushed to GitHub.
6. **Check it.** Create a resident account in one browser, then sign in with the same mobile number and PIN in a different browser. It should work, and a complaint filed in one appears in the other within a second.

### Put it online for other devices (Vercel, free)

1. Push this project to GitHub.
2. On [vercel.com](https://vercel.com), click **Add New → Project** and import the repository. Vercel detects Vite automatically.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values.
4. Click **Deploy**. Open the link on any phone or laptop: everyone shares the same accounts and cases, live.

### What's stored where

| Data | With Supabase | Without Supabase |
|---|---|---|
| Resident accounts | `residents` table. PIN stored only as a bcrypt hash; the table can't be read directly, only through the sign-up and sign-in functions | This browser's local storage (salted SHA-256 PIN hash) |
| Wrong-PIN protection | 5 wrong PINs lock that number for 15 minutes | 3 wrong tries lock the screen for 30 seconds |
| Complaints, proofs, rulings | `events` table: anyone can read and add entries, nobody can edit or delete them; the database rejects any entry that doesn't follow the previous one | This browser's local storage |
| Who is signed in | This browser tab only (session storage) | Same |

If the database can't be reached (no internet, wrong keys), the app shows a yellow notice and keeps working with this device's own copy.

> ⚠️ Before real use: remove the `reset_demo` function from the database (anyone using the app can call it), move officer and supervisor accounts out of the code into the database, and store photos in Supabase Storage instead of inside the ledger.

## AI photo check (supervisor)

When a dispute reaches the supervisor, **AI photo check** reviews every photo in the case and gives each one an advisory verdict: *Looks like a real camera photo*, *Needs a closer look*, or *Likely AI-generated or edited*, with the reasons.

- **Built-in checks (no setup):** when a photo is taken, before its metadata is stripped, the app keeps only the camera make/model, the capture time and any editing software, and looks for traces AI tools leave in files (Midjourney, DALL·E, Stable Diffusion settings, the IPTC "made by AI" tag, common AI image sizes). Location is never kept.
- **Optional AI detection model:** a Supabase Edge Function sends the photo to [Sightengine](https://sightengine.com/docs/ai-generated-image-detection)'s AI-generated image detector and shows a 0–100% score. To turn it on:
  1. Create a free Sightengine account and copy your API user and API secret.
  2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then in this folder run:
     ```bash
     supabase login
     supabase link --project-ref YOUR-PROJECT-ID
     supabase secrets set SIGHTENGINE_API_USER=your-user SIGHTENGINE_API_SECRET=your-secret
     supabase functions deploy detect-ai-image
     ```
  3. In the app, the supervisor clicks **Run AI detection model** under any photo.

> No detector is perfect. The check is advice for the supervisor's ruling, never an automatic decision.

### Upload screening and warnings

Every photo a resident or officer uploads is screened the moment it's added (`src/photoGuard.js`), using the same checks plus the detection model when it's deployed.
Real photos are added silently. An AI-generated photo is rejected with a warning ("Warning 1 of 3"). After **3 warnings** the account can't upload photos until a supervisor clears it from **Flagged accounts**. With Supabase connected, warnings are stored in the `photo_warnings` table, so they follow the person to any device.

## How it works

- **Resolution Proposal**: officers cannot close complaints. They submit up to 4 photos (EXIF/GPS stripped in the browser), a work checklist and a note.
- **Citizen Confirmation**: the resident confirms or disputes with counter-photos. No response in 72 hours → *Uncontested Closure*.
- **Reasoned Review**: the supervisor compares complaint, officer proof and counter-proof side by side, then upholds or orders rework.
- **Finite state machine**: `SUBMITTED → RESOLUTION_PROPOSED → CONTESTED / CITIZEN_CONFIRMED / UNCONTESTED_CLOSURE → REWORK_ORDERED / REVIEWER_CLOSED`, with role checks on every transition.
- **Audit ledger**: every event is SHA-256 hash-chained to the previous one (tamper-evident). "Verify integrity" recomputes the chain.
- **Role-based access**: each role can only open its own screen. Residents sign up with name, mobile number, Gmail, address and a 4-digit PIN; clicking the profile icon shows the user's details; officer and supervisor accounts are fixed.

## Stack

React + Vite + Tailwind CSS, with optional Supabase (Postgres + realtime) for shared storage. All case data and photos in the demo are synthetic.

## Team

Yashwardhan Insan · Tanishka Gupta · Vidhi Gaur · Vansh Mittal
