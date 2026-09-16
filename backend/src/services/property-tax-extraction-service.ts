import type { PropertyJurisdiction } from '@symply/contracts';

import {
  buildPropertyTaxSystemPrompt,
  buildPropertyTaxPrompt,
  type ExtractedPropertyTax,
  type PropertyTaxLineItem,
  type PropertyTaxLineItemKind,
} from '../ai/prompts/extract-property-tax';
import {
  createAnthropicAdapterForUser,
  type ModelTokenUsage,
} from '../ai/provider-factory';
import type { Env } from '../types';

/**
 * Property Tax Extraction Service
 * Uses Claude's native PDF support to extract data from a municipal or
 * provincial property tax notice. Mirrors {@link BillExtractionService} but
 * targets the tax-notice layout (account/folio number, assessed value, levy and
 * credit lines, penalty dates).
 *
 * Pass the household's {@link PropertyJurisdiction} and the prompt is built
 * around that province's bill layout — BC's three grant columns, Alberta's
 * municipal + provincial-education split, Manitoba's levies plus a netted-off
 * credit, Ontario's interim vs final bill, Québec's French «compte de taxes».
 * `null` (the default) yields a generic Canadian prompt.
 */
export class PropertyTaxExtractionService {
  private model: string;

  /**
   * `userId` bills the acting user's own Anthropic key when connected (BYOK).
   * `jurisdiction` tunes the prompt to the household's province; `null` means
   * "unknown", which yields the jurisdiction-neutral prompt.
   */
  constructor(
    private env: Env,
    private userId?: string | null,
    private jurisdiction: PropertyJurisdiction | null = null
  ) {
    this.model = 'claude-sonnet-4-5-20250929';
  }

  /**
   * Extract property tax data from a file stored in R2.
   * Automatically detects media type from file metadata or extension.
   */
  async extractFromR2(fileKey: string): Promise<{
    data: ExtractedPropertyTax;
    usage: ModelTokenUsage;
  }> {
    console.log(`[PROPERTY-TAX-EXTRACTION] Starting extraction for file: ${fileKey}`);

    const fileObject = await this.env.REPORTS_BUCKET.get(fileKey);
    if (!fileObject) {
      throw new Error('File not found in storage');
    }

    const arrayBuffer = await fileObject.arrayBuffer();
    const base64Data = this.arrayBufferToBase64(arrayBuffer);
    const fileSizeMB = arrayBuffer.byteLength / (1024 * 1024);

    console.log(`[PROPERTY-TAX-EXTRACTION] File size: ${fileSizeMB.toFixed(2)}MB`);

    if (fileSizeMB > 32) {
      throw new Error('File exceeds 32MB limit for direct processing');
    }

    const mediaType = this.detectMediaType(fileKey, fileObject.httpMetadata?.contentType);
    console.log(`[PROPERTY-TAX-EXTRACTION] Detected media type: ${mediaType}`);

    return this.extractFromBase64(base64Data, mediaType);
  }

  private detectMediaType(
    fileKey: string,
    contentType?: string
  ): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' {
    if (contentType) {
      if (contentType.includes('pdf')) return 'application/pdf';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'image/jpeg';
      if (contentType.includes('png')) return 'image/png';
      if (contentType.includes('webp')) return 'image/webp';
    }

    const lowerKey = fileKey.toLowerCase();
    if (lowerKey.endsWith('.pdf')) return 'application/pdf';
    if (lowerKey.endsWith('.jpg') || lowerKey.endsWith('.jpeg')) return 'image/jpeg';
    if (lowerKey.endsWith('.png')) return 'image/png';
    if (lowerKey.endsWith('.webp')) return 'image/webp';

    return 'application/pdf';
  }

  /**
   * Extract property tax data from base64-encoded PDF/image.
   */
  async extractFromBase64(
    base64Data: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' = 'application/pdf'
  ): Promise<{
    data: ExtractedPropertyTax;
    usage: ModelTokenUsage;
  }> {
    const jurisdiction = this.jurisdiction ?? null;
    console.log(
      `[PROPERTY-TAX-EXTRACTION] Processing ${mediaType} document (jurisdiction: ${
        jurisdiction ? `${jurisdiction.countryCode}-${jurisdiction.regionCode}` : 'unknown'
      })`
    );

    const startTime = Date.now();

    const provider = await createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'property_tax_extract', userId: this.userId },
      this.model
    );
    const { text, usage } = await provider.generateFromMediaContent({
      systemPrompt: buildPropertyTaxSystemPrompt(jurisdiction),
      userText: buildPropertyTaxPrompt(jurisdiction),
      media: { base64: base64Data, mediaType },
      cacheSystem: true,
      model: this.model,
    });

    const processingTime = Date.now() - startTime;
    console.log(`[PROPERTY-TAX-EXTRACTION] Claude response received in ${processingTime}ms`);

    const parsed = this.parseResponse(text);

    console.log(`[PROPERTY-TAX-EXTRACTION] Extraction complete:`, {
      municipality: parsed.municipality.name,
      taxYear: parsed.taxYear,
      totalTaxAmount: parsed.financial.totalTaxAmount,
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

  private parseResponse(response: string): ExtractedPropertyTax {
    const json = this.extractJsonFromResponse(response);

    try {
      const parsed = JSON.parse(json);
      return this.validateAndNormalize(parsed);
    } catch (error) {
      console.error('[PROPERTY-TAX-EXTRACTION] Failed to parse response:', error);
      throw new Error('Failed to parse property tax extraction response');
    }
  }

  private extractJsonFromResponse(response: string): string {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }

    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return response;
  }

  private validateAndNormalize(data: any): ExtractedPropertyTax {
    const grant = data.homeownerGrant || {};
    const basicAmount = this.normalizeNumber(grant.basicAmount);
    const seniorAmount = this.normalizeNumber(grant.seniorAmount);
    // A notice with grant columns/amounts is grant-eligible even if the model
    // didn't set the boolean explicitly.
    const grantEligible =
      grant.eligible === true || basicAmount != null || seniorAmount != null;

    const taxLevied = this.normalizeNumber(data.financial?.taxLevied);
    const totalCredits = this.normalizeNumber(data.financial?.totalCredits);
    const amountOwing = this.normalizeNumber(data.financial?.amountOwing);
    // Outside BC the payable figure is the amount owing AFTER any credit that is
    // already netted off the bill (Manitoba's Homeowners Affordability Tax
    // Credit, New Brunswick's Residential Property Tax Credit, PEI's provincial
    // credit). Falling back to the levied total here would overstate what the
    // homeowner actually pays, so `amountOwing` is preferred over `taxLevied`.
    const totalTaxAmount =
      this.normalizeNumber(data.financial?.totalTaxAmount) ?? amountOwing ?? taxLevied;

    return {
      municipality: {
        name: this.normalizeString(data.municipality?.name),
      },
      property: {
        address: this.normalizeString(data.property?.address),
        folioNumber: this.normalizeString(data.property?.folioNumber),
        accessCode: this.normalizeString(data.property?.accessCode),
        legalDescription: this.normalizeString(data.property?.legalDescription),
        ownerName: this.normalizeString(data.property?.ownerName),
        propertyClass: this.normalizeString(data.property?.propertyClass),
      },
      taxYear: this.normalizeInt(data.taxYear),
      assessedValue: this.normalizeNumber(data.assessedValue),
      taxableValue: this.normalizeNumber(data.taxableValue),
      // The document's own ratio wins; the registry fills in when the bill does
      // not spell it out (Saskatchewan 80, Manitoba 45, 100 elsewhere).
      assessmentRatioPercent:
        this.normalizeNumber(data.assessmentRatioPercent) ??
        this.jurisdiction?.assessmentRatioPercent ??
        null,
      billingStage: this.normalizeBillingStage(data.billingStage),
      financial: {
        totalTaxAmount,
        amountWithBasicGrant: this.normalizeNumber(data.financial?.amountWithBasicGrant),
        amountWithSeniorGrant: this.normalizeNumber(data.financial?.amountWithSeniorGrant),
        taxLevied,
        totalCredits,
        amountOwing,
      },
      lineItems: this.normalizeLineItems(data.lineItems),
      documentLanguage: this.normalizeLanguage(data.documentLanguage),
      payment: {
        mainDueDate: this.normalizeDate(data.payment?.mainDueDate),
        mainAmount: this.normalizeNumber(data.payment?.mainAmount),
        advanceDueDate: this.normalizeDate(data.payment?.advanceDueDate),
        advanceAmount: this.normalizeNumber(data.payment?.advanceAmount),
      },
      homeownerGrant: {
        eligible: grantEligible,
        basicAmount,
        seniorAmount,
        claimUrl: this.normalizeString(grant.claimUrl),
      },
      penalty: {
        description: this.normalizeString(data.penalty?.description),
        percentage: this.normalizeNumber(data.penalty?.percentage),
        afterDate: this.normalizeDate(data.penalty?.afterDate),
      },
      confidence: {
        overall: data.confidence?.overall ?? 0.5,
        municipality: data.confidence?.municipality ?? 0.5,
        taxYear: data.confidence?.taxYear ?? 0.5,
        financial: data.confidence?.financial ?? 0.5,
        payment: data.confidence?.payment ?? 0.5,
      },
      rawText: data.rawText || '',
    };
  }

  private normalizeString(value: any): string | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str.length > 0 ? str : null;
  }

  private normalizeBillingStage(value: any): ExtractedPropertyTax['billingStage'] {
    const str = this.normalizeString(value)?.toLowerCase();
    if (str === 'interim' || str === 'final' || str === 'combined' || str === 'annual') {
      return str;
    }
    return null;
  }

  private normalizeLanguage(value: any): 'en' | 'fr' | null {
    const str = this.normalizeString(value)?.toLowerCase();
    if (str === 'fr' || str === 'french' || str === 'français') return 'fr';
    if (str === 'en' || str === 'english') return 'en';
    return null;
  }

  /**
   * Normalize the printed levy/credit lines. Amounts are forced positive — the
   * sign lives in `kind`, so a credit the model returned as -1600 still reads as
   * a $1,600 credit rather than a negative levy.
   */
  private normalizeLineItems(raw: any): PropertyTaxLineItem[] {
    if (!Array.isArray(raw)) return [];
    const kinds: PropertyTaxLineItemKind[] = [
      'levy',
      'credit',
      'grant',
      'fee',
      'penalty',
      'other',
    ];
    return raw
      .map((item: any) => {
        const label = this.normalizeString(item?.label);
        if (!label) return null;
        const amount = this.normalizeNumber(item?.amount);
        const rawKind = this.normalizeString(item?.kind)?.toLowerCase();
        const kind = kinds.find((k) => k === rawKind) ?? 'levy';
        return { label, amount: amount === null ? null : Math.abs(amount), kind };
      })
      .filter((item): item is PropertyTaxLineItem => item !== null);
  }

  private normalizeInt(value: any): number | null {
    const num = this.normalizeNumber(value);
    return num === null ? null : Math.round(num);
  }

  private normalizeDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;

    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  private normalizeNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return isNaN(value) ? null : value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert extracted data to property tax creation input.
   * Amounts are converted from dollars to integer cents.
   */
  toCreatePropertyTaxInput(extracted: ExtractedPropertyTax): {
    taxYear: number;
    assessedValue: number;
    taxAmount: number;
    mainPaymentAmount: number;
    mainPaymentDueDate: string;
    advancePaymentAmount?: number;
    advancePaymentDueDate?: string;
    homeownerGrantEligible: boolean;
    homeownerGrantAmount?: number;
    municipalityName?: string;
    confidenceScore: number;
    /** SK taxable assessment / MB portioned assessment, in cents. */
    taxableValue?: number;
    /** Percent of the assessed value that is taxed (80 SK, 45 MB, else 100). */
    assessmentRatioPercent?: number;
    /** Total of the levy lines BEFORE any credit, in cents. */
    taxLevied?: number;
    /** Total of the credit/rebate lines netted off this bill, in cents. */
    totalCredits?: number;
    /** What is actually payable after those credits, in cents. */
    amountOwing?: number;
    /** Ontario's interim vs final bill, and combined notices elsewhere. */
    billingStage?: 'interim' | 'final' | 'combined' | 'annual';
  } {
    const totalTax = extracted.financial.totalTaxAmount;
    const mainAmount = extracted.payment.mainAmount ?? totalTax;
    const dueDate = extracted.payment.mainDueDate;

    if (extracted.taxYear === null) {
      throw new Error('Tax year is required');
    }
    if (totalTax === null) {
      throw new Error('Total tax amount is required');
    }
    if (!dueDate) {
      throw new Error('Main due date is required');
    }

    const toCents = (v: number) => Math.round(v * 100);

    return {
      taxYear: extracted.taxYear,
      assessedValue: extracted.assessedValue != null ? toCents(extracted.assessedValue) : 0,
      taxAmount: toCents(totalTax),
      mainPaymentAmount: toCents(mainAmount ?? totalTax),
      mainPaymentDueDate: dueDate,
      advancePaymentAmount:
        extracted.payment.advanceAmount != null
          ? toCents(extracted.payment.advanceAmount)
          : undefined,
      advancePaymentDueDate: extracted.payment.advanceDueDate || undefined,
      homeownerGrantEligible: extracted.homeownerGrant.eligible,
      homeownerGrantAmount:
        extracted.homeownerGrant.basicAmount != null
          ? toCents(extracted.homeownerGrant.basicAmount)
          : undefined,
      municipalityName: extracted.municipality.name || undefined,
      confidenceScore: extracted.confidence.overall,
      // Extraction-only extras: returned for the review sheet, never persisted,
      // so they need no schema change. `?? undefined` (not `||`) so a genuine 0
      // — a fully-credited bill, a 0% ratio row — survives.
      taxableValue: extracted.taxableValue != null ? toCents(extracted.taxableValue) : undefined,
      assessmentRatioPercent: extracted.assessmentRatioPercent ?? undefined,
      taxLevied:
        extracted.financial.taxLevied != null ? toCents(extracted.financial.taxLevied) : undefined,
      totalCredits:
        extracted.financial.totalCredits != null
          ? toCents(extracted.financial.totalCredits)
          : undefined,
      amountOwing:
        extracted.financial.amountOwing != null
          ? toCents(extracted.financial.amountOwing)
          : undefined,
      billingStage: extracted.billingStage ?? undefined,
    };
  }
}
