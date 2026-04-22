// Email service using EmailJS (free tier: 200 emails/month)
// Configure in Admin → Settings

export async function sendEmail(emailConfig, toEmail, toName, subject, body) {
  if (!emailConfig?.serviceId || !emailConfig?.templateId || !emailConfig?.publicKey || !emailConfig.enabled) {
    console.log("Email not configured or disabled");
    return { success: false, reason: "not_configured" };
  }
  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: emailConfig.serviceId,
        template_id: emailConfig.templateId,
        user_id: emailConfig.publicKey,
        template_params: {
          to_email: toEmail,
          to_name: toName,
          subject: subject,
          message: body,
          from_name: "Overtime Manager — Al Manaber",
        },
      }),
    });
    return response.ok ? { success: true } : { success: false, reason: "send_failed" };
  } catch (err) {
    console.error("Email error:", err);
    return { success: false, reason: "error" };
  }
}
