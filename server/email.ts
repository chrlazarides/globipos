// Resend email integration — uses Replit connector SDK (@replit/connectors-sdk)
// Priority 1: DB-stored API key (set in Settings → Email)
// Priority 2: Replit connector (managed via Replit integrations)
import { Resend } from 'resend';
import { ReplitConnectors } from '@replit/connectors-sdk';
import { db } from './db';
import { systemSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';

function escHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getSettingValue(key: string): Promise<string | null> {
  try {
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

const PERSONAL_EMAIL_DOMAINS = [
  'gmail.com','yahoo.com','yahoo.co.uk','hotmail.com','outlook.com',
  'live.com','icloud.com','me.com','aol.com','protonmail.com','cytanet.com.cy'
];

function isSendableFromAddress(email: string): boolean {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && !PERSONAL_EMAIL_DOMAINS.includes(domain);
}

async function getFromEmail(): Promise<string> {
  const dbFromEmail = await getSettingValue('resend_from_email');
  if (dbFromEmail && isSendableFromAddress(dbFromEmail)) return dbFromEmail;
  return 'onboarding@resend.dev';
}

interface EmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>;
}

async function sendEmailPayload(payload: EmailPayload): Promise<void> {
  const dbApiKey = await getSettingValue('resend_api_key');

  if (dbApiKey && dbApiKey.startsWith('re_')) {
    // Use Resend SDK directly with the stored API key
    const client = new Resend(dbApiKey);
    const result = await client.emails.send(payload as any);
    if ((result as any).error) {
      throw new Error((result as any).error.message || 'Resend API error');
    }
    return;
  }

  // Use Replit connector proxy — auth handled automatically
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy('resend', '/emails', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Resend error (${response.status}): ${errText}`);
  }
}

export async function getEmailStatus(): Promise<{
  connected: boolean;
  configuredFrom: string;
  actualFrom: string;
  usingFallback: boolean;
  source: 'db' | 'connector' | 'none';
  hasDbApiKey: boolean;
  dbFromEmail: string;
  error?: string;
}> {
  const dbApiKey = await getSettingValue('resend_api_key');
  const dbFromEmail = await getSettingValue('resend_from_email') || '';
  const hasDbApiKey = !!(dbApiKey && dbApiKey.startsWith('re_'));

  try {
    let source: 'db' | 'connector' = 'connector';
    if (hasDbApiKey) source = 'db';

    const fromEmail = await getFromEmail();
    const usingFallback = fromEmail === 'onboarding@resend.dev';

    // Connector-mode: we don't do a live check because the managed key may be
    // restricted to send-only (no /domains or /emails GET permission). Sending
    // will succeed or fail at call time; we report connected:true optimistically.

    return {
      connected: true,
      configuredFrom: dbFromEmail,
      actualFrom: fromEmail,
      usingFallback,
      source,
      hasDbApiKey,
      dbFromEmail,
    };
  } catch (e: any) {
    return {
      connected: false,
      configuredFrom: dbFromEmail,
      actualFrom: '',
      usingFallback: false,
      source: 'none',
      hasDbApiKey,
      dbFromEmail,
      error: e.message,
    };
  }
}

export async function sendTestEmail(
  toEmail: string
): Promise<{ success: boolean; fromEmail: string; error?: string }> {
  try {
    const fromEmail = await getFromEmail();
    await sendEmailPayload({
      from: fromEmail,
      to: toEmail,
      subject: 'VinTrade — Email Test',
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <h2 style="color:#374151;margin-top:0;">Email Test Successful</h2>
        <p style="color:#374151;">This is a test email sent from your <strong>VinTrade</strong> system to confirm email delivery is working correctly.</p>
        <p style="color:#6b7280;font-size:13px;">Sent via Resend · From: ${escHtml(fromEmail)}</p>
      </div>`,
    });
    return { success: true, fromEmail };
  } catch (error: any) {
    console.error('Test email error:', error?.message || error);
    return { success: false, fromEmail: '', error: error?.message || 'Failed to send test email' };
  }
}

export async function sendInvoiceEmail(
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; fromEmail: string; error?: string }> {
  try {
    const fromEmail = await getFromEmail();
    await sendEmailPayload({ from: fromEmail, to: toEmail, subject, html: htmlContent });
    return { success: true, fromEmail };
  } catch (error: any) {
    console.error('Invoice email error:', error?.message || error);
    return { success: false, fromEmail: '', error: error?.message || 'Failed to send email' };
  }
}

export async function sendSavingsReportEmail(
  toEmail: string,
  subject: string,
  htmlContent: string,
  customerName: string
): Promise<{ success: boolean; fromEmail: string; error?: string }> {
  try {
    const fromEmail = await getFromEmail();
    const filename = `savings-report-${customerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
    await sendEmailPayload({
      from: fromEmail,
      to: toEmail,
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#059669;margin-top:0;">Your Savings Report</h2>
        <p style="color:#374151;">Please find your savings report attached to this email.</p>
        <p style="color:#6b7280;font-size:13px;">Open the attached HTML file in your browser to view the full report with all details.</p>
      </div>`,
      attachments: [{ filename, content: Buffer.from(htmlContent).toString('base64') }],
    });
    return { success: true, fromEmail };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send savings report email';
    console.error('Savings report email error:', message);
    return { success: false, fromEmail: '', error: message };
  }
}

export async function sendBackupEmail(
  toEmail: string,
  companyName: string,
  backupJson: string,
  date: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const fromEmail = await getFromEmail();
    const filename = `backup-${date}.json`;
    await sendEmailPayload({
      from: fromEmail,
      to: toEmail,
      subject: `${companyName} — Database Backup ${date}`,
      html: `<p>Automated database backup for <strong>${escHtml(companyName)}</strong>.</p>
             <p>Date: ${escHtml(date)}</p>
             <p>The full backup is attached as <code>${escHtml(filename)}</code>.</p>
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
    const fromEmail = await getFromEmail();
    await sendEmailPayload({
      from: fromEmail,
      to: adminEmails,
      subject: `🔐 Security Alert: ${username} logged in from new location`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="background:#dc2626;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">⚠️ New Login Location Detected</h2>
        </div>
        <p style="color:#374151;">A user has logged in from a <strong>new IP address</strong> that has not been seen before.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;">User</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(username)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">IP Address</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${escHtml(ip)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Time</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(timestamp)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Browser</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${escHtml(userAgent)}</td></tr>
        </table>
        <p style="color:#374151;">If this was not you, log in immediately and deactivate this account.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated security alert from VinTrade.</p>
      </div>`,
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
    const fromEmail = await getFromEmail();
    await sendEmailPayload({
      from: fromEmail,
      to: adminEmails,
      subject: `🚨 Security Alert: ${failCount} failed login attempts from ${ip}`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="background:#b45309;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">🚨 Multiple Failed Login Attempts</h2>
        </div>
        <p style="color:#374151;">There have been <strong>${failCount} failed login attempts</strong> in a short period. This may indicate a brute-force attack.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;">Target User</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(attemptedUsername) || '(unknown)'}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Attack IP</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${escHtml(ip)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Attempts</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${failCount} failed attempts</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Time</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(timestamp)}</td></tr>
        </table>
        <p style="color:#374151;">The IP has been temporarily blocked. Review your system if this activity is unexpected.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated security alert from VinTrade.</p>
      </div>`,
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
    const fromEmail = await getFromEmail();
    await sendEmailPayload({
      from: fromEmail,
      to: adminEmails,
      subject: `👤 Security Alert: New admin user "${newUsername}" created`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="background:#7c3aed;padding:16px 24px;border-radius:6px 6px 0 0;margin:-24px -24px 24px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">👤 New Admin User Created</h2>
        </div>
        <p style="color:#374151;">A new <strong>admin user</strong> has been created on the system.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;">New User</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(newUsername)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Created By</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(createdBy)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">From IP</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${escHtml(ip)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">Time</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${escHtml(timestamp)}</td></tr>
        </table>
        <p style="color:#374151;">If you did not create this user, log in immediately and deactivate them.</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This is an automated security alert from VinTrade.</p>
      </div>`,
    });
  } catch (error: any) {
    console.error('New admin alert email error:', error?.message || error);
  }
}
