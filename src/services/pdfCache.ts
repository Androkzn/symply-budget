import NetInfo from '@react-native-community/netinfo';
import RNFS from 'react-native-fs';

/**
 * PDF Cache Manager - Production Hardened
 *
 * Manages local caching of PDF files for offline access with:
 * - Race condition prevention (download locks)
 * - Retry logic with exponential backoff
 * - File validation (PDF magic number check)
 * - Disk space management
 * - Network status checks
 * - Atomic metadata writes
 * - Comprehensive error handling
 */

export interface CachedPDFInfo {
  reportId: string;
  filePath: string;
  fileSize: number;
  cachedAt: Date;
  lastAccessed: Date;
}

export class PDFCacheManager {
  private cacheDir: string;
  private metadataFile: string;
  private tempMetadataFile: string;
  private readonly MAX_CACHE_AGE_DAYS = 30;
  private readonly MAX_CACHE_SIZE_MB = 500; // 500MB max cache
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly DOWNLOAD_TIMEOUT_MS = 120000; // 2 minutes
  private readonly MIN_DISK_SPACE_MB = 100; // Require 100MB free space
  private readonly PDF_MAGIC_NUMBERS = ['%PDF-'];

  // Download locks to prevent race conditions
  private downloadLocks: Map<string, Promise<string>> = new Map();

  constructor() {
    this.cacheDir = `${RNFS.DocumentDirectoryPath}/pdf_cache/`;
    this.metadataFile = `${this.cacheDir}metadata.json`;
    this.tempMetadataFile = `${this.cacheDir}metadata.tmp.json`;
  }

  /**
   * Initialize cache directory with error handling
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      const dirExists = await RNFS.exists(this.cacheDir);
      if (!dirExists) {
        await RNFS.mkdir(this.cacheDir);
        console.log('[PDFCache] Created cache directory:', this.cacheDir);
      }
    } catch (error) {
      console.error('[PDFCache] Failed to create cache directory:', error);
      throw new Error('Failed to initialize cache directory. Check app permissions.');
    }
  }

  /**
   * Check available disk space
   */
  private async checkDiskSpace(): Promise<boolean> {
    try {
      const freeSpace = await RNFS.getFSInfo();
      const freeSpaceMB = freeSpace.freeSpace / (1024 * 1024);

      if (freeSpaceMB < this.MIN_DISK_SPACE_MB) {
        console.warn(`[PDFCache] Low disk space: ${freeSpaceMB.toFixed(0)}MB free`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[PDFCache] Error checking disk space:', error);
      // Don't block on disk space check failure
      return true;
    }
  }

  /**
   * Check network connectivity
   */
  private async checkNetworkStatus(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected === true;
    } catch (error) {
      console.error('[PDFCache] Error checking network status:', error);
      // Assume connected if check fails
      return true;
    }
  }

  /**
   * Validate that a file is actually a PDF
   */
  private async validatePdfFile(filePath: string): Promise<boolean> {
    try {
      // Read first 5 bytes to check PDF magic number
      const header = await RNFS.read(filePath, 5, 0, 'ascii');

      if (!this.PDF_MAGIC_NUMBERS.some((magic) => header.startsWith(magic))) {
        console.error('[PDFCache] File is not a valid PDF:', filePath);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[PDFCache] Error validating PDF file:', error);
      return false;
    }
  }

  /**
   * Get cached PDF if available and not expired
   */
  async getCachedPdf(reportId: string): Promise<string | null> {
    try {
      await this.ensureCacheDir();

      const filePath = `${this.cacheDir}${reportId}.pdf`;
      const fileExists = await RNFS.exists(filePath);

      if (!fileExists) {
        console.log('[PDFCache] Cache miss for report:', reportId);
        return null;
      }

      // Check if file is expired
      const metadata = await this.getMetadata();
      const fileInfo = metadata[reportId];

      if (fileInfo) {
        const cachedDate = new Date(fileInfo.cachedAt);
        const now = new Date();
        const daysSinceCached =
          (now.getTime() - cachedDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceCached > this.MAX_CACHE_AGE_DAYS) {
          console.log(
            `[PDFCache] Cache expired for report ${reportId} (${daysSinceCached.toFixed(0)} days old)`
          );
          await this.clearCache(reportId);
          return null;
        }

        // Validate file integrity
        const isValid = await this.validatePdfFile(filePath);
        if (!isValid) {
          console.warn('[PDFCache] Cached file failed validation, clearing:', reportId);
          await this.clearCache(reportId);
          return null;
        }

        // Update last accessed time (async, don't wait)
        this.updateLastAccessed(reportId).catch((err) =>
          console.warn('[PDFCache] Failed to update last accessed:', err)
        );
      }

      console.log('[PDFCache] Cache hit for report:', reportId);
      return `file://${filePath}`;
    } catch (error) {
      console.error('[PDFCache] Error getting cached PDF:', error);
      return null;
    }
  }

  /**
   * Download PDF with retry logic and race condition prevention
   */
  async downloadAndCache(
    reportId: string,
    url: string,
    onProgress?: (bytesWritten: number, contentLength: number) => void
  ): Promise<string> {
    // Check if download is already in progress for this report
    const existingDownload = this.downloadLocks.get(reportId);
    if (existingDownload) {
      console.log('[PDFCache] Download already in progress, waiting:', reportId);
      return existingDownload;
    }

    // Create download promise
    const downloadPromise = this._downloadWithRetry(reportId, url, onProgress);

    // Store in locks
    this.downloadLocks.set(reportId, downloadPromise);

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      // Remove lock when done
      this.downloadLocks.delete(reportId);
    }
  }

  /**
   * Internal download with retry logic
   */
  private async _downloadWithRetry(
    reportId: string,
    url: string,
    onProgress?: (bytesWritten: number, contentLength: number) => void,
    attempt: number = 1
  ): Promise<string> {
    try {
      await this.ensureCacheDir();

      // Check network connectivity
      const isConnected = await this.checkNetworkStatus();
      if (!isConnected) {
        throw new Error('No network connection available');
      }

      // Check disk space
      const hasSpace = await this.checkDiskSpace();
      if (!hasSpace) {
        throw new Error(`Insufficient disk space. At least ${this.MIN_DISK_SPACE_MB}MB required.`);
      }

      const filePath = `${this.cacheDir}${reportId}.pdf`;
      const tempFilePath = `${this.cacheDir}${reportId}.tmp.pdf`;

      console.log(`[PDFCache] Downloading PDF (attempt ${attempt}/${this.MAX_RETRY_ATTEMPTS}):`, reportId);

      // Download to temp file
      const downloadResult = await Promise.race([
        RNFS.downloadFile({
          fromUrl: url,
          toFile: tempFilePath,
          progress: onProgress
            ? (res) => {
                onProgress(res.bytesWritten, res.contentLength);
              }
            : undefined,
          progressDivider: 10,
          background: false,
          discretionary: false,
        }).promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Download timeout')), this.DOWNLOAD_TIMEOUT_MS)
        ),
      ]);

      if (downloadResult.statusCode !== 200) {
        throw new Error(`Download failed with status ${downloadResult.statusCode}`);
      }

      // Validate downloaded file is a PDF
      const isValidPdf = await this.validatePdfFile(tempFilePath);
      if (!isValidPdf) {
        await RNFS.unlink(tempFilePath).catch(() => {});
        throw new Error('Downloaded file is not a valid PDF');
      }

      // Move temp file to final location (atomic operation)
      const finalFileExists = await RNFS.exists(filePath);
      if (finalFileExists) {
        await RNFS.unlink(filePath);
      }
      await RNFS.moveFile(tempFilePath, filePath);

      // Get file info
      const stat = await RNFS.stat(filePath);

      // Update metadata (atomic write)
      await this.updateMetadata(reportId, {
        reportId,
        filePath,
        fileSize: parseInt(stat.size.toString(), 10),
        cachedAt: new Date(),
        lastAccessed: new Date(),
      });

      console.log('[PDFCache] Successfully cached PDF:', reportId);

      // Check if we should evict old cache (async, don't wait)
      this.evictOldCacheIfNeeded().catch((err) =>
        console.warn('[PDFCache] Eviction failed:', err)
      );

      return `file://${filePath}`;
    } catch (error) {
      console.error(`[PDFCache] Download attempt ${attempt} failed:`, error);

      // Clean up temp file
      const tempFilePath = `${this.cacheDir}${reportId}.tmp.pdf`;
      await RNFS.unlink(tempFilePath).catch(() => {});

      // Retry with exponential backoff
      if (attempt < this.MAX_RETRY_ATTEMPTS) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[PDFCache] Retrying in ${backoffMs}ms...`);
        await new Promise<void>((resolve) => setTimeout(() => resolve(), backoffMs));
        return this._downloadWithRetry(reportId, url, onProgress, attempt + 1);
      }

      // All retries failed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to download PDF after ${this.MAX_RETRY_ATTEMPTS} attempts: ${errorMessage}`);
    }
  }

  /**
   * Clear cache for specific report or all reports
   */
  async clearCache(reportId?: string): Promise<void> {
    try {
      await this.ensureCacheDir();

      if (reportId) {
        // Clear specific report
        const filePath = `${this.cacheDir}${reportId}.pdf`;
        const fileExists = await RNFS.exists(filePath);

        if (fileExists) {
          await RNFS.unlink(filePath);
          console.log('[PDFCache] Cleared cache for report:', reportId);
        }

        // Update metadata (atomic)
        const metadata = await this.getMetadata();
        delete metadata[reportId];
        await this.saveMetadata(metadata);
      } else {
        // Clear all cache
        const dirExists = await RNFS.exists(this.cacheDir);
        if (dirExists) {
          await RNFS.unlink(this.cacheDir);
          console.log('[PDFCache] Cleared all cache');
        }
        await this.ensureCacheDir();
      }
    } catch (error) {
      console.error('[PDFCache] Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Get total cache size in bytes
   */
  async getCacheSize(): Promise<number> {
    try {
      await this.ensureCacheDir();

      const files = await RNFS.readDir(this.cacheDir);
      let totalSize = 0;

      for (const file of files) {
        if (file.isFile() && file.name.endsWith('.pdf')) {
          totalSize += file.size;
        }
      }

      return totalSize;
    } catch (error) {
      console.error('[PDFCache] Error getting cache size:', error);
      return 0;
    }
  }

  /**
   * Get cache size in human-readable format
   */
  async getCacheSizeFormatted(): Promise<string> {
    const sizeInBytes = await this.getCacheSize();
    const sizeInMB = sizeInBytes / (1024 * 1024);

    if (sizeInMB < 1) {
      return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    }
    return `${sizeInMB.toFixed(1)} MB`;
  }

  /**
   * Clear old cache files (older than configured days)
   */
  async clearOldCache(olderThanDays: number = this.MAX_CACHE_AGE_DAYS): Promise<number> {
    try {
      await this.ensureCacheDir();

      const metadata = await this.getMetadata();
      const now = new Date();
      let clearedCount = 0;

      for (const [reportId, info] of Object.entries(metadata)) {
        const cachedDate = new Date(info.cachedAt);
        const daysSinceCached =
          (now.getTime() - cachedDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceCached > olderThanDays) {
          await this.clearCache(reportId);
          clearedCount++;
        }
      }

      console.log('[PDFCache] Cleared', clearedCount, 'old cache files');
      return clearedCount;
    } catch (error) {
      console.error('[PDFCache] Error clearing old cache:', error);
      return 0;
    }
  }

  /**
   * Evict cache using LRU strategy if cache is too large
   */
  private async evictOldCacheIfNeeded(): Promise<void> {
    try {
      const cacheSizeBytes = await this.getCacheSize();
      const cacheSizeMB = cacheSizeBytes / (1024 * 1024);

      if (cacheSizeMB > this.MAX_CACHE_SIZE_MB) {
        console.log(
          `[PDFCache] Cache size ${cacheSizeMB.toFixed(1)}MB exceeds limit, evicting old files`
        );

        // Get metadata sorted by last accessed (oldest first)
        const metadata = await this.getMetadata();
        const sortedEntries = Object.entries(metadata).sort(
          (a, b) =>
            new Date(a[1].lastAccessed).getTime() -
            new Date(b[1].lastAccessed).getTime()
        );

        // Evict until we're under the limit
        let currentSize = cacheSizeMB;
        for (const [reportId, info] of sortedEntries) {
          if (currentSize <= this.MAX_CACHE_SIZE_MB * 0.8) {
            // Target 80% of max
            break;
          }

          await this.clearCache(reportId);
          currentSize -= info.fileSize / (1024 * 1024);
          console.log(`[PDFCache] Evicted ${reportId}, new size: ${currentSize.toFixed(1)}MB`);
        }
      }
    } catch (error) {
      console.error('[PDFCache] Error evicting cache:', error);
    }
  }

  /**
   * Get all cached PDFs info
   */
  async getCachedFiles(): Promise<CachedPDFInfo[]> {
    try {
      const metadata = await this.getMetadata();
      return Object.values(metadata);
    } catch (error) {
      console.error('[PDFCache] Error getting cached files:', error);
      return [];
    }
  }

  /**
   * Get metadata for all cached files
   */
  private async getMetadata(): Promise<Record<string, CachedPDFInfo>> {
    try {
      await this.ensureCacheDir();

      const fileExists = await RNFS.exists(this.metadataFile);
      if (!fileExists) {
        return {};
      }

      const content = await RNFS.readFile(this.metadataFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[PDFCache] Error reading metadata:', error);

      // Try to recover from temp file if main file is corrupted
      try {
        const tempExists = await RNFS.exists(this.tempMetadataFile);
        if (tempExists) {
          console.log('[PDFCache] Recovering from temp metadata file');
          const tempContent = await RNFS.readFile(this.tempMetadataFile, 'utf8');
          return JSON.parse(tempContent);
        }
      } catch (tempError) {
        console.error('[PDFCache] Failed to recover from temp file:', tempError);
      }

      return {};
    }
  }

  /**
   * Save metadata with atomic write
   */
  private async saveMetadata(metadata: Record<string, CachedPDFInfo>): Promise<void> {
    try {
      await this.ensureCacheDir();

      const content = JSON.stringify(metadata, null, 2);

      // Write to temp file first
      await RNFS.writeFile(this.tempMetadataFile, content, 'utf8');

      // Then move to final location (atomic operation)
      const finalExists = await RNFS.exists(this.metadataFile);
      if (finalExists) {
        await RNFS.unlink(this.metadataFile);
      }
      await RNFS.moveFile(this.tempMetadataFile, this.metadataFile);
    } catch (error) {
      console.error('[PDFCache] Error saving metadata:', error);
      // Clean up temp file
      await RNFS.unlink(this.tempMetadataFile).catch(() => {});
      throw error;
    }
  }

  /**
   * Update metadata for a specific report
   */
  private async updateMetadata(reportId: string, info: CachedPDFInfo): Promise<void> {
    const metadata = await this.getMetadata();
    metadata[reportId] = info;
    await this.saveMetadata(metadata);
  }

  /**
   * Update last accessed time for a report
   */
  private async updateLastAccessed(reportId: string): Promise<void> {
    const metadata = await this.getMetadata();
    if (metadata[reportId]) {
      metadata[reportId].lastAccessed = new Date();
      await this.saveMetadata(metadata);
    }
  }

  /**
   * Check if report is cached
   */
  async isCached(reportId: string): Promise<boolean> {
    const cachedPath = await this.getCachedPdf(reportId);
    return cachedPath !== null;
  }

  /**
   * Cancel download for a specific report (if in progress)
   */
  async cancelDownload(reportId: string): Promise<void> {
    // Remove from download locks
    this.downloadLocks.delete(reportId);

    // Clean up temp file
    const tempFilePath = `${this.cacheDir}${reportId}.tmp.pdf`;
    try {
      const exists = await RNFS.exists(tempFilePath);
      if (exists) {
        await RNFS.unlink(tempFilePath);
        console.log('[PDFCache] Cancelled download and cleaned up temp file:', reportId);
      }
    } catch (error) {
      console.error('[PDFCache] Error cancelling download:', error);
    }
  }
}

// Singleton instance
export const pdfCache = new PDFCacheManager();
