export type FixtureApp = 'house' | 'budget' | 'kaizen';
export type FixtureKind = 'image' | 'document';

export interface Fixture {
  key: string;
  app: FixtureApp;
  name: string;
  mime: string;
  kind: FixtureKind;
  targets: string[];
  source: string;
  absPath: string;
  uri: string;
}

export interface PickerAsset {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export const REPO_ROOT: string;
export function fixture(key: string): Fixture;
export function listFixtures(app?: FixtureApp): Fixture[];
export function fixturesFor(target: string): Fixture[];
export function fixtureBytes(key: string): Buffer;
export function fixtureText(key: string): string;
export function fixtureArrayBuffer(key: string): ArrayBuffer;
export function fixtureFile(key: string): File;
export function pickerAsset(key: string): PickerAsset;
export function assertExists(key: string): Fixture;
