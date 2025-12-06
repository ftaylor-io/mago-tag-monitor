import { takeScreenshot } from './screenshot.js';
import { extractCurrentValue } from './extractValue.js';
import { assessCondition } from './assessCondition.js';
import { sendEmail } from './sendEmail.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

/**
 * Main function that orchestrates the monitoring process
 */
async function main() {
  let config; // Declare config outside try block so it's accessible in catch
  try {
    console.log('=== MAGO TAG Monitor Started ===');
    console.log(`Time: ${new Date().toLocaleString('pt-BR')}\n`);

    // Load configuration
    const configPath = path.join(__dirname, '..', 'config.json');
    
    if (fs.existsSync(configPath)) {
      const configFile = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configFile);
    } else {
      // Fallback to environment variables
      config = {
        websiteUrl: process.env.WEBSITE_URL || 'https://mago.ntag.com.br/empacotamento',
        thresholds: {
          criticoPut: parseInt(process.env.CRITICO_PUT) || 70500000,
          alertaPut: parseInt(process.env.ALERTA_PUT) || 68500000,
          alertaCall: parseInt(process.env.ALERTA_CALL) || 66500000,
          criticoCall: parseInt(process.env.CRITICO_CALL) || 64000000
        },
        email: {
          recipients: process.env.EMAIL_RECIPIENTS ? 
            (process.env.EMAIL_RECIPIENTS.startsWith('[') ? 
              JSON.parse(process.env.EMAIL_RECIPIENTS) : 
              process.env.EMAIL_RECIPIENTS.split(',').map(e => e.trim())) : [],
          from: process.env.EMAIL_FROM,
          subject: process.env.EMAIL_SUBJECT || 'MAGO TAG - Monitoramento de Empacotamento',
          apiKey: process.env.SENDGRID_API_KEY
        }
      };
    }

    // Validate configuration
    if (!config.email.apiKey) {
      throw new Error('SendGrid API key must be provided via config.json or environment variable (SENDGRID_API_KEY)');
    }

    if (!config.email.from) {
      throw new Error('From email address must be provided via config.json or environment variable (EMAIL_FROM)');
    }

    if (!config.email.recipients || config.email.recipients.length === 0) {
      throw new Error('At least one email recipient must be configured');
    }

    // Step 1: Take screenshot
    console.log('Step 1: Taking screenshot...');
    let screenshotPath;
    try {
      screenshotPath = await takeScreenshot(config.websiteUrl);
      console.log(`✓ Screenshot saved: ${screenshotPath}\n`);
    } catch (error) {
      throw new Error(`Failed to take screenshot from ${config.websiteUrl}: ${error.message}`);
    }

    // Step 2: Extract current value
    console.log('Step 2: Extracting current value...');
    let currentValue;
    try {
      currentValue = await extractCurrentValue(config.websiteUrl);
      console.log(`✓ Current value: ${currentValue.toLocaleString('pt-BR')}\n`);
    } catch (error) {
      throw new Error(`Failed to extract value from ${config.websiteUrl}: ${error.message}`);
    }

    // Step 3: Assess condition
    console.log('Step 3: Assessing condition...');
    let assessment;
    try {
      assessment = assessCondition(currentValue, config.thresholds);
      console.log(`✓ Assessment: ${assessment.status}`);
      console.log(`  ${assessment.message}\n`);
    } catch (error) {
      throw new Error(`Failed to assess condition: ${error.message}`);
    }

    // Step 4: Send email
    console.log('Step 4: Sending email notification...');
    try {
      await sendEmail(config.email, screenshotPath, assessment);
      console.log('✓ Email sent successfully\n');
    } catch (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }

    // Cleanup screenshot (optional - comment out if you want to keep it)
    // fs.unlinkSync(screenshotPath);
    // console.log('✓ Screenshot file cleaned up\n');

    console.log('=== Process completed successfully ===');

  } catch (error) {
    console.error('\n❌ Error in main process:', error.message || error);
    if (error.stack && process.env.NODE_ENV !== 'production') {
      console.error('Stack:', error.stack);
    }
    console.error('\nTroubleshooting tips:');
    console.error('- Check that all required GitHub Secrets are set (SENDGRID_API_KEY, EMAIL_FROM, EMAIL_RECIPIENTS)');
    const websiteUrl = config?.websiteUrl || process.env.WEBSITE_URL || 'https://mago.ntag.com.br/empacotamento';
    console.error('- Verify the website URL is accessible: ' + websiteUrl);
    console.error('- Check SendGrid dashboard for API key validity and rate limits');
    process.exit(1);
  }
}

// Run main function
main();

