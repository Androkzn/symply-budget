/** Client-side BYOK schema/prompts for registered / pension statement extract. */

export const REGISTERED_STATEMENT_IMPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['accounts', 'confidence'],
  properties: {
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'account_type',
          'institution',
          'is_employer_plan',
          'employer_name',
          'balance',
          'reported_room',
          'contributions',
        ],
        properties: {
          account_type: {
            type: ['string', 'null'],
            enum: ['rrsp', 'tfsa', 'fhsa', 'dpsp', 'rpp', null],
          },
          institution: { type: ['string', 'null'] },
          is_employer_plan: { type: 'boolean' },
          employer_name: { type: ['string', 'null'] },
          balance: { type: ['number', 'null'] },
          reported_room: { type: ['number', 'null'] },
          contributions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['date', 'amount', 'contributor'],
              properties: {
                date: { type: ['string', 'null'] },
                amount: { type: ['number', 'null'] },
                contributor: {
                  type: 'string',
                  enum: ['self', 'employer'],
                },
              },
            },
          },
        },
      },
    },
    confidence: { type: 'number' },
  },
};

export const REGISTERED_STATEMENT_IMPORT_SYSTEM = `Extract Canadian registered / pension accounts (RRSP, TFSA, FHSA, DPSP, pension) from a statement.
Balances and contribution amounts are dollars. Do not invent accounts. Return ONLY via the tool.`;

export function buildRegisteredStatementImportUserPrompt(sourceText?: string): string {
  if (sourceText?.trim()) {
    return `Extract registered accounts from this text:\n\n${sourceText.trim()}`;
  }
  return 'Extract registered accounts from the attached image(s).';
}
