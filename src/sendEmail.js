import sgMail from '@sendgrid/mail';
import fs from 'fs';

/**
 * Sends an email with the screenshot and assessment using SendGrid
 * @param {Object} config - Email configuration object
 * @param {string} screenshotPath - Path to the screenshot file
 * @param {Object} assessment - Assessment object from assessCondition
 * @returns {Promise<void>}
 */
export async function sendEmail(config, screenshotPath, assessment) {
  const {
    recipients,
    from,
    subject,
    apiKey
  } = config;

  if (!apiKey) {
    throw new Error('SendGrid API key is required');
  }

  if (!recipients || recipients.length === 0) {
    throw new Error('At least one email recipient is required');
  }

  if (!from) {
    throw new Error('From email address is required');
  }

  // Set SendGrid API key
  sgMail.setApiKey(apiKey);

  // Read screenshot file
  let screenshotBuffer = null;
  let screenshotBase64 = null;
  if (fs.existsSync(screenshotPath)) {
    screenshotBuffer = fs.readFileSync(screenshotPath);
    screenshotBase64 = screenshotBuffer.toString('base64');
  } else {
    console.warn(`Screenshot file not found at ${screenshotPath}`);
  }

  // Prepare email content
  const htmlContent = `
    <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Monitoramento MAGO TAG - Empenamento</h2>
        <div style="background-color: ${getSeverityColor(assessment.severity)}; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin: 0; color: white;">${assessment.status}</h3>
          <p style="margin: 10px 0 0 0; color: white; font-size: 18px;">${assessment.message}</p>
        </div>
        ${screenshotBase64 ? `<p><strong>Gráfico atual:</strong></p><img src="data:image/png;base64,${screenshotBase64}" style="max-width: 100%; height: auto;" />` : ''}
        <p style="margin-top: 20px; color: #666; font-size: 12px;">
          Verificação automática realizada em ${new Date().toLocaleString('pt-BR')}
        </p>
      </body>
    </html>
  `;

  const textContent = `
Monitoramento MAGO TAG - Empenamento

${assessment.status}
${assessment.message}

Verificação automática realizada em ${new Date().toLocaleString('pt-BR')}
  `;

  // Prepare email message
  const msg = {
    to: recipients,
    from: from,
    subject: subject || 'MAGO TAG - Monitoramento de Empenamento',
    text: textContent,
    html: htmlContent,
    attachments: screenshotBuffer ? [
      {
        content: screenshotBase64,
        filename: 'grafico.png',
        type: 'image/png',
        disposition: 'attachment'
      }
    ] : []
  };

  // Send email
  console.log(`Sending email to ${recipients.join(', ')}...`);
  try {
    const response = await sgMail.send(msg);
    console.log('Email sent successfully!');
    console.log('Status Code:', response[0].statusCode);
    console.log('Response Headers:', response[0].headers);
  } catch (error) {
    console.error('Error sending email:', error.message || error);
    if (error.response) {
      console.error('SendGrid API Error Details:');
      console.error('Status Code:', error.code || error.response.statusCode);
      console.error('Response Body:', JSON.stringify(error.response.body, null, 2));
      
      // Provide helpful error messages based on common SendGrid errors
      if (error.response.body?.errors) {
        error.response.body.errors.forEach(err => {
          console.error(`- ${err.message}`);
        });
      }
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Network error connecting to SendGrid. Please check your internet connection.');
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
