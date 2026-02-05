import { takeScreenshot } from './screenshot.js';
import { extractCurrentValueFromCsv } from './extractValueFromCsv.js';
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

// Check for dry-run flag
const isDryRun = process.argv.includes('--dry-run');

/**
 * Calculate the last complete hour based on current time
 * Complete hour = most recent hour that has fully passed
 * @returns {number} The last complete hour (0-23)
 */
function getLastCompleteHour() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // If we're at the start of an hour (minute 0), that hour is complete
  // Otherwise, the last complete hour is the previous hour
  if (currentMinute === 0) {
    return currentHour;
  } else {
    return currentHour - 1;
  }
}

/**
 * Get threshold range description for the current value
 * @param {number} currentValue - The current value
 * @param {Object} thresholds - Threshold configuration
 * @returns {string} Description of the threshold range
 */
function getThresholdRange(currentValue, thresholds) {
  const { criticoPut, alertaPut, alertaCall, criticoCall } = thresholds;
  
  if (currentValue >= criticoPut) {
    return `>= ${criticoPut.toLocaleString('pt-BR')} (Crítico PUT)`;
  } else if (currentValue >= alertaPut) {
    return `${alertaPut.toLocaleString('pt-BR')} - ${criticoPut.toLocaleString('pt-BR')} (Alerta PUT)`;
  } else if (currentValue > alertaCall && currentValue < alertaPut) {
    return `${alertaCall.toLocaleString('pt-BR')} - ${alertaPut.toLocaleString('pt-BR')} (Neutro)`;
  } else if (currentValue >= criticoCall && currentValue <= alertaCall) {
    return `${criticoCall.toLocaleString('pt-BR')} - ${alertaCall.toLocaleString('pt-BR')} (Alerta CALL)`;
  } else {
    return `< ${criticoCall.toLocaleString('pt-BR')} (Crítico CALL)`;
  }
}

/**
 * Main function that orchestrates the monitoring process
 */
async function main() {
  let config; // Declare config outside try block so it's accessible in catch
  try {
    if (isDryRun) {
      console.log('=== MAGO TAG Monitor Started (DRY RUN MODE) ===');
      console.log('⚠️  Email sending and screenshot capture will be skipped\n');
    } else {
      console.log('=== MAGO TAG Monitor Started ===');
    }
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
          apiKey: process.env.RESEND_API_KEY
        }
      };
    }

    // Validate configuration (skip email validation in dry-run mode)
    if (!isDryRun) {
      if (!config.email.apiKey) {
        throw new Error('Resend API key must be provided via config.json or environment variable (RESEND_API_KEY)');
      }

      if (!config.email.from) {
        throw new Error('From email address must be provided via config.json or environment variable (EMAIL_FROM)');
      }

      if (!config.email.recipients || config.email.recipients.length === 0) {
        throw new Error('At least one email recipient must be configured');
      }
    }

    // Step 1: Take screenshot (skip in dry-run mode)
    let screenshotPath;
    if (!isDryRun) {
      console.log('Step 1: Taking screenshot...');
      try {
        screenshotPath = await takeScreenshot(config.websiteUrl);
        console.log(`✓ Screenshot saved: ${screenshotPath}\n`);
      } catch (error) {
        throw new Error(`Failed to take screenshot from ${config.websiteUrl}: ${error.message}`);
      }
    } else {
      console.log('Step 1: Taking screenshot... (SKIPPED in dry-run mode)\n');
    }

    // Step 2: Extract current value from CSV
    console.log('Step 2: Extracting current value from CSV...');
    let currentValue;
    let dataTimestamp;
    let dataHour;
    let dataMinute;
    try {
      const result = await extractCurrentValueFromCsv(config.websiteUrl);
      currentValue = result.value;
      dataTimestamp = result.timestamp;
      dataHour = result.hour;
      dataMinute = result.minute;
      console.log(`✓ Current value: ${currentValue.toLocaleString('pt-BR')}\n`);
    } catch (error) {
      throw new Error(`Failed to extract value from CSV: ${error.message}`);
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

    // Step 4: Send email (skip in dry-run mode)
    if (!isDryRun) {
      console.log('Step 4: Sending email notification...');
      try {
        await sendEmail(config.email, screenshotPath, assessment, dataTimestamp, dataHour, dataMinute);
        console.log('✓ Email sent successfully\n');
      } catch (error) {
        throw new Error(`Failed to send email: ${error.message}`);
      }
    } else {
      console.log('Step 4: Sending email notification... (SKIPPED in dry-run mode)\n');
    }

    // Display dry-run results prominently
    if (isDryRun) {
      const thresholdRange = getThresholdRange(currentValue, config.thresholds);
      const now = new Date();
      
      console.log('\n' + '='.repeat(60));
      console.log('=== DRY RUN MODE - VERIFICATION RESULTS ===');
      console.log('='.repeat(60));
      console.log(`Extracted Value: ${currentValue.toLocaleString('pt-BR')}`);
      console.log(`Status: ${assessment.status}`);
      console.log(`Severity: ${assessment.severity}`);
      console.log(`Threshold Range: ${thresholdRange}`);
      console.log(`Note: Value is from the most recent Empacotamento data available in CSV`);
      console.log(`Extraction Time: ${now.toLocaleString('pt-BR')}`);
      console.log('='.repeat(60));
      console.log('\n✓ Dry run completed successfully - no email was sent');
    }

    // Cleanup screenshot (optional - comment out if you want to keep it)
    // fs.unlinkSync(screenshotPath);
    // console.log('✓ Screenshot file cleaned up\n');

    if (!isDryRun) {
      console.log('=== Process completed successfully ===');
    }

  } catch (error) {
    console.error('\n❌ Error in main process:', error.message || error);
    if (error.stack && process.env.NODE_ENV !== 'production') {
      console.error('Stack:', error.stack);
    }
    console.error('\nTroubleshooting tips:');
    console.error('- Check that all required GitHub Secrets are set (RESEND_API_KEY, EMAIL_FROM, EMAIL_RECIPIENTS)');
    const websiteUrl = config?.websiteUrl || process.env.WEBSITE_URL || 'https://mago.ntag.com.br/empacotamento';
    console.error('- Verify the website URL is accessible: ' + websiteUrl);
    console.error('- Check Resend dashboard for API key validity and rate limits');
    process.exit(1);
  }
}

// Run main function
main();
