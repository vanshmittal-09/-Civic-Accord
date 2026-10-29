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

| Login | PIN |
|---|---|
| Resident's login (Citizen Riya) | 1111 |
| Officer's login (Officer Damodar) | 2222 |
| Supervisor's login (Supervisor Patel) | 3333 |

## How it works

- **Resolution Proposal**: officers cannot close complaints. They submit up to 4 photos (EXIF/GPS stripped in the browser), a work checklist and a note.
- **Citizen Confirmation**: the resident confirms or disputes with counter-photos. No response in 72 hours → *Uncontested Closure*.
- **Reasoned Review**: the supervisor compares complaint, officer proof and counter-proof side by side, then upholds or orders rework.
- **Finite state machine**: `SUBMITTED → RESOLUTION_PROPOSED → CONTESTED / CITIZEN_CONFIRMED / UNCONTESTED_CLOSURE → REWORK_ORDERED / REVIEWER_CLOSED`, with role checks on every transition.
- **Audit ledger**: every event is SHA-256 hash-chained to the previous one (tamper-evident). "Verify integrity" recomputes the chain.
- **Role-based access**: each role signs in with a PIN and can only open its own screen.

## Stack

React + Vite + Tailwind CSS. No backend: data is stored in browser LocalStorage. All case data is synthetic.

> Demo note: PIN checks and storage run in the browser for this prototype. A production system would enforce roles and store the ledger on a server.

## Team

Yashwardhan Insan · Tanishka Gupta · Vidhi Gaur · Vansh Mittal
