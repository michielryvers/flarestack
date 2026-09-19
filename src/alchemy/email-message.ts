export interface EmailMessage { to: string; subject: string; text: string; }
export function validateEmail(message: unknown): message is EmailMessage {
  if (!message || typeof message !== "object") return false;
  const m = message as EmailMessage;
  return typeof m.to === "string" && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(m.to) && m.to.length <= 254 &&
    typeof m.subject === "string" && m.subject.length > 0 && m.subject.length <= 200 && !/[\r\n]/.test(m.subject) &&
    typeof m.text === "string" && m.text.length > 0 && new TextEncoder().encode(m.text).length <= 100_000;
}
// Use MIME rather than the builder API: the pinned local simulator logs builder
// bodies, which could expose password-reset links to the telemetry pipeline.
export function mimeMessage(from: string, message: EmailMessage, id = crypto.randomUUID()) {
  if (!validateEmail({ ...message, to: from }) || !validateEmail(message)) throw new Error("Invalid email message");
  const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
  return [`From: ${from}`, `To: ${message.to}`, `Subject: =?UTF-8?B?${base64(message.subject)}?=`,
    `Message-ID: <${id}@${from.split("@")[1]}>`, `Date: ${new Date().toUTCString()}`, "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    base64(message.text).match(/.{1,76}/g)!.join("\r\n"), ""].join("\r\n");
}
