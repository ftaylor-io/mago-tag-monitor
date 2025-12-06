import sgMail from '@sendgrid/mail';
import fs from 'fs';

/**
 * Sends an email with the screenshot and assessment using SendGrid
 * @param {Object} config - Email configuration object
 * @param {string} screenshotPath - Path to the screenshot file
 * @param {Object} assessment - Assessment object from assessCondition
 * @param {Date} dataTimestamp - Timestamp of the data being reported
 * @param {number} dataHour - Hour from CSV (0-23)
 * @param {number} dataMinute - Minute from CSV (0-59)
 * @returns {Promise<void>}
 */
export async function sendEmail(config, screenshotPath, assessment, dataTimestamp, dataHour, dataMinute) {
  const {
    recipients,
    from,
    subject,
    apiKey
  } = config;

  if (!apiKey) {
    throw new Error('SendGrid API key is required');
  }

  // Validate API key format (should start with SG.)
  if (!apiKey.startsWith('SG.')) {
    console.warn('⚠️  Warning: SendGrid API key should start with "SG."');
    console.warn('   Current key format:', apiKey.substring(0, 5) + '...');
  }

  if (!recipients || recipients.length === 0) {
    throw new Error('At least one email recipient is required');
  }

  if (!from) {
    throw new Error('From email address is required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(from)) {
    throw new Error(`Invalid from email format: ${from}`);
  }

  recipients.forEach((recipient, index) => {
    if (!emailRegex.test(recipient)) {
      throw new Error(`Invalid recipient email format at index ${index}: ${recipient}`);
    }
  });

  // Set SendGrid API key
  console.log('Setting SendGrid API key (format check: ' + (apiKey.startsWith('SG.') ? '✓' : '✗') + ')');
  console.log('API Key length:', apiKey.length, 'characters');
  sgMail.setApiKey(apiKey);
  console.log('✓ API key set successfully');

  // Read screenshot file
  let screenshotBuffer = null;
  let screenshotBase64 = null;
  if (fs.existsSync(screenshotPath)) {
    screenshotBuffer = fs.readFileSync(screenshotPath);
    screenshotBase64 = screenshotBuffer.toString('base64');
  } else {
    console.warn(`Screenshot file not found at ${screenshotPath}`);
  }

  // Format data timestamp for subtitle - use hour:minute directly from CSV to avoid timezone conversion issues
  const dataTimeStr = (dataHour !== undefined && dataMinute !== undefined)
    ? `${String(dataHour).padStart(2, '0')}:${String(dataMinute).padStart(2, '0')}`
    : 'N/A';
  
  // Format verification timestamp in São Paulo timezone
  const verificationTimeStr = new Date().toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo'
  });

  // Prepare email content
  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Monitoramento MAGO TAG - Empacotamento</h2>
        <p style="margin: 10px 0; color: #666; font-size: 14px;">Leitura realizada às ${dataTimeStr} horas</p>
        <div style="background-color: ${getSeverityColor(assessment.severity)}; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin: 0; color: white;">${assessment.status}</h3>
          <p style="margin: 10px 0 0 0; color: white; font-size: 18px;">${assessment.message}</p>
        </div>
        ${screenshotBase64 ? `<p><strong>Gráfico atual:</strong></p><img src="data:image/png;base64,${screenshotBase64}" style="max-width: 100%; height: auto;" />` : ''}
        <p style="margin-top: 20px; color: #666; font-size: 12px;">
          Verificação automática realizada em ${verificationTimeStr}
        </p>
      </body>
    </html>
  `;

  const textContent = `
Monitoramento MAGO TAG - Empacotamento

Leitura realizada às ${dataTimeStr} horas

${assessment.status}
${assessment.message}

Verificação automática realizada em ${verificationTimeStr}
  `;

  // Prepare email message
  const msg = {
    to: recipients,
    from: from,
    subject: subject || 'MAGO TAG - Monitoramento de Empacotamento',
    text: textContent,
    html: htmlContent,
    attachments: []
  };

  // Send email
  console.log(`Sending email to ${recipients.length} recipient(s)...`);
  console.log(`From: ${from}`);
  console.log(`Recipients: ${recipients.map(r => r.substring(0, 3) + '***@' + r.split('@')[1]).join(', ')}`);
  console.log(`API Key prefix: ${apiKey.substring(0, 10)}...`);
  
  try {
    console.log('Calling SendGrid API...');
    const response = await sgMail.send(msg);
    
    // Handle response - SendGrid returns an array with response objects
    console.log('SendGrid API call completed');
    console.log('Response type:', typeof response);
    console.log('Is array:', Array.isArray(response));
    
    if (Array.isArray(response) && response.length > 0) {
      const firstResponse = response[0];
      console.log('Email sent successfully!');
      
      if (firstResponse.statusCode) {
        console.log('Status Code:', firstResponse.statusCode);
      }
      
      if (firstResponse.headers) {
        console.log('Response Headers:', JSON.stringify(firstResponse.headers, null, 2));
        
        if (firstResponse.headers['x-message-id']) {
          console.log('SendGrid Message ID:', firstResponse.headers['x-message-id']);
          console.log('');
          console.log('📧 Email Delivery Status:');
          console.log('  - Status 202 means SendGrid accepted the email');
          console.log('  - Check your SendGrid Activity Feed: https://app.sendgrid.com/activity');
          console.log('  - Verify the sender email is verified in SendGrid');
          console.log('  - Check spam/junk folder if email not received');
        } else {
          console.warn('⚠️  Warning: No x-message-id in response headers');
        }
      } else {
        console.warn('⚠️  Warning: No headers in response');
        console.log('Full response:', JSON.stringify(firstResponse, null, 2));
      }
    } else {
      // Response might be different format
      console.log('Email sent! Response:', JSON.stringify(response, null, 2));
      console.log('📧 Check your SendGrid Activity Feed: https://app.sendgrid.com/activity');
    }
  } catch (error) {
    console.error('❌ Error sending email:', error.message || error);
    
    // Log full error details
    console.error('Error type:', error.constructor.name);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      console.error('SendGrid API Error Details:');
      console.error('Status Code:', error.code || error.response.statusCode);
      console.error('Response Body:', JSON.stringify(error.response.body, null, 2));
      
      // Provide helpful error messages based on common SendGrid errors
      if (error.response.body?.errors) {
        console.error('SendGrid Errors:');
        error.response.body.errors.forEach(err => {
          console.error(`  - ${err.message}`);
          if (err.field) console.error(`    Field: ${err.field}`);
          if (err.help) console.error(`    Help: ${err.help}`);
        });
      }
    } else if (error.message) {
      console.error('Error message:', error.message);
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Network error connecting to SendGrid. Please check your internet connection.');
    }
    
    // Check for API key issues
    if (error.message && error.message.includes('Unauthorized')) {
      throw new Error('SendGrid API key is invalid or unauthorized. Please verify your API key in GitHub Secrets.');
    }
    
    throw error;
  }
}

/**
 * Get color based on severity
 */
function getSeverityColor(severity) {
  switch (severity) {
    case 'critical':
      return '#dc3545'; // Red
    case 'warning':
      return '#ffc107'; // Yellow/Orange
    case 'neutral':
      return '#28a745'; // Green
    default:
      return '#6c757d'; // Gray
  }
}
