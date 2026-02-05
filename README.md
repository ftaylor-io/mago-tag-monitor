# MAGO TAG Monitor

Automated monitoring system for the MAGO TAG graph at https://mago.ntag.com.br/empacotamento. This tool takes screenshots of the graph, extracts the current value, assesses it against predefined thresholds, and sends email notifications to your team.

## Features

- 📸 Automatic screenshot capture of the graph
- 🔍 Value extraction from CSV data
- 📊 Condition assessment based on thresholds
- 📧 Email notifications with screenshot and assessment
- ⏰ Scheduled runs twice daily (9:15 AM and 6:15 PM São Paulo time) via GitHub Actions
- 💰 **100% Free** - Uses free tier services only

## Thresholds

The system assesses values based on these thresholds:

- **Crítico PUT**: ≥ 70,500,000
- **Alerta PUT**: ≥ 68,500,000
- **Neutro**: 66,500,000 < value < 68,500,000
- **Alerta CALL**: ≥ 64,000,000 and ≤ 66,500,000
- **Crítico CALL**: < 64,000,000

## Setup Instructions

### Option 1: GitHub Actions (Recommended - Free)

1. **Fork or create a new GitHub repository** with this code

2. **Set up Resend Account**:
   - Sign up for a free account at https://resend.com
   - Verify your sender domain or email in Resend dashboard
   - Create an API key in the Resend dashboard
   - Copy the API key (you won't see it again!)

3. **Set up GitHub Secrets** (Repository Settings → Secrets and variables → Actions):
   - `RESEND_API_KEY`: Your Resend API key
   - `EMAIL_FROM`: Your verified sender email address (must be verified in Resend)
   - `EMAIL_RECIPIENTS`: Comma-separated list or JSON array, e.g., `email1@example.com,email2@example.com` or `["email1@example.com", "email2@example.com"]`
   - `EMAIL_SUBJECT`: (Optional) Custom email subject
   - `WEBSITE_URL`: (Optional) Defaults to `https://mago.ntag.com.br/empacotamento`
   - `CRITICO_PUT`: (Optional) Defaults to `70500000`
   - `ALERTA_PUT`: (Optional) Defaults to `68500000`
   - `ALERTA_CALL`: (Optional) Defaults to `66500000`
   - `CRITICO_CALL`: (Optional) Defaults to `64000000`

4. **Enable GitHub Actions** - The workflow will automatically run twice daily (9:15 AM and 6:15 PM São Paulo time)

5. **Test manually** - Go to Actions tab → "Monitor MAGO TAG Graph" → "Run workflow"

### Option 2: Local Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create `config.json`** from `config.example.json`:
   ```bash
   cp config.example.json config.json
   ```

3. **Edit `config.json`** with your settings:
   - Add email recipients
   - Add your Resend API key
   - Add your verified sender email address

4. **Set up Resend** (if not already done):
   - Sign up at https://resend.com (free account)
   - Verify your sender domain or email
   - Create an API key

5. **Run manually**:
   ```bash
   npm start
   ```

### Option 3: Environment Variables (Alternative to config.json)

Instead of `config.json`, you can use environment variables:

```bash
export RESEND_API_KEY="your-resend-api-key"
export EMAIL_RECIPIENTS="email1@example.com,email2@example.com"
export EMAIL_FROM="your-verified-email@example.com"
npm start
```

## Resend Setup

1. **Create Account**: Sign up at https://resend.com (free tier available)
2. **Verify Sender**: Verify a sender domain or a single sender email in the Resend dashboard
3. **Create API Key**:
   - Go to the API Keys section
   - Name it (e.g., "MAGO TAG Monitor")
   - **Copy the API key immediately** (usually starts with `re_`)
4. **Free Tier Limits**: Check Resend's current free tier limits for your account

## Project Structure

```
MAGO_TAG/
├── .github/
│   └── workflows/
│       └── monitor-graph.yml    # GitHub Actions workflow
├── src/
│   ├── index.js                 # Main orchestrator
│   ├── screenshot.js            # Screenshot functionality
│   ├── extractValueFromCsv.js   # CSV value extraction
│   ├── assessCondition.js       # Assessment logic
│   └── sendEmail.js             # Email sending
├── config.example.json          # Configuration template
├── package.json                 # Dependencies
└── README.md                    # This file
```

## How It Works

1. **Screenshot**: Uses Puppeteer to navigate to the website and capture the graph
2. **Extract Value**: Downloads and parses CSV data to extract the current Empacotamento value
3. **Assess**: Compares the value against thresholds to determine status
4. **Notify**: Sends an email with the screenshot and assessment

## Troubleshooting

### Value extraction fails
- The CSV download or format may have changed
- Check `src/extractValueFromCsv.js` and verify the CSV structure
- Ensure the website's CSV export functionality is working

### Email not sending
- Verify Resend API key is correct and active
- Ensure your sender email/domain is verified in Resend dashboard
- Check Resend dashboard for any error messages or rate limits
- Verify recipient emails are valid
- Check Resend logs for delivery status

### Screenshot is blank or wrong area
- Adjust the viewport size in `src/screenshot.js`
- Modify the screenshot area selector if needed
- Consider using `fullPage: true` option

## Cost

- **GitHub Actions**: 2,000 minutes/month free (sufficient for twice daily checks = ~60 minutes/month)
- **Resend**: Free tier limits vary by plan (sufficient for twice daily checks in most cases)
- **Total Cost**: **$0**

## License

ISC
