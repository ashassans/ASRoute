import nodemailer from "nodemailer";

export function isGmailMailerConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_USER?.trim() &&
      process.env.GMAIL_APP_PASSWORD?.trim()
  );
}

export async function sendVerificationOtpEmail(params: {
  to: string;
  otp: string;
}): Promise<void> {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim()?.replace(/\s+/g, "");

  if (!user || !pass) {
    throw new Error(
      "Gmail SMTP is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in server secrets."
    );
  }

  const safeOtp = params.otp.replace(/[^0-9A-Za-z]/g, "");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });

  await transporter.sendMail({
    from: `"AS ROUTER" <${user}>`,
    to: params.to,
    subject: `${safeOtp} is your AS ROUTER verification code`,
    text: `Your AS ROUTER email verification code is: ${safeOtp}\n\nThis code expires in 10 minutes. If you did not create an account, you can ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#09090B; color:#FAFAFA; padding:32px; border-radius:12px; max-width:460px; margin:0 auto; border:1px solid #222227;">
        <div style="font-size:14px; font-weight:700; letter-spacing:0.04em; color:#FBBF24; margin-bottom:16px;">AS ROUTER</div>
        <h2 style="font-size:18px; font-weight:600; margin:0 0 8px 0; color:#FAFAFA;">Verify your email address</h2>
        <p style="font-size:13px; color:#A1A1AA; line-height:1.5; margin:0 0 20px 0;">
          Enter the 6-digit verification code below to finish creating your AS ROUTER workspace.
        </p>
        <div style="background:#111114; border:1px solid #27272A; border-radius:10px; padding:16px; text-align:center; font-family:monospace; font-size:28px; font-weight:700; letter-spacing:0.35em; color:#FBBF24; margin-bottom:20px;">
          ${safeOtp}
        </div>
        <p style="font-size:12px; color:#71717A; margin:0;">
          This code expires in 10 minutes.
        </p>
      </div>
    `,
  });
}
