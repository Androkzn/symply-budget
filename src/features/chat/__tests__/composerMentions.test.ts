/**
 * Composer text helpers — the caret-aware `@mention` token, the caret the field
 * lands on after an edit, and the "always ask the assistant" body rewrite.
 *
 * The interesting cases are all MID-STRING: the bug these replace was an
 * end-anchored match, which is why tagging anyone (the assistant included) was
 * impossible from the edit composer, where the mention is typed in FRONT of the
 * message being edited.
 */
import {
  ASSISTANT_HANDLE,
  assistantDefaultKey,
  bodyMentionsAssistant,
  caretAfterEdit,
  mentionTokenAt,
  withAssistantMention,
} from '../composerMentions';

describe('mentionTokenAt', () => {
  it('finds the token the caret sits in at the end of the text', () => {
    expect(mentionTokenAt('hey @al', 7)).toEqual({ query: 'al', start: 4, end: 7 });
  });

  it('finds a token typed in FRONT of existing text (the edit case)', () => {
    const text = '@a Find good Mold removal for me';
    expect(mentionTokenAt(text, 2)).toEqual({ query: 'a', start: 0, end: 2 });
  });

  it('offers every candidate on a bare @ (empty query)', () => {
    expect(mentionTokenAt('@', 1)).toEqual({ query: '', start: 0, end: 1 });
  });

  it('ignores an @ the caret has already moved past a space from', () => {
    expect(mentionTokenAt('@assistant hello', 16)).toBeNull();
  });

  it('ignores an @ glued to a preceding word (an email, not a mention)', () => {
    expect(mentionTokenAt('me@x.com', 8)).toBeNull();
  });

  it('is null when the caret is before the @', () => {
    expect(mentionTokenAt('@ali', 0)).toBeNull();
  });

  it('clamps a caret past the end of the text', () => {
    expect(mentionTokenAt('@ali', 99)).toEqual({ query: 'ali', start: 0, end: 4 });
  });
});

describe('caretAfterEdit', () => {
  it('lands after an insertion at the start', () => {
    expect(caretAfterEdit('Find good', '@Find good')).toBe(1);
    expect(caretAfterEdit('@Find good', '@aFind good')).toBe(2);
  });

  it('lands after an insertion in the middle', () => {
    expect(caretAfterEdit('AB', 'AXB')).toBe(2);
  });

  it('lands where a deletion happened', () => {
    expect(caretAfterEdit('AXB', 'AB')).toBe(1);
  });

  it('lands after a replaced span', () => {
    expect(caretAfterEdit('Hello', 'Hi')).toBe(2);
  });

  it('lands at the end when text is appended', () => {
    expect(caretAfterEdit('hey ', 'hey @')).toBe(5);
  });
});

describe('withAssistantMention', () => {
  it('prefixes the handle when the body does not address the assistant', () => {
    expect(withAssistantMention('find mold removal')).toBe('@assistant find mold removal');
  });

  it('leaves a body that already mentions @assistant alone', () => {
    expect(withAssistantMention('hey @assistant help')).toBe('hey @assistant help');
  });

  it('accepts @ai as already addressing the assistant (the backend does)', () => {
    expect(withAssistantMention('@ai what now')).toBe('@ai what now');
  });

  it('is case-insensitive', () => {
    expect(withAssistantMention('@Assistant hi')).toBe('@Assistant hi');
  });

  it('does not turn an empty body into a bare handle', () => {
    expect(withAssistantMention('   ')).toBe('');
  });

  it('does not match a longer word that merely starts with the handle', () => {
    expect(bodyMentionsAssistant('@assistants')).toBe(false);
    expect(withAssistantMention('@aid kit')).toBe(`${ASSISTANT_HANDLE} @aid kit`);
  });
});

describe('assistantDefaultKey', () => {
  it('scopes the preference by app and room', () => {
    expect(assistantDefaultKey('house', 'r1')).toBe('chat:house:assistant-default:r1');
    expect(assistantDefaultKey('budget', 'r1')).not.toBe(assistantDefaultKey('house', 'r1'));
  });
});
