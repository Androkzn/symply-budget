// Stream G (plan §8/G2) — SendGrid integration.
//
// Real implementation replacing Stream B's interface stub. Exports the
// existing `sendHtml` / `sendTemplate` methods unchanged (OutboundDispatcher
// §B4 and DigestComposer §B12 depend on them) and adds a generalized
// `sendEmail` that supports SendGrid Dynamic Templates plus the
// `containsBriefingUrl` tracking-opt-out flag required by §G2.
//
// §G2 hard-wall: when `containsBriefingUrl === true`, BOTH click-tracking
// (including `enable_text`) AND open-tracking MUST be disabled — otherwise
// the one-time briefing token in the URL would be logged by SendGrid's
// tracking proxy and become a long-lived leakage vector.
//
// Transport: workerd-native `fetch` only. No axios / node-fetch.

export interface SendGridClientConfig {
  SENDGRID_API_KEY: string;
  SENDGRID_DIGEST_TEMPLATE_ID: string;
  SENDGRID_FROM_EMAIL: string;
}

export interface SendGridSendTemplateInput {
  to: string;
  from: string;
  templateId: string;
  dynamicData: Record<string, unknown>;
}

export interface SendGridSendHtmlInput {
  to: string;
  from: string;
  subject: string;
  html: string;
}

/**
 * Generalized send input — §G2. Supports either a raw HTML body or a
 * SendGrid Dynamic Template. `containsBriefingUrl` MUST be set to true
 * whenever the rendered message (or template) contains a one-time briefing
 * token URL; doing so disables click + open tracking to prevent token leakage
 * through SendGrid's tracking proxy.
 */
export interface SendGridSendEmailInput {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
  /**
   * CRITICAL (§G2): when true, both click-tracking and open-tracking are
   * force-disabled to prevent leakage of one-time briefing URL tokens.
   */
  containsBriefingUrl?: boolean;
}

export interface SendGridSendResult {
  messageId: string;
}

export interface SendGridClient {
  sendTemplate(input: SendGridSendTemplateInput): Promise<SendGridSendResult>;
  sendHtml(input: SendGridSendHtmlInput): Promise<SendGridSendResult>;
  sendEmail(input: SendGridSendEmailInput): Promise<SendGridSendResult>;
}

// ============================================================================
// Internal payload types (SendGrid v3 /mail/send)
// ============================================================================

interface MailPersonalization {
  to: Array<{ email: string }>;
  subject?: string;
  dynamic_template_data?: Record<string, unknown>;
}

interface MailContent {
  type: 'text/plain' | 'text/html';
  value: string;
}

interface MailTrackingSettings {
  click_tracking?: { enable: boolean; enable_text: boolean };
  open_tracking?: { enable: boolean };
}

interface MailSendPayload {
  personalizations: MailPersonalization[];
  from: { email: string };
  subject?: string;
  content?: MailContent[];
  template_id?: string;
  tracking_settings?: MailTrackingSettings;
}

// ============================================================================
// Factory
// ============================================================================

const SENDGRID_MAIL_SEND_URL = 'https://api.sendgrid.com/v3/mail/send';

export function createSendGridClient(config: SendGridClientConfig): SendGridClient {
  const apiKey = config.SENDGRID_API_KEY;
  const defaultFrom = config.SENDGRID_FROM_EMAIL;

  async function post(payload: MailSendPayload): Promise<SendGridSendResult> {
    const res = await fetch(SENDGRID_MAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SendGrid send failed: ${res.status} ${text}`);
    }
    // SendGrid returns 202 with an empty body; the message id comes from
    // the X-Message-Id response header.
    const messageId = res.headers.get('x-message-id') ?? '';
    return { messageId };
  }

  const client: SendGridClient = {
    async sendTemplate(input: SendGridSendTemplateInput): Promise<SendGridSendResult> {
      const payload: MailSendPayload = {
        personalizations: [
          {
            to: [{ email: input.to }],
            dynamic_template_data: input.dynamicData,
          },
        ],
        from: { email: input.from || defaultFrom },
        template_id: input.templateId,
      };
      return post(payload);
    },

    async sendHtml(input: SendGridSendHtmlInput): Promise<SendGridSendResult> {
      // Delegate to the generalized path with tracking left at SendGrid's
      // account default (containsBriefingUrl omitted → no tracking_settings).
      return client.sendEmail({
        to: input.to,
        from: input.from,
        subject: input.subject,
        html: input.html,
      });
    },

    async sendEmail(input: SendGridSendEmailInput): Promise<SendGridSendResult> {
      const personalization: MailPersonalization = {
        to: [{ email: input.to }],
      };

      // Dynamic-template path: put subject + data into personalization
      // (SendGrid v3 requirement for templated sends).
      if (input.templateId) {
        if (input.dynamicTemplateData) {
          personalization.dynamic_template_data = input.dynamicTemplateData;
        }
        // SendGrid templates typically carry their own subject, but if the
        // caller provided one, override via personalization.
        if (input.subject) {
          personalization.subject = input.subject;
        }
      }

      const payload: MailSendPayload = {
        personalizations: [personalization],
        from: { email: input.from || defaultFrom },
      };

      if (input.templateId) {
        payload.template_id = input.templateId;
      } else {
        // Raw HTML (and optional text) path.
        payload.subject = input.subject;
        const content: MailContent[] = [];
        if (input.text) {
          content.push({ type: 'text/plain', value: input.text });
        }
        content.push({ type: 'text/html', value: input.html });
        payload.content = content;
      }

      // §G2 — disable click + open tracking when the message carries a
      // briefing-token URL.
      if (input.containsBriefingUrl === true) {
        payload.tracking_settings = {
          click_tracking: { enable: false, enable_text: false },
          open_tracking: { enable: false },
        };
      }

      return post(payload);
    },
  };

  return client;
}
