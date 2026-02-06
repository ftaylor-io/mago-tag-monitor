import fs from 'fs';

/**
 * Get emoji based on severity
 * @param {string} severity - Severity level ('critical', 'warning', 'neutral')
 * @returns {string} Emoji indicator
 */
function getSeverityEmoji(severity) {
  switch (severity) {
    case 'critical':
      return '🔴'; // Red circle
    case 'warning':
      return '🟡'; // Yellow circle
    case 'neutral':
      return '🟢'; // Green circle
    default:
      return '⚪'; // White circle (fallback)
  }
}

/**
 * Sends an email with the screenshot and assessment using Resend
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
    replyTo,
    subject,
    apiKey
  } = config;

  if (!apiKey) {
    throw new Error('Resend API key is required');
  }

  // Validate API key format (Resend keys typically start with "re_")
  if (!apiKey.startsWith('re_')) {
    console.warn('⚠️  Warning: Resend API key usually starts with "re_"');
    console.warn('   Current key format:', apiKey.substring(0, 5) + '...');
  }

  if (!recipients || recipients.length === 0) {
    throw new Error('At least one email recipient is required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const effectiveFrom = from || process.env.EMAIL_FROM || 'intel@saturnotrading.com.br';
  const effectiveReplyTo = replyTo || process.env.EMAIL_REPLY_TO || 'intel@saturnotrading.com.br';

  if (!emailRegex.test(effectiveFrom)) {
    throw new Error(`Invalid from email format: ${effectiveFrom}`);
  }

  if (effectiveReplyTo && !emailRegex.test(effectiveReplyTo)) {
    throw new Error(`Invalid reply-to email format: ${effectiveReplyTo}`);
  }

  recipients.forEach((recipient, index) => {
    if (!emailRegex.test(recipient)) {
      throw new Error(`Invalid recipient email format at index ${index}: ${recipient}`);
    }
  });

  // Prepare Resend API usage
  console.log('Preparing Resend API request (format check: ' + (apiKey.startsWith('re_') ? '✓' : '✗') + ')');
  console.log('API Key length:', apiKey.length, 'characters');
  console.log('✓ Resend API key loaded');

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

  // Prepare email message with dynamic subject including classification and emoji
  const baseSubject = subject || 'MAGO TAG - Monitoramento de Empacotamento';
  const emoji = getSeverityEmoji(assessment.severity);
  const dynamicSubject = `${emoji} [${assessment.status}] ${baseSubject}`;

  const msg = {
    to: recipients,
    from: effectiveFrom,
    reply_to: effectiveReplyTo,
    subject: dynamicSubject,
    text: textContent,
    html: htmlContent,
    attachments: screenshotBase64 ? [{
      filename: 'grafico.png',
      content: screenshotBase64,
      type: 'image/png'
    }] : []
  };

  // Send email
  console.log(`Sending email to ${recipients.length} recipient(s)...`);
  console.log(`From: ${effectiveFrom} (reply-to: ${effectiveReplyTo})`);
  console.log(`Recipients: ${recipients.map(r => r.substring(0, 3) + '***@' + r.split('@')[1]).join(', ')}`);
  console.log(`API Key prefix: ${apiKey.substring(0, 10)}...`);
  
  try {
    console.log('Calling Resend API...');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(msg)
    });

    const responseBody = await response.json().catch(() => ({}));
    console.log('Resend API call completed');

    if (!response.ok) {
      const errorMessage = responseBody?.message || responseBody?.error || 'Unknown error from Resend API';
      const error = new Error(`Resend API request failed (${response.status}): ${errorMessage}`);
      error.response = responseBody;
      error.statusCode = response.status;
      throw error;
    }

    if (responseBody?.id) {
      console.log('Email sent successfully!');
      console.log('Resend Message ID:', responseBody.id);
    } else {
      console.log('Email sent! Response:', JSON.stringify(responseBody, null, 2));
    }
  } catch (error) {
    console.error('❌ Error sending email:', error.message || error);
    
    // Log full error details
    console.error('Error type:', error.constructor.name);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      console.error('Resend API Error Details:');
      console.error('Status Code:', error.code || error.response.statusCode);
      console.error('Response Body:', JSON.stringify(error.response, null, 2));
    } else if (error.message) {
      console.error('Error message:', error.message);
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Network error connecting to Resend. Please check your internet connection.');
    }
    
    // Check for API key issues
    if (error.message && error.message.includes('Unauthorized')) {
      throw new Error('Resend API key is invalid or unauthorized. Please verify your API key in GitHub Secrets.');
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
