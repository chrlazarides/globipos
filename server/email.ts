// Resend integration for sending emails
import { Resend } from 'resend';

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
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || !connectionSettings.settings.api_key) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email };
}

// WARNING: Never cache this client - always get fresh credentials
async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail: fromEmail || 'onboarding@resend.dev'
  };
}

export async function sendInvoiceEmail(toEmail: string, subject: string, htmlContent: string): Promise<{ success: boolean; fromEmail: string; error?: string }> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();

    await client.emails.send({
      to: toEmail,
      from: fromEmail,
      subject: subject,
      html: htmlContent,
    });

    return { success: true, fromEmail };
  } catch (error: any) {
    console.error('Resend error:', error?.message || error);
    return { success: false, fromEmail: '', error: error?.message || 'Failed to send email' };
  }
}
