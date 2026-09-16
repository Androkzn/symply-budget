/**
 * Browser-safe adapter for the native PDF cache.
 *
 * The public Web build uses normal HTTP/browser caching. Native builds keep
 * using react-native-fs for an OS-managed offline cache; Web must not access
 * NativeModules or manufacture `file://` paths.
 */
const RNFS = {
  DocumentDirectoryPath: 'web-cache://documents',
  async exists() { return false; },
  async mkdir() { return undefined; },
  async getFSInfo() { return { freeSpace: Number.MAX_SAFE_INTEGER, totalSpace: Number.MAX_SAFE_INTEGER }; },
  async read() { return ''; },
  async readDir() { return []; },
  async readFile() { return ''; },
  async writeFile() { return undefined; },
  async unlink() { return undefined; },
  async moveFile() { return undefined; },
  async stat() { return { size: 0 }; },
  downloadFile() {
    return { promise: Promise.resolve({ statusCode: 200, bytesWritten: 0, contentLength: 0 }) };
  },
};

export default RNFS;
