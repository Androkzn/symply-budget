import type { PropertyJurisdiction } from '@symply/contracts';

import {
  buildPropertyAssessmentSystemPrompt,
  buildPropertyAssessmentPrompt,
  type ExtractedPropertyAssessment,
  type PropertyAssessmentValueHistoryYear,
  type BCAssessmentSale,
  type BCAssessmentPropertyInfo,
  type BCAssessmentHomeownerGrant,
} from '../ai/prompts/extract-property-assessment';
import {
  createAnthropicAdapterForUser,
  type ModelTokenUsage,
} from '../ai/provider-factory';
import type { Env } from '../types';

/**
 * Property Assessment Extraction Service
 * Uses Claude's native PDF support to extract data from a property assessment
 * notice. Mirrors {@link PropertyTaxExtractionService} but targets the
 * assessment-notice layout (assessed value, land vs. buildings split,
 * prior-year value, appeal deadline).
 *
 * The class name is retained for compatibility with existing importers and the
 * `/bc-assessment` route path, but the extractor is no longer BC-only: pass the
 * household's {@link PropertyJurisdiction} and the prompt is built around that
 * province's vocabulary and paperwork. Passing `null` (the default) yields a
 * generic Canadian prompt — never BC's rules applied to another province.
 */
export class BCAssessmentExtractionService {
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
   * Extract assessment data from a file stored in R2.
   * Automatically detects media type from file metadata or extension.
   */
  async extractFromR2(fileKey: string): Promise<{
    data: ExtractedPropertyAssessment;
    usage: ModelTokenUsage;
  }> {
    console.log(`[ASSESSMENT-EXTRACTION] Starting extraction for file: ${fileKey}`);

    const fileObject = await this.env.REPORTS_BUCKET.get(fileKey);
    if (!fileObject) {
      throw new Error('File not found in storage');
    }

    const arrayBuffer = await fileObject.arrayBuffer();
    const base64Data = this.arrayBufferToBase64(arrayBuffer);
    const fileSizeMB = arrayBuffer.byteLength / (1024 * 1024);

    console.log(`[ASSESSMENT-EXTRACTION] File size: ${fileSizeMB.toFixed(2)}MB`);

    if (fileSizeMB > 32) {
      throw new Error('File exceeds 32MB limit for direct processing');
    }

    const mediaType = this.detectMediaType(fileKey, fileObject.httpMetadata?.contentType);
    console.log(`[ASSESSMENT-EXTRACTION] Detected media type: ${mediaType}`);

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
   * Extract assessment data from base64-encoded PDF/image.
   */
  async extractFromBase64(
    base64Data: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' = 'application/pdf'
  ): Promise<{
    data: ExtractedPropertyAssessment;
    usage: ModelTokenUsage;
  }> {
    const jurisdiction = this.jurisdiction ?? null;
    console.log(
      `[ASSESSMENT-EXTRACTION] Processing ${mediaType} document (jurisdiction: ${
        jurisdiction ? `${jurisdiction.countryCode}-${jurisdiction.regionCode}` : 'unknown'
      })`
    );

    const startTime = Date.now();

    const provider = await createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'bc_assessment_extract', userId: this.userId },
      this.model
    );
    const { text, usage } = await provider.generateFromMediaContent({
      systemPrompt: buildPropertyAssessmentSystemPrompt(jurisdiction),
      userText: buildPropertyAssessmentPrompt(jurisdiction),
      media: { base64: base64Data, mediaType },
      cacheSystem: true,
      model: this.model,
    });

    const processingTime = Date.now() - startTime;
    console.log(`[ASSESSMENT-EXTRACTION] Claude response received in ${processingTime}ms`);

    const parsed = this.parseResponse(text);

    console.log(`[ASSESSMENT-EXTRACTION] Extraction complete:`, {
      assessmentYear: parsed.assessmentYear,
      totalValue: parsed.values.totalValue,
      historyYears: parsed.valueHistory.length,
      sales: parsed.salesHistory.length,
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

  private parseResponse(response: string): ExtractedPropertyAssessment {
    const json = this.extractJsonFromResponse(response);

    try {
      const parsed = JSON.parse(json);
      return this.validateAndNormalize(parsed);
    } catch (error) {
      console.error('[ASSESSMENT-EXTRACTION] Failed to parse response:', error);
      throw new Error('Failed to parse property assessment extraction response');
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

  private validateAndNormalize(data: any): ExtractedPropertyAssessment {
    const values = data.values || {};
    const totalValue = this.normalizeNumber(values.totalValue);
    const previousYearValue = this.normalizeNumber(values.previousYearValue);

    const owners = this.normalizeStringArray(data.property?.owners);
    const ownerName =
      this.normalizeString(data.property?.ownerName) ?? (owners.length > 0 ? owners[0] : null);

    // The document's own ratio wins; the registry fills in when the notice does
    // not spell it out (Saskatchewan 80, Manitoba 45, 100 everywhere else).
    const assessmentRatioPercent =
      this.normalizeNumber(values.assessmentRatioPercent) ??
      this.jurisdiction?.assessmentRatioPercent ??
      null;

    return {
      assessmentYear: this.normalizeInt(data.assessmentYear),
      property: {
        address: this.normalizeString(data.property?.address),
        rollNumber: this.normalizeString(data.property?.rollNumber),
        jurisdiction: this.normalizeString(data.property?.jurisdiction),
        jurisdictionNumber: this.normalizeString(data.property?.jurisdictionNumber),
        pid: this.normalizeString(data.property?.pid),
        propertyClass: this.normalizeString(data.property?.propertyClass),
        ownerName,
        owners,
        legalDescription: this.normalizeString(data.property?.legalDescription),
        accessKey: this.normalizeString(data.property?.accessKey),
      },
      propertyInfo: this.normalizePropertyInfo(data.propertyInfo),
      values: {
        totalValue,
        landValue: this.normalizeNumber(values.landValue),
        improvementValue: this.normalizeNumber(values.improvementValue),
        previousYearValue,
        taxableValue: this.normalizeNumber(values.taxableValue),
        cappedValue: this.normalizeNumber(values.cappedValue),
        assessmentRatioPercent,
      },
      valueHistory: this.normalizeValueHistory(data.valueHistory),
      salesHistory: this.normalizeSalesHistory(data.salesHistory),
      homeownerGrant: this.normalizeHomeownerGrant(data.homeownerGrant),
      noticeDate: this.normalizeDate(data.noticeDate),
      appealDeadline: this.normalizeDate(data.appealDeadline),
      documentLanguage: this.normalizeLanguage(data.documentLanguage),
      confidence: {
        overall: data.confidence?.overall ?? 0.5,
        assessmentYear: data.confidence?.assessmentYear ?? 0.5,
        values: data.confidence?.values ?? 0.5,
        property: data.confidence?.property ?? 0.5,
      },
      rawText: data.rawText || '',
    };
  }

  private normalizeLanguage(value: any): 'en' | 'fr' | null {
    const str = this.normalizeString(value)?.toLowerCase();
    if (str === 'fr' || str === 'french' || str === 'français') return 'fr';
    if (str === 'en' || str === 'english') return 'en';
    return null;
  }

  /**
   * Normalize the multi-year value history: dedupe by year, drop entries without
   * a usable year, and sort descending (newest first) for stable output.
   */
  private normalizeValueHistory(raw: any): PropertyAssessmentValueHistoryYear[] {
    if (!Array.isArray(raw)) return [];
    const byYear = new Map<number, PropertyAssessmentValueHistoryYear>();
    for (const entry of raw) {
      const year = this.normalizeInt(entry?.year);
      if (year === null) continue;
      byYear.set(year, {
        year,
        totalValue: this.normalizeNumber(entry?.totalValue),
        landValue: this.normalizeNumber(entry?.landValue),
        improvementValue: this.normalizeNumber(entry?.improvementValue),
        taxableValue: this.normalizeNumber(entry?.taxableValue),
        cappedValue: this.normalizeNumber(entry?.cappedValue),
        exemptValue: this.normalizeNumber(entry?.exemptValue),
        netValue: this.normalizeNumber(entry?.netValue),
        // A stated 0 is a REAL year-over-year change wherever the valuation
        // date is frozen (Ontario since 2016, Saskatchewan 2023-2028), so it
        // must survive normalization as 0 and never collapse to null.
        changePercent: this.normalizeNumber(entry?.changePercent),
      });
    }
    return Array.from(byYear.values()).sort((a, b) => b.year - a.year);
  }

  private normalizeSalesHistory(raw: any): BCAssessmentSale[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s: any) => ({
        date: this.normalizeDate(s?.date),
        price: this.normalizeNumber(s?.price),
      }))
      .filter((s: BCAssessmentSale) => s.date !== null || s.price !== null);
  }

  private normalizePropertyInfo(raw: any): BCAssessmentPropertyInfo {
    const info = raw || {};
    return {
      yearBuilt: this.normalizeInt(info.yearBuilt),
      description: this.normalizeString(info.description),
      bedrooms: this.normalizeInt(info.bedrooms),
      bathrooms: this.normalizeNumber(info.bathrooms),
      carports: this.normalizeInt(info.carports),
      garages: this.normalizeString(info.garages),
      landSizeSqFt: this.normalizeNumber(info.landSizeSqFt),
      firstFloorAreaSqFt: this.normalizeNumber(info.firstFloorAreaSqFt),
      secondFloorAreaSqFt: this.normalizeNumber(info.secondFloorAreaSqFt),
      basementFinishAreaSqFt: this.normalizeNumber(info.basementFinishAreaSqFt),
      strataAreaSqFt: this.normalizeNumber(info.strataAreaSqFt),
      buildingStoreys: this.normalizeInt(info.buildingStoreys),
      grossLeasableAreaSqFt: this.normalizeNumber(info.grossLeasableAreaSqFt),
      netLeasableAreaSqFt: this.normalizeNumber(info.netLeasableAreaSqFt),
      manufacturedHome:
        typeof info.manufacturedHome === 'boolean' ? info.manufacturedHome : null,
    };
  }

  private normalizeHomeownerGrant(raw: any): BCAssessmentHomeownerGrant | null {
    if (!raw || typeof raw !== 'object') return null;
    const basicGrant = this.normalizeNumber(raw.basicGrant);
    const additionalGrant = this.normalizeNumber(raw.additionalGrant);
    const grantClaimed = this.normalizeNumber(raw.grantClaimed);
    if (basicGrant === null && additionalGrant === null && grantClaimed === null) {
      return null;
    }
    return { basicGrant, additionalGrant, grantClaimed };
  }

  private normalizeStringArray(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((v) => this.normalizeString(v))
      .filter((v): v is string => v !== null);
  }

  private normalizeString(value: any): string | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str.length > 0 ? str : null;
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
   * Convert extracted data to BC Assessment creation input.
   * Money amounts are converted from dollars to integer cents. The
   * year-over-year change percent is derived from the total and prior-year
   * values when the notice doesn't state it directly.
   */
  toCreateBCAssessmentInput(extracted: ExtractedPropertyAssessment): {
    assessmentYear: number;
    propertyClass?: string;
    assessedValue: number;
    landValue?: number;
    improvementValue?: number;
    previousYearValue?: number;
    changePercent?: number;
    appealDeadline?: string;
    confidenceScore: number;
    /** SK taxable assessment / MB portioned assessment, in cents. */
    taxableValue?: number;
    /** NS/PE capped (taxable) assessed value, in cents. */
    cappedValue?: number;
    /** Percent of the assessed value that is taxed (80 SK, 45 MB, else 100). */
    assessmentRatioPercent?: number;
  } {
    if (extracted.assessmentYear === null) {
      throw new Error('Assessment year is required');
    }

    const year = extracted.assessmentYear;
    const history = extracted.valueHistory ?? [];
    const currentInHistory = history.find((h) => h.year === year);
    const prevInHistory = history.find((h) => h.year === year - 1);

    // Prefer the notice's summary values, then fall back to the matching entry
    // in the multi-year history table so a single upload still yields a complete
    // current-year record.
    const total = extracted.values.totalValue ?? currentInHistory?.totalValue ?? null;
    if (total === null) {
      throw new Error('Total assessed value is required');
    }

    const land = extracted.values.landValue ?? currentInHistory?.landValue ?? null;
    const improvement =
      extracted.values.improvementValue ?? currentInHistory?.improvementValue ?? null;
    const prev = extracted.values.previousYearValue ?? prevInHistory?.totalValue ?? null;

    const toCents = (v: number) => Math.round(v * 100);
    // Derive the YoY change from the prior-year value when possible; otherwise
    // use the change percent stated in the history table for the current year.
    //
    // `??` (not `||`) throughout on purpose: where the valuation date is frozen
    // — Ontario since 2016, Saskatchewan for 2025-2028, Manitoba between
    // biennial reassessments — an unchanged value is CORRECT and its derived
    // change is exactly 0. A `||` here would discard that real 0 and fall back
    // to the table's figure or to "missing".
    const derivedChange =
      prev != null && prev > 0 ? Math.round(((total - prev) / prev) * 1000) / 10 : undefined;
    const changePercent = derivedChange ?? currentInHistory?.changePercent ?? undefined;

    // Both taxed-value variants are extraction-only: they are returned to the
    // client for review and never persisted, so no schema change is involved.
    const taxable = extracted.values.taxableValue ?? currentInHistory?.taxableValue ?? null;
    const capped = extracted.values.cappedValue ?? currentInHistory?.cappedValue ?? null;
    const ratio = extracted.values.assessmentRatioPercent ?? null;

    return {
      assessmentYear: year,
      propertyClass: extracted.property.propertyClass || undefined,
      assessedValue: toCents(total),
      landValue: land != null ? toCents(land) : undefined,
      improvementValue: improvement != null ? toCents(improvement) : undefined,
      previousYearValue: prev != null ? toCents(prev) : undefined,
      changePercent,
      appealDeadline: extracted.appealDeadline || undefined,
      confidenceScore: extracted.confidence.overall,
      taxableValue: taxable != null ? toCents(taxable) : undefined,
      cappedValue: capped != null ? toCents(capped) : undefined,
      assessmentRatioPercent: ratio != null ? ratio : undefined,
    };
  }

  /**
   * Map the extracted multi-year value history into create-ready records (cents),
   * EXCLUDING the current assessment year — that one flows through the review
   * sheet so the user can confirm/edit it and attach the PDF + appeal deadline.
   *
   * A single BC Assessment notice (or municipal "General Assessment" page) lists
   * several prior years; this lets us backfill them all from one upload instead
   * of making the user re-upload a document per year. previousYearValue and the
   * YoY change are derived from adjacent history entries when the table doesn't
   * state them directly. Years without a usable total are skipped (we can't
   * create a row without an assessed value).
   *
   * Jurisdiction-independent by construction: it reads only the years the
   * document itself listed, so an Ontario phase-in table, a Nova Scotia
   * market/capped table and a Québec three-year rôle all backfill the same way.
   * A frozen valuation date produces repeated totals and a derived change of
   * exactly 0 — that 0 is the correct answer and is preserved (see the `??`
   * note below), never treated as missing data.
   */
  toBackfillHistoryInputs(extracted: ExtractedPropertyAssessment): Array<{
    assessmentYear: number;
    propertyClass?: string;
    assessedValue: number;
    landValue?: number;
    improvementValue?: number;
    previousYearValue?: number;
    changePercent?: number;
  }> {
    const history = extracted.valueHistory ?? [];
    const totalByYear = new Map<number, number>();
    for (const h of history) {
      if (h.totalValue != null) totalByYear.set(h.year, h.totalValue);
    }

    const toCents = (v: number) => Math.round(v * 100);
    const propertyClass = extracted.property.propertyClass || undefined;
    const out: Array<{
      assessmentYear: number;
      propertyClass?: string;
      assessedValue: number;
      landValue?: number;
      improvementValue?: number;
      previousYearValue?: number;
      changePercent?: number;
    }> = [];

    for (const h of history) {
      if (h.year === extracted.assessmentYear) continue; // current year → review flow
      if (h.totalValue == null) continue;
      const prev = totalByYear.get(h.year - 1) ?? null;
      const derivedChange =
        prev != null && prev > 0 ? Math.round(((h.totalValue - prev) / prev) * 1000) / 10 : undefined;
      out.push({
        assessmentYear: h.year,
        propertyClass,
        assessedValue: toCents(h.totalValue),
        landValue: h.landValue != null ? toCents(h.landValue) : undefined,
        improvementValue: h.improvementValue != null ? toCents(h.improvementValue) : undefined,
        previousYearValue: prev != null ? toCents(prev) : undefined,
        // `??`, never `||`: a stated or derived 0% is the CORRECT answer under a
        // frozen valuation date and must not be dropped as if it were missing.
        changePercent: h.changePercent ?? derivedChange ?? undefined,
      });
    }

    return out;
  }
}
