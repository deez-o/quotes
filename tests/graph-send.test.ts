import { describe, expect, it } from "vitest";
import { GraphMailbox } from "@/lib/mail/graph";
import { messageHtml } from "@/lib/quote/email";

describe("sending a quote from the company's Outlook", () => {
  it("posts one message with the PDF, saved to Sent Items", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 202 }); }) as unknown as typeof fetch;
    await new GraphMailbox(async () => "tok", "me", f).sendMail({
      to: ["sam@builder.test"], cc: ["dan@demo.test"], subject: "Quote Q-1", html: "<p>Hi</p>",
      attachments: [{ filename: "Quote Q-1.pdf", contentType: "application/pdf", base64: "JVBERi0=" }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "sam@builder.test" } }]);
    expect(body.message.attachments[0]).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "Quote Q-1.pdf", contentBytes: "JVBERi0=" });
  });
  it("leaves the quoteout footer off mail from their own address", () => {
    expect(messageHtml("Hi", "Demo", "#123456", null, false)).not.toContain("sent using quoteout");
    expect(messageHtml("Hi", "Demo", "#123456")).toContain("sent using quoteout");
  });
});
