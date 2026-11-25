/** Provider-neutral email shape. The Microsoft and Google adapters both produce this. */
export type IncomingAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Filled after download; used for duplicate detection. */
  sha256?: string;
  /** Embedded in the body (pictures pasted into the email, signature logos). */
  isInline: boolean;
};

export type IncomingMessage = {
  /** Provider's message id, unique per mailbox connection. */
  id: string;
  /** Thread id (Graph conversationId / Gmail threadId). */
  conversationId: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  attachments: IncomingAttachment[];
};

export type Category = "rfq" | "award" | "invoice" | "general" | "junk";
