// ===========================================================================
// FormScreen - keyboard-safe scrolling form that does NOT jump (v12.14).
//
// Why the old screen jumped on Android: the keyboard opening/closing changed the
// ScrollView's size (padding measured at runtime), the native ScrollView
// auto-scrolled to the focused field, and our own code scrolled too -> the page
// moved back and forth and focus/keyboard flickered while typing.
//
// New approach (Android): NOTHING resizes when the keyboard opens.
//   * A fixed blank spacer sits under the form, so there is always enough
//     scroll range to lift ANY field above the keyboard.
//   * When a <Field> gets focus it asks us to reveal it; we scroll ONCE, smoothly,
//     so that field sits near the top of the screen. No measuring of the keyboard,
//     no padding changes, no fighting scrolls.
// iOS / web keep the existing KeyboardAwareScreen (they never had the problem).
// ===========================================================================
import { createContext, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Platform, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAwareScreen } from './KeyboardAwareScreen';

export type RevealFn = (node: View | null) => void;
export const FormScrollContext = createContext<RevealFn | null>(null);

const KEYBOARD_ROOM = 360;   // blank scroll room under the form (covers the tallest keyboard)
const TOP_GAP = 110;         // focused field is placed this far from the top of the screen
const REVEAL_DELAY_MS = 160; // let Android finish its own focus handling first

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function FormScreen({ children, style, contentContainerStyle }: Props) {
  if (Platform.OS !== 'android') {
    return <KeyboardAwareScreen style={style} contentContainerStyle={contentContainerStyle}>{children}</KeyboardAwareScreen>;
  }
  return <AndroidFormScreen style={style} contentContainerStyle={contentContainerStyle}>{children}</AndroidFormScreen>;
}

function AndroidFormScreen({ children, style, contentContainerStyle }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const reveal = useCallback<RevealFn>((node) => {
    if (!node) return;
    if (timer.current) clearTimeout(timer.current);   // only the LAST focused field scrolls
    timer.current = setTimeout(() => {
      const content = contentRef.current;
      if (!content) return;
      try {
        (node as any).measureLayout(
          content,
          (_x: number, y: number) => { scrollRef.current?.scrollTo({ y: Math.max(0, y - TOP_GAP), animated: true }); },
          () => {},
        );
      } catch { /* never let a scroll helper crash typing */ }
    }, REVEAL_DELAY_MS);
  }, []);

  return (
    <FormScrollContext.Provider value={reveal}>
      <ScrollView
        ref={scrollRef}
        style={[{ flex: 1 }, style]}
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets={false}
      >
        <View ref={contentRef} collapsable={false}>
          {children}
          <View style={{ height: KEYBOARD_ROOM }} />
        </View>
      </ScrollView>
    </FormScrollContext.Provider>
  );
}
