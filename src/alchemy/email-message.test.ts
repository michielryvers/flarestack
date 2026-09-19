import { expect, test } from "bun:test";
import { mimeMessage, validateEmail } from "./email-message.ts";
test("email rejects header injection and oversized bodies", () => {
  const valid = {to:"a@example.com", subject:"Hello", text:"Link with a secret"};
  expect(validateEmail(valid)).toBe(true);
  for (const change of [{to:"a@example.com\r\nBcc:evil@example.com"}, {subject:"Hi\nBcc:evil"}, {text:"x".repeat(100001)}]) expect(validateEmail({...valid,...change})).toBe(false);
  const mime = mimeMessage("sender@example.com", valid);
  expect(mime).not.toContain(valid.text);
  expect(Buffer.from(mime.split("\r\n\r\n")[1]!,"base64").toString()).toBe(valid.text);
});
