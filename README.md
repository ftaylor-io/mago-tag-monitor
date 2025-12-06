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

2. **Set up SendGrid Account**:
   - Sign up for a free account at https://sendgrid.com
   - Verify your sender email address in SendGrid dashboard
   - Create an API key: Settings → API Keys → Create API Key
   - Give it "Mail Send" permissions
   - Copy the API key (you won't see it again!)

3. **Set up GitHub Secrets** (Repository Settings → Secrets and variables → Actions):
   - `SENDGRID_API_KEY`: Your SendGrid API key
   - `EMAIL_FROM`: Your verified sender email address (must be verified in SendGrid)
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
   - Add your SendGrid API key
   - Add your verified sender email address

4. **Set up SendGrid** (if not already done):
   - Sign up at https://sendgrid.com (free account)
   - Verify your sender email address
   - Create an API key with "Mail Send" permissions

5. **Run manually**:
   ```bash
   npm start
   ```

### Option 3: Environment Variables (Alternative to config.json)

Instead of `config.json`, you can use environment variables:

```bash
export SENDGRID_API_KEY="your-sendgrid-api-key"
export EMAIL_RECIPIENTS="email1@example.com,email2@example.com"
export EMAIL_FROM="your-verified-email@example.com"
npm start
```

## SendGrid Setup

1. **Create Account**: Sign up at https://sendgrid.com (free tier available)
2. **Verify Sender**: Go to Settings → Sender Authentication → Verify a Single Sender
   - Enter your email address
   - Check your email and click the verification link
3. **Create API Key**: 
   - Go to Settings → API Keys → Create API Key
   - Name it (e.g., "MAGO TAG Monitor")
   - Select "Mail Send" permission
   - Click "Create & View"
   - **Copy the API key immediately** (starts with `SG.`)
4. **Free Tier Limits**: 100 emails/day (sufficient for twice daily checks = 2 emails/day)

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
- Verify SendGrid API key is correct and has "Mail Send" permission
- Ensure your sender email is verified in SendGrid dashboard
- Check SendGrid dashboard for any error messages or rate limits
- Verify recipient emails are valid
- Check SendGrid activity feed for delivery status

### Screenshot is blank or wrong area
- Adjust the viewport size in `src/screenshot.js`
- Modify the screenshot area selector if needed
- Consider using `fullPage: true` option

## Cost

- **GitHub Actions**: 2,000 minutes/month free (sufficient for twice daily checks = ~60 minutes/month)
- **SendGrid**: Free tier includes 100 emails/day (sufficient for twice daily checks = 2 emails/day)
- **Total Cost**: **$0**

## License

ISC

