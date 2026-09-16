import React, { useCallback, useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

// Inline copy of expo-router's useFocusEffect (re-exported from react-navigation core),
// driven by a fully controlled fake `navigation` so we isolate JUST the re-run-on-focused
// dependency-change behavior, without needing a real NativeStackNavigator in jest.
function useFocusEffect(effect: () => void | (() => void)) {
  const navigation = fakeNavigation;
  React.useEffect(() => {
    let isFocused = false;
    let cleanup: undefined | void | (() => void);
    const callback = () => {
      cleanup = effect();
    };
    if (navigation.isFocused()) {
      cleanup = callback() as any;
      isFocused = true;
    }
    const unsubscribeFocus = navigation.addListener('focus', () => {
      if (isFocused) return;
      if (cleanup !== undefined) (cleanup as any)();
      cleanup = callback() as any;
      isFocused = true;
    });
    return () => {
      if (cleanup !== undefined) (cleanup as any)();
      unsubscribeFocus();
    };
  }, [effect, navigation]);
}

const fakeNavigation = {
  isFocused: () => true,
  addListener: (_type: string, _cb: () => void) => () => {},
};

const loadSpy = jest.fn();

function Inner() {
  const [year, setYear] = useState(2026);
  const load = useCallback(() => {
    loadSpy(year);
  }, [year]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return React.createElement('Button', { testID: 'prev', onPress: () => setYear((y) => y - 1) });
}

test('re-invokes the focus effect when its callback identity changes while focused', () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<Inner />);
  });
  expect(loadSpy).toHaveBeenCalledTimes(1);
  expect(loadSpy).toHaveBeenLastCalledWith(2026);

  const btn = tree!.root.findByProps({ testID: 'prev' });
  act(() => {
    btn.props.onPress();
  });

  expect(loadSpy).toHaveBeenCalledTimes(2);
  expect(loadSpy).toHaveBeenLastCalledWith(2025);
});
