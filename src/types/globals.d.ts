/**
 * Ambient global declarations for the mobile app.
 */

// `useWindowDimensions` is imported from its deep RN internal path so tests can
// jest.mock() it there; RN ships the file as JS without a colocated .d.ts.
declare module 'react-native/Libraries/Utilities/useWindowDimensions' {
  import type { ScaledSize } from 'react-native';
  const useWindowDimensions: () => ScaledSize;
  export default useWindowDimensions;
}

// Base64 helpers are available in the RN/Hermes runtime but not in the RN lib types.
declare function atob(data: string): string;
declare function btoa(data: string): string;
