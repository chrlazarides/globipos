import sgMail from '@sendgrid/mail';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

// SendGrid integration - always get fresh client
export async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
}

export async function sendInvoiceEmail(toEmail: string, subject: string, htmlContent: string): Promise<{ success: boolean; fromEmail: string; error?: string }> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();

    await client.send({
      to: toEmail,
      from: fromEmail,
      subject: subject,
      html: htmlContent,
    });

    return { success: true, fromEmail };
  } catch (error: any) {
    console.error('SendGrid error:', error?.response?.body || error.message);
    return { success: false, fromEmail: '', error: error?.response?.body?.errors?.[0]?.message || error.message };
  }
}
