export async function sendVerificationEmail(env: Env, to: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[dev] verification code for ${to}: ${code}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject: `${code} 是你的博弈五子棋验证码`,
      html: [
        '<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px">',
        '<h2 style="color:#292524">博弈五子棋</h2>',
        '<p style="color:#57534e">你的注册验证码是：</p>',
        `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#292524">${code}</p>`,
        '<p style="color:#a8a29e;font-size:13px">验证码 10 分钟内有效。如果这不是你的操作，请忽略这封邮件。</p>',
        '</div>',
      ].join(''),
    }),
  })
  if (!res.ok) {
    throw new Error(`resend failed: ${res.status} ${await res.text()}`)
  }
}
