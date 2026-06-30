# GitHub, Netlify, and Supabase Setup

This project can run in two ways:

- Local preview: `npm start`, using `data/walk-to-wellness.json`.
- Public website: Netlify hosts the pages and API, Supabase stores the shared public data.

## 1. Create the Supabase project

1. Go to [Supabase](https://supabase.com/dashboard/projects) and create a new project.
2. Open the project, then go to **SQL Editor**.
3. Open [supabase/schema.sql](./supabase/schema.sql), copy the full SQL, paste it into the SQL Editor, and run it.
4. Go to **Project Settings** > **API Keys**.
5. Copy these two values:
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
4. Save, then trigger a new deploy.

## 5. Use the admin page

After the deploy finishes, open the Admin page:

```text
https://your-netlify-site.netlify.app/admin
```

Log in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` you added in Netlify. From there you can rename teams, add or remove team members, and delete teams created by mistake.

## 6. Test the public site

After the new deploy finishes:

1. Open the Netlify URL.
2. Create a team.
3. Join that team with a test name.
4. Submit miles on the Step Submission page.
5. Confirm the Live Feed charts update.
6. Open `/admin`, log in, and confirm you can manage the test team.

If anything fails, check **Netlify** > **Functions** > `api` logs first. Most setup issues are either missing environment variables or the Supabase SQL schema not being run yet.
