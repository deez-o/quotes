/**
 * Microsoft Graph (Outlook / Microsoft 365) mailbox adapter.
 * Scopes: Mail.ReadWrite, offline_access, User.Read. Nothing else.
 * The app never sends mail: it reads, labels (categories) and creates drafts.
 */
import type { IncomingAttachment, IncomingMessage } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";

export type TokenProvider = () => Promise<string>;

type GraphRecipient = { emailAddress?: { address?: string; name?: string } };
export type GraphMessage = {
  id: string;
  conversationId: string;
  subject?: string | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  receivedDateTime: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  categories?: string[];
};
type GraphAttachment = { id: string; name: string; contentType?: string; size?: number; isInline?: boolean; "@odata.type"?: string };

export class GraphError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class GraphMailbox {
  constructor(
    private readonly token: TokenProvider,
    /** "me" for the signed-in mailbox, or "users/<id>" for a shared mailbox the user can access. */
    private readonly mailbox = "me",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** A current access token, for other Graph calls (e.g. shared files). */
  accessToken(): Promise<string> {
    return this.token();
  }

  private async call<T>(path: string, init: RequestInit = {}, expectJson = true): Promise<T> {
    const res = await this.fetchImpl(`${GRAPH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GraphError(res.status, `Graph ${init.method ?? "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    if (!expectJson || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Send an email from this mailbox (it's kept in the mailbox's Sent Items). */
  sendMail(m: { to: string[]; cc: string[]; subject: string; html: string; attachments: { filename: string; contentType: string; base64: string }[] }) {
    const addr = (a: string) => ({ emailAddress: { address: a } });
    return this.call<void>(`/${this.mailbox}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: m.subject,
          body: { contentType: "HTML", content: m.html },
          toRecipients: m.to.map(addr),
          ccRecipients: m.cc.map(addr),
          attachments: m.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentType: a.contentType, contentBytes: a.base64 })),
        },
        saveToSentItems: true,
      }),
    }, false);
  }

  /** Push notifications for new mail in the inbox. Graph caps message subscriptions at under 7 days: renew daily. */
  createInboxSubscription(notificationUrl: string, clientState: string, expires: Date) {
    return this.call<{ id: string; expirationDateTime: string }>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created",
        notificationUrl,
        lifecycleNotificationUrl: notificationUrl,
        resource: `/${this.mailbox}/mailFolders('inbox')/messages`,
        expirationDateTime: expires.toISOString(),
        clientState,
      }),
    });
  }

  renewSubscription(subscriptionId: string, expires: Date) {
    return this.call<{ id: string; expirationDateTime: string }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ expirationDateTime: expires.toISOString() }),
    });
  }

  async getMessage(id: string): Promise<IncomingMessage> {
    const m = await this.call<GraphMessage>(
      `/${this.mailbox}/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,from,toRecipients,receivedDateTime,body,hasAttachments`,
      { headers: { Prefer: 'outlook.body-content-type="text"' } },
    );
    const attachments = m.hasAttachments ? await this.listAttachments(id) : [];
    return toIncomingMessage(m, attachments);
  }

  async listAttachments(messageId: string): Promise<IncomingAttachment[]> {
    const r = await this.call<{ value: GraphAttachment[] }>(
      `/${this.mailbox}/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
    );
    return r.value.map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType ?? "application/octet-stream",
      size: a.size ?? 0,
      isInline: Boolean(a.isInline),
    }));
  }

  /** Raw bytes of one attachment, streamed (never the whole email in memory). */
  async downloadAttachment(messageId: string, attachmentId: string): Promise<ReadableStream<Uint8Array>> {
    const res = await this.fetchImpl(
      `${GRAPH}/${this.mailbox}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
      { headers: { Authorization: `Bearer ${await this.token()}` } },
    );
    if (!res.ok || !res.body) throw new GraphError(res.status, `Attachment download failed: ${res.status}`);
    return res.body;
  }

  /** Apply quoteout categories (Outlook's labels), keeping any the user already set. */
  async addCategories(messageId: string, existing: string[], add: string[]) {
    const categories = Array.from(new Set([...existing, ...add]));
    await this.call(`/${this.mailbox}/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ categories }),
    }, false);
  }

  /** Create a reply draft in the same thread. Never sent by the app. */
  async createReplyDraft(messageId: string, htmlBody: string): Promise<{ id: string }> {
    const draft = await this.call<{ id: string }>(`/${this.mailbox}/messages/${encodeURIComponent(messageId)}/createReply`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await this.call(`/${this.mailbox}/messages/${encodeURIComponent(draft.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ body: { contentType: "HTML", content: htmlBody } }),
    }, false);
    return { id: draft.id };
  }

  /** Move an actioned RFQ to a folder (never delete). */
  async moveToFolder(messageId: string, folderId: string) {
    return this.call<{ id: string }>(`/${this.mailbox}/messages/${encodeURIComponent(messageId)}/move`, {
      method: "POST",
      body: JSON.stringify({ destinationId: folderId }),
    });
  }

  /** Catch-up: messages received since a time (nightly safety net, and after missed notifications). */
  async listInboxSince(since: Date, top = 50) {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    return this.call<{ value: GraphMessage[] }>(
      `/${this.mailbox}/mailFolders('inbox')/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=${top}&$select=id,conversationId,subject,from,receivedDateTime,hasAttachments`,
    );
  }
}

export function toIncomingMessage(m: GraphMessage, attachments: IncomingAttachment[]): IncomingMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    from: m.from?.emailAddress?.address ?? "",
    to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean).join(", "),
    subject: m.subject ?? "",
    receivedAt: m.receivedDateTime,
    bodyText: m.body?.content ?? "",
    attachments,
  };
}

/** Graph change notification payload (only the fields we use). */
export type GraphNotification = {
  subscriptionId: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  resourceData?: { id?: string };
  lifecycleEvent?: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
};
