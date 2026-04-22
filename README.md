# Overtime Manager — Al Manaber

## Quick Deploy (30 minutes)

### Step 1: Supabase (Database)
1. Go to **supabase.com** → Create account → New Project
2. Open **SQL Editor** → paste the contents of `supabase-setup.sql` → Run
3. Go to **Settings → API** → copy your **Project URL** and **anon key**

### Step 2: Create User Accounts
In Supabase → **Authentication → Users** → click **Add User** for each person:
- Add their email + a temporary password
- After creating the auth user, go to **SQL Editor** and link them:

```sql
-- Example: Link an auth user to an employee profile
INSERT INTO user_profiles (id, role, profile_id) VALUES (
  'AUTH_USER_UUID_HERE',           -- from Authentication → Users → click user → copy ID
  'employee',                       -- or 'manager' or 'admin'
  'EMPLOYEE_OR_MANAGER_UUID_HERE'  -- from employees or managers table
);
```

### Step 3: Deploy
1. Upload this folder to GitHub (create a new repository)
2. Go to **vercel.com** → New Project → Import your repo
3. Add Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
4. Click Deploy → Your app is live!

### Step 4: Share
Send each employee/manager:
- The URL (e.g. `https://overtime-manager.vercel.app`)
- Their email and temporary password
- They can use it immediately

## File Structure
```
overtime-app/
├── app/
│   ├── globals.css       ← Styles + Tailwind
│   ├── layout.js         ← HTML wrapper
│   └── page.js           ← THE ENTIRE APP (Supabase-connected)
├── lib/
│   ├── supabase.js       ← Database connection
│   └── email.js          ← EmailJS integration
├── .env.local            ← YOUR KEYS GO HERE
├── package.json          ← Dependencies
├── supabase-setup.sql    ← Run this in Supabase SQL Editor
└── README.md             ← This file
```
