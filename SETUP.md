# GitHub, Netlify, and Supabase Setup

This project can run in two ways:

- Local preview: `npm start`, using `data/walk-to-wellness.json`.
- Public website: Netlify hosts the pages and API, Supabase stores the shared public data.

## 1. Create the Supabase project

1. Go to [Supabase](https://supabase.com/dashboard/projects) and create a new project.
2. Open the project, then go to **SQL Editor**.
3. Open [supabase/schema.sql](./supabase/schema.sql), copy the full SQL, paste it into the SQL Editor, and run it.
4. Open the private local file `data/participant-contacts.sql`, copy the full SQL, paste it into the SQL Editor, and run it. This loads the private name/email list used for `@First Last` message notifications.
5. Go to **Project Settings** > **API Keys**.
6. Copy these two values:
   - Project URL: `https://your-project-ref.supabase.co`
   - Secret key: starts with `sb_secret_`

Keep the secret key private. It belongs only in Netlify environment variables, never in browser code.

## 2. Create the GitHub repository

1. Go to [github.com/new](https://github.com/new).
2. Name the repository something like `walk-to-wellness-signups`.
3. Choose **Private** unless you intentionally want the code public.
4. Do not initialize with a README, `.gitignore`, or license because this folder already has project files.
5. Create the repository.

From this project folder, connect and push:

```bash
git init
git add .
git commit -m "Initial Walk to Wellness site"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/walk-to-wellness-signups.git
git push -u origin main
```

## 3. Create the Netlify site

1. Go to [Netlify](https://app.netlify.com/).
2. Choose **Add new project** or **Import an existing project**.
3. Connect GitHub and select the repository.
4. Use these build settings:
   - Build command: `npm run build`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
5. Deploy the site.

The included [netlify.toml](./netlify.toml) already contains those settings plus routing for `/api/*`.

## 4. Add environment variables in Netlify

In your Netlify site:

1. Open **Site configuration**.
2. Go to **Environment variables**.
3. Add:
   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_SECRET_KEY` = your Supabase secret key
   - `ADMIN_USERNAME` = `admin` or your preferred admin username
   - `ADMIN_PASSWORD` = a private password only you know
   - `ADMIN_SESSION_SECRET` = a long random phrase used to secure the admin login cookie
   - `RESEND_API_KEY` = your Resend API key
   - `WALK_EMAIL_FROM` = `noreply@bhhwalktowellness.com`
   - `PUBLIC_SITE_URL` = your live Netlify site URL, such as `https://your-site.netlify.app`
4. Save, then trigger a new deploy.

## 5. Set up tag notification emails

The Messages page supports tagging with `@First Last`. When a message or reply includes a name from the Supabase `participant_contacts` table, the system sends that person an email notification.

Use [Resend](https://resend.com/) for sending:

1. Create or open your Resend account.
2. Add and verify the sending domain `bhhwalktowellness.com` in the [Resend Domains dashboard](https://resend.com/docs/dashboard/domains/introduction).
3. Create an API key in Resend.
4. Add the API key to Netlify as `RESEND_API_KEY`.
5. Make sure `WALK_EMAIL_FROM` is set to `noreply@bhhwalktowellness.com`.

## 6. Use the admin page

After the deploy finishes, open the Admin page:

```text
https://your-netlify-site.netlify.app/admin
```

Log in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` you added in Netlify. From there you can rename teams, add or remove team members, and delete teams created by mistake.

## 7. Test the public site

After the new deploy finishes:

1. Open the Netlify URL.
2. Create a team.
3. Join that team with a test name.
4. Submit miles on the Enter Distance page.
5. Post a test encouragement message on the Messages page.
6. Post another test message that tags someone exactly as `@First Last`.
7. Confirm the tagged person receives an email.
8. Confirm the Live Feed charts update.
9. Open `/admin`, log in, and confirm you can manage the test team.

If anything fails, check **Netlify** > **Functions** > `api` logs first. Most setup issues are either missing environment variables or the Supabase SQL schema not being run yet.

## Message wall troubleshooting

If the Messages page says messaging is not set up, go back to Supabase **SQL Editor** and run the full [supabase/schema.sql](./supabase/schema.sql) file from the very first line. Do not run only the message-wall section, because the message tables connect back to the `teams` table.

If the rest of the site is already working and only the Messages page is stuck, you can run [supabase/message-wall-repair.sql](./supabase/message-wall-repair.sql) instead. That file repairs the message wall tables, the private tag contact table, and refreshes Supabase's API cache.

If tagging works visually but no email arrives, check that:

- The tagged name exactly matches the format in Supabase, like `@Rebecca Kaul`.
- `participant_contacts` has that person's email address.
- `RESEND_API_KEY` is set in Netlify.
- `bhhwalktowellness.com` is verified in Resend.
- `WALK_EMAIL_FROM` is set to `noreply@bhhwalktowellness.com`.

If Supabase shows `relation "public.teams" does not exist`, that is the sign that the full schema has not run from the top yet. Start again at:

```sql
create extension if not exists "pgcrypto";
```

Then run the whole file in one pass.
