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
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || !connectionSettings.settings.api_key) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email };
}

// WARNING: Never cache this client - always get fresh credentials
const PERSONAL_EMAIL_DOMAINS = ['gmail.com','yahoo.com','yahoo.co.uk','hotmail.com','outlook.com','live.com','icloud.com','me.com','aol.com','protonmail.com','cytanet.com.cy'];

function isSendableFromAddress(email: string): boolean {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && !PERSONAL_EMAIL_DOMAINS.includes(domain);
}

async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  const resolvedFrom = isSendableFromAddress(fromEmail) ? fromEmail : 'onboarding@resend.dev';
  return {
    client: new Resend(apiKey),
    fromEmail: resolvedFrom
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

export async function sendBackupEmail(toEmail: string, companyName: string, backupJson: string, date: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const filename = `backup-${date}.json`;
    await client.emails.send({
      to: toEmail,
      from: fromEmail,
      subject: `${companyName} — Database Backup ${date}`,
      html: `<p>Automated database backup for <strong>${companyName}</strong>.</p>
             <p>Date: ${date}</p>
             <p>The full backup is attached as <code>${filename}</code>.</p>
             <p style="color:#666;font-size:12px;">This is an automated backup email. Keep this file in a safe place.</p>`,
      attachments: [{ filename, content: Buffer.from(backupJson).toString('base64') }],
    });
    return { success: true };
  } catch (error: any) {
    console.error('Backup email error:', error?.message || error);
    return { success: false, error: error?.message || 'Failed to send backup email' };
  }
}

export async function sendLoginAlertEmail(
  adminEmails: string[],
  username: string,
  ip: string,
  userAgent: string,
  timestamp: string
): Promise<void> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="background:#dc2626;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">⚠️ New Login Location Detected</h2>
        </div>
        <p style="color:#374151;">A user has logged in from a <strong>new IP address</strong> that has not been seen before.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;">User</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${username}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">IP Address</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${ip}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Time</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${timestamp}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Browser</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${userAgent}</td></tr>
        </table>
        <p style="color:#374151;">If this was not you, log in immediately and deactivate this account.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated security alert from Vineria Di Mare.</p>
      </div>`;
    await client.emails.send({
      to: adminEmails,
      from: fromEmail,
      subject: `🔐 Security Alert: ${username} logged in from new location`,
      html,
    });
  } catch (error: any) {
    console.error('Login alert email error:', error?.message || error);
  }
}

export async function sendFailedLoginAlertEmail(
  adminEmails: string[],
  attemptedUsername: string,
  ip: string,
  failCount: number,
  timestamp: string
): Promise<void> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="background:#b45309;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">🚨 Multiple Failed Login Attempts</h2>
        </div>
        <p style="color:#374151;">There have been <strong>${failCount} failed login attempts</strong> in a short period. This may indicate a brute-force attack.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;">Target User</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${attemptedUsername || '(unknown)'}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Attack IP</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${ip}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Attempts</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${failCount} failed attempts</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Time</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${timestamp}</td></tr>
        </table>
        <p style="color:#374151;">The IP has been temporarily blocked. Review your system if this activity is unexpected.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated security alert from Vineria Di Mare.</p>
      </div>`;
    await client.emails.send({
      to: adminEmails,
      from: fromEmail,
      subject: `🚨 Security Alert: ${failCount} failed login attempts from ${ip}`,
      html,
    });
  } catch (error: any) {
    console.error('Failed login alert email error:', error?.message || error);
  }
}

export async function sendNewAdminAlertEmail(
  adminEmails: string[],
  newUsername: string,
  createdBy: string,
  ip: string,
  timestamp: string
): Promise<void> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="background:#7c3aed;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">👤 New Admin User Created</h2>
        </div>
        <p style="color:#374151;">A new <strong>admin user</strong> has been created on the system.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;">New User</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${newUsername}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Created By</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${createdBy}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">From IP</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${ip}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Time</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${timestamp}</td></tr>
        </table>
        <p style="color:#374151;">If you did not create this user, log in immediately and deactivate them.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated security alert from Vineria Di Mare.</p>
      </div>`;
    await client.emails.send({
      to: adminEmails,
      from: fromEmail,
      subject: `👤 Security Alert: New admin user "${newUsername}" created`,
      html,
    });
  } catch (error: any) {
    console.error('New admin alert email error:', error?.message || error);
  }
}
