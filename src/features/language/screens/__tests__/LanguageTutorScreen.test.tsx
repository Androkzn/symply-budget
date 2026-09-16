/**
 * LanguageTutorScreen — Symply Language (`symply-language`) live teaching-chat
 * (AI tutor) screen.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives its behavior: the boot gate (createSession → getMessages),
 * the empty-state prompt, rendering existing user + teacher bubbles, typing into
 * the composer and sending a turn (sendMessage called with the typed text + the
 * reply appended), the empty-input guard (send disabled / no request), submit-
 * via-keyboard, a failed send (fallback bubble, screen stays stable) and a boot
 * failure. The teaching-chat api + layout hook are mocked so state is
 * deterministic; the api's own logic is covered in its sibling suite.
 *
 * Note: this screen has no router/back button and no suggested/quick-action
 * buttons — the reply's `tool_results` / `pronunciation` fields are part of the
 * api contract but the UI ignores them — so those checklist items are N/A here.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  languageTutorApi,
  type TutorMessageRow,
  type TutorReply,
  type TutorSessionRow,
} from '../../api/languageTutor';
import { IPAD, IPHONE, allText, hasTestId } from '../../test-utils/languageScreenTestKit';
import { LanguageTutorScreen } from '../LanguageTutorScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // The tutor header takes only a title (no back handler is wired).
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(Text, { key: 'title' }, title),
      ]),
  };
});

jest.mock('../../api/languageTutor', () => ({
  languageTutorApi: {
    createSession: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    getHistory: jest.fn(),
  },
}));

const mockCreateSession = languageTutorApi.createSession as jest.Mock;
const mockGetMessages = languageTutorApi.getMessages as jest.Mock;
const mockSendMessage = languageTutorApi.sendMessage as jest.Mock;

// ---- realistic payloads matching the TS interfaces -------------------------

function sessionRow(overrides: Partial<TutorSessionRow> = {}): TutorSessionRow {
  return {
    id: 'sess-1',
    user_id: 'u1',
    date: '2026-07-14',
    message_count: 2,
    summary: null,
    start_time: '2026-07-14T09:00:00Z',
    ...overrides,
  };
}

function userRow(overrides: Partial<TutorMessageRow> = {}): TutorMessageRow {
  return {
    id: 'm-user-1',
    session_id: 'sess-1',
    is_user: 1,
    content: 'Hola profesor',
    created_at: '2026-07-14T09:00:01Z',
    ...overrides,
  };
}

function teacherRow(overrides: Partial<TutorMessageRow> = {}): TutorMessageRow {
  return {
    id: 'm-teacher-1',
    session_id: 'sess-1',
    is_user: 0,
    content: 'Hola, bienvenido',
    teacher_name: 'Sofia',
    created_at: '2026-07-14T09:00:02Z',
    tool_results: [],
    assistant_ui_blocks: [],
    ...overrides,
  };
}

function reply(overrides: Partial<TutorReply> = {}): TutorReply {
  return {
    message: 'Great question! "hola" means hello.',
    sessionId: 'sess-1',
    userMessageId: 'm-user-9',
    teacherMessageId: 'm-teacher-9',
    teacherName: 'Sofia',
    tool_results: [{ name: 'definition', result: { word: 'hola' } }],
    stop_reason: 'end_turn',
    pronunciation: null,
    assistant_ui_blocks: [],
    ...overrides,
  };
}

// ---- render + query helpers ------------------------------------------------

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageTutorScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

function activityIndicators(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(ActivityIndicator);
}

/** The composer TextInput (matched by our authored multiline + onChangeText). */
function composer(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props?.multiline === true && typeof n.props?.onChangeText === 'function',
  )[0];
}

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  composer(tree).props.onChangeText(text);
}

/** The send Pressable (matched by its accessibility label + onPress). */
function sendButton(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n) =>
      n.props?.accessibilityLabel === 'Send message' && typeof n.props?.onPress === 'function',
  )[0];
}

beforeAll(() => {
  // Stub rAF so the screen's scrollToEnd() (listRef.scrollToEnd) never fires
  // against a non-native FlatList in the test renderer.
  global.requestAnimationFrame = ((_cb: (timestamp: number) => void) =>
    0) as unknown as typeof global.requestAnimationFrame;
});

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  // Fake timers keep the FlatList/VirtualizedList windowing timer from firing a
  // setState outside act() (initial cells still render synchronously).
  jest.useFakeTimers();
  mockCreateSession.mockResolvedValue(sessionRow());
  mockGetMessages.mockResolvedValue([]);
  mockSendMessage.mockResolvedValue(reply());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LanguageTutorScreen — boot gate', () => {
  it('shows a spinner while the session is being created', () => {
    mockCreateSession.mockReturnValue(new Promise(() => {})); // never resolves
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <LanguageTutorScreen />
        </ThemeProvider>,
      );
    });
    expect(activityIndicators(tree).length).toBeGreaterThanOrEqual(1);
    expect(hasTestId(tree, 'language-tutor-screen')).toBe(true);
  });

  it('creates a session and loads existing messages on mount', async () => {
    mockGetMessages.mockResolvedValue([
      userRow({ content: 'Hola profesor' }),
      teacherRow({ content: 'Hola, bienvenido' }),
      // Blank rows are filtered out by the screen.
      teacherRow({ id: 'm-empty', content: '' }),
    ]);
    const tree = await renderScreen();

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockGetMessages).toHaveBeenCalledWith('sess-1');

    const text = allText(tree.toJSON());
    expect(text).toContain('Hola profesor'); // user bubble
    expect(text).toContain('Hola, bienvenido'); // teacher bubble
    expect(hasTestId(tree, 'language-tutor-screen')).toBe(true);
    // Boot spinner gone once resolved.
    expect(activityIndicators(tree)).toHaveLength(0);
  });

  it('shows the empty-state prompt when the session has no messages yet', async () => {
    mockGetMessages.mockResolvedValue([]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Ask your tutor anything');
  });

  it('treats a boolean is_user row as a user bubble', async () => {
    mockGetMessages.mockResolvedValue([userRow({ is_user: true, content: 'Boolean user turn' })]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Boolean user turn');
  });

  it('falls back to the row.text field when content is absent', async () => {
    mockGetMessages.mockResolvedValue([
      teacherRow({ content: undefined, text: 'Via the text field' }),
    ]);
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Via the text field');
  });

  it('drops a row that has neither content nor text (empty-string fallback → filtered)', async () => {
    mockGetMessages.mockResolvedValue([
      teacherRow({ content: undefined, text: undefined }),
    ]);
    const tree = await renderScreen();
    // rowToMessage bottoms out at '' and the screen filters empty turns, so the
    // session reads as having no messages yet.
    expect(allText(tree.toJSON())).toContain('Ask your tutor anything');
  });
});

describe('LanguageTutorScreen — platform behavior', () => {
  it('omits KeyboardAvoidingView padding on Android', async () => {
    const original = Platform.OS;
    (Platform as { OS: string }).OS = 'android';
    try {
      const tree = await renderScreen();
      const kav = tree.root.findAll(
        (n) => n.props?.keyboardVerticalOffset === 90,
      )[0];
      expect(kav.props.behavior).toBeUndefined();
    } finally {
      (Platform as { OS: string }).OS = original;
    }
  });

  it('uses padding behavior on iOS', async () => {
    const tree = await renderScreen();
    const kav = tree.root.findAll((n) => n.props?.keyboardVerticalOffset === 90)[0];
    expect(kav.props.behavior).toBe('padding');
  });
});

describe('LanguageTutorScreen — sending a turn', () => {
  it('sends the typed text and renders the tutor reply', async () => {
    mockGetMessages.mockResolvedValue([]);
    mockSendMessage.mockResolvedValue(reply({ message: 'Bien hecho! You said it perfectly.' }));
    const tree = await renderScreen();

    // Type first so the re-render rebuilds send() with the fresh draft…
    await act(async () => {
      typeInto(tree, 'Como se dice hello?');
    });
    // …then press send.
    await act(async () => {
      sendButton(tree).props.onPress();
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      text: 'Como se dice hello?',
    });

    const text = allText(tree.toJSON());
    expect(text).toContain('Como se dice hello?'); // user bubble
    expect(text).toContain('Bien hecho! You said it perfectly.'); // teacher reply
  });

  it('trims surrounding whitespace before sending', async () => {
    const tree = await renderScreen();
    await act(async () => {
      typeInto(tree, '   Buenos dias   ');
    });
    await act(async () => {
      sendButton(tree).props.onPress();
    });
    expect(mockSendMessage).toHaveBeenCalledWith({ sessionId: 'sess-1', text: 'Buenos dias' });
  });

  it('sends when the composer submits via the keyboard', async () => {
    const tree = await renderScreen();
    await act(async () => {
      typeInto(tree, 'Gracias');
    });
    await act(async () => {
      composer(tree).props.onSubmitEditing();
    });
    expect(mockSendMessage).toHaveBeenCalledWith({ sessionId: 'sess-1', text: 'Gracias' });
  });

  it('shows an in-flight spinner while sending, then appends the reply (id fallback)', async () => {
    let resolveSend!: (r: TutorReply) => void;
    mockSendMessage.mockReturnValue(
      new Promise<TutorReply>((res) => {
        resolveSend = res;
      }),
    );
    const tree = await renderScreen();

    await act(async () => {
      typeInto(tree, 'Hola');
    });
    // Kick off the send; the request stays pending.
    act(() => {
      sendButton(tree).props.onPress();
    });

    // Send button swaps its arrow for a spinner while the turn is in-flight.
    expect(activityIndicators(tree)).toHaveLength(1);

    // Resolve with a reply that omits teacherMessageId → local id fallback.
    await act(async () => {
      resolveSend(reply({ teacherMessageId: undefined as unknown as string, message: 'Muy bien.' }));
    });

    expect(activityIndicators(tree)).toHaveLength(0);
    expect(allText(tree.toJSON())).toContain('Muy bien.');
  });
});

describe('LanguageTutorScreen — empty-input guard', () => {
  it('disables send and makes no request while the input is blank', async () => {
    const tree = await renderScreen();
    expect(sendButton(tree).props.disabled).toBe(true);
    await act(async () => {
      sendButton(tree).props.onPress();
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('keeps send disabled for whitespace-only input', async () => {
    const tree = await renderScreen();
    await act(async () => {
      typeInto(tree, '    ');
    });
    expect(sendButton(tree).props.disabled).toBe(true);
    await act(async () => {
      sendButton(tree).props.onPress();
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('enables send once real text is entered', async () => {
    const tree = await renderScreen();
    await act(async () => {
      typeInto(tree, 'Hola');
    });
    expect(sendButton(tree).props.disabled).toBe(false);
  });
});

describe('LanguageTutorScreen — auto-scroll to the newest turn', () => {
  /** Run `fn` with rAF invoking its callback synchronously, then restore the stub. */
  async function withSyncAnimationFrame(fn: () => Promise<void>) {
    const stubbed = global.requestAnimationFrame;
    global.requestAnimationFrame = ((cb: (time: number) => void) => {
      cb(0);
      return 0;
    }) as unknown as typeof global.requestAnimationFrame;
    try {
      await fn();
    } finally {
      global.requestAnimationFrame = stubbed;
    }
  }

  it('scrolls the message list to the end when its content grows', async () => {
    mockGetMessages.mockResolvedValue([userRow(), teacherRow()]);
    const tree = await renderScreen();

    const list = tree.root.findAll(
      (n) => typeof n.type !== 'string' && n.props?.testID === 'language-tutor-messages',
    )[0];
    const scrollToEnd = jest.fn();
    (list.instance as unknown as { scrollToEnd: unknown }).scrollToEnd = scrollToEnd;

    await withSyncAnimationFrame(async () => {
      await act(async () => {
        list.props.onContentSizeChange();
      });
    });

    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  it('tolerates the scroll frame firing before the list is mounted', async () => {
    // From the empty state the first send schedules a scroll while the FlatList
    // still is not rendered — the pending frame must no-op, not crash the turn.
    mockGetMessages.mockResolvedValue([]);
    mockSendMessage.mockReturnValue(new Promise(() => {})); // stays in flight
    const tree = await renderScreen();

    await act(async () => {
      typeInto(tree, 'Hola');
    });
    await withSyncAnimationFrame(async () => {
      await act(async () => {
        sendButton(tree).props.onPress();
      });
    });

    expect(mockSendMessage).toHaveBeenCalledWith({ sessionId: 'sess-1', text: 'Hola' });
    expect(hasTestId(tree, 'language-tutor-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Hola'); // the user bubble landed
  });
});

describe('LanguageTutorScreen — error handling', () => {
  it('keeps the screen stable and shows a fallback bubble when the send fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('network down'));
    const tree = await renderScreen();

    await act(async () => {
      typeInto(tree, 'Hola');
    });
    await act(async () => {
      sendButton(tree).props.onPress();
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const text = allText(tree.toJSON());
    expect(text).toContain('Hola'); // the user's turn persists
    expect(text).toContain('reply just now'); // fallback teacher bubble
    expect(hasTestId(tree, 'language-tutor-screen')).toBe(true);
  });

  it('surfaces a boot error when the session cannot be created', async () => {
    mockCreateSession.mockRejectedValue(new Error('boot down'));
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-tutor-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Could not start your tutor session');
    // Composer stays disabled with no session id.
    expect(composer(tree).props.editable).toBe(false);
  });

  it('surfaces a boot error when the message history fails to load', async () => {
    mockGetMessages.mockRejectedValue(new Error('history down'));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Could not start your tutor session');
  });
});

describe('LanguageTutorScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions and can still send a turn', async () => {
    mockWindow = IPAD;
    mockGetMessages.mockResolvedValue([]);
    mockSendMessage.mockResolvedValue(reply({ message: 'Perfecto en tablet.' }));
    const tree = await renderScreen();

    expect(hasTestId(tree, 'language-tutor-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Ask your tutor anything');

    await act(async () => {
      typeInto(tree, 'Hola desde iPad');
    });
    await act(async () => {
      sendButton(tree).props.onPress();
    });

    expect(mockSendMessage).toHaveBeenCalledWith({ sessionId: 'sess-1', text: 'Hola desde iPad' });
    expect(allText(tree.toJSON())).toContain('Perfecto en tablet.');
  });
});
