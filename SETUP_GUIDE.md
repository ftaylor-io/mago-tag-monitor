# Step-by-Step Setup Guide

Follow these steps to get your MAGO TAG monitor running on GitHub Actions.

## Step 1: Set Up Resend Account

1. **Sign up for Resend**: Go to https://resend.com and create a free account
   - Check Resend's current free tier limits for your account

2. **Verify Your Sender Domain or Email**:
   - Go to Resend Dashboard → Domains or Single Sender
   - Verify your domain or a single sender email
   - **Important**: You can only send emails FROM verified senders

3. **Create an API Key**:
   - Go to API Keys → "Create API Key"
   - Name it (e.g., "MAGO TAG Monitor")
   - Click "Create"
   - **Copy the API key immediately** (usually starts with `re_` and you won't see it again!)
   - Save it securely - you'll need it for Step 4

## Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `mago-tag-monitor` (or any name you prefer)
3. Description: "Automated monitoring for MAGO TAG graph"
4. Set to **Public** (required for free GitHub Actions)
   - Or use a private repo if you have GitHub Pro/Team
5. **Do NOT** initialize with README, .gitignore, or license (we already have these)
6. Click **Create repository**

## Step 3: Push Code to GitHub

Open your terminal in the project directory and run:

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: MAGO TAG monitor automation"

# Add your GitHub repository as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/mago-tag-monitor.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Alternative**: If you prefer using GitHub Desktop or VS Code's Git integration:
1. Open the project folder
2. Initialize repository
3. Commit all files
4. Push to the GitHub repository you created

## Step 4: Configure GitHub Secrets

1. Go to your repository on GitHub
2. Click **Settings** (top menu)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret** for each of the following:

### Required Secrets:

**RESEND_API_KEY**
- Name: `RESEND_API_KEY`
- Value: Your Resend API key from Step 1 (usually starts with `re_`)

**EMAIL_FROM**
- Name: `EMAIL_FROM`
- Value: Your verified sender email address (must be verified in Resend)

**EMAIL_RECIPIENTS**
- Name: `EMAIL_RECIPIENTS`
- Value: Either:
  - Comma-separated: `email1@example.com,email2@example.com,email3@example.com`
  - OR JSON array: `["email1@example.com","email2@example.com","email3@example.com"]`

### Optional Secrets (only if you want to customize):

**EMAIL_SUBJECT**
- Name: `EMAIL_SUBJECT`
- Value: Custom subject line (default: "MAGO TAG - Monitoramento de Empacotamento")

**WEBSITE_URL**
- Name: `WEBSITE_URL`
- Value: Only if URL changes (default: `https://mago.ntag.com.br/empacotamento`)

**Threshold values** (only if different from defaults):
- `CRITICO_PUT` (default: 70500000)
- `ALERTA_PUT` (default: 68500000)
- `ALERTA_CALL` (default: 66500000)
- `CRITICO_CALL` (default: 64000000)

## Step 5: Test the Workflow

1. Go to your repository on GitHub
2. Click the **Actions** tab (top menu)
3. You should see "Monitor MAGO TAG Graph" workflow
4. Click on it, then click **Run workflow** → **Run workflow** (green button)
5. This will manually trigger the workflow to test it
6. Click on the running workflow to see the logs in real-time
7. Wait for it to complete (usually 1-2 minutes)

### What to Check:

- ✅ All steps should show green checkmarks
- ✅ Look for "Email sent successfully!" in the logs
- ✅ Check your email inbox for the test notification
- ✅ If there are errors, check the logs for details

## Step 6: Verify Scheduled Runs

1. The workflow is set to run automatically twice daily (9:15 AM and 6:15 PM São Paulo time)
2. You can see scheduled runs in the **Actions** tab
3. The next run time will be shown in the workflow schedule
4. You'll receive emails twice daily with the graph and assessment

## Troubleshooting

### "Email not sending"
- Verify your Resend API key is correct (usually starts with `re_`)
- Ensure your sender email/domain is verified in Resend dashboard
- Check Resend logs for delivery status and errors
- Check if you've hit the free tier limit

### "Could not extract value"
- The website structure may have changed
- Check the workflow logs to see what was extracted
- You may need to adjust `src/extractValue.js`

### "Workflow not running automatically"
- Make sure the repository is **Public** (or you have GitHub Pro)
- Check that Actions are enabled: Settings → Actions → General → Allow all actions

### "Screenshot is blank"
- The page might need more time to load
- Check `src/screenshot.js` and increase the wait time if needed

## Monitoring Your Automation

- **View logs**: Go to Actions tab → Click on any workflow run
- **View screenshots**: Screenshots are saved as artifacts (downloadable for 1 day)
- **Manual trigger**: You can always click "Run workflow" to test manually

## Next Steps

Once everything is working:
- Share the email notifications with your team
- Adjust thresholds in GitHub Secrets if needed
- Monitor the first few runs to ensure everything works correctly

---

**Need Help?** Check the main README.md for more details on configuration and troubleshooting.
