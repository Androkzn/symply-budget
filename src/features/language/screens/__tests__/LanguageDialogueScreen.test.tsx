/**
 * LanguageDialogueScreen — Symply Language (`symply-language`) conversation
 * practice screen.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives its behavior: the scenario picker, generating a dialogue
 * (api called with the chosen scenario), the loading gate while the request is
 * in-flight, rendering the AI-written scene (context + speaker bubbles +
 * translations + key vocabulary + tips), the empty-data branches, error
 * handling on a rejected request, regenerating with a different scenario, and
 * back navigation. The dialogues api + layout hooks are mocked so state is
 * deterministic; the api's own logic is covered in its sibling suite.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { languageDialoguesApi, type GeneratedDialogue } from '../../api/languageExtras';
import { IPAD, IPHONE, allText, hasTestId, pressByText } from '../../test-utils/languageScreenTestKit';
import { LanguageDialogueScreen } from '../LanguageDialogueScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Expose the header title + back handler so back routing is exercised.
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(Text, { key: 'title' }, title),
        ReactMock.createElement(Pressable, {
          key: 'back',
          testID: 'hdr-back',
          onPress: onBackPress,
        }),
      ]),
  };
});

jest.mock('../../api/languageExtras', () => ({
  languageDialoguesApi: { generate: jest.fn() },
  languageGamesApi: { vocabulary: jest.fn() },
  languageVoiceApi: { turn: jest.fn(), speakingHabits: jest.fn() },
  languagePracticeApi: { backlog: jest.fn(), mistakes: jest.fn(), stats: jest.fn(), dismiss: jest.fn() },
  languageDriveApi: {
    status: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    listFiles: jest.fn(),
  },
}));

const mockGenerate = languageDialoguesApi.generate as jest.Mock;

function dialogue(overrides: Partial<GeneratedDialogue> = {}): GeneratedDialogue {
  return {
    scenario: 'restaurant',
    context: 'You are ordering dinner at a Parisian bistro.',
    exchanges: [
      { speaker: 'other', text: 'Bonjour, que desirez-vous?', translation: 'Hello, what would you like?' },
      { speaker: 'user', text: 'Je voudrais un cafe.', translation: 'I would like a coffee.' },
    ],
    vocabulary: ['le cafe', "l'addition"],
    tips: ['Use vous for politeness.', 'Greet with bonjour.'],
    ...overrides,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageDialogueScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

function activityIndicators(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(ActivityIndicator);
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockGenerate.mockResolvedValue(dialogue());
});

describe('LanguageDialogueScreen — initial render', () => {
  it('mounts the scenario picker with the intro prompt and no dialogue yet', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(hasTestId(tree, 'language-dialogue-screen')).toBe(true);
    expect(text).toContain('Pick a scene and practice a real conversation');
    // No request until the user picks a scene.
    expect(mockGenerate).not.toHaveBeenCalled();
    // No loading / error / dialogue on first paint.
    expect(activityIndicators(tree)).toHaveLength(0);
    expect(text).not.toContain('Writing your scene');
    expect(text).not.toContain('KEY VOCABULARY');
  });

  it('offers every scenario in the picker', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    for (const label of ['Restaurant', 'Doctor', 'Workplace', 'Airport', 'Hotel']) {
      expect(text).toContain(label);
    }
  });
});

describe('LanguageDialogueScreen — generating a dialogue', () => {
  it('calls the dialogues api with the selected scenario id', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Restaurant');
    });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith('restaurant');
  });

  it('renders context, both speaker bubbles + translations, vocabulary and tips', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Restaurant');
    });
    const text = allText(tree.toJSON());
    // Context line.
    expect(text).toContain('You are ordering dinner at a Parisian bistro.');
    // Both exchanges + their translations.
    expect(text).toContain('Bonjour, que desirez-vous?');
    expect(text).toContain('Hello, what would you like?');
    expect(text).toContain('Je voudrais un cafe.');
    expect(text).toContain('I would like a coffee.');
    // Vocabulary card (joined with the middot separator).
    expect(text).toContain('KEY VOCABULARY');
    expect(text).toContain("le cafe · l'addition");
    // Tips card (each bulleted).
    expect(text).toContain('TIPS');
    expect(text).toContain('• Use vous for politeness.');
    expect(text).toContain('• Greet with bonjour.');
    // Loading gone once resolved.
    expect(activityIndicators(tree)).toHaveLength(0);
    expect(text).not.toContain('Writing your scene');
  });

  it('omits the context, translation, vocabulary and tips blocks when empty', async () => {
    mockGenerate.mockResolvedValue(
      dialogue({
        context: '',
        exchanges: [{ speaker: 'other', text: 'Just a line.', translation: '' }],
        vocabulary: [],
        tips: [],
      }),
    );
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Hotel');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Just a line.');
    expect(text).not.toContain('KEY VOCABULARY');
    expect(text).not.toContain('TIPS');
  });
});

describe('LanguageDialogueScreen — loading state', () => {
  it('shows the spinner + "Writing your scene…" while the request is in-flight', async () => {
    let resolveGen!: (d: GeneratedDialogue) => void;
    mockGenerate.mockReturnValue(
      new Promise<GeneratedDialogue>((res) => {
        resolveGen = res;
      }),
    );
    const tree = await renderScreen();

    // Kick off generation; the promise stays pending.
    act(() => {
      pressByText(tree, 'Doctor');
    });

    expect(activityIndicators(tree)).toHaveLength(1);
    expect(allText(tree.toJSON())).toContain('Writing your scene');
    expect(allText(tree.toJSON())).not.toContain('KEY VOCABULARY');

    // Settle so no act() warning leaks into later tests.
    await act(async () => {
      resolveGen(dialogue());
    });
    expect(allText(tree.toJSON())).toContain('KEY VOCABULARY');
  });
});

describe('LanguageDialogueScreen — error handling', () => {
  it('shows a stable error message when the request rejects', async () => {
    mockGenerate.mockRejectedValue(new Error('backend down'));
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Airport');
    });
    const text = allText(tree.toJSON());
    expect(text).toContain('Could not generate a dialogue right now. Please try again.');
    // Screen stays mounted; no dialogue / spinner left behind.
    expect(hasTestId(tree, 'language-dialogue-screen')).toBe(true);
    expect(activityIndicators(tree)).toHaveLength(0);
    expect(text).not.toContain('KEY VOCABULARY');
  });
});

describe('LanguageDialogueScreen — regenerating', () => {
  it('swaps content and re-calls the api when a different scenario is picked', async () => {
    const tree = await renderScreen();
    await act(async () => {
      pressByText(tree, 'Restaurant');
    });
    expect(allText(tree.toJSON())).toContain('You are ordering dinner at a Parisian bistro.');

    mockGenerate.mockResolvedValue(
      dialogue({
        scenario: 'workplace',
        context: 'A stand-up meeting with your team.',
        exchanges: [{ speaker: 'other', text: 'How is the sprint going?', translation: 'Progress?' }],
        vocabulary: ['deadline'],
        tips: ['Keep it short.'],
      }),
    );

    await act(async () => {
      pressByText(tree, 'Workplace');
    });

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate).toHaveBeenLastCalledWith('workplace');
    const text = allText(tree.toJSON());
    expect(text).toContain('A stand-up meeting with your team.');
    // Previous scene is fully replaced.
    expect(text).not.toContain('You are ordering dinner at a Parisian bistro.');
  });
});

describe('LanguageDialogueScreen — navigation', () => {
  it('routes the header back button to router.back()', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'hdr-back' }).props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('LanguageDialogueScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions and can still generate a dialogue', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-dialogue-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Restaurant');

    await act(async () => {
      pressByText(tree, 'Restaurant');
    });
    expect(allText(tree.toJSON())).toContain('KEY VOCABULARY');
  });
});
