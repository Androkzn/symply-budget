import {
  EXTRACT_UTILITY_BILL_SYSTEM_PROMPT,
  EXTRACT_UTILITY_BILL_PROMPT_V1,
  type ExtractedUtilityBill,
} from '../ai/prompts/extract-utility-bill';
import {
  createAnthropicAdapterForUser,
  type ModelTokenUsage,
} from '../ai/provider-factory';
import type { Env } from '../types';

/**
 * Bill Extraction Service
 * Uses Claude's native PDF support to extract utility bill data
 */
export class BillExtractionService {
  private model: string;

  /** `userId` bills the acting user's own Anthropic key when connected (BYOK). */
  constructor(private env: Env, private userId?: string | null) {
    this.model = 'claude-sonnet-4-5-20250929';
  }

  /**
   * Extract bill data from a file stored in R2
   * Automatically detects media type from file metadata or extension
   */
  async extractFromR2(fileKey: string): Promise<{
    data: ExtractedUtilityBill;
    usage: ModelTokenUsage;
  }> {
    console.log(`[BILL-EXTRACTION] Starting extraction for file: ${fileKey}`);

    // Download file from R2
    const fileObject = await this.env.REPORTS_BUCKET.get(fileKey);
    if (!fileObject) {
      throw new Error('File not found in storage');
    }

    const arrayBuffer = await fileObject.arrayBuffer();
    const base64Data = this.arrayBufferToBase64(arrayBuffer);
    const fileSizeMB = arrayBuffer.byteLength / (1024 * 1024);

    console.log(`[BILL-EXTRACTION] File size: ${fileSizeMB.toFixed(2)}MB`);

    // Check size limit (Claude supports up to 32MB)
    if (fileSizeMB > 32) {
      throw new Error('File exceeds 32MB limit for direct processing');
    }

    // Detect media type from R2 metadata or file extension
    const mediaType = this.detectMediaType(fileKey, fileObject.httpMetadata?.contentType);
    console.log(`[BILL-EXTRACTION] Detected media type: ${mediaType}`);

    return this.extractFromBase64(base64Data, mediaType);
  }

  /**
   * Detect media type from file key or content type
   */
  private detectMediaType(
    fileKey: string,
    contentType?: string
  ): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' {
    // Check content type from R2 metadata first
    if (contentType) {
      if (contentType.includes('pdf')) return 'application/pdf';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'image/jpeg';
      if (contentType.includes('png')) return 'image/png';
      if (contentType.includes('webp')) return 'image/webp';
    }

    // Fall back to file extension
    const lowerKey = fileKey.toLowerCase();
    if (lowerKey.endsWith('.pdf')) return 'application/pdf';
    if (lowerKey.endsWith('.jpg') || lowerKey.endsWith('.jpeg')) return 'image/jpeg';
    if (lowerKey.endsWith('.png')) return 'image/png';
    if (lowerKey.endsWith('.webp')) return 'image/webp';

    // Default to PDF
    return 'application/pdf';
  }

  /**
   * Extract bill data from base64-encoded PDF/image
   */
  async extractFromBase64(
    base64Data: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' = 'application/pdf'
  ): Promise<{
    data: ExtractedUtilityBill;
    usage: ModelTokenUsage;
  }> {
    console.log(`[BILL-EXTRACTION] Processing ${mediaType} document`);

    const startTime = Date.now();

    const provider = await createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'utility_bill_extract', userId: this.userId },
      this.model
    );
    const { text, usage } = await provider.generateFromMediaContent({
      systemPrompt: EXTRACT_UTILITY_BILL_SYSTEM_PROMPT,
      userText: EXTRACT_UTILITY_BILL_PROMPT_V1,
      media: { base64: base64Data, mediaType },
      cacheSystem: true,
      model: this.model,
    });

    const processingTime = Date.now() - startTime;
    console.log(`[BILL-EXTRACTION] Claude response received in ${processingTime}ms`);

    const parsed = this.parseResponse(text);

    console.log(`[BILL-EXTRACTION] Extraction complete:`, {
      provider: parsed.provider.name,
      type: parsed.provider.type,
      amount: parsed.financial.amountDue,
      confidence: parsed.confidence.overall,
    });

    return {
      data: parsed,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
      },
    };
  }

  /**
   * Parse Claude's response into structured data
   */
  private parseResponse(response: string): ExtractedUtilityBill {
    const json = this.extractJsonFromResponse(response);

    try {
      const parsed = JSON.parse(json);
      return this.validateAndNormalize(parsed);
    } catch (error) {
      console.error('[BILL-EXTRACTION] Failed to parse response:', error);
      throw new Error('Failed to parse bill extraction response');
    }
  }

  /**
   * Extract JSON from response (handles markdown code blocks)
   */
  private extractJsonFromResponse(response: string): string {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }

    // Try to find JSON object directly
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return response;
  }

  /**
   * Validate and normalize extracted data
   */
  private validateAndNormalize(data: any): ExtractedUtilityBill {
    // Normalize bill type
    const billType = this.normalizeBillType(data.provider?.type);

    // Normalize dates
    const periodStart = this.normalizeDate(data.billing?.periodStart);
    const periodEnd = this.normalizeDate(data.billing?.periodEnd);
    const billingDate = this.normalizeDate(data.billing?.billingDate);
    const dueDate = this.normalizeDate(data.billing?.dueDate);

    // Calculate period days if not provided
    let periodDays = data.usage?.periodDays;
    if (!periodDays && periodStart && periodEnd) {
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      provider: {
        name: data.provider?.name || null,
        type: billType,
      },
      account: {
        number: this.normalizeAccountNumber(data.account?.number),
        invoiceNumber: data.account?.invoiceNumber || null,
        serviceAddress: data.account?.serviceAddress || null,
        customerName: data.account?.customerName || null,
      },
      billing: {
        periodStart,
        periodEnd,
        billingDate,
        dueDate,
      },
      financial: {
        amountDue: this.normalizeNumber(data.financial?.amountDue),
        previousBalance: this.normalizeNumber(data.financial?.previousBalance),
        paymentsReceived: this.normalizeNumber(data.financial?.paymentsReceived),
        currentCharges: this.normalizeNumber(data.financial?.currentCharges),
        latePaymentCharge: this.normalizeNumber(data.financial?.latePaymentCharge),
      },
      usage: {
        quantity: this.normalizeNumber(data.usage?.quantity),
        unit: data.usage?.unit || null,
        periodDays,
        averageDailyUsage: this.normalizeNumber(data.usage?.averageDailyUsage),
        averageDailyCost: this.normalizeNumber(data.usage?.averageDailyCost),
        meterNumber: data.usage?.meterNumber || null,
      },
      meterReadings: Array.isArray(data.meterReadings)
        ? data.meterReadings.map((r: any) => ({
            meterNumber: r?.meterNumber || null,
            currentReading: this.normalizeNumber(r?.currentReading),
            currentReadingDate: this.normalizeDate(r?.currentReadingDate),
            previousReading: this.normalizeNumber(r?.previousReading),
            previousReadingDate: this.normalizeDate(r?.previousReadingDate),
            consumption: this.normalizeNumber(r?.consumption),
            unit: r?.unit || null,
            conversionFactor: this.normalizeNumber(r?.conversionFactor),
          }))
        : [],
      lineItems: Array.isArray(data.lineItems)
        ? data.lineItems
            .filter((li: any) => li && (li.description || li.amount != null))
            .map((li: any) => ({
              description: String(li.description || '').trim(),
              amount: this.normalizeNumber(li.amount) ?? 0,
              quantity: this.normalizeNumber(li.quantity),
              rate: this.normalizeNumber(li.rate),
              unit: li.unit || null,
            }))
        : [],
      taxes: Array.isArray(data.taxes)
        ? data.taxes
            .filter((t: any) => t && (t.description || t.amount != null))
            .map((t: any) => ({
              description: String(t.description || '').trim(),
              amount: this.normalizeNumber(t.amount) ?? 0,
            }))
        : [],
      comparison: {
        lastBillUsage: this.normalizeNumber(data.comparison?.lastBillUsage),
        lastYearUsage: this.normalizeNumber(data.comparison?.lastYearUsage),
        unit: data.comparison?.unit || null,
      },
      rates: {
        basicCharge: this.normalizeNumber(data.rates?.basicCharge),
        energyRate: this.normalizeNumber(data.rates?.energyRate),
      },
      confidence: {
        overall: data.confidence?.overall || 0.5,
        provider: data.confidence?.provider || 0.5,
        account: data.confidence?.account || 0.5,
        billing: data.confidence?.billing || 0.5,
        financial: data.confidence?.financial || 0.5,
        usage: data.confidence?.usage || 0.5,
      },
      rawText: data.rawText || '',
    };
  }

  /**
   * Normalize bill type to valid enum value
   */
  private normalizeBillType(
    type: string | undefined
  ): 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other' {
    const normalized = type?.toLowerCase();
    switch (normalized) {
      case 'electricity':
      case 'electric':
      case 'hydro':
        return 'electricity';
      case 'gas':
      case 'natural gas':
        return 'gas';
      case 'water':
        return 'water';
      case 'sewer':
        return 'sewer';
      case 'garbage':
      case 'waste':
        return 'garbage';
      default:
        return 'other';
    }
  }

  /**
   * Normalize date to YYYY-MM-DD format
   */
  private normalizeDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;

    try {
      // Handle various date formats
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;

      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  /**
   * Normalize account number (remove spaces)
   */
  private normalizeAccountNumber(accountNum: string | null | undefined): string | null {
    if (!accountNum) return null;
    return accountNum.replace(/\s+/g, '');
  }

  /**
   * Normalize number values
   */
  private normalizeNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert extracted data to bill creation input
   */
  toCreateBillInput(extracted: ExtractedUtilityBill): {
    billType: 'electricity' | 'gas' | 'water' | 'sewer' | 'garbage' | 'other';
    provider?: string;
    accountNumber?: string;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    amount: number;
    dueDate: string;
    usageQuantity?: number;
    usageUnit?: string;
    aiExtractedData: object;
    confidenceScore: number;
  } {
    if (!extracted.billing.periodStart || !extracted.billing.periodEnd) {
      throw new Error('Billing period is required');
    }
    if (!extracted.billing.dueDate) {
      throw new Error('Due date is required');
    }
    if (extracted.financial.amountDue === null) {
      throw new Error('Amount due is required');
    }

    return {
      billType: extracted.provider.type,
      provider: extracted.provider.name || undefined,
      accountNumber: extracted.account.number || undefined,
      billingPeriodStart: extracted.billing.periodStart,
      billingPeriodEnd: extracted.billing.periodEnd,
      amount: Math.round(extracted.financial.amountDue * 100), // Convert to cents
      dueDate: extracted.billing.dueDate,
      usageQuantity: extracted.usage.quantity || undefined,
      usageUnit: extracted.usage.unit || undefined,
      aiExtractedData: extracted,
      confidenceScore: extracted.confidence.overall,
    };
  }
}
